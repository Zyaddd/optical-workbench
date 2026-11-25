#!/usr/bin/env node
// Optical Workbench MCP server: lets Claude build optical setups from a conversation.
// Speaks MCP (JSON-RPC 2.0) over stdio, and serves a live 3D view of the setup at http://127.0.0.1:<port>/
// where the workbench follows every change as it happens (and sends the user's own edits back).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import defaultComponents from '../src/default-components.json' with {type:'json'};
import lasers from '../src/lasers.json' with {type:'json'};
import lens from '../src/lens.json' with {type:'json'};
import holder from '../src/holder.json' with {type:'json'};
import opticsParts from '../src/optics-parts.json' with {type:'json'};
import * as W from './workbench.mjs';

const VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.OPTICAL_WORKBENCH_HOME || path.join(os.homedir(), '.optical-workbench');
const STATE_FILE = path.join(HOME, 'mcp-setup.json');
const SAVE_DIR = process.env.OPTICAL_WORKBENCH_SAVE_DIR || path.join(os.homedir(), 'Documents', 'Optical Workbench');
const AUTO_OPEN = process.env.OPTICAL_WORKBENCH_OPEN !== '0';
const log = (...a) => process.stderr.write('[optical-workbench] ' + a.join(' ') + '\n');

const arr = j => Array.isArray(j) ? j : [j];
const lib = W.createLibrary([...defaultComponents, ...lasers, ...lens, ...arr(holder), ...opticsParts]);
const custom = new Map();

// ---------- Setup state ----------
let project = W.emptyProject(), rev = 1, history = [], savedPath = null;
try {
 const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
 for (const a of saved.custom || []) custom.set(a.id, a);
 project = W.checkProject({...saved.project, assets:saved.custom || []}, lib, custom);
 savedPath = saved.savedPath || null;
} catch (e) { if (e.code !== 'ENOENT') log('Starting a new setup:', e.message); }

function persist() {
 try {
  fs.mkdirSync(HOME, {recursive:true});
  fs.writeFileSync(STATE_FILE, JSON.stringify({project, custom:W.customAssets(project, lib, custom), savedPath}));
 } catch (e) { log('Could not keep the setup:', e.message); }
}
// Run a change on a copy; keep it only if the result is a valid project.
function change(fn) {
 const before = JSON.stringify(project), draft = JSON.parse(before);
 const result = fn(draft);
 const checked = W.checkProject({...draft, assets:W.customAssets(draft, lib, custom)}, lib, custom);
 history.push(before);
 if (history.length > 50) history.shift();
 project = checked;
 rev++;
 persist();
 broadcast();
 if (AUTO_OPEN && !opened && !clients.size) openBrowser();
 return result;
}

