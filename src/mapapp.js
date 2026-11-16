// Map assessment page: basemap, plan overlay with calibration, drawing of asset / line of
// protection / vectors, and per-vector impact results from the existing engine.
/* global maplibregl */
import { VEHICLES, KPH_PER_MPH, MASS_KG, TEST_SPEEDS_KPH, MAX_TEST_SPEED_KPH, nextTestSpeed, testSpeedText, buildRouteSpeeds, startArg } from './maths.js';
import { VERSION } from './version.js';
import { mountThemeToggle } from './theme.js';
import { reportTable, copyRich, flash, hovvaTable } from './copy.js';
import { newProject, newVector, resolveVector, pathLength } from './model.js';
import { makeFrame } from './frames.js';
import { planToLocal, localToPlan, scaleFromTwoPoints, rescale, checkError, measureOnPlan, fitSimilarity } from './calibrate.js';
import { putBlob, getBlob, deleteBlob, loadJSON, saveJSON, blobToDataURL, dataURLToBlob } from './store.js';
import { area, perimeter, polylineLength, dist, centroid, pointInPolygon, nearestOnPolyline, offsetPolygon, simplify, rectangleFrom, minDistance, bufferLine } from './geometry/polygon.js';
import { fetchOSM } from './osm.js';
import { generateVectors } from './autogen.js';
import { requiredProtection } from './summary.js';

const KEY_PROJECT = 'vda-map-project-v1', KEY_MAPTILER = 'vda-maptiler-key', KEY_CALC = 'vda-tool-state-v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Speed bands follow the impact test speeds (km/h).
const BAND_COLOURS = ['#2a9d8f', '#8ab17d', '#e9c46a', '#f4a261', '#e76f51', '#e63946', '#c1121f', '#b5179e']; // readable on light and dark maps
const bandColour = (kph) => { const i = TEST_SPEEDS_KPH.findIndex((t) => kph <= t); return BAND_COLOURS[i < 0 ? BAND_COLOURS.length - 1 : i]; };

// ---------- state ----------
let project = loadJSON(KEY_PROJECT) || blankProject();
let frame = project.anchor ? makeFrame(project.anchor) : null;
let planURL = null, planImg = null; // object URL and natural size of the plan image
let mode = null; // null | {kind:'draw', what, points:[]} | {kind:'pick', purpose, picks:[]}
let selected = null; // {kind:'vector'|'lop'|'asset', id}
let drag = null;
let selectedVertex = null; // index of the selected point on the selected item
// The site-wide key comes from config.js (written at deploy from the MAPTILER_KEY setting in
// Vercel). A key saved in this browser overrides it; clearing the box goes back to the site key.
const SITE_KEY = (window.VDA_CONFIG && window.VDA_CONFIG.maptilerKey) || '';
let ownKey = ''; try { ownKey = localStorage.getItem(KEY_MAPTILER) || ''; } catch { /* ignore */ }
let mtKey = ownKey || SITE_KEY;
let results = new Map(); // vector id -> computed result

function blankProject() {
  return newProject({ anchor: null, plan: null, view: { center: [-1.5, 53.0], zoom: 5 }, vectorCounter: 1, obstacles: [], osm: null, osmExcluded: [], details: { date: new Date().toISOString().slice(0, 10) }, issues: [], locked: false });
}
project.obstacles = project.obstacles || []; project.osmExcluded = project.osmExcluded || [];
project.details = project.details || {}; project.issues = project.issues || [];
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveJSON(KEY_PROJECT, project), 250); }
const isEmpty = () => !project.plan && !project.osm && !project.assets.length && !project.lops.length && !project.vectors.length && !project.obstacles?.length;
function ensureFrame(lngLat) {
  if (frame && !isEmpty()) return;
  project.anchor = { lng: lngLat.lng, lat: lngLat.lat };
  frame = makeFrame(project.anchor);
}
const toLocal = (ll) => frame.toLocal({ lng: ll.lng, lat: ll.lat });
const toLL = (p) => { const q = frame.toLngLat(p); return [q.lng, q.lat]; };

// ---------- map ----------
const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f2' } }] },
  center: project.view.center, zoom: project.view.zoom, maxZoom: 22, attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-left');
map.on('moveend', () => { const c = map.getCenter(); project.view = { center: [c.lng, c.lat], zoom: map.getZoom() }; save(); });
map.on('zoomend', () => { if (selected) renderAll(true); }); // "add point" dots depend on zoom

