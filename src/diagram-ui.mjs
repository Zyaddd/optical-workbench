// Diagram Image Output: the editor view and the clean top-view render.
// The picture leaves out the breadboard, the table, post holders and posts; beams, callouts,
// the legend and the scale bar are vector graphics on top (see diagram.mjs).
import {holderMeshes} from './holders.mjs';
import {DIAGRAM_DEFAULTS, FIGURE_WIDTHS, diagramOptions, diagramParts, isMountItem, defaultLabel, diagramGroups, beamOrder, beamPolylines, layoutDiagram, primToSVG, diagramSVG, drawPrims, withPngDpi, toPlane, fromPlane, planeAxes, DIAGRAM_FONT} from './diagram.mjs';

export function createDiagramUI({THREE, $, getState, catalog, models, meshGroup, supportFor, checkpoint, commit, toast, scene:mainScene}) {
 let open = false, gl = null, baseKey = '', layout = null, rects = [], drag = null, pending = 0;
 const groupCache = new Map(), baseCanvas = document.createElement('canvas');
 const measureCtx = document.createElement('canvas').getContext('2d');
 const measure = (text, px) => { measureCtx.font = `${px}px ${DIAGRAM_FONT}`; return measureCtx.measureText(text).width; };
 const assetOf = id => id === 'builtin-mirror' ? {id, name:'Mirror with mount', meshes:models.mirror} : catalog.get(id);

 // ---------- DOM ----------
 const view = document.createElement('section');
 view.id = 'diagramView'; view.className = 'diagramView'; view.hidden = true; view.setAttribute('aria-label', 'Diagram Image Output');
 const sel = (id, label, options) => `<label class="diagramField"><span>${label}</span><select id="${id}">${options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`;
 const check = (id, label) => `<label class="inlineCheck"><input type="checkbox" id="${id}"> ${label}</label>`;
 view.innerHTML = `
 <div class="diagramStage" id="diagramStage">
  <div class="diagramPaper" id="diagramPaper"><canvas id="diagramBase" aria-hidden="true"></canvas><svg id="diagramOverlay" role="img" aria-label="Diagram preview"></svg></div>
  <p class="diagramEmpty" id="diagramEmpty" hidden>Place components on the breadboard first. The diagram shows them from above, without the breadboard.</p>
  <p class="diagramHint">Drag a number to move it. The figure is ${'exported'} at the size and resolution set on the right.</p>
 </div>
 <aside class="diagramSide" aria-label="Diagram settings">
  <div class="diagramHead"><div><h2>Diagram Image Output</h2><p>A top view for papers, without the breadboard or mounts.</p></div><button id="diagramClose" class="iconButton" title="Back to the workbench (Esc)" aria-label="Back to the workbench"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
  <details class="diagramGroup" open><summary>Picture</summary>
   ${sel('dgStyle', 'Style', [['shaded', 'Rendered'], ['flat', 'Flat colour'], ['outline', 'Line art']])}
   ${sel('dgRotate', 'Rotate', [['0', '0°'], ['90', '90° clockwise'], ['180', '180°'], ['270', '90° anticlockwise']])}
   ${sel('dgBackground', 'Background', [['white', 'White'], ['transparent', 'Transparent']])}
   ${check('dgHideMounts', 'Hide post holders and posts')}
   ${check('dgBeams', 'Show beams')}
   ${check('dgArrows', 'Arrows on beams')}
   <label class="diagramField"><span>Beam width</span><input id="dgBeamWidth" type="number" min=".25" max="6" step=".25"><small>pt</small></label>
   ${check('dgScaleBar', 'Scale bar')}
  </details>
  <details class="diagramGroup" open><summary>Numbering</summary>
   ${sel('dgCallouts', 'Callouts', [['numbers', 'Numbers with a legend'], ['labels', 'Names on the figure'], ['none', 'None']])}
   ${sel('dgLegend', 'Legend', [['right', 'Right of the figure'], ['bottom', 'Below the figure'], ['none', 'Off']])}
   <label class="diagramField"><span>Start at</span><input id="dgStart" type="number" min="0" max="999" step="1"></label>
   <label class="diagramField"><span>Text size</span><input id="dgFont" type="number" min="5" max="16" step=".5"><small>pt</small></label>
   ${check('dgGroup', 'Same number for components with the same name')}
   <div class="diagramList" id="dgList" role="list"></div>
   <button id="dgResetCallouts" class="secondary">Reset callout positions</button>
  </details>
  <details class="diagramGroup" open><summary>Export</summary>
   ${sel('dgFigure', 'Width', Object.entries(FIGURE_WIDTHS).map(([k, v]) => [k, `${k === 'single' ? 'Single column' : k === 'double' ? 'Double column' : '1.5 column'} (${v} in)`]))}
   ${sel('dgDpi', 'Resolution', [['600', '600 dpi'], ['300', '300 dpi']])}
   <p class="diagramSize" id="dgSize"></p>
   <div class="diagramExport"><button id="dgPng" class="primary">Download PNG</button><button id="dgSvg">Download SVG</button><button id="dgCopy">Copy image</button></div>
  </details>
 </aside>`;
 document.body.append(view);
 const paper = $('diagramPaper'), overlay = $('diagramOverlay'), stage = $('diagramStage');

 // ---------- Settings ----------
 const diagram = () => getState().diagram || {options:{}, entries:{}};
 const opts = () => diagramOptions(getState().diagram);
 function edit(fn, {history = true} = {}) {
  const s = getState();
  if (history) checkpoint();
  s.diagram = s.diagram ? {options:{...s.diagram.options}, entries:structuredClone(s.diagram.entries || {})} : {options:{}, entries:{}};
  fn(s.diagram);
  for (const [k, v] of Object.entries(s.diagram.options)) if (v === DIAGRAM_DEFAULTS[k]) delete s.diagram.options[k];
  for (const [id, e] of Object.entries(s.diagram.entries)) if (!Object.keys(e).length) delete s.diagram.entries[id];
  commit();
 }
 const setOption = (k, v) => edit(d => { d.options[k] = v; });
 const bindSelect = (id, key, num = false) => { $(id).onchange = () => setOption(key, num ? Number($(id).value) : $(id).value); };
 const bindCheck = (id, key) => { $(id).onchange = () => setOption(key, $(id).checked); };
 const bindNumber = (id, key, min, max, int = false) => { $(id).onchange = () => { let v = Number($(id).value); if (!Number.isFinite(v)) return fillControls(); v = Math.min(max, Math.max(min, int ? Math.round(v) : v)); setOption(key, v); }; };
 bindSelect('dgStyle', 'style'); bindSelect('dgRotate', 'rotate', true); bindSelect('dgBackground', 'background');
 bindCheck('dgHideMounts', 'hideMounts'); bindCheck('dgBeams', 'beams'); bindCheck('dgArrows', 'arrows'); bindCheck('dgScaleBar', 'scaleBar'); bindCheck('dgGroup', 'group');
 bindNumber('dgBeamWidth', 'beamWidth', .25, 6); bindNumber('dgStart', 'start', 0, 999, true); bindNumber('dgFont', 'fontPt', 5, 16);
 bindSelect('dgCallouts', 'callouts'); bindSelect('dgLegend', 'legend'); bindSelect('dgFigure', 'figure'); bindSelect('dgDpi', 'dpi', true);
 $('dgResetCallouts').onclick = () => { edit(d => { for (const e of Object.values(d.entries)) { delete e.dx; delete e.dz; } }); toast('Callouts placed automatically again.'); };
 $('diagramClose').onclick = () => close();

 function fillControls() {
  const o = opts();
  $('dgStyle').value = o.style; $('dgRotate').value = String(o.rotate); $('dgBackground').value = o.background;
  $('dgHideMounts').checked = o.hideMounts; $('dgBeams').checked = o.beams; $('dgArrows').checked = o.arrows; $('dgArrows').disabled = !o.beams; $('dgScaleBar').checked = o.scaleBar;
  $('dgBeamWidth').value = o.beamWidth; $('dgBeamWidth').disabled = !o.beams;
  $('dgCallouts').value = o.callouts; $('dgLegend').value = o.legend; $('dgLegend').disabled = o.callouts !== 'numbers';
  $('dgStart').value = o.start; $('dgStart').disabled = o.callouts !== 'numbers'; $('dgFont').value = o.fontPt; $('dgGroup').checked = o.group;
  $('dgFigure').value = o.figure; $('dgDpi').value = String(o.dpi);
 }

 // The component list: show, number, label, callout.
 function fillList(groups) {
  const s = getState(), e = diagram().entries || {}, o = opts(), numberOf = new Map();
  for (const g of groups) for (const id of g.items) numberOf.set(id, g.number);
  const items = s.items.filter(i => !isMountItem(assetOf(i.assetId)));
  const order = new Map(beamOrder(s.beams, s.items).map((id, k) => [id, k]));
  items.sort((a, b) => (numberOf.get(a.id) ?? 1e6) - (numberOf.get(b.id) ?? 1e6) || (order.get(a.id) ?? 1e6) - (order.get(b.id) ?? 1e6) || a.x - b.x);
  const list = $('dgList'), focus = document.activeElement?.dataset?.item;
  list.replaceChildren();
  if (!items.length) { list.innerHTML = '<p class="diagramMuted">No components yet.</p>'; return; }
  const head = document.createElement('div'); head.className = 'diagramRow diagramRowHead'; head.innerHTML = '<span title="Show in the figure">Show</span><span>No.</span><span>Label</span><span title="Give it a callout">Callout</span>'; list.append(head);
  for (const i of items) {
   const entry = e[i.id] || {}, row = document.createElement('div'), auto = defaultLabel(i, assetOf(i.assetId));
   row.className = 'diagramRow'; row.setAttribute('role', 'listitem'); row.title = i.name;
   row.innerHTML = `<input type="checkbox" class="dgShow" aria-label="Show ${i.name} in the figure"><span class="diagramNumber">${o.callouts === 'none' || entry.hidden || entry.noCallout ? '–' : numberOf.get(i.id) ?? '–'}</span><input class="dgLabel" maxlength="80" aria-label="Label for ${i.name}"><input type="checkbox" class="dgCallout" aria-label="Callout for ${i.name}">`;
   const show = row.querySelector('.dgShow'), label = row.querySelector('.dgLabel'), callout = row.querySelector('.dgCallout');
   show.checked = !entry.hidden; callout.checked = !entry.noCallout; callout.disabled = !!entry.hidden; label.disabled = !!entry.hidden;
   label.value = entry.label ?? auto; label.placeholder = auto; label.dataset.item = i.id;
   show.onchange = () => edit(d => { const x = d.entries[i.id] ||= {}; if (show.checked) delete x.hidden; else x.hidden = true; });
   callout.onchange = () => edit(d => { const x = d.entries[i.id] ||= {}; if (callout.checked) delete x.noCallout; else x.noCallout = true; });
   label.onchange = () => edit(d => { const x = d.entries[i.id] ||= {}, v = label.value.trim(); if (!v || v === auto) delete x.label; else x.label = v; });
   label.onkeydown = ev => { if (ev.key === 'Enter') label.blur(); };
   row.onmouseenter = () => highlight(i.id); row.onmouseleave = () => highlight(null);
   list.append(row);
  }
  if (focus) list.querySelector(`.dgLabel[data-item="${CSS.escape(focus)}"]`)?.focus();
 }
 function highlight(id) { for (const el of overlay.querySelectorAll('.isHot')) el.classList.remove('isHot'); if (id) for (const el of overlay.querySelectorAll(`[data-item="${CSS.escape(id)}"]`)) el.classList.add('isHot'); }

 // ---------- 3D render ----------
 function partsGroup(i, o) {
  const a = assetOf(i.assetId);
  if (!a) return null;
  if (a.holderSpec) return {group:meshGroup(holderMeshes(a, i.holder)), owned:true};
  const key = i.assetId + '|' + o.hideMounts;
  if (!groupCache.has(key)) groupCache.set(key, meshGroup(diagramParts(a, o.hideMounts)));
  return {group:groupCache.get(key).clone(), owned:false};
 }
 const disposable = [];
 function styled(group, o) {
  if (o.style === 'shaded') return;
  group.traverse(m => {
   if (!m.isMesh) return;
   const c = m.material.color?.clone() || new THREE.Color('#999');
   if (o.style === 'flat') { m.material = new THREE.MeshLambertMaterial({color:c.lerp(new THREE.Color('#ffffff'), .12)}); disposable.push(m.material); }
   else {
    m.material = new THREE.MeshBasicMaterial({color:'#ffffff', polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1}); disposable.push(m.material);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), new THREE.LineBasicMaterial({color:'#1a1a1a'}));
    disposable.push(edges.geometry, edges.material); m.add(edges);
   }
  });
 }
 // Builds the scene of drawn components and their top-view footprints in page millimetres.
 function buildScene(o) {
  const s = getState(), e = diagram().entries || {}, scn = new THREE.Scene(), owned = [];
  scn.environment = o.style === 'shaded' ? mainScene.environment : null;
  scn.add(new THREE.HemisphereLight('#ffffff', '#b9c2cc', o.style === 'flat' ? 1.6 : 1.1));
  const key = new THREE.DirectionalLight('#ffffff', o.style === 'flat' ? 1.4 : 1.7); key.position.set(-180, 1000, -260); scn.add(key);
  const found = [];
  for (const i of s.items) {
   const a = assetOf(i.assetId);
   if (!a || e[i.id]?.hidden || (isMountItem(a) && o.hideMounts)) continue;
   const built = partsGroup(i, o); if (!built) continue;
   const g = built.group; if (built.owned) owned.push(g);
   styled(g, o);
   g.position.set(i.x, i.y + supportFor(i.assetId), i.z); g.rotation.y = i.angle * Math.PI / 180; g.updateMatrixWorld(true);
   scn.add(g);
   const box = new THREE.Box3().setFromObject(g);
   if (box.isEmpty()) continue;
   const corners = [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.max.z]].map(([x, z]) => toPlane(x, z, o.rotate));
   const us = corners.map(c => c[0]), vs = corners.map(c => c[1]), u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
   found.push({id:i.id, x:(u0 + u1) / 2, y:(v0 + v1) / 2, w:u1 - u0, h:v1 - v0, mount:isMountItem(a)});
  }
  return {scn, rects:found, owned};
 }
 function renderBase(scn, lay, o) {
  if (!gl) { gl = new THREE.WebGLRenderer({antialias:true, alpha:true, preserveDrawingBuffer:true}); gl.toneMapping = THREE.ACESFilmicToneMapping; gl.setPixelRatio(1); }
  const {w, h} = lay.image, vw = lay.view.u1 - lay.view.u0, vh = lay.view.v1 - lay.view.v0;
  // WebGL lines are one pixel wide; line art renders at half size above ~2500 px so strokes print as hairlines.
  const max = gl.capabilities.maxRenderbufferSize || 8192, k = Math.min(1, max / Math.max(w, h), o.style === 'outline' && w > 2500 ? .5 : 1);
  gl.setSize(Math.round(w * k), Math.round(h * k), false);
  const [cx, cz] = fromPlane((lay.view.u0 + lay.view.u1) / 2, (lay.view.v0 + lay.view.v1) / 2, o.rotate), V = planeAxes(o.rotate)[1];
  const cam = new THREE.OrthographicCamera(-vw / 2, vw / 2, vh / 2, -vh / 2, 1, 40000);
  cam.position.set(cx, 12000, cz); cam.up.set(-V[0], 0, -V[1]); cam.lookAt(cx, 0, cz);
  gl.setClearColor(0xffffff, o.background === 'transparent' ? 0 : 1);
  gl.render(scn, cam);
  baseCanvas.width = w; baseCanvas.height = h;
  const ctx = baseCanvas.getContext('2d'); ctx.clearRect(0, 0, w, h); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(gl.domElement, 0, 0, w, h);
 }
 function cleanup(owned) {
  for (const g of owned) g.traverse(m => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose?.(); } });
  while (disposable.length) disposable.pop().dispose();
 }

 // ---------- Layout and preview ----------
 function offsetsFor(o) {
  const out = new Map();
  for (const [id, en] of Object.entries(diagram().entries || {})) if (Number.isFinite(en.dx) && Number.isFinite(en.dz)) { const [u, v] = toPlane(en.dx, en.dz, o.rotate); out.set(id, {u, v}); }
  return out;
 }
 function compute({lockView = null, extraOffsets = null} = {}) {
  const s = getState(), o = opts();
  const groups = diagramGroups(s.items, s.diagram, assetOf, beamOrder(s.beams, s.items));
  const lines = beamPolylines(s.beams, s.items, o.rotate), offsets = offsetsFor(o);
  if (extraOffsets) for (const [k, v] of extraOffsets) offsets.set(k, v);
  return {groups, lay:layoutDiagram({rects:rects.filter(r => !r.mount || !o.hideMounts), lines, groups, options:o, offsets, measure, lockView})};
 }
 function refresh() {
  if (!open) return;
  const s = getState(), o = opts();
  fillControls();
  const empty = !s.items.length;
  $('diagramEmpty').hidden = !empty; paper.hidden = empty;
  if (empty) { fillList([]); $('dgSize').textContent = ''; return; }
  const built = buildScene(o);
  rects = built.rects;
  const {groups, lay} = compute();
  layout = lay;
  const key = JSON.stringify([lay.view, lay.image, o.style, o.rotate, o.background, o.hideMounts, s.items, s.diagram?.entries && Object.entries(s.diagram.entries).filter(([, e]) => e.hidden).map(([id]) => id)]);
  if (key !== baseKey) { renderBase(built.scn, lay, o); baseKey = key; }
  cleanup(built.owned);
  paintPreview();
  fillList(groups);
  const inches = lay.size.w / o.dpi;
  $('dgSize').textContent = `${lay.size.w} × ${lay.size.h} px, ${inches.toFixed(2)} × ${(lay.size.h / o.dpi).toFixed(2)} in at ${o.dpi} dpi. Text ${o.fontPt} pt.`;
 }
 function paintPreview() {
  const {w, h} = layout.size, o = opts(), canvas = $('diagramBase');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (o.background !== 'transparent') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(baseCanvas, layout.image.x, layout.image.y);
  overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
  overlay.innerHTML = layout.prims.map(primToSVG).join('');
  paper.classList.toggle('isTransparent', o.background === 'transparent');
  fitPaper();
 }
 function fitPaper() {
  if (!layout) return;
  const r = stage.getBoundingClientRect(), pad = 32, {w, h} = layout.size;
  const k = Math.min((r.width - pad * 2) / w, (r.height - pad * 2 - 28) / h);
  paper.style.width = Math.max(50, w * k) + 'px'; paper.style.height = Math.max(50, h * k) + 'px';
 }
 new ResizeObserver(() => { if (open) fitPaper(); }).observe(stage);

 // ---------- Dragging callouts ----------
 function svgPoint(ev) { const p = overlay.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(overlay.getScreenCTM().inverse()); }
 overlay.addEventListener('pointerdown', ev => {
  const id = ev.target.closest?.('[data-item]')?.dataset.item, c = id && layout?.callouts.find(c => c.itemId === id);
  if (!c || ev.button !== 0) return;
  const p = svgPoint(ev);
  drag = {id, dx:c.x - p.x, dy:c.y - p.y, view:layout.view, moved:false};
  overlay.setPointerCapture(ev.pointerId); ev.preventDefault();
 });
 overlay.addEventListener('pointermove', ev => {
  if (!drag) return;
  const p = svgPoint(ev), im = layout.image;
  const x = Math.min(im.x + im.w, Math.max(im.x, p.x + drag.dx)), y = Math.min(im.y + im.h, Math.max(im.y, p.y + drag.dy));
  const r = rects.find(r => r.id === drag.id); if (!r) return;
  const [u, v] = layout.toPlane(x - im.x, y - im.y);
  drag.offset = {u:u - r.x, v:v - r.y}; drag.moved = true;
  const {lay} = compute({lockView:drag.view, extraOffsets:new Map([[drag.id, drag.offset]])});
  overlay.innerHTML = lay.prims.map(primToSVG).join('');
  highlight(drag.id);
 });
 const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (!d.moved) return;
  const [dx, dz] = fromPlane(d.offset.u, d.offset.v, opts().rotate);
  edit(x => { x.entries[d.id] = {...(x.entries[d.id] || {}), dx:+dx.toFixed(2), dz:+dz.toFixed(2)}; });
 };
 overlay.addEventListener('pointerup', endDrag); overlay.addEventListener('pointercancel', endDrag);

 // ---------- Export ----------
 const fileBase = () => (getState().name || 'setup').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_|_$/g, '') || 'setup';
 function composite() {
  const {w, h} = layout.size, o = opts(), c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (o.background !== 'transparent') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(baseCanvas, layout.image.x, layout.image.y);
  drawPrims(ctx, layout.prims);
  return c;
 }
 const pngBlob = () => new Promise((resolve, reject) => composite().toBlob(async b => { try { if (!b) throw Error('The image could not be created.'); resolve(new Blob([withPngDpi(await b.arrayBuffer(), opts().dpi)], {type:'image/png'})); } catch (err) { reject(err); } }, 'image/png'));
 function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
 $('dgPng').onclick = async () => { if (!layout) return; toast('Preparing the PNG…'); try { download(await pngBlob(), fileBase() + '_diagram.png'); toast(`PNG saved at ${opts().dpi} dpi.`); } catch (err) { toast(err.message); } };
 $('dgSvg').onclick = () => { if (!layout) return; const svg = diagramSVG(layout, {background:opts().background, image:baseCanvas.toDataURL('image/png')}); download(new Blob([svg], {type:'image/svg+xml'}), fileBase() + '_diagram.svg'); toast('SVG saved. Numbers, labels and beams stay editable as vector graphics.'); };
 $('dgCopy').onclick = async () => { if (!layout) return; try { if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw Error('This browser cannot copy images. Use Download PNG.'); await navigator.clipboard.write([new ClipboardItem({'image/png':pngBlob()})]); toast('Image copied. Paste it into your document.'); } catch (err) { toast(err.message || 'The image could not be copied.'); } };

 // ---------- Mode button and open/close ----------
 const button = document.createElement('button');
 button.dataset.diagram = ''; button.textContent = 'Diagram'; button.title = 'Diagram Image Output: a clean top view with numbered components, for papers';
 button.setAttribute('aria-pressed', 'false');
 button.onclick = () => open ? close() : show();
 function mountButton() {
  const group = document.querySelector('.modeSwitch');
  if (group && !group.contains(button)) { group.append(button); group.addEventListener('click', ev => { if (open && ev.target.closest('button[data-mode]')) close(); }); }
 }
 function place() { const header = document.querySelector('header'); view.style.top = (header ? header.getBoundingClientRect().bottom : 56) + 'px'; }
 function show() {
  if (!getState().board && !getState().items.length) { toast('Add a breadboard and components first.'); return; }
  open = true; baseKey = ''; view.hidden = false; place();
  document.body.classList.add('diagram-open'); button.setAttribute('aria-pressed', 'true');
  refresh();
  $('diagramClose').focus({preventScroll:true});
 }
 function close() {
  if (!open) return;
  open = false; view.hidden = true; drag = null;
  document.body.classList.remove('diagram-open'); button.setAttribute('aria-pressed', 'false');
 }
 addEventListener('resize', () => { if (open) place(); });
 document.addEventListener('keydown', ev => { if (open && ev.key === 'Escape' && !document.querySelector('dialog[open]')) { ev.preventDefault(); close(); } });
 mountButton();
 // Workspace changes (undo, edits from the list) arrive through commit; coalesce them.
 function schedule() { if (!open || pending) return; pending = requestAnimationFrame(() => { pending = 0; refresh(); }); }
 return {sync:schedule, open:show, close, isOpen:() => open, mountButton};
}
