import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLES, buildRouteSpeeds, maxCorneringSpeed, speedAtDistance, distanceForSpeed, subdivide, chartSeries } from '../src/maths.js';
import { buildSketch } from '../src/sketch.js';

const V = Object.fromEntries(VEHICLES.map((v) => [v.id, v]));
const close = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('plateau speeds match the spec', () => {
  close(V.CAR.plateau, 124.867, 0.1); close(V.PICKUP.plateau, 97.427, 0.1);
  close(V.FLATBED.plateau, 92.011, 0.1); close(V.SEVENTRIGID.plateau, 80.298, 0.1);
  close(V.EIGHTEENTRIGID.plateau, 64.063, 0.1); close(V.THIRTYTRIGID.plateau, 65.664, 0.1);
});

test('speed/distance round trip', () => {
  for (const v of VEHICLES) for (const d of [5, 30, 100, 300]) close(distanceForSpeed(v, speedAtDistance(v, d)), d, 1.5);
});

test('cornering', () => {
  close(maxCorneringSpeed(V.CAR, 10), 3.6 * Math.sqrt(10 * 0.72 * 9.81));
  close(maxCorneringSpeed(V.PICKUP, 150), 60.6 * 1.609344);
});

test('standing start on a long straight approaches plateau', () => {
  const r = buildRouteSpeeds([{ sType: 'STRAIGHT', sLength: 500, radius: 150 }], 'STANDING');
  close(r[0].exitSpeeds.get('CAR').speed, V.CAR.plateau);
});

test('tight curve caps speed and resets acceleration', () => {
  const secs = [
    { sType: 'STRAIGHT', sLength: 50 },
    { sType: 'CURVE_LEFT', sLength: 20, radius: 10 },
  ];
  const r = buildRouteSpeeds(secs, 'ROLLING');
  close(r[1].exitSpeeds.get('CAR').speed, 30.26, 0.1);
  assert.equal(r[1].exitSpeeds.get('CAR').accDistance, null);
  assert.ok(r[0].exitSpeeds.get('CAR').speed < V.CAR.plateau);
});

test('subdivision keeps total length and marks one major piece per section', () => {
  const secs = [{ sType: 'STRAIGHT', sLength: 100 }, { sType: 'STRAIGHT', sLength: 300 }];
  const fine = subdivide(secs);
  close(fine.reduce((t, s) => t + s.sLength, 0), 400, 1e-9);
  assert.equal(fine.filter((s) => s.major).length, 2);
  assert.equal(chartSeries(secs, 'STANDING').filter((p) => p.major).length, 3);
});

test('sketch: left curve bends up (y-up), right curve down; quarter turn ends correctly', () => {
  const s = buildSketch([{ sType: 'CURVE_LEFT', sLength: Math.PI * 10 / 2, radius: 10 }]);
  assert.match(s.segments[0].path, /A 10 10 0 0 0 /);
  close(s.startPoint.x, 10, 0.01); close(Math.abs(s.startPoint.y), 10, 0.01);
  const r = buildSketch([{ sType: 'CURVE_RIGHT', sLength: Math.PI * 10 * 2, radius: 10 }]);
  assert.equal((r.segments[0].path.match(/A /g) || []).length, 2);
});
