// Map assessment page: basemap, plan overlay with calibration, drawing of asset / line of
// protection / vectors, and per-vector impact results from the existing engine.
/* global maplibregl */
import { VEHICLES, KPH_PER_MPH, MASS_KG, TEST_SPEEDS_KPH, nextTestSpeed, buildRouteSpeeds, startArg } from './maths.js';
import { VERSION } from './version.js';
import { mountThemeToggle } from './theme.js';
import { reportTable, copyRich, flash } from './copy.js';
import { newProject, newVector, resolveVector, pathLength } from './model.js';
import { makeFrame } from './frames.js';
import { planToLocal, localToPlan, scaleFromTwoPoints, rescale, checkError, measureOnPlan, fitSimilarity } from './calibrate.js';
import { putBlob, getBlob, deleteBlob, loadJSON, saveJSON, blobToDataURL, dataURLToBlob } from './store.js';

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
// The site-wide key comes from config.js (written at deploy from the MAPTILER_KEY setting in
// Vercel). A key saved in this browser overrides it; clearing the box goes back to the site key.
const SITE_KEY = (window.VDA_CONFIG && window.VDA_CONFIG.maptilerKey) || '';
let ownKey = ''; try { ownKey = localStorage.getItem(KEY_MAPTILER) || ''; } catch { /* ignore */ }
let mtKey = ownKey || SITE_KEY;
let results = new Map(); // vector id -> computed result

function blankProject() {
  return newProject({ anchor: null, plan: null, view: { center: [-1.5, 53.0], zoom: 5 }, vectorCounter: 1 });
}
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveJSON(KEY_PROJECT, project), 250); }
const isEmpty = () => !project.plan && !project.assets.length && !project.lops.length && !project.vectors.length;
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
  for (const id of ['asset', 'lop', 'raw', 'path', 'handles', 'temp', 'picks']) map.addSource(id, { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'asset-fill', type: 'fill', source: 'asset', paint: { 'fill-color': '#1d3557', 'fill-opacity': ['case', ['get', 'sel'], 0.35, 0.2] } });
  map.addLayer({ id: 'asset-line', type: 'line', source: 'asset', paint: { 'line-color': '#1d3557', 'line-width': 2 } });
  map.addLayer({ id: 'raw', type: 'line', source: 'raw', paint: { 'line-color': '#555', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'path-casing', type: 'line', source: 'path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['case', ['get', 'sel'], 9, 6] } });
  map.addLayer({ id: 'path', type: 'line', source: 'path', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'colour'], 'line-width': ['case', ['get', 'sel'], 6, 3.5] } });
  map.addLayer({ id: 'lop-line', type: 'line', source: 'lop', paint: { 'line-color': '#e63946', 'line-width': ['case', ['get', 'sel'], 7, 5] } });
  map.addLayer({ id: 'lop-dash', type: 'line', source: 'lop', paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [1, 1.5] } });
  map.addLayer({ id: 'temp-line', type: 'line', source: 'temp', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#e0a100', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'temp-pts', type: 'circle', source: 'temp', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#e0a100', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'handles', type: 'circle', source: 'handles', paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#1d3557', 'circle-stroke-width': 2.5 } });
  map.addLayer({ id: 'picks', type: 'circle', source: 'picks', paint: { 'circle-radius': 6, 'circle-color': ['get', 'colour'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  $('basemap').value = project.basemap || 'streets';
  setBasemap($('basemap').value);
  restorePlan().then(renderAll);
});

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
  map.addLayer({ id: 'plan', type: 'raster', source: 'plan', paint: { 'raster-opacity': project.plan.opacity ?? 0.7, 'raster-fade-duration': 0 } }, 'asset-fill');
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
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = async () => {
    ensureFrame(map.getCenter());
    const c = toLocal(map.getCenter());
    const b = map.getBounds();
    const viewW = Math.abs(toLocal(b.getNorthEast()).x - toLocal(b.getSouthWest()).x);
    const s = (viewW * 0.6) / img.naturalWidth; // first guess only; the plan is "not scaled" until set
    const T = { s, theta: 0, tx: 0, ty: 0 };
    const mid = planToLocal(T, { u: img.naturalWidth / 2, v: img.naturalHeight / 2 });
    T.tx = c.x - mid.x; T.ty = c.y - mid.y;
    if (planURL) URL.revokeObjectURL(planURL);
    planURL = url;
    project.plan = { name: file.name, w: img.naturalWidth, h: img.naturalHeight, placement: T, opacity: 0.7, scale: null, check: null, align: null };
    await putBlob(`plan:${project.id}`, file);
    save(); showPlan(); renderAll();
  };
  img.onerror = () => { $('proj-status').textContent = 'That file could not be read as an image.'; };
  img.src = url;
});
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

// ---------- drawing ----------
const DRAW_MIN = { asset: 3, lop: 2, vector: 2 };
document.querySelectorAll('[data-draw]').forEach((b) => b.addEventListener('click', () => {
  cancelMode();
  mode = { kind: 'draw', what: b.dataset.draw, points: [] };
  document.body.classList.add('drawing');
  map.doubleClickZoom.disable();
  b.classList.add('on');
  renderTemp();
}));
function cancelMode() {
  mode = null;
  document.body.classList.remove('drawing');
  document.querySelectorAll('[data-draw]').forEach((b) => b.classList.remove('on'));
  map.doubleClickZoom.enable();
  $('pick-box').hidden = true;
  setData('picks', EMPTY); setData('temp', EMPTY);
}
function drawClick(e) {
  const pts = mode.points;
  if (!pts.length) ensureFrame(e.lngLat); // never re-anchor mid-drawing: earlier points use the frame
  if (pts.length) {
    const last = map.project(toLL(pts[pts.length - 1]));
    if (Math.hypot(last.x - e.point.x, last.y - e.point.y) < 4) return; // second click of a double-click
  }
  pts.push(toLocal(e.lngLat));
  renderTemp();
}
function finishDraw() {
  const { what, points } = mode;
  if (points.length < DRAW_MIN[what]) { cancelMode(); return; }
  if (what === 'asset') { const a = { id: uid('ast'), name: `Asset ${project.assets.length + 1}`, points }; project.assets.push(a); selected = { kind: 'asset', id: a.id }; }
  if (what === 'lop') { const l = { id: uid('lop'), name: `Line ${project.lops.length + 1}`, points }; project.lops.push(l); selected = { kind: 'lop', id: l.id }; }
  if (what === 'vector') {
    const v = newVector({ name: `V${project.vectorCounter++}`, source: 'drawn', points, vertexOptions: [] });
    project.vectors.push(v); selected = { kind: 'vector', id: v.id };
  }
  cancelMode(); save(); renderAll();
}
let mouseLL = null;
function renderTemp() {
  if (!mode || mode.kind !== 'draw') return setData('temp', EMPTY);
  const coords = mode.points.map(toLL);
  const line = mouseLL ? [...coords, [mouseLL.lng, mouseLL.lat]] : coords;
  if (mode.what === 'asset' && line.length > 2) line.push(coords[0]);
  setData('temp', { type: 'FeatureCollection', features: [
    ...(line.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }] : []),
    ...coords.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })),
  ] });
}

