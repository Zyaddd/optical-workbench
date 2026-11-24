// Lays the supplied NanoPlus ICL on its side so the two M4 mounting holes face the breadboard, as it
// is mounted in the lab: a 90° roll about the beam axis (+X) turns the holed side face (+Z) downwards
// and the DB9 connectors to the side. The mounting reference becomes the point between the two holes,
// so the laser centres on a post holder and its beam axis stays on +X. Run once.
import fs from 'node:fs';
import {restoreEditor, normalizeModel, applyQuaternion, multiplyQuaternion} from '../src/model.mjs';
const file = new URL('../src/lasers.json', import.meta.url);
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
const a = list.find(x => x.id === 'supplied-nanoplus');
if ((a.geometryRevision || 0) >= 2) { console.log('already holes-down'); process.exit(0); }
if ((a.geometryRevision || 0) !== 1) throw Error('Run nanoplus-upright.mjs first.');
// Hole centres on the +Z face of the upright model: the rim vertices of the two bores.
const body = a.meshes.reduce((m, n) => n.positions.length > m.positions.length && !n.name ? n : m);
const rim = [];
for (let i = 0; i < body.positions.length; i += 3) {
 const [x, y, z] = body.positions.slice(i, i + 3);
 if (Math.abs(z - 25) < 0.05 && Math.abs(y - 25) < 4 && Math.abs(Math.abs(x) - 10) < 4) rim.push([x, y, z]);
}
const holes = [-1, 1].map(s => { const p = rim.filter(p => Math.sign(p[0]) === s); return [0, 1, 2].map(k => p.reduce((t, q) => t + q[k], 0) / p.length); });
console.log('holes (upright frame)', holes.map(h => h.map(v => v.toFixed(2)).join(', ')));
const mid = [0, 1, 2].map(k => (holes[0][k] + holes[1][k]) / 2);
const s = Math.SQRT1_2, roll = [s, 0, 0, s];
const down = applyQuaternion([0, 0, 1], roll).map(v => Math.round(v));
if (down.join() !== '0,-1,0') throw Error('Unexpected rotation ' + down);
const {meshes, editor} = restoreEditor(a);
const q = multiplyQuaternion(roll, editor.orientation);
const settings = {up:editor.up, scale:editor.scale, ay:0, originMode:editor.originMode, orientation:q};
const trial = normalizeModel(meshes, {...settings, ax:0, az:0});
// Where the hole midpoint lands with no anchor offset, then centre the mounting reference on it.
const oriented = applyQuaternion([mid[0] + editor.origin.x + editor.anchor.x, mid[1] + editor.origin.y + editor.anchor.y, mid[2] + editor.origin.z + editor.anchor.z], roll);
const ax = +(oriented[0] - trial.origin.x).toFixed(4), az = +(oriented[2] - trial.origin.z).toFixed(4);
const n = normalizeModel(meshes, {...settings, ax, az});
a.meshes = a.meshes.map((m, k) => ({...m, positions:n.meshes[k].positions}));
a.editor = {...editor, origin:n.origin, anchor:n.anchor, orientation:n.orientation};
a.geometryRevision = 2;
a.anchorNote = 'Mounting reference: midway between the two M4 mounting holes, which face the breadboard.';
a.note = 'Supplied NanoPlus_Laser.STEP (interband cascade laser). Lies on its side with the two mounting holes facing the breadboard and the collimating lens facing +X; start beams on the lens.';
fs.writeFileSync(file, JSON.stringify(list));
console.log('size', n.size, 'origin', n.origin, 'anchor', n.anchor);
