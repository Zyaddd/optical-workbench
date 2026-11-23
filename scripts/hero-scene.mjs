// Builds web/hero-scene.bin: the real library parts for the landing page's 3D bench,
// placed exactly the way the workbench places them (normalised mesh, lifted onto the board,
// rotated about Y, moved to x/z), with the beam aimed through each mirror's optical centre.
// Run: node scripts/hero-scene.mjs
import {readFileSync, writeFileSync} from 'node:fs';
import {colourSegments, supportLift} from '../src/model.mjs';

const load = n => JSON.parse(readFileSync(new URL(`../src/${n}.json`, import.meta.url)));
const library = new Map([...load('lasers'), ...load('default-components')].map(a => [a.id, a]));
const asset = id => library.get(id);

const rotY = ([x, y, z], deg) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [x * c + z * s, y, -x * s + z * c]; };
const place = (p, item) => { const [x, y, z] = rotY(p, item.angle); return [x + item.x, y + item.lift + item.y, z + item.z]; };
function localDiscCentre(a) {
 const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
 for (const m of a.meshes.filter(m => m.opticalDisc)) for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.positions[i + k]); mx[k] = Math.max(mx[k], m.positions[i + k]); }
 return mn.map((v, k) => (v + mx[k]) / 2);
}

// Layout: laser → M1 → M2 → detector, a folded "U" on a Thorlabs MB1218 (457.2 × 304.8 mm).
const mirror = asset('default-flat-mirror'), disc = localDiscCentre(mirror);
const M1 = {id:'m1', assetId:'default-flat-mirror', x:-120, z:-80, angle:-45, y:0};
const M2 = {id:'m2', assetId:'default-flat-mirror', x:0, z:85, angle:45, y:0};
for (const m of [M1, M2]) m.lift = supportLift(asset(m.assetId).meshes);
const c1 = place(disc, M1);
M2.x += c1[0] - place(disc, M2)[0];            // M1 → M2 runs straight along +z
const c2 = place(disc, M2);
const beamY = c1[1];
const QCL = {id:'laser', assetId:'supplied-alpes-hhl-qcl', angle:-90, y:16, riser:{w:56, d:62, h:16}};
const DET = {id:'detector', assetId:'default-vigo-detector', angle:-90, y:6, riser:{w:52, d:96, h:6}};
for (const i of [QCL, DET]) i.lift = supportLift(asset(i.assetId).meshes);
QCL.x = 150; QCL.z = c1[2];                   // laser fires along -x into M1
DET.x = 170; DET.z = c2[2];                   // M2 sends the beam along +x into the detector window
const items = [QCL, M1, M2, DET];

// Where the beam starts and ends: laser front face (local +z) and detector window (local +z).
const box = a => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const m of a.meshes) for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.positions[i + k]); mx[k] = Math.max(mx[k], m.positions[i + k]); } return {mn, mx}; };
const qb = box(asset(QCL.assetId)), db = box(asset(DET.assetId));
const start = place([0, beamY - QCL.lift - QCL.y, qb.mx[2]], QCL);
const end = place([0, beamY - DET.lift - DET.y, db.mx[2]], DET);
const beam = [start, c1, c2, end].map(p => p.map(v => +v.toFixed(2)));

// Geometry: per item, one batch per (colour, optical disc), vertices transformed to world space.
const out = [], bounds = {mn:[Infinity, Infinity, Infinity], mx:[-Infinity, -Infinity, -Infinity]};
for (const item of items) {
 const a = asset(item.assetId), batches = new Map();
 for (const part of a.meshes) {
  for (const r of colourSegments(part)) {
   const key = JSON.stringify([r.color, !!part.opticalDisc]);
   if (!batches.has(key)) batches.set(key, {color:r.color, disc:!!part.opticalDisc, positions:[], indices:[], map:new Map()});
   const b = batches.get(key), remap = new Map();
   for (let n = r.first * 3; n < (r.last + 1) * 3; n++) {
    const v = part.indices[n];
    if (!remap.has(v)) {
     remap.set(v, b.positions.length / 3);
     const p = place([part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]], item);
     b.positions.push(...p);
     for (let k = 0; k < 3; k++) { bounds.mn[k] = Math.min(bounds.mn[k], p[k]); bounds.mx[k] = Math.max(bounds.mx[k], p[k]); }
    }
    b.indices.push(remap.get(v));
   }
  }
 }
 out.push({item, batches:[...batches.values()]});
}

// Pack: int16 positions over the scene bounds; uint16 or uint32 indices per batch.
const span = bounds.mx.map((v, k) => v - bounds.mn[k]);
const chunks = [], header = {version:1, bounds:{min:bounds.mn, max:bounds.mx}, beam, beamY:+beamY.toFixed(2), items:[]};
let offset = 0;
const push = buf => { const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; } const at = offset; chunks.push(buf); offset += buf.length; return at; };
for (const {item, batches} of out) {
 const entry = {id:item.id, assetId:item.assetId, name:asset(item.assetId).name, x:item.x, z:item.z, riser:item.riser ?? null, batches:[]};
 for (const b of batches) {
  const vcount = b.positions.length / 3, q = new Int16Array(b.positions.length);
  for (let i = 0; i < b.positions.length; i++) { const k = i % 3; q[i] = Math.round(((b.positions[i] - bounds.mn[k]) / span[k]) * 65534 - 32767); }
  const wide = vcount > 65535, idx = wide ? new Uint32Array(b.indices) : new Uint16Array(b.indices);
  const pos = push(Buffer.from(q.buffer)), ind = push(Buffer.from(idx.buffer));
  entry.batches.push({color:b.color, disc:b.disc, vertices:vcount, indices:b.indices.length, pos, ind, wide});
 }
 header.items.push(entry);
}
const json = Buffer.from(JSON.stringify(header));
const head = Buffer.alloc(8); head.write('OWH1', 0, 'ascii'); head.writeUInt32LE(json.length, 4);
const jsonPad = Buffer.alloc((4 - ((8 + json.length) % 4)) % 4);
const file = Buffer.concat([head, json, jsonPad, ...chunks]);
writeFileSync(new URL('../web/hero-scene.bin', import.meta.url), file);
const tris = header.items.reduce((s, i) => s + i.batches.reduce((t, b) => t + b.indices / 3, 0), 0);
console.log(`web/hero-scene.bin ${(file.length / 1e6).toFixed(2)} MB, ${tris} triangles, beam`, JSON.stringify(beam));
