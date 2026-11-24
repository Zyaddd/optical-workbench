import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {refractiveIndex, effectiveFocal, laserBeam, traceGaussian, beamAt, focusOnEndpoint, validateOptics, itemOptics, defaultType, envelopeSamples, LENS_PRESETS, passRound, passSquare, erf, lensTransmission, surfaceReflectance, mirrorReflectance, fmtPower, filterTransmission, windowTransmission, gasAbsorption, gasCellOptics, couplingEfficiency, cellPasses, cellBounces} from '../src/optics.mjs';
import {cellMeshes} from '../src/cell.mjs';
import {validateProject, DEFAULT_BOARD} from '../src/core.mjs';
import {validateRoutes} from '../src/routes.mjs';

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('refractive indices match published values', () => {
 close(refractiveIndex('ZnSe', 10.6), 2.4028, 5e-4);
 close(refractiveIndex('CaF2', .5876), 1.4338, 5e-4);
 close(refractiveIndex('BaF2', .5876), 1.4744, 5e-4);
 close(refractiveIndex('Ge', 10.6), 4.0035, 1e-3);
 close(refractiveIndex('BK7', .5876), 1.5168, 2e-4);
 close(refractiveIndex('silica', .5876), 1.4585, 2e-4);
});

test('lens focal length shifts with wavelength through (n - 1)', () => {
 const lens = {type:'lens', focal:100, material:'ZnSe', designWavelength:10.6};
 assert.equal(effectiveFocal(lens, 10.6), 100);
 close(effectiveFocal(lens, 4.5), 100 * (refractiveIndex('ZnSe', 10.6) - 1) / (refractiveIndex('ZnSe', 4.5) - 1), 1e-9);
 assert.ok(effectiveFocal(lens, 4.5) < 100);
 assert.equal(effectiveFocal({...lens, material:'ideal'}, 4.5), 100);
});

test('laser beam: divergence and Rayleigh range follow from the waist, and vice versa', () => {
 const b = laserBeam({wavelength:1, spec:'waist', diameter:2, m2:1, waistOffset:0});
 close(b.zR, Math.PI * 1 * 1 / 1e-3, 1e-6);
 close(b.divergence, 2 * 1e-3 / Math.PI * 1e3, 1e-9);
 const c = laserBeam({wavelength:1, spec:'divergence', divergence:b.divergence, m2:1, waistOffset:0});
 close(c.waistDiameter, 2, 1e-9);
});

// A straight bench along x: laser at 0, lens at 200, detector at 500.
const items = [
 {id:'L', name:'Laser', x:0, y:0, z:0, angle:0, assetId:'laser'},
 {id:'F', name:'Lens', x:200, y:0, z:0, angle:0, assetId:'lens', optics:{type:'lens', focal:100, material:'ideal'}},
 {id:'D', name:'Detector', x:500, y:0, z:0, angle:0, assetId:'det'},
];
const assets = new Map([['laser', {id:'laser', name:'QCL laser'}], ['lens', {id:'lens', name:'Lens'}], ['det', {id:'det', name:'VIGO detector'}]]);
const route = {points:[{x:0, y:0, z:0, itemId:'L'}, {x:0, y:0, z:0, itemId:'F'}, {x:0, y:0, z:0, itemId:'D'}]};

test('a thin lens focuses a collimated beam near its focal point with the textbook spot size', () => {
 items[0].optics = {type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, m2:1, waistOffset:0};
 const t = traceGaussian(route, items, id => assets.get(id));
 assert.ok(t.ok);
 assert.equal(t.waists.length, 1);
 const w = t.waists[0], L = t.laser;
 // Exact Gaussian result for a waist at distance d before a lens of focal length f.
 const d = 200, f = 100, zR = L.zR, z2 = f + (d - f) * f * f / ((d - f) ** 2 + zR ** 2);
 close(w.s - 200, z2, 1e-6);
 const w0p = L.w0 * f / Math.sqrt((d - f) ** 2 + zR ** 2);
 close(w.d, 2 * w0p, 1e-9);
 close(w.d, 2 * L.lambda * f / (Math.PI * beamAt(t, 200).d / 2), 5e-3);
 const p = t.points[1];
 assert.equal(p.f, 100);
 assert.ok(p.focusReached);
});

