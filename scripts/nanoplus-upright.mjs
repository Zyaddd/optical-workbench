// Stands the supplied NanoPlus ICL upright: its collimating lens faced the ceiling. A -90° turn about the
// horizontal X/Y-plane normal (app Z) points the lens along +X with the DB9 connectors on top. Run once.
import fs from 'node:fs';
import {restoreEditor, normalizeModel, applyQuaternion} from '../src/model.mjs';
const file = new URL('../src/lasers.json', import.meta.url);
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
const a = list.find(x => x.id === 'supplied-nanoplus');
if ((a.geometryRevision || 0) >= 1) { console.log('already upright'); process.exit(0); }
const s = Math.SQRT1_2, q = [0, 0, -s, s];
const up = applyQuaternion([0, 1, 0], q).map(v => Math.round(v));
if (up.join() !== '1,0,0') throw Error('Unexpected rotation ' + up);
const {meshes, editor} = restoreEditor(a);
const n = normalizeModel(meshes, {up:editor.up, scale:editor.scale, ax:editor.anchor.x, ay:editor.anchor.y, az:editor.anchor.z, originMode:editor.originMode, orientation:q});
a.meshes = a.meshes.map((m, k) => ({...m, positions:n.meshes[k].positions}));
a.editor = {...editor, origin:n.origin, orientation:n.orientation};
a.geometryRevision = 1;
a.note = 'Supplied NanoPlus_Laser.STEP (interband cascade laser). Stands upright with the collimating lens facing +X; start beams on the lens.';
fs.writeFileSync(file, JSON.stringify(list));
console.log('size', n.size, 'origin', n.origin);