function basemapSource(kind) {
  if (kind === 'none') return null;
  if (mtKey) {
    const k = encodeURIComponent(mtKey);
    return kind === 'satellite'
      ? { type: 'raster', tiles: [`https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key=${k}`], tileSize: 256, maxzoom: 20, attribution: '© MapTiler © OpenStreetMap contributors' }
      : { type: 'raster', tiles: [`https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${k}`], tileSize: 256, maxzoom: 20, attribution: '© MapTiler © OpenStreetMap contributors' };
  }
  return { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' };
}
function setBasemap(kind) {
  if (kind === 'satellite' && !mtKey) { $('search-status').textContent = 'Satellite needs a MapTiler key (see below). Showing streets.'; kind = 'streets'; $('basemap').value = 'streets'; }
  if (map.getLayer('base')) map.removeLayer('base');
  if (map.getSource('base')) map.removeSource('base');
  const src = basemapSource(kind);
  if (src) { map.addSource('base', src); map.addLayer({ id: 'base', type: 'raster', source: 'base' }, 'plan-anchor'); }
  project.basemap = kind; save();
}

const EMPTY = { type: 'FeatureCollection', features: [] };
map.on('load', () => {
  map.addLayer({ id: 'plan-anchor', type: 'background', paint: { 'background-opacity': 0 } }); // keeps plan above basemap
  for (const id of ['osm', 'obstacle', 'asset', 'lop', 'req', 'raw', 'path', 'handles', 'mids', 'temp', 'picks', 'snap']) map.addSource(id, { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'osm-fill', type: 'fill', source: 'osm', paint: { 'fill-color': ['case', ['get', 'excluded'], '#2a9d8f', '#6b7280'], 'fill-opacity': ['case', ['get', 'sel'], 0.55, ['get', 'excluded'], 0.15, 0.3] } });
  map.addLayer({ id: 'osm-line', type: 'line', source: 'osm', paint: { 'line-color': ['case', ['get', 'excluded'], '#2a9d8f', '#4b5563'], 'line-width': ['case', ['get', 'sel'], 2.5, 0.8], 'line-dasharray': [1, 0] } });
  map.addLayer({ id: 'obstacle-fill', type: 'fill', source: 'obstacle', paint: { 'fill-color': '#7c3aed', 'fill-opacity': ['case', ['get', 'sel'], 0.5, 0.3] } });
  map.addLayer({ id: 'obstacle-line', type: 'line', source: 'obstacle', paint: { 'line-color': '#7c3aed', 'line-width': 2 } });
  // Protected zone: the area inside a closed line of protection, lightly shaded.
  map.addLayer({ id: 'lop-zone', type: 'fill', source: 'lop', filter: ['==', ['get', 'closed'], true], paint: { 'fill-color': '#e63946', 'fill-opacity': 0.07 } });
  // The asset: solid tint plus diagonal hatching (the drawing convention for what is protected),
  // with a contrasting casing under a bright outline so it reads on light, dark and satellite maps.
  map.addImage('asset-hatch', hatchImage(ASSET_COLOUR), { pixelRatio: 2 });
  map.addLayer({ id: 'asset-fill', type: 'fill', source: 'asset', paint: { 'fill-color': ASSET_COLOUR, 'fill-opacity': ['case', ['get', 'sel'], 0.3, 0.16] } });
  map.addLayer({ id: 'asset-hatch', type: 'fill', source: 'asset', paint: { 'fill-pattern': 'asset-hatch', 'fill-opacity': 0.9 } });
  map.addLayer({ id: 'asset-casing', type: 'line', source: 'asset', layout: { 'line-join': 'round' }, paint: { 'line-color': casingColour(), 'line-width': ['case', ['get', 'sel'], 7, 5], 'line-opacity': 0.85 } });
  map.addLayer({ id: 'asset-line', type: 'line', source: 'asset', layout: { 'line-join': 'round' }, paint: { 'line-color': ASSET_COLOUR, 'line-width': ['case', ['get', 'sel'], 3.5, 2.5] } });
  map.addLayer({ id: 'raw', type: 'line', source: 'raw', paint: { 'line-color': '#555', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'path-casing', type: 'line', source: 'path', filter: ['!=', ['get', 'status'], 'rejected'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['case', ['get', 'sel'], 9, 6] } });
  map.addLayer({ id: 'path', type: 'line', source: 'path', filter: ['==', ['get', 'status'], 'firm'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'colour'], 'line-width': ['case', ['get', 'sel'], 6, 3.5] } });
  map.addLayer({ id: 'path-sugg', type: 'line', source: 'path', filter: ['==', ['get', 'status'], 'suggested'], layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'colour'], 'line-width': ['case', ['get', 'sel'], 6, 3.5], 'line-dasharray': [1.5, 1] } });
  map.addLayer({ id: 'path-rej', type: 'line', source: 'path', filter: ['==', ['get', 'status'], 'rejected'], paint: { 'line-color': '#888', 'line-width': 2, 'line-opacity': 0.5, 'line-dasharray': [1, 2] } });
  map.addLayer({ id: 'lop-line', type: 'line', source: 'lop', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#e63946', 'line-width': ['case', ['get', 'sel'], 7, 5] } });
  map.addLayer({ id: 'lop-req', type: 'line', source: 'req', paint: { 'line-color': ['get', 'colour'], 'line-width': 7 } });
  map.addLayer({ id: 'lop-dash', type: 'line', source: 'lop', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [1, 1.5] } });
  map.addLayer({ id: 'temp-line', type: 'line', source: 'temp', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#e0a100', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'temp-pts', type: 'circle', source: 'temp', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#e0a100', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'mids', type: 'circle', source: 'mids', paint: { 'circle-radius': ['case', ['get', 'coarse'], 7, 4], 'circle-color': '#1d3557', 'circle-opacity': 0.6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'handles', type: 'circle', source: 'handles', paint: { 'circle-radius': ['case', ['get', 'coarse'], 10, 6], 'circle-color': ['case', ['get', 'sel'], '#e0a100', '#fff'], 'circle-stroke-color': '#1d3557', 'circle-stroke-width': 2.5 } });
  map.addLayer({ id: 'snap', type: 'circle', source: 'snap', paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#e0a100', 'circle-stroke-width': 3 } });
  map.addLayer({ id: 'picks', type: 'circle', source: 'picks', paint: { 'circle-radius': 6, 'circle-color': ['get', 'colour'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  $('basemap').value = project.basemap || 'streets';
  setBasemap($('basemap').value);
  restorePlan().then(renderAll);
});

// ---------- asset styling ----------
const ASSET_COLOUR = '#3b82f6';
const casingColour = () => (document.documentElement.dataset.theme === 'light' ? '#ffffff' : '#0b1220');
function hatchImage(colour) {
  const n = 24, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d');
  g.strokeStyle = colour; g.lineWidth = 2.5; g.globalAlpha = 0.75;
  for (const o of [-n, 0, n]) { g.beginPath(); g.moveTo(o, n); g.lineTo(o + n, 0); g.stroke(); }
  return g.getImageData(0, 0, n, n);
}

// ---------- plan overlay ----------
const planCorners = () => {
  const { w, h, placement: T } = project.plan;
  return [{ u: 0, v: 0 }, { u: w, v: 0 }, { u: w, v: h }, { u: 0, v: h }].map((p) => toLL(planToLocal(T, p)));
};
function showPlan() {
  if (map.getLayer('plan')) map.removeLayer('plan');
  if (map.getSource('plan')) map.removeSource('plan');
  if (!project.plan || !planURL) return;
  map.addSource('plan', { type: 'image', url: planURL, coordinates: planCorners() });
  map.addLayer({ id: 'plan', type: 'raster', source: 'plan', paint: { 'raster-opacity': project.plan.opacity ?? 0.7, 'raster-fade-duration': 0 } }, 'lop-zone');
}
function updatePlanCoords() { const s = map.getSource('plan'); if (s) s.setCoordinates(planCorners()); }
async function restorePlan() {
  if (!project.plan) return;
  const blob = await getBlob(`plan:${project.id}`);
  if (!blob) { project.plan = null; save(); return; }
  planURL = URL.createObjectURL(blob);
  showPlan();
}
$('plan-file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  if (guard()) return;
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) { await openPdf(file); return; }
  usePlanImage(file, file.name);
});
function usePlanImage(blob, name, source = null) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = async () => {
    ensureFrame(map.getCenter());
    const c = toLocal(map.getCenter());
    const b = map.getBounds();
    const viewW = Math.abs(toLocal(b.getNorthEast()).x - toLocal(b.getSouthWest()).x);
    const s0 = (viewW * 0.6) / img.naturalWidth; // first guess only; the plan is "not scaled" until set
    const T = { s: s0, theta: 0, tx: 0, ty: 0 };
    const mid = planToLocal(T, { u: img.naturalWidth / 2, v: img.naturalHeight / 2 });
    T.tx = c.x - mid.x; T.ty = c.y - mid.y;
    if (planURL) URL.revokeObjectURL(planURL);
    planURL = url;
    project.plan = { name, source, w: img.naturalWidth, h: img.naturalHeight, placement: T, opacity: 0.7, scale: null, check: null, align: null };
    await putBlob(`plan:${project.id}`, blob);
    $('plan-status').textContent = 'Plan placed in the middle of the map. Next: set its scale, then align it to the map.';
    save(); showPlan(); renderAll();
  };
  img.onerror = () => { $('plan-status').textContent = 'That file could not be read as an image.'; };
  img.src = url;
}

// PDF plans: rendered page by page with PDF.js (loaded only when needed).
let pdfDoc = null, pdfName = '';
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/pdfjs-3.11.174/pdf.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the PDF reader'));
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
}
async function openPdf(file) {
  $('plan-status').textContent = 'Reading the PDF…';
  try {
    const lib = await loadPdfJs();
    pdfDoc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    pdfName = file.name;
    if (pdfDoc.numPages === 1) { await usePdfPage(1); return; }
    $('pdf-page').innerHTML = Array.from({ length: pdfDoc.numPages }, (_, i) => `<option value="${i + 1}">${i + 1} of ${pdfDoc.numPages}</option>`).join('');
    $('pdf-pick').hidden = false;
    $('plan-status').textContent = `The PDF has ${pdfDoc.numPages} pages. Choose the site plan page.`;
  } catch (err) { $('plan-status').textContent = `Could not read that PDF: ${err.message}`; }
}
$('pdf-use').addEventListener('click', () => usePdfPage(+$('pdf-page').value));
async function usePdfPage(n) {
  $('plan-status').textContent = `Rendering page ${n}…`;
  try {
    const page = await pdfDoc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // Sharp enough to read drawing detail, within what phones can hold in a canvas.
    const scale = Math.min(4, 4096 / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    $('pdf-pick').hidden = true;
    usePlanImage(blob, `${pdfName}, page ${n}`, { pdf: pdfName, page: n, pointsWide: base.width, pointsHigh: base.height });
  } catch (err) { $('plan-status').textContent = `Could not render that page: ${err.message}`; }
}
$('plan-opacity').addEventListener('input', (e) => {
  project.plan.opacity = +e.target.value; save();
  if (map.getLayer('plan')) map.setPaintProperty('plan', 'raster-opacity', project.plan.opacity);
});
$('plan-remove').addEventListener('click', async () => {
  await deleteBlob(`plan:${project.id}`); project.plan = null; save(); showPlan(); renderAll();
});
$('plan-scale').addEventListener('click', () => startPick('scale'));
$('plan-check').addEventListener('click', () => startPick('check'));
$('plan-align').addEventListener('click', () => startPick('align'));

function renderPlanFacts() {
  const p = project.plan;
  $('plan-tools').hidden = !p;
  if (!p) return;
  $('plan-opacity').value = p.opacity ?? 0.7;
  const rows = [['File', esc(p.name)]];
  rows.push(['Scale', p.scale ? `${(p.placement.s * 1000).toFixed(2)} mm per pixel (${p.scale.metres} m between two points)` : '<span class="bad">Not set: distances are guesses</span>']);
  if (p.check) {
    const e = p.check.errPct, cls = Math.abs(e) > 5 ? 'bad' : Math.abs(e) > 2 ? 'bad' : 'ok';
    rows.push(['Check', `<span class="${cls}">${p.check.measured.toFixed(2)} m measured vs ${p.check.known} m known (${e > 0 ? '+' : ''}${e.toFixed(1)} %)${Math.abs(e) > 5 ? ' – too large for a report' : Math.abs(e) > 2 ? ' – over 2 %' : ''}</span>`]);
  } else rows.push(['Check', p.scale ? 'Not checked yet' : '–']);
  if (p.align) {
    const worst = Math.max(...p.align.residuals);
    rows.push(['Aligned', `${p.align.residuals.length} control points, worst residual ${worst.toFixed(2)} m${p.align.scaleDiffPct != null ? `; map implies a scale ${p.align.scaleDiffPct > 0 ? '+' : ''}${p.align.scaleDiffPct.toFixed(1)} % from yours` : ''}`]);
  }
  $('plan-facts').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------- picking (calibration) ----------
const PICK_TEXT = {
  scale: ['Click the first end of a known distance on the plan.', 'Click the other end.', 'Enter the real distance between the two points.'],
  check: ['Click the first end of a second known distance.', 'Click the other end.', 'Enter its real length to check the scale.'],
  align: ['Click a feature on the plan.', 'Now click where that feature really is on the map.', 'Click a second feature on the plan, far from the first.', 'Click where it really is on the map.', 'Apply the alignment, or click another feature on the plan to add a pair.'],
};
function startPick(purpose) {
  if (!project.plan) return;
  cancelMode();
  mode = { kind: 'pick', purpose, picks: [] };
  document.body.classList.add('drawing');
  renderPick();
}
function renderPick() {
  const box = $('pick-box');
  box.hidden = !(mode && mode.kind === 'pick');
  if (box.hidden) { setData('picks', EMPTY); return; }
  const { purpose, picks } = mode;
  const steps = PICK_TEXT[purpose];
  const n = picks.length;
  const step = purpose !== 'align' ? Math.min(n, 2) : n < 4 ? n : n % 2 === 0 ? 4 : 1;
  $('pick-msg').textContent = steps[step];
  const needDist = purpose !== 'align' && picks.length === 2;
  $('pick-form').hidden = !(needDist || (purpose === 'align' && picks.length >= 4 && picks.length % 2 === 0));
  $('pick-dist').hidden = !needDist;
  $('pick-form').querySelector('button').textContent = needDist ? 'Apply' : 'Apply alignment';
  if (needDist) setTimeout(() => $('pick-dist').focus(), 0);
  setData('picks', { type: 'FeatureCollection', features: picks.map((p, i) => ({ type: 'Feature', properties: { colour: purpose === 'align' && i % 2 ? '#2a9d8f' : '#e0a100' }, geometry: { type: 'Point', coordinates: toLL(p.local) } })) });
}
function pickClick(ll) {
  const local = toLocal(ll);
  mode.picks.push({ local, plan: localToPlan(project.plan.placement, local) });
  if (mode.purpose !== 'align' && mode.picks.length > 2) mode.picks.length = 2;
  renderPick();
}
$('pick-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = project.plan, picks = mode.picks;
  try {
    if (mode.purpose === 'scale') {
      const metres = +$('pick-dist').value;
      const s = scaleFromTwoPoints(picks[0].plan, picks[1].plan, metres);
      const pivot = { u: (picks[0].plan.u + picks[1].plan.u) / 2, v: (picks[0].plan.v + picks[1].plan.v) / 2 };
      p.placement = rescale(p.placement, s, pivot);
      p.scale = { a: picks[0].plan, b: picks[1].plan, metres, at: new Date().toISOString() };
      p.check = null;
    } else if (mode.purpose === 'check') {
      const known = +$('pick-dist').value;
      if (!(known > 0)) throw new Error('Enter a distance above 0');
      const measured = measureOnPlan(p.placement, picks[0].plan, picks[1].plan);
      p.check = { a: picks[0].plan, b: picks[1].plan, known, measured, errPct: checkError(measured, known), at: new Date().toISOString() };
    } else {
      const pairs = [];
      for (let i = 0; i + 1 < picks.length; i += 2) pairs.push({ plan: picks[i].plan, local: picks[i + 1].local });
      const fit = fitSimilarity(pairs, { fixedScale: p.scale ? p.placement.s : undefined });
      p.placement = fit.placement;
      p.align = { pairs, residuals: fit.residuals, scaleDiffPct: p.scale ? (fit.fittedScale / p.placement.s - 1) * 100 : null, at: new Date().toISOString() };
    }
  } catch (err) { $('pick-msg').textContent = err.message; return; }
  $('pick-dist').value = '';
  cancelMode(); save(); updatePlanCoords(); renderAll();
});
$('pick-cancel').addEventListener('click', cancelMode);

// ---------- history (undo) ----------
const history = [];
function pushHistory() {
  history.push(JSON.stringify({ assets: project.assets, lops: project.lops, vectors: project.vectors, obstacles: project.obstacles, osmExcluded: project.osmExcluded, vectorCounter: project.vectorCounter }));
  if (history.length > 50) history.shift();
}
function undo() {
  if (mode?.points?.length) { mode.points.pop(); renderTemp(); return; }
  if (guard()) return;
  const snap = history.pop();
  if (!snap) { $('osm-status').textContent = 'Nothing to undo.'; return; }
  Object.assign(project, JSON.parse(snap));
  if (!findItem(selected)) selected = null; // keep the selection when the shape still exists
  selectedVertex = null; save(); renderAll();
}
$('undo').addEventListener('click', undo);

// ---------- tools ----------
const TOOLS = {
  'asset-tap': { kind: 'tap', title: 'Tap the building to protect', hint: 'Its outline comes from OpenStreetMap. Zoom in close enough to see the buildings.' },
  'asset-draw': { kind: 'draw', what: 'asset', min: 3, closed: true, title: 'Draw the asset outline', hint: 'Tap each corner. Finish when the outline is complete.' },
  'asset-rect': { kind: 'draw', what: 'asset', min: 3, max: 3, rect: true, closed: true, title: 'Draw a rectangle', hint: 'Tap two corners along one side, then tap how deep it goes.' },
  'lop-draw': { kind: 'draw', what: 'lop', min: 2, title: 'Draw the line of protection', hint: 'Tap along the line where vehicles must be stopped.' },
  'lop-loop': { kind: 'draw', what: 'lop', min: 3, closed: true, title: 'Draw a closed line of protection', hint: 'Tap round the protected area. The loop closes itself when you finish.' },
  'obstacle-draw': { kind: 'draw', what: 'obstacle', min: 3, closed: true, title: 'Draw an obstacle', hint: 'Something a vehicle cannot pass through: a wall, an existing rated barrier, water.' },
  'vector-draw': { kind: 'draw', what: 'vector', min: 2, title: 'Draw an attack vector', hint: 'Start where the attack could begin and finish across the line of protection.' },
};
document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => startTool(b.dataset.tool, b)));
function startTool(name, button) {
  if (guard()) return;
  cancelMode();
  const t = TOOLS[name];
  mode = { ...t, tool: name, points: [] };
  document.body.classList.add('drawing');
  map.doubleClickZoom.disable();
  button?.classList.add('on');
  $('drawbar').hidden = false;
  $('db-title').textContent = t.title;
  $('db-hint').textContent = t.hint;
  $('db-undo').hidden = $('db-finish').hidden = t.kind === 'tap' || !!t.rect;
  if (t.kind === 'tap' && !project.osm) loadOSM(map.getCenter());
  renderTemp();
}
function cancelMode() {
  mode = null;
  document.body.classList.remove('drawing');
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.remove('on'));
  map.doubleClickZoom.enable();
  $('pick-box').hidden = true;
  $('drawbar').hidden = true;
  setData('picks', EMPTY); setData('temp', EMPTY); setData('snap', EMPTY);
}
$('db-cancel').addEventListener('click', cancelMode);
$('db-finish').addEventListener('click', () => finishDraw());
$('db-undo').addEventListener('click', () => { if (mode?.points) { mode.points.pop(); renderTemp(); } });

// ---------- snapping ----------
const SNAP_PX = () => (matchMedia('(pointer: coarse)').matches ? 16 : 10);
const metresPerPixel = () => (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
function snapShapes(exclude) {
  const out = [];
  const add2 = (kind, id, pts, closed) => { if (!(exclude && exclude.kind === kind && exclude.id === id)) out.push({ pts, closed }); };
  project.assets.forEach((a) => add2('asset', a.id, a.points, true));
  project.lops.forEach((l) => add2('lop', l.id, l.points, !!l.closed));
  (project.obstacles || []).forEach((o) => add2('obstacle', o.id, o.points, true));
  for (const b of osmBuildings()) out.push({ pts: b.points, closed: true });
  return out;
}
// Returns {p, how} with p in local metres.
function snap(lngLat, exclude) {
  const p = toLocal(lngLat);
  if (!$('snap').checked) return { p, how: null };
  const tol = SNAP_PX() * metresPerPixel();
  let best = null;
  const shapes = snapShapes(exclude);
  if (mode?.points?.length) shapes.push({ pts: mode.points, closed: false });
  for (const s of shapes) for (const q of s.pts) { const d = dist(p, q); if (d < tol && (!best || d < best.d)) best = { p: q, d, how: 'point' }; }
  if (best) return best;
  for (const s of shapes) {
    if (s.pts.length < 2) continue;
    const r = nearestOnPolyline(p, s.pts, s.closed);
    if (r.d < tol * 0.8 && (!best || r.d < best.d)) best = { p: r.point, d: r.d, how: 'edge' };
  }
  return best || { p, how: null };
}
function showSnap(s) {
  setData('snap', s && s.how ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { how: s.how }, geometry: { type: 'Point', coordinates: toLL(s.p) } }] } : EMPTY);
}

