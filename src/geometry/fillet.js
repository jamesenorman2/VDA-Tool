// Drawn vector (polyline) -> route sections for the engine in maths.js.
//
// Points are in the local metric frame: metres, y-up, in travel order (start first, the
// line-of-protection crossing last). Screen/image coordinates are y-down: convert them with
// yDownToYUp() first, or every left curve comes out as a right curve.
//
// Each interior vertex is rounded with a tangent arc (fillet). Turn angle θ, radius r:
//   tangent length T = r·tan(θ/2), arc length = r·θ, and both adjacent legs lose T.
// Radius modes per vertex:
//   { mode: 'max' }             the largest radius the legs allow (default: worst case, fastest line)
//   { mode: 'fixed', radius }   as entered; clamped (and flagged) if the legs are too short
// A radius above MAX_RADIUS is outside the cornering model and the vertex is treated as a sharp
// corner with no speed limit along the unshortened legs. That never understates speed.

import { MAX_RADIUS } from '../maths.js';

const EPS = 1e-9;
const MIN_TURN = 1e-6; // radians; smaller turns are collinear
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a) => Math.hypot(a.x, a.y);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;

export const yDownToYUp = (points) => points.map((p) => ({ ...p, x: p.x, y: -p.y }));

// vertexOptions[i] applies to points[i]; only interior points (1..n-2) are used.
export function polylineToSections(points, vertexOptions = []) {
  if (points.length < 2) throw new Error('A vector needs at least two points');
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = sub(points[i + 1], points[i]);
    legs.push({ length: len(d), dir: d });
  }
  if (legs.some((l) => l.length < EPS)) throw new Error('A vector has two points in the same place');

  const warnings = [];
  // Interior vertices: index into points, turn angle, side.
  const verts = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = legs[i - 1].dir, b = legs[i].dir;
    const theta = Math.atan2(cross(a, b), dot(a, b)); // signed, (-π, π]; > 0 is a left turn (y-up)
    const opt = vertexOptions[i] || {};
    const v = {
      point: i, theta: Math.abs(theta), side: theta > 0 ? 'LEFT' : 'RIGHT',
      mode: opt.mode === 'fixed' ? 'fixed' : 'max', requested: opt.radius,
      radius: Infinity, tangent: 0, clamped: false, straight: false,
    };
    if (v.theta < MIN_TURN) { v.straight = true; v.radius = Infinity; }
    else if (v.mode === 'fixed' && !(Number.isFinite(opt.radius) && opt.radius > 0)) {
      throw new Error(`Point ${i + 1}: a fixed radius must be a number above 0`);
    }
    if (v.theta > Math.PI - 1e-3) warnings.push(`Point ${i + 1}: the route doubles back on itself`);
    verts.push(v);
  }
  const tanHalf = (v) => Math.tan(v.theta / 2);
  // legs[k] runs from points[k] to points[k+1]; vertex at points[i] sits on legs i-1 and i.
  const onLeg = (k) => verts.filter((v) => !v.straight && (v.point === k || v.point === k + 1));

  // 1. Fixed radii, clamped per leg.
  for (const v of verts) if (!v.straight && v.mode === 'fixed') v.radius = v.requested;
  for (let k = 0; k < legs.length; k++) {
    const fixed = onLeg(k).filter((v) => v.mode === 'fixed');
    const need = fixed.reduce((t, v) => t + v.radius * tanHalf(v), 0);
    if (need > legs[k].length + EPS) {
      const f = legs[k].length / need;
      for (const v of fixed) { v.radius *= f; v.clamped = true; }
    }
  }
  for (const v of verts) if (v.clamped) warnings.push(`Point ${v.point + 1}: radius reduced from ${v.requested} m to ${round(v.radius)} m to fit the legs`);
  for (const v of verts) if (!v.straight && v.mode === 'fixed' && v.radius > MAX_RADIUS) v.straight = true;

  // 2. Max radii: max-min fair water-filling. Repeatedly find the leg that allows the smallest
  // common radius for its unsettled vertices, settle them there, and continue.
  for (;;) {
    for (const v of verts) if (v.mode === 'max' && !v.straight) v.settled = false;
    let open = verts.filter((v) => v.mode === 'max' && !v.straight);
    while (open.length) {
      let best = null;
      for (let k = 0; k < legs.length; k++) {
        const vs = onLeg(k);
        const free = vs.filter((v) => v.mode === 'max' && !v.settled);
        if (!free.length) continue;
        const used = vs.filter((v) => v.mode === 'fixed' || v.settled).reduce((t, v) => t + v.radius * tanHalf(v), 0);
        const r = Math.max(0, legs[k].length - used) / free.reduce((t, v) => t + tanHalf(v), 0);
        if (!best || r < best.r) best = { r, free };
      }
      for (const v of best.free) { v.radius = best.r; v.settled = true; }
      open = open.filter((v) => !v.settled);
    }
    // Vertices beyond the model's radius range become sharp corners, which frees leg length for
    // their neighbours, so fill again until nothing changes.
    const over = verts.filter((v) => v.mode === 'max' && !v.straight && v.radius > MAX_RADIUS);
    if (!over.length) break;
    for (const v of over) v.straight = true;
  }
  for (const v of verts) {
    delete v.settled;
    if (!v.straight && v.radius < 0.01) {
      warnings.push(`Point ${v.point + 1}: no room for a bend, so it is treated as a sharp corner with no speed limit (conservative)`);
      v.straight = true;
    }
    if (v.straight) { v.radius = Infinity; v.tangent = 0; } else v.tangent = v.radius * tanHalf(v);
  }

  // 3. Emit pieces in travel order.
  const pieces = [];
  const tangentAt = (i) => verts.find((v) => v.point === i)?.tangent || 0;
  const unit = (d) => { const l = len(d); return { x: d.x / l, y: d.y / l }; };
  for (let k = 0; k < legs.length; k++) {
    const u = unit(legs[k].dir);
    const t0 = tangentAt(k), t1 = tangentAt(k + 1);
    const from = { x: points[k].x + u.x * t0, y: points[k].y + u.y * t0 };
    const to = { x: points[k + 1].x - u.x * t1, y: points[k + 1].y - u.y * t1 };
    const L = Math.max(0, legs[k].length - t0 - t1);
    if (L > 1e-6) pieces.push({ kind: 'line', from, to, length: L, leg: k });
    const v = verts.find((w) => w.point === k + 1);
    if (v && !v.straight) {
      const sign = v.side === 'LEFT' ? 1 : -1;
      const centre = { x: to.x - sign * u.y * v.radius, y: to.y + sign * u.x * v.radius };
      const u2 = unit(legs[k + 1].dir);
      const end = { x: points[k + 1].x + u2.x * v.tangent, y: points[k + 1].y + u2.y * v.tangent };
      pieces.push({ kind: 'arc', from: to, to: end, centre, radius: v.radius, side: v.side, angle: v.theta, length: v.radius * v.theta, vertex: v.point });
    }
  }

  // Engine sections: nearest the asset first.
  const sections = pieces.map((p) => (p.kind === 'line'
    ? { sType: 'STRAIGHT', sLength: p.length, radius: MAX_RADIUS }
    : { sType: p.side === 'LEFT' ? 'CURVE_LEFT' : 'CURVE_RIGHT', sLength: p.length, radius: p.radius, vertex: p.vertex })).reverse();

  return { sections, pieces, vertices: verts, warnings, length: pieces.reduce((t, p) => t + p.length, 0) };
}

const round = (n) => Math.round(n * 100) / 100;
