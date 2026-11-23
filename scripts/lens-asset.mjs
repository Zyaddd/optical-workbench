// Builds src/lens.json: a Ø25.4 mm lens in a black ring mount on a post, as a library component.
// The optical axis is local +x (like the flat mirror's normal) and the lens centre sits 26 mm above
// the board, the height of the library mirrors' centres. Run: node scripts/lens-asset.mjs
import {writeFileSync} from 'node:fs';

const CENTRE_Y = 26, SEG = 64;
// Revolve a closed profile of [axial, radial] points around an axis. Each profile edge gets its own
// vertex ring so edges stay crisp when the app computes normals.
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

// Biconvex glass: 5 mm thick at the centre, 2 mm at the edge.
const glass = [];
const R = 12.6, sag = r => 1 + 1.5 * (1 - (r / R) ** 2);
for (let k = 0; k <= 12; k++) { const r = R * k / 12; glass.push([-sag(r), r]); }
for (let k = 12; k >= 0; k--) { const r = R * k / 12; glass.push([sag(r), r]); }
glass.reverse();

const meshes = [
 revolve('Lens', '#d9a441', glass.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]), 'x', [0, CENTRE_Y, 0], {opticalDisc:true}),
 revolve('Lens mount ring', '#252a2e', [[-4.5, 12.7], [4.5, 12.7], [4.5, 16.5], [-4.5, 16.5]], 'x', [0, CENTRE_Y, 0]),
 revolve('Retaining ring', '#3a4047', [[2.6, 11.4], [4.5, 11.4], [4.5, 12.7], [2.6, 12.7]], 'x', [0, CENTRE_Y, 0]),
 revolve('Post', '#bcc3ca', [[4, 0], [4, 6.35], [CENTRE_Y - 15.5, 6.35], [CENTRE_Y - 15.5, 0]], 'y', [0, 0, 0]),
 revolve('Post holder base', '#252a2e', [[0, 0], [0, 12.5], [4, 12.5], [4, 0]], 'y', [0, 0, 0]),
];
const asset = {
 id:'default-lens', name:'Lens in mount (Ø25.4 mm)', kind:'component', sourceFile:'Built in (procedural model)',
 protectedDefault:true, hasOpticalDisc:true, defaultDiscOpacity:.55, geometryRevision:1, meshes,
 editor:{up:'y', scale:1, origin:{x:0, y:0, z:0}, anchor:{x:0, y:0, z:0}, originMode:'bounds', orientation:[0, 0, 0, 1]},
 anchorNote:'Bottom-centre mounting reference. The lens centre is 26 mm above the board, level with the mirror centres. The optical axis runs along the mount’s local X.',
};
writeFileSync(new URL('../src/lens.json', import.meta.url), JSON.stringify([asset]));
console.log('src/lens.json', meshes.reduce((s, m) => s + m.indices.length / 3, 0), 'triangles');
