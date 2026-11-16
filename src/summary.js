// Required protection along each line of protection (LoP).
//
// Each LoP is split into lettered sections (A, B, C…) at its corners, so a consultant can say
// "section B needs a barrier tested to 64 km/h". For each section the governing vector is the
// firm (accepted or drawn) vector with the highest impact speed crossing it.

import { VEHICLES, MASS_KG, MAX_TEST_SPEED_KPH, nextTestSpeed } from './maths.js';

const heading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const turn = (h0, h1) => { let d = h1 - h0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };

// The ISO 22343-1 test vehicle each of the tool's classes is rated against, as confirmed by the
// owner (16 Nov 2026). The 18 t class maps to N3F (24 000 kg, 3-axle): heavier than the threat, so
// a barrier rated for it covers the 18 t vehicle. Other standards (PAS 68, IWA 14-1, ASTM F2656)
// are not mapped yet.
export const ISO_CLASS = {
  CAR: { code: 'M1', mass: 1500, name: '1 500 kg car' },
  PICKUP: { code: 'N1G', mass: 2500, name: '2 500 kg 4x4 crew-cab pick-up' },
  FLATBED: { code: 'N1', mass: 3500, name: '3 500 kg flatbed, single cab' },
  SEVENTRIGID: { code: 'N2A', mass: 7200, name: '7 200 kg 2-axle rigid' },
  EIGHTEENTRIGID: { code: 'N3F', mass: 24000, name: '24 000 kg 3-axle rigid' },
  THIRTYTRIGID: { code: 'N3G', mass: 30000, name: '30 000 kg 4-axle rigid' },
};
// ISO 22343-1 performance requirement for a section and class, e.g. V/7200[N2A]/64/90. The
// penetration and debris parts of the rating come from the product, not from the VDA.
export const isoDesignation = (classId, testKph) => (testKph ? `V/${ISO_CLASS[classId].mass}[${ISO_CLASS[classId].code}]/${testKph}/90` : `no test above ${MAX_TEST_SPEED_KPH[classId]} km/h`);
export const draftDesignation = isoDesignation; // former name

