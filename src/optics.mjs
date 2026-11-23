// Physical beam model: paraxial Gaussian beams (with M²) carried through thin lenses and focusing
// mirrors by ABCD matrices, using the complex beam parameter q. All lengths are mm, wavelengths µm.
// Pure functions only: the UI and the tests share this file.
import {localToWorld} from './planning.mjs';

// Refractive index n(λ) from published dispersion formulas (λ in µm), with each formula's valid range.
const sellmeier = terms => l => { const l2 = l * l; return Math.sqrt(1 + terms.reduce((s, [b, c]) => s + b * l2 / (l2 - c * c), 0)); };
export const MATERIALS = {
 ideal: {name:'Ideal thin lens (no dispersion)', range:[0, Infinity], n:() => 1.5},
 ZnSe: {name:'ZnSe', spec:10.6, range:[.54, 18.2], n:sellmeier([[4.45813734, .200859853], [.467216334, .391371166], [2.8956629, 47.1362108]])},
 CaF2: {name:'CaF₂', spec:.588, range:[.23, 9.7], n:sellmeier([[.5675888, .050263605], [.4710914, .1003909], [3.8484723, 34.64904]])},
 BaF2: {name:'BaF₂', spec:.588, range:[.27, 10.3], n:sellmeier([[.643356, .057789], [.506762, .10968], [3.8261, 46.3864]])},
 Ge: {name:'Germanium', spec:10.6, range:[2.5, 12], n:l => { const l2 = l * l; return Math.sqrt(9.28156 + 6.7288 * l2 / (l2 - .44105) + .21307 * l2 / (l2 - 3870.1)); }},
 Si: {name:'Silicon', spec:4, range:[1.36, 11], n:l => { const l2 = l * l, l1 = 1.1071 ** 2; return Math.sqrt(11.6858 + .939816 / l2 + .00810461 * l1 / (l2 - l1)); }},
 sapphire: {name:'Sapphire (o-ray)', spec:.588, range:[.2, 5.5], n:sellmeier([[1.4313493, .0726631], [.65054713, .1193242], [5.3414021, 18.028251]])},
 silica: {name:'Fused silica', spec:.588, range:[.21, 3.7], n:sellmeier([[.6961663, .0684043], [.4079426, .1162414], [.8974794, 9.896161]])},
 BK7: {name:'N-BK7', spec:.588, range:[.3, 2.5], n:l => { const l2 = l * l; return Math.sqrt(1 + 1.03961212 * l2 / (l2 - .00600069867) + .231792344 * l2 / (l2 - .0200179144) + 1.01046945 * l2 / (l2 - 103.560653)); }},
};
export function refractiveIndex(material, wavelength) {
 const m = MATERIALS[material];
 if (!m) throw Error('Unknown lens material.');
 return m.n(wavelength);
}
export const inRange = (material, wavelength) => { const r = MATERIALS[material]?.range; return !!r && wavelength >= r[0] && wavelength <= r[1]; };

// A lens is specified like a catalogue part: focal length at a design wavelength. At another wavelength the
// thin-lens power scales with (n − 1), which is why a mid-IR lens focuses at a different distance than its label.
export function effectiveFocal(o, wavelength) {
 if (o.type !== 'lens' || o.material === 'ideal' || !MATERIALS[o.material]) return o.focal;
 return o.focal * (refractiveIndex(o.material, o.designWavelength) - 1) / (refractiveIndex(o.material, wavelength) - 1);
}

export const LENS_PRESETS = [
 ...[25.4, 50, 75, 100, 150, 200].map(f => ({material:'ZnSe', focal:f, designWavelength:10.6})),
 ...[50, 75, 100, 150, 200].map(f => ({material:'CaF2', focal:f, designWavelength:.588})),
 ...[50, 100, 200].map(f => ({material:'BaF2', focal:f, designWavelength:.588})),
 ...[50, 100].map(f => ({material:'Ge', focal:f, designWavelength:10.6})),
 ...[50, 100].map(f => ({material:'Si', focal:f, designWavelength:4})),
 ...[50, 100, 200].map(f => ({material:'BK7', focal:f, designWavelength:.588})),
].map(p => ({...p, aperture:25.4, label:`${MATERIALS[p.material].name} plano-convex Ø25.4 mm · f ${p.focal} mm at ${p.designWavelength} µm`}));

