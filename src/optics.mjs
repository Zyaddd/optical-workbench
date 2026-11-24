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
 if (o.type === 'spherical') return o.roc / 2;
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
 none:'Not optical', laser:'Laser source', lens:'Lens', mirror:'Flat mirror', spherical:'Concave (spherical) mirror', parabolic:'Focusing (parabolic) mirror',
 splitter:'Beam splitter', window:'Window', filter:'Filter', gascell:'Gas cell', coupler:'Fibre or pinhole', detector:'Detector',
};
const LASER = {type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, divergence:2.5, m2:1.3, waistOffset:0, power:10};
const DEFAULTS = {
 none:{type:'none'},
 laser:LASER,
 lens:{type:'lens', focal:100, material:'ZnSe', designWavelength:10.6, aperture:25.4, coating:'ar'},
 mirror:{type:'mirror', aperture:25.4, coating:'gold'},
 spherical:{type:'spherical', roc:200, aperture:25.4, coating:'gold'},
 parabolic:{type:'parabolic', focal:50.8, offAxis:90, aperture:25.4, coating:'gold'},
 splitter:{type:'splitter', reflectance:50, aperture:25.4},
 window:{type:'window', material:'CaF2', coating:'ar', aperture:25.4, brewster:false},
 filter:{type:'filter', kind:'nd', od:1, center:4.5, fwhm:.2, peak:80, aperture:25.4},
 gascell:{type:'gascell', length:100, passes:1, mirrorCoating:'gold', window:'CaF2', coating:'ar', aperture:20, ppm:100, sigma:1e-19, pressure:1013, temperature:296},
 coupler:{type:'coupler', kind:'fibre', mfd:20, pinhole:100},
 detector:{type:'detector', activeArea:1},
};
// What a part is, when the user has not said: by library id first, then by name.
export function defaultType(asset) {
 const id = asset?.id || '', name = (asset?.name || '') + ' ' + id;
 if (asset?.role === 'laser' || /laser|qcl|nanoplus/i.test(name)) return 'laser';
 if (/splitter/i.test(name)) return 'splitter';
 if (/gas cell|multipass|herriott|white cell/i.test(name)) return 'gascell';
 if (/fib(re|er)|pinhole/i.test(name)) return 'coupler';
 if (/filter/i.test(name)) return 'filter';
 if (/window/i.test(name)) return 'window';
 if (/lens/i.test(name)) return 'lens';
 if (/parabol|oap/i.test(name)) return 'parabolic';
 if (/detector|vigo|photodiode/i.test(name)) return 'detector';
 if (/concave|spherical|curved/i.test(name) && /mirror/i.test(name)) return 'spherical';
 if (/mirror/i.test(name)) return 'mirror';
 return 'none';
}
export const defaultOptics = type => structuredClone(DEFAULTS[type] || DEFAULTS.none);
// The optics of a placed item: saved settings over the defaults for its type (or for its asset).
// The app's built-in mirror is not a catalogue asset, so it is named here to get mirror physics too.
const BUILTIN = {'builtin-mirror':{id:'builtin-mirror', name:'Mirror with mount'}};
export function itemOptics(item, asset) {
 const type = item?.optics?.type || defaultType(asset || BUILTIN[item?.assetId]);
 const own = asset?.opticsDefaults?.type === type ? asset.opticsDefaults : {};
 const o = {...defaultOptics(type), ...own, ...(item?.optics?.type === type ? item.optics : {}), type};
 // Gas cells saved before the single-pass / multipass choice: more than one pass means multipass.
 if (type === 'gascell' && !o.mode) o.mode = o.passes > 1 ? 'multipass' : 'single';
 return o;
}
export const CELL_MODES = {single:'Single pass', multipass:'Multipass (Herriott)'};
// Passes that count: a single-pass cell always has one, whatever its stored pass count.
export const cellPasses = o => o.mode === 'single' ? 1 : (o.passes || 1);

