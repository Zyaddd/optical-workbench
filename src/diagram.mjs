// Diagram Image Output: a clean top view of the setup for papers.
// This module is pure (no DOM, no Three.js): settings, labels, numbering, callout layout,
// and drawing the overlay as SVG or onto a 2D canvas. diagram-ui.mjs renders the 3D part.
import {defaultType} from './optics.mjs';
import {routeWorld} from './routes.mjs';

export const FIGURE_WIDTHS = {single:3.5, onehalf:5.5, double:7.16}; // inches, common journal column widths
export const DIAGRAM_DEFAULTS = {
 style:'shaded',        // shaded | flat | outline
 hideMounts:true,       // leave out post holders, posts and post bases
 beams:true, arrows:true, beamWidth:1.2, // beam line width in points
 callouts:'numbers',    // numbers | labels | none
 legend:'right',        // right | bottom | none
 group:true,            // identical labels share one number
 start:1,
 fontPt:8,
 figure:'double', dpi:600,
 rotate:0,              // 0 | 90 | 180 | 270, clockwise
 background:'white',    // white | transparent
 scaleBar:true,
};
const ENUMS = {style:['shaded','flat','outline'], callouts:['numbers','labels','none'], legend:['right','bottom','none'], figure:Object.keys(FIGURE_WIDTHS), dpi:[300,600], rotate:[0,90,180,270], background:['white','transparent']};
const RANGES = {beamWidth:[.25,6], start:[0,999], fontPt:[5,16]};

export function diagramOptions(d) { return {...DIAGRAM_DEFAULTS, ...(d?.options || {})}; }

// Saved with the project as `diagram`. Unknown option keys are dropped; entries for removed components too.
export function validateDiagram(d, ids = null) {
 const bad = () => { throw Error('Invalid diagram settings.'); };
 if (!d || typeof d !== 'object' || Array.isArray(d)) bad();
 const options = {}, src = d.options ?? {};
 if (typeof src !== 'object' || Array.isArray(src)) bad();
 for (const [k, v] of Object.entries(src)) {
  if (!(k in DIAGRAM_DEFAULTS)) continue;
  const def = DIAGRAM_DEFAULTS[k];
  if (ENUMS[k]) { if (!ENUMS[k].includes(v)) bad(); }
  else if (typeof def === 'boolean') { if (typeof v !== 'boolean') bad(); }
  else if (RANGES[k]) { if (!Number.isFinite(v) || v < RANGES[k][0] || v > RANGES[k][1] || (k === 'start' && !Number.isInteger(v))) bad(); }
  options[k] = v;
 }
 const entries = {}, e = d.entries ?? {};
 if (typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length > 300) bad();
 for (const [id, v] of Object.entries(e)) {
  if (ids && !ids.has(id)) continue;
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad();
  const out = {};
  if (v.label != null) { if (typeof v.label !== 'string' || v.label.length > 80) bad(); out.label = v.label; }
  for (const k of ['hidden', 'noCallout']) if (v[k] != null) { if (typeof v[k] !== 'boolean') bad(); if (v[k]) out[k] = true; }
  if (v.dx != null || v.dz != null) { if (![v.dx, v.dz].every(n => Number.isFinite(n) && Math.abs(n) <= 5000)) bad(); out.dx = v.dx; out.dz = v.dz; }
  if (Object.keys(out).length) entries[id] = out;
 }
 return {options, entries};
}

// ---------- What is drawn ----------
// Post holders are separate items with a holder spec. Library parts can also carry their own post and
// base (the lens), named as such; those meshes are left out too. Mirror frames are the optic's mount
// as seen from above, so they stay.
const MOUNT_PART = /\bposts?\b|post holder|pedestal|\bbase\b|base plate/i;
export const isMountItem = asset => !!asset?.holderSpec;
export function diagramParts(asset, hideMounts = true) {
 const meshes = asset?.meshes || [];
 if (!hideMounts) return meshes;
 const kept = meshes.filter(m => !MOUNT_PART.test(m.name || ''));
 return kept.length ? kept : meshes;
}

