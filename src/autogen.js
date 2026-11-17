// Automatic attack-vector search (first version). Everything is in the local metric frame.
//
// Inputs: lines of protection, assets, obstacles (polygons a vehicle cannot pass through:
// buildings, walls and water from OpenStreetMap, assets and anything the assessor draws) and roads
// (polylines). With `openGround` everything that is not an obstacle is treated as traversable
// (spec decision Q13); without it (the default in the app) routes keep to the roads and leave
// them only for the last `roadReach` metres to the line.
//
// Two kinds of candidate approach are searched for each sample point along each LoP:
//  - Open ground: straight runs outward from the LoP at 5° steps, until an obstacle, the LoP
//    itself or the study radius stops them. Blocked runs start from rest at the obstacle
//    (a vehicle cannot pass through it); unblocked runs have a rolling start.
//  - Road network: from the nearest clear road point, the network is followed back up to the
//    study radius, and the last leg runs straight from the road to the LoP. Paths that reach the
//    radius have a rolling start; dead ends start from rest.
// Bends get the largest radius that fits the legs and keeps the arc clear of obstacles, which
// approximates a driver cutting corners. Each candidate is scored with the same engine as drawn
// vectors, and the fastest per stretch of LoP are kept. Results are suggestions for the assessor.

import { VEHICLES, MAX_RADIUS, buildRouteSpeeds } from './maths.js';
import { polylineToSections } from './geometry/fillet.js';
import { sub, add, mul, dist, dot, cross, centroid, pointInPolygon, nearestOnSegment, segmentIntersect, simplify, signedArea, offsetPolygon } from './geometry/polygon.js';

const unit = (a) => { const l = Math.hypot(a.x, a.y); return { x: a.x / l, y: a.y / l }; };
const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

function withBox(poly, orig = poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { poly, orig, minX, minY, maxX, maxY };
}
const boxHit = (b, x0, y0, x1, y1) => !(b.maxX < Math.min(x0, x1) || b.minX > Math.max(x0, x1) || b.maxY < Math.min(y0, y1) || b.minY > Math.max(y0, y1));

// `clearance` grows every obstacle outward (metres), so paths keep roughly half a vehicle's
// width away from walls and cannot slip through a corner point.
export function makeObstacleIndex(polys, clearance = 0) {
  const items = polys.filter((p) => p.length >= 3).map((p) => withBox(clearance > 0 ? offsetPolygon(p, clearance, 30) : p, p));
  return {
    items,
    // First hit along a→b as a fraction of the segment, or null. `hits` collects the obstacle hit.
    firstHit(a, b, hits) {
      let best = null, bestItem = null;
      for (const it of items) {
        if (!boxHit(it, a.x, a.y, b.x, b.y)) continue;
        const P = it.poly;
        for (let i = 0; i < P.length; i++) {
          const h = segmentIntersect(a, b, P[i], P[(i + 1) % P.length]);
          if (h && (best === null || h.t < best)) { best = h.t; bestItem = it; }
        }
      }
      if (hits && bestItem) hits.add(bestItem);
      return best;
    },
    inside(p) {
      for (const it of items) if (p.x >= it.minX && p.x <= it.maxX && p.y >= it.minY && p.y <= it.maxY && pointInPolygon(p, it.poly)) return true;
      return false;
    },
  };
}

// Score a vector: speeds at its end (the LoP crossing) for every class.
export function scoreVector(points, vertexOptions, start) {
  const { sections } = polylineToSections(points, vertexOptions);
  const r = buildRouteSpeeds(sections, start)[0].exitSpeeds;
  const speeds = Object.fromEntries(VEHICLES.map((v) => [v.id, r.get(v.id).speed]));
  return { speeds, worst: Math.max(...Object.values(speeds)) };
}

