// Side panel of the map page: steps (one shown at a time), resizable width and hide/show.
// The panel's layout preferences are kept per browser.

const $ = (id) => document.getElementById(id);
const KEY_W = 'vda-side-width', KEY_STEP = 'vda-step', KEY_HIDDEN = 'vda-side-hidden';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };
export const STEPS = ['site', 'protect', 'vectors', 'results', 'report'];
// Which step holds each section of the panel (used by the checklist and links).
export const STEP_OF = { 'sec-map': 'site', 'sec-plan': 'site', 'sec-draw': 'protect', 'sec-vectors': 'vectors', 'sec-req': 'results', 'sec-project': 'report', 'sec-notes': 'report' };
const MIN_W = 320, MAX_W = 720;

let onLayout = () => {};
export function currentStep() { return document.querySelector('#steps button.on')?.dataset.step || 'site'; }

export function showStep(step, { scrollTop = true } = {}) {
  if (!STEPS.includes(step)) step = 'site';
  for (const b of document.querySelectorAll('#steps button')) { const on = b.dataset.step === step; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'step' : 'false'); }
  for (const el of document.querySelectorAll('#steps-body .step')) el.hidden = el.dataset.step !== step;
  set(KEY_STEP, step);
  if (scrollTop) $('side').scrollTop = 0;
}

// Open the step holding an element (a section id or anything inside one) and bring it into view.
export function goTo(id) {
  const el = $(id); if (!el) return;
  const step = el.closest('.step')?.dataset.step || STEP_OF[id];
  if (step) showStep(step, { scrollTop: false });
  if (el.tagName === 'DETAILS') el.open = true;
  setPanelHidden(false);
  requestAnimationFrame(() => el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
}

// Status dots on the step buttons: 'ok' | 'warn' | 'todo' | '' per step.
export function setStepStates(states) {
  for (const b of document.querySelectorAll('#steps button')) { const st = states[b.dataset.step]; b.querySelector('i').className = st ? `st-${st}` : ''; b.title = st === 'ok' ? 'Done' : st === 'warn' ? 'Needs attention' : st === 'todo' ? 'Still to do' : ''; }
}

function setWidth(w) {
  const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, w, 0), Math.max(MIN_W, innerWidth - 320)));
  $('app').style.setProperty('--side-w', `${width}px`);
  return width;
}
export function setPanelHidden(hidden) {
  const was = $('app').classList.contains('side-hidden');
  $('app').classList.toggle('side-hidden', hidden);
  $('side-show').hidden = !hidden;
  set(KEY_HIDDEN, hidden ? '1' : null);
  if (was !== hidden) onLayout();
}

export function initPanel({ layout } = {}) {
  if (layout) onLayout = layout;
  for (const b of document.querySelectorAll('#steps button')) b.addEventListener('click', () => showStep(b.dataset.step));
  for (const b of document.querySelectorAll('[data-next]')) b.addEventListener('click', () => showStep(b.dataset.next));
  showStep(get(KEY_STEP) || 'site');

  if (get(KEY_W)) setWidth(+get(KEY_W));
  $('side-hide').addEventListener('click', () => setPanelHidden(true));
  $('side-show').addEventListener('click', () => setPanelHidden(false));
  if (get(KEY_HIDDEN)) setPanelHidden(true);

  // Drag the panel's edge to resize it; arrow keys do the same from the keyboard.
  const handle = $('side-resize');
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const left = $('app').getBoundingClientRect().left;
    const move = (ev) => { setWidth(ev.clientX - left); onLayout(); };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); set(KEY_W, String(parseInt(getComputedStyle($('app')).getPropertyValue('--side-w'), 10) || '')); onLayout(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', () => { $('app').style.removeProperty('--side-w'); set(KEY_W, null); onLayout(); });
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const w = setWidth($('side').getBoundingClientRect().width + (e.key === 'ArrowRight' ? 20 : -20));
    set(KEY_W, String(w)); onLayout();
  });
}