map.on('click', (e) => {
  if (drag?.moved) return;
  if (mode?.kind === 'draw') return drawClick(e);
  if (mode?.kind === 'pick') return pickClick(e.lngLat);
  const hits = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: ['path', 'raw', 'lop-line', 'asset-fill'] });
  const f = hits[0];
  selected = f ? { kind: f.properties.kind, id: f.properties.id } : null;
  renderAll();
});
map.on('dblclick', (e) => { if (mode?.kind === 'draw') { e.preventDefault(); finishDraw(); } });
map.on('mousemove', (e) => {
  mouseLL = e.lngLat;
  if (mode?.kind === 'draw') renderTemp();
  if (drag) {
    drag.moved = true;
    const item = findItem(drag);
    item.points[drag.idx] = toLocal(e.lngLat);
    if (drag.kind === 'plan') return;
    renderAll(true);
  }
});
map.on('mouseenter', 'handles', () => { if (!mode) map.getCanvas().style.cursor = 'move'; });
map.on('mouseleave', 'handles', () => { map.getCanvas().style.cursor = ''; });
map.on('mousedown', 'handles', (e) => {
  if (mode) return;
  e.preventDefault();
  const p = e.features[0].properties;
  drag = { kind: p.kind, id: p.id, idx: p.idx, moved: false };
  map.dragPan.disable();
});
map.on('mouseup', () => {
  if (!drag) return;
  map.dragPan.enable();
  const moved = drag.moved;
  setTimeout(() => { drag = null; }, 0);
  if (moved) { save(); renderAll(); }
});
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if (mode?.kind === 'draw' && !typing) {
    if (e.key === 'Enter') { e.preventDefault(); finishDraw(); }
    if (e.key === 'Escape') cancelMode();
    if (e.key === 'Backspace') { e.preventDefault(); mode.points.pop(); renderTemp(); }
  } else if (mode?.kind === 'pick' && e.key === 'Escape') cancelMode();
  else if (!mode && !typing && selected && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteSelected(); }
});

