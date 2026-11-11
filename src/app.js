import { VEHICLES, KPH_PER_MPH, MAX_RADIUS, buildRouteSpeeds, chartSeries, validateSection } from './maths.js';
import { buildSketch } from './sketch.js';

const KEY = 'vda-tool-state-v1';
const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = { sections: [], counter: 1, start: 'ROLLING', unit: 'KPH', title: '' };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* ignore */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } };

const newSection = (o = {}) => ({ id: state.counter++, sType: 'STRAIGHT', sLength: 0, radius: MAX_RADIUS, description: '', ...o });
if (!state.sections.length) state.sections.push(newSection());

const isCurve = (s) => s.sType !== 'STRAIGHT';
const conv = (kph) => (state.unit === 'MPH' ? kph / KPH_PER_MPH : kph);
const fmtDist = (d) => (Math.round(d * 10) / 10).toString();

// ---------- data entry ----------
function renderRows(focus) {
  $('rows').innerHTML = state.sections.map((s, i) => `
    <div class="row" data-i="${i}">
      <select data-f="sType" aria-label="Section type">
        <option value="STRAIGHT"${s.sType === 'STRAIGHT' ? ' selected' : ''}>Straight</option>
        <option value="CURVE_LEFT"${s.sType === 'CURVE_LEFT' ? ' selected' : ''}>Left curve</option>
        <option value="CURVE_RIGHT"${s.sType === 'CURVE_RIGHT' ? ' selected' : ''}>Right curve</option></select>
      <input data-f="description" placeholder="Description (optional)" value="${esc(s.description)}">
      <input data-f="sLength" type="number" min="0" step="any" placeholder="Length (m)" aria-label="Length in metres" value="${s.sLength}">
      ${isCurve(s) ? `<input data-f="radius" type="number" min="0" max="${MAX_RADIUS}" step="any" placeholder="Radius (m)" aria-label="Radius in metres" value="${s.radius}">` : '<span></span>'}
      <span class="btns">
        <button data-a="up" title="Move up (towards asset)">↑</button><button data-a="down" title="Move down">↓</button>
        <button data-a="del" title="Delete">✕</button></span>
      <div class="err" hidden></div>
    </div>`).join('');
  state.sections.forEach((_, i) => showErrors(i));
  if (focus) $('rows').querySelector(`.row[data-i="${focus.i}"] [data-f="${focus.f}"]`)?.focus();
}

function showErrors(i) {
  const row = $('rows').querySelector(`.row[data-i="${i}"]`);
  if (!row) return;
  const errs = validateSection(state.sections[i]);
  row.querySelectorAll('input').forEach((inp) => inp.classList.toggle('invalid', !!errs[inp.dataset.f]));
  const e = row.querySelector('.err');
  e.textContent = Object.values(errs).join('. ');
  e.hidden = !e.textContent;
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.sections.length) return false;
  [state.sections[i], state.sections[j]] = [state.sections[j], state.sections[i]];
  return true;
}
function remove(i) {
  state.sections.splice(i, 1);
  if (!state.sections.length) state.sections.push(newSection());
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
    if (i === state.sections.length - 1) { state.sections.push(newSection()); renderRows({ i: i + 1, f: 'sLength' }); update(); }
    else $('rows').querySelector(`.row[data-i="${i + 1}"] [data-f="sLength"]`).focus();
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    if (move(i, e.key === 'ArrowUp' ? -1 : 1)) { renderRows({ i: i + (e.key === 'ArrowUp' ? -1 : 1), f }); update(); }
  } else if (e.altKey && e.key === 'Delete') {
    e.preventDefault(); remove(i); renderRows({ i: Math.min(i, state.sections.length - 1), f }); update();
  }
});
$('add').onclick = () => { state.sections.push(newSection()); renderRows({ i: state.sections.length - 1, f: 'sLength' }); update(); };
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

// ---------- settings ----------
document.querySelectorAll('input[name="unit"],input[name="start"]').forEach((r) => {
  r.checked = state[r.name === 'unit' ? 'unit' : 'start'] === r.value;
  r.onchange = () => { state[r.name === 'unit' ? 'unit' : 'start'] = r.value; update(); };
});
$('title').value = state.title;
$('title').oninput = (e) => { state.title = e.target.value; update(); };
$('print').onclick = () => window.print();

// ---------- outputs ----------
const el = (name, attrs = {}, text) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