// ---------- drawing ----------
function drawClick(e) {
  const pts = mode.points;
  if (!pts.length) ensureFrame(e.lngLat); // never re-anchor mid-drawing: earlier points use the frame
  const s = snap(e.lngLat);
  if (pts.length) {
    const last = map.project(toLL(pts[pts.length - 1]));
    if (Math.hypot(last.x - e.point.x, last.y - e.point.y) < 4) return; // second click of a double-click
    // Tapping the first point closes a shape.
    const first = map.project(toLL(pts[0]));
    if (mode.closed && pts.length >= mode.min && Math.hypot(first.x - e.point.x, first.y - e.point.y) < SNAP_PX()) { finishDraw(); return; }
  }
  pts.push(s.p);
  if (mode.max && pts.length >= mode.max) { finishDraw(); return; }
  renderTemp();
}
function finishDraw() {
  if (!mode || mode.kind !== 'draw') return;
  const { what, min } = mode;
  let points = mode.points;
  if (points.length < min) { $('db-hint').textContent = `Add at least ${min} points first, or cancel.`; return; }
  if (mode.rect) points = rectangleFrom(points[0], points[1], points[2]);
  pushHistory();
  if (what === 'asset') { const a = { id: uid('ast'), name: `Asset ${project.assets.length + 1}`, points }; project.assets.push(a); selected = { kind: 'asset', id: a.id }; }
  if (what === 'lop') { const l = { id: uid('lop'), name: `Line ${project.lops.length + 1}`, points, closed: !!mode.closed }; project.lops.push(l); selected = { kind: 'lop', id: l.id }; }
  if (what === 'obstacle') { project.obstacles = project.obstacles || []; const o = { id: uid('obs'), name: `Obstacle ${project.obstacles.length + 1}`, points }; project.obstacles.push(o); selected = { kind: 'obstacle', id: o.id }; }
  if (what === 'vector') {
    const v = newVector({ name: `V${project.vectorCounter++}`, source: 'drawn', status: 'drawn', points, vertexOptions: [] });
    project.vectors.push(v); selected = { kind: 'vector', id: v.id };
  }
  selectedVertex = null;
  cancelMode(); save(); renderAll();
}
let mouseLL = null;
function renderTemp() {
  if (!mode || mode.kind !== 'draw') { setData('temp', EMPTY); if (mode?.kind === 'tap') $('db-measure').textContent = ''; return; }
  let pts = mode.points.slice();
  const cursor = mouseLL ? snap(mouseLL).p : null;
  if (cursor) pts.push(cursor);
  if (mode.rect && pts.length === 3) pts = rectangleFrom(pts[0], pts[1], pts[2]);
  const coords = pts.map(toLL);
  const ring = mode.closed && coords.length > 2 ? [...coords, coords[0]] : coords;
  setData('temp', { type: 'FeatureCollection', features: [
    ...(ring.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } }] : []),
    ...mode.points.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: toLL(p) } })),
  ] });
  // Live measurements.
  const parts = [];
  if (pts.length >= 2) parts.push(`segment ${dist(pts[pts.length - 2], pts[pts.length - 1]).toFixed(1)} m`);
  if (pts.length >= 3 && mode.closed) parts.push(`area ${Math.round(area(pts)).toLocaleString()} m²`);
  if (pts.length >= 2) parts.push(`${mode.closed && pts.length > 2 ? 'perimeter' : 'length'} ${(mode.closed && pts.length > 2 ? perimeter(pts) : polylineLength(pts)).toFixed(1)} m`);
  $('db-measure').textContent = parts.join(' · ');
}

// ---------- tap a building ----------
async function tapBuilding(lngLat) {
  ensureFrame(lngLat);
  if (!project.osm || dist(toLocal(lngLat), project.osm.centre) > project.osm.radius - 50) await loadOSM(lngLat);
  const p = toLocal(lngLat);
  const b = osmBuildings(true).find((x) => !x.wall && pointInPolygon(p, x.points));
  if (!b) { $('db-hint').textContent = 'No building outline there. Zoom in and tap inside a building, or draw the outline instead.'; return; }
  pushHistory();
  const a = { id: uid('ast'), name: `Asset ${project.assets.length + 1}`, points: b.points.map((q) => ({ ...q })), osmId: b.id };
  project.assets.push(a);
  selected = { kind: 'asset', id: a.id };
  cancelMode(); save(); renderAll();
}

// ---------- OpenStreetMap buildings and roads ----------
const osmBuildings = (includeExcluded) => (project.osm?.buildings || []).filter((b) => includeExcluded || !(project.osmExcluded || []).includes(b.id));
let osmLoading = null;
async function loadOSM(centreLL, minRadius = 0) {
  if (osmLoading) return osmLoading;
  ensureFrame(centreLL);
  const radius = Math.round(Math.max(500, (+$('ag-radius').value || 440) + 100, minRadius));
  $('osm-status').textContent = 'Loading buildings and roads from OpenStreetMap…';
  osmLoading = fetchOSM({ lat: centreLL.lat, lng: centreLL.lng }, radius).then((d) => {
    project.osm = {
      centre: toLocal(centreLL), radius, at: new Date().toISOString(),
      buildings: [
        ...d.buildings.map((b) => ({ id: b.id, points: b.ll.map(toLocal) })),
        ...(d.walls || []).map((w) => ({ id: w.id, wall: w.kind, points: bufferLine(w.ll.map(toLocal), 0.3) })),
      ],
      roads: d.roads.map((r) => ({ id: r.id, kind: r.kind, points: r.ll.map(toLocal) })),
    };
    $('osm-status').textContent = `${d.buildings.length} buildings, ${(d.walls || []).length} walls and barriers, and ${d.roads.length} roads loaded within ${radius} m. Tap one to see it or mark it as not an obstacle.`;
    save(); renderAll();
  }).catch((e) => { $('osm-status').textContent = `Could not load map data: ${e.message}`; }).finally(() => { osmLoading = null; });
  return osmLoading;
}
$('osm-load').addEventListener('click', () => {
  const a = project.assets[0];
  loadOSM(a && frame ? (() => { const c = centroid(a.points), ll = toLL(c); return { lng: ll[0], lat: ll[1] }; })() : map.getCenter());
});

// ---------- line of protection around the asset ----------
$('lop-auto').addEventListener('click', () => {
  if (guard()) return;
  const a = findItem(selected?.kind === 'asset' ? selected : null) || project.assets[project.assets.length - 1];
  if (!a) { $('osm-status').textContent = 'Add an asset first: tap a building or draw one.'; return; }
  const d = parseFloat($('standoff').value);
  if (!(d > 0)) { $('osm-status').textContent = 'Enter a standoff above 0 m.'; return; }
  pushHistory();
  // Smooth out tiny notches in mapped outlines first, so the standoff line has no kinks or loops.
  const ring = simplify([...a.points, a.points[0]], Math.min(0.5, d / 10)).slice(0, -1);
  const l = { id: uid('lop'), name: `Line ${project.lops.length + 1} (${d} m round ${a.name})`, points: simplify(offsetPolygon(ring.length >= 3 ? ring : a.points, d, 30, true), 0.05), closed: true, standoff: d, assetId: a.id };
  project.lops.push(l);
  selected = { kind: 'lop', id: l.id }; selectedVertex = null;
  save(); renderAll();
});

// ---------- map interaction ----------
map.on('click', (e) => {
  if (drag?.moved) return;
  if (mode?.kind === 'draw') return drawClick(e);
  if (mode?.kind === 'tap') return tapBuilding(e.lngLat);
  if (mode?.kind === 'cap') return placeCap(e);
  if (mode?.kind === 'pick') return pickClick(e.lngLat);
  const box = [[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]];
  const h = map.queryRenderedFeatures(box, { layers: ['handles'] })[0];
  if (h) { selectedVertex = h.properties.idx; renderAll(); return; }
  const f = map.queryRenderedFeatures(box, { layers: ['path', 'path-sugg', 'path-rej', 'raw', 'lop-line', 'asset-fill', 'obstacle-fill', 'osm-fill', 'lop-zone'] })[0];
  selected = f ? { kind: f.properties.kind, id: f.properties.id } : null;
  selectedVertex = null;
  renderAll();
  revealDetail();
});
map.on('dblclick', (e) => {
  if (mode?.kind === 'draw') { e.preventDefault(); finishDraw(); return; }
  const h = map.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: ['handles'] })[0];
  if (h) { e.preventDefault(); selectedVertex = h.properties.idx; deleteVertex(); }
});
function pointerMove(lngLat) {
  mouseLL = lngLat;
  if (!frame && mode?.kind === 'draw') ensureFrame(lngLat); // a new project has no map frame until first use
  if (mode?.kind === 'draw') { renderTemp(); showSnap(snap(lngLat)); }
  if (drag) {
    drag.moved = true;
    const item = findItem(drag);
    const s = snap(lngLat, drag);
    item.points[drag.idx] = s.p;
    showSnap(s);
    renderAll(true);
  }
}
map.on('mousemove', (e) => pointerMove(e.lngLat));
map.on('touchmove', (e) => { if (drag) { e.preventDefault(); pointerMove(e.lngLat); } });
for (const layer of ['handles', 'mids']) {
  map.on('mouseenter', layer, () => { if (!mode) map.getCanvas().style.cursor = 'move'; });
  map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
}
function beginDrag(e, layer) {
  if (mode || drag || project.locked) return;
  // A real point always wins over an "add point" dot drawn underneath or beside it.
  if (layer === 'mids' && map.queryRenderedFeatures(e.point, { layers: ['handles'] }).length) return;
  e.preventDefault();
  const p = e.features[0].properties;
  if (layer === 'mids') {
    const item = findItem({ kind: p.kind, id: p.id });
    pushHistory();
    item.points.splice(p.idx + 1, 0, toLocal(e.lngLat));
    drag = { kind: p.kind, id: p.id, idx: p.idx + 1, moved: true, pushed: true };
  } else drag = { kind: p.kind, id: p.id, idx: p.idx, moved: false };
  selectedVertex = drag.idx;
  map.dragPan.disable();
}
map.on('mousedown', 'handles', (e) => beginDrag(e, 'handles'));
map.on('mousedown', 'mids', (e) => beginDrag(e, 'mids'));
map.on('touchstart', 'handles', (e) => beginDrag(e, 'handles'));
map.on('touchstart', 'mids', (e) => beginDrag(e, 'mids'));
function endDrag() {
  if (!drag) return;
  map.dragPan.enable();
  const d = drag;
  setTimeout(() => { drag = null; }, 0);
  showSnap(null);
  if (d.moved) {
    if (!d.pushed) { // record the state from before the drag so undo puts the point back
      const item = findItem(d), now = item.points[d.idx];
      item.points[d.idx] = d.from || now; pushHistory(); item.points[d.idx] = now;
    }
    save(); renderAll();
  } else renderAll(); // a tap on a point selects it
}
map.on('mouseup', endDrag);
map.on('touchend', endDrag);
map.on('mousedown', 'handles', () => { if (drag && !drag.from) { const it = findItem(drag); drag.from = { ...it.points[drag.idx] }; } });
map.on('touchstart', 'handles', () => { if (drag && !drag.from) { const it = findItem(drag); drag.from = { ...it.points[drag.idx] }; } });

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (mode?.points?.length) { mode.points.pop(); renderTemp(); } else undo(); return; }
  if (mode?.kind === 'draw' && !typing) {
    if (e.key === 'Enter') { e.preventDefault(); finishDraw(); }
    if (e.key === 'Escape') cancelMode();
    if (e.key === 'Backspace') { e.preventDefault(); mode.points.pop(); renderTemp(); }
  } else if ((mode?.kind === 'pick' || mode?.kind === 'tap' || mode?.kind === 'cap') && e.key === 'Escape') cancelMode();
  else if (!mode && !typing && selected && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); if (selectedVertex != null) deleteVertex(); else deleteSelected(); }
});