const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
export function validateOptics(o) {
 if (o == null) return undefined;
 const bad = () => { throw Error('Invalid optical settings.'); };
 if (!o || typeof o !== 'object' || !(o.type in OPTIC_TYPES)) bad();
 const out = {type:o.type};
 const take = (k, lo, hi) => { if (o[k] == null) return; if (!num(o[k], lo, hi)) bad(); out[k] = o[k]; };
 if (o.type === 'laser') {
  take('wavelength', .2, 30); take('diameter', .001, 100); take('divergence', .001, 1500); take('m2', 1, 50); take('waistOffset', -10000, 10000); take('power', 1e-6, 1e6);
  if (o.spec != null) { if (!['waist', 'divergence'].includes(o.spec)) bad(); out.spec = o.spec; }
 }
 if (o.type === 'lens' || o.type === 'parabolic') {
  take('focal', -10000, 10000); if (out.focal != null && Math.abs(out.focal) < .5) bad();
  take('aperture', .1, 1000);
 }
 if (o.type === 'lens') { take('designWavelength', .2, 30); if (o.material != null) { if (!(o.material in MATERIALS)) bad(); out.material = o.material; } }
 if (o.type === 'parabolic') take('offAxis', 0, 179);
 if (o.type === 'mirror') take('aperture', .1, 1000);
 if (o.type === 'spherical') { take('roc', -100000, 100000); if (out.roc != null && Math.abs(out.roc) < 1) bad(); take('aperture', .1, 1000); }
 if (MIRRORS.has(o.type)) {
  if (o.coating != null) { if (!(o.coating in COATINGS)) bad(); out.coating = o.coating; }
  take('reflectance', 0, 100);
 }
 if (o.type === 'lens' && o.coating != null) { if (!(o.coating in LENS_COATINGS)) bad(); out.coating = o.coating; }
 const pick = (k, options) => { if (o[k] == null) return; if (!options.includes(o[k])) bad(); out[k] = o[k]; };
 if (o.type === 'splitter') { take('reflectance', 0, 100); take('aperture', .1, 1000); }
 if (o.type === 'window') { pick('material', Object.keys(MATERIALS)); pick('coating', Object.keys(LENS_COATINGS)); take('aperture', .1, 1000); if (o.brewster != null) { if (typeof o.brewster !== 'boolean') bad(); out.brewster = o.brewster; } }
 if (o.type === 'filter') { pick('kind', Object.keys(FILTER_KINDS)); take('od', 0, 10); take('center', .2, 30); take('fwhm', .001, 30); take('peak', 0, 100); take('aperture', .1, 1000); }
 if (o.type === 'gascell') {
  pick('mode', Object.keys(CELL_MODES)); take('length', .1, 1e5); take('passes', 1, 1000); if (out.passes != null && !Number.isInteger(out.passes)) bad();
  pick('mirrorCoating', Object.keys(COATINGS)); pick('window', Object.keys(MATERIALS)); pick('coating', Object.keys(LENS_COATINGS));
  take('aperture', .1, 1000); take('ppm', 0, 1e6); take('sigma', 0, 1e-14); take('pressure', .001, 1e5); take('temperature', 1, 2000);
 }
 if (o.type === 'coupler') { pick('kind', Object.keys(COUPLER_KINDS)); take('mfd', .1, 5000); take('pinhole', .1, 1e5); }
 if (o.type === 'detector') {
  take('activeArea', .001, 100); take('rangeMin', .2, 30); take('rangeMax', .2, 30); take('responsivity', 0, 1e12); take('maxOutput', 1e-6, 1e6);
  if (out.rangeMin != null && out.rangeMax != null && out.rangeMin >= out.rangeMax) bad();
 }
 return out;
}

