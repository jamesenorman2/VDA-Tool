import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, buildBlocks } from '../src/report.js';
import { newProject, newVector } from '../src/model.js';
import { offsetPolygon } from '../src/geometry/polygon.js';

const P = (x, y) => ({ x, y });
const box = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];

test('report: summary, sections, vectors with features, rejected list and HOVVA appendix', () => {
  const asset = { id: 'a', name: 'HQ', points: box(-20, -10, 20, 10) };
  const lop = { id: 'l', name: 'Line 1', closed: true, points: offsetPolygon(asset.points, 10, 30, true) };
  const v1 = newVector({ name: 'V1', source: 'drawn', status: 'drawn', start: 'ROLLING', points: [P(-300, 0), P(-25, 0)], caps: [{ point: P(-100, 0), kph: 0, type: 'stop' }] });
  const v2 = newVector({ name: 'G2', source: 'generated', status: 'rejected', statusReason: 'Existing bollards', points: [P(0, 300), P(0, 15)] });
  const v3 = newVector({ name: 'G3', source: 'generated', status: 'suggested', points: [P(0, -300), P(0, -15)] });
  const p = newProject({ title: 'Test HQ', marking: 'OFFICIAL-SENSITIVE', assets: [asset], lops: [lop], vectors: [v1, v2, v3], details: { site: 'Somewhere', client: 'Client', assessor: 'A. Person', date: '2026-11-16' }, issues: [] });
  const A = analyse(p);
  assert.equal(A.firm.length, 1); assert.equal(A.pending.length, 1); assert.equal(A.rejected.length, 1);
  const B = buildBlocks(p, A, null);
  const text = JSON.stringify(B);
  assert.match(text, /The highest impact speed is \d+ km\/h/);
  assert.match(text, /forced stop/);
  assert.match(text, /Existing bollards/);
  assert.match(text, /1 automatically found vector has not been reviewed/);
  assert.match(text, /Appendix A\. Vector sections in HOVVA order/);
  // With a forced stop 75 m before the line (vector clipped at x = -30), V1 behaves as a standing start over 70 m.
  const sec = A.sections.find((s) => s.governing);
  assert.ok(sec && sec.speeds.CAR < 70, String(sec?.speeds.CAR));
});
