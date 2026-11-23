// Landing page: a live optical bench that acts out "how it works" as the visitor scrolls.
// Real library parts (web/hero-scene.bin, built by scripts/hero-scene.mjs) on the same
// optical table, lighting and beam effects the workbench uses.
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {DEFAULT_BOARD, boardGrid} from './core.mjs';
import {backdropTexture, createOpticalTable, reducedMotion} from './scene-fx.mjs';

const stage = document.querySelector('[data-stage]');
const canvasHost = document.querySelector('[data-canvas]');
const labelLayer = document.querySelector('[data-labels]');
const steps = [...document.querySelectorAll('[data-step]')];
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutBack = t => { const c = 1.4; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const calm = reducedMotion();

let renderer;
try { renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'}); }
catch { stage?.classList.add('noGL'); throw new Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // re-rendered only while parts move
canvasHost.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = backdropTexture(true);
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, .04).texture; room.dispose(); pmrem.dispose();
scene.environmentIntensity = .55;
scene.add(new THREE.HemisphereLight('#c9d8e6', '#0b0f14', .55));
const key = new THREE.DirectionalLight('#fff4e8', 2.6);
key.position.set(-420, 560, 360); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -.0004; key.shadow.normalBias = .6; key.shadow.radius = 4;
Object.assign(key.shadow.camera, {left:-520, right:520, top:520, bottom:-520, near:10, far:2200});
scene.add(key, key.target);
const rim = new THREE.DirectionalLight('#7fb6d9', .7); rim.position.set(380, 240, -420); scene.add(rim);

// Optical table and the black anodized breadboard.
const table = createOpticalTable(renderer);
table.setTheme(true);
table.fit({x:0, z:0, width:DEFAULT_BOARD.width, depth:DEFAULT_BOARD.depth}, -DEFAULT_BOARD.thickness);
scene.add(table.group);
const board = (() => {
 const b = DEFAULT_BOARD, shape = new THREE.Shape(), g = boardGrid(b), r = Math.min(2.65, b.pitch / 5);
 shape.moveTo(-b.width / 2, -b.depth / 2); shape.lineTo(b.width / 2, -b.depth / 2); shape.lineTo(b.width / 2, b.depth / 2); shape.lineTo(-b.width / 2, b.depth / 2); shape.closePath();
 for (let row = 0; row < g.rows; row++) for (let c = 0; c < g.columns; c++) { const h = new THREE.Path(); h.absarc(g.x0 + c * b.pitch, g.z0 + row * b.pitch, r, 0, Math.PI * 2, true); shape.holes.push(h); }
 const geom = new THREE.ExtrudeGeometry(shape, {depth:b.thickness, bevelEnabled:false, curveSegments:8});
 geom.rotateX(Math.PI / 2);
 const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({color:'#23282e', metalness:.55, roughness:.42}));
 mesh.castShadow = mesh.receiveShadow = true;
 return mesh;
})();
scene.add(board);

const brushed = (() => {
 const n = 128, d = new Uint8Array(n * n * 4); let seed = 213;
 for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { seed = (seed * 1664525 + 1013904223) >>> 0; const v = 160 + (seed % 28) + Math.sin(y * 1.7) * 12; d.set([v, v, v, 255], (y * n + x) * 4); }
 const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
})();
const hardware = color => { const c = new THREE.Color(color), bright = Math.max(c.r, c.g, c.b); return new THREE.MeshStandardMaterial({color:c, metalness:bright < .12 ? .45 : .78, roughness:bright < .12 ? .55 : .33, roughnessMap:brushed, envMapIntensity:bright < .12 ? .5 : 1.1, side:THREE.DoubleSide}); };

// Parts and beam, filled in once the scene file arrives.
const parts = [];
let beam = null;
const camera = new THREE.PerspectiveCamera(28, 1, 10, 6000);
const target = new THREE.Vector3(0, 20, 0);

async function loadParts() {
 const res = await fetch(new URL('hero-scene.bin', document.baseURI));
 if (!res.ok) throw new Error('scene ' + res.status);
 const buf = await res.arrayBuffer(), view = new DataView(buf);
 const len = view.getUint32(4, true), header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len)));
 const base = 8 + len + ((4 - ((8 + len) % 4)) % 4), {min, max} = header.bounds, span = max.map((v, k) => v - min[k]);
 for (const item of header.items) {
  const group = new THREE.Group();
  for (const b of item.batches) {
   const q = new Int16Array(buf, base + b.pos, b.vertices * 3), p = new Float32Array(q.length);
   for (let i = 0; i < q.length; i++) { const k = i % 3; p[i] = min[k] + (q[i] + 32767) / 65534 * span[k]; }
   const g = new THREE.BufferGeometry();
   g.setAttribute('position', new THREE.BufferAttribute(p, 3));
   g.setIndex(new THREE.BufferAttribute(b.wide ? new Uint32Array(buf, base + b.ind, b.indices) : new Uint16Array(buf, base + b.ind, b.indices), 1));
   g.computeVertexNormals();
   const m = new THREE.Mesh(g, hardware(b.color));
   m.castShadow = m.receiveShadow = true;
   group.add(m);
  }
  if (item.riser) {
   const r = item.riser, block = new THREE.Mesh(new THREE.BoxGeometry(r.w, r.h, r.d), new THREE.MeshStandardMaterial({color:'#2a3037', metalness:.5, roughness:.45}));
   block.position.set(item.x, r.h / 2, item.z); block.castShadow = block.receiveShadow = true; group.add(block);
  }
  const box = new THREE.Box3().setFromObject(group);
  group.userData = {id:item.id, name:item.name, top:box.max.y, centre:box.getCenter(new THREE.Vector3())};
  scene.add(group);
  parts.push(group);
 }
 beam = createBeam(header.beam.map(p => new THREE.Vector3(...p)));
 makeLabels();
 setStep(current, true);
}

