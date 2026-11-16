// Compare NPSA tool results (CSV from docs/verification/npsa-check.md) with this tool.
// Run: npm run verify:compare [-- path/to/results.csv]
import { readFileSync } from 'node:fs';
import { VEHICLES } from '../src/maths.js';
import { CASES, expected } from './npsa-cases.mjs';

export function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('```'));
  const split = (l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()).filter((_, i, a) => i < a.length - 1 || a[i] !== '');
  const header = split(rows[0]);
  return rows.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [header[i], v])));
}

export function compare(rows, tolerance = 1) {
  const out = [];
  for (const r of rows) {
    const c = CASES.find((x) => x.id === (r.case || '').toUpperCase());
    const start = /roll/i.test(r.start) ? 'ROLLING' : /stand/i.test(r.start) ? 'STANDING' : null;
    if (!c || !start) { out.push({ case: r.case, start: r.start, problem: 'unknown case or start' }); continue; }
    const e = expected(c, start);
    VEHICLES.forEach((v, i) => {
      const key = Object.keys(r).find((k) => k === v.name) || Object.keys(r)[2 + i];
      const got = parseFloat(String(r[key]).replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(got)) { out.push({ case: c.id, start, vehicle: v.name, problem: `no number (“${r[key]}”)` }); return; }
      const diff = got - e[v.id];
      out.push({ case: c.id, start, vehicle: v.name, npsa: got, ours: +e[v.id].toFixed(2), diff: +diff.toFixed(2), ok: Math.abs(diff) <= tolerance });
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] || new URL('../docs/verification/npsa-results.csv', import.meta.url);
  const res = compare(parseCsv(readFileSync(file, 'utf8')));
  const bad = res.filter((x) => !x.ok);
  for (const x of bad) console.log(x.problem ? `${x.case} ${x.start} ${x.vehicle || ''}: ${x.problem}` : `${x.case} ${x.start} ${x.vehicle}: NPSA ${x.npsa}, ours ${x.ours} (diff ${x.diff > 0 ? '+' : ''}${x.diff})`);
  console.log(`${res.length - bad.length} of ${res.length} values match within 1 km/h.`);
  process.exitCode = bad.length ? 1 : 0;
}
