// Builds src/optics-parts.json: procedural library parts for the optics model — a beam splitter plate,
// a window, a filter, a single-pass gas cell, a multipass (Herriott-type) cell and a fibre port.
// Like the library lens, each optical axis runs along local +x and optical centres sit 26 mm above the
// board, level with the mirrors and the lens. Run: node scripts/optics-assets.mjs
import {writeFileSync} from 'node:fs';

const CENTRE_Y = 26, SEG = 56;
// Revolve a closed [axial, radial] profile around an axis through `centre`.
function revolve(name, color, profile, axis, centre, extra = {}) {
 const positions = [], indices = [];
 const at = (a, r, t) => {
  const c = Math.cos(t) * r, s = Math.sin(t) * r;
  return axis === 'x' ? [centre[0] + a, centre[1] + c, centre[2] + s] : [centre[0] + c, centre[1] + a, centre[2] + s];
 };
 for (let e = 0; e < profile.length; e++) {
  const p = profile[e], q = profile[(e + 1) % profile.length], base = positions.length / 3;
  for (let j = 0; j <= SEG; j++) { const t = j / SEG * Math.PI * 2; positions.push(...at(p[0], p[1], t), ...at(q[0], q[1], t)); }
  for (let j = 0; j < SEG; j++) { const a = base + j * 2, b = a + 1, c = a + 2, d = a + 3; indices.push(a, c, b, b, c, d); }
 }
 return {name, color, positions:positions.map(v => +v.toFixed(4)), indices, ...extra};
}
const disc = (name, color, half, r, x = 0, extra = {}) => revolve(name, color, [[x - half, 0], [x + half, 0], [x + half, r], [x - half, r]], 'x', [0, CENTRE_Y, 0], extra);
const ring = (name, color, half, r0, r1, x = 0, extra = {}) => revolve(name, color, [[x - half, r0], [x + half, r0], [x + half, r1], [x - half, r1]], 'x', [0, CENTRE_Y, 0], extra);
const post = (x = 0, z = 0, top = CENTRE_Y - 15.5) => [
 revolve('Post', '#bcc3ca', [[4, 0], [4, 6.35], [top, 6.35], [top, 0]], 'y', [x, 0, z]),
 revolve('Post holder base', '#252a2e', [[0, 0], [0, 12.5], [4, 12.5], [4, 0]], 'y', [x, 0, z]),
];
const editor = {up:'y', scale:1, origin:{x:0, y:0, z:0}, anchor:{x:0, y:0, z:0}, originMode:'bounds', orientation:[0, 0, 0, 1]};
const part = (id, name, meshes, more = {}) => ({id, name, kind:'component', sourceFile:'Built in (procedural model)', protectedDefault:true, geometryRevision:1, meshes, editor,
 anchorNote:'Bottom-centre mounting reference. The optical centre is 26 mm above the board, level with the mirror centres; the beam runs along the part’s local X.', ...more});

const plateMount = (glassName, color, half) => [disc(glassName, color, half, 12.7, 0, {opticalDisc:true}), ring('Plate mount ring', '#252a2e', 3.5, 12.7, 16.5), ...post()];

