// Clip a drawn vector at its first crossing of the line of protection (LoP), and measure the
// impact angle there. All points are in the local metric frame (metres, y-up).

const EPS = 1e-9;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a, b) => a.x * b.y - a.y * b.x;

// Intersection of segments p→p2 and q→q2. Returns { t, u } as fractions along each, or null.
function intersect(p, p2, q, q2) {
  const r = sub(p2, p), s = sub(q2, q);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null; // parallel or collinear: not a crossing
  const qp = sub(q, p);
  const t = cross(qp, s) / den, u = cross(qp, r) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) };
}

// Angle between the vehicle's heading and the LoP, folded into 0–90° (90° = head-on).
export function impactAngle(heading, lopDir) {
  const c = Math.abs(cross(heading, lopDir)) / (Math.hypot(heading.x, heading.y) * Math.hypot(lopDir.x, lopDir.y));
  return (Math.asin(Math.min(1, c)) * 180) / Math.PI;
}

// Returns null when the vector never crosses the LoP. A crossing exactly at the vector's first
// point does not count (the vector would start on the line).
export function clipAtLop(vector, lop) {
  for (let i = 0; i < vector.length - 1; i++) {
    let best = null;
    for (let j = 0; j < lop.length - 1; j++) {
      const hit = intersect(vector[i], vector[i + 1], lop[j], lop[j + 1]);
      if (!hit || (i === 0 && hit.t < 1e-6)) continue;
      if (!best || hit.t < best.t) best = { ...hit, j };
    }
    if (best) {
      const a = vector[i], b = vector[i + 1];
      const point = { x: a.x + (b.x - a.x) * best.t, y: a.y + (b.y - a.y) * best.t };
      const points = [...vector.slice(0, i + 1), point];
      const heading = sub(b, a), lopDir = sub(lop[best.j + 1], lop[best.j]);
      return { points, point, vectorSegment: i, lopSegment: best.j, lopFraction: best.u, angle: impactAngle(heading, lopDir) };
    }
  }
  return null;
}