test('M² scales the focused spot', () => {
 items[0].optics = {type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, m2:1, waistOffset:0};
 const one = traceGaussian(route, items, id => assets.get(id)).waists[0].d;
 items[0].optics = {...items[0].optics, m2:2};
 const two = traceGaussian(route, items, id => assets.get(id)).waists[0].d;
 close(two / one, 2, .05);
});

test('focusOnEndpoint moves the endpoint to the waist along the last leg', () => {
 items[0].optics = {type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, m2:1, waistOffset:0};
 const t = traceGaussian(route, items, id => assets.get(id)), f = focusOnEndpoint(t);
 assert.ok(f.ok);
 close(f.target[0], t.waists[0].world[0], 1e-9);
 close(f.move[0], t.waists[0].world[0] - 500, 1e-9);
 const noLens = traceGaussian({points:[route.points[0], route.points[2]]}, items, id => assets.get(id));
 assert.equal(focusOnEndpoint(noLens).ok, false);
});

test('envelope samples include the waist', () => {
 const t = traceGaussian(route, items, id => assets.get(id));
 const s = envelopeSamples(t)[1].samples, min = Math.min(...s.map(x => x.d));
 close(min, t.waists[0].d, 1e-9);
});

test('a start point off any laser falls back to a default source with a warning', () => {
 const t = traceGaussian({points:[route.points[1], route.points[2]]}, items, id => assets.get(id));
 assert.ok(t.ok);
 assert.equal(t.warnings.filter(w => w.startsWith('The start point is not on a laser')).length, 1);
});

test('roles default from the library part, and settings validate', () => {
 assert.equal(defaultType({id:'supplied-alpes-hhl-qcl', name:'Alpes HHL QCL'}), 'laser');
 assert.equal(defaultType({id:'default-lens', name:'Lens in mount'}), 'lens');
 assert.equal(defaultType({id:'default-parabolic-mirror', name:'Parabolic_Mirror_Frame'}), 'parabolic');
 assert.equal(defaultType({id:'default-flat-mirror', name:'Flat_Mirror_frame'}), 'mirror');
 assert.equal(defaultType({id:'default-vigo-detector', name:'VIGO detector'}), 'detector');
 assert.equal(itemOptics({}, {id:'default-lens', name:'Lens'}).focal, 100);
 assert.deepEqual(validateOptics({type:'lens', focal:50, material:'CaF2', designWavelength:.588, aperture:25.4, junk:1}), {type:'lens', focal:50, material:'CaF2', designWavelength:.588, aperture:25.4});
 assert.throws(() => validateOptics({type:'lens', focal:0}));
 assert.throws(() => validateOptics({type:'lens', material:'unobtainium'}));
 assert.throws(() => validateOptics({type:'laser', wavelength:-1}));
 assert.throws(() => validateOptics({type:'teleporter'}));
 assert.ok(LENS_PRESETS.length > 10);
});

test('projects keep optics settings and physical beams, and older projects are unchanged', () => {
 const base = {format:'optical-workbench', version:2, board:{...DEFAULT_BOARD}, assets:[], items:[{id:'a', name:'Mirror', assetId:'builtin-mirror', x:0, z:0, y:0, angle:0}]};
 const old = validateProject(base);
 assert.equal('optics' in old.items[0], false);
 const withOptics = validateProject({...base, items:[{...base.items[0], optics:{type:'lens', focal:75, material:'ZnSe', designWavelength:10.6}}]});
 assert.equal(withOptics.items[0].optics.focal, 75);
 assert.throws(() => validateProject({...base, items:[{...base.items[0], optics:{type:'lens', focal:'far'}}]}));
 const beam = {id:'b', name:'Beam', color:'#ff0000', width:.5, points:[{x:0, y:0, z:0}, {x:10, y:0, z:0}]};
 assert.equal(validateRoutes([{...beam, physics:true}], new Set())[0].physics, true);
 assert.throws(() => validateRoutes([{...beam, physics:'yes'}], new Set()));
});

