// Optics in the editor: the Optics section in Properties, the physical-beam summary for a beam,
// the hourglass beam mesh, the hover readout and the practice bench used by the optics tour.
import {inRange, MATERIALS, LENS_PRESETS, OPTIC_TYPES, itemOptics, defaultOptics, validateOptics, laserBeam, effectiveFocal, refractiveIndex, traceGaussian, beamAt, envelopeSamples, focusOnEndpoint, COATINGS, LENS_COATINGS, mirrorReflectance, lensTransmission, surfaceReflectance, fmtPower, pct} from './optics.mjs';
import {translateItems} from './transforms.mjs';
import {scientific} from './mode.mjs';
import {DEFAULT_BOARD} from './core.mjs';

const fmt = (v, digits = 2) => !Number.isFinite(v) ? '∞' : Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(digits);
const mm = v => fmt(v) + ' mm';
const volts = v => v >= 1 ? v.toPrecision(3) + ' V' : +(v * 1000).toPrecision(3) + ' mV';
const spot = d => d < .1 ? (d * 1000).toFixed(0) + ' µm' : mm(d);
const el = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); e.append(...children.filter(c => c != null)); return e; };
const emit = (type, detail) => document.dispatchEvent(new CustomEvent(type, {detail}));

export function traceRoute(b, items, catalog) {
 try { return traceGaussian(b, items, id => catalog.get(id)); } catch (e) { return {ok:false, error:e.message}; }
}

// ---------- 3D: the beam as a tube whose radius follows the Gaussian envelope ----------
function tubeGeometry(THREE, a, b, samples, radius, s0, radial = 28) {
 const A = new THREE.Vector3(...a), dir = new THREE.Vector3(...b).sub(A).normalize();
 const ref = Math.abs(dir.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
 const u = new THREE.Vector3().crossVectors(dir, ref).normalize(), v = new THREE.Vector3().crossVectors(dir, u);
 const pos = [], uv = [], index = [], c = new THREE.Vector3();
 for (const {t, d} of samples) {
  const r = radius(d);
  c.copy(A).addScaledVector(dir, t);
  for (let j = 0; j <= radial; j++) {
   const th = j / radial * Math.PI * 2, x = Math.cos(th) * r, y = Math.sin(th) * r;
   pos.push(c.x + u.x * x + v.x * y, c.y + u.y * x + v.y * y, c.z + u.z * x + v.z * y);
   uv.push(j / radial, (s0 + t) / 22);
  }
 }
 for (let i = 0; i < samples.length - 1; i++) for (let j = 0; j < radial; j++) {
  const p = i * (radial + 1) + j, q = p + radial + 1;
  index.push(p, p + 1, q, p + 1, q + 1, q);
 }
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
 g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
 g.setIndex(index);
 return g;
}

export function physicsMeshes(THREE, b, trace, {flowBase, glowBase, preview = false}) {
 const out = [], opacity = b.opacity ?? 1;
 if (!trace?.ok || opacity === 0) return out;
 const core = d => Math.max(.06, Math.min(150, d / 2));
 for (const {segment, samples} of envelopeSamples(trace)) {
  const tag = {routeId:b.id, physics:true, segment, trace};
  for (const [scale, alpha] of [[1, 1], [1.35, .26], [2.4, .07]]) {
   const radius = d => core(d) + (scale - 1) * Math.max(.5, Math.min(core(d), 2.5));
   const m = new THREE.Mesh(tubeGeometry(THREE, segment.a, segment.b, samples, radius, segment.s0),
    new THREE.MeshBasicMaterial({color:b.color, transparent:true, opacity:opacity * alpha * (preview ? .5 : 1), depthWrite:false, side:THREE.DoubleSide, blending:scale === 1 ? THREE.NormalBlending : THREE.AdditiveBlending}));
   Object.assign(m.userData, tag);
   out.push(m);
  }
  if (!preview && flowBase) {
   const tex = flowBase.clone(); tex.needsUpdate = true;
   const f = new THREE.Mesh(tubeGeometry(THREE, segment.a, segment.b, samples, d => core(d) * 1.06 + .02, segment.s0, 20),
    new THREE.MeshBasicMaterial({color:b.color, map:tex, transparent:true, opacity, depthWrite:false, blending:THREE.AdditiveBlending}));
   f.material.addEventListener('dispose', () => tex.dispose());
   Object.assign(f.userData, tag, {flow:true});
   out.push(f);
  }
 }
 // Focus markers: a thin ring and glow where the beam is narrowest.
 for (const w of trace.waists) {
  const seg = trace.segments.find(s => s.index === w.segment);
  const dir = new THREE.Vector3(...seg.b).sub(new THREE.Vector3(...seg.a)).normalize();
  const r = Math.max(.6, w.d / 2) + 1.6;
  const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + .45, 48), new THREE.MeshBasicMaterial({color:'#ffffff', transparent:true, opacity:.85 * opacity, side:THREE.DoubleSide, depthWrite:false}));
  ring.position.set(...w.world); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  ring.userData.routeId = b.id;
  out.push(ring);
  if (glowBase && !preview) {
   const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowBase, color:b.color, transparent:true, opacity:.9 * opacity, depthWrite:false, blending:THREE.AdditiveBlending}));
   glow.position.set(...w.world); glow.scale.set(9, 9, 1); glow.renderOrder = 29; glow.userData.routeId = b.id;
   out.push(glow);
  }
 }
 return out;
}

