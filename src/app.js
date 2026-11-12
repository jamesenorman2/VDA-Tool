import { VEHICLES, KPH_PER_MPH, MAX_RADIUS, buildRouteSpeeds, chartSeries, validateSection } from './maths.js';
import { buildSketch } from './sketch.js';
import { parseQuickEntry } from './quickentry.js';

const KEY = 'vda-tool-state-v1';
const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// state.sections is always stored nearest-asset first (index 0). `order` only changes how it is
// displayed, numbered and extended: FROM_START shows the start of the route first, asset last.
let state = { sections: [], counter: 1, start: 'ROLLING', unit: 'KPH', order: 'FROM_START', title: '' };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } };

const newSection = (o = {}) => ({ id: state.counter++, sType: 'STRAIGHT', sLength: 0, radius: MAX_RADIUS, description: '', ...o });
if (!state.sections.length) state.sections.push(newSection());

const fromStart = () => state.order === 'FROM_START';
const n = () => state.sections.length;
const vis = (k) => (fromStart() ? n() - 1 - k : k); // visual position <-> array index (self-inverse)
const secNo = (i) => (fromStart() ? n() - i : i + 1); // section number in entry order
const lastIndex = () => (fromStart() ? 0 : n() - 1); // where a newly added row lands (visual bottom)
const addSection = (o) => { const s = newSection(o); if (fromStart()) state.sections.unshift(s); else state.sections.push(s); return lastIndex(); };
const isBlank = () => n() === 1 && state.sections[0].sType === 'STRAIGHT' && !state.sections[0].sLength && !state.sections[0].description;

const isCurve = (s) => s.sType !== 'STRAIGHT';
const conv = (kph) => (state.unit === 'MPH' ? kph / KPH_PER_MPH : kph);
const unitName = () => (state.unit === 'MPH' ? 'mph' : 'km/h');
const fmtDist = (d) => (Math.round(d * 10) / 10).toString();
const TYPE_NAME = { STRAIGHT: 'Straight', CURVE_LEFT: 'Left curve', CURVE_RIGHT: 'Right curve' };

let active = -1;
const describe = (s, i) => `Section ${secNo(i)}: ${s.description ? s.description + ' – ' : ''}${TYPE_NAME[s.sType].toLowerCase()}, ${s.sLength} m${isCurve(s) ? `, radius ${s.radius} m` : ''}`;
function setActive(i) {
  active = i;
  document.querySelectorAll('#rows .row').forEach((r) => r.classList.toggle('active', +r.dataset.i === i));
  document.querySelectorAll('#sketch g[data-i] .seg').forEach((p) => p.classList.toggle('active', +p.parentNode.dataset.i === i));
  $('caption').textContent = i >= 0 && state.sections[i] ? describe(state.sections[i], i) : ' ';
}
$('rows').addEventListener('focusin', (e) => { const r = e.target.closest('.row'); if (r) setActive(+r.dataset.i); });
$('rows').addEventListener('mouseover', (e) => { const r = e.target.closest('.row'); if (r && +r.dataset.i !== active) setActive(+r.dataset.i); });

// ---------- data entry ----------
function renderRows(focus) {
  $('m-top').textContent = fromStart() ? '▼ Start of approach route' : '▼ End of approach route (at asset)';
  $('m-bottom').textContent = fromStart() ? '▲ End of approach route (at asset)' : '▲ Start of approach route';
  let html = '';
  for (let k = 0; k < n(); k++) {
    const i = vis(k), s = state.sections[i];
    html += `
    <div class="row" data-i="${i}">
      <span class="num">${secNo(i)}</span>
      <select data-f="sType" aria-label="Section ${secNo(i)} type">
        <option value="STRAIGHT"${s.sType === 'STRAIGHT' ? ' selected' : ''}>Straight</option>
        <option value="CURVE_LEFT"${s.sType === 'CURVE_LEFT' ? ' selected' : ''}>Left curve</option>
        <option value="CURVE_RIGHT"${s.sType === 'CURVE_RIGHT' ? ' selected' : ''}>Right curve</option></select>
      <input data-f="description" placeholder="Description (optional)" value="${esc(s.description)}">
      <input data-f="sLength" type="number" min="0" step="any" placeholder="${isCurve(s) ? 'Arc length (m)' : 'Length (m)'}" aria-label="Length in metres" value="${s.sLength}">
      ${isCurve(s) ? `<input data-f="radius" type="number" min="0" max="${MAX_RADIUS}" step="any" placeholder="Radius (m)" aria-label="Radius in metres" value="${s.radius}">` : '<span></span>'}
      <span class="btns">
        <button data-a="up" title="Move up">↑</button><button data-a="down" title="Move down">↓</button>
        <button data-a="del" title="Delete">✕</button></span>
      <div class="info" hidden></div><div class="err" hidden></div>
    </div>`;
  }
  $('rows').innerHTML = html;
  state.sections.forEach((_, i) => showErrors(i));
  if (focus) $('rows').querySelector(`.row[data-i="${focus.i}"] [data-f="${focus.f}"]`)?.focus();
  setActive(active < n() ? active : -1);
}