// Laser source → embedded Gaussian: waist radius w0, Rayleigh range zR and half-angle divergence.
// ---------- Power ----------
// Typical reflectance of metal mirror coatings against wavelength (µm), read from vendor curves.
export const COATINGS = {
 gold:{name:'Gold', curve:[[.4, .38], [.5, .48], [.6, .88], [.7, .95], [1, .97], [2, .98], [30, .985]]},
 silver:{name:'Protected silver', curve:[[.4, .9], [.5, .96], [1, .975], [2, .98], [10, .975], [30, .96]]},
 aluminium:{name:'Protected aluminium', curve:[[.25, .88], [.4, .9], [.8, .86], [1, .92], [2, .95], [10, .96], [30, .95]]},
 custom:{name:'Custom reflectance'},
};
export const LENS_COATINGS = {ar:'Anti-reflection coated', uncoated:'Uncoated'};
const MIRRORS = new Set(['mirror', 'spherical', 'parabolic']);
const AR_REFLECTANCE = .005; // per surface: a typical broadband AR coating inside its band
const interpolate = (curve, x) => {
 if (x <= curve[0][0]) return curve[0][1];
 for (let k = 1; k < curve.length; k++) if (x <= curve[k][0]) { const [a, ya] = curve[k - 1], [b, yb] = curve[k]; return ya + (yb - ya) * (x - a) / (b - a); }
 return curve.at(-1)[1];
};
export function mirrorReflectance(o, wavelength) {
 if (o.coating === 'custom') return (o.reflectance ?? 99) / 100;
 return interpolate(COATINGS[o.coating || 'gold'].curve, wavelength);
}
// One lens surface: Fresnel ((n-1)/(n+1))² when uncoated, a typical AR coating otherwise.
export function surfaceReflectance(o, wavelength) {
 if (o.material === 'ideal' || !MATERIALS[o.material]) return 0;
 if (o.coating !== 'uncoated') return AR_REFLECTANCE;
 const n = refractiveIndex(o.material, wavelength);
 return ((n - 1) / (n + 1)) ** 2;
}
// Two surfaces with incoherent multiple reflections. Absorption in the glass is not modelled.
export function lensTransmission(o, wavelength) { const R = surfaceReflectance(o, wavelength); return (1 - R) / (1 + R); }
export const FILTER_KINDS = {nd:'Neutral density', bandpass:'Bandpass'};
export const COUPLER_KINDS = {fibre:'Single-mode fibre', pinhole:'Pinhole'};
// A window: Fresnel or AR loss at two surfaces, or none at Brewster's angle for p-polarised light.
export const windowTransmission = (o, wavelength) => o.brewster ? 1 : lensTransmission({material:o.material, coating:o.coating}, wavelength);
// ND: 10^-OD. Bandpass: a flat-topped pass band (super-Gaussian) that is at half its peak at ±FWHM/2.
export function filterTransmission(o, wavelength) {
 if (o.kind === 'bandpass') return (o.peak ?? 80) / 100 * Math.exp(-Math.LN2 * (2 * Math.abs(wavelength - o.center) / o.fwhm) ** 8);
 return 10 ** -(o.od ?? 0);
}
// Beer–Lambert absorption by one gas line: n = x·p/(kT), absorbance τ = σ·n·L, transmission e^-τ.
export function gasAbsorption(o) {
 const n = (o.ppm ?? 0) * 1e-6 * (o.pressure * 100) / (1.380649e-23 * o.temperature) * 1e-6; // molecules per cm³
 const path = o.length * cellPasses(o), tau = (o.sigma ?? 0) * n * path / 10;
 return {n, path, tau, transmission:Math.exp(-tau)};
}
// Everything a gas cell does to the power apart from the gas: two windows and the multipass reflections.
export function gasCellOptics(o, wavelength) {
 const windows = lensTransmission({material:o.window, coating:o.coating}, wavelength) ** 2;
 const reflections = Math.max(0, cellPasses(o) - 1), mirrors = reflections ? mirrorReflectance({coating:o.mirrorCoating}, wavelength) ** reflections : 1;
 return {windows, mirrors, reflections, transmission:windows * mirrors};
}
// Power coupled into a single-mode fibre: overlap of the beam (radius w, wavefront R) with the fibre mode
// (radius MFD/2, flat) at the fibre face. For a pinhole, the share of the beam that passes.
export function couplingEfficiency(o, d, R, lambda) {
 if (o.kind === 'pinhole') return passRound(o.pinhole / 1000, d);
 const w = d / 2, wf = o.mfd / 2000, curve = Number.isFinite(R) ? 1 / R : 0;
 return 4 / ((w / wf + wf / w) ** 2 + (Math.PI * w * wf / lambda) ** 2 * curve ** 2);
}
// Abramowitz & Stegun 7.1.26, |error| < 1.5e-7.
export function erf(x) {
 const t = 1 / (1 + .3275911 * Math.abs(x));
 const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x);
 return x < 0 ? -y : y;
}
// Share of a centred Gaussian beam (1/e² diameter d) passing a round aperture of diameter A,
// and landing on a square of side a.
export const passRound = (A, d) => 1 - Math.exp(-2 * A * A / (d * d));
export const passSquare = (a, d) => erf(Math.SQRT2 * a / d) ** 2;
export const pct = v => (v * 100 >= 10 ? (v * 100).toFixed(0) : (v * 100).toFixed(1)) + '%';
export function fmtPower(mW) {
 if (!Number.isFinite(mW)) return '–';
 if (mW >= 1000) return +(mW / 1000).toPrecision(3) + ' W';
 if (mW >= .1) return +mW.toPrecision(3) + ' mW';
 if (mW >= 1e-4) return +(mW * 1000).toPrecision(3) + ' µW';
 return +(mW * 1e6).toPrecision(3) + ' nW';
}
const mmText = v => v >= 10 ? v.toFixed(1) : v.toFixed(2);