const MIN_POINTS = { asset: 3, obstacle: 3, lop: 2, vector: 2 };
const listOf = (kind) => (kind === 'vector' ? project.vectors : kind === 'lop' ? project.lops : kind === 'obstacle' ? (project.obstacles = project.obstacles || []) : kind === 'osm' ? osmBuildings(true) : project.assets);
const findItem = (ref) => ref && listOf(ref.kind).find((x) => String(x.id) === String(ref.id));
function deleteVertex() {
  if (guard()) return;
  const item = findItem(selected);
  if (!item || selectedVertex == null || selected.kind === 'osm') return;
  const min = (selected.kind === 'lop' && item.closed) ? 3 : MIN_POINTS[selected.kind];
  if (item.points.length <= min) { $('osm-status').textContent = `A ${selected.kind === 'lop' ? 'line' : selected.kind} needs at least ${min} points.`; return; }
  pushHistory();
  item.points.splice(selectedVertex, 1);
  selectedVertex = null; save(); renderAll();
}
function deleteSelected() {
  if (!selected || selected.kind === 'osm' || guard()) return;
  pushHistory();
  const list = listOf(selected.kind);
  const i = list.findIndex((x) => x.id === selected.id);
  if (i >= 0) list.splice(i, 1);
  if (selected.kind === 'lop') project.vectors.forEach((v) => { if (v.lopId === selected.id) v.lopId = null; });
  selected = null; selectedVertex = null; save(); renderAll();
}

// ---------- results ----------
const conv = (kph) => (project.settings.unit === 'MPH' ? kph / KPH_PER_MPH : kph);
const unitName = () => (project.settings.unit === 'MPH' ? 'mph' : 'km/h');
function compute(v) {
  const r = resolveVector(project, v);
  if (!project.lops.length) r.errors = ['Draw a line of protection for this vector to cross', ...r.errors];
  if (r.errors.length || !r.sections.length) return { ...r, speeds: null };
  const rows = buildRouteSpeeds(r.sections, startArg(v.start, v.entryKph));
  const speeds = Object.fromEntries(VEHICLES.map((c) => [c.id, rows[0].exitSpeeds.get(c.id).speed]));
  const worst = Math.max(...Object.values(speeds));
  return { ...r, speeds, worst, runUp: pathLength(r.crossing.points) };
}

function sampleArc(p) {
  const a0 = Math.atan2(p.from.y - p.centre.y, p.from.x - p.centre.x);
  const sweep = (p.side === 'LEFT' ? 1 : -1) * p.angle;
  const n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  return Array.from({ length: n + 1 }, (_, k) => ({ x: p.centre.x + Math.cos(a0 + (sweep * k) / n) * p.radius, y: p.centre.y + Math.sin(a0 + (sweep * k) / n) * p.radius }));
}
function pathCoords(pieces) {
  const out = [];
  for (const p of pieces) {
    const pts = p.kind === 'line' ? [p.from, p.to] : sampleArc(p);
    for (const q of pts) out.push(toLL(q));
  }
  return out;
}

let tags = [], segTags = [], assetTags = [], secTags = [], capTags = [];
let sections = [];
// A point well inside the polygon for its label: the point furthest from every edge (searched on
// a coarse grid, then refined), so L- and U-shaped buildings get a label in their widest part.
function labelPoint(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best = centroid(poly), bestD = pointInPolygon(best, poly) ? nearestOnPolyline(best, poly, true).d : -1;
  for (let round = 0; round < 3; round++) {
    const n = 12, dx = (x1 - x0) / n, dy = (y1 - y0) / n;
    for (let i = 0; i <= n; i++) for (let k = 0; k <= n; k++) {
      const q = { x: x0 + dx * i, y: y0 + dy * k };
      if (!pointInPolygon(q, poly)) continue;
      const d = nearestOnPolyline(q, poly, true).d;
      if (d > bestD) { bestD = d; best = q; }
    }
    x0 = best.x - dx; x1 = best.x + dx; y0 = best.y - dy; y1 = best.y + dy; // zoom in round the best
  }
  return best;
}
function renderAll(fast) {
  if (!map.getSource('path')) return;
  results = new Map(project.vectors.map((v) => [v.id, compute(v)]));
  sections = requiredProtection(project.lops, project.vectors.map((v) => ({ vector: v, result: results.get(v.id) })));
  const sel = (kind, id) => !!selected && selected.kind === kind && selected.id === id;
  const line = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
  setData('asset', { type: 'FeatureCollection', features: frame ? project.assets.map((a) => ({ type: 'Feature', properties: { kind: 'asset', id: a.id, sel: sel('asset', a.id) }, geometry: { type: 'Polygon', coordinates: [[...a.points.map(toLL), toLL(a.points[0])]] } })) : [] });
  setData('lop', { type: 'FeatureCollection', features: frame ? project.lops.flatMap((l) => [
    line((l.closed ? [...l.points, l.points[0]] : l.points).map(toLL), { kind: 'lop', id: l.id, sel: sel('lop', l.id) }),
    ...(l.closed && l.points.length >= 3 ? [{ type: 'Feature', properties: { kind: 'lop', id: l.id, closed: true }, geometry: { type: 'Polygon', coordinates: [[...l.points.map(toLL), toLL(l.points[0])]] } }] : []),
  ]) : [] });
  const poly = (pts, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[...pts.map(toLL), toLL(pts[0])]] } });
  setData('obstacle', { type: 'FeatureCollection', features: frame ? project.obstacles.map((o) => poly(o.points, { kind: 'obstacle', id: o.id, sel: sel('obstacle', o.id) })) : [] });
  const assetOsm = new Set(project.assets.map((a) => a.osmId).filter(Boolean));
  setData('osm', { type: 'FeatureCollection', features: frame ? osmBuildings(true).filter((b) => !assetOsm.has(b.id)).map((b) => poly(b.points, { kind: 'osm', id: b.id, sel: sel('osm', b.id), excluded: project.osmExcluded.includes(b.id) })) : [] });
  $('obs-count').textContent = `${osmBuildings().length + project.obstacles.length} obstacles`;
  const raw = [], path = [];
  for (const v of project.vectors) {
    const r = results.get(v.id);
    raw.push(line(v.points.map(toLL), { kind: 'vector', id: v.id }));
    const status = v.status === 'suggested' || v.status === 'rejected' ? v.status : 'firm';
    if (r.speeds && r.pieces?.length) path.push(line(pathCoords(r.pieces), { kind: 'vector', id: v.id, sel: sel('vector', v.id), colour: bandColour(r.worst), status }));
  }
  setData('raw', { type: 'FeatureCollection', features: raw });
  setData('path', { type: 'FeatureCollection', features: path });
  const item = findItem(selected);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const editable = item && selected.kind !== 'osm';
  // Thin out handles that would sit on top of each other on screen; zoom in to reach the rest.
  const gapM = (coarse ? 28 : 16) * metresPerPixel();
  let lastShown = null;
  const shown = editable ? item.points.map((p, idx) => ({ p, idx })).filter(({ p, idx }) => {
    if (idx === selectedVertex || !lastShown || dist(p, lastShown) >= gapM) { lastShown = p; return true; }
    return false;
  }) : [];
  setData('handles', { type: 'FeatureCollection', features: shown.map(({ p, idx }) => ({ type: 'Feature', properties: { kind: selected.kind, id: item.id, idx, coarse, sel: idx === selectedVertex }, geometry: { type: 'Point', coordinates: toLL(p) } })) });
  const closedItem = editable && (selected.kind === 'asset' || selected.kind === 'obstacle' || (selected.kind === 'lop' && item.closed));
  const edges = editable ? item.points.map((p, i) => [p, item.points[i + 1] ?? (closedItem ? item.points[0] : null), i]).filter((e) => e[1]) : [];
  // Only offer "add point" dots on edges long enough on screen to tap without hitting a point.
  const minPx = coarse ? 56 : 32, mpp = metresPerPixel();
  setData('mids', { type: 'FeatureCollection', features: edges.filter(([a, b]) => dist(a, b) / mpp > minPx).map(([a, b, idx]) => ({ type: 'Feature', properties: { kind: selected.kind, id: item.id, idx, coarse }, geometry: { type: 'Point', coordinates: toLL({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) } })) });
  // Edge lengths on the selected shape.
  segTags.forEach((t) => t.remove()); segTags = [];
  if (item && selected.kind !== 'vector') {
    const allEdges = item.points.map((p, i) => [p, item.points[i + 1] ?? (selected.kind !== 'lop' || item.closed ? item.points[0] : null)]).filter((e) => e[1]);
    if (allEdges.length <= 40) for (const [a, b] of allEdges) {
      const L = dist(a, b); if (L < 2 || L / mpp < 70) continue; // only where the label fits on screen
      const el = document.createElement('div'); el.className = 'seg-tag'; el.textContent = `${L.toFixed(1)} m`;
      segTags.push(new maplibregl.Marker({ element: el }).setLngLat(toLL({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).addTo(map));
    }
  }
  // Speed tags at each LoP crossing.
  tags.forEach((t) => t.remove()); tags = [];
  for (const v of project.vectors) {
    const r = results.get(v.id);
    if (!r.speeds || v.status === 'rejected') continue;
    if (v.status === 'suggested' && !(selected?.kind === 'vector' && selected.id === v.id)) continue; // keeps the map readable
    const el = document.createElement('div');
    el.className = 'speed-tag'; el.style.setProperty('--c', bandColour(r.worst));
    el.textContent = `${v.name} · ${Math.round(conv(r.worst))}`;
    el.title = `${v.name}: up to ${Math.round(conv(r.worst))} ${unitName()} at the line of protection`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); selected = { kind: 'vector', id: v.id }; renderAll(); });
    tags.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat(toLL(r.crossing.point)).addTo(map));
  }
  // Required protection: each LoP section coloured by the impact speed it must resist.
  setData('req', { type: 'FeatureCollection', features: frame ? sections.filter((x) => x.worst != null).map((x) => line(x.points.map(toLL), { colour: bandColour(x.worst) })) : [] });
  secTags.forEach((t) => t.remove()); secTags = [];
  if (frame) for (const x of sections) {
    const el = document.createElement('div');
    el.className = 'sec-tag'; el.style.setProperty('--c', x.worst != null ? bandColour(x.worst) : '#888');
    el.textContent = x.worst != null ? `${x.label} · ${Math.round(conv(x.worst))}` : x.label;
    el.title = x.worst != null ? `Section ${x.label}: up to ${Math.round(conv(x.worst))} ${unitName()} (${x.governing.name})` : `Section ${x.label}: no accepted vector yet`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); if (mode) return; selected = { kind: 'lop', id: x.lopId }; selectedVertex = null; renderAll(); $('sec-req').open = true; $('sec-req').scrollIntoView({ block: 'nearest' }); });
    secTags.push(new maplibregl.Marker({ element: el, offset: [0, 0] }).setLngLat(toLL(midpointOf(x.points))).addTo(map));
  }
  // Speed-limiting features on vectors.
  capTags.forEach((t) => t.remove()); capTags = [];
  if (frame) for (const v of project.vectors) {
    if (v.status === 'rejected') continue;
    for (const c of v.caps || []) {
      const el = document.createElement('div'); el.className = 'cap-tag';
      el.textContent = c.kph > 0 ? `${CAP_TYPES[c.type] || 'Limit'} ≤${Math.round(conv(c.kph))}` : 'STOP';
      capTags.push(new maplibregl.Marker({ element: el }).setLngLat(toLL(c.point)).addTo(map));
    }
  }
  // Asset name labels.
  assetTags.forEach((t) => t.remove()); assetTags = [];
  if (frame) for (const a of project.assets) {
    const el = document.createElement('div');
    el.className = `asset-tag${sel('asset', a.id) ? ' sel' : ''}`;
    el.textContent = a.name;
    el.title = `${a.name}: the asset being protected`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); if (mode) return; selected = { kind: 'asset', id: a.id }; selectedVertex = null; renderAll(); revealDetail(); });
    assetTags.push(new maplibregl.Marker({ element: el }).setLngLat(toLL(labelPoint(a.points))).addTo(map));
  }
  if (fast) { renderDetail(); return; }
  renderPlanFacts(); renderList(); renderDetail(); renderProject(); renderReq(); renderChecklist(); renderLock();
}
function setData(id, data) { const s = map.getSource(id); if (s) s.setData(data); }