// ---------- Focus helper ----------
export function moveEndpointToFocus(b, state, catalog) {
 const trace = traceRoute(b, state.items, catalog);
 if (!trace.ok) throw Error(trace.error);
 const f = focusOnEndpoint(trace);
 if (!f?.ok) throw Error(f?.reason || 'No focus found.');
 const end = b.points.at(-1), item = end.itemId && state.items.find(i => i.id === end.itemId);
 const [dx, dy, dz] = f.move;
 if (item) {
  if (item.locked) throw Error(item.name + ' is locked. Unlock it to move it to the focus.');
  translateItems(state.items, [item.id], dx, dz, dy, catalog);
 } else { end.x += dx; end.y += dy; end.z += dz; }
 return f;
}

// ---------- Route summary shown in the beam's Properties ----------
export function routeOpticsSummary(b, trace, {onFocus}) {
 const box = el('div', {id:'routeOptics', className:'opticsSummary'});
 if (!trace.ok) { box.append(el('p', {className:'opticsWarn', textContent:trace.error})); return box; }
 const L = trace.laser;
 box.append(el('div', {className:'opticsLine strong', textContent:`${L.wavelength} µm · waist Ø ${spot(L.waistDiameter)} · divergence ${fmt(L.divergence)} mrad · M² ${L.m2}`}));
 const list = el('ol', {className:'opticsPath'});
 for (const p of trace.points) {
  const parts = [`${fmt(p.s, 1)} mm`, `Ø ${spot(p.d)}`];
  if (p.f != null) parts.push(`f ${fmt(p.f, 1)} mm`, p.focus > 0 ? (p.focusReached ? `focus ${fmt(p.focus, 1)} mm after (Ø ${spot(p.focusDiameter)})` : 'next optic comes before the focus') : 'beam diverges after it');
  if (p.activeArea) parts.push(p.d <= p.activeArea ? `fits the ${p.activeArea} mm detector` : `larger than the ${p.activeArea} mm detector`);
  if (p.index === 0) parts.push(fmtPower(p.powerOut));
  else if (p.clip != null) parts.push(`${fmtPower(p.powerOut)} after it${p.clip < .995 ? ` (aperture passes ${pct(p.clip)})` : ''}`);
  else if (p.detectedPower != null) parts.push(`${fmtPower(p.detectedPower)} on the active area${p.signal != null ? ` → ${volts(p.signal)}` : ''}`);
  list.append(el('li', {}, el('b', {textContent:p.name}), el('span', {textContent:' · ' + parts.join(' · ')})));
 }
 box.append(list);
 const P = trace.power, arrives = P.detected ?? P.end;
 box.append(el('div', {id:'routePower', className:'opticsLine strong', textContent:`Power: ${fmtPower(P.start)} from the laser → ${fmtPower(arrives)} ${P.detected != null ? 'on the detector' : 'at the endpoint'} (${pct(arrives / P.start)})`}));
 for (const w of trace.waists) box.append(el('div', {className:'opticsLine', textContent:`Focus at ${fmt(w.s, 1)} mm from the laser · Ø ${spot(w.d)} · depth of focus ±${fmt(w.zR, 1)} mm`}));
 const f = focusOnEndpoint(trace);
 const button = el('button', {id:'routeFocus', textContent:'Move endpoint to the focus', disabled:!f?.ok});
 button.title = f?.ok ? `Moves the endpoint ${fmt(Math.hypot(...f.move), 1)} mm along the last leg so the focus lands on it.` : (f?.reason || '');
 button.onclick = onFocus;
 box.append(button);
 if (f && !f.ok) box.append(el('p', {className:'muted', textContent:f.reason}));
 for (const w of trace.warnings) box.append(el('p', {className:'opticsWarn', textContent:w}));
 box.append(el('p', {className:'muted', textContent:'Paraxial Gaussian model with thin lenses. Power includes aperture clipping, coatings and Fresnel loss (typical coating curves); aberrations, scattering and absorption in the glass are not included.'}));
 return box;
}

