// The setup model behind the MCP server: a project in the app's own .optics.json form, edited by
// placing library parts on post holders, routing physical beams through them and tracing those beams
// with the app's optics model. Everything here is plain data and pure functions over the project, so
// the server, the live view and the tests share it.
import {DEFAULT_BOARD, validateBoard, validateProject, validateAsset, normalizeAngle, rotateXZ} from '../src/core.mjs';
import {localToWorld, worldToLocal} from '../src/planning.mjs';
import {syncMounts, holderDimensions} from '../src/holders.mjs';
import {translateItems, descendantIds} from '../src/transforms.mjs';
import {detachRoutes} from '../src/routes.mjs';
import {boardPlacements, contains} from '../src/layout.mjs';
import {BOARD_PRESETS, boardSpec} from '../src/boards.mjs';
import {itemOptics, validateOptics, defaultType, traceGaussian, focusOnEndpoint, fmtPower, pct, MATERIALS, COATINGS, OPTIC_TYPES} from '../src/optics.mjs';
import {optimiseBeam, defaultGoal, describeChanges, resultText, plainSummary, GOALS, goalText} from '../src/optimize.mjs';

export const HOLDER = 'lab-adjustable-holder';
// A standard post holder's top (50.0126 mm) plus the 26 mm optical centre of the standard mounts.
export const DEFAULT_BEAM_HEIGHT = 76.0126;

// What the server knows about each library part: where its optical point sits in the part's own frame
// (x along the part, y up from its base, z across) and which way light runs through it.
//  kind laser: emits along local +x from `point`.  transmit: the beam runs along local X through `point`.
//  mirror / splitter: the reflecting face points along local `face` ('+x', '-x', or a compass angle in the part's own frame).  end: the beam arrives travelling `axis`.
export const PARTS = {
 'nanoplus-laser': {asset:'supplied-nanoplus', label:'Laser', kind:'laser', point:{x:24.4, y:25, z:0},
  about:'NanoPlus interband cascade laser (mid-IR), lying on its side with its mounting holes down. Emits from its collimating lens.'},
 'qcl-laser': {asset:'supplied-alpes-hhl-qcl', label:'QCL', kind:'laser', point:{x:22.3, y:9.5, z:0}, approximate:true,
  about:'Alpes quantum cascade laser in an HHL package. The emission point is approximate: check it in the app.'},
 'lens': {asset:'default-lens', label:'Lens', kind:'transmit', point:{x:0, y:26, z:0},
  about:'Ø25.4 mm lens in a mount. Set focal, material and design wavelength in optics.'},
 'mirror': {asset:'default-flat-mirror', label:'Mirror', kind:'mirror', face:'+x', point:{x:17, y:26, z:0.9},
  about:'Flat Ø25.4 mm mirror in a kinematic mount.'},
 'concave-mirror': {asset:'default-flat-mirror', label:'Concave mirror', kind:'mirror', face:'+x', point:{x:17, y:26, z:0.9}, optics:{type:'spherical'},
  about:'Concave spherical mirror (f = R/2), drawn with the flat mirror mount. Set roc in optics.'},
 'parabolic-mirror': {asset:'default-parabolic-mirror', label:'Parabolic mirror', kind:'mirror', face:315, point:{x:17, y:26, z:1},
  about:'Off-axis parabolic mirror (90° off-axis by default). Focuses a collimated beam; set focal in optics.'},
 'beam-splitter': {asset:'default-beam-splitter', label:'Beam splitter', kind:'splitter', face:'-x', point:{x:0, y:26, z:0},
  about:'Beam splitter plate at 45°. Set reflectance (%) in optics.'},
 'window': {asset:'default-window', label:'Window', kind:'transmit', point:{x:0, y:26, z:0},
  about:'Ø25.4 mm window. Set material, coating or brewster in optics.'},
 'filter': {asset:'default-filter', label:'Filter', kind:'transmit', point:{x:0, y:26, z:0},
  about:'Ø25.4 mm filter: neutral density (od) or bandpass (center, fwhm, peak).'},
 'gas-cell': {asset:'default-gas-cell', label:'Gas cell', kind:'transmit', point:{x:0, y:26, z:0},
  about:'Gas cell with windows; its body stretches to optics.length. Single pass by default.'},
 'multipass-cell': {asset:'default-multipass-cell', label:'Multipass cell', kind:'transmit', point:{x:0, y:26, z:0},
  about:'Herriott multipass cell: optics.length is the mirror spacing (distance per pass) and optics.passes the pass count. Set optics.mirrorRoc (mirror radius of curvature, mm) to have the pass count follow from the mirror geometry.'},
 'fibre-port': {asset:'default-fibre-port', label:'Fibre port', kind:'end', axis:'+x', point:{x:-16, y:26, z:0},
  about:'FC/PC fibre port at the end of a beam: reports the single-mode coupling efficiency.'},
 'pinhole': {asset:'default-fibre-port', label:'Pinhole', kind:'end', axis:'+x', point:{x:-16, y:26, z:0}, optics:{type:'coupler', kind:'pinhole'},
  about:'Pinhole at the end of a beam (drawn with the fibre port mount). Set pinhole diameter in µm.'},
 'detector': {asset:'default-vigo-detector', label:'Detector', kind:'end', axis:'-z', point:{x:-2.4, y:20, z:42.5},
  about:'VIGO LabM-I-4 mid-IR detector. Set activeArea (mm), responsivity (V/W) and maxOutput (V) in optics.'},
};
const ALIASES = {laser:'nanoplus-laser', icl:'nanoplus-laser', nanoplus:'nanoplus-laser', qcl:'qcl-laser', 'flat-mirror':'mirror', 'spherical-mirror':'concave-mirror',
 'oap':'parabolic-mirror', 'off-axis-parabolic-mirror':'parabolic-mirror', splitter:'beam-splitter', 'beamsplitter':'beam-splitter', 'nd-filter':'filter',
 'bandpass-filter':'filter', cell:'gas-cell', 'herriott-cell':'multipass-cell', fibre:'fibre-port', fiber:'fibre-port', 'fiber-port':'fibre-port', 'vigo-detector':'detector'};

