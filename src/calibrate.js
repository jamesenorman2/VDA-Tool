// Plan calibration and placement. A plan's placement is a similarity transform from image
// pixels (u right, v DOWN) to the local metric frame (metres, y up):
//   local = a · (u − i·v) + b      with complex a = s·e^{iθ} (s = metres per pixel, θ = rotation)
// The image's v axis points down, so it is negated before the transform. That flip is what keeps
// left turns on the plan as left turns in the assessment.

const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);

/** @typedef {{ s:number, theta:number, tx:number, ty:number }} Placement */

export function planToLocal(T, { u, v }) {
  const c = Math.cos(T.theta) * T.s, sn = Math.sin(T.theta) * T.s;
  const x = u, y = -v;
  return { x: c * x - sn * y + T.tx, y: sn * x + c * y + T.ty };
}

export function localToPlan(T, { x, y }) {
  const dx = x - T.tx, dy = y - T.ty;
  const c = Math.cos(T.theta) / T.s, sn = Math.sin(T.theta) / T.s;
  const px = c * dx + sn * dy, py = -sn * dx + c * dy;
  return { u: px, v: -py };
}

// Metres per pixel from two picked pixels and the real distance between them.
export function scaleFromTwoPoints(p1, p2, metres) {
  const px = Math.hypot(p2.u - p1.u, p2.v - p1.v);
  if (!(px > 0)) throw new Error('Pick two different points');
  if (!(metres > 0)) throw new Error('Enter a distance above 0');
  return metres / px;
}

// Change the scale while keeping the plan point `pivot` (pixels) where it is.
export function rescale(T, s, pivot) {
  const fixed = planToLocal(T, pivot);
  const next = { ...T, s };
  const moved = planToLocal(next, pivot);
  return { ...next, tx: next.tx + fixed.x - moved.x, ty: next.ty + fixed.y - moved.y };
}

// Signed percentage error of a check measurement (positive = the plan measures long).
export function checkError(measured, known) {
  return ((measured - known) / known) * 100;
}

export function measureOnPlan(T, p1, p2) {
  return dist(planToLocal(T, p1), planToLocal(T, p2));
}

// Least-squares similarity fit from plan pixels to local metres (≥ 2 pairs). Closed form in
// complex numbers on centred coordinates. Returns the placement and the residual per pair.
// With `fixedScale`, only rotation and position are fitted and the scale is kept, so a plan that
// was calibrated by measurement keeps its measured scale; `fittedScale` is still reported.
export function fitSimilarity(pairs, { fixedScale } = {}) {
  if (pairs.length < 2) throw new Error('Need at least two control points');
  const src = pairs.map((p) => ({ x: p.plan.u, y: -p.plan.v }));
  const dst = pairs.map((p) => p.local);
  const mean = (ps) => ({ x: ps.reduce((t, p) => t + p.x, 0) / ps.length, y: ps.reduce((t, p) => t + p.y, 0) / ps.length });
  const ms = mean(src), md = mean(dst);
  let re = 0, im = 0, norm = 0;
  src.forEach((s, i) => {
    const sx = s.x - ms.x, sy = s.y - ms.y, dx = dst[i].x - md.x, dy = dst[i].y - md.y;
    re += dx * sx + dy * sy; // Σ d · conj(s)
    im += dy * sx - dx * sy;
    norm += sx * sx + sy * sy;
  });
  if (!(norm > 0)) throw new Error('Control points on the plan must be in different places');
  let ar = re / norm, ai = im / norm;
  const fittedScale = Math.hypot(ar, ai), theta = Math.atan2(ai, ar);
  const s = fixedScale > 0 ? fixedScale : fittedScale;
  ar = s * Math.cos(theta); ai = s * Math.sin(theta);
  const T = { s, theta, tx: md.x - (ar * ms.x - ai * ms.y), ty: md.y - (ai * ms.x + ar * ms.y) };
  const residuals = pairs.map((p) => dist(planToLocal(T, p.plan), p.local));
  return { placement: T, residuals, fittedScale };
}