function renderList() {
  $('vec-count').textContent = project.vectors.length ? `${project.vectors.length}` : '';
  $('unit').value = project.settings.unit;
  const order = (v) => (v.status === 'rejected' ? 1 : 0);
  $('vec-list').innerHTML = [...project.vectors].sort((a, b) => order(a) - order(b) || (results.get(b.id)?.worst || 0) - (results.get(a.id)?.worst || 0)).map((v) => {
    const r = results.get(v.id);
    const val = r?.speeds ? `${Math.round(conv(r.worst))} ${unitName()}` : '—';
    const badge = v.status === 'suggested' ? '<span class="badge sugg">suggested</span>' : v.status === 'accepted' ? '<span class="badge acc">accepted</span>' : v.status === 'rejected' ? '<span class="badge rej">rejected</span>' : '';
    return `<li class="${v.status === 'rejected' ? 'rejected' : ''}"><button data-vec="${v.id}" class="${selected?.kind === 'vector' && selected.id === v.id ? 'sel' : ''}"><span class="sw" style="background:${r?.speeds ? bandColour(r.worst) : '#bbb'}"></span><span>${esc(v.name)}${badge}</span><span class="v">${val}</span></button></li>`;
  }).join('') || '<li class="hint">No vectors yet. Add a line of protection, then press "Find attack vectors" or draw one yourself.</li>';
}
$('vec-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-vec]'); if (!b) return;
  selected = { kind: 'vector', id: b.dataset.vec }; selectedVertex = null; renderAll(); revealDetail();
});
// Bring the details into view after selecting something (they sit lower in the side panel).
function revealDetail() {
  if (!selected) return;
  requestAnimationFrame(() => $('detail-box').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
}
$('unit').addEventListener('change', (e) => { project.settings.unit = e.target.value; save(); renderAll(); });

function renderDetail() {
  const box = $('vec-detail');
  const item = findItem(selected);
  if (!item) { box.innerHTML = ''; return; }
  if (selected.kind !== 'vector') { renderShapeDetail(box, item); lockDetail(box); return; }
  const v = item, r = results.get(v.id);
  let html = `<h3>${esc(v.name)}</h3>
    <label>Name <input id="d-name" value="${esc(v.name)}" maxlength="40"></label>
    <label>How the vehicle passes the start point <select id="d-start">
      <option value="STANDING"${v.start === 'STANDING' ? ' selected' : ''}>Standing start (from rest)</option>
      <option value="ENTRY"${v.start === 'ENTRY' ? ' selected' : ''}>Entry speed (already moving)</option>
      <option value="ROLLING"${v.start === 'ROLLING' ? ' selected' : ''}>Rolling start (already at top speed)</option></select></label>
    ${v.start === 'ENTRY' ? `<div class="entry">Entry speed <input id="d-entry" type="number" min="0" step="any" value="${v.entryKph ? +conv(v.entryKph).toFixed(1) : ''}" aria-label="Entry speed"> ${unitName()}</div>` : ''}
    <p class="hint">${v.start === 'STANDING' ? 'Start the vector where a vehicle can be stationary: a parking bay, loading area, queue, stop line or gate.' : v.start === 'ROLLING' ? 'Assumes an unlimited run-up before the start point. Most conservative; better to extend the vector back to a real stopping place and use a standing start.' : 'Use the speed a vehicle can reach on the road leading to the start point.'}</p>`;
  if (v.source === 'generated') {
    html += `<div class="review"><p class="hint"><b>Found automatically.</b> ${esc(v.note || '')}</p>${v.status === 'rejected' ? `<p class="hint">Rejected: ${esc(v.statusReason || '')}</p>` : ''}
      <div class="btnrow">${v.status !== 'accepted' ? '<button id="d-accept" class="primary">Accept</button>' : ''}${v.status !== 'rejected' ? '<button id="d-reject">Reject…</button>' : ''}</div>
      <form id="d-reject-form" class="inline" hidden><input id="d-reason" placeholder="Reason, e.g. bollards already stop this" aria-label="Reason for rejecting"><button>Reject</button></form></div>`;
  }
  html += r.errors.map((m) => `<p class="err">${esc(m)}</p>`).join('');
  html += (r.warnings || []).map((m) => `<p class="wrn">${esc(m)}</p>`).join('');
  if (r.speeds) {
    html += `<dl class="facts"><dt>Run-up</dt><dd>${r.runUp.toFixed(1)} m</dd><dt>Impact angle</dt><dd>${r.crossing.angle.toFixed(0)}° (90° = head-on)</dd></dl>
    <table><thead><tr><th>Vehicle</th><th>${unitName()}</th><th>kJ</th><th>Test speed</th></tr></thead><tbody>${VEHICLES.map((c) => {
      const s = r.speeds[c.id], ke = 0.5 * MASS_KG[c.id] * (s / 3.6) ** 2 / 1000, t = nextTestSpeed(s, c.id);
      return `<tr><td>${esc(c.name)}</td><td>${Math.round(conv(s))}</td><td>${Math.round(ke).toLocaleString()}</td><td>${t ? `${t} km/h` : `<span class="bad" title="No ISO 22343-1 test exists above ${MAX_TEST_SPEED_KPH[c.id]} km/h for this vehicle class">above ${MAX_TEST_SPEED_KPH[c.id]}</span>`}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="hint">Test speed is the lowest ISO 22343-1 impact test speed at or above the impact speed that exists for the class (trucks up to 80, flatbeds up to 96, cars and pick-ups up to 112 km/h). The report gives the full ISO rating per section.</p>`;
  }
  const bends = (r.vertices || []);
  if (bends.length) {
    html += `<h3>Bends</h3>` + bends.map((b) => {
      const opt = v.vertexOptions?.[b.point];
      const info = b.straight ? 'sharp corner, no speed limit (radius would exceed 150 m)' : `${b.side.toLowerCase()} ${(b.theta * 180 / Math.PI).toFixed(0)}°, r ${b.radius.toFixed(1)} m${b.mode === 'max' ? ' (largest that fits)' : b.clamped ? ' (reduced to fit)' : ''}`;
      return `<div class="bend"><span>Point ${b.point + 1}: ${info}</span><input type="number" min="0" step="any" data-bend="${b.point}" placeholder="Largest fit" aria-label="Fixed radius at point ${b.point + 1} in metres" value="${opt?.mode === 'fixed' ? opt.radius : ''}"></div>`;
    }).join('') + '<p class="hint">Leave a radius blank for the largest that fits (worst case). Type a radius to fix it.</p>';
  }
  const capsHtml = (v.caps || []).map((c, i) => `<div class="cap-row"><select data-cap-type="${i}" aria-label="Feature type">${Object.entries(CAP_TYPES).map(([k, t]) => `<option value="${k}"${c.type === k ? ' selected' : ''}>${t}</option>`).join('')}</select><input type="number" min="0" step="any" data-cap-kph="${i}" value="${+conv(c.kph).toFixed(1)}" aria-label="Speed limit at this point" ${c.type === 'stop' ? 'disabled' : ''}><button data-cap-del="${i}" title="Remove" aria-label="Remove">✕</button></div>`).join('');
  html += `<h3>Speed-limiting features</h3><div class="caps">${capsHtml || '<p class="hint">None. Add gates, chicanes, speed tables or forced stops on this route to see their effect.</p>'}</div>
    ${v.caps?.length ? `<p class="hint">Speeds in ${unitName()}. A forced stop restarts vehicles from rest; a limit caps the speed at that point and vehicles accelerate again after it.</p>` : ''}
    <button id="d-addcap">Add a gate, chicane or stop…</button>`;
  html += `<div class="btnrow"><button id="d-copy">Copy results for report</button><button id="d-hovva" title="Copies this vector's sections starting at the asset, the order NPSA HOVVA uses">Copy for HOVVA</button><button id="d-calc">Open in route calculator</button><button id="d-del" class="quiet">Delete vector</button></div><p class="hint" id="d-calc-msg"></p>`;
  const focusId = document.activeElement?.id || document.activeElement?.dataset?.bend;
  box.innerHTML = html;
  if (focusId) (document.getElementById(focusId) || box.querySelector(`[data-bend="${focusId}"]`))?.focus();
  $('d-name').onchange = (e) => { v.name = e.target.value.trim() || v.name; save(); renderAll(); };
  if ($('d-accept')) $('d-accept').onclick = () => { pushHistory(); v.status = 'accepted'; v.statusReason = ''; save(); renderAll(); };
  if ($('d-reject')) $('d-reject').onclick = () => { $('d-reject-form').hidden = false; $('d-reason').focus(); };
  if ($('d-reject-form')) $('d-reject-form').onsubmit = (e) => {
    e.preventDefault();
    const why = $('d-reason').value.trim();
    if (!why) { $('d-reason').placeholder = 'A reason is needed to reject'; $('d-reason').focus(); return; }
    pushHistory(); v.status = 'rejected'; v.statusReason = why; save(); renderAll();
  };
  $('d-start').onchange = (e) => { v.start = e.target.value; save(); renderAll(); };
  if ($('d-entry')) $('d-entry').onchange = (e) => { const x = parseFloat(e.target.value); v.entryKph = x > 0 ? (project.settings.unit === 'MPH' ? x * KPH_PER_MPH : x) : 0; save(); renderAll(); };
  $('d-addcap').onclick = () => startCapMode(v);
  box.querySelectorAll('[data-cap-type]').forEach((el) => { el.onchange = () => { if (guard()) return; pushHistory(); const c = v.caps[+el.dataset.capType]; c.type = el.value; if (c.type === 'stop') c.kph = 0; else if (!c.kph) c.kph = CAP_DEFAULT[c.type] || 20; save(); renderAll(); }; });
  box.querySelectorAll('[data-cap-kph]').forEach((el) => { el.onchange = () => { if (guard()) return; pushHistory(); const x = parseFloat(el.value); v.caps[+el.dataset.capKph].kph = x > 0 ? (project.settings.unit === 'MPH' ? x * KPH_PER_MPH : x) : 0; save(); renderAll(); }; });
  box.querySelectorAll('[data-cap-del]').forEach((el) => { el.onclick = () => { if (guard()) return; pushHistory(); v.caps.splice(+el.dataset.capDel, 1); save(); renderAll(); }; });
  $('d-hovva').onclick = async (e) => {
    if (!r.sections?.length || r.errors.length) { flash(e.target, false, '', 'Fix the problems above first'); return; }
    flash(e.target, await copyRich(hovvaTable(r.sections, `${project.title ? project.title + ' – ' : ''}${v.name}`)));
  };
  $('d-copy').onclick = async (e) => {
    if (!r.speeds) { flash(e.target, false, '', 'Nothing to copy yet'); return; }
    flash(e.target, await copyRich(vectorTable(v, r)));
  };
  box.querySelectorAll('[data-bend]').forEach((inp) => { inp.onchange = () => {
    const i = +inp.dataset.bend, val = parseFloat(inp.value);
    v.vertexOptions = v.vertexOptions || [];
    v.vertexOptions[i] = val > 0 ? { mode: 'fixed', radius: val } : { mode: 'max' };
    save(); renderAll();
  }; });
  $('d-del').onclick = deleteSelected;
  lockDetail(box);
  let armed = false;
  $('d-calc').onclick = () => {
    if (!r.speeds) { $('d-calc-msg').textContent = 'Fix the problems above first.'; return; }
    if (!armed) { armed = true; $('d-calc-msg').textContent = 'This replaces the route currently in the calculator. Click again to continue.'; $('d-calc').textContent = 'Replace and open'; return; }
    let n = 1;
    const sections = r.sections.map((s) => ({ id: n++, sType: s.sType, sLength: Math.round(s.sLength * 1000) / 1000, radius: s.sType === 'STRAIGHT' ? 150 : Math.round(s.radius * 1000) / 1000, description: s.vertex != null ? `Bend at point ${s.vertex + 1}` : '' }));
    const prev = loadJSON(KEY_CALC) || {};
    saveJSON(KEY_CALC, { ...prev, sections, counter: n, start: v.start, entryKph: v.entryKph || 0, order: 'FROM_START', unit: project.settings.unit, title: `${project.title ? project.title + ' – ' : ''}${v.name}`.slice(0, 55) });
    location.href = 'index.html';
  };
}

// ---------- search ----------
$('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('search').value.trim(); if (!q) return;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (m) { map.flyTo({ center: [+m[2], +m[1]], zoom: 17 }); $('search-status').textContent = ''; return; }
  if (!mtKey) { $('search-status').textContent = 'Address search needs a MapTiler key. You can type coordinates instead, e.g. 51.5072, -0.1276.'; return; }
  $('search-status').textContent = 'Searching…';
  try {
    const res = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(mtKey)}&limit=1`);
    if (!res.ok) throw new Error(res.status === 403 ? 'The MapTiler key was refused' : `Search failed (${res.status})`);
    const f = (await res.json()).features?.[0];
    if (!f) { $('search-status').textContent = 'No match found.'; return; }
    if (f.bbox) map.fitBounds([[f.bbox[0], f.bbox[1]], [f.bbox[2], f.bbox[3]]], { maxZoom: 18 }); else map.flyTo({ center: f.center, zoom: 17 });
    $('search-status').textContent = f.place_name || '';
  } catch (err) { $('search-status').textContent = err.message; }
});
$('basemap').addEventListener('change', (e) => setBasemap(e.target.value));
$('key-form').addEventListener('submit', (e) => {
  e.preventDefault();
  ownKey = $('key').value.trim(); $('key').value = '';
  try { if (ownKey) localStorage.setItem(KEY_MAPTILER, ownKey); else localStorage.removeItem(KEY_MAPTILER); } catch { /* ignore */ }
  mtKey = ownKey || SITE_KEY;
  renderKey(); setBasemap($('basemap').value);
});
function renderKey() {
  $('key-state').textContent = ownKey ? 'this browser' : SITE_KEY ? 'set for the site' : 'not set';
  $('key-hint').textContent = SITE_KEY
    ? 'A key is set for the whole site, so maps work on every device. Paste a different key here only to override it in this browser; save an empty box to go back to the site key.'
    : 'No site-wide key yet. Add MAPTILER_KEY in the Vercel project settings (Environment Variables) and redeploy to make maps work on every device, or paste a key here for this browser only. Without a key, streets come from OpenStreetMap and satellite and address search are off.';
  $('basemap').querySelector('[value="satellite"]').textContent = mtKey ? 'Satellite' : 'Satellite (needs key)';
}