// The beam: a glowing core, halo and travelling light, revealed along its length.
function createBeam(points) {
 const group = new THREE.Group(), segs = [], colour = new THREE.Color('#ff3b30');
 const flow = (() => { const n = 128, d = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { const v = i / n, a = v < .55 ? v / .55 * .08 : v < .85 ? .08 + (v - .55) / .3 * .87 : .95 * (1 - (v - .85) / .15); d.set([255, 255, 255, a * 255], i * 4); } const t = new THREE.DataTexture(d, 1, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; })();
 const glow = (() => { const n = 64, d = new Uint8Array(n * n * 4); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r = Math.hypot(x + .5 - n / 2, y + .5 - n / 2) / (n / 2), a = r >= 1 ? 0 : r < .25 ? 1 - r * 1.8 : .55 * Math.pow(1 - (r - .25) / .75, 2); d.set([255, 255, 255, Math.max(0, a) * 255], (y * n + x) * 4); } const t = new THREE.DataTexture(d, n, n); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; })();
 let total = 0;
 for (let i = 0; i < points.length - 1; i++) {
  const a = points[i], b = points[i + 1], dir = b.clone().sub(a), length = dir.length();
  const layers = [[.9, 1, THREE.NormalBlending, null], [1.25, .3, THREE.AdditiveBlending, null], [2.8, .08, THREE.AdditiveBlending, null], [1.0, 1, THREE.AdditiveBlending, flow]].map(([r, o, blend, map]) => {
   const tex = map ? map.clone() : null; if (tex) { tex.needsUpdate = true; tex.repeat.set(1, length / 22); }
   const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 20, 1, !!map), new THREE.MeshBasicMaterial({color:colour, transparent:true, opacity:o, depthWrite:false, blending:blend, map:tex}));
   m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()); group.add(m); return m;
  });
  segs.push({a, dir:dir.normalize(), length, from:total, layers});
  total += length;
 }
 const spots = points.map(p => { const s = new THREE.Sprite(new THREE.SpriteMaterial({map:glow, color:colour, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:0})); s.position.copy(p); s.scale.setScalar(20); group.add(s); return s; });
 scene.add(group);
 let shown = 0;
 return {
  total,
  set(progress) {
   shown = progress * total;
   for (const s of segs) {
    const len = Math.max(0, Math.min(s.length, shown - s.from));
    for (const m of s.layers) { m.visible = len > .01; m.scale.y = Math.max(len, .01); m.position.copy(s.a).addScaledVector(s.dir, len / 2); }
   }
   spots.forEach((s, i) => { const at = i === 0 ? 0 : segs[i - 1].from + segs[i - 1].length; s.material.opacity = shown >= at - .5 ? .8 : 0; });
  },
  tick(now) { if (calm) return; for (const s of segs) s.layers[3].material.map.offset.y = -(now / 1000) * 1.6; },
 };
}