const listOf = (kind) => (kind === 'vector' ? project.vectors : kind === 'lop' ? project.lops : project.assets);
const findItem = (ref) => ref && listOf(ref.kind).find((x) => x.id === ref.id);
function deleteSelected() {
  if (!selected) return;
  const list = listOf(selected.kind);
  const i = list.findIndex((x) => x.id === selected.id);
  if (i >= 0) list.splice(i, 1);
  if (selected.kind === 'lop') project.vectors.forEach((v) => { if (v.lopId === selected.id) v.lopId = null; });
  selected = null; save(); renderAll();
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

let tags = [];
function renderAll(fast) {
  if (!map.getSource('path')) return;
  results = new Map(project.vectors.map((v) => [v.id, compute(v)]));
  const sel = (kind, id) => !!selected && selected.kind === kind && selected.id === id;
  const line = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
  setData('asset', { type: 'FeatureCollection', features: frame ? project.assets.map((a) => ({ type: 'Feature', properties: { kind: 'asset', id: a.id, sel: sel('asset', a.id) }, geometry: { type: 'Polygon', coordinates: [[...a.points.map(toLL), toLL(a.points[0])]] } })) : [] });
  setData('lop', { type: 'FeatureCollection', features: frame ? project.lops.map((l) => line(l.points.map(toLL), { kind: 'lop', id: l.id, sel: sel('lop', l.id) })) : [] });
  const raw = [], path = [];
  for (const v of project.vectors) {
    const r = results.get(v.id);
    raw.push(line(v.points.map(toLL), { kind: 'vector', id: v.id }));
    if (r.speeds && r.pieces?.length) path.push(line(pathCoords(r.pieces), { kind: 'vector', id: v.id, sel: sel('vector', v.id), colour: bandColour(r.worst) }));
  }
  setData('raw', { type: 'FeatureCollection', features: raw });
  setData('path', { type: 'FeatureCollection', features: path });
  const item = findItem(selected);
  setData('handles', { type: 'FeatureCollection', features: item ? item.points.map((p, idx) => ({ type: 'Feature', properties: { kind: selected.kind, id: item.id, idx }, geometry: { type: 'Point', coordinates: toLL(p) } })) : [] });
  // Speed tags at each LoP crossing.
  tags.forEach((t) => t.remove()); tags = [];
  for (const v of project.vectors) {
    const r = results.get(v.id);
    if (!r.speeds) continue;
    const el = document.createElement('div');
    el.className = 'speed-tag'; el.style.setProperty('--c', bandColour(r.worst));
    el.textContent = `${v.name} · ${Math.round(conv(r.worst))}`;
    el.title = `${v.name}: up to ${Math.round(conv(r.worst))} ${unitName()} at the line of protection`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); selected = { kind: 'vector', id: v.id }; renderAll(); });
    tags.push(new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] }).setLngLat(toLL(r.crossing.point)).addTo(map));
  }
  if (fast) { renderDetail(); return; }
  renderPlanFacts(); renderList(); renderDetail(); renderProject();
}
function setData(id, data) { const s = map.getSource(id); if (s) s.setData(data); }

function renderList() {
  $('vec-count').textContent = project.vectors.length ? `${project.vectors.length}` : '';
  $('unit').value = project.settings.unit;
  $('vec-list').innerHTML = project.vectors.map((v) => {
    const r = results.get(v.id);
    const val = r?.speeds ? `${Math.round(conv(r.worst))} ${unitName()}` : '—';
    return `<li><button data-vec="${v.id}" class="${selected?.kind === 'vector' && selected.id === v.id ? 'sel' : ''}"><span class="sw" style="background:${r?.speeds ? bandColour(r.worst) : '#bbb'}"></span><span>${esc(v.name)}</span><span class="v">${val}</span></button></li>`;
  }).join('') || '<li class="hint">No vectors yet. Draw a line of protection, then a vector from where an attack could start, across the line.</li>';
}
$('vec-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-vec]'); if (!b) return;
  selected = { kind: 'vector', id: b.dataset.vec }; renderAll();
});
$('unit').addEventListener('change', (e) => { project.settings.unit = e.target.value; save(); renderAll(); });

