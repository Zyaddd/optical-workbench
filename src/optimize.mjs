// Optimise a physical beam for a goal: slide parts along the beam (lenses, windows, filters, cells, and the
// part at the end) and choose a multipass cell's pass count, one setting at a time, a few rounds over all of
// them. Pure functions over items and beams: the caller applies the changes it returns in its own way
// (the app moves post holders with translateItems, the MCP server with moveTo).
import {traceGaussian, itemOptics, herriottDesign, herriottCell, RING_SHARE, MAX_PASSES, fmtPower, pct} from './optics.mjs';
import {localToWorld} from './planning.mjs';

export const GOALS = {
 power:{label:'Most light at the end', what:'light at the end'},
 absorption:{label:'Strongest gas signal', what:'gas absorption signal'},
 spot:{label:'Smallest spot at the end', what:'spot at the end'},
};
// The number a goal maximises, from a trace. −Infinity when the beam does not give it.
export function goalValue(t, goal) {
 if (!t?.ok) return -Infinity;
 if (goal === 'absorption') {
  if (t.power.gasDelta != null) return t.power.gasDelta;
  const a = t.points.reduce((s, p) => s + (p.gas?.absorbed ?? 0), 0);
  return a > 0 ? a : -Infinity;
 }
 if (goal === 'spot') return -t.end.d;
 return t.power.detected ?? t.power.coupled ?? t.power.end;
}
export const defaultGoal = t => t?.ok && t.points.some(p => p.gas && p.gas.tau > 0) ? 'absorption' : 'power';
export function goalText(goal, v) {
 if (!Number.isFinite(v)) return '–';
 return goal === 'spot' ? (-v < .1 ? (-v * 1000).toFixed(0) + ' µm' : (+(-v).toFixed(2)) + ' mm') : fmtPower(v);
}

const MARGIN = 30;          // mm kept clear of the neighbouring parts when sliding one
const REACH = 300;          // mm the end part may move beyond where it is
const sub = (a, b) => a.map((v, k) => v - b[k]);
const unit = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const lockedChain = (items, i) => { for (let x = i; x; x = x.mount && items.find(h => h.id === x.mount.holderId)) if (x.locked) return true; return false; };

// What may change on this beam, with the range each setting may take.
export function variables(state, beam, assetOf, only) {
 const items = state.items, out = [], pts = beam.points, find = id => items.find(i => i.id === id);
 const world = pts.map(p => { const i = p.itemId && find(p.itemId); const w = i ? localToWorld(i, p) : p; return [w.x, w.z]; });
 const elsewhere = id => (state.beams || []).some(b => b !== beam && b.id !== beam.id && b.points.some(p => p.itemId === id));
 pts.forEach((p, k) => {
  const it = p.itemId && find(p.itemId);
  if (!it || k === 0 || (only && !only.has(it.id)) || lockedChain(items, it)) return;
  const o = itemOptics(it, assetOf(it.assetId)), last = k === pts.length - 1;
  if (o.type === 'gascell' && o.mode === 'multipass') out.push({kind:'passes', id:it.id, name:it.name, length0:o.length});
  if (elsewhere(it.id) || pts.filter(q => q.itemId === it.id).length > 1) return;
  const dirIn = unit(sub(world[k], world[k - 1])), lenIn = Math.hypot(...sub(world[k], world[k - 1]));
  if (lenIn < 1e-6) return;
  let hi;
  if (last) {
   if (!['detector', 'coupler', 'none'].includes(o.type)) return;
   hi = REACH;
   const b = state.board;
   if (b?.width && b?.depth) for (let j = 0; j < 2; j++) if (Math.abs(dirIn[j]) > 1e-9) {
    const edge = (j ? b.depth : b.width) / 2 - 20, t = ((dirIn[j] > 0 ? edge : -edge) - world[k][j]) / dirIn[j];
    hi = Math.min(hi, Math.max(0, t));
   }
  } else {
   if (!['lens', 'window', 'filter', 'gascell'].includes(o.type)) return;
   const dirOut = unit(sub(world[k + 1], world[k]));
   if (dirIn[0] * dirOut[0] + dirIn[1] * dirOut[1] < .9999) return;   // only parts the beam goes straight through
   hi = Math.hypot(...sub(world[k + 1], world[k])) - MARGIN;
  }
  const lo = -(lenIn - MARGIN);
  if (hi > lo + 1) out.push({kind:'position', id:it.id, name:it.name, dir:dirIn, lo:Math.min(0, lo), hi:Math.max(0, hi)});
 });
 return out;
}

