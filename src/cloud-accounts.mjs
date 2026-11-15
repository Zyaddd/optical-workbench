// Account transport for the static edition: calls the workbench_* functions in
// supabase/schema.sql through the Supabase REST API. It takes the same
// (path, method, body, expected) calls as the account server and returns the
// same shapes, so the account dialog works with either backend.

const tokenKey = 'ow_cloud_session';

export class AccountError extends Error {
 constructor(status, message) { super(message); this.status = status; }
}

export function createCloudTransport({url, key, storage = globalThis.localStorage, fetch = globalThis.fetch?.bind(globalThis)}) {
 const base = String(url).replace(/\/+$/,'');
 const getToken = () => { try {return storage?.getItem(tokenKey) ?? null;} catch {return null;} };
 const setToken = token => { try {token ? storage?.setItem(tokenKey,token) : storage?.removeItem(tokenKey);} catch {} };

 async function rpc(name, args) {
  let response;
  try {
   response = await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',cache:'no-store',
    headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(args)});
  } catch {
   throw new AccountError(0,'Could not reach the account service. Check your internet connection and try again.');
  }
  let data = null;
  try {data = await response.json();} catch {}
  if (!response.ok) {
   if (response.status === 413) throw new AccountError(413,'This project is too large to save online. Use Download project instead.');
   if (response.status === 429) throw new AccountError(429,'Too many requests. Try again in a few minutes.');
   throw new AccountError(response.status,'The account service could not complete the request. Try again shortly.');
  }
  if (data?.error) throw new AccountError(data.status ?? 400,data.error);
  return data;
 }

 return async function transport(path, method = 'GET', body, expected) {
  const token = getToken();
  if (path === 'session') {
   if (!token) return {username:null};
   const session = await rpc('workbench_session',{p_token:token});
   if (!session.username) setToken(null);
   return {username:session.username};
  }
  if (path === 'signup' || path === 'login') {
   const session = await rpc(path === 'signup' ? 'workbench_signup' : 'workbench_login',{p_username:body?.username ?? '',p_password:body?.password ?? '',p_previous:token});
   setToken(session.token);
   return {username:session.username};
  }
  if (path === 'logout') {
   setToken(null);
   if (token) await rpc('workbench_logout',{p_token:token});
   return {username:null};
  }
  const p_expected = expected ?? null;
  if (path === 'projects') {
   if (method === 'GET') return rpc('workbench_list_projects',{p_token:token,p_expected});
   if (method === 'POST') return rpc('workbench_save_project',{p_token:token,p_project:body?.project,p_expected});
  }
  const id = path.match(/^projects\/([a-f0-9-]{36})$/)?.[1];
  if (id) {
   if (method === 'GET') return rpc('workbench_get_project',{p_token:token,p_id:id,p_expected});
   if (method === 'PUT') return rpc('workbench_save_project',{p_token:token,p_id:id,p_project:body?.project,p_revision:body?.revision ?? null,p_expected});
   if (method === 'DELETE') return rpc('workbench_delete_project',{p_token:token,p_id:id,p_expected});
  }
  throw new AccountError(404,'Page not found.');
 };
}
