import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as W from '../mcp/workbench.mjs';
import {traceGaussian} from '../src/optics.mjs';
import {optimiseBeam, goalValue, plainSummary, describeChanges, resultText} from '../src/optimize.mjs';

const arr = j => Array.isArray(j) ? j : [j];
const lib = W.createLibrary(['default-components', 'lasers', 'lens', 'holder', 'optics-parts'].flatMap(f => arr(JSON.parse(fs.readFileSync(new URL(`../src/${f}.json`, import.meta.url), 'utf8')))));
const a = W.assetOf(lib);
const trace = p => traceGaussian(p.beams[0], p.items, a, p.beams);
const gasBench = () => {
 const p = W.emptyProject('Gas');
 W.buildPath(p, lib, {start:{component:'laser', x:-200, z:-100, direction:'right', optics:{wavelength:4.5, power:25}}, steps:[
  {component:'lens', distance:60, optics:{focal:200, material:'CaF2', designWavelength:.588}},
  {component:'multipass-cell', distance:180, optics:{passes:30, length:80, ppm:1000, sigma:1e-19}},
  {component:'mirror', distance:140, turn:'right'},
  {component:'parabolic-mirror', distance:120, turn:'right', optics:{focal:50.8}},
  {component:'detector', distance:80, optics:{responsivity:300, maxOutput:10}}]});
 return p;
};

test('optimising for light at the end puts the detector where the most light lands', () => {
 const p = W.emptyProject('Lens');
 W.buildPath(p, lib, {start:{component:'laser', x:-150, z:0, optics:{wavelength:4.5, diameter:4}}, steps:[{component:'lens', distance:60, optics:{focal:75, material:'CaF2', designWavelength:.588}}, {component:'detector', distance:200, optics:{activeArea:.5}}]});
 const before = trace(p);
 const r = optimiseBeam(p, p.beams[0], a, {goal:'power'});
 assert.ok(r.ok);
 assert.ok(r.after > before.power.detected * 1.5, `${before.power.detected} → ${r.after}`);
 assert.ok(r.changes.length >= 1);
 // Applying it through the MCP model gives the same number.
 const out = W.optimise(p, lib, new Map(), {goal:'power'});
 assert.ok(Math.abs(goalValue(trace(p), 'power') - r.after) <= 1e-9 * r.after);
 assert.match(out.text, /light at the end: .* → .*×/);
 assert.deepEqual(W.checks(p, lib).filter(n => /runs through|overlap/.test(n)), []);
});

test('the smallest spot goal shrinks the spot, and locked parts stay put', () => {
 const p = W.emptyProject('Spot');
 W.buildPath(p, lib, {start:{component:'laser', x:-150, z:0}, steps:[{component:'lens', distance:60, optics:{focal:100, material:'CaF2', designWavelength:.588}}, {component:'detector', distance:200}]});
 const r = optimiseBeam(p, p.beams[0], a, {goal:'spot'});
 assert.ok(r.ok && r.after > r.before, `${r.before} → ${r.after}`);
 W.findItem(p, 'detector-1').locked = true;
 W.findItem(p, 'lens-1').locked = true;
 const none = optimiseBeam(p, p.beams[0], a, {goal:'spot'});
 assert.equal(none.ok, false);
 assert.match(none.reason, /Nothing on this beam can change/);
});

test('optimising the gas signal raises it, and sets a multipass cell to the best pass count', () => {
 const p = gasBench(), before = trace(p).power.gasDelta;
 const cell = W.findItem(p, 'multipass-cell-1');
 const only = optimiseBeam(p, p.beams[0], a, {goal:'absorption', only:new Set([cell.id])});
 assert.ok(only.ok);
 assert.ok(only.changes.some(x => x.kind === 'passes'), 'changes the pass count');
 assert.ok(only.after > before);
 const all = optimiseBeam(p, p.beams[0], a, {goal:'absorption'});
 assert.ok(all.after >= only.after * .999);
 assert.match(describeChanges(all).join('\n'), /passes/);
 assert.match(resultText(all), /gas absorption signal/);
 // No gas: no gas signal to raise.
 const q = W.emptyProject('No gas');
 W.buildPath(q, lib, {start:{component:'laser', x:-150, z:0}, steps:[{component:'detector', distance:100}]});
 assert.match(optimiseBeam(q, q.beams[0], a, {goal:'absorption'}).reason, /no gas/);
});

test('with the mirror radius set, a new pass count comes with the mirror spacing that gives it', () => {
 const p = gasBench(), cell = W.findItem(p, 'multipass-cell-1');
 W.setOptics(cell, a(cell.assetId), {mirrorRoc:100, length:80, passes:20});
 const r = optimiseBeam(p, p.beams[0], a, {goal:'absorption', only:new Set([cell.id])});
 assert.ok(r.ok);
 const c = r.changes.find(x => x.kind === 'passes');
 assert.ok(c, 'changes the pass count');
 assert.ok(c.length != null && Math.abs(c.length - 80) <= 20, `spacing ${c.length}`);
 W.setOptics(cell, a(cell.assetId), {passes:c.to, length:c.length});
 assert.equal(trace(p).points.find(x => x.gas).insight.passes, c.to, 'the geometry gives the chosen passes');
});

test('analysis explains each beam in plain words and offers what the optimiser could gain', () => {
 const p = gasBench(), t = trace(p);
 const story = plainSummary(t).join(' ');
 assert.match(story, /25 mW leaves the laser/);
 assert.match(story, /travels 2\.40 m through the gas \(30 passes\)/);
 const text = W.analyze(p, lib, new Map());
 assert.match(text, /In short: /);
 assert.match(text, /Path 30 passes × 80 mm = 2\.4 m, 30× one pass/);
 // Far too many passes for these mirrors: the analysis says so and offers the fix.
 const cell = W.findItem(p, 'multipass-cell-1');
 W.setOptics(cell, a(cell.assetId), {passes:150});
 const more = W.analyze(p, lib, new Map());
 assert.match(more, /the gas signal peaks at \d+ passes/);
 assert.match(more, /Idea: optimize_setup with goal "absorption" would raise the gas absorption signal/);
});