// ---------- project ----------
function renderProject() {
  $('title').value = project.title || '';
  const custom = project.marking && !['OFFICIAL', 'OFFICIAL-SENSITIVE'].includes(project.marking);
  $('marking').value = !project.marking ? '' : custom ? 'CUSTOM' : project.marking;
  $('marking-custom').hidden = !custom && $('marking').value !== 'CUSTOM';
  if (custom) $('marking-custom').value = project.marking;
  $('egress-warn').hidden = !project.marking || project.marking === 'OFFICIAL';
  renderDetailsForm();
}
$('title').addEventListener('change', (e) => { if (guard()) return; project.title = e.target.value; save(); renderChecklist(); });
$('marking').addEventListener('change', (e) => {
  if (e.target.value === 'CUSTOM') { $('marking-custom').hidden = false; $('marking-custom').focus(); project.marking = $('marking-custom').value.trim() || null; }
  else project.marking = e.target.value || null;
  save(); renderProject(); renderChecklist();
});
$('marking-custom').addEventListener('change', (e) => { project.marking = e.target.value.trim() || null; save(); renderProject(); renderChecklist(); });
$('proj-save').addEventListener('click', async () => {
  const out = { ...project, planImage: null };
  if (project.plan) { const b = await getBlob(`plan:${project.id}`); if (b) out.planImage = await blobToDataURL(b); }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(project.title || 'vda-project').replace(/[^\w.-]+/g, '-')}.vda.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('proj-open').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.vectors) || !Array.isArray(data.lops)) throw new Error('not a project');
    const img = data.planImage; delete data.planImage;
    project = { ...blankProject(), ...data };
    frame = project.anchor ? makeFrame(project.anchor) : null;
    if (planURL) { URL.revokeObjectURL(planURL); planURL = null; }
    if (img && project.plan) { const b = await dataURLToBlob(img); await putBlob(`plan:${project.id}`, b); planURL = URL.createObjectURL(b); } else project.plan = null;
    selected = null; selectedVertex = null; history.length = 0; save(); showPlan();
    if (project.view) map.jumpTo({ center: project.view.center, zoom: project.view.zoom });
    renderAll(); $('proj-status').textContent = `Opened ${file.name}.`;
  } catch { $('proj-status').textContent = 'That file is not a VDA project.'; }
});
let clearArmed = false;
$('proj-clear').addEventListener('click', async () => {
  if (!clearArmed) { clearArmed = true; $('proj-status').textContent = 'This deletes everything on the map. Download the project first if you want to keep it. Click "New project" again to continue.'; return; }
  clearArmed = false;
  await deleteBlob(`plan:${project.id}`);
  const view = project.view, basemap = project.basemap;
  project = { ...blankProject(), view, basemap }; frame = null; selected = null; selectedVertex = null; history.length = 0;
  if (planURL) { URL.revokeObjectURL(planURL); planURL = null; }
  save(); showPlan(); renderAll(); $('proj-status').textContent = 'Started a new project.';
});

// ---------- legend ----------
$('legend').innerHTML = `<div class="key"><span><i class="k-asset"></i>Asset</span><span><i class="k-lop"></i>Line of protection</span><span><i class="k-obs"></i>Obstacle</span></div>` + '<b>Worst-case impact speed <em class="short">(km/h)</em></b>' + TEST_SPEEDS_KPH.map((t, i) => `<span><i style="background:${BAND_COLOURS[i]}"></i><em class="full">≤ ${t} km/h</em><em class="short">${t}</em></span>`).join('') + `<span><i style="background:${BAND_COLOURS[7]}"></i><em class="full">&gt; 112 km/h</em><em class="short">&gt;112</em></span>`;

// ---------- copy for report ----------
const startText = (v) => (v.start === 'STANDING' ? 'standing start (from rest)' : v.start === 'ENTRY' ? (v.entryKph > 0 ? `entry speed ${Math.round(conv(v.entryKph))} ${unitName()}` : 'entry speed not set, so treated as a standing start') : 'rolling start (already at top speed)');
const titled = (t) => (project.title ? `${project.title} – ${t}` : t);
function vectorTable(v, r) {
  return reportTable({
    title: titled(`Vector ${v.name}: impact at the line of protection`), numericFrom: 1,
    headers: ['Vehicle', `Impact speed (${unitName()})`, 'Impact energy (kJ)', 'Next test speed (km/h)'],
    rows: VEHICLES.map((c) => { const sp = r.speeds[c.id]; return [c.name, Math.round(conv(sp)), Math.round(0.5 * MASS_KG[c.id] * (sp / 3.6) ** 2 / 1000), testSpeedText(sp, c.id)]; }),
    notes: [`Run-up ${r.runUp.toFixed(1)} m; impact angle ${r.crossing.angle.toFixed(0)}° (90° = head-on); ${startText(v)}.`, ...(project.marking ? [project.marking] : [])],
  });
}
$('copy-all').addEventListener('click', async (e) => {
  const ok = project.vectors.filter((v) => v.status !== 'suggested' && v.status !== 'rejected').map((v) => [v, results.get(v.id)]).filter(([, r]) => r?.speeds);
  if (!ok.length) { flash(e.target, false, '', 'No vectors with results yet'); return; }
  const t = reportTable({
    title: titled('Impact speeds at the line of protection'), numericFrom: 1,
    headers: ['Vector', 'Run-up (m)', 'Angle (°)', 'Start', 'Speed-limiting features', ...VEHICLES.map((c) => `${c.name} (${unitName()})`)],
    rows: ok.map(([v, r]) => [v.name, r.runUp.toFixed(0), r.crossing.angle.toFixed(0), v.start === 'ENTRY' ? `Entry ${Math.round(conv(v.entryKph || 0))}` : v.start === 'STANDING' ? 'Standing' : 'Rolling', capsText(v), ...VEHICLES.map((c) => Math.round(conv(r.speeds[c.id])))]),
    notes: ['Maximum achievable speeds on a flat, level, dry surface; worst-case bend radii unless fixed by the assessor.', ...(project.marking ? [project.marking] : [])],
  });
  flash(e.target, await copyRich(t));
});
$('version').textContent = `v${VERSION}`;
mountThemeToggle($('theme'));
const bgColour = () => (document.documentElement.dataset.theme === 'light' ? '#eef0f2' : '#1a2026');
const applyMapTheme = () => {
  if (map.getLayer('bg')) map.setPaintProperty('bg', 'background-color', bgColour());
  if (map.getLayer('asset-casing')) map.setPaintProperty('asset-casing', 'line-color', casingColour());
};
document.addEventListener('themechange', applyMapTheme);
map.on('load', applyMapTheme);