test('every mirror has physics: the built-in mirror folds, a concave mirror focuses at R/2 and reports astigmatism off-axis', () => {
 assert.equal(itemOptics({assetId:'builtin-mirror'}, undefined).type, 'mirror');
 assert.equal(defaultType({id:'x', name:'Concave mirror f100'}), 'spherical');
 assert.deepEqual(validateOptics({type:'spherical', roc:300, aperture:25.4}), {type:'spherical', roc:300, aperture:25.4});
 assert.throws(() => validateOptics({type:'spherical', roc:0}));
 assert.equal(effectiveFocal({type:'spherical', roc:300}, 4.5), 150);
 const laser = {id:'L', assetId:'none', x:0, y:0, z:0, angle:0, optics:{type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, m2:1, waistOffset:0}};
 const cm = {id:'M', assetId:'builtin-mirror', x:0, y:0, z:0, angle:0, optics:{type:'spherical', roc:300}};
 const pt = (id, x, z) => id ? {itemId:id, x:0, y:0, z:0} : {x, y:0, z};
 const shift = (it, x, z) => ({...it, x, z});
 const items = [laser, shift(cm, 200, 0)];
 // Fold by 20° at the mirror: incidence 10°.
 const out = [200 - 400 * Math.cos(20 * Math.PI / 180), 400 * Math.sin(20 * Math.PI / 180)];
 const t = traceGaussian({points:[pt('L'), pt('M'), pt(null, ...out)]}, items, () => null);
 assert.ok(t.ok, t.error);
 const m = t.points[1];
 close(m.f, 150, 1e-9);
 close(m.incidence, 10, 1e-6);
 close(m.fTangential, 150 * Math.cos(10 * Math.PI / 180), 1e-9);
 assert.ok(m.focus > 0 && m.focus < 160);
 assert.equal(t.warnings.length, 1);
});

test('power: Gaussian clipping and capture follow the closed forms', () => {
 close(erf(1), .8427007929, 2e-7);
 close(erf(-.5), -.5204998778, 2e-7);
 close(passRound(2, 2), 1 - Math.exp(-2), 1e-12);   // aperture equal to the 1/e² diameter passes 86.5%
 close(passRound(25.4, 2.5), 1, 1e-12);
 close(passSquare(1, .1), 1, 1e-9);
 close(passSquare(1, 1), erf(Math.SQRT2) ** 2, 1e-12);
});

test('power: uncoated lenses lose Fresnel reflections; AR and mirror coatings follow typical values', () => {
 const n = refractiveIndex('ZnSe', 10.6), R = ((n - 1) / (n + 1)) ** 2;
 close(surfaceReflectance({material:'ZnSe', coating:'uncoated'}, 10.6), R, 1e-12);
 close(R, .1704, 2e-3);                               // ZnSe reflects about 17% per surface
 close(lensTransmission({material:'ZnSe', coating:'uncoated'}, 10.6), (1 - R) / (1 + R), 1e-12);
 close(lensTransmission({material:'ZnSe', coating:'ar'}, 10.6), .995 / 1.005, 1e-12);
 assert.equal(lensTransmission({material:'ideal', coating:'uncoated'}, 4.5), 1);
 assert.ok(mirrorReflectance({coating:'gold'}, 4.5) > .97 && mirrorReflectance({coating:'gold'}, .5) < .6);
 assert.equal(mirrorReflectance({coating:'custom', reflectance:90}, 4.5), .9);
 assert.equal(fmtPower(12.34), '12.3 mW');
 assert.equal(fmtPower(.0123), '12.3 µW');
 assert.throws(() => validateOptics({type:'mirror', coating:'unobtainium'}));
 assert.throws(() => validateOptics({type:'detector', rangeMin:5, rangeMax:3}));
 assert.deepEqual(validateOptics({type:'detector', activeArea:1, rangeMin:2, rangeMax:5, responsivity:1000, maxOutput:1}), {type:'detector', activeArea:1, rangeMin:2, rangeMax:5, responsivity:1000, maxOutput:1});
});