// ---------- Properties: the Optics section of a selected component ----------
export function createOpticsUI(api) {
 const {THREE, $, camera, renderer, viewport, getState, item, catalog, checkpoint, commit, toast, setSelected, view, routeUI} = api;
 const section = el('section', {className:'opticsSection'});
 section.setAttribute('aria-label', 'Optics');
 const anchor = $('selectedPanel').querySelector('.mirrorOpacity');
 if (anchor) anchor.after(section); else $('selectedPanel').prepend(section);
 let built = '', lastSelected = null;

 const routesThrough = id => (getState().beams || []).filter(b => b.points.some(p => p.itemId === id));
 const sceneWavelength = () => {
  for (const i of getState().items) { const o = itemOptics(i, catalog.get(i.assetId)); if (o.type === 'laser') return o.wavelength; }
  return defaultOptics('laser').wavelength;
 };
 function apply(i, patch, key) {
  const next = {...itemOptics(i, catalog.get(i.assetId)), ...patch};
  let clean;
  try { clean = validateOptics(next); } catch (e) { toast(e.message + ' Check the value you entered.'); built = ''; sync(); return; }
  if (JSON.stringify(clean) === JSON.stringify(i.optics)) return;
  checkpoint(); i.optics = clean; commit();
  emit('workbench:optics', {key, type:clean.type});
 }
 function field(i, o, key, label, {step = 'any', min, max, unit = '', hint, optional = false} = {}) {
  const input = el('input', {id:'optics' + key[0].toUpperCase() + key.slice(1), type:'number', step, value:o[key] == null ? '' : String(o[key])});
  if (min != null) input.min = min; if (max != null) input.max = max;
  if (optional) input.placeholder = 'From datasheet';
  input.onchange = () => {
   if (optional && input.value.trim() === '') { apply(i, {[key]:undefined}, key); return; }
   const v = Number(input.value); if (input.value.trim() === '' || !Number.isFinite(v)) { built = ''; sync(); return; } apply(i, {[key]:v}, key);
  };
  const wrap = el('label', {}, label + (unit ? ` (${unit})` : ''), input);
  if (hint) wrap.title = hint;
  return wrap;
 }
 function mirrorCoating(i, o, grid) {
  grid.append(select('opticsCoating', 'Coating', Object.entries(COATINGS).map(([k, c]) => [k, c.name]), o.coating || 'gold', v => apply(i, {coating:v}, 'coating')));
  if (o.coating === 'custom') grid.append(field(i, o, 'reflectance', 'Reflectance', {unit:'%', min:0, max:100, hint:'From the coating datasheet at your wavelength.'}));
 }
 function select(id, label, options, value, onchange) {
  const s = el('select', {id});
  for (const [v, text] of options) s.append(el('option', {value:v, textContent:text}));
  s.value = value; s.onchange = () => onchange(s.value);
  return el('label', {}, label, s);
 }
 function build(i) {
  const o = itemOptics(i, catalog.get(i.assetId));
  section.replaceChildren(el('h3', {textContent:'Optics'}));
  section.append(select('opticsType', 'Optical role', Object.entries(OPTIC_TYPES), o.type, v => { const fresh = defaultOptics(v); checkpoint(); i.optics = validateOptics(fresh); commit(); emit('workbench:optics', {key:'type', type:v}); }));
  const grid = el('div', {className:'opticsFields'});
  if (o.type === 'laser') {
   grid.append(field(i, o, 'wavelength', 'Wavelength', {unit:'µm', min:.2, max:30, hint:'Centre wavelength from the laser datasheet.'}));
   grid.append(select('opticsSpec', 'Beam size given as', [['waist', 'Waist diameter'], ['divergence', 'Full divergence angle']], o.spec, v => apply(i, {spec:v}, 'spec')));
   grid.append(o.spec === 'divergence' ? field(i, o, 'divergence', 'Full divergence', {unit:'mrad', min:.001, hint:'Full angle of the far-field beam, 1/e².'}) : field(i, o, 'diameter', 'Waist diameter, 1/e²', {unit:'mm', min:.001, hint:'Diameter at the beam’s narrowest point (the collimated beam size for a collimated laser).'}));
   grid.append(field(i, o, 'm2', 'Beam quality M²', {min:1, max:50, hint:'1 = perfect Gaussian. QCLs and ICLs are typically 1.1–2.'}));
   grid.append(field(i, o, 'power', 'Output power', {unit:'mW', min:0, hint:'Optical power leaving the laser, from its datasheet or a power meter.'}));
   grid.append(field(i, o, 'waistOffset', 'Waist position', {unit:'mm', hint:'Distance from the emission point to the waist along the beam. Negative = behind the aperture.'}));
  } else if (o.type === 'lens') {
   const match = LENS_PRESETS.findIndex(p => p.material === o.material && p.focal === o.focal && p.designWavelength === o.designWavelength);
   section.append(select('opticsPreset', 'Catalogue lens', [['-1', 'Custom lens'], ...LENS_PRESETS.map((p, k) => [String(k), p.label])], String(match), v => { const p = LENS_PRESETS[Number(v)]; if (p) apply(i, {material:p.material, focal:p.focal, designWavelength:p.designWavelength, aperture:p.aperture}, 'preset'); }));
   grid.append(field(i, o, 'focal', 'Focal length', {unit:'mm', hint:'As printed on the lens: effective focal length at the design wavelength. Negative for a diverging lens.'}));
   grid.append(field(i, o, 'designWavelength', 'Specified at', {unit:'µm', min:.2, max:30, hint:'Wavelength at which the catalogue focal length is quoted.'}));
   grid.append(select('opticsMaterial', 'Material', Object.entries(MATERIALS).map(([k, m]) => [k, m.name]), o.material, v => apply(i, {material:v, ...(v !== 'ideal' && !inRange(v, o.designWavelength) ? {designWavelength:MATERIALS[v].spec} : {})}, 'material')));
   grid.append(select('opticsLensCoating', 'Coating', Object.entries(LENS_COATINGS), o.coating || 'ar', v => apply(i, {coating:v}, 'coating')));
   grid.append(field(i, o, 'aperture', 'Clear aperture', {unit:'mm', min:.1}));
  } else if (o.type === 'parabolic') {
   grid.append(field(i, o, 'focal', 'Reflected focal length', {unit:'mm', hint:'Distance from the mirror centre to its focus along the reflected beam.'}));
   grid.append(field(i, o, 'offAxis', 'Off-axis angle', {unit:'°', min:0, max:179, hint:'Design fold angle. Draw the beam at this angle for the quoted focal length to hold.'}));
   grid.append(field(i, o, 'aperture', 'Clear aperture', {unit:'mm', min:.1}));
   mirrorCoating(i, o, grid);
  } else if (o.type === 'spherical') {
   grid.append(field(i, o, 'roc', 'Radius of curvature', {unit:'mm', hint:'From the mirror datasheet. Positive = concave (focusing), negative = convex. Focal length is half of it.'}));
   grid.append(field(i, o, 'aperture', 'Clear aperture', {unit:'mm', min:.1}));
   mirrorCoating(i, o, grid);
  } else if (o.type === 'mirror') {
   grid.append(field(i, o, 'aperture', 'Clear aperture', {unit:'mm', min:.1}));
   mirrorCoating(i, o, grid);
  } else if (o.type === 'detector') {
   grid.append(field(i, o, 'activeArea', 'Active area (square side)', {unit:'mm', min:.001}));
   grid.append(field(i, o, 'rangeMin', 'Range from', {unit:'µm', min:.2, max:30, optional:true, hint:'Shortest wavelength the detector responds to.'}));
   grid.append(field(i, o, 'rangeMax', 'Range to', {unit:'µm', min:.2, max:30, optional:true, hint:'Longest wavelength (cut-off) the detector responds to.'}));
   grid.append(field(i, o, 'responsivity', 'Responsivity', {unit:'V/W', min:0, optional:true, hint:'Output voltage per watt at your wavelength, including the preamplifier.'}));
   grid.append(field(i, o, 'maxOutput', 'Output limit', {unit:'V', min:0, optional:true, hint:'Output voltage at which the detector or its amplifier saturates.'}));
  }
  section.append(grid, el('div', {id:'opticsReadout', className:'opticsReadout'}));
 }
 function readout(i) {
  const o = itemOptics(i, catalog.get(i.assetId)), box = $('opticsReadout'), lines = [], warn = [];
  const traces = routesThrough(i.id).filter(b => b.physics).map(b => ({b, t:traceRoute(b, getState().items, catalog)})).filter(x => x.t.ok);
  const at = x => x.t.points.find(p => x.b.points[p.index]?.itemId === i.id);
  if (o.type === 'laser') {
   const L = laserBeam(o);
   lines.push(`Waist Ø ${spot(L.waistDiameter)} · full divergence ${fmt(L.divergence)} mrad · ${fmtPower(o.power)}`, `Rayleigh range ${mm(L.zR)}: the beam stays within √2 of its waist size over this distance.`);
  } else if (o.type === 'lens') {
   const lambda = traces[0]?.t.laser.wavelength ?? sceneWavelength();
   const f = effectiveFocal(o, lambda);
   lines.push(o.material === 'ideal' ? `f = ${mm(f)} at every wavelength.` : `At ${lambda} µm: n = ${refractiveIndex(o.material, lambda).toFixed(4)} · f = ${mm(f)} (label ${mm(o.focal)} at ${o.designWavelength} µm)`);
   if (o.material === 'ideal') lines.push('Ideal lens: no surface loss.');
   else if (o.coating === 'uncoated') lines.push(`Uncoated: reflects ${pct(surfaceReflectance(o, lambda))} at each surface, so ${pct(lensTransmission(o, lambda))} gets through.`);
   else lines.push(`AR coated: about ${pct(lensTransmission(o, lambda))} gets through.`);
   if (o.material !== 'ideal' && !inRange(o.material, lambda)) lines.push(`${MATERIALS[o.material].name} is outside its data range (${MATERIALS[o.material].range.join('–')} µm) at ${lambda} µm and may not transmit there.`);
  } else if (o.type === 'parabolic') lines.push(`Focuses a collimated beam ${mm(o.focal)} from the mirror, with no colour shift.`);
  else if (o.type === 'spherical') lines.push(`Focal length R/2 = ${mm(o.roc / 2)}, the same at every wavelength.`);
  else if (o.type === 'mirror') lines.push('Flat: folds the beam with no focusing power. For a curved mirror, set the role to Concave (spherical) mirror.');
  if (['mirror', 'spherical', 'parabolic'].includes(o.type)) {
   const lambda = traces[0]?.t.laser.wavelength ?? sceneWavelength();
   lines.push(`Reflects ${pct(mirrorReflectance(o, lambda))} at ${lambda} µm (${o.coating === 'custom' ? 'set reflectance' : COATINGS[o.coating || 'gold'].name.toLowerCase() + ', typical'}).`);
  }
  if (o.type === 'detector' && o.responsivity == null) lines.push('Add the range, responsivity and output limit from the datasheet to see the signal and check for saturation.');
  else if (o.type === 'none') lines.push('Beam points on this part only fold or end the path. Set a role to give it optical power.');
  for (const x of traces) {
   const p = at(x);
   if (!p) continue;
   if (p.incidence != null && p.incidence > .5) lines.push(`${x.b.name}: ${fmt(p.incidence, 1)}° off-axis → f ${fmt(p.fTangential, 1)} mm in the fold plane, ${fmt(p.fSagittal, 1)} mm across it.`);
   if (o.type === 'laser') lines.push(`${x.b.name}: starts here.`);
   else if (p.f != null) lines.push(`${x.b.name}: arrives Ø ${spot(p.d)} → ${p.focus > 0 ? (p.focusReached ? `focus ${fmt(p.focus, 1)} mm after, Ø ${spot(p.focusDiameter)}` : 'next optic is before the focus') : 'diverges after it'}`);
   else lines.push(`${x.b.name}: Ø ${spot(p.d)} here${p.activeArea ? (p.d <= p.activeArea ? ' · fits the active area' : ' · larger than the active area') : ''}`);
   if (p.clip != null) lines.push(`${x.b.name}: ${fmtPower(p.powerIn)} in → ${fmtPower(p.powerOut)} out${p.clip < .995 ? ` · the aperture passes ${pct(p.clip)}` : ''}`);
   else if (p.detectedPower != null) lines.push(`${x.b.name}: ${fmtPower(p.powerIn)} arrives · ${pct(p.captured)} on the active area = ${fmtPower(p.detectedPower)}${p.signal != null ? ` → ${volts(p.signal)}${p.saturated ? ', saturated' : ''}` : ''}`);
   for (const w of x.t.warnings) if (w.startsWith(p.name + ':') && !/off-axis, so the focus is astigmatic|reflects .* at each surface/.test(w)) { const t = w.slice(p.name.length + 2); warn.push(t[0].toUpperCase() + t.slice(1)); }
  }
  const ends = traces.filter(x => x.b.points.at(-1).itemId === i.id);
  if (o.type !== 'laser' && !traces.length) lines.push(routesThrough(i.id).length ? 'Turn on Physical beam for a beam that uses this part to see sizes here.' : 'No beam uses this part yet. Press Beam and click the laser, this part and the endpoint.');
  box.replaceChildren(...lines.map(t => el('p', {textContent:t})), ...[...new Set(warn)].map(t => el('p', {className:'opticsWarn', textContent:t})));
  if (ends.length) {
   const b = el('button', {id:'opticsToFocus', textContent:'Move to the focus'});
   b.onclick = () => focusRoute(ends[0].b);
   box.append(b);
  }
 }
 function focusRoute(b) {
  try {
   checkpoint();
   const f = moveEndpointToFocus(b, getState(), catalog);
   commit();
   toast(`Endpoint moved ${fmt(Math.hypot(...f.move), 1)} mm. It now sits at the focus: Ø ${spot(f.diameter)}.`);
   emit('workbench:optics', {key:'focus'});
  } catch (e) { toast(e.message); }
 }
 function sync() {
  const i = item(), o = i && itemOptics(i, catalog.get(i.assetId));
  section.hidden = !i || !scientific();
  if (i?.id !== lastSelected) { lastSelected = i?.id ?? null; if (i) emit('workbench:optics-select', o.type); }
  if (!i) return;
  const signature = JSON.stringify([i.id, o]);
  if (signature !== built && !section.contains(document.activeElement)) { built = signature; build(i); }
  readout(i);
 }

 // Hover readout over physical beams.
 const tip = el('div', {className:'beamReadout', hidden:true});
 viewport.append(tip);
 const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
 let pending = null, hovered = false;
 renderer.domElement.addEventListener('pointermove', e => { pending = e; requestAnimationFrame(hover); });
 renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; });
 function hover() {
  const e = pending; pending = null;
  if (!e || e.buttons || routeUI.isDrawing() || !scientific()) { tip.hidden = true; return; }
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(routeUI.beamMeshes(), false).find(h => h.object.userData.physics);
  if (!hit) { tip.hidden = true; return; }
  const {segment, trace, routeId} = hit.object.userData, b = (getState().beams || []).find(r => r.id === routeId);
  const A = new THREE.Vector3(...segment.a), dir = new THREE.Vector3(...segment.b).sub(A).normalize();
  const s = segment.s0 + Math.max(0, Math.min(segment.length, hit.point.clone().sub(A).dot(dir)));
  const here = beamAt(trace, s), next = trace.waists.find(w => w.s > s);
  tip.replaceChildren(
   el('strong', {textContent:`${b?.name || 'Beam'} · ${trace.laser.wavelength} µm`}),
   el('span', {textContent:`Ø ${spot(here.d)} (1/e²) · ${fmt(s, 1)} mm from the laser · ${fmtPower(here.segment.power)}`}),
   el('span', {textContent:!Number.isFinite(here.R) || Math.abs(here.R) > 1e5 ? 'Wavefront flat (at a waist)' : `Wavefront radius ${fmt(here.R, 0)} mm, ${here.R > 0 ? 'diverging' : 'converging'}`}),
   next ? el('span', {textContent:`Focus ${fmt(next.s - s, 1)} mm ahead · Ø ${spot(next.d)}`}) : null);
  tip.hidden = false;
  const vr = viewport.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX - vr.left + 16, vr.width - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.max(8, e.clientY - vr.top - tip.offsetHeight - 12) + 'px';
  if (!hovered) { hovered = true; emit('workbench:optics-hover'); }
 }

 // A small, complete bench for the optics tour: laser → lens → detector at one beam height.
 function buildPractice() {
  const state = getState(), need = ['supplied-nanoplus', 'default-lens', 'default-vigo-detector'];
  if (need.some(id => !catalog.get(id))) { toast('The practice parts are still loading. Try again in a moment.'); return null; }
  checkpoint();
  const id = () => globalThis.crypto?.randomUUID?.() || 'id-' + Math.random().toString(36).slice(2);
  // Heights put every optical centre 26 mm above the board: ICL lens 25 mm + 1, lens centre 26, detector window 20 mm + 6.
  const laser = {id:id(), name:'ICL laser', assetId:'supplied-nanoplus', x:-165.1, z:12.7, y:1, angle:0, locked:false, partNumber:''};
  const lens = {id:id(), name:'Lens L1', assetId:'default-lens', x:-12.7, z:12.7, y:0, angle:0, locked:false, partNumber:'', optics:{type:'lens', focal:100, material:'ZnSe', designWavelength:10.6, aperture:25.4}};
  const det = {id:id(), name:'MCT detector', assetId:'default-vigo-detector', x:165.1, z:15.1, y:6, angle:270, locked:false, partNumber:''};
  Object.assign(state, {board:{...DEFAULT_BOARD}, secondaryBoard:null, items:[laser, lens, det], measurements:[], name:'Optics practice bench'});
  state.beams = [{id:id(), name:'Beam 1', enabled:true, color:'#ff3434', width:.5, opacity:1, physics:true, points:[
   {x:24.4, y:25, z:0, itemId:laser.id}, {x:0, y:26, z:0, itemId:lens.id}, {x:-2.4, y:20, z:42.5, itemId:det.id}]}];
  commit();
  setSelected(null);
  view('iso');
  return {laser:laser.id, lens:lens.id, detector:det.id, beam:state.beams[0].id};
 }
 document.addEventListener('workbench:mode', () => { built = ''; tip.hidden = true; sync(); });
 return {sync, buildPractice, focusRoute};
}
