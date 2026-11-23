import test from 'node:test';
import assert from 'node:assert/strict';
import {refractiveIndex, effectiveFocal, laserBeam, traceGaussian, beamAt, focusOnEndpoint, validateOptics, itemOptics, defaultType, envelopeSamples, LENS_PRESETS} from '../src/optics.mjs';
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
 assert.equal(t.warnings.length, 1);
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
