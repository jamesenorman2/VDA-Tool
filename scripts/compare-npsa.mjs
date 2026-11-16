// Compare NPSA HOVVA results (CSV from docs/verification/npsa-check.md) with this tool.
// Run: npm run verify:compare [-- path/to/results.csv]
import { readFileSync } from 'node:fs';
import { parseCsv, compare } from './npsa-cases.mjs';

export { parseCsv, compare };

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] || new URL('../docs/verification/npsa-results.csv', import.meta.url);
  const res = compare(parseCsv(readFileSync(file, 'utf8')));
  const bad = res.filter((x) => !x.ok);
  for (const x of res.filter((r) => !r.exact)) console.log(x.problem ? `${x.case} ${x.start} ${x.vehicle || ''}: ${x.problem}` : `${x.case} ${x.start} ${x.vehicle}: HOVVA shows ${x.npsa}, this tool shows ${x.shown} (unrounded ${x.ours.toFixed(3)})`);
  console.log(`${res.filter((r) => r.exact).length} of ${res.length} displayed values identical; ${res.length - bad.length} within 1 km/h.`);
  process.exitCode = bad.length ? 1 : 0;
}
