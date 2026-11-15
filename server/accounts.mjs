import {createHash, randomBytes, randomUUID, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {validateProject} from '../src/core.mjs';

const hashPassword = promisify(scrypt);
const digest = token => createHash('sha256').update(token).digest('hex');
const sessionAge = 7 * 24 * 60 * 60;
const projectLimit = 20 * 1024 * 1024;
const accountLimit = 100 * 1024 * 1024;
const cookieName = 'ow_session';
const json = (status, data, headers = {}) => Response.json(data, {status, headers:{'Cache-Control':'no-store',...headers}});
class ApiError extends Error {
 constructor(status, message) { super(message); this.status = status; }
}
async function readJson(request, limit) {
 if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415,'Send JSON.');
 if (Number(request.headers.get('content-length')) > limit) throw new ApiError(413,'Request exceeds the size limit.');
 const reader = request.body?.getReader(), chunks = [];
 let size = 0;
 if (reader) {
  for (;;) {
   const {done, value} = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > limit) {
    void reader.cancel().catch(() => {});
    throw new ApiError(413,'Request exceeds the size limit.');
   }
   chunks.push(value);
  }
 }
 try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch {throw new ApiError(400,'Invalid JSON.');}
}

export function createAccounts({databasePath, origin}) {
 const db = new DatabaseSync(databasePath);
 db.exec(`PRAGMA journal_mode = WAL;
 PRAGMA foreign_keys = ON;
 CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name TEXT NOT NULL, body TEXT NOT NULL, bytes INTEGER NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS projects_account ON projects(account_id, updated_at);
 CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`);
 const secure = origin.startsWith('https://');
 const cookie = (value, seconds) => `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
 const getToken = request => request.headers.get('cookie')?.match(/(?:^|;\s*)ow_session=([a-zA-Z0-9_-]{43})(?:;|$)/)?.[1];
 const getAccount = token => token && db.prepare(`SELECT accounts.id, accounts.username FROM sessions JOIN accounts ON accounts.id=sessions.account_id WHERE token_hash=? AND expires>?`).get(digest(token),Date.now());
 const attempts = new Map();
 let hashesInFlight = 0;

 function throttle(key, limit) {
  const now = Date.now();
  for (const [id, entry] of attempts) if (entry.until <= now) attempts.delete(id);
  const entry = attempts.get(key) ?? {count:0,until:now+15*60*1000};
  if (entry.count >= limit || (!attempts.has(key) && attempts.size >= 4096)) throw new ApiError(429,'Too many attempts. Try again in a few minutes.');
  entry.count++;
  attempts.set(key, entry);
 }
 async function authenticate(request, signup, ip) {
  throttle(`ip:${ip}`,30);
  const body = await readJson(request,4096);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) throw new ApiError(400,'Use 3–32 letters, numbers or underscores for your username.');
  if (typeof password !== 'string' || [...password].length < (signup ? 8 : 1)) throw new ApiError(400,signup ? 'Use a password of at least 8 characters.' : 'Enter your password.');
  throttle(`user:${username.toLowerCase()}`,15);
  const existing = db.prepare('SELECT * FROM accounts WHERE username=?').get(username);
  const salt = existing?.salt ?? randomBytes(16).toString('hex');
  if (hashesInFlight >= 2) throw new ApiError(429,'Sign-in is busy. Try again shortly.');
  hashesInFlight++;
  let hash;
  try {hash = await hashPassword(password,Buffer.from(salt,'hex'),64,{N:2**17,r:8,p:1,maxmem:160*1024*1024});}
  finally {hashesInFlight--;}
  let account = existing;
  if (signup) {
   account = {id:randomUUID(),username};
   const result = db.prepare('INSERT INTO accounts VALUES (?,?,?,?) ON CONFLICT(username) DO NOTHING').run(account.id,username,salt,hash.toString('hex'));
   if (!result.changes) throw new ApiError(409,'That username is already taken.');
  } else if (!existing || !timingSafeEqual(hash,Buffer.from(existing.password_hash,'hex'))) {
   throw new ApiError(401,'Incorrect username or password.');
  }
  const previous = getToken(request);
  const session = randomBytes(32).toString('base64url');
  if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(previous));
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(session),account.id,Date.now()+sessionAge*1000);
  return json(signup ? 201 : 200,{username:account.username},{'Set-Cookie':cookie(session,sessionAge)});
 }

 async function save(request, account, id) {
  const data = await readJson(request,projectLimit);
  let project;
  try {project = validateProject(data?.project);}
  catch (error) {throw new ApiError(400,error.message);}
  const body = JSON.stringify(project), bytes = Buffer.byteLength(body);
  if (bytes > projectLimit) throw new ApiError(413,'Project limit is 20 MiB. Use local export for larger projects.');
  const current = id && db.prepare('SELECT revision,bytes FROM projects WHERE id=? AND account_id=?').get(id,account.id);
  if (id && !current) throw new ApiError(404,'Project not found.');
  if (current && data.revision !== current.revision) throw new ApiError(409,'This project changed in another tab or device. Reopen it or save this layout as a copy.');
  const usage = db.prepare('SELECT count(*) AS count, coalesce(sum(bytes),0) AS bytes FROM projects WHERE account_id=?').get(account.id);
  if ((!current && usage.count >= 30) || usage.bytes-(current?.bytes ?? 0)+bytes > accountLimit) throw new ApiError(413,'Account storage is full. Download and remove older projects to free space.');
  const updatedAt = new Date().toISOString(), revision = (current?.revision ?? 0)+1;
  if (current) db.prepare('UPDATE projects SET name=?, body=?, bytes=?, updated_at=?, revision=? WHERE id=? AND account_id=?').run(project.name,body,bytes,updatedAt,revision,id,account.id);
  else {
   id = randomUUID();
   db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?)').run(id,account.id,project.name,body,bytes,updatedAt,revision);
  }
  return json(current ? 200 : 201,{id,name:project.name,updatedAt,revision});
 }

 async function handle(request, ip = 'local') {
  try {
   const path = new URL(request.url).pathname, method = request.method;
   if (!['GET','HEAD'].includes(method) && request.headers.get('origin') !== origin) throw new ApiError(403,'Open the workbench from its own address.');
   if (path === '/api/signup' && method === 'POST') return await authenticate(request,true,ip);
   if (path === '/api/login' && method === 'POST') return await authenticate(request,false,ip);
   const token = getToken(request), account = getAccount(token);
   if (path === '/api/session' && method === 'GET') return json(200,{username:account?.username ?? null});
   if (path === '/api/logout' && method === 'POST') {
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
    return json(200,{username:null},{'Set-Cookie':cookie('',0)});
   }
   if (!account) throw new ApiError(401,'Sign in to access your saved projects.');
   const expectedAccount = request.headers.get('x-workbench-account');
   if (expectedAccount && expectedAccount !== account.username) throw new ApiError(409,'Your signed-in account changed. Reopen My projects to continue.');
   if (path === '/api/projects') {
    if (method === 'GET') return json(200,{projects:db.prepare('SELECT id,name,updated_at AS updatedAt,revision FROM projects WHERE account_id=? ORDER BY updated_at DESC,id').all(account.id)});
    if (method === 'POST') return await save(request,account);
   }
   const id = path.match(/^\/api\/projects\/([a-f0-9-]{36})$/)?.[1];
   if (id) {
    if (method === 'PUT') return await save(request,account,id);
    if (method === 'DELETE') {
     if (!db.prepare('DELETE FROM projects WHERE id=? AND account_id=?').run(id,account.id).changes) throw new ApiError(404,'Project not found.');
     return json(200,{deleted:true});
    }
    if (method === 'GET') {
     const p = db.prepare('SELECT id,name,body,updated_at AS updatedAt,revision FROM projects WHERE id=? AND account_id=?').get(id,account.id);
     if (!p) throw new ApiError(404,'Project not found.');
     const {body,...details} = p;
     return json(200,{...details,project:JSON.parse(body)});
    }
   }
   throw new ApiError(404,'Page not found.');
  } catch (error) {
   if (error instanceof ApiError) return json(error.status,{error:error.message});
   console.error('Account API request failed:',error.code ?? error.name);
   return json(500,{error:'Unable to complete the request. Try again.'});
  }
 }
 return {handle,close:()=>db.close()};
}
