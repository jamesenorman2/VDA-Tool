// Polygon and polyline helpers in the local metric frame (metres, y-up).

const EPS = 1e-9;
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = (a) => { const l = len(a); return l > EPS ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; };

export const signedArea = (poly) => poly.reduce((t, p, i) => t + cross(p, poly[(i + 1) % poly.length]), 0) / 2;
export const area = (poly) => Math.abs(signedArea(poly));
export const perimeter = (poly) => poly.reduce((t, p, i) => t + dist(p, poly[(i + 1) % poly.length]), 0);
export const polylineLength = (pts) => pts.slice(1).reduce((t, p, i) => t + dist(p, pts[i]), 0);

export function centroid(poly) {
  const A = signedArea(poly);
  if (Math.abs(A) < EPS) return mul(poly.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / poly.length);
  let cx = 0, cy = 0;
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length], c = cross(p, q); cx += (p.x + q.x) * c; cy += (p.y + q.y) * c; });
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function nearestOnSegment(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = add(a, mul(ab, t));
  return { point: q, t, d: dist(p, q) };
}

// Nearest point on a polyline (closed adds the last→first edge).
export function nearestOnPolyline(p, pts, closed = false) {
  let best = null;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const r = nearestOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
    if (!best || r.d < best.d) best = { ...r, segment: i };
  }
  return best;
}

// Segment intersection: fractions t (along p→p2) and u (along q→q2), or null.
export function segmentIntersect(p, p2, q, q2) {
  const r = sub(p2, p), s = sub(q2, q), den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const qp = sub(q, p), t = cross(qp, s) / den, u = cross(qp, r) / den;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? { t, u } : null;
}

export function segmentHitsPolygon(a, b, poly) {
  for (let i = 0; i < poly.length; i++) if (segmentIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
  return pointInPolygon(a, poly) || pointInPolygon(b, poly);
}

// Smallest distance between two polylines/polygons (no intersection test: 0 only when touching).
export function minDistance(a, aClosed, b, bClosed) {
  let d = Infinity;
  for (const p of a) d = Math.min(d, nearestOnPolyline(p, b, bClosed).d);
  for (const p of b) d = Math.min(d, nearestOnPolyline(p, a, aClosed).d);
  return d;
}

// Offset a simple polygon outward by d metres. Convex corners are rounded (arc steps of at most
// 5°), so the result is a standoff line to within 0.1 %; concave corners use the miter point.
// With `outer`, rounded corners are drawn as tangent segments outside the true arc, so the line is
// never closer than d anywhere (used for standoff lines, which must not undercut the standoff).
export function offsetPolygon(poly, d, stepDeg = 5, outer = false) {
  const ccw = signedArea(poly) > 0;
  const n = poly.length, out = [];
  // Outward normal of edge i (from poly[i] to poly[i+1]).
  const normal = (i) => { const e = unit(sub(poly[(i + 1) % n], poly[i])); return ccw ? { x: e.y, y: -e.x } : { x: -e.y, y: e.x }; };
  for (let i = 0; i < n; i++) {
    const nPrev = normal((i - 1 + n) % n), nNext = normal(i), p = poly[i];
    const turn = cross(nPrev, nNext) * (ccw ? 1 : -1); // > 0: convex corner
    if (turn > 1e-6) {
      const a0 = Math.atan2(nPrev.y, nPrev.x);
      let sweep = Math.atan2(nNext.y, nNext.x) - a0;
      if (ccw) { while (sweep < 0) sweep += 2 * Math.PI; } else { while (sweep > 0) sweep -= 2 * Math.PI; }
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / ((stepDeg * Math.PI) / 180))); // 5° default: chords within 0.1 % of d
      if (outer) {
        const h = sweep / (2 * steps), R = d / Math.cos(h);
        out.push({ x: p.x + Math.cos(a0) * d, y: p.y + Math.sin(a0) * d });
        for (let k = 0; k < steps; k++) { const a = a0 + (2 * k + 1) * h; out.push({ x: p.x + Math.cos(a) * R, y: p.y + Math.sin(a) * R }); }
        out.push({ x: p.x + Math.cos(a0 + sweep) * d, y: p.y + Math.sin(a0 + sweep) * d });
      } else {
        for (let k = 0; k <= steps; k++) { const a = a0 + (sweep * k) / steps; out.push({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }); }
      }
    } else {
      const bis = unit(add(nPrev, nNext));
      const c = dot(bis, nNext);
      const m = c > 0.2 ? d / c : d * 5; // miter, limited for very sharp concave corners
      out.push(add(p, mul(bis, m)));
    }
  }
  return dedupe(out);
}

function dedupe(pts, tol = 0.01) {
  return pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > tol);
}

// Ramer–Douglas–Peucker simplification.
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) { const d = nearestOnSegment(pts[k], pts[i], pts[j]).d; if (d > bd) { bd = d; best = k; } }
    if (best >= 0) { keep[best] = true; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

// Rectangle from two corners along one edge (a→b) and a third point setting the depth.
export function rectangleFrom(a, b, c) {
  const e = sub(b, a), nrm = unit({ x: -e.y, y: e.x });
  const depth = dot(sub(c, a), nrm);
  const off = mul(nrm, depth);
  return [a, b, add(b, off), add(a, off)];
}

// Outline of a thin strip around a polyline (half-width hw), as one polygon. Used for walls.
export function bufferLine(pts, hw) {
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = unit(sub(b, a)), n = { x: -t.y, y: t.x };
    left.push(add(pts[i], mul(n, hw))); right.push(add(pts[i], mul(n, -hw)));
  }
  return [...left, ...right.reverse()];
}
