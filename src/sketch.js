// Route sketch geometry. Computed in a y-up maths frame, emitted in SVG (y-down) coordinates.
// Drawn in the direction of travel: the route start is at the origin heading +x, the asset is the far end.
// Left/right are the driver's left/right. sections[0] is nearest the asset, so we walk the array backwards.

const rot = (p, a) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const add = (p, q) => ({ x: p.x + q.x, y: p.y + q.y });
const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });

export function describeSection(s) {
  if (s.sType === 'STRAIGHT') return `Straight of length ${s.sLength} metres`;
  const side = s.sType === 'CURVE_LEFT' ? 'Left' : 'Right';
  return `${side} curve of length ${s.sLength} metres with radius ${s.radius} metres`;
}

export function buildSketch(sections) {
  let o = { x: 0, y: 0 };
  let d = { x: 1, y: 0 };
  const raw = [];
  for (let index = sections.length - 1; index >= 0; index--) {
    const s = sections[index];
    if (s.sType === 'STRAIGHT') {
      const dest = { x: o.x + d.x * s.sLength, y: o.y + d.y * s.sLength };
      raw.push({ index, kind: 'line', pts: [o, dest] });
      o = dest;
    } else {
      const sign = s.sType === 'CURVE_LEFT' ? 1 : -1;
      const theta = s.sLength / s.radius;
      const centre = { x: o.x + sign * -d.y * s.radius, y: o.y + sign * d.x * s.radius };
      const rel = sub(o, centre);
      // Pieces of at most a half turn, so no arc needs the large-arc flag.
      const pieces = Math.max(1, Math.ceil(theta / Math.PI - 1e-9));
      const pts = [o];
      const samples = Math.max(2, Math.ceil(theta / (Math.PI / 32)));
      for (let k = 1; k <= samples; k++) pts.push(add(centre, rot(rel, (sign * theta * k) / samples)));
      const ends = [o];
      for (let k = 1; k <= pieces; k++) ends.push(add(centre, rot(rel, (sign * theta * k) / pieces)));
      raw.push({ index, kind: 'arc', pts, ends, sign, radius: s.radius });
      o = ends[ends.length - 1];
      d = rot(d, sign * theta);
    }
  }

  const all = [{ x: 0, y: 0 }, ...raw.flatMap((r) => r.pts)];
  const bb = (pts) => ({
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
  });
  let box = bb(all);
  const turn = box.maxY - box.minY > box.maxX - box.minX; // portrait -> rotate to landscape
  const T = turn ? (p) => ({ x: p.y, y: -p.x }) : (p) => p;
  const scr = (p) => { const q = T(p); return { x: q.x, y: -q.y }; };
  box = bb(all.map(scr));

  const w = Math.max(box.maxX - box.minX, 1);
  const h = Math.max(box.maxY - box.minY, 1);
  const flag = Math.max(w * 0.1, 10);
  const margin = flag * 1.5;
  const f = (n) => +n.toFixed(3);

  const segments = raw.map((r) => {
    const pt = (p) => { const q = scr(p); return `${f(q.x)} ${f(q.y)}`; };
    let path;
    if (r.kind === 'line') path = `M ${pt(r.ends ? r.ends[0] : r.pts[0])} L ${pt(r.pts[1])}`;
    else {
      path = `M ${pt(r.ends[0])}`;
      for (let k = 1; k < r.ends.length; k++) {
        // Left (CCW in y-up) stays CCW on screen -> sweep 0; right -> sweep 1.
        path += ` A ${f(r.radius)} ${f(r.radius)} 0 0 ${r.sign > 0 ? 0 : 1} ${pt(r.ends[k])}`;
      }
    }
    return { index: r.index, path, text: describeSection(sections[r.index]) };
  });

  return {
    segments, flag,
    viewBox: [box.minX - margin, box.minY - margin, w + 2 * margin, h + 2 * margin].map(f).join(' '),
    startPoint: scr({ x: 0, y: 0 }),
    assetPoint: scr(raw.length ? raw[raw.length - 1].pts[raw[raw.length - 1].pts.length - 1] : { x: 0, y: 0 }),
  };
}
