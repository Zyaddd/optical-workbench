// Workbench mode, a per-viewer preference (not saved in projects):
//  simple     — the hand-drawn layout tool: beams have a set diameter, no optics settings.
//  scientific — physical beams: laser, lens and mirror optics, focus and spot sizes, the optics tour.
const KEY = 'ow_mode';
let mode = (() => { try { return localStorage.getItem(KEY) === 'scientific' ? 'scientific' : 'simple'; } catch { return 'simple'; } })();

export const getMode = () => mode;
export const scientific = () => mode === 'scientific';
export function setMode(next) {
 if (next !== 'simple' && next !== 'scientific') return;
 if (next === mode) return;
 mode = next;
 try { localStorage.setItem(KEY, mode); } catch {}
 paint();
 document.dispatchEvent(new CustomEvent('workbench:mode', {detail:mode}));
}
function paint() {
 document.body.classList.toggle('mode-scientific', mode === 'scientific');
 document.body.classList.toggle('mode-simple', mode === 'simple');
 for (const b of document.querySelectorAll('.modeSwitch button[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
}
// The header switch. Call once the header exists.
export function mountModeSwitch(toast) {
 const nav = document.querySelector('.workspaceActions');
 if (nav && !document.querySelector('.modeSwitch')) {
  const group = document.createElement('div');
  group.className = 'modeSwitch'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Workbench mode');
  for (const [m, label, title] of [['simple', 'Simple', 'Simple mode: draw beams with a set diameter'], ['scientific', 'Scientific', 'Scientific mode: physical beams, lens and laser optics, focus and spot sizes']]) {
   const b = document.createElement('button');
   b.dataset.mode = m; b.textContent = label; b.title = title;
   b.onclick = () => { const changed = m !== mode; setMode(m); if (changed) toast?.(m === 'scientific' ? 'Scientific mode: beams follow real optics. Select a laser or lens to set its parameters.' : 'Simple mode: beams use their set diameter. Optics settings are kept for when you switch back.'); };
   group.append(b);
  }
  nav.prepend(group);
 }
 paint();
}