// Gas cells: a transparent glass tube between metal end flanges, held at its centre by a clamp ring on a
// short post so the cell sits on one post holder. The tube stretches to the cell length set in Properties
// (cellSpec: everything within `core` of the centre scales, the flanged ends move rigidly), and the beam's
// path inside is drawn through the glass: one straight pass, or the bounce pattern of a multipass cell.
const GLASS = {glass:true};
const cellBody = (L, R, inlet) => [
 ring('Cell tube', '#cfe3ea', L / 2, R - 1.5, R, 0, GLASS),
 ring('Front flange', '#2d3338', 4, R - 2, R + 3, -L / 2), ring('Rear flange', '#2d3338', 4, R - 2, R + 3, L / 2),
 ring('Cell clamp', '#252a2e', 6, R, R + 3),
 revolve('Post', '#bcc3ca', [[0, 0], [0, 6.35], [CENTRE_Y - R - 2, 6.35], [CENTRE_Y - R - 2, 0]], 'y', [0, 0, 0]),
 revolve('Gas inlet', '#c9a34a', [[0, 0], [12, 0], [12, 3], [0, 3]], 'y', [-inlet, CENTRE_Y + R - 1, 0]),
 revolve('Gas outlet', '#c9a34a', [[0, 0], [12, 0], [12, 3], [0, 3]], 'y', [inlet, CENTRE_Y + R - 1, 0]),
];
const gasCell = [
 ...cellBody(100, 19, 30),
 disc('Entrance window', '#bfe0e8', 1.2, 17, -50, {opticalDisc:true, ...GLASS}), disc('Exit window', '#bfe0e8', 1.2, 17, 50, {opticalDisc:true, ...GLASS}),
];
// Multipass (Herriott-type) cell: concave gold mirrors inside both flanges; the beam enters and leaves
// through centre holes in the mirrors and bounces between them on a ring of spots.
const multipass = [
 ...cellBody(200, 24, 60),
 ring('Front mirror', '#d9b04a', 1.5, 3, 21, -96), ring('Rear mirror', '#d9b04a', 1.5, 3, 21, 96),
 disc('Entrance window', '#bfe0e8', 1.2, 22, -100, {opticalDisc:true, ...GLASS}), disc('Exit window', '#bfe0e8', 1.2, 22, 100, {opticalDisc:true, ...GLASS}),
];
// Fibre port: lens tube with the input aperture facing -x, an FC/PC connector and a fibre leaving along +x.
const fibre = [
 ring('Input aperture ring', '#2d3338', 1.5, 5, 15, -16),
 ring('Lens tube', '#1f2428', 15, 12, 15),
 disc('Coupling lens', '#d9a441', 1.2, 6, -12, {opticalDisc:true}),
 revolve('FC/PC connector', '#c9a34a', [[15, 0], [27, 0], [27, 5], [15, 5]], 'x', [0, CENTRE_Y, 0]),
 revolve('Fibre', '#f2c230', [[27, 0], [55, 0], [55, 1.6], [27, 1.6]], 'x', [0, CENTRE_Y, 0]),
 ...post(),
];

const assets = [
 part('default-beam-splitter', 'Beam splitter plate (Ø25.4 mm)', plateMount('Beam splitter coating', '#8ec3d8', 1.5), {hasOpticalDisc:true, defaultDiscOpacity:.45}),
 part('default-window', 'Window (Ø25.4 mm)', plateMount('Window', '#cfe6ee', 2.5), {hasOpticalDisc:true, defaultDiscOpacity:.3}),
 part('default-filter', 'Filter in mount (Ø25.4 mm)', plateMount('Filter glass', '#3f454c', 1.5), {hasOpticalDisc:true, defaultDiscOpacity:.75}),
 part('default-gas-cell', 'Gas cell (100 mm, single pass)', gasCell, {geometryRevision:2, cellSpec:{length:100, core:44, radius:17.5}, opticsDefaults:{type:'gascell', mode:'single', length:100}}),
 part('default-multipass-cell', 'Multipass cell (Herriott, 200 mm)', multipass, {geometryRevision:2, cellSpec:{length:200, core:94, radius:21}, opticsDefaults:{type:'gascell', mode:'multipass', length:200, passes:30, aperture:6}}),
 part('default-fibre-port', 'Fibre port (FC/PC)', fibre, {hasOpticalDisc:true, defaultDiscOpacity:.6}),
];
writeFileSync(new URL('../src/optics-parts.json', import.meta.url), JSON.stringify(assets));
console.log('src/optics-parts.json', assets.map(a => `${a.id} ${a.meshes.reduce((s, m) => s + m.indices.length / 3, 0)}`).join(', '));