function evaluate(state, beam, assetOf, goal) {
 return goalValue(traceGaussian(beam, state.items, assetOf, state.beams), goal);
}
const withItem = (state, id, fn) => ({...state, items:state.items.map(i => i.id === id ? fn(i) : i)});

// One setting at a time: the best value, but the smallest change that gets within 0.1% of it, and none
// when the setting is already within 0.5% of the best.
function pick(samples, current, f0) {
 const best = samples.reduce((a, b) => b.f > a.f ? b : a);
 const near = v => best.f - v >= -1e-12 && best.f - v <= 1e-3 * Math.abs(best.f);
 if (Number.isFinite(f0) && best.f - f0 <= 5e-3 * Math.abs(best.f)) return null;
 const chosen = samples.filter(s => near(s.f)).sort((a, b) => Math.abs(a.x - current) - Math.abs(b.x - current))[0];
 return {best, chosen};
}

function optimisePosition(state, beam, assetOf, goal, v, f0) {
 const it = state.items.find(i => i.id === v.id), at = t => withItem(state, v.id, i => ({...i, x:i.x + v.dir[0] * t, z:i.z + v.dir[1] * t}));
 const f = t => evaluate(at(t), beam, assetOf, goal);
 const n = 160, samples = [{x:0, f:f0}];
 for (let j = 0; j <= n; j++) { const t = v.lo + (v.hi - v.lo) * j / n; samples.push({x:t, f:f(t)}); }
 // Refine around the best sample with a golden-section search.
 const top = samples.reduce((a, b) => b.f > a.f ? b : a), step = (v.hi - v.lo) / n;
 let a = Math.max(v.lo, top.x - step), b = Math.min(v.hi, top.x + step);
 const g = (Math.sqrt(5) - 1) / 2;
 for (let k = 0; k < 40; k++) { const c = b - g * (b - a), d = a + g * (b - a); if (f(c) > f(d)) b = d; else a = c; }
 samples.push({x:(a + b) / 2, f:f((a + b) / 2)});
 const r = pick(samples, 0, f0);
 if (!r) return null;
 const t = r.chosen.x;
 // The range around the new place that keeps 99% of what it gives: how forgiving the alignment is.
 const keep = r.chosen.f - .01 * Math.abs(r.chosen.f), grid = samples.slice(1, n + 2);
 const sorted = grid.slice().sort((p, q) => p.x - q.x), i0 = (k => k < 0 ? sorted.length : k)(sorted.findIndex(s => s.x >= t));
 let lo = t, hi = t;
 for (let j = i0 - 1; j >= 0 && sorted[j].f >= keep; j--) lo = sorted[j].x;
 for (let j = i0; j < sorted.length && sorted[j].f >= keep; j++) hi = sorted[j].x;
 return {state:at(t), value:r.chosen.f, change:{kind:'position', id:v.id, name:v.name, distance:t, move:[v.dir[0] * t, v.dir[1] * t], window:[lo - t, hi - t], item:it}};
}