// Labels that follow the parts on screen.
const labels = [];
function makeLabels() {
 const text = {laser:'QCL laser', m1:'Mirror 1', m2:'Mirror 2', detector:'MCT detector'};
 for (const p of parts) {
  const el = document.createElement('span');
  el.className = 'partLabel'; el.textContent = text[p.userData.id] ?? p.userData.name;
  labelLayer.append(el); labels.push({el, part:p});
 }
}
function placeLabels() {
 const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
 for (const {el, part} of labels) {
  const v = part.userData.centre.clone(); v.y = part.userData.top + 14; v.project(camera);
  el.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(-50%, -100%)`;
 }
}

// Story: each step is a pose for the camera plus what is on the bench.
const POSES = {
 intro: {theta:.78, phi:1.0, radius:960, target:[10, 10, 0]},
 board: {theta:.55, phi:.92, radius:1000, target:[0, 0, 0]},
 parts: {theta:.95, phi:1.0, radius:900, target:[10, 15, 0]},
 beam: {theta:1.25, phi:1.06, radius:760, target:[10, 25, 5]},
 check: {theta:.0001, phi:.03, radius:1150, target:[10, 0, 0]},
};
const STATES = [
 {pose:'intro', parts:true, beam:1, labels:false, side:-1},
 {pose:'board', parts:false, beam:0, labels:false, side:1},
 {pose:'parts', parts:true, beam:0, labels:true, side:-1},
 {pose:'beam', parts:true, beam:1, labels:false, side:1},
 {pose:'check', parts:true, beam:1, labels:true, side:-1},
];
let current = 0, transition = null, partsT = [], beamFrom = 0, beamTo = 1, beamStart = 0;
let shift = -1;
const pose = {theta:POSES.intro.theta, phi:POSES.intro.phi, radius:POSES.intro.radius, target:new THREE.Vector3(...POSES.intro.target)};

function setStep(n, instant = false) {
 current = n;
 const s = STATES[n], p = POSES[s.pose], now = performance.now(), fast = instant || calm;
 transition = {from:{...pose, target:pose.target.clone()}, to:{...p, target:new THREE.Vector3(...p.target)}, t0:now, dur:fast ? 0 : 1300};
 parts.forEach((part, i) => { partsT[i] = {visible:s.parts, t0:now + (fast ? 0 : (s.parts ? 220 + i * 180 : 0))}; });
 if (beam) { beamFrom = beamShown; beamTo = s.beam; beamStart = now + (fast ? 0 : (s.beam > beamFrom ? (n === 3 ? 500 : 900) : 0)); if (fast) beamShown = beamTo; }
 labelLayer.classList.toggle('show', s.labels);
 steps.forEach((el, i) => el.classList.toggle('active', i === n));
}
let beamShown = 1;

const io = new IntersectionObserver(entries => {
 for (const e of entries) if (e.isIntersecting) { const n = steps.indexOf(e.target); if (n >= 0 && n !== current) setStep(n); }
}, {rootMargin:'-45% 0px -45% 0px'});
steps.forEach(el => io.observe(el));

// Pointer parallax and idle drift, both skipped for reduced motion.
const pointer = {x:0, y:0};
addEventListener('pointermove', e => { pointer.x = e.clientX / innerWidth - .5; pointer.y = e.clientY / innerHeight - .5; }, {passive:true});

let visible = true;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(stage);
function resize() {
 const w = canvasHost.clientWidth, h = canvasHost.clientHeight;
 renderer.setSize(w, h, false); camera.aspect = w / h;
 camera.fov = w / h < .8 ? 40 : 28; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvasHost); resize();

let lastNow = performance.now(), shadowsReady = false;
renderer.setAnimationLoop(now => {
 const dt = Math.min(250, now - lastNow); lastNow = now;
 if (!visible) return;
 if (transition) {
  const k = transition.dur ? Math.min(1, (now - transition.t0) / transition.dur) : 1, e = easeInOut(k), f = transition.from, t = transition.to;
  pose.theta = f.theta + (t.theta - f.theta) * e; pose.phi = f.phi + (t.phi - f.phi) * e; pose.radius = f.radius + (t.radius - f.radius) * e;
  pose.target.lerpVectors(f.target, t.target, e);
  if (k >= 1) transition = null;
 }
 let moving = false;
 parts.forEach((part, i) => {
  const st = partsT[i]; if (!st) return;
  if (now - st.t0 < 560) moving = true;
  const k = Math.max(0, Math.min(1, (now - st.t0) / 520));
  if (st.visible) { const e = easeOutBack(k); part.visible = k > 0 || calm; part.position.y = calm ? 0 : (1 - e) * 90; part.scale.setScalar(calm ? 1 : .92 + .08 * Math.min(1, e)); }
  else { part.position.y = k * 60; part.visible = k < 1 && !calm; part.scale.setScalar(1 - k * .1); }
 });
 if (moving || !shadowsReady) { renderer.shadowMap.needsUpdate = true; shadowsReady = parts.length > 0; }
 if (beam) {
  if (now >= beamStart && beamShown !== beamTo) { const dir = Math.sign(beamTo - beamShown), speed = beamTo > beamShown ? .00055 : .004; beamShown = dir > 0 ? Math.min(beamTo, beamShown + speed * dt) : Math.max(beamTo, beamShown - speed * dt); }
  beam.set(easeInOut(beamShown)); beam.tick(now);
 }
 const drift = calm || current === 4 ? 0 : Math.sin(now / 5200) * .06;
 const theta = pose.theta + drift + (calm ? 0 : pointer.x * .08), phi = Math.max(.02, pose.phi + (calm ? 0 : pointer.y * .04));
 camera.position.setFromSphericalCoords(pose.radius, phi, theta).add(pose.target);
 camera.up.set(0, 1, 0);
 if (phi < .05) camera.up.set(0, 0, -1);
 camera.lookAt(pose.target);
 const want = STATES[current].side; shift += (want - shift) * (calm ? 1 : Math.min(1, dt / 420));
 const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight, narrow = w < 640;
 camera.setViewOffset(w, h, narrow ? 0 : shift * w * .17, narrow ? h * .2 : 0, w, h);
 renderer.render(scene, camera);
 if (labels.length) placeLabels();
});

loadParts().catch(() => stage?.classList.add('partial'));