test('power follows the beam: lens loss, aperture clipping, detector capture, signal and saturation', () => {
 const its = [
  {id:'L', assetId:'laser', x:0, y:0, z:0, angle:0, optics:{type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, m2:1, waistOffset:0, power:20}},
  {id:'F', assetId:'lens', x:200, y:0, z:0, angle:0, optics:{type:'lens', focal:100, material:'ZnSe', designWavelength:4.5, aperture:25.4, coating:'uncoated'}},
  {id:'D', assetId:'det', x:300, y:0, z:0, angle:0, optics:{type:'detector', activeArea:1, rangeMin:2, rangeMax:6, responsivity:1000, maxOutput:5}},
 ];
 const t = traceGaussian(route, its, id => assets.get(id));
 const T = lensTransmission(its[1].optics, 4.5), lens = t.points[1], det = t.points[2];
 close(lens.powerOut, 20 * T * lens.clip, 1e-9);
 close(t.power.end, lens.powerOut, 1e-12);
 close(det.detectedPower, t.power.end * passSquare(1, det.d), 1e-12);
 close(t.power.signal, det.detectedPower * 1e-3 * 1000, 1e-9);
 assert.ok(t.warnings.some(w => /uncoated ZnSe reflects/.test(w)));
 assert.ok(t.warnings.some(w => /saturates/.test(w)));   // about 14 mW x 1000 V/W = 14 V, over the 5 V limit
 its[2].optics = {...its[2].optics, rangeMin:7, rangeMax:12};
 const out = traceGaussian(route, its, id => assets.get(id));
 assert.equal(out.power.signal, 0);
 assert.ok(out.warnings.some(w => /outside its 7–12 µm/.test(w)));
 // A 5 mm optic in a 6 mm beam clips a large share of the power.
 its[1].optics = {...its[1].optics, aperture:5, coating:'ar'};
 its[0].optics = {...its[0].optics, diameter:6};
 const clipped = traceGaussian(route, its, id => assets.get(id));
 close(clipped.points[1].clip, passRound(5, clipped.points[1].d), 1e-12);
 assert.ok(clipped.points[1].clip < .9 && clipped.warnings.some(w => /aperture clips/.test(w)));
});

test('windows, filters, gas cells and fibres follow their closed forms', () => {
 assert.equal(windowTransmission({material:'ZnSe', coating:'uncoated', brewster:true}, 4.5), 1);
 close(windowTransmission({material:'ZnSe', coating:'uncoated'}, 4.5), lensTransmission({material:'ZnSe', coating:'uncoated'}, 4.5), 1e-12);
 close(filterTransmission({kind:'nd', od:2}, 4.5), .01, 1e-12);
 close(filterTransmission({kind:'bandpass', center:4.5, fwhm:.2, peak:80}, 4.5), .8, 1e-12);
 close(filterTransmission({kind:'bandpass', center:4.5, fwhm:.2, peak:80}, 4.6), .4, 1e-9);   // half at the band edge
 assert.ok(filterTransmission({kind:'bandpass', center:4.5, fwhm:.2, peak:80}, 4.8) < 1e-6);
 const g = gasAbsorption({ppm:100, sigma:1e-19, pressure:1013, temperature:296, length:100, passes:1});
 close(g.n, 1e-4 * 101300 / (1.380649e-23 * 296) * 1e-6, 1e6);
 close(g.tau, 1e-19 * g.n * 10, 1e-12);
 close(gasAbsorption({ppm:100, sigma:1e-19, pressure:1013, temperature:296, length:200, passes:30}).path, 6000, 1e-9);
 const cell = gasCellOptics({window:'CaF2', coating:'ar', mirrorCoating:'gold', passes:30}, 4.5);
 assert.equal(cell.reflections, 29);
 close(cell.mirrors, mirrorReflectance({coating:'gold'}, 4.5) ** 29, 1e-12);
 close(couplingEfficiency({kind:'fibre', mfd:20}, .02, Infinity, .0045), 1, 1e-12);       // matched, flat waist
 close(couplingEfficiency({kind:'fibre', mfd:20}, .04, Infinity, .0045), .64, 1e-12);     // twice the mode: 4/(2+½)²
 assert.ok(couplingEfficiency({kind:'fibre', mfd:20}, .02, 50, .0045) < 1);                // curved wavefront loses
 close(couplingEfficiency({kind:'pinhole', pinhole:2000}, 2, Infinity, .0045), 1 - Math.exp(-2), 1e-12);
 assert.throws(() => validateOptics({type:'filter', kind:'magic'}));
 assert.throws(() => validateOptics({type:'gascell', passes:2.5}));
});

