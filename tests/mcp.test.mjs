import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import * as W from '../mcp/workbench.mjs';
import {traceGaussian} from '../src/optics.mjs';
import {rotateXZ} from '../src/core.mjs';

const arr = j => Array.isArray(j) ? j : [j];
const lib = W.createLibrary(['default-components', 'lasers', 'lens', 'holder', 'optics-parts'].flatMap(f => arr(JSON.parse(fs.readFileSync(new URL(`../src/${f}.json`, import.meta.url), 'utf8')))));
const bench = () => {
 const p = W.emptyProject('Test');
 const r = W.buildPath(p, lib, {start:{component:'laser', x:-160.6, z:-50, direction:'right', optics:{wavelength:2.7}},
  steps:[{component:'lens', distance:50.6}, {component:'mirror', distance:150, turn:'right'}, {component:'mirror', distance:140, turn:'left'},
   {component:'parabolic-mirror', distance:125, turn:'left', optics:{focal:101.6}}, {component:'detector', distance:75}]});
 return {p, r};
};

test('a beam path puts every part on a holder at one beam height, aimed as on the demo bench', () => {
 const {p, r} = bench();
 assert.deepEqual(r.created.map(i => [i.id, i.angle]), [['laser-1', 0], ['lens-1', 0], ['mirror-1', 225], ['mirror-2', 45], ['parabolic-mirror-1', 180], ['detector-1', 0]]);
 assert.equal(p.items.filter(i => i.assetId === W.HOLDER).length, 6);
 for (const i of r.created) {
  assert.ok(i.mount, `${i.id} is on a holder`);
  assert.ok(Math.abs(W.opticalPoint(p, i, lib).world.y - W.DEFAULT_BEAM_HEIGHT) < 1e-6, `${i.id} sits at the beam height`);
 }
 const det = W.opticalPoint(p, W.findItem(p, 'detector-1'), lib).world;
 assert.ok(Math.abs(det.x - 165) < 1e-6 && Math.abs(det.z - 15) < 1e-6);
 const t = traceGaussian(p.beams[0], p.items, W.assetOf(lib), p.beams);
 assert.ok(t.ok);
 assert.equal(t.points.length, 6);
 assert.deepEqual(W.checks(p, lib), []);
 // The project is one the app accepts, with the models it needs.
 assert.doesNotThrow(() => W.checkProject(W.projectFile(p, lib), lib));
});

// Where a mesh part sits on the board, from its bounding-box centre in the part's own frame.
const meshCentre = (item, meshes) => {
 const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
 for (const m of meshes) for (let n = 0; n < m.positions.length; n += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.positions[n + k]); mx[k] = Math.max(mx[k], m.positions[n + k]); }
 const c = mn.map((v, k) => (v + mx[k]) / 2), o = rotateXZ(c[0], c[2], item.angle);
 return [item.x + o.x, item.z + o.z];
};
const unit = ([x, z]) => { const n = Math.hypot(x, z); return [x / n, z / n]; };

test('mirrors meet the beam on their reflecting surface, with the mount behind it', () => {
 const {p, r} = bench();
 const pts = r.created.map(i => { const w = W.opticalPoint(p, i, lib).world; return [w.x, w.z]; });
 for (const [k, item] of r.created.entries()) {
  const asset = lib.byId.get(item.assetId);
  const surface = asset.meshes.filter(m => m.opticalDisc || m.name === 'ParabolicMirror');
  if (!/mirror/.test(item.assetId)) continue;
  const din = unit([pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]]), dout = unit([pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]]);
  const f = unit([dout[0] - din[0], dout[1] - din[1]]), b = pts[k];
  const rel = c => (c[0] - b[0]) * f[0] + (c[1] - b[1]) * f[1];
  const s = meshCentre(item, surface), knobs = meshCentre(item, asset.meshes.filter(m => ['Part 25', 'Part 26', 'Part 27'].includes(m.name)));
  assert.ok(Math.hypot(s[0] - b[0], s[1] - b[1]) < 4, `${item.id}: the beam lands on the reflecting surface`);
  assert.ok(Math.abs(rel(s)) < 3, `${item.id}: the surface sits at the bounce point, not set back in the mount`);
  assert.ok(rel(knobs) < -15, `${item.id}: the adjusters are behind the mirror`);
 }
});

