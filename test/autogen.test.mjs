import test from 'node:test';
import assert from 'node:assert/strict';
import { generateVectors, obstacleLimitedRadii, makeObstacleIndex, lopSamples } from '../src/autogen.js';
import { polylineToSections } from '../src/geometry/fillet.js';
import { offsetPolygon, pointInPolygon } from '../src/geometry/polygon.js';
import { VEHICLES } from '../src/maths.js';

const P = (x, y) => ({ x, y });
const box = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
const CAR_TOP = VEHICLES.find((v) => v.id === 'CAR').plateau;

test('bend radii are limited so the arc clears a building on the inside of the corner', () => {
  const pts = [P(0, -100), P(0, 0), P(100, 0)]; // north then east: inside of the bend is south-east
  const building = box(4, -60, 60, -4);
  const index = makeObstacleIndex([building]);
  const free = polylineToSections(pts).vertices[0].radius;
  const vo = obstacleLimitedRadii(pts, index);
  assert.ok(vo[1] && vo[1].mode === 'fixed' && vo[1].radius < free, JSON.stringify(vo));
  const arc = polylineToSections(pts, vo).pieces.find((p) => p.kind === 'arc');
  for (let k = 0; k <= 20; k++) {
    const a = Math.atan2(arc.from.y - arc.centre.y, arc.from.x - arc.centre.x) - (arc.angle * k) / 20;
    assert.ok(!pointInPolygon({ x: arc.centre.x + Math.cos(a) * arc.radius, y: arc.centre.y + Math.sin(a) * arc.radius }, building));
  }
});

test('samples along a closed LoP point outward from the asset', () => {
  const asset = { points: box(-10, -10, 10, 10) };
  const lop = { id: 'L', closed: true, points: offsetPolygon(asset.points, 10) };
  for (const s of lopSamples(lop, [asset], 10)) assert.ok(s.n.x * s.p.x + s.n.y * s.p.y > 0);
});

test('open-ground search: a building limits the run-up on its side; open sides reach top speed', () => {
  const asset = { points: box(-10, -10, 10, 10) };
  const lop = { id: 'L', closed: true, points: offsetPolygon(asset.points, 10) };
  // A long building 60 m north of the asset, wide enough to block every northern ray.
  const r = generateVectors({ lops: [lop], assets: [asset], obstacles: [box(-2000, 60, 2000, 90)], binLength: 1, maxResults: 1000 }); // one bin per sample
  const c = r.candidates;
  assert.ok(c.length > 4);
  for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].worst >= c[i].worst - 0.5); // ties within 0.5 km/h go to the more head-on
  const north = c.filter((x) => x.kind === 'open' && x.points[1].y > 15 && Math.abs(x.points[1].x) < 8); // straight north edge only
  assert.ok(north.length && north.every((x) => x.start === 'STANDING' && x.worst < CAR_TOP), JSON.stringify(north.map((x) => x.worst)));
  const south = c.filter((x) => x.kind === 'open' && x.points[1].y < -15);
  assert.ok(south.some((x) => Math.abs(x.worst - CAR_TOP) < 0.01 && x.start === 'ROLLING'));
});

test('road search follows the network and leaves the road for the last leg', () => {
  const asset = { points: box(-10, -10, 10, 10) };
  const lop = { id: 'L', closed: false, points: [P(-30, 25), P(30, 25)] };
  // Buildings block open ground north of the line except along the road corridor.
  const obstacles = [box(-500, 35, -6, 400), box(6, 35, 500, 400)];
  const road = [P(0, 600), P(0, 60), P(0, 40)];
  const r = generateVectors({ lops: [lop], assets: [asset], obstacles, roads: [road], maxResults: 20 });
  const viaRoad = r.all.filter((x) => x.kind === 'road');
  assert.ok(viaRoad.length, JSON.stringify(r.stats));
  assert.ok(viaRoad.some((x) => x.start === 'ROLLING'));
});

test('round-the-corner approaches are found when a building blocks the straight run', () => {
  const asset = { points: box(-10, -10, 10, 10) };
  const lop = { id: 'L', closed: false, points: [P(-10, 20), P(10, 20)] };
  // A building right in front of the line and two flanking walls: straight runs are short.
  const obstacles = [box(-40, 40, 40, 80), box(-300, 20, -45, 400), box(45, 20, 300, 400)];
  const r = generateVectors({ lops: [lop], assets: [asset], obstacles, binLength: 1, maxResults: 1000 });
  const corner = r.candidates.filter((x) => x.kind === 'corner');
  const open = r.candidates.filter((x) => x.kind === 'open');
  assert.ok(corner.length, JSON.stringify(r.stats));
  const index = makeObstacleIndex(obstacles);
  for (const c of corner) for (const q of c.points.slice(0, -1)) assert.ok(!index.inside(q));
  assert.ok(Math.max(...corner.map((x) => x.worst)) > Math.max(...open.map((x) => x.worst)));
});