// ---------- Library ----------
const bounds = new Map();
export function createLibrary(assets) {
 const byId = new Map(assets.map(a => [a.id, a]));
 for (const [key, p] of Object.entries(PARTS)) if (!byId.has(p.asset)) throw Error(`Library part ${key} is missing its model ${p.asset}.`);
 if (!byId.has(HOLDER)) throw Error('The post holder model is missing.');
 return {assets, byId};
}
export function partKey(name) {
 const k = String(name || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
 if (PARTS[k]) return k;
 if (ALIASES[k]) return ALIASES[k];
 const byAsset = Object.entries(PARTS).find(([, p]) => p.asset === name);
 if (byAsset) return byAsset[0];
 throw Error(`Unknown component "${name}". Use one of: ${Object.keys(PARTS).join(', ')}.`);
}
// The profile of a placed item: its library part, or a guess for parts the user added in the app.
function profileOf(item, lib) {
 const saved = item.mcpPart && PARTS[item.mcpPart];
 if (saved && saved.asset === item.assetId) return saved;
 const type = item.optics?.type;
 const match = Object.values(PARTS).filter(p => p.asset === item.assetId);
 const exact = match.find(p => p.optics?.type && p.optics.type === type) || match.find(p => !p.optics) || match[0];
 if (exact) return exact;
 const a = lib.byId.get(item.assetId), t = itemOptics(item, a).type, b = assetBounds(a);
 const kind = t === 'laser' ? 'laser' : ['mirror', 'spherical', 'parabolic'].includes(t) ? 'mirror' : t === 'splitter' ? 'splitter' : ['detector', 'coupler'].includes(t) ? 'end' : 'transmit';
 return {asset:item.assetId, label:a?.name || 'Component', kind, face:'-x', axis:'+x', point:{x:0, y:b ? (b.lo[1] + b.hi[1]) / 2 : 26, z:0}, guessed:true};
}
export function assetBounds(a) {
 if (!a?.meshes) return null;
 if (bounds.has(a.id)) return bounds.get(a.id);
 const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
 for (const m of a.meshes) for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { const v = m.positions[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
 const b = {lo, hi};
 bounds.set(a.id, b);
 return b;
}

// ---------- Directions ----------
// Directions are compass angles on the board seen from above: 0° = +x (right), 90° = −z (towards the back,
// up in the top view), 180° = −x (left), 270° = +z (towards the front). Positive turns are anticlockwise.
const WORDS = {right:0, east:0, '+x':0, x:0, back:90, up:90, north:90, '-z':90, left:180, west:180, '-x':180, front:270, down:270, south:270, '+z':270, z:270};
export function direction(v, what = 'direction') {
 if (typeof v === 'number' && Number.isFinite(v)) return normalizeAngle(v);
 const k = String(v ?? '').trim().toLowerCase();
 if (k in WORDS) return WORDS[k];
 if (k !== '' && Number.isFinite(Number(k))) return normalizeAngle(Number(k));
 throw Error(`Give ${what} in degrees (0 = +x/right, 90 = back, 180 = left, 270 = front) or as right, back, left or front.`);
}
export function turnAngle(v) {
 if (v == null || v === '' || v === 'none' || v === 'straight') return 0;
 if (typeof v === 'number' && Number.isFinite(v)) return v;
 const k = String(v).trim().toLowerCase();
 if (k === 'left') return 90;
 if (k === 'right') return -90;
 if (k === 'back' || k === 'reverse') return 180;
 if (Number.isFinite(Number(k))) return Number(k);
 throw Error('Give turn as left, right, or signed degrees (positive = anticlockwise seen from above).');
}
const vec = phi => { const a = phi * Math.PI / 180; return [Math.cos(a), -Math.sin(a)]; }; // [x, z]
const angleOf = ([x, z]) => normalizeAngle(Math.atan2(-z, x) * 180 / Math.PI);
const round = (v, d = 3) => +v.toFixed(d);

// The item angle that points a part the right way. `din` is the travel direction arriving, `dout` leaving (both [x, z]).
function orientation(profile, din, dout) {
 if (profile.kind === 'mirror' || profile.kind === 'splitter') {
  const f = [dout[0] - din[0], dout[1] - din[1]], n = Math.hypot(...f);
  if (n < 1e-9) throw Error('A mirror cannot send the beam straight on. Give it a turn.');
  const [fx, fz] = [f[0] / n, f[1] / n];
  return normalizeAngle(angleOf([fx, fz]) - faceAngle(profile));
 }
 const phi = angleOf(profile.kind === 'laser' ? dout : din);
 if (profile.kind === 'end' && profile.axis === '-z') return normalizeAngle(phi - 90);
 return phi;
}
// The other way round: the travel direction a part's angle implies (lasers: emission; others: along the axis).
function axisDirection(profile, angle) {
 if (profile.kind === 'end' && profile.axis === '-z') return normalizeAngle(angle + 90);
 return normalizeAngle(angle);
}
// The way the reflecting face points in the part's own frame, as a compass angle (0 = local +x, 270 = local +z).
function faceAngle(profile) {
 return Number.isFinite(profile.face) ? profile.face : profile.face === '+x' ? 0 : 180;
}
function faceNormal(profile, angle) {
 return vec(angle + faceAngle(profile));
}
const reflect2 = (d, n) => { const k = 2 * (d[0] * n[0] + d[1] * n[1]); return [d[0] - k * n[0], d[1] - k * n[1]]; };

// ---------- Project ----------
export function emptyProject(name = 'Untitled setup', board = DEFAULT_BOARD, beamHeight = DEFAULT_BEAM_HEIGHT) {
 return {format:'optical-workbench', version:2, name, board:{...board}, secondaryBoard:null, items:[], assets:[], beams:[], beam:null, measurements:[], beamHeight, hiddenBuiltins:[]};
}
export function boardFrom(input) {
 if (input == null || input === '' || input === 'default' || /mb1218/i.test(String(input))) return {...DEFAULT_BOARD};
 if (typeof input === 'string') {
  const k = input.trim().toLowerCase(), preset = BOARD_PRESETS.find(p => p.id === k || p.name.toLowerCase() === k);
  if (!preset) throw Error(`Unknown board "${input}". Use MB1218, ${BOARD_PRESETS.map(p => p.id).join(', ')}, or {width, depth} in mm.`);
  return validateBoard({...boardSpec(preset), name:preset.name});
 }
 const metric = !input.pitch || Math.abs(input.pitch - 25) < 1e-9;
 return validateBoard({name:input.name || `Breadboard ${input.width} × ${input.depth} mm`, width:input.width, depth:input.depth, thickness:input.thickness ?? 12.7,
  pitch:input.pitch ?? 25, marginX:input.margin ?? (metric ? 12.5 : 12.7), marginZ:input.margin ?? (metric ? 12.5 : 12.7)});
}
// Check a project with the library models (and any custom models it carries) and return it without models.
export function checkProject(project, lib, custom = new Map()) {
 const assets = (project.assets || []).filter(a => !lib.byId.has(a.id));
 const p = validateProject({...project, assets}, lib.assets);
 for (const a of p.assets) custom.set(a.id, a);
 delete p.assets;
 for (const i of p.items) if (!lib.byId.has(i.assetId) && !custom.has(i.assetId) && !i.assetId.startsWith('builtin-')) throw Error(`Missing model for ${i.name}.`);
 return p;
}
export const assetOf = (lib, custom) => id => lib.byId.get(id) || custom?.get(id);
// The beam height of a setup made in the app: where its parts' optical points sit, else the standard height.
export function inferBeamHeight(p, lib) {
 const ys = p.items.filter(i => !isHolder(i) && profileOf(i, lib) && !profileOf(i, lib).guessed).map(i => opticalPoint(p, i, lib).world.y).sort((a, b) => a - b);
 return ys.length ? round(ys[Math.floor(ys.length / 2)], 4) : DEFAULT_BEAM_HEIGHT;
}
// The project as a file the app opens: with every non-built-in model it uses.
export function projectFile(p, lib, custom = new Map()) {
 const ids = new Set(p.items.map(i => i.assetId));
 for (const b of [p.board, p.secondaryBoard?.board]) if (b?.assetId) ids.add(b.assetId);
 return {...structuredClone(p), assets:[...ids].filter(id => !id.startsWith('builtin-')).map(id => lib.byId.get(id) || custom.get(id)).filter(Boolean)};
}
// Custom models the live view needs alongside the project (the library ones it already has).
export function customAssets(p, lib, custom) {
 const ids = new Set(p.items.map(i => i.assetId));
 return [...ids].filter(id => !lib.byId.has(id) && custom.has(id)).map(id => custom.get(id));
}

// ---------- Finding things ----------
export function findItem(p, ref) {
 if (ref && typeof ref === 'object') ref = ref.id;
 const s = String(ref ?? '').trim();
 const hit = p.items.find(i => i.id === s) || p.items.find(i => i.name.toLowerCase() === s.toLowerCase());
 if (!hit) throw Error(`No component "${s}". Call get_setup to see the ids.`);
 return hit;
}
const holderOf = (p, i) => i.mount && p.items.find(h => h.id === i.mount.holderId);
const isHolder = (i) => i.assetId === HOLDER;
function rootOf(p, i) { let r = i; for (let h = holderOf(p, r); h; h = holderOf(p, r)) r = h; return r; }
function nextId(p, base) {
 const stem = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
 let n = 1;
 while (p.items.some(i => i.id === `${stem}-${n}`)) n++;
 return `${stem}-${n}`;
}
function nextName(p, label) {
 let n = 1;
 while (p.items.some(i => i.name === `${label} ${n}`)) n++;
 return `${label} ${n}`;
}
// The world point where light meets the part, and the part's local point for beam routes.
export function opticalPoint(p, i, lib) {
 const prof = profileOf(i, lib), w = localToWorld(i, prof.point);
 return {world:w, local:{...prof.point}, profile:prof};
}

// ---------- Placing ----------
function makeOptics(prof, asset, overrides) {
 const base = prof.optics || null, type = overrides?.type || base?.type || defaultType(asset);
 if (!base && !overrides) return undefined;
 const o = {...(base || {}), ...(overrides || {}), type};
 try { return validateOptics(o); } catch { throw Error(`Invalid optics for a ${OPTIC_TYPES[type] || type}: ${JSON.stringify(overrides)}. Call list_components for the settings and their ranges.`); }
}
// New optical settings for a placed part: merged over what it has, checked against the app's ranges.
export function setOptics(item, asset, changes) {
 const prof = item.mcpPart && PARTS[item.mcpPart];
 const type = changes.type || item.optics?.type || prof?.optics?.type || defaultType(asset);
 const base = item.optics?.type === type ? item.optics : (prof?.optics?.type === type ? prof.optics : {});
 const o = {...base, ...changes, type};
 try { item.optics = validateOptics(o); } catch { throw Error(`Invalid optics for a ${OPTIC_TYPES[type] || type}: ${JSON.stringify(changes)}. Call list_components for the settings and their ranges.`); }
 return itemOptics(item, asset);
}
export const profileFor = (item, lib) => profileOf(item, lib);
// The item angle for a requested direction (lasers, lenses, cells, detectors: the way the beam travels)
// or facing (mirrors, splitters: the way the reflecting face points). Null when neither is given.
export function angleFrom(prof, {direction:d, facing, angle}) {
 if (Number.isFinite(angle)) return angle;
 if (prof.kind === 'mirror' || prof.kind === 'splitter') {
  if (facing == null) return null;
  const f = direction(facing, 'facing');
  return normalizeAngle(f - faceAngle(prof));
 }
 if (d == null) return null;
 const v = direction(d);
 return prof.kind === 'end' && prof.axis === '-z' ? v - 90 : v;
}
// Place a library part so that its optical point lands on (x, z) at the beam height, turned to `angle`.
export function placePart(p, lib, key, {x, z, angle = 0, name, optics, holder = true, id} = {}) {
 if (!p.board) throw Error('Start a setup with new_setup first.');
 if (p.items.length > 296) throw Error('The app holds up to 300 components, holders included.');
 if (![x, z].every(Number.isFinite)) throw Error('Give x and z in mm.');
 const prof = PARTS[key], asset = lib.byId.get(prof.asset), off = rotateXZ(prof.point.x, prof.point.z, angle);
 const item = {id:id || nextId(p, prof.label), name:String(name || nextName(p, prof.label)).slice(0, 100), assetId:prof.asset, x:round(x - off.x, 4), z:round(z - off.z, 4), y:0,
  angle:normalizeAngle(round(angle, 6)), locked:false, partNumber:asset.partNumber || '', mcpPart:key};
 if (p.items.some(i => i.id === item.id)) throw Error(`The id ${item.id} is taken.`);
 const o = makeOptics(prof, asset, optics);
 if (o) item.optics = o;
 const H = p.beamHeight ?? DEFAULT_BEAM_HEIGHT;
 if (holder) {
  const spec = lib.byId.get(HOLDER).holderSpec, post = spec.postHeight + (H - spec.top - prof.point.y);
  const h = {id:nextId(p, 'holder'), name:'Post holder', assetId:HOLDER, x:item.x, z:item.z, y:0, angle:0, locked:false, partNumber:lib.byId.get(HOLDER).partNumber || ''};
  if (Math.abs(post - spec.postHeight) > 1e-3) h.holder = {post:round(post, 4)};
  try { holderDimensions(spec, h.holder); } catch {
   const lo = spec.top - spec.postHeight + holderDimensions(spec).postMin + prof.point.y;
   throw Error(`A ${prof.label.toLowerCase()} on a post holder cannot reach a ${fmt(H, 1)} mm beam height (lowest ${fmt(lo, 1)} mm). Raise the beam height with new_setup, or place it without a holder.`);
  }
  item.mount = {holderId:h.id, x:0, z:0, angle:item.angle, offset:0};
  p.items.push(item, h);
 } else {
  item.y = round(Math.max(0, H - prof.point.y), 4);
  p.items.push(item);
 }
 syncMounts(p.items, lib.byId);
 return item;
}
// Point an item's own optical axis (laser emission, lens axis, detector input) or its mirror face.
export function setAngle(p, lib, item, angle) {
 const before = opticalPoint(p, item, lib).world;
 const root = rootOf(p, item);
 if (root !== item) {
  item.mount.angle = normalizeAngle(angle - root.angle);
 } else item.angle = normalizeAngle(angle);
 syncMounts(p.items, lib.byId);
 // Keep the optical point where it was.
 const after = opticalPoint(p, item, lib).world;
 translateItems(p.items, [root.id], before.x - after.x, before.z - after.z, 0, lib.byId);
}
export function moveTo(p, lib, item, x, z) {
 const at = opticalPoint(p, item, lib).world, root = rootOf(p, item);
 translateItems(p.items, [root.id], x - at.x, z - at.z, 0, lib.byId);
}
// Setups made before the mirror mounts were read from their meshes have flat mirrors turned back to front
// (knobs towards the beam) and parabolic mirrors 45° out, with the beam meeting the mount origin.
// Turn each such mirror so the same surface normal comes from its reflecting face, and put that face on the
// old bounce point. Only parts the server placed (mcpPart) whose beam still meets the mount origin are changed.
const OLD_FACE = {'mirror':180, 'concave-mirror':180, 'parabolic-mirror':0};
export function repairOldMirrors(p, lib) {
 const fixed = [];
 for (const item of p.items) {
  const prof = PARTS[item.mcpPart];
  if (!(item.mcpPart in OLD_FACE) || prof.asset !== item.assetId || item.locked) continue;
  const refs = (p.beams || []).flatMap(b => b.points.filter(q => q.itemId === item.id));
  if (!refs.length || !refs.every(q => Math.hypot(q.x, q.z) < 1)) continue;
  const o = rotateXZ(refs[0].x, refs[0].z, item.angle), bounce = [item.x + o.x, item.z + o.z];
  setAngle(p, lib, item, normalizeAngle(item.angle + OLD_FACE[item.mcpPart] - faceAngle(prof)));
  moveTo(p, lib, item, bounce[0], bounce[1]);
  for (const q of refs) Object.assign(q, {x:prof.point.x, y:prof.point.y, z:prof.point.z});
  if (item.mount) tidyHolders(p, lib, new Set([item.mount.holderId]));
  fixed.push(item);
 }
 return fixed;
}
export function removeItem(p, item) {
 const root = rootOf(p, item), gone = descendantIds(p.items, [root.id]);
 // The part goes with its holder and anything else on that holder; beams keep a free point where it was.
 detachRoutes(p.beams, gone, p.items);
 p.items = p.items.filter(i => !gone.has(i.id));
 return [...gone];
}

// Turn each new holder's clamp base to the side where it hits the fewest other parts.
export function tidyHolders(p, lib, ids) {
 // Only holders whose parts sit on the post centre: turning those leaves every part where it is.
 const chosen = p.items.filter(i => isHolder(i) && (!ids || ids.has(i.id)) && !i.locked && p.items.every(c => c.mount?.holderId !== i.id || (Math.abs(c.mount.x) < 1e-6 && Math.abs(c.mount.z) < 1e-6)));
 for (let pass = 0; pass < 2; pass++) for (const h of chosen) {
  let best = null;
  const keep = h.angle;
  for (const a of [0, 90, 180, 270]) {
   rotateHolder(p, lib, h, a);
   const me = worldBox(h, lib), cost = p.items.filter(o => o !== h && o.mount?.holderId !== h.id).reduce((t, o) => t + overlap(me, worldBox(o, lib)), 0) + (outside(p, me) ? 1e6 : 0);
   if (!best || cost < best.cost - 1e-6 || (Math.abs(cost - best.cost) < 1e-6 && a === keep)) best = {a, cost};
  }
  rotateHolder(p, lib, h, best.a);
 }
}
// Turn a holder about its post without turning the part on it.
function rotateHolder(p, lib, h, a) {
 const kids = p.items.filter(i => i.mount?.holderId === h.id), keep = kids.map(k => k.angle);
 h.angle = a;
 kids.forEach((k, n) => { k.mount.angle = normalizeAngle(keep[n] - a); });
 syncMounts(p.items, lib.byId);
}

// ---------- Geometry checks ----------
function localBox(i, lib, custom) {
 const a = lib.byId.get(i.assetId) || custom?.get(i.assetId);
 if (isHolder(i)) { const b = assetBounds(a), top = holderDimensions(a.holderSpec, i.holder).top; return {lo:[b.lo[0], 0, b.lo[2]], hi:[b.hi[0], top, b.hi[2]]}; }
 const b = assetBounds(a);
 if (!b) return null;
 if (a.cellSpec) {
  const o = itemOptics(i, a), s = a.cellSpec, end = s.length / 2 - s.core, half = Math.max(end + 1, (o.length || s.length) / 2) + end;
  return {lo:[-half, b.lo[1], b.lo[2]], hi:[half, b.hi[1], b.hi[2]]};
 }
 return b;
}
function worldBox(i, lib, custom) {
 const b = localBox(i, lib, custom);
 if (!b) return null;
 const pts = [[b.lo[0], b.lo[2]], [b.hi[0], b.lo[2]], [b.lo[0], b.hi[2]], [b.hi[0], b.hi[2]]].map(([x, z]) => localToWorld(i, {x, y:0, z}));
 return {x0:Math.min(...pts.map(q => q.x)), x1:Math.max(...pts.map(q => q.x)), z0:Math.min(...pts.map(q => q.z)), z1:Math.max(...pts.map(q => q.z)), y0:i.y + b.lo[1], y1:i.y + b.hi[1], corners:pts};
}
const overlap = (a, b) => !a || !b ? 0 : Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0)) * (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > .1 ? 1 : 0);
function outside(p, box) {
 const places = boardPlacements(p.board, p.secondaryBoard);
 return !!box && box.corners.some(c => !places.some(pl => contains(pl, c.x, c.z)));
}
// Where a straight beam segment passes through a part it is not meant to touch (in that part's own frame).
function segmentHitsItem(a, b, i, lib, custom) {
 const box = localBox(i, lib, custom);
 if (!box) return false;
 const A = worldToLocal(i, {x:a[0], y:a[1], z:a[2]}), B = worldToLocal(i, {x:b[0], y:b[1], z:b[2]});
 const s = [A.x, A.y, A.z], d = [B.x - A.x, B.y - A.y, B.z - A.z];
 let t0 = .02, t1 = .98;
 for (let k = 0; k < 3; k++) {
  const lo = box.lo[k] + .5, hi = box.hi[k] - .5;
  if (Math.abs(d[k]) < 1e-12) { if (s[k] < lo || s[k] > hi) return false; continue; }
  let u = (lo - s[k]) / d[k], v = (hi - s[k]) / d[k];
  if (u > v) [u, v] = [v, u];
  t0 = Math.max(t0, u); t1 = Math.min(t1, v);
  if (t0 > t1) return false;
 }
 return true;
}
export function checks(p, lib, custom) {
 const notes = [], items = p.items;
 const boxes = new Map(items.map(i => [i.id, worldBox(i, lib, custom)]));
 for (const i of items) if (!isHolder(i) || !items.some(c => c.mount?.holderId === i.id)) if (outside(p, boxes.get(i.id))) notes.push(`${i.name} (${i.id}) hangs over the edge of the board.`);
 for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
  const A = items[a], B = items[b];
  if (A.mount?.holderId === B.id || B.mount?.holderId === A.id) continue;
  const v = overlap(boxes.get(A.id), boxes.get(B.id));
  if (v > 4) notes.push(`${A.name} (${A.id}) and ${B.name} (${B.id}) overlap (${Math.round(v)} mm² of footprint).`);
 }
 for (const beam of p.beams || []) {
  const pts = beam.points.map(q => { const i = q.itemId && items.find(i => i.id === q.itemId); const w = i ? localToWorld(i, q) : q; return [w.x, w.y, w.z]; });
  for (let k = 1; k < pts.length; k++) {
   const ends = new Set([beam.points[k - 1].itemId, beam.points[k].itemId].filter(Boolean));
   for (const i of items) {
    if (ends.has(i.id) || isHolder(i)) continue;
    if (segmentHitsItem(pts[k - 1], pts[k], i, lib, custom)) notes.push(`${beam.name}: the beam between points ${k - 1} and ${k} runs through ${i.name} (${i.id}).`);
   }
  }
 }
 return notes;
}

