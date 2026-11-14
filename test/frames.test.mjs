import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame, haversine } from '../src/frames.js';
import { planToLocal, localToPlan, scaleFromTwoPoints, rescale, checkError, measureOnPlan, fitSimilarity } from '../src/calibrate.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('local frame round trip and agreement with great-circle distance', () => {
  const f = makeFrame({ lng: -0.1276, lat: 51.5072 });
  const p = { x: 312.4, y: -287.9 };
  const q = f.toLocal(f.toLngLat(p));
  close(q.x, p.x, 1e-6); close(q.y, p.y, 1e-6);
  for (const d of [{ x: 440, y: 0 }, { x: 0, y: 440 }, { x: 311, y: 311 }]) {
    const hv = haversine(f.anchor, f.toLngLat(d));
    assert.ok(Math.abs(hv - Math.hypot(d.x, d.y)) / Math.hypot(d.x, d.y) < 0.004, `${hv}`); // sphere vs ellipsoid
  }
});

test('plan placement: image v points down, so a downward pixel step goes south', () => {
  const T = { s: 0.1, theta: 0, tx: 0, ty: 0 };
  assert.deepEqual(planToLocal(T, { u: 10, v: 0 }), { x: 1, y: 0 });
  const down = planToLocal(T, { u: 0, v: 10 });
  close(down.y, -1);
  const back = localToPlan({ s: 0.25, theta: 0.7, tx: 5, ty: -3 }, planToLocal({ s: 0.25, theta: 0.7, tx: 5, ty: -3 }, { u: 123, v: 45 }));
  close(back.u, 123); close(back.v, 45);
});

test('two-point scale, rescale about a pivot, and check error', () => {
  const s = scaleFromTwoPoints({ u: 100, v: 100 }, { u: 400, v: 500 }, 25); // 500 px = 25 m
  close(s, 0.05);
  const T0 = { s: 1, theta: 0.3, tx: 10, ty: 20 };
  const pivot = { u: 50, v: 60 };
  const T1 = rescale(T0, s, pivot);
  const a = planToLocal(T0, pivot), b = planToLocal(T1, pivot);
  close(a.x, b.x); close(a.y, b.y);
  close(measureOnPlan(T1, { u: 100, v: 100 }, { u: 400, v: 500 }), 25);
  close(checkError(24.6, 25), -1.6);
  assert.throws(() => scaleFromTwoPoints({ u: 1, v: 1 }, { u: 1, v: 1 }, 5));
});

test('similarity fit recovers a known placement; residuals are zero for exact points', () => {
  const T = { s: 0.04, theta: -1.1, tx: -30, ty: 55 };
  const plan = [{ u: 0, v: 0 }, { u: 800, v: 120 }, { u: 300, v: 900 }];
  const { placement, residuals } = fitSimilarity(plan.map((p) => ({ plan: p, local: planToLocal(T, p) })));
  close(placement.s, T.s); close(placement.theta, T.theta); close(placement.tx, T.tx); close(placement.ty, T.ty);
  residuals.forEach((r) => close(r, 0));
  const noisy = fitSimilarity(plan.map((p, i) => ({ plan: p, local: { x: planToLocal(T, p).x + (i ? 0.5 : 0), y: planToLocal(T, p).y } })));
  assert.ok(noisy.residuals.some((r) => r > 0.1));
});

test('alignment can keep a measured scale and still report the scale the map implies', () => {
  const T = { s: 0.05, theta: 0.4, tx: 12, ty: -8 };
  const plan = [{ u: 10, v: 20 }, { u: 900, v: 40 }, { u: 400, v: 700 }];
  // The map says the plan is 2 % bigger than the measurement did.
  const pairs = plan.map((p) => ({ plan: p, local: planToLocal({ ...T, s: T.s * 1.02 }, p) }));
  const fit = fitSimilarity(pairs, { fixedScale: T.s });
  close(fit.placement.s, T.s); close(fit.placement.theta, T.theta);
  close(fit.fittedScale / T.s, 1.02);
  assert.ok(Math.max(...fit.residuals) > 0.1); // the scale disagreement shows up as residuals
});

test('the version shown in the app matches package.json', async () => {
  const { VERSION } = await import('../src/version.js');
  const fs = await import('node:fs');
  assert.equal(VERSION, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version);
});
