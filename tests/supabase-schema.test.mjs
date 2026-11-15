import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

// Runs supabase/schema.sql in an in-process Postgres set up like Supabase
// (extensions schema, anon role, request headers) and calls it as anon.
test('Supabase schema keeps accounts private, enforces revisions and throttles sign-in', {timeout:120000}, async () => {
const sql = readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8');
const db = new PGlite({extensions: {pgcrypto}});
try {
await db.exec(`create schema extensions; create role anon nologin; create role authenticated nologin;
 grant usage on schema public, extensions to anon, authenticated;`);
await db.exec(sql);
await db.exec(sql); // must be re-runnable
await db.exec(`grant usage on schema extensions to anon;`);

const call = async (fn, args, ip = '203.0.113.7') => {
  const names = Object.keys(args), values = Object.values(args);
  const res = await db.transaction(async tx => {
    await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(ip ? {'cf-connecting-ip': ip} : {})]);
    await tx.exec('set local role anon');
    return tx.query(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(',')}) as r`, values);
  });
  return res.rows[0].r;
};

assert.deepEqual((await db.query(`select rolconfig from pg_roles where rolname='anon'`)).rows[0].rolconfig,['statement_timeout=60s']);
// anon cannot reach the private schema
await assert.rejects(db.transaction(async tx => {await tx.exec('set local role anon'); await tx.query('select * from workbench.accounts');}), /permission denied/);
await assert.rejects(db.transaction(async tx => {await tx.exec('set local role anon'); await tx.query(`select workbench.authenticate('x','y',true,null)`);}), /permission denied/);

assert.equal((await call('workbench_signup', {p_username: 'ab', p_password: 'eightabc'})).status, 400);
assert.equal((await call('workbench_signup', {p_username: 'Ada', p_password: 'seven77'})).status, 400);
const ada = await call('workbench_signup', {p_username: 'Ada', p_password: 'eightabc'});
assert.equal(ada.username, 'Ada');
assert.match(ada.token, /^[0-9a-f]{64}$/);
assert.equal((await call('workbench_signup', {p_username: 'ADA', p_password: 'eightabc'})).status, 409);
assert.equal((await call('workbench_login', {p_username: 'ada', p_password: 'wrongpass'})).status, 401);
assert.equal((await call('workbench_login', {p_username: 'nobody', p_password: 'wrongpass'})).status, 401);
const ben = await call('workbench_signup', {p_username: 'Ben', p_password: 'eightabc'});

assert.deepEqual(await call('workbench_session', {p_token: ada.token}), {username: 'Ada'});
assert.deepEqual(await call('workbench_session', {p_token: 'nope'}), {username: null});
assert.equal((await call('workbench_list_projects', {p_token: 'nope'})).status, 401);

const project = {format: 'optical-workbench', version: 2, name: 'First project', board: null, items: [], assets: []};
const created = await call('workbench_save_project', {p_token: ada.token, p_project: project});
assert.equal(created.revision, 1);
assert.equal(created.name, 'First project');
const list = await call('workbench_list_projects', {p_token: ada.token});
assert.equal(list.projects[0].id, created.id);
assert.deepEqual((await call('workbench_list_projects', {p_token: ben.token})).projects, []);
assert.equal((await call('workbench_list_projects', {p_token: ben.token, p_expected: 'Ada'})).status, 409);
assert.equal((await call('workbench_get_project', {p_token: ben.token, p_id: created.id})).status, 404);
assert.equal((await call('workbench_save_project', {p_token: ben.token, p_id: created.id, p_revision: 1, p_project: project})).status, 404);
assert.equal((await call('workbench_delete_project', {p_token: ben.token, p_id: created.id})).status, 404);
const updated = await call('workbench_save_project', {p_token: ada.token, p_id: created.id, p_revision: 1, p_project: {...project, name: 'Second version'}});
assert.equal(updated.revision, 2);
assert.equal((await call('workbench_save_project', {p_token: ada.token, p_id: created.id, p_revision: 1, p_project: project})).status, 409);
assert.equal((await call('workbench_save_project', {p_token: ada.token, p_project: {...project, version: 99}})).status, 400);
const got = await call('workbench_get_project', {p_token: ada.token, p_id: created.id});
assert.equal(got.project.name, 'Second version');
assert.equal(got.revision, 2);
assert.ok(!Number.isNaN(Date.parse(got.updatedAt)));

// second device, then sign-in replaces the previous token
const second = await call('workbench_login', {p_username: 'ada', p_password: 'eightabc', p_previous: ada.token});
assert.equal(second.username, 'Ada');
assert.deepEqual(await call('workbench_session', {p_token: ada.token}), {username: null});
assert.equal((await call('workbench_delete_project', {p_token: second.token, p_id: created.id})).deleted, true);
assert.equal((await call('workbench_get_project', {p_token: second.token, p_id: created.id})).status, 404);
await call('workbench_logout', {p_token: second.token});
assert.equal((await call('workbench_list_projects', {p_token: second.token})).status, 401);

// stored secrets are hashed
const row = (await db.query(`select password_hash from workbench.accounts where username='Ada'`)).rows[0];
assert.match(row.password_hash, /^\$2a\$10\$/);

// throttling survives failed attempts (15 per username, 30 per address)
let last;
for (let i = 0; i < 16; i++) last = await call('workbench_login', {p_username: 'Ben', p_password: 'wrongpass'}, '198.51.100.' + i);
assert.equal(last.status, 429);
for (let i = 0; i < 31; i++) last = await call('workbench_login', {p_username: 'user' + i, p_password: 'x'}, '192.0.2.1');
assert.equal(last.status, 429);
} finally {
 await db.close();
}
});