// ---------- Beams ----------
const COLOURS = ['#1f6fd1', '#1f9e6a', '#d1452f', '#8a4fd1', '#d18a1f', '#178a9e'];
export function addBeam(p, {points, name, color, width = 2.5}) {
 if (points.length < 2) throw Error('A beam needs at least two points.');
 if ((p.beams || []).length >= 100) throw Error('The app holds up to 100 beams.');
 const n = (p.beams || []).length;
 let k = 1;
 while ((p.beams || []).some(b => b.id === `beam-${k}`)) k++;
 const beam = {id:`beam-${k}`, name:String(name || `Beam ${k}`).slice(0, 100), enabled:true, color:/^#[0-9a-f]{6}$/i.test(color || '') ? color : COLOURS[n % COLOURS.length], width, opacity:.9, physics:true, points};
 p.beams = [...(p.beams || []), beam];
 return beam;
}
export function findBeam(p, ref) {
 const s = String(ref ?? '').trim().toLowerCase();
 const b = (p.beams || []).find(b => b.id.toLowerCase() === s) || (p.beams || []).find(b => b.name.toLowerCase() === s);
 if (!b) throw Error(`No beam "${ref}". Call get_setup to see the beams.`);
 return b;
}
const routePoint = (p, i, lib) => ({...opticalPoint(p, i, lib).local, itemId:i.id});
// The beam that passes through a splitter, and the arm it does not take: where a branch starts.
function branchFrom(p, lib, splitter) {
 const parent = (p.beams || []).find(b => b.points.slice(1, -1).some(q => q.itemId === splitter.id));
 if (!parent) throw Error(`${splitter.name} has no beam passing through it yet. Build the main beam first.`);
 const k = parent.points.findIndex((q, j) => j > 0 && q.itemId === splitter.id);
 const world = q => { const i = q.itemId && p.items.find(i => i.id === q.itemId); return i ? localToWorld(i, q) : q; };
 const a = world(parent.points[k - 1]), c = world(parent.points[k]), b = world(parent.points[k + 1]);
 const din = norm2([c.x - a.x, c.z - a.z]), dout = norm2([b.x - c.x, b.z - c.z]);
 const reflected = reflect2(din, faceNormal(profileOf(splitter, lib), splitter.angle));
 const tookTransmitted = din[0] * dout[0] + din[1] * dout[1] > .99;
 return {dir:tookTransmitted ? reflected : din, arm:tookTransmitted ? 'reflected' : 'transmitted'};
}
const norm2 = v => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n]; };