export const OPTIC_TYPES = {
 none:'Not optical', laser:'Laser source', lens:'Lens', mirror:'Flat mirror', parabolic:'Focusing (parabolic) mirror', detector:'Detector',
};
const LASER = {type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, divergence:2.5, m2:1.3, waistOffset:0};
const DEFAULTS = {
 none:{type:'none'},
 laser:LASER,
 lens:{type:'lens', focal:100, material:'ZnSe', designWavelength:10.6, aperture:25.4},
 mirror:{type:'mirror', aperture:25.4},
 parabolic:{type:'parabolic', focal:50.8, offAxis:90, aperture:25.4},
 detector:{type:'detector', activeArea:1},
};
// What a part is, when the user has not said: by library id first, then by name.
export function defaultType(asset) {
 const id = asset?.id || '', name = (asset?.name || '') + ' ' + id;
 if (asset?.role === 'laser' || /laser|qcl|nanoplus/i.test(name)) return 'laser';
 if (/lens/i.test(name)) return 'lens';
 if (/parabol|oap/i.test(name)) return 'parabolic';
 if (/detector|vigo|photodiode/i.test(name)) return 'detector';
 if (/mirror/i.test(name)) return 'mirror';
 return 'none';
}
export const defaultOptics = type => structuredClone(DEFAULTS[type] || DEFAULTS.none);
// The optics of a placed item: saved settings over the defaults for its type (or for its asset).
export function itemOptics(item, asset) {
 const type = item?.optics?.type || defaultType(asset);
 return {...defaultOptics(type), ...(item?.optics?.type === type ? item.optics : {}), type};
}

const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
export function validateOptics(o) {
 if (o == null) return undefined;
 const bad = () => { throw Error('Invalid optical settings.'); };
 if (!o || typeof o !== 'object' || !(o.type in OPTIC_TYPES)) bad();
 const out = {type:o.type};
 const take = (k, lo, hi) => { if (o[k] == null) return; if (!num(o[k], lo, hi)) bad(); out[k] = o[k]; };
 if (o.type === 'laser') {
  take('wavelength', .2, 30); take('diameter', .001, 100); take('divergence', .001, 1500); take('m2', 1, 50); take('waistOffset', -10000, 10000);
  if (o.spec != null) { if (!['waist', 'divergence'].includes(o.spec)) bad(); out.spec = o.spec; }
 }
 if (o.type === 'lens' || o.type === 'parabolic') {
  take('focal', -10000, 10000); if (out.focal != null && Math.abs(out.focal) < .5) bad();
  take('aperture', .1, 1000);
 }
 if (o.type === 'lens') { take('designWavelength', .2, 30); if (o.material != null) { if (!(o.material in MATERIALS)) bad(); out.material = o.material; } }
 if (o.type === 'parabolic') take('offAxis', 0, 179);
 if (o.type === 'mirror') take('aperture', .1, 1000);
 if (o.type === 'detector') take('activeArea', .001, 100);
 return out;
}

// Laser source → embedded Gaussian: waist radius w0, Rayleigh range zR and half-angle divergence.
export function laserBeam(o) {
 const lambda = o.wavelength * 1e-3, m2 = o.m2;
 const w0 = o.spec === 'divergence' ? m2 * lambda / (Math.PI * (o.divergence * 1e-3 / 2)) : o.diameter / 2;
 const zR = Math.PI * w0 * w0 / (m2 * lambda), theta = m2 * lambda / (Math.PI * w0);
 return {lambda, m2, w0, zR, theta, waistDiameter:2 * w0, divergence:2 * theta * 1e3, waistOffset:o.waistOffset};
}

// Complex beam parameter helpers: q = [re, im]; at distance z after a waist, q = z + i·zR.
const inv = ([a, b]) => { const d = a * a + b * b; return [a / d, -b / d]; };
export function beamAtQ(q, beam) {
 const [re, im] = inv(q), w = Math.sqrt(-beam.m2 * beam.lambda / (Math.PI * im));
 return {d:2 * w, R:Math.abs(re) < 1e-12 ? Infinity : 1 / re, waistAhead:-q[0], waistDiameter:2 * Math.sqrt(q[1] * beam.m2 * beam.lambda / Math.PI), zR:q[1]};
}
export const thinLens = (q, f) => { const [a, b] = inv(q); return inv([a - 1 / f, b]); };

const sub = (a, b) => a.map((v, k) => v - b[k]);
const len = v => Math.hypot(...v);