function showErrors(i) {
  const row = $('rows').querySelector(`.row[data-i="${i}"]`);
  if (!row) return;
  const s = state.sections[i], errs = validateSection(s);
  row.querySelectorAll('input').forEach((inp) => inp.classList.toggle('invalid', !!errs[inp.dataset.f]));
  const e = row.querySelector('.err');
  e.textContent = Object.values(errs).join('. ');
  e.hidden = !e.textContent;
  const info = row.querySelector('.info');
  info.textContent = isCurve(s) && !Object.keys(errs).length ? `Turns ${(((s.sLength / s.radius) * 180) / Math.PI).toFixed(1)}° (arc length ÷ radius)` : '';
  info.hidden = !info.textContent;
}

function move(i, dir) { // dir is visual: -1 = up the list
  const j = vis(vis(i) + dir);
  if (vis(i) + dir < 0 || vis(i) + dir >= n()) return -1;
  [state.sections[i], state.sections[j]] = [state.sections[j], state.sections[i]];
  return j;
}
function remove(i) {
  state.sections.splice(i, 1);
  if (!n()) state.sections.push(newSection());
}

$('rows').addEventListener('input', (e) => {
  const f = e.target.dataset.f;
  if (!f || f === 'sType') return;
  const i = +e.target.closest('.row').dataset.i;
  state.sections[i][f] = f === 'description' ? e.target.value : e.target.value === '' ? NaN : +e.target.value;
  showErrors(i); update();
});
$('rows').addEventListener('change', (e) => {
  if (e.target.dataset.f !== 'sType') return;
  const i = +e.target.closest('.row').dataset.i;
  state.sections[i].sType = e.target.value;
  renderRows({ i, f: 'sType' }); update();
});
$('rows').addEventListener('click', (e) => {
  const a = e.target.dataset.a;
  if (!a) return;
  const i = +e.target.closest('.row').dataset.i;
  if (a === 'up') move(i, -1); else if (a === 'down') move(i, 1); else remove(i);
  renderRows(); update();
});
$('rows').addEventListener('keydown', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const i = +row.dataset.i, f = e.target.dataset.f;
  if (e.key === 'Enter' && f !== 'sType') {
    e.preventDefault();
    if (Object.keys(validateSection(state.sections[i])).length) return;
    if (vis(i) === n() - 1) { const ni = addSection(); renderRows({ i: ni, f: 'sLength' }); update(); }
    else $('rows').querySelector(`.row[data-i="${vis(vis(i) + 1)}"] [data-f="sLength"]`).focus();
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const j = move(i, e.key === 'ArrowUp' ? -1 : 1);
    if (j >= 0) { renderRows({ i: j, f }); update(); }
  } else if (e.altKey && e.key === 'Delete') {
    e.preventDefault(); remove(i); renderRows({ i: Math.min(i, n() - 1), f }); update();
  }
});
$('add').onclick = () => { const ni = addSection(); renderRows({ i: ni, f: 'sLength' }); update(); };
$('clear').onclick = () => {
  if (!confirm('Delete all route sections?')) return;
  state.sections = [newSection()]; renderRows(); update();
};
$('example').onclick = () => {
  if (!confirm('This replaces all current route sections with a random example. Continue?')) return;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const streets = ['High', 'Mill', 'Station', 'Church', 'Park', 'Bridge', 'King', 'Queen'];
  const kinds = ['Road', 'Street', 'Lane', 'Avenue', 'Way'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  state.sections = Array.from({ length: Math.floor(rnd(5, 21)) }, () => {
    const sType = pick(['STRAIGHT', 'CURVE_LEFT', 'CURVE_RIGHT']);
    const description = `${pick(streets)} ${pick(kinds)}`;
    if (sType === 'STRAIGHT') return newSection({ sType, description, sLength: Math.round(rnd(10, 200)) });
    const radius = Math.round(rnd(8, MAX_RADIUS));
    return newSection({ sType, description, radius, sLength: Math.round(rnd(5, Math.min(200, radius * Math.PI / 2))) });
  });
  renderRows(); update();
};

// ---------- quick entry & CSV ----------
function quickAdd() {
  const text = $('qe').value;
  if (!text.trim()) return;
  const { sections, notes, errors } = parseQuickEntry(text);
  const status = $('qe-status');
  if (sections.length) {
    if (isBlank()) state.sections = [];
    sections.forEach((s) => addSection(s));
    renderRows(); update();
  }
  // Keep only the lines that failed, so they can be corrected and re-submitted.
  $('qe').value = errors.length ? text.split(/\r?\n/).filter((l, ln) => errors.some((e) => e.startsWith(`Line ${ln + 1}:`))).join('\n') : '';
  status.className = errors.length ? 'hint err' : 'hint ok';
  const summary = (x) => `${TYPE_NAME[x.sType].toLowerCase()} ${x.sLength} m${x.sType !== 'STRAIGHT' ? `, radius ${x.radius} m` : ''}`;
  const shown = sections.slice(0, 3).map(summary).join('; ') + (sections.length > 3 ? `; …` : '');
  status.textContent = [sections.length ? `Added ${sections.length}: ${shown}.` : '', ...notes, ...errors].filter(Boolean).join(' ');
  $('rows').lastElementChild?.scrollIntoView({ block: 'nearest' });
}
$('qe').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); quickAdd(); }
});
$('qe').addEventListener('paste', () => setTimeout(() => { if (/\n.*\S/.test($('qe').value.trim())) quickAdd(); }, 0));