// Largest radii that fit the legs and keep each arc out of obstacles (binary search per bend).
export function obstacleLimitedRadii(points, index) {
  const opts = [];
  const r0 = polylineToSections(points, opts);
  for (const v of r0.vertices) {
    if (v.theta < 1e-6) continue; // collinear: no bend at all
    const arcClear = (o) => {
      const res = polylineToSections(points, o);
      const arc = res.pieces.find((p) => p.kind === 'arc' && p.vertex === v.point);
      if (!arc) return true;
      const a0 = Math.atan2(arc.from.y - arc.centre.y, arc.from.x - arc.centre.x), sweep = (arc.side === 'LEFT' ? 1 : -1) * arc.angle;
      for (let k = 1; k < 12; k++) {
        const a = a0 + (sweep * k) / 12;
        if (index.inside({ x: arc.centre.x + Math.cos(a) * arc.radius, y: arc.centre.y + Math.sin(a) * arc.radius })) return false;
      }
      return true;
    };
    // A bend wider than the model's limit has no speed limit, which is only fair if a vehicle can
    // actually sweep round it: test the arc at the limit radius. If that hits an obstacle, tighten.
    const start = v.straight ? MAX_RADIUS : v.radius;
    const trial = opts.slice(); trial[v.point] = { mode: 'fixed', radius: start };
    if (v.straight ? arcClear(trial) : arcClear(opts)) continue;
    let lo = 0.5, hi = start;
    for (let it = 0; it < 10; it++) {
      const mid = (lo + hi) / 2;
      const o = opts.slice(); o[v.point] = { mode: 'fixed', radius: mid };
      if (arcClear(o)) lo = mid; else hi = mid;
    }
    opts[v.point] = { mode: 'fixed', radius: lo };
  }
  return opts;
}

// Sample points along a LoP with their outward normals (pointing away from what is protected).
export function lopSamples(lop, assets, step) {
  const pts = lop.closed ? [...lop.points, lop.points[0]] : lop.points;
  const out = [];
  const ccw = lop.closed && signedArea(lop.points) > 0;
  const assetCentres = assets.map((a) => centroid(a.points));
  let s0 = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = dist(a, b);
    if (L < 1e-6) continue;
    const t = unit(sub(b, a));
    let n = { x: t.y, y: -t.x }; // right-hand normal
    if (lop.closed) { if (!ccw) n = mul(n, -1); } else if (assetCentres.length) {
      const mid = mul(add(a, b), 0.5);
      const c = assetCentres.reduce((best, q) => (dist(q, mid) < dist(best, mid) ? q : best));
      if (dot(sub(c, mid), n) > 0) n = mul(n, -1);
    }
    const count = Math.max(1, Math.round(L / step));
    for (let k = 0; k < count; k++) {
      const f = (k + 0.5) / count;
      out.push({ p: add(a, mul(sub(b, a), f)), n, tangent: t, s: s0 + f * L, lopId: lop.id, twoSided: !lop.closed && !assetCentres.length });
    }
    s0 += L;
  }
  return out;
}