// Build a beam path step by step: place (or reuse) each part along the beam, aim it, and route a physical beam through it.
export function buildPath(p, lib, {start, steps, name, color}) {
 if (!start) throw Error('Give a start: a new laser {component, x, z, direction} or an existing part {from}.');
 if (!Array.isArray(steps) || !steps.length) throw Error('Give at least one step after the start.');
 const created = [], H = p.beamHeight ?? DEFAULT_BEAM_HEIGHT, notes = [];
 let first, here, dir;
 if (start.from) {
  first = findItem(p, start.from);
  const prof = profileOf(first, lib);
  here = opticalPoint(p, first, lib).world;
  if (prof.kind === 'splitter') {
   const br = branchFrom(p, lib, first);
   dir = br.dir;
   notes.push(`Starts on the ${br.arm} arm of ${first.name}.`);
  } else if (start.direction != null) dir = vec(direction(start.direction));
  else if (prof.kind === 'laser') dir = vec(axisDirection(prof, first.angle));
  else throw Error('Give start.direction for a beam that does not start on a laser or splitter.');
 } else {
  const key = partKey(start.component || 'nanoplus-laser');
  if (PARTS[key].kind !== 'laser') throw Error('A new beam starts on a laser. To start elsewhere, place the part first and use start.from.');
  const phi = direction(start.direction ?? 0, 'start.direction');
  first = placePart(p, lib, key, {x:start.x ?? 0, z:start.z ?? 0, angle:phi, name:start.name, optics:start.optics, holder:start.holder !== false});
  created.push(first);
  here = opticalPoint(p, first, lib).world;
  dir = vec(phi);
 }
 // Lay out the optical points first; aim the parts once each one's neighbours are known.
 const plan = [{item:first, at:[here.x, here.z]}];
 for (const [n, s] of steps.entries()) {
  const label = `Step ${n + 1}`;
  let at;
  const existing = s.existing != null ? findItem(p, s.existing) : null;
  if (existing) { const w = opticalPoint(p, existing, lib).world; at = [w.x, w.z]; }
  else if (Number.isFinite(s.x) && Number.isFinite(s.z)) at = [s.x, s.z];
  else if (Number.isFinite(s.distance) && s.distance > 0) at = [plan.at(-1).at[0] + dir[0] * s.distance, plan.at(-1).at[1] + dir[1] * s.distance];
  else throw Error(`${label}: give distance (mm along the beam from the previous part), or x and z, or existing.`);
  const din = norm2([at[0] - plan.at(-1).at[0], at[1] - plan.at(-1).at[1]]);
  let key = null;
  if (!existing) {
   if (s.component === 'endpoint') key = 'endpoint';
   else if (s.component) key = partKey(s.component);
   else throw Error(`${label}: give a component (or "endpoint" for a free end point), or existing.`);
  }
  const prof = existing ? profileOf(existing, lib) : key === 'endpoint' ? {kind:'endpoint'} : PARTS[key];
  let dout = din, splitArm = null;
  const turn = turnAngle(s.turn);
  if (prof.kind === 'mirror') {
   if (!turn && n < steps.length - 1) throw Error(`${label}: a mirror needs a turn (left, right or degrees).`);
   dout = vec(angleOf(din) + (turn || 180));
  } else if (prof.kind === 'splitter') {
   const side = turnAngle(s.turn ?? 'left') || 90, reflected = vec(angleOf(din) + side);
   const follow = String(s.follow || 'transmitted').toLowerCase();
   if (!['transmitted', 'reflected'].includes(follow)) throw Error(`${label}: follow is transmitted or reflected.`);
   splitArm = {reflected, follow};
   dout = follow === 'reflected' ? reflected : din;
  } else if (turn && prof.kind !== 'endpoint') throw Error(`${label}: only mirrors and beam splitters turn the beam.`);
  plan.push({step:s, existing, key, prof, at, din, dout, splitArm, label});
  dir = dout;
 }
 // Place and aim.
 for (const [n, st] of plan.entries()) {
  if (n === 0) continue;
  if (st.key === 'endpoint') continue;
  const prof = st.prof, din = st.din;
  const dref = st.splitArm ? st.splitArm.reflected : st.dout;
  const angle = prof.kind === 'end' || prof.kind === 'transmit' ? orientation(prof, din, din) : orientation(prof, din, dref);
  if (st.existing) {
   if (st.step.aim !== false && !st.existing.locked) setAngle(p, lib, st.existing, angle);
   st.item = st.existing;
  } else {
   st.item = placePart(p, lib, st.key, {x:st.at[0], z:st.at[1], angle, name:st.step.name, optics:st.step.optics, holder:st.step.holder !== false});
   created.push(st.item);
  }
  const o = itemOptics(st.item, lib.byId.get(st.item.assetId));
  if (o.type === 'parabolic') {
   const turned = Math.round(Math.acos(Math.max(-1, Math.min(1, st.din[0] * st.dout[0] + st.din[1] * st.dout[1]))) * 180 / Math.PI);
   const off = o.offAxis;
   if (Math.abs(turned - off) > 1) notes.push(`${st.item.name} turns the beam by ${turned}°, but it is a ${off}° off-axis parabola. Use a ${off}° turn, or set optics.offAxis.`);
  }
 }
 const points = plan.map((st, n) => {
  if (n === 0) return routePoint(p, first, lib);
  if (st.key === 'endpoint') return {x:round(st.at[0], 4), y:H, z:round(st.at[1], 4), label:st.step.name || 'Endpoint'};
  return routePoint(p, st.item, lib);
 });
 tidyHolders(p, lib, new Set(created.map(i => i.mount?.holderId).filter(Boolean)));
 const beam = addBeam(p, {points, name, color});
 return {beam, created, notes};
}

