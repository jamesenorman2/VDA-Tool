import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLES, MAX_RADIUS, buildRouteSpeeds, chartSeries } from '../src/maths.js';
import { buildSketch } from '../src/sketch.js';
import { polylineToSections, yDownToYUp } from '../src/geometry/fillet.js';
import { clipAtLop, impactAngle } from '../src/geometry/clip.js';
import { newProject, newVector, migrateLegacyState, resolveVector } from '../src/model.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const P = (x, y) => ({ x, y });
const speedsAtAsset = (sections, start = 'ROLLING') => {
  const r = buildRouteSpeeds(sections, start);
  return Object.fromEntries(VEHICLES.map((v) => [v.id, r[0].exitSpeeds.get(v.id).speed]));
};

// Independent walk of the sections (travel order, y-up), to check that they reproduce the drawing.
function walk(sections, start, heading) {
  let o = { ...start }, h = heading;
  for (const s of [...sections].reverse()) {
    if (s.sType === 'STRAIGHT') { o = { x: o.x + Math.cos(h) * s.sLength, y: o.y + Math.sin(h) * s.sLength }; continue; }
    const sign = s.sType === 'CURVE_LEFT' ? 1 : -1, th = s.sLength / s.radius;
    const c = { x: o.x - sign * Math.sin(h) * s.radius, y: o.y + sign * Math.cos(h) * s.radius };
    const a0 = Math.atan2(o.y - c.y, o.x - c.x) + sign * th;
    o = { x: c.x + Math.cos(a0) * s.radius, y: c.y + Math.sin(a0) * s.radius };
    h += sign * th;
  }
  return o;
}

test('90° left bend with a fixed 20 m radius', () => {
  const r = polylineToSections([P(0, 0), P(100, 0), P(100, 100)], [, { mode: 'fixed', radius: 20 }]);
  // Nearest the asset first: exit straight, curve, entry straight.
  assert.deepEqual(r.sections.map((s) => s.sType), ['STRAIGHT', 'CURVE_LEFT', 'STRAIGHT']);
  close(r.sections[0].sLength, 80); close(r.sections[2].sLength, 80);
  close(r.sections[1].sLength, 10 * Math.PI); close(r.sections[1].radius, 20);
  assert.deepEqual(r.warnings, []);
});

test('screen coordinates are flipped before use: a right turn on screen stays a right curve', () => {
  // y-down: heading +x then +y (down the screen) is a clockwise, i.e. right, turn.
  const r = polylineToSections(yDownToYUp([P(0, 0), P(100, 0), P(100, 100)]), [, { mode: 'fixed', radius: 20 }]);
  assert.equal(r.sections[1].sType, 'CURVE_RIGHT');
});

test('max mode takes the largest radius the shorter leg allows', () => {
  const r = polylineToSections([P(0, 0), P(50, 0), P(50, 80)]);
  close(r.vertices[0].radius, 50); // tan(45°) = 1, so T = r = the 50 m leg
  assert.equal(r.sections.length, 2); // entry straight used up entirely
  close(r.sections[0].sLength, 30);
});

test('max mode shares a leg fairly between two bends', () => {
  // Two 90° bends on a 60 m shared leg, long outer legs: each gets r = 30.
  const r = polylineToSections([P(0, 0), P(200, 0), P(200, 60), P(400, 60)]);
  close(r.vertices[0].radius, 30); close(r.vertices[1].radius, 30);
  assert.equal(r.vertices[0].side, 'LEFT'); assert.equal(r.vertices[1].side, 'RIGHT');
});

test('a radius beyond the model becomes a sharp corner with full legs (conservative)', () => {
  // A 10° bend on 500 m legs would allow r ≈ 5700 m.
  const a = 10 * Math.PI / 180;
  const r = polylineToSections([P(0, 0), P(500, 0), P(500 + 500 * Math.cos(a), 500 * Math.sin(a))]);
  assert.ok(r.vertices[0].straight);
  assert.ok(r.sections.every((s) => s.sType === 'STRAIGHT'));
  close(r.length, 1000, 1e-6);
});

test('a fixed radius too large for its legs is clamped and flagged', () => {
  const r = polylineToSections([P(0, 0), P(30, 0), P(30, 30)], [, { mode: 'fixed', radius: 100 }]);
  close(r.vertices[0].radius, 30);
  assert.ok(r.vertices[0].clamped);
  assert.equal(r.warnings.length, 1);
});

test('collinear points add no curve', () => {
  const r = polylineToSections([P(0, 0), P(40, 0), P(100, 0)]);
  assert.deepEqual(r.sections.map((s) => s.sType), ['STRAIGHT', 'STRAIGHT']);
});