// Split a LoP into sections at its corners. Main sides are the long edges (at least 8 m and a
// fifth of the longest); consecutive main sides within 35° of each other form one section. Short
// edges in between (rounded corners of a standoff line, kinks) join whichever neighbouring section
// they are closer to in direction. Returns [{ edges: [edge indices], length, points }].
export function splitLop(lop) {
  const P = lop.points, n = lop.closed ? P.length : P.length - 1;
  const edges = Array.from({ length: n }, (_, i) => {
    const a = P[i], b = P[(i + 1) % P.length];
    return { i, len: Math.hypot(b.x - a.x, b.y - a.y), h: heading(a, b) };
  });
  if (!edges.length) return [];
  const longest = Math.max(...edges.map((e) => e.len));
  const isMain = (e) => e.len >= Math.max(8, 0.2 * longest);
  const out = (groups) => groups.map((g) => ({ edges: g, length: g.reduce((t, i) => t + edges[i].len, 0), points: [P[g[0]], ...g.map((i) => P[(i + 1) % P.length])] }));
  if (!edges.some(isMain)) return out([edges.map((e) => e.i)]);
  // For a loop, start at a main edge that begins a new direction, so no section wraps the start.
  let order = edges;
  if (lop.closed) {
    const mains = edges.filter(isMain);
    const startEdge = mains.find((e, k) => turn(mains[(k - 1 + mains.length) % mains.length].h, e.h) > (35 * Math.PI) / 180) || mains[0];
    order = edges.slice(startEdge.i).concat(edges.slice(0, startEdge.i));
  }
  // Group main edges by direction.
  const groups = []; // { h, edges: [], mainIdx: [] }
  for (const e of order) {
    if (!isMain(e)) continue;
    const g = groups[groups.length - 1];
    if (g && turn(g.h, e.h) <= (35 * Math.PI) / 180 && order.indexOf(e) - order.indexOf(edges[g.last]) <= 1 + order.slice(order.indexOf(edges[g.last]) + 1, order.indexOf(e)).filter((x) => !isMain(x)).length) {
      g.last = e.i;
    } else groups.push({ h: e.h, first: e.i, last: e.i });
  }
  // Assign every edge (in order) to a group: main edges to their own, joiners to the nearer one.
  const assigned = groups.map(() => []);
  let gi = 0, pending = [];
  const flush = (nextG) => {
    for (const e of pending) {
      const prev = gi < groups.length ? Math.min(gi, groups.length - 1) : groups.length - 1;
      const pick = nextG == null ? prev : (turn(groups[prev].h, e.h) <= turn(groups[nextG].h, e.h) ? prev : nextG);
      assigned[pick].push(e.i);
    }
    pending = [];
  };
  let started = false;
  for (const e of order) {
    if (isMain(e)) {
      const g = groups.findIndex((x) => order.indexOf(edges[x.first]) <= order.indexOf(e) && order.indexOf(e) <= order.indexOf(edges[x.last]));
      if (!started) { assigned[g].push(...pending.map((x) => x.i)); pending = []; started = true; }
      else if (g !== gi) flush(g); else { assigned[gi].push(...pending.map((x) => x.i)); pending = []; }
      gi = g; assigned[g].push(e.i);
    } else pending.push(e);
  }
  // Trailing joiners: for a loop they sit between the last and first groups; for a line, the last.
  if (pending.length) { if (lop.closed) flush(0); else { assigned[gi].push(...pending.map((x) => x.i)); pending = []; } }
  // Keep each group's edges contiguous in route order. On a loop a group can wrap past edge 0, so
  // start it at the edge whose predecessor is not in the group.
  return out(assigned.map((g) => {
    const set = new Set(g);
    const start = lop.closed ? (g.find((i) => !set.has((i - 1 + n) % n)) ?? g[0]) : Math.min(...g);
    return g.slice().sort((a, b) => ((a - start + n) % n) - ((b - start + n) % n));
  }));
}

const label = (k) => (k < 26 ? String.fromCharCode(65 + k) : `${String.fromCharCode(64 + Math.floor(k / 26))}${String.fromCharCode(65 + (k % 26))}`);

/**
 * @param lops project.lops
 * @param vectors [{ vector, result }] where result has speeds, worst, crossing {lopId, lopSegment, angle}
 * @returns sections: [{ label, lopId, lopName, length, points, edges, firm: [...], pending, rejected,
 *   speeds: {classId: max kph}, worst, governing: {id, name, angle} | null, tests: {classId: kph|null} }]
 */
export function requiredProtection(lops, vectors) {
  const sections = [];
  let k = 0;
  for (const lop of lops) {
    for (const sec of splitLop(lop)) sections.push({ label: label(k++), lopId: lop.id, lopName: lop.name, ...sec, firm: [], pending: 0, rejected: 0 });
  }
  for (const { vector, result } of vectors) {
    if (!result?.speeds || !result.crossing) continue;
    const sec = sections.find((s) => s.lopId === result.crossing.lopId && s.edges.includes(result.crossing.lopSegment));
    if (!sec) continue;
    if (vector.status === 'suggested') { sec.pending++; continue; }
    if (vector.status === 'rejected') { sec.rejected++; continue; }
    sec.firm.push({ id: vector.id, name: vector.name, speeds: result.speeds, worst: result.worst, angle: result.crossing.angle });
  }
  for (const s of sections) {
    s.speeds = {}; s.tests = {};
    for (const v of VEHICLES) {
      const m = s.firm.length ? Math.max(...s.firm.map((f) => f.speeds[v.id])) : null;
      s.speeds[v.id] = m; s.tests[v.id] = m == null ? null : nextTestSpeed(m, v.id);
    }
    const g = s.firm.length ? s.firm.reduce((a, b) => (b.worst > a.worst ? b : a)) : null;
    s.worst = g ? g.worst : null;
    s.governing = g ? { id: g.id, name: g.name, angle: g.angle } : null;
  }
  return sections;
}