const PASSIVE = new Set(['lens', 'mirror', 'spherical', 'parabolic', 'splitter', 'window', 'filter', 'gascell', 'coupler']);
const REFLECTING = new Set(['mirror', 'spherical', 'parabolic']);
const unit = v => { const l = len(v) || 1; return v.map(x => x / l); };
const dot = (a, b) => a.reduce((t, v, j) => t + v * b[j], 0);
// At a splitter, the beam goes straight on (transmitted) or turns (reflected).
const armAt = (world, k) => dot(unit(sub(world[k], world[k - 1])), unit(sub(world[k + 1], world[k]))) > .99 ? 'transmitted' : 'reflected';

// Where a beam that starts on a splitter comes from: the beam that passes through it, traced up to it.
function splitterBranch(route, start, world, items, assetOf, routes, depth) {
 const id = start.item.id, parent = routes.find(r => r !== route && r.id !== route.id && r.points.slice(1).some(p => p.itemId === id));
 if (!parent) return null;
 const k = parent.points.findIndex((p, j) => j > 0 && p.itemId === id);
 const t = traceGaussian(parent, items, assetOf, routes, depth + 1);
 if (!t.ok) return {error:`${parent.name || 'The parent beam'}: ${t.error}`};
 const at = t.points.find(p => p.index === k);
 if (!at) return null;
 const parentDir = unit(sub(at.world, t.points.find(p => p.index === k - 1)?.world || at.world));
 const ownDir = world.length > 1 ? unit(sub(world[1], world[0])) : parentDir;
 const arm = dot(parentDir, ownDir) > .99 ? 'transmitted' : 'reflected', o = start.optics;
 const clip = o.aperture ? passRound(o.aperture, at.d) : 1, share = arm === 'transmitted' ? 1 - o.reflectance / 100 : o.reflectance / 100;
 return {laser:t.laser, q:at.qIn, s:at.s, power:at.powerIn * clip * share, arm, parent:parent.name,
  warnings:[`Carries on from ${parent.name || 'the beam'} at ${start.item.name}: the ${arm} ${pct(share)}.`]};
}

// How far the end spot moves when a mirror tilts by 1 mrad: the reflected beam turns by 2 mrad, and the
// optics after the mirror carry that angle to the end through the ABCD matrix element B.
function alignmentSensitivity(points) {
 const end = points.at(-1), out = [];
 for (const m of points) {
  if (m === end || !(REFLECTING.has(m.type) || (m.type === 'splitter' && m.arm === 'reflected'))) continue;
  let A = 1, B = 0, C = 0, D = 1, prev = m;
  for (const n of points) {
   if (n.index <= m.index) continue;
   const L = n.s - prev.s; A += L * C; B += L * D; prev = n;
   if (n !== end && n.f != null) { C -= A / n.f; D -= B / n.f; }
  }
  const shift = 2 * Math.abs(B); // µm of spot motion per mrad of tilt
  out.push({name:m.name, index:m.index, shift, ofSpot:shift / (end.d * 1000), ofArea:end.activeArea ? shift / (end.activeArea * 1000) : null});
 }
 return out.sort((a, b) => b.shift - a.shift);
}