// Route a beam through parts already on the board, in order.
export function beamThrough(p, lib, {through, end, name, color}) {
 if (!Array.isArray(through) || through.length < (end ? 1 : 2)) throw Error('List at least two parts (or one part and an end point).');
 const items = through.map(r => findItem(p, r)), points = items.map(i => routePoint(p, i, lib));
 if (end) {
  if (![end.x, end.z].every(Number.isFinite)) throw Error('end needs x and z in mm.');
  points.push({x:end.x, y:p.beamHeight ?? DEFAULT_BEAM_HEIGHT, z:end.z, label:'Endpoint'});
 }
 return addBeam(p, {points, name, color});
}

// Move the part at the end of a beam along the last leg to where the beam focuses.
export function moveToFocus(p, lib, custom, item) {
 const beam = (p.beams || []).find(b => b.points.at(-1).itemId === item.id);
 if (!beam) throw Error(`${item.name} is not at the end of a beam.`);
 const t = traceGaussian(beam, p.items, assetOf(lib, custom), p.beams);
 if (!t.ok) throw Error(t.error);
 const f = focusOnEndpoint(t);
 if (!f?.ok) throw Error(f?.reason || 'There is no focus on the last leg.');
 translateItems(p.items, [rootOf(p, item).id], f.move[0], f.move[2], 0, lib.byId);
 return f;
}

