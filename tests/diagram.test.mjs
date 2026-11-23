import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDiagram, diagramParts, defaultLabel, diagramGroups, beamOrder, toPlane, fromPlane, placeCallouts, layoutDiagram, diagramSVG, withPngDpi, beamPolylines, niceLength} from '../src/diagram.mjs';
import {validateProject, DEFAULT_BOARD} from '../src/core.mjs';

const assets = new Map([
 ['qcl', {id:'qcl', name:'Alpes HHL QCL (supplied model)', meshes:[{name:'Body'}]}],
 ['flat', {id:'default-flat-mirror', name:'Flat_Mirror_frame', meshes:[{name:'Part 1'}]}],
 ['lens', {id:'default-lens', name:'Lens in mount (Ø25.4 mm)', meshes:[{name:'Lens'}, {name:'Lens mount ring'}, {name:'Post'}, {name:'Post holder base'}]}],
 ['det', {id:'default-vigo-detector', name:'VIGO detector', meshes:[{name:'Housing'}]}],
 ['holder', {id:'lab-adjustable-holder', name:'Adjustable post holder', holderSpec:{}, meshes:[{name:'x'}]}],
]);
const assetOf = id => assets.get(id);
const items = [
 {id:'L', name:'Alpes HHL QCL (supplied model) 1', assetId:'qcl', x:-150, z:0, y:0, angle:90, optics:{type:'laser', wavelength:2.7}},
 {id:'M1', name:'Flat_Mirror_frame 2', assetId:'flat', x:0, z:0, y:0, angle:0},
 {id:'M2', name:'Flat_Mirror_frame 3', assetId:'flat', x:0, z:100, y:0, angle:0},
 {id:'F', name:'Lens in mount (Ø25.4 mm) 4', assetId:'lens', x:100, z:100, y:0, angle:0},
 {id:'D', name:'Shock tube', assetId:'det', x:200, z:100, y:0, angle:0},
 {id:'H', name:'Adjustable post holder 6', assetId:'holder', x:0, z:0, y:0, angle:0},
];
const beams = [{id:'b', name:'Beam', color:'#1f6fd1', width:1, points:[{x:0, y:0, z:0, itemId:'L'}, {x:0, y:0, z:0, itemId:'M1'}, {x:0, y:0, z:0, itemId:'M2'}, {x:0, y:0, z:0, itemId:'F'}, {x:0, y:0, z:0, itemId:'D'}]}];
const measure = (t, px) => String(t).length * px * .55;

test('mount parts and post holders are left out of the top view', () => {
 assert.deepEqual(diagramParts(assets.get('lens')).map(m => m.name), ['Lens', 'Lens mount ring']);
 assert.equal(diagramParts(assets.get('lens'), false).length, 4);
 assert.equal(diagramParts({meshes:[{name:'Post'}]}).length, 1); // never empty
});

test('labels come from the optical role, custom names win', () => {
 assert.equal(defaultLabel(items[0], assets.get('qcl')), 'Laser (2.7 µm)');
 assert.equal(defaultLabel(items[1], assets.get('flat')), 'Plane mirror');
 assert.equal(defaultLabel(items[3], assets.get('lens')), 'Lens');
 assert.equal(defaultLabel(items[4], assets.get('det')), 'Shock tube');
});

test('numbering follows the beam and identical labels share a number', () => {
 const g = diagramGroups(items, null, assetOf, beamOrder(beams));
 assert.deepEqual(g.map(x => [x.number, x.label, x.items.length]), [[1, 'Laser (2.7 µm)', 1], [2, 'Plane mirror', 2], [3, 'Lens', 1], [4, 'Shock tube', 1]]);
 const separate = diagramGroups(items, {options:{group:false, start:5}, entries:{F:{hidden:true}, D:{label:'NO detector'}}}, assetOf, beamOrder(beams));
 assert.deepEqual(separate.map(x => [x.number, x.label]), [[5, 'Laser (2.7 µm)'], [6, 'Plane mirror'], [7, 'Plane mirror'], [8, 'NO detector']]);
});

test('free beam points count for the nearest component', () => {
 const free = [{points:[{x:-140, y:26, z:5}, {x:3, y:26, z:2}, {x:300, y:26, z:300}]}];
 assert.deepEqual(beamOrder(free, items), ['L', 'M1']);
});