function renderDetail() {
  const box = $('vec-detail');
  const item = findItem(selected);
  if (!item) { box.innerHTML = ''; return; }
  if (selected.kind !== 'vector') {
    box.innerHTML = `<h3>${esc(item.name)}</h3><p class="hint">${selected.kind === 'lop' ? 'Line of protection' : 'Asset'} with ${item.points.length} points. Drag a point to move it.</p><div class="btnrow"><button id="d-del" class="quiet">Delete</button></div>`;
    $('d-del').onclick = deleteSelected;
    return;
  }
  const v = item, r = results.get(v.id);
  let html = `<h3>${esc(v.name)}</h3>
    <label>Name <input id="d-name" value="${esc(v.name)}" maxlength="40"></label>
    <label>How the vehicle passes the start point <select id="d-start">
      <option value="STANDING"${v.start === 'STANDING' ? ' selected' : ''}>Standing start (from rest)</option>
      <option value="ENTRY"${v.start === 'ENTRY' ? ' selected' : ''}>Entry speed (already moving)</option>
      <option value="ROLLING"${v.start === 'ROLLING' ? ' selected' : ''}>Rolling start (already at top speed)</option></select></label>
    ${v.start === 'ENTRY' ? `<div class="entry">Entry speed <input id="d-entry" type="number" min="0" step="any" value="${v.entryKph ? +conv(v.entryKph).toFixed(1) : ''}" aria-label="Entry speed"> ${unitName()}</div>` : ''}
    <p class="hint">${v.start === 'STANDING' ? 'Start the vector where a vehicle can be stationary: a parking bay, loading area, queue, stop line or gate.' : v.start === 'ROLLING' ? 'Assumes an unlimited run-up before the start point. Most conservative; better to extend the vector back to a real stopping place and use a standing start.' : 'Use the speed a vehicle can reach on the road leading to the start point.'}</p>`;
  html += r.errors.map((m) => `<p class="err">${esc(m)}</p>`).join('');
  html += (r.warnings || []).map((m) => `<p class="wrn">${esc(m)}</p>`).join('');
  if (r.speeds) {
    html += `<dl class="facts"><dt>Run-up</dt><dd>${r.runUp.toFixed(1)} m</dd><dt>Impact angle</dt><dd>${r.crossing.angle.toFixed(0)}° (90° = head-on)</dd></dl>
    <table><thead><tr><th>Vehicle</th><th>${unitName()}</th><th>kJ</th><th>Test speed</th></tr></thead><tbody>${VEHICLES.map((c) => {
      const s = r.speeds[c.id], ke = 0.5 * MASS_KG[c.id] * (s / 3.6) ** 2 / 1000, t = nextTestSpeed(s);
      return `<tr><td>${esc(c.name)}</td><td>${Math.round(conv(s))}</td><td>${Math.round(ke).toLocaleString()}</td><td>${t ? `${t} km/h` : '&gt; 112 km/h'}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="hint">Test speed is the lowest standard impact test speed at or above the impact speed. Full ratings per standard come once the vehicle mapping is confirmed.</p>`;
  }
  const bends = (r.vertices || []);
  if (bends.length) {
    html += `<h3>Bends</h3>` + bends.map((b) => {
      const opt = v.vertexOptions?.[b.point];
      const info = b.straight ? 'sharp corner, no speed limit (radius would exceed 150 m)' : `${b.side.toLowerCase()} ${(b.theta * 180 / Math.PI).toFixed(0)}°, r ${b.radius.toFixed(1)} m${b.mode === 'max' ? ' (largest that fits)' : b.clamped ? ' (reduced to fit)' : ''}`;
      return `<div class="bend"><span>Point ${b.point + 1}: ${info}</span><input type="number" min="0" step="any" data-bend="${b.point}" placeholder="Largest fit" aria-label="Fixed radius at point ${b.point + 1} in metres" value="${opt?.mode === 'fixed' ? opt.radius : ''}"></div>`;
    }).join('') + '<p class="hint">Leave a radius blank for the largest that fits (worst case). Type a radius to fix it.</p>';
  }
  html += `<div class="btnrow"><button id="d-copy">Copy results for report</button><button id="d-calc">Open in route calculator</button><button id="d-del" class="quiet">Delete vector</button></div><p class="hint" id="d-calc-msg"></p>`;
  const focusId = document.activeElement?.id || document.activeElement?.dataset?.bend;
  box.innerHTML = html;
  if (focusId) (document.getElementById(focusId) || box.querySelector(`[data-bend="${focusId}"]`))?.focus();
  $('d-name').onchange = (e) => { v.name = e.target.value.trim() || v.name; save(); renderAll(); };
  $('d-start').onchange = (e) => { v.start = e.target.value; save(); renderAll(); };
  if ($('d-entry')) $('d-entry').onchange = (e) => { const x = parseFloat(e.target.value); v.entryKph = x > 0 ? (project.settings.unit === 'MPH' ? x * KPH_PER_MPH : x) : 0; save(); renderAll(); };
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
}
$('title').addEventListener('change', (e) => { project.title = e.target.value; save(); });
$('marking').addEventListener('change', (e) => {
  if (e.target.value === 'CUSTOM') { $('marking-custom').hidden = false; $('marking-custom').focus(); project.marking = $('marking-custom').value.trim() || null; }
  else project.marking = e.target.value || null;
  save(); renderProject();
});
$('marking-custom').addEventListener('change', (e) => { project.marking = e.target.value.trim() || null; save(); renderProject(); });
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
    selected = null; save(); showPlan();
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
  project = { ...blankProject(), view, basemap }; frame = null; selected = null;
  if (planURL) { URL.revokeObjectURL(planURL); planURL = null; }
  save(); showPlan(); renderAll(); $('proj-status').textContent = 'Started a new project.';
});

// ---------- legend ----------
$('legend').innerHTML = '<b>Worst-case impact speed</b>' + TEST_SPEEDS_KPH.map((t, i) => `<span><i style="background:${BAND_COLOURS[i]}"></i>≤ ${t} km/h</span>`).join('') + `<span><i style="background:${BAND_COLOURS[7]}"></i>&gt; 112 km/h</span>`;
renderKey(); renderProject();

// ---------- copy for report ----------
const startText = (v) => (v.start === 'STANDING' ? 'standing start (from rest)' : v.start === 'ENTRY' ? `entry speed ${Math.round(conv(v.entryKph || 0))} ${unitName()}` : 'rolling start (already at top speed)');
const titled = (t) => (project.title ? `${project.title} – ${t}` : t);
function vectorTable(v, r) {
  return reportTable({
    title: titled(`Vector ${v.name}: impact at the line of protection`), numericFrom: 1,
    headers: ['Vehicle', `Impact speed (${unitName()})`, 'Impact energy (kJ)', 'Next test speed (km/h)'],
    rows: VEHICLES.map((c) => { const sp = r.speeds[c.id]; const t = nextTestSpeed(sp); return [c.name, Math.round(conv(sp)), Math.round(0.5 * MASS_KG[c.id] * (sp / 3.6) ** 2 / 1000), t ?? '> 112']; }),
    notes: [`Run-up ${r.runUp.toFixed(1)} m; impact angle ${r.crossing.angle.toFixed(0)}° (90° = head-on); ${startText(v)}.`, ...(project.marking ? [project.marking] : [])],
  });
}
$('copy-all').addEventListener('click', async (e) => {
  const ok = project.vectors.map((v) => [v, results.get(v.id)]).filter(([, r]) => r?.speeds);
  if (!ok.length) { flash(e.target, false, '', 'No vectors with results yet'); return; }
  const t = reportTable({
    title: titled('Impact speeds at the line of protection'), numericFrom: 1,
    headers: ['Vector', 'Run-up (m)', 'Angle (°)', 'Start', ...VEHICLES.map((c) => `${c.name} (${unitName()})`)],
    rows: ok.map(([v, r]) => [v.name, r.runUp.toFixed(0), r.crossing.angle.toFixed(0), v.start === 'ENTRY' ? `Entry ${Math.round(conv(v.entryKph || 0))}` : v.start === 'STANDING' ? 'Standing' : 'Rolling', ...VEHICLES.map((c) => Math.round(conv(r.speeds[c.id])))]),
    notes: ['Maximum achievable speeds on a flat, level, dry surface; worst-case bend radii unless fixed by the assessor.', ...(project.marking ? [project.marking] : [])],
  });
  flash(e.target, await copyRich(t));
});
$('version').textContent = `v${VERSION}`;
mountThemeToggle($('theme'));
const bgColour = () => (document.documentElement.dataset.theme === 'light' ? '#eef0f2' : '#1a2026');
const applyMapTheme = () => { if (map.getLayer('bg')) map.setPaintProperty('bg', 'background-color', bgColour()); };
document.addEventListener('themechange', applyMapTheme);
map.on('load', applyMapTheme);