// ---------- Reading the setup back ----------
const fmt = (v, d = 1) => Number.isFinite(v) ? String(+v.toFixed(d)) : '–';
function opticsSummary(i, a) {
 const o = itemOptics(i, a);
 switch (o.type) {
  case 'laser': return `${o.wavelength} µm, ${fmtPower(o.power ?? 10)}, ${o.spec === 'divergence' ? `divergence ${o.divergence} mrad` : `waist Ø ${o.diameter} mm`}, M² ${o.m2}`;
  case 'lens': return `f ${o.focal} mm ${MATERIALS[o.material]?.name || o.material} (at ${o.designWavelength} µm), Ø ${o.aperture} mm, ${o.coating === 'uncoated' ? 'uncoated' : 'AR coated'}`;
  case 'mirror': return `flat, ${COATINGS[o.coating]?.name || o.coating}`;
  case 'spherical': return `concave R ${o.roc} mm (f ${o.roc / 2} mm), ${COATINGS[o.coating]?.name || o.coating}`;
  case 'parabolic': return `parabolic f ${o.focal} mm, ${o.offAxis}° off-axis`;
  case 'splitter': return `R ${o.reflectance}% / T ${100 - o.reflectance}%`;
  case 'window': return `${MATERIALS[o.material]?.name || o.material}${o.brewster ? ', Brewster' : o.coating === 'uncoated' ? ', uncoated' : ', AR coated'}`;
  case 'filter': return o.kind === 'bandpass' ? `bandpass ${o.center} µm, FWHM ${o.fwhm} µm, peak ${o.peak}%` : `ND, OD ${o.od}`;
  case 'gascell': return `${o.mode === 'multipass' ? `multipass ${o.passes} × ${o.length} mm${o.mirrorRoc ? `, mirrors R ${o.mirrorRoc} mm` : ''}` : `single pass ${o.length} mm`}, ${o.ppm} ppm, σ ${o.sigma} cm², ${o.pressure} hPa, ${o.temperature} K`;
  case 'coupler': return o.kind === 'pinhole' ? `pinhole Ø ${o.pinhole} µm` : `single-mode fibre, MFD ${o.mfd} µm`;
  case 'detector': return `active area ${o.activeArea} mm${o.responsivity ? `, ${o.responsivity} V/W` : ''}${o.maxOutput ? `, max ${o.maxOutput} V` : ''}`;
  default: return 'not optical';
 }
}
export function describe(p, lib, custom) {
 const a = assetOf(lib, custom), lines = [];
 const g = p.board;
 lines.push(`Setup "${p.name}" on ${g ? `${g.name}, ${g.width} × ${g.depth} mm (x ${fmt(-g.width / 2)}…${fmt(g.width / 2)}, z ${fmt(-g.depth / 2)}…${fmt(g.depth / 2)}), ${g.pitch} mm hole pitch` : 'no board'}. Beam height ${fmt(p.beamHeight ?? DEFAULT_BEAM_HEIGHT, 2)} mm above the board.`);
 const parts = p.items.filter(i => !isHolder(i) || !p.items.some(c => c.mount?.holderId === i.id));
 if (!parts.length) lines.push('No components yet.');
 for (const i of parts) {
  if (isHolder(i)) { lines.push(`- ${i.id}: ${i.name}, empty post holder at x ${fmt(i.x)}, z ${fmt(i.z)}`); continue; }
  const prof = profileOf(i, lib), w = localToWorld(i, prof.point), h = holderOf(p, i);
  const facing = prof.kind === 'mirror' || prof.kind === 'splitter' ? `face points ${fmt(angleOf(faceNormal(prof, i.angle)), 0)}°` : prof.kind === 'laser' ? `emits towards ${fmt(axisDirection(prof, i.angle), 0)}°` : prof.kind === 'end' ? `input faces ${fmt(normalizeAngle(axisDirection(prof, i.angle) + 180), 0)}°` : `axis ${fmt(axisDirection(prof, i.angle) % 180, 0)}°`;
  const holder = h ? `on ${h.id}${h.holder?.post ? ` (post ${fmt(h.holder.post, 2)} mm)` : ''}` : 'no holder';
  lines.push(`- ${i.id}: ${i.name} [${i.mcpPart || a(i.assetId)?.name || i.assetId}] optical point x ${fmt(w.x)}, z ${fmt(w.z)}, height ${fmt(w.y)}; angle ${fmt(i.angle)}°, ${facing}; ${holder}${i.locked ? '; locked' : ''}. ${opticsSummary(i, a(i.assetId))}`);
 }
 for (const b of p.beams || []) {
  const names = b.points.map(q => q.itemId ? (p.items.find(i => i.id === q.itemId)?.id || '?') : `(${fmt(q.x)}, ${fmt(q.z)})`);
  lines.push(`Beam ${b.id} "${b.name}"${b.physics ? '' : ' (drawn only)'}${b.enabled === false ? ' (hidden)' : ''}: ${names.join(' → ')}`);
 }
 return lines.join('\n');
}
export function analyze(p, lib, custom, which) {
 const a = assetOf(lib, custom), beams = (p.beams || []).filter(b => !which || b.id === which.id);
 if (!beams.length) return 'There are no beams yet. Use build_beam_path or add_beam.';
 const out = [];
 for (const b of beams) {
  if (!b.physics) { out.push(`${b.name}: drawn only (no physics).`); continue; }
  const t = traceGaussian(b, p.items, a, p.beams);
  if (!t.ok) { out.push(`${b.name}: ${t.error}`); continue; }
  const L = t.laser;
  out.push(`${b.name} (${b.id}): ${L.wavelength} µm, waist Ø ${fmt(L.waistDiameter, 2)} mm, divergence ${fmt(L.divergence, 2)} mrad (full), M² ${L.m2}, ${fmtPower(t.power.start)} at the start.`);
  const story = plainSummary(t);
  if (story.length) out.push(`  In short: ${story.join(' ')}`);
  for (const q of t.points) {
   const bits = [`${fmt(q.s - t.start, 1)} mm`, `beam Ø ${fmt(q.d, 2)} mm`];
   if (q.powerIn != null && q.index > 0) bits.push(q.powerOut != null && Math.abs(q.powerOut - q.powerIn) > 1e-9 ? `${fmtPower(q.powerIn)} → ${fmtPower(q.powerOut)}` : fmtPower(q.powerIn));
   if (q.clip != null && q.clip < .99) bits.push(`aperture passes ${pct(q.clip)}`);
   if (q.arm) bits.push(`${q.arm} arm`);
   if (q.f != null) bits.push(`f ${fmt(q.f, 1)} mm here → ${q.focus > 0 ? `focus ${fmt(q.focus, 1)} mm after, waist Ø ${fmt(q.focusDiameter * 1000, 0)} µm${q.focusReached ? '' : ' (not reached before the next optic or the end)'}` : 'beam diverges after it'}`);
   if (q.gas) bits.push(`gas absorbs ${pct(1 - q.gas.transmission)} (absorbance ${q.gas.tau.toFixed(3)}, ${fmt(q.gas.path, 0)} mm path)`);
   if (q.captured != null) bits.push(`${pct(q.captured)} lands on the active area: ${fmtPower(q.detectedPower)}${q.signal != null ? ` → ${q.signal.toFixed(3)} V` : ''}${q.saturated ? ' (saturated)' : ''}`);
   if (q.coupling != null) bits.push(`${q.couplerKind === 'pinhole' ? 'pinhole passes' : 'fibre coupling'} ${pct(q.coupling)}${q.coupledPower != null ? ` = ${fmtPower(q.coupledPower)}` : ''}`);
   out.push(`  ${q.index}. ${q.name}: ${bits.join('; ')}`);
   if (q.insight) out.push(...cellLines(q.insight).map(l => `     ${l}`));
  }
  for (const w of t.waists) out.push(`  Waist Ø ${fmt(w.d * 1000, 0)} µm at ${fmt(w.s - t.start, 1)} mm along the beam (x ${fmt(w.world[0])}, z ${fmt(w.world[2])}).`);
  if (t.power.gasSignal != null) out.push(`  Gas absorption signal at the detector: ${t.power.gasSignal.toFixed(4)} V.`);
  else if (t.power.gasDelta != null) out.push(`  Gas takes ${fmtPower(t.power.gasDelta)} from the detected power.`);
  if (t.alignment.length) out.push(`  Alignment: tilting ${t.alignment[0].name} by 1 mrad moves the end spot ${fmt(t.alignment[0].shift, 0)} µm${t.alignment.length > 1 ? `; ${t.alignment.slice(1, 3).map(m => `${m.name} ${fmt(m.shift, 0)} µm`).join(', ')}` : ''}.`);
  for (const w of t.warnings) out.push(`  Warning: ${w}`);
  // What the optimiser could do for this beam's natural goal, without changing anything.
  const idea = optimiseBeam(p, b, a, {goal:defaultGoal(t)});
  if (idea.ok && idea.changes.length && idea.gain > 1.05) out.push(`  Idea: optimize_setup with goal "${idea.goal}" would raise the ${GOALS[idea.goal].what} ${idea.gain.toFixed(2)}× (${goalText(idea.goal, idea.before)} → ${goalText(idea.goal, idea.after)}) by: ${describeChanges(idea).join('; ')}.`);
 }
 return out.join('\n');
}
// A multipass cell in numbers: the path, the gain over one pass, and what its mirror geometry does.
export function cellLines(i) {
 const lines = [`Path ${fmt(i.passes)} passes × ${fmt(i.perPass)} mm = ${fmt(i.path / 1000, 3)} m, ${fmt(i.pathGain)}× one pass. Gas signal ${fmt(i.signalGain, 2)}× one pass (mirrors ${pct(i.mirrorReflectance)} each, ${pct(i.cell.mirrors)} after all bounces).`];
 if (i.passes > 1 && i.bestPasses !== i.passes) lines.push(`With these mirrors the gas signal peaks at ${i.bestPasses} passes (${fmt(i.bestGain, 2)}× one pass)${i.herriott?.stable ? '' : '; more passes lose more light at the mirrors than the extra path gains'}.`);
 const h = i.herriott;
 if (h?.stable) lines.push(`Mirror geometry: R ${fmt(h.roc)} mm, ${fmt(h.spacing)} mm apart → the spot ring turns ${fmt(h.theta * 180 / Math.PI, 2)}° per pass; ${h.exit ? `the beam leaves through the hole after ${h.exit} passes (pattern M = ${h.M})` : 'the beam does not come back to the hole'}; neighbouring spots ${fmt(h.spotGap, 1)} mm apart on a ${fmt(h.ring, 1)} mm ring; at most ${h.maxPasses} passes fit with the Ø ${fmt(2 * h.hole, 1)} mm hole.${h.design && h.target <= h.maxPasses && h.exit !== h.target ? ` ${h.target} passes need ${fmt(h.design.spacing, 2)} mm spacing.` : ''}`);
 else if (h) lines.push(`Mirror geometry: R ${fmt(h.roc)} mm mirrors ${fmt(h.spacing)} mm apart cannot hold the beam (needs less than ${fmt(2 * h.roc)} mm).`);
 return lines;
}