test('rotation maps the page plane both ways', () => {
 for (const r of [0, 90, 180, 270]) { const [u, v] = toPlane(12, -7, r), [x, z] = fromPlane(u, v, r); assert.ok(Math.abs(x - 12) < 1e-9 && Math.abs(z + 7) < 1e-9); }
 assert.deepEqual(toPlane(10, 0, 90).map(n => n + 0), [0, 10]); // +x turns to point down the page
});

test('callouts do not overlap each other', () => {
 const t = [0, 1, 2, 3, 4, 5].map(k => ({key:'k' + k, itemId:'k' + k, x:k * 4, y:0, r:3, hw:3, hh:3}));
 const spots = [...placeCallouts(t, {center:{x:10, y:0}, gap:1}).values()];
 for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) assert.ok(Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y) >= 6 - 1e-6);
 const fixed = placeCallouts([{key:'a', itemId:'a', x:0, y:0, r:1, hw:1, hh:1, fixed:{x:50, y:60}}]);
 assert.deepEqual(fixed.get('a'), {x:50, y:60});
});

test('layout sizes the figure for the journal column and lists the legend', () => {
 const rects = items.filter(i => i.id !== 'H').map(i => ({id:i.id, x:i.x, y:i.z, w:40, h:40}));
 const groups = diagramGroups(items, null, assetOf, beamOrder(beams));
 const lay = layoutDiagram({rects, lines:beamPolylines(beams, items), groups, options:{figure:'single', dpi:600}, measure});
 assert.equal(lay.size.w, 2100);
 assert.equal(lay.callouts.length, 5);
 assert.ok(lay.image.w < 2100); // legend on the right
 const texts = lay.prims.filter(p => p.t === 'text').map(p => p.text);
 for (const s of ['1', '2', '3', '4', '1.', 'Laser (2.7 µm)', 'Plane mirror', 'Shock tube']) assert.ok(texts.includes(s), s);
 assert.equal(texts.filter(t => t === '2').length, 2); // both mirrors carry number 2
 assert.ok(lay.prims.some(p => p.t === 'arrow'));
 assert.ok(texts.some(t => /^\d+ mm$/.test(t)));
 // Every callout sits inside the picture.
 for (const c of lay.callouts) assert.ok(c.x - c.hw >= -1 && c.x + c.hw <= lay.image.w + 1 && c.y - c.hh >= -1 && c.y + c.hh <= lay.image.h + 1);
 const below = layoutDiagram({rects, lines:[], groups, options:{legend:'bottom', callouts:'numbers'}, measure});
 assert.equal(below.image.w, below.size.w);
 assert.ok(below.size.h > below.image.h);
 const svg = diagramSVG(lay, {image:'data:image/png;base64,AAAA'});
 assert.ok(svg.startsWith('<svg') && svg.includes('Laser (2.7 µm)') && svg.includes('<image'));
 const none = layoutDiagram({rects, lines:[], groups, options:{callouts:'none', scaleBar:false}, measure});
 assert.equal(none.prims.length, 0);
});

test('PNG files carry the chosen print resolution', () => {
 const png = new Uint8Array(45); png.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
 const out = withPngDpi(png, 600), dv = new DataView(out.buffer);
 assert.equal(out.length, 66);
 assert.equal(String.fromCharCode(...out.subarray(37, 41)), 'pHYs');
 assert.equal(dv.getUint32(41), Math.round(600 / .0254));
 assert.equal(niceLength(73), 50);
});

test('diagram settings validate and save with the project', () => {
 assert.deepEqual(validateDiagram({options:{style:'outline', junk:1}, entries:{M1:{label:'PM', dx:5, dz:-3}, gone:{label:'x'}}}, new Set(['M1'])), {options:{style:'outline'}, entries:{M1:{label:'PM', dx:5, dz:-3}}});
 assert.throws(() => validateDiagram({options:{style:'watercolour'}}));
 assert.throws(() => validateDiagram({options:{fontPt:100}}));
 assert.throws(() => validateDiagram({entries:{a:{dx:1}}}));
 const base = {format:'optical-workbench', version:2, board:{...DEFAULT_BOARD}, assets:[], items:[{id:'a', name:'Mirror', assetId:'builtin-mirror', x:0, z:0, y:0, angle:0}]};
 assert.equal('diagram' in validateProject(base), false);
 const p = validateProject({...base, diagram:{options:{callouts:'labels'}, entries:{a:{label:'PM'}}}});
 assert.deepEqual(p.diagram, {options:{callouts:'labels'}, entries:{a:{label:'PM'}}});
});
