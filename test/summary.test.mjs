import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLop, requiredProtection, draftDesignation } from '../src/summary.js';
import { offsetPolygon } from '../src/geometry/polygon.js';
import { newProject, newVector, resolveVector } from '../src/model.js';
import { buildRouteSpeeds, VEHICLES } from '../src/maths.js';

const P = (x, y) => ({ x, y });
const box = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];

test('a standoff loop round a rectangle splits into its four sides (rounded corners join them)', () => {
  const lop = { id: 'L', closed: true, points: offsetPolygon(box(-20, -10, 20, 10), 10, 30, true) };
  const secs = splitLop(lop);
  assert.equal(secs.length, 4);
  const total = secs.reduce((t, s) => t + s.length, 0);
  assert.ok(Math.abs(total - lop.points.reduce((t, p, i) => t + Math.hypot(lop.points[(i + 1) % lop.points.length].x - p.x, lop.points[(i + 1) % lop.points.length].y - p.y), 0)) < 1e-6);
  // Every edge belongs to exactly one section.
  assert.deepEqual(secs.flatMap((s) => s.edges).sort((a, b) => a - b), lop.points.map((_, i) => i));
});

test('an open line splits at a sharp corner but not at a gentle bend', () => {
  assert.equal(splitLop({ points: [P(0, 0), P(50, 0), P(100, 10)] }).length, 1);
  assert.equal(splitLop({ points: [P(0, 0), P(50, 0), P(50, 50)] }).length, 2);
});

test('required protection: fastest firm vector governs; suggestions are counted but not used', () => {
  const lop = { id: 'L', name: 'Line 1', closed: false, points: [P(0, 0), P(0, 100)] };
  const p = newProject({ lops: [lop] });
  const mk = (status, len) => { const v = newVector({ source: 'drawn', status, points: [P(-len, 50), P(10, 50)] }); const r = resolveVector(p, v); const sp = buildRouteSpeeds(r.sections, 'STANDING')[0].exitSpeeds; const speeds = Object.fromEntries(VEHICLES.map((c) => [c.id, sp.get(c.id).speed])); return { vector: { ...v, name: status }, result: { ...r, speeds, worst: Math.max(...Object.values(speeds)) } }; };
  const sec = requiredProtection([lop], [mk('drawn', 50), mk('accepted', 120), mk('suggested', 400), mk('rejected', 400)]);
  assert.equal(sec.length, 1);
  assert.equal(sec[0].label, 'A');
  assert.equal(sec[0].governing.name, 'accepted');
  assert.equal(sec[0].pending, 1); assert.equal(sec[0].rejected, 1);
  assert.equal(sec[0].tests.CAR, 80); // 120 m standing: car ≈ 79 km/h → 80 km/h test speed
  assert.equal(draftDesignation('SEVENTRIGID', 48), 'V/7500[N2]/48/90');
});

test('each section is one continuous stretch of the line', () => {
  for (const poly of [box(-20, -10, 20, 10), [P(0, 0), P(30, 0), P(30, 10), P(10, 10), P(10, 30), P(0, 30)]]) {
    const lop = { closed: true, points: offsetPolygon(poly, 10, 30, true) };
    const n = lop.points.length;
    for (const s of splitLop(lop)) for (let k = 1; k < s.edges.length; k++) assert.equal(s.edges[k], (s.edges[k - 1] + 1) % n, JSON.stringify(s.edges));
  }
});

test('test speeds respect ISO 22343-1 Table 5: trucks up to 80, flatbed up to 96, car and pick-up up to 112', async () => {
  const { nextTestSpeed, testSpeedText } = await import('../src/maths.js');
  assert.equal(nextTestSpeed(80.3, 'SEVENTRIGID'), null); // 7.5 t at its top speed: no truck test above 80
  assert.equal(testSpeedText(80.3, 'SEVENTRIGID'), 'above 80');
  assert.equal(nextTestSpeed(64.1, 'EIGHTEENTRIGID'), 80);
  assert.equal(nextTestSpeed(92, 'FLATBED'), 96);
  assert.equal(nextTestSpeed(97, 'FLATBED'), null);
  assert.equal(nextTestSpeed(97.4, 'PICKUP'), 112);
  assert.equal(nextTestSpeed(124.9, 'CAR'), null);
  assert.equal(draftDesignation('THIRTYTRIGID', null), 'no test above 80 km/h');
});