// ---------- Optimising ----------
// Improve a beam for a goal and, unless apply is false, make the changes: parts slide with their holders.
export function optimise(p, lib, custom, {goal, beam, parts, apply = true} = {}) {
 const a = assetOf(lib, custom), physics = (p.beams || []).filter(b => b.physics);
 let b = beam ? findBeam(p, beam) : null;
 if (!b) {
  if (!physics.length) throw Error('There is no physical beam to optimise. Build one with build_beam_path first.');
  b = goal === 'absorption' ? physics.find(x => traceGaussian(x, p.items, a, p.beams).points?.some(q => q.gas)) || physics[0] : physics[0];
 }
 const only = Array.isArray(parts) && parts.length ? new Set(parts.map(r => findItem(p, r).id)) : null;
 const r = optimiseBeam(p, b, a, {goal, only});
 if (r.ok && apply) for (const c of r.changes) {
  const item = p.items.find(i => i.id === c.id);
  if (c.kind === 'position') {
   const at = opticalPoint(p, item, lib).world;
   moveTo(p, lib, item, at.x + c.move[0], at.z + c.move[1]);
   if (item.mount) tidyHolders(p, lib, new Set([item.mount.holderId]));
  } else setOptics(item, a(item.assetId), c.length != null ? {passes:c.to, length:c.length} : {passes:c.to});
 }
 const head = r.ok ? `${b.name} (${b.id}), goal "${r.goal}" (${GOALS[r.goal].label.toLowerCase()}): ${resultText(r)}` : `${b.name}: ${r.reason}`;
 return {beam:b, result:r, text:[head, ...(r.ok ? describeChanges(r).map(l => '- ' + l) : []), r.ok && r.changes.length && !apply ? 'Nothing was changed (apply was false).' : ''].filter(Boolean).join('\n')};
}

