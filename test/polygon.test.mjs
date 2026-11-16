import test from 'node:test';
import assert from 'node:assert/strict';
import { area, perimeter, centroid, pointInPolygon, offsetPolygon, minDistance, simplify, rectangleFrom, nearestOnPolyline, segmentHitsPolygon } from '../src/geometry/polygon.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const P = (x, y) => ({ x, y });
const square = [P(0, 0), P(20, 0), P(20, 20), P(0, 20)];

test('area, perimeter, centroid, point in polygon', () => {
  close(area(square), 400); close(perimeter(square), 80);
  const c = centroid(square); close(c.x, 10); close(c.y, 10);
  assert.ok(pointInPolygon(P(5, 5), square)); assert.ok(!pointInPolygon(P(25, 5), square));
});

test('outward offset keeps a constant standoff in either winding', () => {
  for (const poly of [square, [...square].reverse()]) {
    const o = offsetPolygon(poly, 10);
    close(minDistance(o, true, poly, true), 10, 0.02);
    for (const p of o) assert.ok(!pointInPolygon(p, poly));
    // Rounded corners: every offset point is 10 m from the square.
    for (const p of o) close(nearestOnPolyline(p, poly, true).d, 10, 1e-6);
  }
});

test('offset of an L-shaped building handles the concave corner', () => {
  const L = [P(0, 0), P(30, 0), P(30, 10), P(10, 10), P(10, 30), P(0, 30)];
  const o = offsetPolygon(L, 5);
  close(minDistance(o, true, L, true), 5, 0.01);
  assert.ok(o.some((p) => Math.abs(p.x - 15) < 1e-6 && Math.abs(p.y - 15) < 1e-6)); // miter at the inner corner
});

test('simplify drops near-collinear points; rectangle from two corners and a depth', () => {
  const s = simplify([P(0, 0), P(10, 0.1), P(20, -0.1), P(30, 0), P(30, 30)], 0.5);
  assert.deepEqual(s, [P(0, 0), P(30, 0), P(30, 30)]);
  const r = rectangleFrom(P(0, 0), P(10, 0), P(3, 4));
  close(area(r), 40);
  assert.ok(segmentHitsPolygon(P(-5, 2), P(15, 2), r));
  assert.ok(!segmentHitsPolygon(P(-5, 6), P(15, 6), r));
});

test('Overpass response: closed building rings lose their repeated point; steps are not roads', async () => {
  const { parseOverpass } = await import('../src/osm.js');
  const g = (pts) => pts.map(([lon, lat]) => ({ lon, lat }));
  const r = parseOverpass({ elements: [
    { type: 'way', id: 1, tags: { building: 'yes' }, geometry: g([[0, 0], [1, 0], [1, 1], [0, 0]]) },
    { type: 'way', id: 2, tags: { highway: 'residential' }, geometry: g([[0, 0], [2, 2]]) },
    { type: 'way', id: 3, tags: { highway: 'steps' }, geometry: g([[0, 0], [1, 1]]) },
  ] });
  assert.equal(r.buildings[0].ll.length, 3);
  assert.deepEqual(r.roads.map((x) => x.id), [2]);
});