test('a beam that starts on a beam splitter carries on from the beam through it', () => {
 const its = [
  {id:'L', assetId:'laser', x:0, y:0, z:0, angle:0, optics:{type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, m2:1, waistOffset:0, power:10}},
  {id:'S', assetId:'none', x:100, y:0, z:0, angle:0, optics:{type:'splitter', reflectance:30, aperture:25.4}},
  {id:'D', assetId:'det', x:300, y:0, z:0, angle:0},
  {id:'E', assetId:'det', x:100, y:0, z:200, angle:0},
 ];
 const pt = id => ({x:0, y:0, z:0, itemId:id});
 const main = {id:'a', name:'Main', points:[pt('L'), pt('S'), pt('D')]}, side = {id:'b', name:'Side', points:[pt('S'), pt('E')]};
 const all = [main, side], A = traceGaussian(main, its, id => assets.get(id), all), B = traceGaussian(side, its, id => assets.get(id), all);
 assert.equal(A.points[1].arm, 'transmitted');
 close(A.points[1].powerOut, 10 * .7, 1e-9);
 assert.equal(B.points[0].arm, 'reflected');
 close(B.power.start, 10 * .3, 1e-9);
 close(B.points[0].s, 100, 1e-9);                      // distances continue from the laser
 close(B.points[1].d, beamAt(A, 300).d, 1e-6);          // same 300 mm of free path as the main arm
 assert.ok(B.warnings.some(w => /Carries on from Main/.test(w)));
});

test('a gas cell takes its absorption from the detector power: the absorption signal', () => {
 const its = [
  {id:'L', assetId:'laser', x:0, y:0, z:0, angle:0, optics:{type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, m2:1, waistOffset:0, power:10}},
  {id:'C', assetId:'none', x:100, y:0, z:0, angle:0, optics:{type:'gascell', length:100, passes:10, mirrorCoating:'gold', window:'CaF2', coating:'ar', aperture:20, ppm:1000, sigma:1e-19, pressure:1013, temperature:296}},
  {id:'D', assetId:'none', x:200, y:0, z:0, angle:0, optics:{type:'detector', activeArea:10, responsivity:100}},
 ];
 const pt = id => ({x:0, y:0, z:0, itemId:id});
 const t = traceGaussian({points:[pt('L'), pt('C'), pt('D')]}, its, () => null), c = t.points[1], d = t.points[2];
 const g = gasAbsorption(its[1].optics);
 close(c.gas.transmission, g.transmission, 1e-12);
 close(c.powerOut, 10 * c.clip * c.gas.cellTransmission * g.transmission, 1e-12);
 close(t.power.gasDelta, d.detectedPower * (1 / g.transmission - 1), 1e-12);
 close(t.power.gasSignal, t.power.gasDelta * 1e-3 * 100, 1e-12);
});

test('alignment sensitivity: 1 mrad of mirror tilt moves the end spot by 2·B µm', () => {
 const its = [
  {id:'L', assetId:'laser', x:0, y:0, z:0, angle:0, optics:{type:'laser', wavelength:4.5, spec:'waist', diameter:2.5, m2:1, waistOffset:0}},
  {id:'M', assetId:'none', x:100, y:0, z:0, angle:0, optics:{type:'mirror'}},
  {id:'F', assetId:'none', x:100, y:0, z:150, angle:0, optics:{type:'lens', focal:100, material:'ideal'}},
  {id:'D', assetId:'det', x:100, y:0, z:250, angle:0},
 ];
 const pt = id => ({x:0, y:0, z:0, itemId:id});
 const plain = traceGaussian({points:[pt('L'), pt('M'), {x:100, y:0, z:400}]}, its, () => null);
 close(plain.alignment[0].shift, 2 * 400, 1e-6);       // free space: lever arm 400 mm → 800 µm/mrad
 const focused = traceGaussian({points:[pt('L'), pt('M'), pt('F'), pt('D')]}, its, () => null);
 close(focused.alignment[0].shift, 2 * 100, 1e-6);     // detector in the lens's focal plane: B = f
});