// ---------- Live view ----------
// The live view's key. Kept between sessions so an open workbench tab reconnects when Claude restarts the server.
const token = (() => {
 const file = path.join(HOME, 'live-key');
 try { const k = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{32}$/.test(k)) return k; } catch {}
 const k = crypto.randomBytes(16).toString('hex');
 try { fs.mkdirSync(HOME, {recursive:true}); fs.writeFileSync(file, k, {mode:0o600}); } catch {}
 return k;
})();
const clients = new Map(); // id → {res, applied}
const pendingCaptures = new Map();
let port = null, opened = false, clientSeq = 0;
function htmlPath() {
 for (const p of [process.env.OPTICAL_WORKBENCH_HTML, path.join(HERE, 'Optical_Workbench.html'), path.join(HERE, '..', 'dist', 'Optical_Workbench.html')]) if (p && fs.existsSync(p)) return p;
 return null;
}
const liveUrl = () => port ? `http://127.0.0.1:${port}/?live=${token}` : null;
function livePayload() { return {rev, project:{...project, assets:W.customAssets(project, lib, custom)}}; }
function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast() { const data = livePayload(); for (const c of clients.values()) send(c.res, 'state', data); }
function readBody(req, limit = 64 * 2 ** 20) {
 return new Promise((resolve, reject) => {
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > limit) { reject(Error('Too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
  req.on('error', reject);
 });
}
function json(res, code, data) { res.writeHead(code, {'content-type':'application/json', 'cache-control':'no-store'}); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
 const url = new URL(req.url, 'http://127.0.0.1');
 try {
  if (req.method === 'GET' && url.pathname === '/') {
   if (url.searchParams.get('live') !== token) { res.writeHead(302, {location:`/?live=${token}`}); return res.end(); }
   const file = htmlPath();
   if (!file) { res.writeHead(500, {'content-type':'text/plain'}); return res.end('The workbench page is missing. Run "npm run build" in the Optical Workbench folder.'); }
   res.writeHead(200, {'content-type':'text/html; charset=utf-8', 'cache-control':'no-store'});
   return fs.createReadStream(file).pipe(res);
  }
  if (url.searchParams.get('token') !== token) return json(res, 403, {error:'Wrong live-view token.'});
  if (req.method === 'GET' && url.pathname === '/live/events') {
   res.writeHead(200, {'content-type':'text/event-stream', 'cache-control':'no-store', connection:'keep-alive'});
   const id = String(++clientSeq);
   clients.set(id, {res, applied:0, at:Date.now()});
   send(res, 'hello', {client:id});
   send(res, 'state', livePayload());
   const ping = setInterval(() => res.write(': ping\n\n'), 20000);
   req.on('close', () => { clearInterval(ping); clients.delete(id); });
   return;
  }
  if (req.method === 'POST' && url.pathname === '/live/ack') {
   const body = await readBody(req), c = clients.get(String(body.client));
   if (c && Number.isFinite(body.rev)) c.applied = Math.max(c.applied, body.rev);
   return json(res, 200, {ok:true});
  }
  if (req.method === 'POST' && url.pathname === '/live/state') {
   const body = await readBody(req);
   if (body.baseRev !== rev) return json(res, 409, livePayload());
   try {
    const next = W.checkProject(body.project, lib, custom);
    // Keep the server's part keys for items the user did not replace.
    for (const i of next.items) { const old = project.items.find(o => o.id === i.id && o.assetId === i.assetId); if (old?.mcpPart) i.mcpPart = old.mcpPart; }
    if (JSON.stringify(next) === JSON.stringify(project)) return json(res, 200, {rev});
    history.push(JSON.stringify(project));
    if (history.length > 50) history.shift();
    project = next; rev++; persist();
    const c = clients.get(String(body.client));
    if (c) c.applied = rev;
    for (const [id, other] of clients) if (id !== String(body.client)) send(other.res, 'state', livePayload());
    return json(res, 200, {rev});
   } catch (e) { return json(res, 400, {error:e.message}); }
  }
  if (req.method === 'POST' && url.pathname === '/live/capture') {
   const body = await readBody(req), wait = pendingCaptures.get(body.id);
   if (wait) { pendingCaptures.delete(body.id); body.error ? wait.reject(Error(body.error)) : wait.resolve(body.image); }
   return json(res, 200, {ok:true});
  }
  json(res, 404, {error:'Not found'});
 } catch (e) { json(res, 400, {error:e.message}); }
});
function listen(p, tries = 20) {
 return new Promise(resolve => {
  const failed = e => {
   server.off('listening', done);
   if (e.code === 'EADDRINUSE' && tries > 1) resolve(listen(p + 1, tries - 1)); else { log('Live view unavailable:', e.message); resolve(null); }
  };
  const done = () => { server.off('error', failed); port = server.address().port; log('Live view at', liveUrl()); resolve(port); };
  server.once('error', failed);
  server.once('listening', done);
  server.listen(p, '127.0.0.1');
 });
}
const ready = listen(Number(process.env.OPTICAL_WORKBENCH_PORT) || 4180);
function openBrowser() {
 const url = liveUrl();
 if (!url) return false;
 opened = true;
 const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
 try { spawn(cmd, args, {detached:true, stdio:'ignore', windowsHide:true}).unref(); return true; } catch (e) { log('Could not open a browser:', e.message); return false; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function capture(view) {
 await ready;
 if (!liveUrl()) throw Error('The live view is not running, so there is no picture.');
 if (!htmlPath()) throw Error('The workbench page is missing. Run "npm run build" in the Optical Workbench folder.');
 if (!clients.size) openBrowser();
 const until = Date.now() + 60000;
 let target;
 while (Date.now() < until) {
  target = [...clients.entries()].filter(([, c]) => c.applied >= rev).sort((a, b) => b[1].at - a[1].at)[0];
  if (target) break;
  await sleep(250);
 }
 if (!target) throw Error(`No workbench window has caught up. Open ${liveUrl()} in a browser and try again.`);
 const id = crypto.randomUUID();
 const image = new Promise((resolve, reject) => { pendingCaptures.set(id, {resolve, reject}); setTimeout(() => { if (pendingCaptures.delete(id)) reject(Error('The workbench window did not answer.')); }, 20000); });
 send(target[1].res, 'capture', {id, view});
 return image;
}

// ---------- Tools ----------
const DIR = {description:'Compass direction on the board seen from above: degrees (0 = +x/right, 90 = back, 180 = left, 270 = front) or right, back, left, front.', anyOf:[{type:'number'}, {type:'string'}]};
const OPTICS = {type:'object', description:'Optical settings for this part (see list_components), e.g. {"focal": 50, "material": "CaF2"}.', additionalProperties:true};
const STEP = {type:'object', properties:{
 component:{type:'string', description:'Library key from list_components, or "endpoint" for a free end point with no part.'},
 existing:{type:'string', description:'Instead of a new part: the id of a part already on the board. The beam goes to its optical point and the part is turned to suit, unless aim is false.'},
 distance:{type:'number', description:'mm along the beam from the previous optical point (centre to centre).'},
 x:{type:'number', description:'Instead of distance: the optical point x in mm.'},
 z:{type:'number', description:'Instead of distance: the optical point z in mm.'},
 turn:{description:'Mirrors: where the beam goes next: left, right (90° turns) or signed degrees, positive = anticlockwise seen from above. Beam splitters: the side of the reflected arm (default left).', anyOf:[{type:'number'}, {type:'string'}]},
 follow:{type:'string', enum:['transmitted', 'reflected'], description:'Beam splitters: which arm this beam continues along (default transmitted). Start a second beam from the splitter for the other arm.'},
 name:{type:'string'}, optics:OPTICS,
 holder:{type:'boolean', description:'Mount on an adjustable post holder (default true).'},
 aim:{type:'boolean', description:'For existing parts: turn the part to suit the beam (default true).'},
}};
const TOOLS = [
 {name:'list_components', description:'The parts you can place, their sizes and every optical setting with its units. Call this first when planning a setup.', inputSchema:{type:'object', properties:{}}},
 {name:'new_setup', description:'Start an empty setup on a breadboard. Replaces the current setup (undo can bring it back).',
  inputSchema:{type:'object', properties:{name:{type:'string'}, board:{description:'MB1218 (default, 457.2 × 304.8 mm), a preset id from list_components, or {width, depth, pitch} in mm.', anyOf:[{type:'string'}, {type:'object'}]},
   beam_height:{type:'number', description:'Height of the beam above the board in mm (default 76, the standard post holders).'}}}},
 {name:'get_setup', description:'The current setup: board, every part with its id, optical point, orientation, holder and optical settings, and the beams. Also shows changes the user made in the workbench.', inputSchema:{type:'object', properties:{}}},
 {name:'build_beam_path', description:'Lay out a beam path in one go: starts at a new laser (or an existing laser or beam splitter), then places each part at the given distance along the beam, turns at mirrors, mounts every part on a post holder at the beam height, aims each part, and draws a physical beam through them. Returns the trace (beam size, focus, power) and any collisions. For a beam splitter\'s second arm, call it again with start.from = the splitter id.',
  inputSchema:{type:'object', required:['start', 'steps'], properties:{
   start:{type:'object', description:'Either a new laser {component, x, z, direction, optics, name} with x, z the emission point in mm, or {from: id} of a laser or beam splitter on the board.', properties:{component:{type:'string'}, x:{type:'number'}, z:{type:'number'}, direction:DIR, optics:OPTICS, name:{type:'string'}, from:{type:'string'}, holder:{type:'boolean'}}},
   steps:{type:'array', items:STEP, minItems:1},
   name:{type:'string', description:'Beam name.'}, color:{type:'string', description:'Beam colour as #rrggbb.'}}}},
 {name:'add_component', description:'Place one part with its optical point at (x, z), on a post holder at the beam height. Give direction for lasers (emission), lenses, windows, filters, cells, fibre ports and detectors (the way the beam travels through), or facing for mirrors and beam splitters (the way the reflecting face points). Does not draw a beam: use add_beam or build_beam_path.',
  inputSchema:{type:'object', required:['component', 'x', 'z'], properties:{component:{type:'string'}, x:{type:'number'}, z:{type:'number'}, direction:DIR, facing:DIR, angle:{type:'number', description:'Raw item rotation in degrees, as the app shows it (overrides direction and facing).'}, name:{type:'string'}, optics:OPTICS, holder:{type:'boolean'}}}},
 {name:'edit_component', description:'Change a part: move its optical point (x, z, or dx, dz), turn it (direction, facing or angle), rename it, change its optics settings, or lock it. Its holder moves with it and beams stay attached.',
  inputSchema:{type:'object', required:['id'], properties:{id:{type:'string', description:'Part id or exact name.'}, x:{type:'number'}, z:{type:'number'}, dx:{type:'number'}, dz:{type:'number'}, direction:DIR, facing:DIR, angle:{type:'number'}, name:{type:'string'}, optics:OPTICS, locked:{type:'boolean'}}}},
 {name:'remove_component', description:'Remove a part and its post holder. Beams that went through it keep a free point where it was.', inputSchema:{type:'object', required:['id'], properties:{id:{type:'string'}}}},
 {name:'add_beam', description:'Draw a physical beam through parts already on the board, in order (the first should be a laser or a beam splitter another beam passes through). Optionally ends at a free point. Does not move or turn anything.',
  inputSchema:{type:'object', required:['through'], properties:{through:{type:'array', items:{type:'string'}}, end:{type:'object', properties:{x:{type:'number'}, z:{type:'number'}}}, name:{type:'string'}, color:{type:'string'}}}},
 {name:'remove_beam', description:'Remove a beam (the parts stay).', inputSchema:{type:'object', required:['id'], properties:{id:{type:'string'}}}},
 {name:'analyze_setup', description:'Trace the physical beams: beam diameter at every part, focus positions and waist sizes, power after each loss, gas absorption, detector power and signal, fibre coupling, alignment sensitivity, and warnings; plus collision and board-edge checks.', inputSchema:{type:'object', properties:{beam:{type:'string', description:'Only this beam (id or name).'}}}},
 {name:'move_to_focus', description:'Slide the part at the end of a beam (detector, fibre port, pinhole) along the last leg to where the beam focuses.', inputSchema:{type:'object', required:['id'], properties:{id:{type:'string'}}}},
 {name:'view_workbench', description:'A picture of the setup as the workbench draws it in 3D. Opens the live workbench in the browser if it is not open yet.', inputSchema:{type:'object', properties:{view:{type:'string', enum:['iso', 'top', 'front', 'side', 'current'], description:'Camera: iso (default), top, front, side, or current to keep the user\'s view.'}}}},
 {name:'open_workbench', description:'Open the live 3D workbench in the browser. It follows every change Claude makes, and changes the user makes there come back to Claude.', inputSchema:{type:'object', properties:{}}},
 {name:'save_setup', description:'Save the setup as a .optics.json project file the Optical Workbench app opens.', inputSchema:{type:'object', properties:{path:{type:'string', description:'File path. Default: Documents/Optical Workbench/<setup name>.optics.json.'}}}},
 {name:'open_setup', description:'Load a .optics.json project file made in the app or saved earlier.', inputSchema:{type:'object', required:['path'], properties:{path:{type:'string'}}}},
 {name:'undo', description:'Undo the last change (Claude\'s or the user\'s in the workbench).', inputSchema:{type:'object', properties:{}}},
];

const text = s => ({content:[{type:'text', text:s}]});
function footer() {
 const notes = W.checks(project, lib, custom), lines = [];
 if (notes.length) lines.push('', 'Checks:', ...notes.map(n => '- ' + n));
 if (liveUrl()) lines.push('', clients.size ? `Live view: ${clients.size} workbench window${clients.size === 1 ? '' : 's'} showing this setup.` : `Live view: ${liveUrl()}`);
 return lines.join('\n');
}

async function callTool(name, args = {}) {
 switch (name) {
  case 'list_components': return text(W.catalogue(lib));
  case 'get_setup': return text(W.describe(project, lib, custom) + footer());
  case 'new_setup': {
   const board = W.boardFrom(args.board);
   change(p => { Object.assign(p, W.emptyProject(String(args.name || 'Untitled setup').slice(0, 100), board, Number.isFinite(args.beam_height) ? args.beam_height : W.DEFAULT_BEAM_HEIGHT)); });
   savedPath = null; persist();
   return text(`New setup "${project.name}" on ${board.name} (${board.width} × ${board.depth} mm). The board is centred on x = 0, z = 0: x runs from ${-board.width / 2} to ${board.width / 2} mm (left to right), z from ${-board.depth / 2} (back) to ${board.depth / 2} mm (front).` + footer());
  }
  case 'build_beam_path': {
   const r = change(p => {
    const out = W.buildPath(p, lib, {start:args.start, steps:args.steps, name:args.name, color:args.color});
    return {beam:out.beam.id, created:out.created.map(i => `${i.id} (${i.name})`), notes:out.notes};
   });
   return text([`Built ${r.beam}. New parts: ${r.created.join(', ') || 'none'}.`, ...r.notes, '', W.analyze(project, lib, custom, W.findBeam(project, r.beam))].join('\n') + footer());
  }
  case 'add_component': {
   const key = W.partKey(args.component);
   const id = change(p => {
    const angle = W.angleFrom(W.PARTS[key], args) ?? 0;
    return W.placePart(p, lib, key, {x:args.x, z:args.z, angle, name:args.name, optics:args.optics, holder:args.holder !== false}).id;
   });
   const i = W.findItem(project, id);
   return text(`Placed ${i.id} (${i.name}) at x ${args.x}, z ${args.z}, angle ${+i.angle.toFixed(2)}°.` + footer());
  }
  case 'edit_component': {
   const msg = change(p => {
    const i = W.findItem(p, args.id), done = [];
    if (args.name) { i.name = String(args.name).slice(0, 100); done.push('renamed'); }
    const angle = W.angleFrom(W.profileFor(i, lib), args);
    if (angle != null) { W.setAngle(p, lib, i, angle); done.push('turned'); }
    if ([args.x, args.z, args.dx, args.dz].some(Number.isFinite)) {
     const at = W.opticalPoint(p, i, lib).world;
     W.moveTo(p, lib, i, Number.isFinite(args.x) ? args.x : at.x + (args.dx || 0), Number.isFinite(args.z) ? args.z : at.z + (args.dz || 0));
     done.push('moved');
    }
    if (done.includes('moved') || done.includes('turned')) {
     const h = i.mount && p.items.find(x => x.id === i.mount.holderId);
     if (h) W.tidyHolders(p, lib, new Set([h.id]));
    }
    if (args.optics) { W.setOptics(i, lib.byId.get(i.assetId) || custom.get(i.assetId), args.optics); done.push('optics updated'); }
    if (typeof args.locked === 'boolean') { i.locked = args.locked; done.push(args.locked ? 'locked' : 'unlocked'); }
    if (!done.length) throw Error('Nothing to change: give x/z, dx/dz, direction, facing, angle, name, optics or locked.');
    return `${i.id}: ${done.join(', ')}.`;
   });
   return text(msg + '\n\n' + W.describe(project, lib, custom).split('\n').filter(l => l.startsWith(`- ${W.findItem(project, args.id).id}:`)).join('\n') + footer());
  }
  case 'remove_component': {
   const gone = change(p => W.removeItem(p, W.findItem(p, args.id)));
   return text(`Removed ${gone.join(', ')}.` + footer());
  }
  case 'add_beam': {
   const id = change(p => W.beamThrough(p, lib, args).id);
   return text(`Added ${id}.\n\n` + W.analyze(project, lib, custom, W.findBeam(project, id)) + footer());
  }
  case 'remove_beam': {
   const id = change(p => { const b = W.findBeam(p, args.id); p.beams = p.beams.filter(x => x !== b); return b.id; });
   return text(`Removed ${id}.` + footer());
  }
  case 'analyze_setup': return text(W.analyze(project, lib, custom, args.beam ? W.findBeam(project, args.beam) : null) + footer());
  case 'move_to_focus': {
   const f = change(p => {
    const i = W.findItem(p, args.id), out = W.moveToFocus(p, lib, custom, i), h = i.mount && p.items.find(x => x.id === i.mount.holderId);
    if (h) W.tidyHolders(p, lib, new Set([h.id]));
    return out;
   });
   return text(`Moved ${args.id} ${Math.hypot(f.move[0], f.move[2]).toFixed(1)} mm along the beam to the focus (waist Ø ${(f.diameter * 1000).toFixed(0)} µm).\n\n` + W.analyze(project, lib, custom) + footer());
  }
  case 'open_workbench': {
   await ready;
   if (!liveUrl()) return text('The live view could not start (no free port).');
   if (!htmlPath()) return text('The workbench page is missing. Run "npm run build" in the Optical Workbench folder.');
   openBrowser();
   return text(`Opened ${liveUrl()} in the browser. It follows this setup live.`);
  }
  case 'view_workbench': {
   const data = await capture(args.view || 'iso');
   const m = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(data || '');
   if (!m) throw Error('The workbench sent no picture.');
   return {content:[{type:'image', mimeType:m[1], data:m[2]}, {type:'text', text:`The workbench, ${args.view || 'iso'} view.`}]};
  }
  case 'save_setup': {
   const file = path.resolve(args.path || savedPath || path.join(SAVE_DIR, (project.name.replace(/[^\w .-]+/g, '_').trim() || 'setup') + '.optics.json'));
   const out = file.endsWith('.json') ? file : file + '.optics.json';
   fs.mkdirSync(path.dirname(out), {recursive:true});
   fs.writeFileSync(out, JSON.stringify(W.projectFile(project, lib, custom)));
   savedPath = out; persist();
   return text(`Saved ${out} (${(fs.statSync(out).size / 2 ** 20).toFixed(1)} MB, with the part models so the app opens it anywhere).`);
  }
  case 'open_setup': {
   const file = path.resolve(String(args.path || ''));
   const data = JSON.parse(fs.readFileSync(file, 'utf8'));
   change(p => {
    const next = W.checkProject(data, lib, custom);
    if (!data.beamHeight || data.beamHeight === 50) next.beamHeight = W.inferBeamHeight(next, lib);
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, next);
   });
   savedPath = file; persist();
   return text(`Opened ${file}.\n\n` + W.describe(project, lib, custom) + footer());
  }
  case 'undo': {
   if (!history.length) return text('Nothing to undo.');
   project = JSON.parse(history.pop()); rev++; persist(); broadcast();
   return text('Undone.\n\n' + W.describe(project, lib, custom) + footer());
  }
 }
 throw Error(`Unknown tool ${name}.`);
}

// ---------- MCP over stdio ----------
const INSTRUCTIONS = `Optical Workbench builds optical breadboard setups (lasers, lenses, mirrors, splitters, gas cells, detectors) and traces the beams physically (Gaussian beams with M², lens dispersion, power losses, gas absorption, detector signal).
Coordinates are mm on the breadboard seen from above: x to the right, z towards the front; the board is centred on (0, 0). Directions are compass angles: 0 = +x (right), 90 = back (−z), 180 = left, 270 = front (+z); turns are left (+90) or right (−90).
Positions name the optical point (where the beam meets the part). Every part goes on a post holder so all optical points share the beam height.
Usual flow: list_components → new_setup → build_beam_path (lays out a whole beam path from distances and turns) → analyze_setup → adjust with edit_component or move_to_focus → view_workbench to see it. The user watches a live 3D workbench in the browser and can edit there; call get_setup before editing if they may have changed something.`;

function reply(id, result) { process.stdout.write(JSON.stringify({jsonrpc:'2.0', id, result}) + '\n'); }
function fail(id, code, message) { process.stdout.write(JSON.stringify({jsonrpc:'2.0', id, error:{code, message}}) + '\n'); }
async function handle(msg) {
 const {id, method, params} = msg;
 const isRequest = id !== undefined && id !== null;
 try {
  if (method === 'initialize') {
   const asked = params?.protocolVersion, known = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
   return reply(id, {protocolVersion:known.includes(asked) ? asked : known[1], capabilities:{tools:{listChanged:false}}, serverInfo:{name:'optical-workbench', title:'Optical Workbench', version:VERSION}, instructions:INSTRUCTIONS});
  }
  if (method === 'ping') return isRequest && reply(id, {});
  if (method === 'tools/list') return reply(id, {tools:TOOLS});
  if (method === 'resources/list') return reply(id, {resources:[]});
  if (method === 'resources/templates/list') return reply(id, {resourceTemplates:[]});
  if (method === 'prompts/list') return reply(id, {prompts:[]});
  if (method === 'tools/call') {
   try { return reply(id, await callTool(params?.name, params?.arguments || {})); }
   catch (e) { return reply(id, {content:[{type:'text', text:e.message || String(e)}], isError:true}); }
  }
  if (!isRequest) return; // notifications (initialized, cancelled, ...)
  fail(id, -32601, `Method not found: ${method}`);
 } catch (e) { if (isRequest) fail(id, -32603, e.message); }
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
 buffer += chunk;
 let n;
 while ((n = buffer.indexOf('\n')) >= 0) {
  const line = buffer.slice(0, n).trim(); buffer = buffer.slice(n + 1);
  if (!line) continue;
  let msg;
  try { msg = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
 }
});
process.stdin.on('end', () => { server.close(); process.exit(0); });