// Cells starting with = + - @ would be run as formulas by Excel/Sheets, so neutralise them.
const csvCell = (v) => {
  let t = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
function download(name, rows) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const entryOrder = () => (fromStart() ? [...state.sections].reverse() : state.sections);
$('export-sections').onclick = () => download('route-sections.csv', [['type', 'length_m', 'radius_m', 'description'],
  ...entryOrder().map((s) => [{ STRAIGHT: 's', CURVE_LEFT: 'l', CURVE_RIGHT: 'r' }[s.sType], s.sLength, isCurve(s) ? s.radius : '', s.description])]);
$('export-results').onclick = () => {
  const rows = tableRows();
  download('speeds.csv', [['Section', 'Description', 'Distance to asset (m)', ...VEHICLES.map((v) => `${v.name} (${unitName()})`)],
    ...rows.map((r) => [r.no, r.label, fmtDist(r.distance), ...VEHICLES.map((v) => Math.round(conv(r.speeds.get(v.id).speed)))])]);
};

// ---------- settings ----------
const KEYS = { unit: 'unit', start: 'start', order: 'order' };
document.querySelectorAll('input[name="unit"],input[name="start"],input[name="order"]').forEach((r) => {
  r.checked = state[KEYS[r.name]] === r.value;
  r.onchange = () => { state[KEYS[r.name]] = r.value; if (r.name === 'order') renderRows(); update(); };
});
$('title').value = state.title;
$('title').oninput = (e) => { state.title = e.target.value; update(); };
$('print').onclick = () => window.print();

// ---------- outputs ----------
const el = (name, attrs = {}, text) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
};

function renderSketch(sections) {
  const svg = $('sketch');
  svg.replaceChildren();
  const sk = buildSketch(sections);
  svg.setAttribute('viewBox', sk.viewBox);
  for (const seg of sk.segments) {
    const g = el('g', { 'data-i': seg.index });
    g.addEventListener('mouseenter', () => setActive(seg.index));
    g.appendChild(el('path', { d: seg.path, class: 'seg' }));
    g.appendChild(el('path', { d: seg.path, class: 'hit' }));
    g.firstChild.appendChild(el('title', {}, describe(sections[seg.index], seg.index)));
    svg.appendChild(g);
  }
  const f = sk.flag, a = sk.assetPoint, s = sk.startPoint;
  svg.appendChild(el('circle', { cx: s.x, cy: s.y, r: f / 2, fill: '#2a9d4b' }));
  svg.appendChild(el('text', { x: s.x, y: s.y - f * 0.65, 'text-anchor': 'middle', 'font-size': f * 0.8 }, 'Start'));
  const cell = f / 3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    svg.appendChild(el('rect', { x: a.x - f / 2 + c * cell, y: a.y - f / 2 + r * cell, width: cell, height: cell, fill: (r + c) % 2 ? '#fff' : '#000', stroke: '#000', 'stroke-width': f * 0.02 }));
  }
  svg.appendChild(el('text', { x: a.x, y: a.y + f * 1.3, 'text-anchor': 'middle', 'font-size': f * 0.8 }, 'Asset'));
  setActive(active < sections.length ? active : -1);
}

function niceMax(v) {
  const step = v > 1000 ? 500 : v > 100 ? 50 : 10;
  return Math.max(step, Math.ceil(v / step) * step);
}