// ---------- Catalogue text ----------
export function catalogue(lib) {
 const lines = ['Components (use the key in build_beam_path and add_component). Optical point: where the beam meets the part; size: footprint of the part alone, length × width × height in mm.'];
 for (const [key, prof] of Object.entries(PARTS)) {
  const a = lib.byId.get(prof.asset), b = assetBounds(a), t = prof.optics?.type || defaultType(a);
  lines.push(`- ${key} (${OPTIC_TYPES[t]}): ${prof.about} Size ${fmt(b.hi[0] - b.lo[0], 0)} × ${fmt(b.hi[2] - b.lo[2], 0)} × ${fmt(b.hi[1] - b.lo[1], 0)} mm.`);
 }
 lines.push('', 'Every part goes on an adjustable post holder by default; the post length is set so all optical points sit at the beam height.',
  '', 'Optics settings (pass only the ones to change):',
  '- laser: wavelength µm (0.2–30), power mW, spec "waist" with diameter mm, or "divergence" with divergence mrad (full angle); m2 (≥1); waistOffset mm.',
  `- lens: focal mm, material (${Object.keys(MATERIALS).join(', ')}), designWavelength µm (wavelength the focal length is quoted at), aperture mm, coating ar|uncoated.`,
  `- mirror: coating (${Object.keys(COATINGS).join(', ')}), reflectance % with coating custom, aperture mm. concave-mirror: roc mm (radius of curvature). parabolic-mirror: focal mm (reflected focal length), offAxis degrees.`,
  '- beam-splitter: reflectance % (the rest is transmitted), aperture mm.',
  '- window: material, coating ar|uncoated, brewster true|false.  filter: kind nd with od, or kind bandpass with center µm, fwhm µm, peak %.',
  '- gas-cell / multipass-cell: mode single|multipass, length mm (per pass: the mirror spacing), passes (multipass), mirrorRoc mm (multipass mirror radius of curvature: the passes then follow from the geometry, cos θ = 1 − length/mirrorRoc, and passes is the target), aperture mm (the coupling hole), ppm, sigma cm² (line cross-section), pressure hPa, temperature K, window material, mirrorCoating.',
  '- fibre-port / pinhole: kind fibre|pinhole, mfd µm (fibre mode field diameter), pinhole µm.',
  '- detector: activeArea mm (side of the square element), responsivity V/W, maxOutput V, rangeMin and rangeMax µm.',
  '', `Boards for new_setup: MB1218 (457.2 × 304.8 mm, default), ${BOARD_PRESETS.map(b => `${b.id} (${b.name})`).join(', ')}, or {width, depth, pitch} in mm.`);
 return lines.join('\n');
}
