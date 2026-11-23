// Optics tour: a hands-on walk through physical beams. It builds a practice bench (laser → lens →
// detector), then asks the user to change real parameters and watch the beam respond. Steps advance
// when the user does the thing asked (events from optics-ui and route-ui), or with Next.
import {setMode} from './mode.mjs';
export function createOpticsTour({$, getState, optics, routeUI, setSelected, ensureLibrary, toast}) {
 let steps = [], index = -1, highlight = null, bench = null;
 const card = document.createElement('div');
 card.className = 'beamTour opticsTour'; card.hidden = true;
 card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Optics tour');
 const counter = document.createElement('small'), title = document.createElement('strong'), text = document.createElement('p');
 const doBox = document.createElement('p'), actions = document.createElement('div');
 doBox.className = 'tourDo';
 const back = Object.assign(document.createElement('button'), {textContent:'Back'});
 const action = Object.assign(document.createElement('button'), {className:'tourAction'});
 const next = Object.assign(document.createElement('button'), {className:'primary'});
 const close = Object.assign(document.createElement('button'), {textContent:'Exit tour'});
 actions.className = 'tourActions'; actions.append(back, action, next, close);
 card.append(counter, title, text, doBox, actions);
 document.body.append(card);

 const item = role => getState().items.find(i => i.id === bench?.[role]);
 const select = role => () => { const i = item(role); if (i) setSelected(i.id); else toast('That practice part is no longer on the bench. Restart the tour to rebuild it.'); };
 const showBeam = () => { if (bench?.beam && (getState().beams || []).some(b => b.id === bench.beam)) routeUI.select(bench.beam); else { const b = getState().beams?.[0]; if (b) routeUI.select(b.id); } };

 const STEPS = [
  {title:'Physical beams: a hands-on tour', text:'You will build a small bench and change real optical parameters: wavelength, beam size, lens focal length and material. The beam reshapes as you type, so you can see focus and spot size change.',
   do:'Press Build practice bench. It replaces the current layout; Undo (Ctrl+Z) brings your layout back.',
   action:{label:'Build practice bench', run() { bench = optics.buildPractice(); return !!bench; }}, needsAction:true},
  {target:'#viewport canvas', title:'Read the beam', text:'The red beam is calculated, not drawn by hand. It leaves the QCL 2.5 mm wide, the ZnSe lens squeezes it to a focus (the white ring), and it spreads again before the detector.',
   do:'Point at the beam anywhere along its length to read its diameter, its distance from the laser and how far ahead the focus is.', event:'workbench:optics-hover'},
  {target:'#viewport canvas', title:'Select the laser', text:'Each part carries its own optical settings in Properties. The laser defines the beam: wavelength, size and quality.',
   do:'Click the gold QCL laser on the left, or press Select it for me.', action:{label:'Select it for me', run:select('laser')}, event:'workbench:optics-select', detail:'laser'},
  {target:'#opticsWavelength', title:'Set the wavelength', text:'Wavelength controls diffraction: longer wavelengths spread faster and focus to larger spots. Take it from the laser datasheet.',
   do:'Change the wavelength to 7.8 and press Enter. Watch the focus grow at the lens.', event:'workbench:optics', key:'wavelength', select:'laser'},
  {target:'#opticsDiameter', title:'Set the beam size', text:'This is the 1/e² diameter at the waist, the narrowest point. For a collimated laser it is simply the beam diameter. A wider beam focuses to a smaller spot.',
   do:'Enter 4 and press Enter. The spot at the focus shrinks. You can switch Beam size given as to Full divergence if your datasheet quotes an angle instead.', event:'workbench:optics', key:['diameter', 'spec', 'divergence'], select:'laser'},
  {target:'#opticsM2', title:'Beam quality and waist position', text:'M² says how close the beam is to a perfect Gaussian (1 = perfect). A beam with M² = 2 diverges twice as fast and focuses twice as large. Waist position moves the narrowest point in front of (+) or behind (−) the aperture.',
   do:'Try M² = 2 if you like, then press Next.', select:'laser'},
  {target:'#viewport canvas', title:'Select the lens', text:'Lenses and focusing mirrors are where the beam changes shape.',
   do:'Click the lens in its black mount, or press Select it for me.', action:{label:'Select it for me', run:select('lens')}, event:'workbench:optics-select', detail:'lens'},
  {target:'#opticsPreset', title:'Pick a catalogue lens', text:'Catalogue lenses quote the focal length at a design wavelength. Choosing one fills focal length, material, design wavelength and aperture.',
   do:'Choose the ZnSe plano-convex lens with f 50 mm. The focus moves closer to the lens.', event:'workbench:optics', key:['preset', 'focal'], select:'lens'},
  {target:'#opticsMaterial', title:'Change the material', text:'The same label focal length gives a different real focal length at your wavelength, because the glass bends each wavelength differently. The readout below shows the refractive index and the real focal length.',
   do:'Change the material to CaF₂. Specified at switches to 0.588 µm, where CaF₂ lenses are usually quoted. Read the real focal length at your wavelength below the fields.', event:'workbench:optics', key:'material', select:'lens'},
  {target:'#opticsFocal', title:'Type any focal length', text:'Any focal length works, including negative values for a diverging lens. Clear aperture is the usable diameter of the optic.',
   do:'Type 75 in Focal length and press Enter, or press Next.', event:'workbench:optics', key:'focal', select:'lens'},
  {target:'#routeOptics', title:'The beam summary', text:'Select a beam to see every optic along its path: the distance from the laser, the beam diameter there, each lens’s real focal length and where its focus falls.',
   do:'Read the list, then press Next.', before:showBeam},
  {target:'#routeFocus', title:'Put the detector at the focus', text:'The focus usually misses the detector after you change a lens. This button slides the endpoint along the last leg so the focus lands exactly on it.',
   do:'Press Move endpoint to the focus. The detector moves and the spot on it becomes the focus spot.', event:'workbench:optics', key:'focus', before:showBeam},
  {target:'.physicsToggle', title:'Physical or hand-drawn', text:'Physical beam is on for new beams. Turn it off to set a fixed diameter by hand, as in earlier versions. Older saved beams start with it off.',
   do:'Press Next to finish.', before:showBeam},
  {title:'Build your own', text:'Drag Lens in mount from the library onto the board, press Beam, then click the laser, the lens and the detector, and press Esc. Any part can be given an optical role in Properties, including your own STEP imports. The parabolic mirror works the same way, using its reflected focal length.',
   do:'This is a paraxial Gaussian model with thin lenses: good for focus positions and spot sizes. Aberrations and clipping are not modelled.'},
 ];

 function target() { const t = steps[index]?.target; return t ? document.querySelector(t) : null; }
 function stop() { index = -1; highlight?.classList.remove('tourTarget'); highlight = null; card.hidden = true; }
 function paint() {
  if (index < 0) return;
  const step = steps[index], el = target();
  if (highlight !== el) { highlight?.classList.remove('tourTarget'); highlight = el; el?.classList.add('tourTarget'); }
  counter.textContent = `Optics tour · ${index + 1} of ${steps.length}`;
  title.textContent = step.title; text.textContent = step.text;
  doBox.textContent = step.do || ''; doBox.hidden = !step.do;
  back.disabled = index === 0;
  action.hidden = !step.action; if (step.action) action.textContent = step.action.label;
  next.hidden = !!step.needsAction;
  next.textContent = index === steps.length - 1 ? 'Finish' : step.event ? 'Skip' : 'Next';
  card.hidden = false;
  const w = Math.min(360, innerWidth - 30);
  card.style.width = w + 'px';
  if (el && el.offsetParent !== null) {
   const r = el.getBoundingClientRect();
   let left = r.left - w - 18; if (left < 15) left = r.right + 18;
   if (r.width > innerWidth * .5) left = Math.max(15, r.left + 24);
   left = Math.max(15, Math.min(left, innerWidth - w - 15));
   const top = r.width > innerWidth * .5 ? Math.max(15, r.top + 70) : Math.max(15, Math.min(r.top - 8, innerHeight - card.offsetHeight - 20));
   card.style.left = left + 'px'; card.style.top = top + 'px';
  } else { card.style.left = Math.max(15, (innerWidth - w) / 2) + 'px'; card.style.top = '96px'; }
 }
 function go(n) {
  index = n;
  const step = steps[index];
  step.before?.();
  if (step.select && item(step.select) && document.querySelector('#opticsType')?.value !== step.select) select(step.select)();
  requestAnimationFrame(() => { target()?.scrollIntoView({block:'nearest', inline:'nearest'}); paint(); });
 }
 function advance() { if (index >= steps.length - 1) { stop(); toast('Optics tour complete. Reopen it from Laser beams or the quick guide.'); return; } go(index + 1); }
 next.onclick = advance;
 back.onclick = () => { if (index > 0) go(index - 1); };
 close.onclick = stop;
 action.onclick = () => { const step = steps[index], ok = step.action.run(); if (step.needsAction) { if (ok) advance(); } };
 const matches = (want, got) => want == null || (Array.isArray(want) ? want.includes(got) : want === got);
 for (const type of ['workbench:optics', 'workbench:optics-select', 'workbench:optics-hover']) document.addEventListener(type, e => {
  const step = steps[index];
  if (!step || step.event !== type) return;
  if (type === 'workbench:optics' && !matches(step.key, e.detail?.key)) return;
  if (type === 'workbench:optics-select' && !matches(step.detail, e.detail)) return;
  setTimeout(advance, type === 'workbench:optics-select' ? 150 : 650);
 });
 // Keep the card next to its target as panels re-render.
 new MutationObserver(() => { if (index >= 0) { const el = target(); if (el !== highlight) paint(); } }).observe(document.body, {subtree:true, childList:true});
 addEventListener('resize', () => { if (index >= 0) paint(); });
 document.addEventListener('keydown', e => { if (e.key === 'Escape' && index >= 0 && !document.querySelector('dialog[open]')) stop(); });

 function start() { setMode('scientific'); document.querySelector('dialog[open]')?.close(); ensureLibrary(); steps = STEPS; go(0); }
 for (const id of ['opticsTourQuick', 'opticsTourPanel']) $(id)?.addEventListener('click', start);
 return {start, stop};
}