// ---------- shape details ----------
function renderShapeDetail(box, item) {
  const k = selected.kind;
  const facts = [];
  let buttons = '';
  if (k === 'asset' || k === 'obstacle' || k === 'osm') {
    facts.push(['Area', `${Math.round(area(item.points)).toLocaleString()} m²`], ['Perimeter', `${perimeter(item.points).toFixed(1)} m`]);
  }
  if (k === 'asset' && project.lops.length) {
    const d = Math.min(...project.lops.map((l) => minDistance(item.points, true, l.points, !!l.closed)));
    facts.push(['Standoff to nearest line of protection', `${d.toFixed(1)} m`]);
  }
  if (k === 'lop') {
    facts.push(['Length', `${(item.closed ? perimeter(item.points) : polylineLength(item.points)).toFixed(1)} m${item.closed ? ' (closed loop)' : ''}`]);
    if (project.assets.length) {
      const d = Math.min(...project.assets.map((a) => minDistance(item.points, !!item.closed, a.points, true)));
      facts.push(['Nearest standoff to an asset', `${d.toFixed(1)} m`]);
    }
  }
  facts.push(['Points', item.points.length]);
  const title = k === 'osm' ? (item.wall ? `Wall or barrier (${esc(item.wall.replace('_', ' '))}, OpenStreetMap)` : 'Building (OpenStreetMap)') : esc(item.name);
  if (k === 'asset') buttons += '<button id="s-lop">Line of protection round this asset</button>';
  if (k === 'lop') buttons += `<label class="chk"><input type="checkbox" id="s-closed"${item.closed ? ' checked' : ''}> Closed loop</label>`;
  if (k === 'osm') {
    const ex = project.osmExcluded.includes(item.id);
    buttons += `<button id="s-exclude">${ex ? 'Count it as an obstacle' : 'Not an obstacle'}</button>${item.wall ? '' : '<button id="s-asset">Make it the asset</button>'}`;
  }
  if (k !== 'osm' && selectedVertex != null) buttons += `<button id="s-delpt">Delete point ${selectedVertex + 1}</button>`;
  if (k !== 'osm') buttons += `<button id="s-del" class="quiet">Delete ${k === 'lop' ? 'line' : k}</button>`;
  box.innerHTML = `<h3>${title}</h3>
    ${k !== 'osm' ? `<label>Name <input id="s-name" value="${esc(item.name)}" maxlength="60"></label>` : `<p class="hint">${project.osmExcluded.includes(item.id) ? 'Marked as not an obstacle: vehicles may drive through it.' : 'Counts as an obstacle: vehicles cannot drive through it.'}</p>`}
    <dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
    ${k !== 'osm' ? '<p class="hint">Drag a point to move it, drag a small dot between points to add one, tap a point then Delete point to remove it.</p>' : ''}
    <div class="btnrow">${buttons}</div>`;
  if ($('s-name')) $('s-name').onchange = (e) => { pushHistory(); item.name = e.target.value.trim() || item.name; save(); renderAll(); };
  if ($('s-lop')) $('s-lop').onclick = () => $('lop-auto').click();
  if ($('s-closed')) $('s-closed').onchange = (e) => { if (e.target.checked && item.points.length < 3) { e.target.checked = false; return; } pushHistory(); item.closed = e.target.checked; save(); renderAll(); };
  if ($('s-exclude')) $('s-exclude').onclick = () => { pushHistory(); const i = project.osmExcluded.indexOf(item.id); if (i >= 0) project.osmExcluded.splice(i, 1); else project.osmExcluded.push(item.id); save(); renderAll(); };
  if ($('s-asset')) $('s-asset').onclick = () => { pushHistory(); const a = { id: uid('ast'), name: `Asset ${project.assets.length + 1}`, points: item.points.map((q) => ({ ...q })), osmId: item.id }; project.assets.push(a); selected = { kind: 'asset', id: a.id }; save(); renderAll(); };
  if ($('s-delpt')) $('s-delpt').onclick = deleteVertex;
  if ($('s-del')) $('s-del').onclick = deleteSelected;
}

// ---------- find attack vectors ----------
$('ag-run').addEventListener('click', async () => {
  if (guard()) return;
  if (!project.lops.length) { $('ag-status').textContent = 'Add a line of protection first (Site → Line of protection).'; return; }
  const radius = Math.min(1000, Math.max(50, +$('ag-radius').value || 440));
  const keep = Math.min(50, Math.max(1, +$('ag-max').value || 10));
  const btn = $('ag-run'); btn.disabled = true;
  try {
    // Map data must cover every line of protection plus the study radius.
    const pts = project.lops.flatMap((l) => l.points);
    const c = { x: (Math.min(...pts.map((q) => q.x)) + Math.max(...pts.map((q) => q.x))) / 2, y: (Math.min(...pts.map((q) => q.y)) + Math.max(...pts.map((q) => q.y))) / 2 };
    const reach = Math.max(...pts.map((q) => dist(q, c))) + radius + 20;
    if (!project.osm || dist(c, project.osm.centre) + reach > project.osm.radius) {
      $('ag-status').textContent = 'Loading buildings and roads for the study area…';
      const ll = toLL(c);
      $('ag-radius').dataset.reach = String(Math.round(reach));
      await loadOSM({ lng: ll[0], lat: ll[1] }, reach);
      if (!project.osm || dist(c, project.osm.centre) + reach > project.osm.radius) $('ag-status').textContent = 'Map data could not be loaded for the whole study area, so results may miss buildings.';
    }
    $('ag-status').textContent = 'Searching…';
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    const res = await runSearch({
      lops: project.lops, assets: project.assets,
      obstacles: [...osmBuildings().map((b) => b.points), ...project.obstacles.map((o) => o.points)],
      roads: (project.osm?.roads || []).map((r) => r.points),
      radius, maxResults: keep,
    });
    pushHistory();
    project.vectors = project.vectors.filter((v) => v.status !== 'suggested');
    let n = 0;
    for (const c of res.candidates) {
      n++;
      project.vectors.push(newVector({ name: `G${project.vectorCounter++}`, source: 'generated', status: 'suggested', start: c.start, points: c.points, vertexOptions: c.vertexOptions, note: c.note, kind: c.kind }));
    }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    $('ag-status').textContent = `${n} suggestions from ${res.stats.samples.toLocaleString()} candidate routes (${secs} s). They are dashed on the map: open each to accept or reject it.`;
    selected = null; save(); renderAll();
  } catch (e) {
    $('ag-status').textContent = `The search failed: ${e.message}`;
  } finally { btn.disabled = false; }
});

// Run the search in a worker where possible, so the page stays responsive on slower devices.
function runSearch(params) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./autogen-worker.js', import.meta.url), { type: 'module' }); } catch { resolve(generateVectors(params)); return; }
    const fallback = () => { w.terminate(); try { resolve(generateVectors(params)); } catch (e) { reject(e); } };
    w.onmessage = (e) => { w.terminate(); if (e.data.ok) resolve(e.data); else reject(new Error(e.data.error)); };
    w.onerror = (e) => { e.preventDefault(); fallback(); };
    w.postMessage(params);
  });
}

// Test hook: only with ?debug in the address, so automated checks can find points on screen.
if (new URLSearchParams(location.search).has('debug')) window.__vda = { map, project: () => project, toLL };

// ---------- speed-limiting features ----------
const CAP_TYPES = { stop: 'Forced stop', gate: 'Gate or barrier arm', chicane: 'Chicane', hump: 'Speed table or hump', other: 'Other limit' };
const CAP_DEFAULT = { gate: 5, chicane: 20, hump: 25, other: 20 };
function startCapMode(v) {
  if (guard()) return;
  cancelMode();
  mode = { kind: 'cap', vectorId: v.id };
  document.body.classList.add('drawing');
  $('drawbar').hidden = false;
  $('db-title').textContent = 'Tap the route where vehicles are slowed or stopped';
  $('db-hint').textContent = 'For example a gate, a chicane, a speed table or a point where vehicles must stop.';
  $('db-measure').textContent = '';
  $('db-undo').hidden = $('db-finish').hidden = true;
}
function placeCap(e) {
  const v = project.vectors.find((x) => x.id === mode.vectorId), r = results.get(v?.id);
  if (!v || !r?.pieces) { cancelMode(); return; }
  // Snap the tap onto the route itself.
  const tap = toLocal(e.lngLat);
  const pts = r.pieces.flatMap((q) => (q.kind === 'line' ? [q.from, q.to] : sampleArc(q)));
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) { const q = nearestOnPolyline(tap, [pts[i], pts[i + 1]]); if (!best || q.d < best.d) best = q; }
  if (!best || best.d / metresPerPixel() > 30) { $('db-hint').textContent = 'Tap on the route line itself.'; return; }
  pushHistory();
  v.caps = v.caps || [];
  v.caps.push({ id: uid('cap'), point: best.point, kph: 0, type: 'stop' });
  cancelMode(); save(); renderAll();
}

// ---------- locking (issued versions) ----------
function guard() {
  if (!project.locked) return false;
  const b = $('lock-banner'); b.hidden = false; b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
  return true;
}
function lockDetail(box) {
  if (!project.locked) return;
  box.querySelectorAll('input, select, textarea, button').forEach((el) => { if (!/^(d-copy|d-hovva|d-calc)$/.test(el.id)) el.disabled = true; });
}
function renderLock() {
  document.body.classList.toggle('locked', !!project.locked);
  const last = project.issues[project.issues.length - 1];
  $('lock-banner').hidden = !project.locked;
  if (project.locked && last) $('lock-banner').textContent = `Issued as version ${last.n} on ${last.date}. It is locked; choose "Unlock to revise" under Project and report to make changes.`;
  $('issue').hidden = !!project.locked; $('unlock').hidden = !project.locked;
  $('issues').innerHTML = project.issues.length ? project.issues.map((x) => `<div>Version ${x.n} – ${esc(x.date)}${x.by ? ` – ${esc(x.by)}` : ''}${x.reopened ? ' (since revised)' : ''}</div>`).join('') : '<div>Not issued yet. Issuing locks the assessment and records the version on the report.</div>';
}
let issueArmed = false;
$('issue').addEventListener('click', () => {
  const open = checklistItems().filter((c) => c.state !== 'ok' && c.required);
  if (open.length && !issueArmed) { issueArmed = true; $('proj-status').textContent = `${open.length} checklist item${open.length === 1 ? ' is' : 's are'} not complete. Click "Issue this version" again to issue anyway.`; return; }
  issueArmed = false;
  pushHistory();
  project.issues.push({ n: project.issues.length + 1, date: new Date().toISOString().slice(0, 10), at: new Date().toISOString(), by: project.details.assessor || '' });
  project.locked = true;
  $('proj-status').textContent = `Issued as version ${project.issues.length}.`;
  save(); renderAll();
});
$('unlock').addEventListener('click', () => {
  project.locked = false;
  const last = project.issues[project.issues.length - 1]; if (last) last.reopened = true;
  $('proj-status').textContent = `Unlocked. Changes now form a draft of version ${project.issues.length + 1}.`;
  save(); renderAll();
});

// ---------- project details ----------
const DETAIL_FIELDS = { 'p-site': 'site', 'p-client': 'client', 'p-assessor': 'assessor', 'p-reviewer': 'reviewer', 'p-date': 'date', 'p-handling': 'handling', 'p-notes': 'notes' };
for (const [id, key] of Object.entries(DETAIL_FIELDS)) {
  $(id).addEventListener('change', (e) => { if (guard()) { renderDetailsForm(); return; } project.details[key] = e.target.value.trim(); save(); renderChecklist(); });
}
function renderDetailsForm() {
  for (const [id, key] of Object.entries(DETAIL_FIELDS)) if (document.activeElement !== $(id)) $(id).value = project.details[key] || '';
  for (const id of [...Object.keys(DETAIL_FIELDS), 'title', 'marking', 'marking-custom']) $(id).disabled = !!project.locked;
}