// Trace a drawn beam route physically. Points attached to lenses or focusing mirrors apply their power;
// flat mirrors and other bounce points only fold the path. Returns per-segment q values for sampling.
export function traceGaussian(route, items, assetOf) {
 const find = id => items.find(i => i.id === id);
 const opticsAt = p => { const i = p.itemId && find(p.itemId); return i ? {item:i, optics:itemOptics(i, assetOf(i.assetId))} : {item:null, optics:{type:'none'}}; };
 const world = route.points.map(p => { const i = p.itemId && find(p.itemId); if (p.itemId && !i) return null; const w = i ? localToWorld(i, p) : p; return [w.x, w.y, w.z]; });
 if (world.some(w => !w)) return {ok:false, error:'A beam point lost its component.'};
 const warnings = [], start = opticsAt(route.points[0]);
 let laserOptics = start.optics;
 if (laserOptics.type !== 'laser') { laserOptics = defaultOptics('laser'); warnings.push('The start point is not on a laser, so a default 4.5 µm source is assumed. Start the beam on a laser to use its settings.'); }
 const beam = laserBeam(laserOptics);
 let q = [-beam.waistOffset, beam.zR], s = 0;
 const segments = [], points = [], waists = [];
 points.push({index:0, s:0, world:world[0], type:'laser', name:start.item?.name || 'Start', ...beamAtQ(q, beam)});
 for (let k = 1; k < world.length; k++) {
  const length = len(sub(world[k], world[k - 1]));
  if (length < 1e-6) continue;
  const seg = {index:k - 1, a:world[k - 1], b:world[k], s0:s, length, q0:q.slice()};
  segments.push(seg);
  const ahead = -q[0];
  if (ahead > 0 && ahead < length) {
   const t = ahead, frac = t / length;
   waists.push({segment:seg.index, s:s + t, t, world:seg.a.map((v, j) => v + (seg.b[j] - v) * frac), d:beamAtQ([0, q[1]], beam).d, zR:q[1], afterPoint:k - 1});
  }
  q = [q[0] + length, q[1]]; s += length;
  const here = opticsAt(route.points[k]), o = here.optics, last = k === world.length - 1;
  const info = {index:k, s, world:world[k], type:o.type, name:here.item?.name || (last ? 'Endpoint' : 'Waypoint'), ...beamAtQ(q, beam)};
  if (!last && (o.type === 'lens' || o.type === 'parabolic')) {
   const f = effectiveFocal(o, laserOptics.wavelength);
   if (o.type === 'lens' && o.material !== 'ideal' && !inRange(o.material, laserOptics.wavelength)) warnings.push(`${info.name}: ${MATERIALS[o.material].name} is outside its data range (${MATERIALS[o.material].range.join('–')} µm) at ${laserOptics.wavelength} µm and may not transmit.`);
   q = thinLens(q, f);
   const after = beamAtQ(q, beam);
   Object.assign(info, {f, focus:after.waistAhead, focusDiameter:after.waistDiameter, aperture:o.aperture});
  } else if (o.type === 'detector') info.activeArea = o.activeArea;
  else if (o.aperture) info.aperture = o.aperture;
  points.push(info);
 }
 for (const p of points) if (p.focus != null) {
  const next = points.find(n => n.index > p.index && n.f != null);
  p.focusReached = p.focus > 0 && (!next || p.s + p.focus < next.s);
 }
 return {ok:true, laser:{...laserOptics, ...beam}, warnings, segments, points, waists, total:s, end:points.at(-1)};
}

// Beam diameter and wavefront radius at path position s (mm from the laser).
export function beamAt(trace, s) {
 const seg = trace.segments.find(g => s >= g.s0 - 1e-9 && s <= g.s0 + g.length + 1e-9) || trace.segments.at(-1);
 const t = Math.max(0, Math.min(seg.length, s - seg.s0));
 return {segment:seg, t, ...beamAtQ([seg.q0[0] + t, seg.q0[1]], trace.laser)};
}

// Diameter samples along each segment, dense around waists so the focus keeps its hourglass shape.
export function envelopeSamples(trace, count = 36) {
 return trace.segments.map(seg => {
  const ts = new Set();
  for (let k = 0; k <= count; k++) ts.add(seg.length * k / count);
  const ahead = -seg.q0[0], zR = seg.q0[1];
  if (ahead > 0 && ahead < seg.length) for (const m of [0, .35, .7, 1, 1.5, 2.2, 3.2, 5, 8]) for (const sign of [-1, 1]) { const t = ahead + sign * m * zR; if (t > 0 && t < seg.length) ts.add(t); }
  const samples = [...ts].sort((a, b) => a - b).map(t => ({t, d:beamAtQ([seg.q0[0] + t, zR], trace.laser).d}));
  return {segment:seg, samples};
 });
}

// Where the endpoint must move (along the last segment) for the beam to focus on it.
export function focusOnEndpoint(trace) {
 const seg = trace.segments.at(-1);
 if (!seg) return null;
 const ahead = -seg.q0[0];
 if (!(ahead > 0)) return {ok:false, reason:'The beam is not converging on the last leg, so there is no focus to move to. Add a lens or focusing mirror before the endpoint.'};
 const dir = sub(seg.b, seg.a).map(v => v / seg.length), target = seg.a.map((v, k) => v + dir[k] * ahead);
 return {ok:true, distance:ahead, move:sub(target, seg.b), target, diameter:beamAtQ([0, seg.q0[1]], trace.laser).d};
}