test('drawn sections reproduce the drawing (independent walk and route sketch)', () => {
  const pts = [P(3, 4), P(120, 30), P(150, 140), P(60, 200), P(70, 320)];
  const r = polylineToSections(pts, [, { mode: "fixed", radius: 25 }, { mode: "fixed", radius: 15 }, { mode: "fixed", radius: 30 }]);
  assert.equal(r.sections.filter((s) => s.sType !== "STRAIGHT").length, 3);
  const end = walk(r.sections, pts[0], Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x));
  close(end.x, pts.at(-1).x, 0.01); close(end.y, pts.at(-1).y, 0.01);
  const sk = buildSketch(r.sections); // rotation-invariant check against the existing sketch code
  close(Math.hypot(sk.assetPoint.x - sk.startPoint.x, sk.assetPoint.y - sk.startPoint.y),
    Math.hypot(pts.at(-1).x - pts[0].x, pts.at(-1).y - pts[0].y), 0.01);
});

test('speeds from a drawn vector equal the same route entered by hand', () => {
  const drawn = polylineToSections([P(0, 0), P(100, 0), P(100, 100)], [, { mode: 'fixed', radius: 20 }]).sections;
  const typed = [
    { sType: 'STRAIGHT', sLength: 80, radius: MAX_RADIUS },
    { sType: 'CURVE_LEFT', sLength: 10 * Math.PI, radius: 20 },
    { sType: 'STRAIGHT', sLength: 80, radius: MAX_RADIUS },
  ];
  for (const start of ['ROLLING', 'STANDING']) {
    const a = speedsAtAsset(drawn, start), b = speedsAtAsset(typed, start);
    for (const id of Object.keys(a)) close(a[id], b[id], 1e-9);
  }
});

test('clip at the first crossing of the line of protection, with impact angle', () => {
  const lop = [P(50, -100), P(50, 100)];
  const c = clipAtLop([P(0, 0), P(100, 0), P(100, 50), P(0, 50)], lop);
  assert.equal(c.vectorSegment, 0);
  assert.deepEqual(c.point, P(50, 0));
  close(c.angle, 90);
  assert.equal(c.points.length, 2);
  assert.equal(clipAtLop([P(0, 0), P(40, 0)], lop), null);
  close(impactAngle(P(1, 1), P(1, 0)), 45);
  close(impactAngle(P(-1, 0), P(0, 1)), 90);
  close(impactAngle(P(Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)), P(1, 0)), 30);
});

test('legacy single-route state migrates to a project with identical speeds', () => {
  const legacy = { sections: [{ id: 2, sType: 'CURVE_RIGHT', sLength: 20, radius: 12, description: 'Gate' }, { id: 1, sType: 'STRAIGHT', sLength: 90, radius: 150, description: '' }],
    start: 'STANDING', unit: 'MPH', order: 'FROM_START', title: 'Site A', counter: 3 };
  const p = migrateLegacyState(legacy);
  assert.equal(p.title, 'Site A'); assert.equal(p.settings.unit, 'MPH');
  assert.equal(p.vectors.length, 1); assert.equal(p.vectors[0].start, 'STANDING');
  const r = resolveVector(p, p.vectors[0]);
  assert.deepEqual(speedsAtAsset(r.sections, 'STANDING'), speedsAtAsset(legacy.sections, 'STANDING'));
});

test('a drawn vector resolves through clipping and fillets; missing crossing is an error', () => {
  const p = newProject({ lops: [{ id: 'l1', points: [P(100, 60), P(140, 60)] }] });
  const v = newVector({ source: 'drawn', lopId: 'l1', points: [P(0, 0), P(120, 0), P(120, 200)], vertexOptions: [, { mode: 'fixed', radius: 20 }] });
  const r = resolveVector(p, v);
  assert.deepEqual(r.errors, []);
  close(r.crossing.angle, 90);
  close(r.sections[0].sLength, 40); // 60 m to the LoP minus the 20 m tangent
  const miss = resolveVector(p, newVector({ source: 'drawn', lopId: 'l1', points: [P(0, 0), P(50, 0)] }));
  assert.deepEqual(miss.errors, ['This vector does not cross the line of protection']);
});

test('with no LoP chosen, a vector uses the first LoP it crosses along its length', () => {
  const p = newProject({ lops: [{ id: 'far', points: [P(80, -50), P(80, 50)] }, { id: 'near', points: [P(30, -50), P(30, 50)] }] });
  const r = resolveVector(p, newVector({ source: 'drawn', points: [P(0, 0), P(100, 0)] }));
  assert.equal(r.crossing.lopId, 'near');
  close(r.sections[0].sLength, 30);
});
