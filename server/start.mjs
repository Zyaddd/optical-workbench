import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {mkdirSync, existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createAccounts} from './accounts.mjs';

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const origin = new URL(process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`).origin;
const databasePath = resolve(process.env.DATABASE_PATH || 'data/workbench.sqlite');
if (process.env.NODE_ENV === 'production' && (!origin.startsWith('https://') || !process.env.DATABASE_PATH)) {
 throw Error('Production requires an HTTPS PUBLIC_ORIGIN and a persistent DATABASE_PATH.');
}
if (!existsSync('dist/Account_Workbench.html')) throw Error('Run npm run build:accounts first.');
mkdirSync(dirname(databasePath),{recursive:true});
const accounts = createAccounts({databasePath,origin});
const files = new Map([
 ['/', ['Accounts.html','text/html; charset=utf-8']],
 ['/Account_Workbench.html', ['Account_Workbench.html','text/html; charset=utf-8']],
 ['/Optical_Workbench.html', ['Optical_Workbench.html','text/html; charset=utf-8']],
 ['/Example.optics.json', ['Example.optics.json','application/json']],
 ['/hero-scene.bin', ['hero-scene.bin','application/octet-stream']],
 ...['SOURCE_NOTICES.md','THIRD_PARTY_LICENSES.txt','license.occt.txt','license.occt-import-js.txt'].map(name=>['/'+name,[name,'text/plain; charset=utf-8']]),
]);
const server = createServer(async (incoming,outgoing)=>{
 outgoing.setHeader('X-Content-Type-Options','nosniff');
 outgoing.setHeader('Referrer-Policy','no-referrer');
 outgoing.setHeader('X-Frame-Options','DENY');
 outgoing.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if (origin.startsWith('https://')) outgoing.setHeader('Strict-Transport-Security','max-age=31536000');
 try {
  const path = new URL(incoming.url,origin).pathname;
  if (path.startsWith('/api/')) {
   const method = incoming.method;
   const request = new Request(new URL(path,origin),{method,headers:incoming.headers,...(['GET','HEAD'].includes(method)?{}:{body:Readable.toWeb(incoming),duplex:'half'})});
   const result = await accounts.handle(request,incoming.socket.remoteAddress);
   outgoing.writeHead(result.status,Object.fromEntries(result.headers));
   if (result.body) Readable.fromWeb(result.body).pipe(outgoing);
   else outgoing.end();
   return;
  }
  const file = files.get(path);
  if (!file || !['GET','HEAD'].includes(incoming.method)) {outgoing.writeHead(404);outgoing.end('Page not found');return;}
  const data = await readFile(resolve('dist',file[0]));
  outgoing.writeHead(200,{'Content-Type':file[1],'Content-Length':data.length,'Cache-Control':'no-cache'});
  outgoing.end(incoming.method === 'HEAD' ? undefined : data);
 } catch {
  if (outgoing.headersSent) outgoing.destroy();
  else {outgoing.writeHead(500);outgoing.end('Unable to complete the request.');}
 }
});
server.requestTimeout = 60_000;
server.headersTimeout = 15_000;
server.listen(port,host,()=>console.log(`Optical Workbench is listening on ${host}:${port}`));
for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>server.close(()=>accounts.close()));