// ---------- required protection table ----------
function renderReq() {
  $('req-count').textContent = sections.length ? `${sections.length} section${sections.length === 1 ? '' : 's'}` : '';
  if (!sections.length) { $('req-table').innerHTML = '<p class="hint">Add a line of protection to see what each section of it must resist.</p>'; return; }
  const sel = selected?.kind === 'lop' ? selected.id : null;
  $('req-table').innerHTML = `<table><thead><tr><th>Section</th><th>Governing vector</th>${VEHICLES.map((v) => `<th title="${esc(v.name)}">${esc(v.name.split(' ')[0])}</th>`).join('')}</tr></thead><tbody>${sections.map((x) => `<tr data-sec="${x.label}" class="${x.lopId === sel ? 'sel' : ''}"><td><b>${x.label}</b> <small>${Math.round(x.length)} m</small></td><td>${x.governing ? `${esc(x.governing.name)} <small>${Math.round(x.governing.angle)}°</small>` : `<small>none yet</small>`}${x.pending ? ` <small class="bad" title="Suggestions crossing this section still need reviewing">${x.pending} to review</small>` : ''}</td>${VEHICLES.map((v) => `<td>${x.speeds[v.id] == null ? '–' : `${Math.round(conv(x.speeds[v.id]))}<br><small>${x.tests[v.id] ? `test ${x.tests[v.id]}` : `<span class="bad">above ${MAX_TEST_SPEED_KPH[v.id]}</span>`}</small>`}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="hint">Impact speeds in ${unitName()}; "test" is the lowest standard impact test speed (km/h) at or above it. Angles are the governing vector's impact angle (90° = head-on).</p>`;
  $('req-table').querySelectorAll('tr[data-sec]').forEach((tr) => { tr.onclick = () => { const x = sections.find((q) => q.label === tr.dataset.sec); selected = { kind: 'lop', id: x.lopId }; selectedVertex = null; const ll = toLL(midpointOf(x.points)); map.easeTo({ center: ll }); renderAll(); }; });
}
$('copy-req').addEventListener('click', async (e) => {
  if (!sections.length) { flash(e.target, false, '', 'Nothing to copy yet'); return; }
  flash(e.target, await copyRich(reqTable()));
});
function reqTable() {
  return reportTable({
    title: `${project.title ? project.title + ' – ' : ''}Required protection by section`, numericFrom: 2,
    headers: ['Section', 'Line of protection', 'Length (m)', 'Governing vector', 'Impact angle (°)', ...VEHICLES.map((v) => `${v.name}: impact ${unitName()} (test km/h)`)],
    rows: sections.map((x) => [x.label, x.lopName, Math.round(x.length), x.governing ? x.governing.name : 'none', x.governing ? Math.round(x.governing.angle) : '', ...VEHICLES.map((v) => (x.speeds[v.id] == null ? '' : `${Math.round(conv(x.speeds[v.id]))} (${x.tests[v.id] ?? `above ${MAX_TEST_SPEED_KPH[v.id]}`})`))]),
    notes: ['Figures come from the fastest accepted or drawn vector crossing each section. Test speed is the lowest standard impact test speed at or above the impact speed.', ...(project.marking ? [project.marking] : [])],
  });
}
const midpointOf = (pts) => {
  const total = polylineLength(pts); let run = 0;
  for (let i = 0; i < pts.length - 1; i++) { const L = dist(pts[i], pts[i + 1]); if (run + L >= total / 2) { const f = (total / 2 - run) / (L || 1); return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }; } run += L; }
  return pts[0];
};

// ---------- checklist ----------
function checklistItems() {
  const firm = project.vectors.filter((v) => v.status !== 'suggested' && v.status !== 'rejected' && results.get(v.id)?.speeds);
  const pending = project.vectors.filter((v) => v.status === 'suggested').length;
  const uncovered = sections.filter((x) => !x.governing).map((x) => x.label);
  const d = project.details, p = project.plan;
  const items = [
    { required: true, state: project.assets.length ? 'ok' : 'todo', text: project.assets.length ? `Asset: ${project.assets.map((a) => a.name).join(', ')}` : 'Add the asset (tap its building or draw it)', go: 'sec-draw' },
    { required: true, state: project.lops.length ? 'ok' : 'todo', text: project.lops.length ? `Line of protection: ${sections.length} section${sections.length === 1 ? '' : 's'}` : 'Add a line of protection', go: 'sec-draw' },
    { required: false, state: project.osm || project.obstacles.length ? 'ok' : 'todo', text: project.osm ? 'Buildings, walls and roads loaded' : project.obstacles.length ? 'Obstacles drawn' : 'Load buildings and roads, or draw obstacles', go: 'sec-draw' },
  ];
  if (p) items.push({ required: true, state: !p.scale ? 'todo' : !p.check ? 'warn' : Math.abs(p.check.errPct) > 2 ? 'warn' : 'ok', text: !p.scale ? 'Set the site plan\'s scale' : !p.check ? 'Check the plan scale with a second measurement' : `Plan scale checked (${p.check.errPct > 0 ? '+' : ''}${p.check.errPct.toFixed(1)} %)`, go: 'sec-plan' });
  items.push(
    { required: true, state: firm.length ? 'ok' : 'todo', text: firm.length ? `${firm.length} vector${firm.length === 1 ? '' : 's'} accepted or drawn` : 'Find attack vectors or draw them', go: 'sec-vectors' },
    { required: true, state: pending ? 'warn' : 'ok', text: pending ? `${pending} suggestion${pending === 1 ? '' : 's'} still to accept or reject` : 'All suggestions reviewed', go: 'sec-vectors' },
    { required: true, state: !sections.length ? 'todo' : uncovered.length ? 'warn' : 'ok', text: !sections.length ? 'Every section covered by a vector' : uncovered.length ? `No accepted vector crosses section${uncovered.length === 1 ? '' : 's'} ${uncovered.join(', ')}` : 'Every section of the line has a governing vector', go: 'sec-req' },
    { required: true, state: project.title && d.site && d.client && d.assessor ? 'ok' : 'todo', text: project.title && d.site && d.client && d.assessor ? 'Project details complete' : 'Fill in title, site, client and assessor', go: 'sec-project' },
    { required: true, state: project.marking ? 'ok' : 'todo', text: project.marking ? `Marking: ${project.marking}` : 'Choose a protective marking', go: 'sec-project' },
    { required: false, state: d.reviewer ? 'ok' : 'todo', text: d.reviewer ? `Reviewer: ${d.reviewer}` : 'Name a reviewer', go: 'sec-project' },
    { required: false, state: project.locked ? 'ok' : 'todo', text: project.locked ? `Issued as version ${project.issues.length}` : 'Issue the version when it is final', go: 'sec-project' },
  );
  return items;
}
function renderChecklist() {
  const items = checklistItems();
  const done = items.filter((c) => c.state === 'ok').length;
  $('ck-score').textContent = `${done} of ${items.length}`;
  $('check-items').innerHTML = items.map((c, i) => `<li class="${c.state === 'ok' ? 'ok' : c.state === 'warn' ? 'warn2' : 'todo'}"><span aria-hidden="true">${c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : '○'}</span><button data-go="${c.go}" data-i="${i}">${esc(c.text)}</button></li>`).join('');
  $('check-items').querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { const el = $(b.dataset.go); if (el.tagName === 'DETAILS') el.open = true; el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }; });
}

const capsText = (v) => (v.caps || []).map((c) => (c.type === 'stop' ? 'forced stop' : `${(CAP_TYPES[c.type] || 'limit').toLowerCase()} ≤${Math.round(conv(c.kph))} ${unitName()}`)).join('; ');

// ---------- report ----------
// Frames the site, takes a clean snapshot of the map with labels drawn in, stores it, then opens
// the report page, which builds the report from the saved project.
$('report').addEventListener('click', async () => {
  if (!frame || (!project.assets.length && !project.lops.length)) { $('proj-status').textContent = 'Add an asset and a line of protection first.'; return; }
  const btn = $('report'); btn.disabled = true; $('proj-status').textContent = 'Preparing the map for the report…';
  try {
    const blob = await captureMap('all');
    if (blob) await putBlob(`report-map:${project.id}`, blob); else await deleteBlob(`report-map:${project.id}`);
    const site = await captureMap('site');
    if (site) await putBlob(`report-map-site:${project.id}`, site); else await deleteBlob(`report-map-site:${project.id}`);
    saveJSON(KEY_PROJECT, project);
    location.href = 'report.html';
  } catch (e) {
    $('proj-status').textContent = `Could not prepare the map image (${e.message}). Opening the report without it.`;
    saveJSON(KEY_PROJECT, project);
    setTimeout(() => { location.href = 'report.html'; }, 1200);
  } finally { btn.disabled = false; }
});
async function captureMap(focus) {
  const firm = project.vectors.filter((v) => v.status !== 'suggested' && v.status !== 'rejected');
  const sitePts = [...project.assets.flatMap((a) => a.points), ...project.lops.flatMap((l) => l.points)];
  // 'site' is a close-up of the asset and its lines of protection, with a 30 m margin.
  const pad = focus === 'site' && sitePts.length ? [{ x: Math.min(...sitePts.map((q) => q.x)) - 30, y: Math.min(...sitePts.map((q) => q.y)) - 30 }, { x: Math.max(...sitePts.map((q) => q.x)) + 30, y: Math.max(...sitePts.map((q) => q.y)) + 30 }] : [];
  const pts = focus === 'site' ? [...sitePts, ...pad] : [...sitePts, ...firm.flatMap((v) => results.get(v.id)?.crossing?.points || v.points)];
  if (!pts.length) return null;
  const lls = pts.map(toLL);
  const bounds = [[Math.min(...lls.map((p) => p[0])), Math.min(...lls.map((p) => p[1]))], [Math.max(...lls.map((p) => p[0])), Math.max(...lls.map((p) => p[1]))]];
  const prevSel = selected, prevView = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing() };
  selected = null; selectedVertex = null; renderAll();
  const hide = ['path-sugg', 'path-rej', 'raw', 'handles', 'mids', 'snap', 'temp-line', 'temp-pts', 'picks'];
  hide.forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', 'none'));
  // Reports are printed: use the light map style and draw casings only for firm vectors.
  const casingFilter = map.getFilter('path-casing');
  map.setFilter('path-casing', ['==', ['get', 'status'], 'firm']);
  map.setPaintProperty('bg', 'background-color', '#f3f4f6');
  map.setPaintProperty('asset-casing', 'line-color', '#ffffff');
  map.fitBounds(bounds, { padding: 70, duration: 0, maxZoom: 19, bearing: 0 });
  await Promise.race([new Promise((r) => map.once('idle', r)), new Promise((r) => setTimeout(r, 8000))]);
  const shot = await new Promise((resolve) => { map.once('render', () => { try { resolve(map.getCanvas().toDataURL('image/png')); } catch { resolve(null); } }); map.triggerRepaint(); });
  // Compose: map image plus labels, scale bar and north arrow (HTML labels are not in the canvas).
  const canvas = map.getCanvas(), W = canvas.width, H = canvas.height, k = W / canvas.clientWidth;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  if (shot) { const img = new Image(); await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = shot; }); g.drawImage(img, 0, 0); }
  const tag = (ll, text, colour, fg = '#111', fill = '#fff') => {
    const q = map.project(ll); g.font = `bold ${12 * k}px system-ui, sans-serif`;
    const w = g.measureText(text).width + 10 * k, h = 18 * k, x = q.x * k - w / 2, y = q.y * k - h / 2;
    g.fillStyle = fill; g.strokeStyle = colour; g.lineWidth = 2 * k; g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, 4 * k) : g.rect(x, y, w, h); g.fill(); g.stroke();
    g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, x + 5 * k, y + h / 2);
  };
  for (const a of project.assets) tag(toLL(labelPoint(a.points)), a.name, ASSET_COLOUR, '#fff', ASSET_COLOUR);
  for (const x of sections) tag(toLL(midpointOf(x.points)), x.worst != null ? `${x.label} · ${Math.round(conv(x.worst))}` : x.label, x.worst != null ? bandColour(x.worst) : '#888');
  for (const v of firm) { const r = results.get(v.id); if (r?.speeds) tag(toLL(r.crossing.points[0]), v.name, bandColour(r.worst)); }
  for (const v of firm) for (const c of v.caps || []) tag(toLL(c.point), c.type === 'stop' ? 'STOP' : `≤${Math.round(conv(c.kph))}`, '#fbbf24', '#fff', '#111827');
  // Scale bar (a round number of metres about a fifth of the width) and north arrow.
  const mpp = metresPerPixel() / k, target = (W / 5) * mpp, pow = 10 ** Math.floor(Math.log10(target));
  const len = [1, 2, 5, 10].map((m) => m * pow).filter((m) => m <= target).pop() || pow, px = len / mpp;
  g.fillStyle = '#fff'; g.fillRect(16 * k, H - 44 * k, px + 24 * k, 30 * k);
  g.fillStyle = '#111'; g.fillRect(28 * k, H - 24 * k, px, 4 * k);
  g.font = `${12 * k}px system-ui, sans-serif`; g.fillText(`${len} m`, 28 * k, H - 32 * k);
  const nx = W - 36 * k, ny = 22 * k;
  g.fillStyle = '#ffffffdd'; g.beginPath(); g.arc(nx, ny + 18 * k, 26 * k, 0, 2 * Math.PI); g.fill(); g.fillStyle = '#111';
  g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx - 9 * k, ny + 26 * k); g.lineTo(nx, ny + 20 * k); g.lineTo(nx + 9 * k, ny + 26 * k); g.closePath(); g.fill();
  g.font = `bold ${12 * k}px system-ui, sans-serif`; g.fillText('N', nx - 4 * k, ny + 40 * k);
  hide.forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', 'visible'));
  map.setFilter('path-casing', casingFilter); applyMapTheme();
  map.jumpTo(prevView); selected = prevSel; renderAll();
  return new Promise((r) => out.toBlob(r, 'image/png'));
}

// First render of the side panel, once everything above is defined.
renderKey(); renderProject(); renderLock();
