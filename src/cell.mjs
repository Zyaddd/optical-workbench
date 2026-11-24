// Gas cells whose body follows the cell length set in Properties. An asset with `cellSpec`
// {length, core, radius} has its axis along local X, centred on x = 0: vertices within `core` of the
// centre scale with the length and the flanged ends beyond it move rigidly, so flanges, windows and
// mirrors keep their shape. `radius` is the tube's inner radius, used for the multipass spot ring.
import {itemOptics} from './optics.mjs';

export const CELL_DRAW_MIN = 20, CELL_DRAW_MAX = 2000;
export function cellLength(item, asset) {
 const o = itemOptics(item, asset);
 return o.type === 'gascell' && Number.isFinite(o.length) ? o.length : asset.cellSpec.length;
}
export function cellMeshes(asset, length) {
 const s = asset.cellSpec;
 if (![s?.length, s?.core].every(v => Number.isFinite(v) && v > 0) || s.core >= s.length / 2) throw Error('Invalid gas cell specification.');
 const end = s.length / 2 - s.core, L = Math.max(CELL_DRAW_MIN, 2 * end + 2, Math.min(CELL_DRAW_MAX, length));
 const core = L / 2 - end, k = core / s.core, shift = core - s.core;
 return asset.meshes.map(m => ({...m, normals:undefined, positions:m.positions.map((v, n) => n % 3 ? v : Math.abs(v) <= s.core ? v * k : v + Math.sign(v) * shift)}));
}