function renderChart(sections) {
  const pts = chartSeries(sections, state.start);
  const W = 800, H = 360, m = { l: 55, r: 15, t: 10, b: 45 };
  const maxD = niceMax(Math.max(...pts.map((p) => p.distance), 1));
  const maxS = niceMax(Math.max(...pts.flatMap((p) => VEHICLES.map((v) => conv(p.speeds[v.id])))));
  const x = (d) => m.l + (1 - d / maxD) * (W - m.l - m.r);
  const y = (s) => H - m.b - (s / maxS) * (H - m.t - m.b);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Speed chart">`;
  for (let i = 0; i <= 5; i++) {
    const s = (maxS * i) / 5, d = (maxD * i) / 5;
    out += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(s)}" y2="${y(s)}" stroke="#e3e6ea"/><text x="${m.l - 6}" y="${y(s) + 4}" text-anchor="end" font-size="11">${Math.round(s)}</text>`;
    out += `<text x="${x(d)}" y="${H - m.b + 16}" text-anchor="middle" font-size="11">${Math.round(d)}</text>`;
  }
  out += `<text x="${(W + m.l) / 2}" y="${H - 8}" text-anchor="middle" font-size="12">Distance to asset (m)</text>`;
  out += `<text transform="translate(14 ${H / 2}) rotate(-90)" text-anchor="middle" font-size="12">Speed (${unitName()})</text>`;
  for (const v of VEHICLES) {
    out += `<polyline fill="none" stroke="${v.colour}" stroke-width="2" points="${pts.map((p) => `${x(p.distance).toFixed(1)},${y(conv(p.speeds[v.id])).toFixed(1)}`).join(' ')}"/>`;
    for (const p of pts.filter((q) => q.major)) {
      const sp = conv(p.speeds[v.id]);
      const tip = `${fmtDist(p.distance)} m to asset\n${v.name}${p.section?.description ? '\n' + p.section.description : ''}\n${Math.round(sp)} ${unitName()}`;
      out += `<circle cx="${x(p.distance).toFixed(1)}" cy="${y(sp).toFixed(1)}" r="4" fill="${v.colour}"><title>${esc(tip)}</title></circle>`;
    }
  }
  out += '</svg><div class="legend">' + VEHICLES.map((v) => `<span><i style="background:${v.colour}"></i>${esc(v.name)}</span>`).join('') + '</div>';
  $('chart').innerHTML = out;
}

// Table rows in entry order: the start of the route first when entering from the start.
function tableRows() {
  const rows = buildRouteSpeeds(state.sections, state.start);
  const list = rows.map((r, i) => (r.section
    ? { no: secNo(i), label: r.section.description || TYPE_NAME[r.section.sType], distance: r.distanceToAsset, speeds: r.exitSpeeds }
    : { no: '', label: 'Start of route', distance: r.distanceToAsset, speeds: r.exitSpeeds }));
  return fromStart() ? list.reverse() : list;
}

function renderTable() {
  const body = tableRows().map((r) => `<tr><td>${fmtDist(r.distance)} m</td><td>${r.no ? r.no + '. ' : ''}${esc(r.label)}</td>${VEHICLES.map((v) => `<td>${Math.round(conv(r.speeds.get(v.id).speed))}</td>`).join('')}</tr>`).join('');
  $('table').innerHTML = `<table><thead><tr><th>Distance to asset</th><th>Section</th>${VEHICLES.map((v) => `<th>${esc(v.name)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    <p class="hint">Speeds in ${unitName()} at the asset-side end of each section; the first and last rows are the start of the route and the asset.</p>`;
}

function renderCards(sections) {
  const r = buildRouteSpeeds(sections, state.start)[0];
  $('cards').innerHTML = VEHICLES.map((v) => `<div class="card" style="--c:${v.colour}"><b>${Math.round(conv(r.exitSpeeds.get(v.id).speed))} ${unitName()}</b><span>${esc(v.name)}</span></div>`).join('');
  $('total').textContent = `· route length ${fmtDist(sections.reduce((t, s) => t + s.sLength, 0))} m`;
}

function update() {
  save();
  const bad = state.sections.some((s) => Object.keys(validateSection(s)).length);
  $('print-title').textContent = state.title;
  $('print-summary').textContent = `Speeds in ${state.unit === 'MPH' ? 'miles per hour' : 'kilometres per hour'}; vehicles start ${state.start === 'ROLLING' ? 'at maximum speed (rolling start)' : 'stationary (standing start)'}.`;
  if (bad) {
    $('cards').innerHTML = '';
    $('chart').innerHTML = $('table').innerHTML = '<p class="warn">Fix the invalid route sections to update the results.</p>';
    $('sketch').replaceChildren();
    return;
  }
  renderCards(state.sections); renderSketch(state.sections); renderChart(state.sections); renderTable();
}

renderRows();
update();