function renderSketch(sections) {
  const svg = $('sketch');
  svg.replaceChildren();
  $('caption').innerHTML = '&nbsp;';
  const sk = buildSketch(sections);
  svg.setAttribute('viewBox', sk.viewBox);
  const mk = (d, cls, seg) => {
    const p = el('path', { d, class: cls });
    p.addEventListener('mouseenter', () => { $('caption').textContent = seg.text; });
    p.addEventListener('mouseleave', () => { $('caption').innerHTML = '&nbsp;'; });
    p.addEventListener('focus', () => { $('caption').textContent = seg.text; });
    return p;
  };
  for (const seg of sk.segments) {
    const g = el('g'); g.appendChild(mk(seg.path, 'seg', seg)); g.appendChild(mk(seg.path, 'hit', seg));
    g.firstChild.appendChild(el('title', {}, seg.text));
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
}

function niceMax(v) {
  const step = v > 100 ? 20 : 10;
  return Math.max(step, Math.ceil(v / step) * step);
}

function renderChart(sections) {
  const pts = chartSeries(sections, state.start);
  const W = 800, H = 360, m = { l: 55, r: 15, t: 10, b: 45 };
  const maxD = Math.max(...pts.map((p) => p.distance), 1);
  const maxS = niceMax(Math.max(...pts.flatMap((p) => VEHICLES.map((v) => conv(p.speeds[v.id])))));
  const x = (d) => m.l + (1 - d / maxD) * (W - m.l - m.r);
  const y = (s) => H - m.b - (s / maxS) * (H - m.t - m.b);
  const unit = state.unit === 'MPH' ? 'mph' : 'km/h';
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Speed chart">`;
  for (let i = 0; i <= 5; i++) {
    const s = (maxS * i) / 5, d = (maxD * i) / 5;
    out += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(s)}" y2="${y(s)}" stroke="#e3e6ea"/><text x="${m.l - 6}" y="${y(s) + 4}" text-anchor="end" font-size="11">${Math.round(s)}</text>`;
    out += `<text x="${x(d)}" y="${H - m.b + 16}" text-anchor="middle" font-size="11">${Math.round(d)}</text>`;
  }
  out += `<text x="${(W + m.l) / 2}" y="${H - 8}" text-anchor="middle" font-size="12">Distance to asset (m)</text>`;
  out += `<text transform="translate(14 ${H / 2}) rotate(-90)" text-anchor="middle" font-size="12">Speed (${unit})</text>`;
  for (const v of VEHICLES) {
    out += `<polyline fill="none" stroke="${v.colour}" stroke-width="2" points="${pts.map((p) => `${x(p.distance).toFixed(1)},${y(conv(p.speeds[v.id])).toFixed(1)}`).join(' ')}"/>`;
    for (const p of pts.filter((q) => q.major)) {
      const sp = conv(p.speeds[v.id]);
      const tip = `${fmtDist(p.distance)} m to asset\n${v.name}${p.section?.description ? '\n' + p.section.description : ''}\n${Math.round(sp)} ${unit}`;
      out += `<circle cx="${x(p.distance).toFixed(1)}" cy="${y(sp).toFixed(1)}" r="4" fill="${v.colour}"><title>${esc(tip)}</title></circle>`;
    }
  }
  out += '</svg><div class="legend">' + VEHICLES.map((v) => `<span><i style="background:${v.colour}"></i>${esc(v.name)}</span>`).join('') + '</div>';
  $('chart').innerHTML = out;
}

function renderTable(sections) {
  const rows = buildRouteSpeeds(sections, state.start);
  const cell = (r, v) => Math.round(conv(r.exitSpeeds.get(v.id).speed));
  const body = rows.map((r, i) => {
    const label = r.section ? `${i + 1}. ${esc(r.section.description || ({ STRAIGHT: 'Straight', CURVE_LEFT: 'Left curve', CURVE_RIGHT: 'Right curve' })[r.section.sType])}` : 'Start';
    return `<tr><td>${fmtDist(r.distanceToAsset)} m</td><td>${label}</td>${VEHICLES.map((v) => `<td>${cell(r, v)}</td>`).join('')}</tr>`;
  }).join('');
  $('table').innerHTML = `<table><thead><tr><th>Distance to asset</th><th>Section</th>${VEHICLES.map((v) => `<th>${esc(v.name)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    <p class="hint">Speeds in ${state.unit === 'MPH' ? 'mph' : 'km/h'} at the asset-side end of each section.</p>`;
}

function update() {
  save();
  const bad = state.sections.some((s) => Object.keys(validateSection(s)).length);
  const warn = '<p class="warn">Fix the invalid route sections to update the results.</p>';
  $('print-title').textContent = state.title;
  $('print-summary').textContent = `Speeds in ${state.unit === 'MPH' ? 'miles per hour' : 'kilometres per hour'}; vehicles start ${state.start === 'ROLLING' ? 'at maximum speed (rolling start)' : 'stationary (standing start)'}.`;
  if (bad) { $('chart').innerHTML = $('table').innerHTML = warn; $('sketch').replaceChildren(); return; }
  renderSketch(state.sections); renderChart(state.sections); renderTable(state.sections);
}

renderRows();
update();
