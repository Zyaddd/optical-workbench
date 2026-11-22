// Scene presentation: the optical table under the breadboards, studio backdrop,
// soft shadows, camera glides and drop-in motion. Purely visual: nothing here
// touches the project data or the .optics.json format.
import * as THREE from 'three';

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutBack = t => { const c = 1.35; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

const PALETTES = {
 light: {top:'#e9edf0', bottom:'#c9d1d8', glow:'rgba(255,255,255,.75)', steel:'#b4bbc2', hole:'#7d858d', rim:'#2c3137', side:'#59616a'},
 dark: {top:'#1b232c', bottom:'#07090c', glow:'rgba(120,160,190,.10)', steel:'#5c656e', hole:'#2a3036', rim:'#0c0f12', side:'#22282e'},
};

// Studio sweep: light from above, falling off towards the edges.
export function backdropTexture(dark) {
 const p = PALETTES[dark ? 'dark' : 'light'], c = document.createElement('canvas');
 c.width = 16; c.height = 512;
 const g = c.getContext('2d'), lin = g.createLinearGradient(0, 0, 0, 512);
 lin.addColorStop(0, p.top); lin.addColorStop(.62, p.top); lin.addColorStop(1, p.bottom);
 g.fillStyle = lin; g.fillRect(0, 0, 16, 512);
 const t = new THREE.CanvasTexture(c);
 t.colorSpace = THREE.SRGBColorSpace;
 return t;
}

// One 25 mm cell of a stainless optical table top with an M6 tapped hole.
function holeTexture(dark, anisotropy) {
 const p = PALETTES[dark ? 'dark' : 'light'], s = 128, c = document.createElement('canvas');
 c.width = c.height = s;
 const g = c.getContext('2d');
 g.fillStyle = p.steel; g.fillRect(0, 0, s, s);
 // faint brushed grain
 g.globalAlpha = dark ? .05 : .07;
 for (let y = 0; y < s; y += 2) { g.fillStyle = (y * 7919) % 3 ? '#ffffff' : '#000000'; g.fillRect(0, y, s, 1); }
 g.globalAlpha = 1;
 const r = s * .1;
 g.fillStyle = p.hole; g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.fill();
 g.strokeStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.55)'; g.lineWidth = 2;
 g.beginPath(); g.arc(s / 2, s / 2, r + 2, Math.PI * .9, Math.PI * 1.9); g.stroke();
 const t = new THREE.CanvasTexture(c);
 t.colorSpace = THREE.SRGBColorSpace;
 t.wrapS = t.wrapT = THREE.RepeatWrapping;
 t.anisotropy = anisotropy;
 return t;
}

export function createOpticalTable(renderer) {
 const anisotropy = renderer.capabilities.getMaxAnisotropy();
 const group = new THREE.Group();
 group.name = 'optical-table';
 const topMat = new THREE.MeshStandardMaterial({metalness:.5, roughness:.5, envMapIntensity:.55});
 const rimMat = new THREE.MeshStandardMaterial({metalness:.2, roughness:.6});
 const sideMat = new THREE.MeshStandardMaterial({metalness:.15, roughness:.75});
 const top = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), topMat);
 top.rotation.x = -Math.PI / 2; top.receiveShadow = true;
 const slab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [rimMat, rimMat, sideMat, sideMat, rimMat, rimMat]);
 slab.receiveShadow = true;
 group.add(top, slab);
 group.traverse(o => { o.userData.decor = true; o.raycast = () => {}; });
 const depth = 90;
 let size = {width:1500, depth:1000}, surface = 0, dark = null;

 function layout() {
  const w = size.width, d = size.depth;
  top.scale.set(w, d, 1);
  top.position.set(0, surface + .02, 0);
  slab.scale.set(w + 24, depth, d + 24);
  slab.position.set(0, surface - depth / 2, 0);
  if (topMat.map) topMat.map.repeat.set(w / 25, d / 25);
 }
 return {
  group,
  setTheme(isDark) {
   if (dark === isDark) return;
   dark = isDark;
   const p = PALETTES[isDark ? 'dark' : 'light'];
   topMat.map?.dispose();
   topMat.map = holeTexture(isDark, anisotropy);
   topMat.color.set('#ffffff');
   topMat.needsUpdate = true;
   rimMat.color.set(p.rim); sideMat.color.set(p.side);
   layout();
  },
  // bounds: {x, z, width, depth} of the layout; surfaceY: underside of the boards.
  fit(bounds, surfaceY) {
   const snap = v => Math.ceil(v / 50) * 50;
   size = {width:snap(Math.max(1200, bounds.width + 700)), depth:snap(Math.max(900, bounds.depth + 600))};
   surface = surfaceY;
   group.position.set(Math.round(bounds.x / 25) * 25, 0, Math.round(bounds.z / 25) * 25);
   layout();
  },
  get size() { return size; },
 };
}