test('setups made before the mirror fix get their mirrors turned round, with the same beam', () => {
 const {p} = bench();
 const mirrors = p.items.filter(i => /mirror/.test(i.mcpPart || ''));
 const was = new Map(mirrors.map(i => [i.id, {angle:i.angle, at:W.opticalPoint(p, i, lib).world}]));
 // Undo the fix: the old data turned flat mirrors 180° and parabolic ones 45°, with the beam on the mount origin.
 for (const i of mirrors) {
  const old = i.mcpPart === 'parabolic-mirror' ? i.angle + 315 : i.angle - 180, at = was.get(i.id).at;
  W.setAngle(p, lib, i, old);
  const pt = W.PARTS[i.mcpPart].point, o = rotateXZ(pt.x, pt.z, i.angle);
  W.moveTo(p, lib, i, at.x + o.x, at.z + o.z);
  for (const q of p.beams[0].points) if (q.itemId === i.id) Object.assign(q, {x:0, y:26, z:0});
 }
 const trace = () => traceGaussian(p.beams[0], p.items, W.assetOf(lib), p.beams);
 const before = trace();
 assert.deepEqual(W.repairOldMirrors(p, lib).map(i => i.id).sort(), [...was.keys()].sort());
 for (const i of mirrors) {
  assert.equal(i.angle, was.get(i.id).angle, `${i.id} is turned back`);
  const at = W.opticalPoint(p, i, lib).world, w = was.get(i.id).at;
  assert.ok(Math.hypot(at.x - w.x, at.z - w.z) < 1e-6, `${i.id} keeps its bounce point`);
 }
 const legs = t => t.points.map(q => [q.world[0], q.world[2], q.d, q.powerOut].map(v => +v.toFixed(6)));
 assert.ok(before.ok && before.points.length === 6);
 assert.deepEqual(legs(trace()), legs(before), 'the beam is unchanged');
 assert.equal(W.repairOldMirrors(p, lib).length, 0, 'a second pass changes nothing');
 assert.deepEqual(W.checks(p, lib), []);
});

test('flat mirrors take the same angles as on the landing page bench', () => {
 // scripts/hero-scene.mjs: the beam travels left into M1 at -45°, turns to the front into M2 at 45°, then runs right.
 const p = W.emptyProject('Hero');
 const r = W.buildPath(p, lib, {start:{component:'laser', x:150, z:-80, direction:'left'},
  steps:[{component:'mirror', distance:270, turn:'left'}, {component:'mirror', distance:165, turn:'left'}, {component:'detector', distance:170}]});
 assert.deepEqual(r.created.filter(i => i.mcpPart === 'mirror').map(i => i.angle), [315, 45]);
});

test('a second beam from a splitter takes the arm the main beam does not', () => {
 const p = W.emptyProject('Split');
 W.buildPath(p, lib, {start:{component:'laser', x:-170, z:-75}, steps:[{component:'beam-splitter', distance:100, turn:'right', optics:{reflectance:30}}, {component:'detector', distance:100}]});
 const r = W.buildPath(p, lib, {start:{from:'beam-splitter-1'}, steps:[{component:'fibre-port', distance:80}]});
 const fib = W.opticalPoint(p, r.created[0], lib).world;
 assert.ok(Math.abs(fib.x - -70) < 1e-6 && Math.abs(fib.z - 5) < 1e-6, 'reflected arm runs to the front');
 const t = traceGaussian(p.beams[1], p.items, W.assetOf(lib), p.beams);
 assert.ok(t.ok);
 assert.ok(Math.abs(t.power.start - 3) < .05, `carries the reflected 30% of 10 mW (got ${t.power.start})`);
});