const TYPE_LABEL = {lens:'Lens', mirror:'Plane mirror', spherical:'Concave mirror', parabolic:'Parabolic mirror', detector:'Detector'};
export function cleanName(s) {
 return String(s || '').replace(/\.(step|stp|stl|obj)$/i, '').replace(/_+/g, ' ').replace(/\s*\([^)]*\)/g, '').replace(/\s+\d+$/, '').replace(/\s+/g, ' ').trim();
}
export function defaultLabel(item, asset) {
 const auto = asset?.name && (item.name === asset.name || item.name?.startsWith(asset.name + ' '));
 if (item.name && !auto && !/^(mirror with mount|component)\s*\d*$/i.test(item.name)) return cleanName(item.name) || item.name;
 const t = item.optics?.type || (asset ? defaultType(asset) : 'none');
 if (t === 'laser') return Number.isFinite(item.optics?.wavelength) ? `Laser (${+item.optics.wavelength.toFixed(3)} µm)` : 'Laser';
 if (TYPE_LABEL[t]) return TYPE_LABEL[t];
 return cleanName(asset?.name || item.name) || 'Component';
}

// Items in the order the beams visit them, so numbering follows the light. A beam point that is not
// attached to a component counts for the nearest one within reach (35 mm in plan).
export function beamOrder(beams, items = []) {
 const out = [], add = id => { if (id && !out.includes(id)) out.push(id); };
 for (const b of beams || []) for (const p of b.points || []) {
  if (p.itemId) { add(p.itemId); continue; }
  let best = null, dist = 35;
  for (const i of items) { const d = Math.hypot(i.x - p.x, i.z - p.z); if (d < dist) { dist = d; best = i.id; } }
  add(best);
 }
 return out;
}

// Numbered groups: [{number, label, items:[id...]}]. Hidden components and mounts are not numbered.
export function diagramGroups(items, diagram, assetOf, order = []) {
 const o = diagramOptions(diagram), e = diagram?.entries || {};
 const rank = new Map(order.map((id, k) => [id, k]));
 const list = items.filter(i => !isMountItem(assetOf(i.assetId)) && !e[i.id]?.hidden && !e[i.id]?.noCallout)
  .sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6) || a.x - b.x || a.z - b.z);
 const groups = [], byKey = new Map();
 for (const i of list) {
  const label = (e[i.id]?.label ?? defaultLabel(i, assetOf(i.assetId))).trim() || 'Component';
  const key = o.group ? label.toLowerCase() : i.id;
  let g = byKey.get(key);
  if (!g) { g = {label, items:[]}; byKey.set(key, g); groups.push(g); }
  g.items.push(i.id);
 }
 groups.forEach((g, k) => { g.number = o.start + k; });
 return groups;
}

// ---------- Plane coordinates ----------
// The page plane: u to the right, v down, in millimetres. Rotation turns the picture clockwise.
const AXES = {0:[[1,0],[0,1]], 90:[[0,-1],[1,0]], 180:[[-1,0],[0,-1]], 270:[[0,1],[-1,0]]};
export const planeAxes = rot => AXES[rot] || AXES[0];
export function toPlane(x, z, rot = 0) { const [U, V] = planeAxes(rot); return [x * U[0] + z * U[1], x * V[0] + z * V[1]]; }
export function fromPlane(u, v, rot = 0) { const [U, V] = planeAxes(rot); return [u * U[0] + v * V[0], u * U[1] + v * V[1]]; }

export function beamPolylines(beams, items, rot = 0) {
 const out = [];
 for (const b of beams || []) {
  const pts = routeWorld(b.points, items).filter(Boolean).map(p => toPlane(p.x, p.z, rot));
  if (pts.length >= 2) out.push({id:b.id, color:b.color || '#d43b3b', pts});
 }
 return out;
}