// Key light with soft shadows framed around the layout. Shadows are re-rendered
// only when something moves, so heavy STEP models stay cheap to orbit around.
export function createShadowLight(renderer, scene) {
 renderer.shadowMap.enabled = true;
 renderer.shadowMap.type = THREE.PCFSoftShadowMap;
 renderer.shadowMap.autoUpdate = false;
 const light = new THREE.DirectionalLight('#fffaf2', 2.4);
 light.castShadow = true;
 light.shadow.mapSize.set(2048, 2048);
 light.shadow.bias = -.0004;
 light.shadow.normalBias = .6;
 light.shadow.radius = 4;
 scene.add(light, light.target);
 return {
  light,
  fit(bounds, height) {
   const span = Math.max(bounds.width, bounds.depth) * .5 + 250, cam = light.shadow.camera;
   light.target.position.set(bounds.x, 0, bounds.z);
   // raking light from the front left, so parts throw readable shadows across the bench
   light.position.set(bounds.x - span * .8, Math.max(520, span * 1.1, height * 3), bounds.z + span * .62);
   cam.left = cam.bottom = -span; cam.right = cam.top = span;
   cam.near = 10; cam.far = light.position.distanceTo(light.target.position) + span * 3;
   cam.updateProjectionMatrix();
   renderer.shadowMap.needsUpdate = true;
  },
  invalidate() { renderer.shadowMap.needsUpdate = true; },
 };
}

export function enableShadows(object) {
 object.traverse(o => { if (o.isMesh && !o.userData.decor) { o.castShadow = true; o.receiveShadow = true; } });
}

// Glides an orthographic camera between poses: orbit angle, target, zoom and frustum.
export function createCameraGlide(camera, controls) {
 let tween = null;
 controls.addEventListener('start', () => { tween = null; });
 const snapshot = () => ({
  offset:new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)),
  target:controls.target.clone(), zoom:camera.zoom,
  frustum:[camera.left, camera.right, camera.top, camera.bottom],
 });
 function apply(a, b, k) {
  const s = new THREE.Spherical(
   THREE.MathUtils.lerp(a.offset.radius, b.offset.radius, k),
   THREE.MathUtils.lerp(a.offset.phi, b.offset.phi, k),
   a.offset.theta + shortest(a.offset.theta, b.offset.theta) * k);
  controls.target.lerpVectors(a.target, b.target, k);
  camera.position.setFromSpherical(s).add(controls.target);
  camera.zoom = THREE.MathUtils.lerp(a.zoom, b.zoom, k);
  [camera.left, camera.right, camera.top, camera.bottom] = a.frustum.map((v, i) => THREE.MathUtils.lerp(v, b.frustum[i], k));
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
 }
 const shortest = (from, to) => { let d = (to - from) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
 return {
  // Runs setPose() (which jumps the camera to the destination), then animates there from where it was.
  to(setPose, {duration = 720, from} = {}) {
   const start = from ?? snapshot();
   setPose();
   const end = snapshot();
   if (reducedMotion() || duration <= 0) { tween = null; return; }
   tween = {start, end, t0:performance.now(), duration};
   apply(start, end, 0);
  },
  pose: snapshot,
  // A pose derived from the current one, for scripted entrances.
  poseFrom(base, {phi, theta, zoomFactor = 1}) {
   const p = structuredClone({frustum:base.frustum, zoom:base.zoom});
   const offset = base.offset.clone();
   if (phi != null) offset.phi = phi;
   if (theta != null) offset.theta = theta;
   return {offset, target:base.target.clone(), zoom:p.zoom * zoomFactor, frustum:p.frustum};
  },
  tick(now) {
   if (!tween) return false;
   const k = Math.min(1, (now - tween.t0) / tween.duration);
   apply(tween.start, tween.end, easeInOut(k));
   if (k >= 1) tween = null;
   return true;
  },
  get active() { return !!tween; },
 };
}

// Newly placed parts settle onto the board instead of popping in.
export function createDropIn() {
 const active = new Map();
 return {
  add(obj, delay = 0) { if (!reducedMotion()) active.set(obj, performance.now() + delay); },
  tick(now) {
   let moved = false;
   for (const [obj, t0] of active) {
    const base = obj.userData.baseY ?? obj.position.y, k = Math.max(0, Math.min(1, (now - t0) / 460));
    const e = easeOutBack(k);
    obj.position.y = base + (1 - e) * 46;
    obj.scale.setScalar(.94 + .06 * Math.min(1, e));
    if (k >= 1) { obj.position.y = base; obj.scale.setScalar(1); active.delete(obj); }
    moved = true;
   }
   return moved;
  },
 };
}
