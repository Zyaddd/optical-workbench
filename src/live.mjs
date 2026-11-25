// Live link to the Optical Workbench MCP server (mcp/server.mjs). When the workbench is opened from that
// server (its address carries ?live=<token>), the setup follows every change Claude makes, the user's own
// edits go back to Claude, and Claude can ask for a picture of the 3D view. Without the token nothing runs.
export function mountLive({getState, applyRemote, customAssets, capture, toast, setLabel}) {
 const token = new URLSearchParams(location.search).get('live');
 if (!token || !/^[0-9a-f]{32}$/.test(token)) return null;
 const q = '?token=' + token;
 let rev = 0, client = null, applying = false, timer = null, last = '', joined = false;
 const post = (url, body) => fetch(url + q, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
 const events = new EventSource('/live/events' + q);
 events.addEventListener('hello', e => { client = JSON.parse(e.data).client; });
 events.addEventListener('state', e => { const m = JSON.parse(e.data); if (m.rev > rev) apply(m); });
 events.addEventListener('capture', async e => {
  const {id, view} = JSON.parse(e.data);
  try { await post('/live/capture', {id, image:await capture(view)}); }
  catch (err) { post('/live/capture', {id, error:err.message || String(err)}).catch(() => {}); }
 });
 events.onopen = () => {
  setLabel('Live with Claude');
  if (!joined) toast('Connected to Claude. This workbench shows the setup Claude is building, and your changes go back to Claude.');
  joined = true;
 };
 events.onerror = () => setLabel('Live link to Claude lost. Reconnecting…');
 function apply(m) {
  applying = true;
  try {
   applyRemote(m.project, rev === 0);
   rev = m.rev;
   last = JSON.stringify(getState());
  } catch (err) { toast('Could not show Claude’s change: ' + err.message); }
  finally { applying = false; }
  post('/live/ack', {client, rev}).catch(() => {});
 }
 async function push() {
  const state = getState(), json = JSON.stringify(state);
  if (json === last) return;
  last = json;
  try {
   const r = await post('/live/state', {client, baseRev:rev, project:{...state, assets:customAssets()}});
   if (r.status === 200) rev = (await r.json()).rev;
   else if (r.status === 409) { apply(await r.json()); toast('Claude changed the setup at the same moment, so the workbench now shows Claude’s version.'); }
   else toast('Claude could not take that change: ' + ((await r.json()).error || r.status));
  } catch { setLabel('Live link to Claude lost. Reconnecting…'); }
 }
 return {
  // Called after every committed change in the workbench.
  changed() { if (applying || !rev) return; clearTimeout(timer); timer = setTimeout(push, 400); },
 };
}