// ---------- Callout placement ----------
function segIntersect(p, q, r, s) {
 const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
 if (Math.abs(d) < 1e-12) return false;
 const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
 return t > 0 && t < 1 && u > 0 && u < 1;
}
function segRect(p, q, r) {
 const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, y0 = r.y - r.h / 2, y1 = r.y + r.h / 2, inside = a => a[0] > x0 && a[0] < x1 && a[1] > y0 && a[1] < y1;
 if (inside(p) || inside(q)) return true;
 const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
 return c.some((a, k) => segIntersect(p, q, a, c[(k + 1) % 4]));
}
function pointSeg(p, a, b) {
 const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
 return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const boxHit = (a, b, pad) => Math.abs(a.x - b.x) < a.hw + b.hw + pad && Math.abs(a.y - b.y) < a.hh + b.hh + pad;

// targets: [{key, itemId, x, y, r, hw, hh, fixed?:{x,y}}] in mm. Returns Map key → {x, y}.
export function placeCallouts(targets, {rects = [], lines = [], center = {x:0, y:0}, gap = 4} = {}) {
 const out = new Map(), placed = [], leaders = [];
 const segs = lines.flatMap(l => l.pts.slice(1).map((p, k) => [l.pts[k], p]));
 for (const t of targets) if (t.fixed) { out.set(t.key, {...t.fixed}); placed.push({...t.fixed, hw:t.hw, hh:t.hh}); leaders.push([[t.x, t.y], [t.fixed.x, t.fixed.y]]); }
 const free = targets.filter(t => !t.fixed);
 // Outermost components first: they have the clearest choice.
 free.sort((a, b) => Math.hypot(b.x - center.x, b.y - center.y) - Math.hypot(a.x - center.x, a.y - center.y));
 for (const t of free) {
  const away = Math.hypot(t.x - center.x, t.y - center.y) > 1e-6 ? Math.atan2(t.y - center.y, t.x - center.x) : -Math.PI / 2;
  const size = Math.max(t.hw, t.hh);
  let best = null;
  for (let ring = 0; ring < 4; ring++) for (let k = 0; k < 32; k++) {
   const a = k * Math.PI / 16, d = t.r + gap + size + ring * size * 1.8;
   const c = {x:t.x + Math.cos(a) * d, y:t.y + Math.sin(a) * d, hw:t.hw, hh:t.hh}, leader = [[t.x, t.y], [c.x, c.y]];
   let diff = Math.abs(a - away) % (2 * Math.PI); if (diff > Math.PI) diff = 2 * Math.PI - diff;
   let score = diff * size * 1.2 + ring * size * 2.5;
   for (const q of placed) if (boxHit(c, q, size * .5)) score += 2000;
   for (const r of rects) {
    if (r.id === t.itemId) { if (boxHit(c, {x:r.x, y:r.y, hw:r.w / 2, hh:r.h / 2}, 0)) score += 800; continue; }
    if (boxHit(c, {x:r.x, y:r.y, hw:r.w / 2, hh:r.h / 2}, size * .3)) score += 900;
    if (segRect(leader[0], leader[1], {...r, w:r.w * .8, h:r.h * .8})) score += 220;
   }
   for (const s of segs) {
    if (pointSeg([c.x, c.y], s[0], s[1]) < size * 1.25) score += 500;
    if (segIntersect(leader[0], leader[1], s[0], s[1])) score += 70;
   }
   for (const l of leaders) if (segIntersect(leader[0], leader[1], l[0], l[1])) score += 300;
   if (!best || score < best.score) best = {...c, score};
  }
  out.set(t.key, {x:best.x, y:best.y});
  placed.push(best); leaders.push([[t.x, t.y], [best.x, best.y]]);
 }
 return out;
}

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
export function niceLength(maxMm) { let best = NICE[0]; for (const n of NICE) if (n <= maxMm) best = n; return best; }

// ---------- Layout ----------
// rects: component footprints [{id, x, y, w, h}] in plane mm. lines: beam polylines in plane mm.
// groups: from diagramGroups. offsets: Map itemId → {u, v}, a dragged callout's offset from its component.
// measure(text, px) → width in px. lockView keeps the frame while a callout is being dragged.
export function layoutDiagram({rects, lines = [], groups = [], options, offsets = new Map(), measure, lockView = null}) {
 const o = {...DIAGRAM_DEFAULTS, ...options}, pt = o.dpi / 72, fontPx = o.fontPt * pt;
 const total = Math.round(FIGURE_WIDTHS[o.figure] * o.dpi);
 const numbered = o.callouts !== 'none' ? groups : [];
 const legendRows = o.callouts === 'numbers' && o.legend !== 'none' ? numbered.map(g => ({n:g.number, text:g.label})) : [];
 const pad = fontPx * 1.1, lineH = fontPx * 1.5, numW = Math.max(0, ...legendRows.map(r => measure(r.n + '.', fontPx))) + fontPx * .5;
 const rowW = Math.max(0, ...legendRows.map(r => measure(r.text, fontPx))) + numW;
 const legendW = legendRows.length && o.legend === 'right' ? Math.min(total * .45, rowW + pad * 2) : 0;
 const W = Math.max(200, total - legendW);

 // Content bounds
 let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
 const grow = (u, v) => { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); };
 for (const r of rects) { grow(r.x - r.w / 2, r.y - r.h / 2); grow(r.x + r.w / 2, r.y + r.h / 2); }
 if (o.beams) for (const l of lines) for (const p of l.pts) grow(p[0], p[1]);
 if (!Number.isFinite(u0)) { u0 = 0; v0 = 0; u1 = 100; v1 = 100; }
 const cw = Math.max(20, u1 - u0), ch = Math.max(20, v1 - v0);

 // Callout sizes are fixed in points; their size in mm depends on the final scale, so estimate first.
 const bubbleR = fontPx * .95, gapPx = fontPx * .9;
 const sizePx = g => o.callouts === 'labels' ? {hw:measure(g.label, fontPx) / 2 + fontPx * .35, hh:fontPx * .75} : {hw:bubbleR, hh:bubbleR};
 const maxSize = Math.max(bubbleR, ...numbered.map(g => Math.max(sizePx(g).hw, sizePx(g).hh)));
 let view;
 if (lockView) view = {...lockView};
 else {
  const guess = W / (cw * 1.25);
  const m = numbered.length ? (2 * maxSize + gapPx * 2) / guess + 2 : Math.max(cw, ch) * .04 + 2;
  view = {u0:u0 - m, v0:v0 - m, u1:u1 + m, v1:v1 + m};
 }
 let ppm = W / (view.u1 - view.u0);

 // Place callouts
 const byId = new Map(rects.map(r => [r.id, r])), targets = [];
 for (const g of numbered) for (const id of g.items) {
  const r = byId.get(id); if (!r) continue;
  const s = sizePx(g), off = offsets.get(id);
  targets.push({key:id, itemId:id, group:g, x:r.x, y:r.y, r:Math.min(r.w, r.h) * .5 * .85 + Math.abs(r.w - r.h) * .25, hw:s.hw / ppm, hh:s.hh / ppm, fixed:off ? {x:r.x + off.u, y:r.y + off.v} : null});
 }
 const spots = placeCallouts(targets, {rects, lines:o.beams ? lines : [], center:{x:(u0 + u1) / 2, y:(v0 + v1) / 2}, gap:gapPx / ppm});

 if (!lockView) {
  // Fit the frame around everything placed, then leave room for the scale bar.
  const m = fontPx * .8 / ppm;
  let a = u0 - m, b = v0 - m, c = u1 + m, d = v1 + m;
  for (const t of targets) { const s = spots.get(t.key); a = Math.min(a, s.x - t.hw - m); c = Math.max(c, s.x + t.hw + m); b = Math.min(b, s.y - t.hh - m); d = Math.max(d, s.y + t.hh + m); }
  view = {u0:a, v0:b, u1:c, v1:d};
  ppm = W / (c - a);
  if (o.scaleBar) { view.v1 += fontPx * 3.2 / ppm; }
 }
 const H = Math.max(120, Math.round((view.v1 - view.v0) * ppm));
 const px = (u, v) => [(u - view.u0) * ppm, (v - view.v0) * ppm];

 // Legend below: columns that fit the width.
 let legendH = 0, cols = 1;
 if (legendRows.length && o.legend === 'bottom') {
  const colW = rowW + fontPx * 2;
  cols = Math.max(1, Math.min(legendRows.length, Math.floor((total - pad * 2) / colW)));
  legendH = Math.ceil(legendRows.length / cols) * lineH + pad * 1.4;
 }
 const size = {w:total, h:Math.round(Math.max(H + legendH, legendW ? legendRows.length * lineH + pad * 2 : 0))};

 // ---------- Primitives ----------
 const prims = [], ink = '#111111';
 if (o.beams) for (const l of lines) {
  const pts = l.pts.map(p => px(p[0], p[1])), w = o.beamWidth * pt;
  prims.push({t:'line', pts, color:l.color, width:w, layer:'beam'});
  if (o.arrows) {
   const a = Math.max(w * 3.2, fontPx * .55);
   for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], len = Math.hypot(x1 - x0, y1 - y0);
    if (len < a * 5) continue;
    prims.push({t:'arrow', x:(x0 + x1) / 2 + (x1 - x0) / len * a * .5, y:(y0 + y1) / 2 + (y1 - y0) / len * a * .5, angle:Math.atan2(y1 - y0, x1 - x0), size:a, color:l.color});
   }
  }
 }
 const callouts = [];
 for (const t of targets) {
  const s = spots.get(t.key), [cx, cy] = px(s.x, s.y), [tx, ty] = px(t.x, t.y), hw = t.hw * ppm, hh = t.hh * ppm;
  const dx = tx - cx, dy = ty - cy, len = Math.hypot(dx, dy);
  // Leader from the callout's edge to a dot on the component.
  const edge = o.callouts === 'numbers' ? bubbleR : Math.min(hw / Math.max(1e-6, Math.abs(dx / len)), hh / Math.max(1e-6, Math.abs(dy / len)));
  if (len > edge + fontPx * .6) {
   const ex = cx + dx / len * edge, ey = cy + dy / len * edge;
   prims.push({t:'line', pts:[[ex, ey], [tx, ty]], color:ink, width:.55 * pt, item:t.key});
   prims.push({t:'circle', x:tx, y:ty, r:Math.max(1.6 * pt, fontPx * .16), fill:ink, item:t.key});
  }
  if (o.callouts === 'numbers') {
   prims.push({t:'circle', x:cx, y:cy, r:bubbleR, fill:'#ffffff', stroke:ink, width:.65 * pt, item:t.key, handle:true});
   prims.push({t:'text', x:cx, y:cy, text:String(t.group.number), size:fontPx, color:ink, anchor:'middle', item:t.key});
  } else {
   prims.push({t:'rect', x:cx - hw, y:cy - hh, w:hw * 2, h:hh * 2, fill:o.background === 'transparent' ? 'none' : '#ffffff', item:t.key, handle:true});
   prims.push({t:'text', x:cx, y:cy, text:t.group.label, size:fontPx, color:ink, anchor:'middle', weight:600, item:t.key});
  }
  callouts.push({itemId:t.key, number:t.group.number, x:cx, y:cy, hw, hh});
 }
 if (o.scaleBar) {
  const len = niceLength((view.u1 - view.u0) / 5), barW = len * ppm, x0 = fontPx * 1.2, y0 = H - fontPx * 1.4, tick = fontPx * .45;
  prims.push({t:'line', pts:[[x0, y0 - tick], [x0, y0], [x0 + barW, y0], [x0 + barW, y0 - tick]], color:ink, width:.8 * pt});
  prims.push({t:'text', x:x0 + barW / 2, y:y0 - fontPx * .95, text:`${len} mm`, size:fontPx, color:ink, anchor:'middle'});
 }
 if (legendRows.length) {
  if (o.legend === 'right') legendRows.forEach((r, k) => {
   const x = W + pad, y = pad + lineH * (k + .5);
   prims.push({t:'text', x:x + numW - fontPx * .5, y, text:r.n + '.', size:fontPx, color:ink, anchor:'end'});
   prims.push({t:'text', x:x + numW, y, text:r.text, size:fontPx, color:ink, anchor:'start'});
  });
  else {
   const rows = Math.ceil(legendRows.length / cols), colW = (total - pad * 2) / cols;
   legendRows.forEach((r, k) => {
    const c = Math.floor(k / rows), x = pad + c * colW, y = H + pad * .7 + lineH * (k % rows + .5);
    prims.push({t:'text', x:x + numW - fontPx * .5, y, text:r.n + '.', size:fontPx, color:ink, anchor:'end'});
    prims.push({t:'text', x:x + numW, y, text:r.text, size:fontPx, color:ink, anchor:'start'});
   });
  }
 }
 return {size, image:{x:0, y:0, w:W, h:H}, view, ppm, fontPx, prims, callouts, toPlane:(x, y) => [view.u0 + x / ppm, view.v0 + y / ppm]};
}