test('moving to the focus, editing and removing keep the setup valid', () => {
 const {p} = bench();
 const f = W.moveToFocus(p, lib, new Map(), W.findItem(p, 'detector-1'));
 assert.ok(f.ok);
 const t = traceGaussian(p.beams[0], p.items, W.assetOf(lib), p.beams);
 assert.ok(t.end.captured > .99);
 const lens = W.findItem(p, 'lens-1');
 W.setOptics(lens, lib.byId.get(lens.assetId), {focal:75, material:'CaF2', designWavelength:.588});
 assert.equal(lens.optics.focal, 75);
 assert.throws(() => W.setOptics(lens, lib.byId.get(lens.assetId), {focal:.1}), /Invalid optics/);
 W.moveTo(p, lib, lens, -100, -50);
 assert.ok(Math.abs(W.opticalPoint(p, lens, lib).world.x - -100) < 1e-6);
 const gone = W.removeItem(p, W.findItem(p, 'mirror-2'));
 assert.equal(gone.length, 2);
 assert.doesNotThrow(() => W.checkProject(W.projectFile(p, lib), lib));
});

test('checks flag a beam running through a part and parts off the board', () => {
 const p = W.emptyProject('Blocked');
 W.buildPath(p, lib, {start:{component:'laser', x:-150, z:0}, steps:[{component:'detector', distance:200}]});
 W.placePart(p, lib, 'lens', {x:-50, z:0, angle:90});
 W.placePart(p, lib, 'mirror', {x:225, z:140});
 const notes = W.checks(p, lib).join('\n');
 assert.match(notes, /runs through Lens 1/);
 assert.match(notes, /Mirror 1 .* edge of the board/);
});

test('the MCP server answers over stdio', async () => {
 const home = fs.mkdtempSync(path.join(os.tmpdir(), 'owb-mcp-'));
 const child = spawn(process.execPath, [new URL('../mcp/server.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')], {env:{...process.env, OPTICAL_WORKBENCH_HOME:home, OPTICAL_WORKBENCH_OPEN:'0', OPTICAL_WORKBENCH_PORT:'4290'}, stdio:['pipe', 'pipe', 'ignore']});
 let buf = '';
 const replies = new Map();
 child.stdout.on('data', d => { buf += d; let n; while ((n = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, n)); buf = buf.slice(n + 1); replies.get(m.id)?.(m); } });
 let id = 0;
 const rpc = (method, params) => new Promise(r => { const i = ++id; replies.set(i, r); child.stdin.write(JSON.stringify({jsonrpc:'2.0', id:i, method, params}) + '\n'); });
 try {
  const init = await rpc('initialize', {protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'test', version:'1'}});
  assert.equal(init.result.serverInfo.name, 'optical-workbench');
  const tools = await rpc('tools/list', {});
  assert.ok(tools.result.tools.some(t => t.name === 'build_beam_path'));
  await rpc('tools/call', {name:'new_setup', arguments:{}});
  const built = await rpc('tools/call', {name:'build_beam_path', arguments:{start:{component:'laser', x:-150, z:0}, steps:[{component:'lens', distance:60}, {component:'detector', distance:100}]}});
  assert.ok(!built.result.isError, built.result.content[0].text);
  assert.match(built.result.content[0].text, /Detector 1/);
  assert.ok(tools.result.tools.some(t => t.name === 'optimize_setup'));
  const proposal = await rpc('tools/call', {name:'optimize_setup', arguments:{goal:'spot', apply:false}});
  assert.ok(!proposal.result.isError, proposal.result.content[0].text);
  assert.match(proposal.result.content[0].text, /goal "spot"/);
  const opt = await rpc('tools/call', {name:'optimize_setup', arguments:{goal:'power'}});
  assert.ok(!opt.result.isError, opt.result.content[0].text);
  assert.match(opt.result.content[0].text, /In short:/);
  const bad = await rpc('tools/call', {name:'edit_component', arguments:{id:'nope'}});
  assert.ok(bad.result.isError);
  const missing = await rpc('no/such/method', {});
  assert.equal(missing.error.code, -32601);
 } finally { child.stdin.end(); child.kill(); fs.rmSync(home, {recursive:true, force:true}); }
});