function optimisePasses(state, beam, assetOf, goal, v, f0) {
 const it = state.items.find(i => i.id === v.id), o = itemOptics(it, assetOf(it.assetId));
 const spec = assetOf(it.assetId)?.cellSpec, ring = (spec?.radius ?? Math.max(4, (o.aperture || 20) / 2)) * RING_SHARE;
 const geo = herriottCell(o, ring), current = geo?.stable && geo.exit ? geo.exit : o.passes || 1;
 const top = geo?.stable ? geo.maxPasses : Math.min(MAX_PASSES, 400);
 const samples = [{x:current, f:f0, patch:null}];
 for (let N = 2; N <= top; N++) {
  let patch = {passes:N};
  if (geo) {
   const d = herriottDesign(o.mirrorRoc, N, o.length);
   // Keep the cell within a quarter of its length, so it still fits where it stands.
   if (!d || Math.abs(d.spacing - (v.length0 ?? o.length)) > .25 * (v.length0 ?? o.length)) continue;
   patch = {passes:N, length:+d.spacing.toFixed(2), M:d.M};
  }
  const {M, ...optics} = patch, next = withItem(state, v.id, i => ({...i, optics:{...o, ...optics}}));
  samples.push({x:N, f:evaluate(next, beam, assetOf, goal), patch, state:next});
 }
 const r = pick(samples, current, f0);
 if (!r?.chosen.patch) return null;
 const {M, ...optics} = r.chosen.patch;
 return {state:r.chosen.state, value:r.chosen.f, change:{kind:'passes', id:v.id, name:v.name, from:current, to:optics.passes, length:geo ? optics.length : null, fromLength:o.length, M, item:it}};
}

// Optimise `beam` for `goal`. `only` limits the parts that may change (a Set of item ids).
export function optimiseBeam(state, beam, assetOf, {goal, only, rounds = 3} = {}) {
 const t0 = traceGaussian(beam, state.items, assetOf, state.beams);
 if (!t0.ok) return {ok:false, reason:t0.error};
 goal = goal || defaultGoal(t0);
 if (!GOALS[goal]) return {ok:false, reason:`Unknown goal ${goal}. Use ${Object.keys(GOALS).join(', ')}.`};
 const before = goalValue(t0, goal);
 if (!Number.isFinite(before)) return {ok:false, reason:goal === 'absorption' ? 'This beam goes through no gas, so there is no gas signal to raise.' : 'This beam has no end to measure.'};
 const vars = variables(state, beam, assetOf, only);
 if (!vars.length) return {ok:false, reason:'Nothing on this beam can change: the optimiser slides lenses, windows, filters, cells and the part at the end along the beam, and sets multipass pass counts. Locked parts and parts on other beams stay put.'};
 let cur = {items:state.items.map(i => ({...i})), beams:state.beams, board:state.board}, value = before;
 const changes = new Map();
 for (let round = 0; round < rounds; round++) {
  let improved = false;
  for (const v0 of vars) {
   const v = v0.kind === 'position' ? variables(cur, beam, assetOf, new Set([v0.id])).find(x => x.kind === 'position') : v0;
   if (!v) continue;
   const r = v.kind === 'position' ? optimisePosition(cur, beam, assetOf, goal, v, value) : optimisePasses(cur, beam, assetOf, goal, v, value);
   if (!r || !(r.value > value)) continue;
   cur = {...cur, items:r.state.items}; value = r.value; improved = true;
   const key = v.kind + ':' + v.id, prev = changes.get(key);
   if (prev && v.kind === 'position') changes.set(key, {...r.change, distance:prev.distance + r.change.distance, move:[prev.move[0] + r.change.move[0], prev.move[1] + r.change.move[1]]});
   else if (prev) changes.set(key, {...r.change, from:prev.from, fromLength:prev.fromLength});
   else changes.set(key, r.change);
  }
  if (!improved) break;
 }
 const list = [...changes.values()].filter(c => c.kind === 'passes' ? c.to !== c.from : Math.abs(c.distance) > .05);
 const after = goalValue(traceGaussian(beam, cur.items, assetOf, cur.beams), goal);
 return {ok:true, goal, before, after, gain:before > 0 ? after / before : null, changes:list, items:cur.items, considered:vars};
}