function roadGraph(roads) {
  const key = (p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  const nodes = new Map(); // key -> {p, edges:[{to, len}]}
  const node = (p) => { const k = key(p); if (!nodes.has(k)) nodes.set(k, { k, p, edges: [] }); return nodes.get(k); };
  const segments = [];
  for (const r of roads) {
    for (let i = 0; i < r.length - 1; i++) {
      const a = node(r[i]), b = node(r[i + 1]), L = dist(a.p, b.p);
      if (L < 1e-6) continue;
      a.edges.push({ to: b, len: L }); b.edges.push({ to: a, len: L });
      segments.push({ a, b });
    }
  }
  return { nodes, segments };
}

// All simple paths leaving `start` (via first node(s)) until `budget` metres or a dead end.
function walkBack(firstHops, budget, cap = 60) {
  const out = [];
  const stack = firstHops.map(({ node, len, from }) => ({ path: [from, node.p], seen: new Set([node.k]), node, used: len }));
  while (stack.length && out.length < cap) {
    const cur = stack.pop();
    if (cur.used >= budget) { out.push({ path: cur.path, reachedRadius: true }); continue; }
    const next = cur.node.edges.filter((e) => !cur.seen.has(e.to.k));
    if (!next.length) { out.push({ path: cur.path, reachedRadius: false }); continue; }
    for (const e of next) {
      const remain = budget - cur.used;
      if (e.len >= remain) {
        const f = remain / e.len;
        out.push({ path: [...cur.path, add(cur.node.p, mul(sub(e.to.p, cur.node.p), f))], reachedRadius: true });
      } else {
        const seen = new Set(cur.seen); seen.add(e.to.k);
        stack.push({ path: [...cur.path, e.to.p], seen, node: e.to, used: cur.used + e.len });
      }
    }
  }
  return out;
}

/**
 * @returns {{ candidates: object[], all: object[], stats: object }} candidates (kept, fastest first) and all found, each
 *   { points, vertexOptions, start, kind, lopId, s, speeds, worst, note }
 */
export function generateVectors({ lops, assets = [], obstacles = [], roads = [], radius = 440, step = 10, binLength = 25, maxResults = 10, roadReach = 60, clearance = 1, openGround = true }) {
  const index = makeObstacleIndex([...obstacles, ...assets.map((a) => a.points)], clearance);
  // Impact angle (0–90°) of the final leg against the LoP at the sample point.
  const angleAt = (pts, tangent) => {
    const a = pts[pts.length - 2], b = pts[pts.length - 1], d = sub(b, a), l = Math.hypot(d.x, d.y);
    return (Math.asin(Math.min(1, Math.abs(cross(d, tangent)) / l)) * 180) / Math.PI;
  };
  const push = (c, smp) => all.push({ ...c, angle: angleAt(c.points, smp.tangent) });
  const lopLines = lops.map((l) => (l.closed ? [...l.points, l.points[0]] : l.points));
  // Where a ray first meets any LoP (beyond the start), as a fraction.
  const lopHit = (a, b) => {
    let best = null;
    for (const L of lopLines) for (let i = 0; i < L.length - 1; i++) {
      const h = segmentIntersect(a, b, L[i], L[i + 1]);
      if (h && h.t > 1e-3 && (best === null || h.t < best)) best = h.t;
    }
    return best;
  };
  const graph = roadGraph(roads);
  const all = [];
  let rays = 0, roadPaths = 0;

  for (const lop of lops) {
    for (const smp of lopSamples(lop, assets, step)) {
      const sides = smp.twoSided ? [smp.n, mul(smp.n, -1)] : [smp.n];
      for (const n of sides) {
        // Open ground (only when the assessor allows routes off the roads).
        const blockers = new Set();
        for (let deg = -75; openGround && deg <= 75; deg += 5) {
          const u = rot(n, (deg * Math.PI) / 180);
          const from = add(smp.p, mul(u, 0.5)), far = add(smp.p, mul(u, radius));
          const tb = index.firstHit(from, far, blockers), tl = lopHit(from, far);
          const t = Math.min(tb ?? Infinity, tl ?? Infinity);
          const runUp = Number.isFinite(t) ? 0.5 + t * (radius - 0.5) - 1 : radius;
          rays++;
          if (runUp < 5) continue;
          const startPt = add(smp.p, mul(u, runUp)), endPt = add(smp.p, mul(u, -1));
          const blocked = Number.isFinite(t);
          const start = blocked ? 'STANDING' : 'ROLLING';
          const sc = scoreVector([startPt, endPt], [], start);
          push({ points: [startPt, endPt], vertexOptions: [], start, kind: 'open', lopId: smp.lopId, s: smp.s, ...sc,
            note: blocked ? `Straight run across open ground, ${Math.round(runUp)} m from ${tb != null && (tl == null || tb <= tl) ? 'an obstacle' : 'the line of protection'} (standing start).` : `Straight run across open ground with a clear ${radius} m run-up (rolling start).` }, smp);
        }
        // Round the corner: a vehicle running along an obstacle that blocked a straight run can
        // swing round one of its corners onto the line. Corners are passed 1.5 m clear.
        for (const it of blockers) {
          const c = centroid(it.orig);
          for (const V of it.orig) { // the real corners, not the rounded clearance outline
            const away = sub(V, c), al = Math.hypot(away.x, away.y);
            if (al < 1e-6) continue;
            const corner = add(V, mul(away, 1.5 / al));
            const toT = sub(smp.p, corner), dT = Math.hypot(toT.x, toT.y);
            if (dT < 5 || dT > radius - 5 || dot(mul(toT, -1), n) <= 0) continue;
            const short = add(smp.p, mul(toT, -0.5 / dT)); // stop just before the line itself
            if (index.inside(corner) || index.firstHit(corner, smp.p) !== null || lopHit(corner, short) !== null) continue;
            const back = unit(mul(toT, -1)); // direction from the corner away from the line
            let best = null;
            for (let deg = -80; deg <= 80; deg += 10) {
              const d = rot(back, (deg * Math.PI) / 180), budget = radius - dT;
              const far = add(corner, mul(d, budget));
              const t = Math.min(index.firstHit(add(corner, mul(d, 0.5)), far) ?? Infinity, lopHit(add(corner, mul(d, 0.5)), far) ?? Infinity);
              const run = Number.isFinite(t) ? 0.5 + t * (budget - 0.5) - 1 : budget;
              if (run >= 5 && (!best || run > best.run)) best = { d, run, open: !Number.isFinite(t) };
            }
            if (!best) continue;
            const pts = [add(corner, mul(best.d, best.run)), corner, smp.p, add(smp.p, mul(unit(toT), 1))];
            try {
              const start = best.open ? 'ROLLING' : 'STANDING';
              const sc = scoreVector(pts, [], start); // upper bound: bends not yet limited by obstacles
              push({ points: pts, vertexOptions: null, start, kind: 'corner', lopId: smp.lopId, s: smp.s, ...sc,
                note: `Runs ${Math.round(best.run)} m alongside an obstacle, then round its corner onto the line (${start === 'ROLLING' ? 'rolling' : 'standing'} start).` }, smp);
            } catch { /* degenerate */ }
          }
        }
        // Road network.
        if (!graph.segments.length) continue;
        const near = [];
        for (const seg of graph.segments) {
          const q = nearestOnSegment(smp.p, seg.a.p, seg.b.p);
          if (q.d > roadReach || q.d < 1 || dot(sub(q.point, smp.p), n) <= 0) continue;
          near.push({ ...q, seg });
        }
        near.sort((a, b) => a.d - b.d);
        const picked = [];
        for (const q of near) {
          if (picked.length >= 3) break;
          if (picked.some((o) => dist(o.point, q.point) < 15)) continue;
          if (index.firstHit(q.point, smp.p) !== null) continue; // final leg must be clear
          picked.push(q);
        }
        for (const q of picked) {
          const budget = radius - q.d;
          const hops = [
            { node: q.seg.a, len: dist(q.point, q.seg.a.p), from: q.point },
            { node: q.seg.b, len: dist(q.point, q.seg.b.p), from: q.point },
          ];
          for (const w of walkBack(hops, budget)) {
            roadPaths++;
            const toLop = unit(sub(smp.p, q.point));
            const route = [...w.path].reverse(); // far end → road point
            // Skip roads that pass through the protected side before the final leg.
            if (route.some((pt, i) => i > 0 && lopHit(route[i - 1], pt) !== null)) continue;
            let pts = simplify([...route, smp.p, add(smp.p, mul(toLop, 1))], 1.5);
            if (pts.length < 2) continue;
            try {
              const start = w.reachedRadius ? 'ROLLING' : 'STANDING';
              const sc = scoreVector(pts, [], start); // upper bound: bends not yet limited by obstacles
              push({ points: pts, vertexOptions: null, start, kind: 'road', lopId: smp.lopId, s: smp.s, ...sc,
                note: w.reachedRadius ? `Along the road network for the full ${radius} m study radius, then off the road to the line (rolling start).` : 'Along the road network from a dead end, then off the road to the line (standing start).' }, smp);
            } catch { /* degenerate path */ }
          }
        }
      }
    }
  }

  // Keep the fastest per stretch of LoP, then the fastest overall. Ties (within 0.5 km/h) go to
  // the more head-on impact.
  const better = (a, b) => (Math.abs(a.worst - b.worst) > 0.5 ? a.worst > b.worst : a.angle > b.angle);
  // Bends are limited by obstacles only for candidates that could still win their bin: the
  // unlimited score is an upper bound, so anything already beaten by a refined winner is skipped.
  const bins = new Map();
  let refined = 0;
  all.sort((a, b) => b.worst - a.worst);
  for (const c of all) {
    const k = `${c.lopId}:${Math.floor(c.s / binLength)}`;
    const cur = bins.get(k);
    if (cur && c.worst < cur.worst - 0.5) continue;
    if (c.vertexOptions === null) {
      c.vertexOptions = obstacleLimitedRadii(c.points, index);
      Object.assign(c, scoreVector(c.points, c.vertexOptions, c.start));
      refined++;
    }
    if (!cur || better(c, cur)) bins.set(k, c);
  }
  const candidates = [...bins.values()].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0)).slice(0, maxResults);
  return { candidates, all, stats: { samples: all.length, rays, roadPaths, refined, bins: bins.size } };
}