test('the NanoPlus ICL lies with its two mounting holes facing the breadboard', () => {
 const a = JSON.parse(fs.readFileSync(new URL('../src/lasers.json', import.meta.url), 'utf8')).find(x => x.id === 'supplied-nanoplus');
 const box = m => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.positions[i + k]); hi[k] = Math.max(hi[k], m.positions[i + k]); } return {lo, hi}; };
 assert.equal(a.geometryRevision, 2);
 const body = a.meshes.reduce((m, n) => n.positions.length > m.positions.length && !n.name ? n : m), b = box(body);
 close(b.lo[1], 0, 1e-6);                                            // rests on its base
 // The bores of both holes open on the base, either side of the mounting reference.
 const rim = [];
 for (let i = 0; i < body.positions.length; i += 3) if (Math.abs(body.positions[i + 1]) < .05 && Math.abs(body.positions[i + 2]) < 4 && Math.abs(body.positions[i]) < 14 && Math.abs(body.positions[i]) > 6) rim.push(body.positions[i]);
 assert.ok(rim.some(x => x < 0) && rim.some(x => x > 0));
 for (const m of a.meshes.filter(m => /DB9/.test(m.name))) assert.ok(box(m).lo[2] > 10);   // connectors face the side
 const lens = a.meshes.find(m => box(m).hi[0] > 25.2), l = box(lens);
 close((l.lo[1] + l.hi[1]) / 2, 25, .1); close((l.lo[2] + l.hi[2]) / 2, 0, .1);   // beam axis 25 mm up, over the post
});

test('gas cells: single pass or multipass, a body that follows the length, and the bounce path', () => {
 const parts = JSON.parse(fs.readFileSync(new URL('../src/optics-parts.json', import.meta.url), 'utf8'));
 const single = parts.find(a => a.id === 'default-gas-cell'), multi = parts.find(a => a.id === 'default-multipass-cell');
 // Older projects without a mode: more than one pass reads as multipass.
 assert.equal(itemOptics({assetId:'x', optics:{type:'gascell', passes:30}}, null).mode, 'multipass');
 assert.equal(itemOptics({assetId:'x', optics:{type:'gascell', passes:1}}, null).mode, 'single');
 assert.equal(itemOptics({assetId:multi.id}, multi).mode, 'multipass');
 // A single-pass cell ignores a stored pass count.
 const o = {type:'gascell', mode:'single', length:100, passes:30, ppm:100, sigma:1e-19, pressure:1013, temperature:296, window:'CaF2', coating:'ar', mirrorCoating:'gold'};
 assert.equal(cellPasses(o), 1);
 close(gasAbsorption(o).path, 100, 1e-9);
 assert.equal(gasCellOptics(o, 4.5).reflections, 0);
 close(gasAbsorption({...o, mode:'multipass', length:150}).path, 4500, 1e-9);
 assert.throws(() => validateOptics({type:'gascell', mode:'triple'}));
 assert.ok(single.meshes.some(m => m.glass) && multi.meshes.some(m => m.glass));
 // The body stretches: the far flange moves by half the change, the centre stays.
 const xs = meshes => meshes.flatMap(m => m.positions.filter((_, n) => n % 3 === 0));
 const span = meshes => { const x = xs(meshes); return Math.max(...x) - Math.min(...x); };
 close(span(cellMeshes(multi, 300)) - span(multi.meshes), 100, 1e-6);
 close(span(cellMeshes(single, 60)) - span(single.meshes), -40, 1e-6);
 // Bounce path: in on the axis, the set number of passes between the mirror planes, out on the axis.
 const trace = {points:[{index:0, world:[0, 76, 0]}, {index:1, world:[300, 76, 0], d:2, cell:{mode:'multipass', length:200, passes:5, radius:21}}, {index:2, world:[600, 76, 0]}]};
 const path = cellBounces(trace, trace.points[1]);
 assert.equal(path.length, 6);                                  // 5 passes
 assert.deepEqual(path[0].map(v => +v.toFixed(6)), [200, 76, 0]);
 assert.deepEqual(path.at(-1).map(v => +v.toFixed(6)), [400, 76, 0]);
 for (const q of path) assert.ok(Math.abs(Math.abs(q[0] - 300) - 100) < 1e-9 && Math.hypot(q[1] - 76, q[2]) <= 21);
 assert.equal(cellBounces(trace, {...trace.points[1], cell:{...trace.points[1].cell, passes:4}}).length, 6);   // even: one extra pass
});