// ---------- Drawing ----------
export const DIAGRAM_FONT = 'Arial, Helvetica, sans-serif';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = n => +n.toFixed(2);
function arrowPoints(p) {
 const c = Math.cos(p.angle), s = Math.sin(p.angle), L = p.size, W = p.size * .55;
 return [[p.x, p.y], [p.x - L * c + W * s, p.y - L * s - W * c], [p.x - L * c * .72, p.y - L * s * .72], [p.x - L * c - W * s, p.y - L * s + W * c]];
}
export function primToSVG(p) {
 const data = p.item ? ` data-item="${esc(p.item)}"` : '', cls = p.handle ? ' class="calloutHandle"' : '';
 if (p.t === 'line') return `<polyline points="${p.pts.map(q => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="none" stroke="${p.color}" stroke-width="${f(p.width)}" stroke-linecap="round" stroke-linejoin="round"${data}/>`;
 if (p.t === 'arrow') return `<polygon points="${arrowPoints(p).map(q => f(q[0]) + ',' + f(q[1])).join(' ')}" fill="${p.color}"/>`;
 if (p.t === 'circle') return `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(p.r)}" fill="${p.fill || 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${f(p.width)}"` : ''}${data}${cls}/>`;
 if (p.t === 'rect') return `<rect x="${f(p.x)}" y="${f(p.y)}" width="${f(p.w)}" height="${f(p.h)}" fill="${p.fill || 'none'}"${data}${cls}/>`;
 if (p.t === 'text') return `<text x="${f(p.x)}" y="${f(p.y)}" font-family="${DIAGRAM_FONT}" font-size="${f(p.size)}"${p.weight ? ` font-weight="${p.weight}"` : ''} fill="${p.color}" text-anchor="${p.anchor || 'start'}" dominant-baseline="central"${data}>${esc(p.text)}</text>`;
 return '';
}
export function diagramSVG(layout, {background = 'white', image = null} = {}) {
 const {w, h} = layout.size, im = layout.image;
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
  + (background === 'transparent' ? '' : `<rect width="${w}" height="${h}" fill="#ffffff"/>`)
  + (image ? `<image x="${im.x}" y="${im.y}" width="${im.w}" height="${im.h}" xlink:href="${image}" href="${image}"/>` : '')
  + layout.prims.map(primToSVG).join('') + '</svg>';
}
export function drawPrims(ctx, prims) {
 ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
 for (const p of prims) {
  if (p.t === 'line') { ctx.beginPath(); p.pts.forEach((q, k) => k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.strokeStyle = p.color; ctx.lineWidth = p.width; ctx.stroke(); }
  else if (p.t === 'arrow') { ctx.beginPath(); arrowPoints(p).forEach((q, k) => k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fillStyle = p.color; ctx.fill(); }
  else if (p.t === 'circle') { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); if (p.fill && p.fill !== 'none') { ctx.fillStyle = p.fill; ctx.fill(); } if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width; ctx.stroke(); } }
  else if (p.t === 'rect') { if (p.fill && p.fill !== 'none') { ctx.fillStyle = p.fill; ctx.fillRect(p.x, p.y, p.w, p.h); } }
  else if (p.t === 'text') { ctx.font = `${p.weight || 400} ${p.size}px ${DIAGRAM_FONT}`; ctx.fillStyle = p.color; ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left'; ctx.textBaseline = 'middle'; ctx.fillText(p.text, p.x, p.y); }
 }
 ctx.restore();
}

// PNG files carry their print resolution in a pHYs chunk, so journals read the intended DPI.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function withPngDpi(png, dpi) {
 const src = new Uint8Array(png);
 if (src.length < 33 || src[12] !== 0x49 || src[13] !== 0x48) return src; // not IHDR-first: leave untouched
 const ppm = Math.round(dpi / .0254), chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
 view.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); view.setUint32(8, ppm); view.setUint32(12, ppm); chunk[16] = 1;
 view.setUint32(17, crc32(chunk.subarray(4, 17)));
 const out = new Uint8Array(src.length + 21);
 out.set(src.subarray(0, 33)); out.set(chunk, 33); out.set(src.subarray(33), 54);
 return out;
}