// A fibre or pinhole at the end of the beam: how much of the arriving power it accepts.
function couplerPower(info, o, P, lambda, warnings) {
 const eta = couplingEfficiency(o, info.d, info.R, lambda);
 Object.assign(info, {coupling:eta, coupledPower:P * eta, couplerKind:o.kind});
 if (o.kind === 'fibre' && eta < .5) warnings.push(`${info.name}: only ${pct(eta)} couples into the fibre. The beam is Ø ${mmText(info.d)} mm here; it couples best as a flat waist the size of the ${o.mfd} µm mode. Move the fibre to the focus or change the focusing optic.`);
 if (o.kind === 'pinhole' && eta < .9) warnings.push(`${info.name}: the ${o.pinhole} µm pinhole passes only ${pct(eta)} of the Ø ${mmText(info.d)} mm beam.`);
}

// What a detector at the end of the beam receives and, once its datasheet values are set, outputs.
function detectorPower(info, o, P, lambda, warnings) {
 const captured = passSquare(o.activeArea, info.d);
 Object.assign(info, {captured, detectedPower:P * captured});
 if (captured < .9) warnings.push(`${info.name}: only ${pct(captured)} of the beam lands on the ${o.activeArea} mm active area. Move the detector to the focus or add a focusing optic.`);
 if (o.rangeMin != null && o.rangeMax != null && (lambda < o.rangeMin || lambda > o.rangeMax)) {
  info.outOfRange = true;
  warnings.push(`${info.name}: ${lambda} µm is outside its ${o.rangeMin}–${o.rangeMax} µm spectral range, so it will barely respond.`);
 }
 if (o.responsivity) {
  info.signal = info.outOfRange ? 0 : info.detectedPower * 1e-3 * o.responsivity;
  if (o.maxOutput != null && info.signal > o.maxOutput) {
   info.saturated = true;
   warnings.push(`${info.name}: ${fmtPower(info.detectedPower)} gives ${info.signal.toFixed(2)} V, above its ${o.maxOutput} V output limit, so it saturates. Attenuate to below ${fmtPower(o.maxOutput / o.responsivity * 1e3)}.`);
  }
 }
}

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
// concave mirrors (f = R/2) likewise; flat mirrors and other bounce points only fold the path. Returns per-segment q values for sampling.
export function traceGaussian(route, items, assetOf, routes = null, depth = 0) {
 const find = id => items.find(i => i.id === id);
 const opticsAt = p => { const i = p.itemId && find(p.itemId); return i ? {item:i, optics:itemOptics(i, assetOf(i.assetId))} : {item:null, optics:{type:'none'}}; };
 const world = route.points.map(p => { const i = p.itemId && find(p.itemId); if (p.itemId && !i) return null; const w = i ? localToWorld(i, p) : p; return [w.x, w.y, w.z]; });
 if (world.some(w => !w)) return {ok:false, error:'A beam point lost its component.'};
 const warnings = [], start = opticsAt(route.points[0]);
 let laserOptics = start.optics, branch = null;
 // A beam that starts on a beam splitter carries on from the beam that passes through that splitter.
 if (laserOptics.type === 'splitter' && routes && depth < 4) branch = splitterBranch(route, start, world, items, assetOf, routes, depth);
 if (branch?.error) return {ok:false, error:branch.error};
 if (branch) laserOptics = branch.laser;
 else if (laserOptics.type !== 'laser') { laserOptics = defaultOptics('laser'); warnings.push('The start point is not on a laser, so a default 4.5 µm source is assumed. Start the beam on a laser, or on a beam splitter that another physical beam passes through.'); }
 const beam = laserBeam(laserOptics);
 let q = branch ? branch.q.slice() : [-beam.waistOffset, beam.zR], s = branch ? branch.s : 0, P = branch ? branch.power : laserOptics.power ?? LASER.power;
 const lambda = laserOptics.wavelength, s0 = s, P0 = P;
 const segments = [], points = [], waists = [];
 points.push({index:0, s, world:world[0], type:branch ? 'splitter' : 'laser', name:start.item?.name || 'Start', powerOut:P, qIn:q.slice(), arm:branch?.arm, ...beamAtQ(q, beam)});
 if (branch) warnings.push(...branch.warnings);
 for (let k = 1; k < world.length; k++) {
  const length = len(sub(world[k], world[k - 1]));
  if (length < 1e-6) continue;
  const seg = {index:k - 1, a:world[k - 1], b:world[k], s0:s, length, q0:q.slice(), power:P};
  segments.push(seg);
  const ahead = -q[0];
  if (ahead > 0 && ahead < length) {
   const t = ahead, frac = t / length;
   waists.push({segment:seg.index, s:s + t, t, world:seg.a.map((v, j) => v + (seg.b[j] - v) * frac), d:beamAtQ([0, q[1]], beam).d, zR:q[1], afterPoint:k - 1});
  }
  q = [q[0] + length, q[1]]; s += length;
  const here = opticsAt(route.points[k]), o = here.optics, last = k === world.length - 1;
  const info = {index:k, s, world:world[k], type:o.type, name:here.item?.name || (last ? 'Endpoint' : 'Waypoint'), qIn:q.slice(), ...beamAtQ(q, beam)};
  if (!last && (o.type === 'lens' || o.type === 'parabolic' || o.type === 'spherical')) {
   const f = effectiveFocal(o, laserOptics.wavelength);
   if (o.type === 'spherical') {
    // A curved mirror used off-axis focuses the two planes differently: f·cosθ in the fold plane, f/cosθ across it.
    const din = sub(world[k], world[k - 1]), dout = sub(world[k + 1], world[k]);
    const c = Math.max(-1, Math.min(1, -din.reduce((t, v, j) => t + v * dout[j], 0) / (len(din) * len(dout) || 1)));
    const theta = Math.acos(c) / 2;
    Object.assign(info, {incidence:theta * 180 / Math.PI, fTangential:f * Math.cos(theta), fSagittal:f / Math.cos(theta)});
    if (theta > 5 * Math.PI / 180) warnings.push(`${info.name}: hit ${(theta * 180 / Math.PI).toFixed(0)}° off-axis, so the focus is astigmatic (${(f * Math.cos(theta)).toFixed(1)} mm in the fold plane, ${(f / Math.cos(theta)).toFixed(1)} mm across it). The model uses f = R/2.`);
   }
   if (o.type === 'lens' && o.material !== 'ideal' && !inRange(o.material, laserOptics.wavelength)) warnings.push(`${info.name}: ${MATERIALS[o.material].name} is outside its data range (${MATERIALS[o.material].range.join('–')} µm) at ${laserOptics.wavelength} µm and may not transmit.`);
   q = thinLens(q, f);
   const after = beamAtQ(q, beam);
   Object.assign(info, {f, focus:after.waistAhead, focusDiameter:after.waistDiameter, aperture:o.aperture});
  } else if (o.type === 'detector') info.activeArea = o.activeArea;
  else if (o.aperture) info.aperture = o.aperture;
  // Power: clipped by the clear aperture, then reflected or transmitted; a detector keeps what lands on it.
  info.powerIn = P;
  if (here.item && o.type === 'detector') detectorPower(info, o, P, lambda, warnings);
  else if (here.item && last && o.type === 'coupler') couplerPower(info, o, P, beam.lambda, warnings);
  else if (here.item && !last && PASSIVE.has(o.type)) {
   const clip = o.aperture ? passRound(o.aperture, info.d) : 1;
   let eff;
   if (o.type === 'lens') eff = lensTransmission(o, lambda);
   else if (MIRRORS.has(o.type)) eff = mirrorReflectance(o, lambda);
   else if (o.type === 'splitter') { info.arm = armAt(world, k); eff = info.arm === 'transmitted' ? 1 - o.reflectance / 100 : o.reflectance / 100; }
   else if (o.type === 'window') eff = windowTransmission(o, lambda);
   else if (o.type === 'filter') eff = filterTransmission(o, lambda);
   else if (o.type === 'gascell') {
    const gas = gasAbsorption(o), cell = gasCellOptics(o, lambda);
    eff = cell.transmission * gas.transmission;
    // What the drawing needs: the cell's length along the beam, its passes and the spot-ring radius.
    const spec = assetOf(here.item.assetId)?.cellSpec;
    info.cell = {mode:o.mode, length:o.length, passes:cellPasses(o), radius:spec?.radius ?? Math.max(4, (o.aperture || 20) / 2)};
    info.gas = {...gas, windows:cell.windows, mirrors:cell.mirrors, reflections:cell.reflections, cellTransmission:cell.transmission, absorbed:P * clip * cell.transmission * (1 - gas.transmission)};
    if (gas.tau > 2.3) warnings.push(`${info.name}: the gas absorbs ${pct(1 - gas.transmission)} (absorbance ${gas.tau.toFixed(2)}), so the line is saturated. Shorten the path or lower the concentration for a linear signal.`);
   }
   else if (o.type === 'coupler') { const eta = couplingEfficiency(o, info.d, info.R, beam.lambda); eff = eta; info.coupling = eta; }
   Object.assign(info, {clip, efficiency:eff});
   if (clip < .99) warnings.push(`${info.name}: its Ø ${mmText(o.aperture)} mm aperture clips ${pct(1 - clip)} of the Ø ${mmText(info.d)} mm beam. Use a larger optic or put it where the beam is narrower.`);
   if (o.type === 'lens' && o.coating === 'uncoated' && eff < .9) warnings.push(`${info.name}: uncoated ${MATERIALS[o.material].name} reflects ${pct(surfaceReflectance(o, lambda))} at each surface, so only ${pct(eff)} gets through. An AR-coated lens avoids most of this loss.`);
   P *= clip * eff;
  }
  info.powerOut = P;
  points.push(info);
 }
 for (const p of points) if (p.focus != null) {
  const next = points.find(n => n.index > p.index && n.f != null);
  p.focusReached = p.focus > 0 && (!next || p.s + p.focus < next.s);
 }
 const end = points.at(-1);
 // What the gas takes from the light that reaches the end: the absorption signal.
 const gasT = points.filter(p => p.gas).reduce((t, p) => t * p.gas.transmission, 1);
 if (gasT < 1 && end.detectedPower != null) { end.gasDelta = end.detectedPower * (1 / gasT - 1); if (end.signal != null && !end.outOfRange) end.gasSignal = end.signal * (1 / gasT - 1); }
 const power = {start:P0, fromSplitter:!!branch, end:end.powerIn ?? P, detected:end.detectedPower ?? null, signal:end.signal ?? null, coupled:end.coupledPower ?? null,
  gasDelta:end.gasDelta ?? null, gasSignal:end.gasSignal ?? null,
  losses:points.filter(p => p.clip != null).map(p => ({name:p.name, clip:p.clip, efficiency:p.efficiency, lost:p.powerIn - p.powerOut}))};
 const alignment = alignmentSensitivity(points);
 return {ok:true, laser:{...laserOptics, ...beam}, warnings, segments, points, waists, total:s, start:s0, end, power, alignment};
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

// The beam's path through a multipass cell: in on the axis at the entrance window, then back and forth
// between the mirrors on a ring of spots (each pass turns the ring by a fixed angle, as in a Herriott cell),
// and out on the axis at the far window. An even pass count gets one extra pass so it leaves forward.
export function cellBounces(trace, p, maxPasses = 61) {
 const prev = trace.points.find(q => q.index === p.index - 1), next = trace.points.find(q => q.index === p.index + 1);
 const from = prev?.world, to = next?.world;
 if (!from && !to) return null;
 const c = p.world, dir = (from ? c.map((v, k) => v - from[k]) : to.map((v, k) => v - c[k])), n = Math.hypot(...dir);
 if (n < 1e-9) return null;
 const d = dir.map(v => v / n), ref = Math.abs(d[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
 const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
 const u0 = cross(d, ref), un = Math.hypot(...u0), u = u0.map(v => v / un), v = cross(d, u);
 let passes = Math.min(maxPasses, p.cell.passes);
 if (passes % 2 === 0) passes += 1;
 const half = p.cell.length / 2, r = p.cell.radius * .62, turn = Math.PI * 2 * (Math.round(passes * .38) || 1) / passes;
 const point = (along, j) => { const a = j * turn, x = j ? Math.cos(a) * r : 0, y = j ? Math.sin(a) * r : 0; return c.map((w, k) => w + d[k] * along + u[k] * x + v[k] * y); };
 const path = [point(-half, 0)];
 for (let j = 1; j < passes; j++) path.push(point(j % 2 ? half : -half, j));
 path.push(point(half, 0));
 return path;
}