// One line per change, in plain words.
export function describeChanges(r) {
 return r.changes.map(c => c.kind === 'passes'
  ? `${c.name}: ${c.from} → ${c.to} passes${c.length != null ? `, mirrors ${+c.fromLength.toFixed(1)} → ${+c.length.toFixed(1)} mm apart` : ''}`
  : `${c.name}: moved ${+Math.abs(c.distance).toFixed(1)} mm ${c.distance > 0 ? 'further along' : 'back along'} the beam${c.window[1] - c.window[0] > .05 ? ` (anywhere from ${+c.window[0].toFixed(1)} to +${+c.window[1].toFixed(1)} mm around it keeps 99%)` : ''}`);
}
export function resultText(r) {
 if (!r.ok) return r.reason;
 const what = GOALS[r.goal].what;
 if (!r.changes.length) return `The ${what} is already as good as these parts allow (${goalText(r.goal, r.before)}).`;
 const gain = r.goal === 'spot' ? `${goalText(r.goal, r.before)} → ${goalText(r.goal, r.after)}` : `${goalText(r.goal, r.before)} → ${goalText(r.goal, r.after)} (${(r.after / r.before).toFixed(2)}×)`;
 return `The ${what}: ${gain}.`;
}

// A short plain-language account of what a traced beam does.
export function plainSummary(t) {
 if (!t?.ok) return [];
 const out = [], P = t.power, end = t.end;
 const arrives = P.detected ?? P.coupled ?? P.end, where = P.detected != null ? 'on the detector' : P.coupled != null ? (end.couplerKind === 'pinhole' ? 'through the pinhole' : 'into the fibre') : 'at the end';
 out.push(`${fmtPower(P.start)} leaves the ${P.fromSplitter ? 'splitter' : 'laser'} and ${fmtPower(arrives)} (${pct(arrives / P.start)}) gets ${where}.`);
 const worst = P.losses.filter(l => l.lost > 0).sort((a, b) => b.lost - a.lost)[0];
 if (worst && worst.lost > .05 * P.start) {
  const p = t.points.find(q => q.name === worst.name && q.clip != null);
  const why = p?.gas ? 'its mirrors and the gas' : worst.clip < .95 ? 'the beam is wider than its opening' : 'its coating or glass';
  out.push(`The biggest loss is ${worst.name}, which keeps ${pct(1 - worst.lost / (p?.powerIn || 1))} (${why}).`);
 }
 for (const p of t.points.filter(q => q.gas)) {
  const i = p.insight;
  out.push(`${p.name}: the light travels ${(i.path / 1000).toFixed(2)} m through the gas (${i.passes} pass${i.passes > 1 ? 'es' : ''}), and the gas absorbs ${pct(1 - p.gas.transmission)}.` +
   (i.passes > 1 ? ` That makes the gas signal ${i.signalGain.toFixed(1)}× what one pass gives (the path is ${i.pathGain}× longer, but each mirror bounce loses a little light).` : ''));
  if (i.passes > 1 && i.bestPasses !== i.passes && i.bestGain > i.signalGain * 1.03) out.push(`${p.name}: ${i.bestPasses} passes would give the strongest gas signal with these mirrors (${i.bestGain.toFixed(1)}× one pass).`);
 }
 const spot = end.d < .1 ? (end.d * 1000).toFixed(0) + ' µm' : end.d.toFixed(2) + ' mm';
 if (end.captured != null) out.push(end.captured >= .995 ? `The whole beam lands on the detector (Ø ${spot} on a ${end.activeArea} mm element).` : end.captured >= .9 ? `${pct(end.captured)} of the beam lands on the ${end.activeArea} mm detector (the beam is Ø ${spot} there).` : `Only ${pct(end.captured)} of the beam lands on the ${end.activeArea} mm detector: the beam is Ø ${spot} there.`);
 if (end.signal != null) out.push(`The detector gives ${end.signal >= 1 ? end.signal.toPrecision(3) + ' V' : +(end.signal * 1000).toPrecision(3) + ' mV'}${P.gasSignal != null ? `, and the gas lowers it by ${P.gasSignal >= 1 ? P.gasSignal.toPrecision(3) + ' V' : +(P.gasSignal * 1000).toPrecision(3) + ' mV'} (that drop is the gas signal)` : ''}${end.saturated ? ', but it is saturated' : ''}.`);
 return out;
}
