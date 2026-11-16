// Project model (spec §6). Plain JSON-serialisable objects; geometry in the local metric frame
// (metres, y-up). Derived data (sections, speeds) is computed, never stored as truth.

import { MAX_RADIUS } from './maths.js';
import { polylineToSections } from './geometry/fillet.js';
import { clipAtLop } from './geometry/clip.js';

export const PROJECT_VERSION = 1;

let seq = 0;
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * @typedef {{x:number,y:number}} Pt
 * @typedef {{ mode:'max'|'fixed', radius?:number, note?:string }} VertexOption
 * @typedef {{ id:string, name:string, start:'ROLLING'|'STANDING', source:'manual'|'drawn'|'generated',
 *   sections?:object[], points?:Pt[], vertexOptions?:VertexOption[], lopId?:string|null,
 *   excludedClasses:{id:string, reason:string}[], status:'draft'|'accepted'|'rejected', statusReason?:string,
 *   notes:string }} Vector
 */

export function newProject(o = {}) {
  return {
    version: PROJECT_VERSION, id: uid('prj'), title: '', marking: null,
    settings: { unit: 'KPH', order: 'FROM_START', classSet: 'CURRENT' },
    baseLayers: [], assets: [], lops: [], vectors: [], audit: [],
    createdAt: new Date().toISOString(), ...o,
  };
}

/** @returns {Vector} */
export function newVector(o = {}) {
  return {
    id: uid('vec'), name: 'Vector', start: 'ROLLING', source: 'manual',
    sections: [], points: [], vertexOptions: [], lopId: null,
    excludedClasses: [], status: 'draft', notes: '', ...o,
  };
}

// The pre-project app stored one route in localStorage ('vda-tool-state-v1'). It becomes a
// project with one manual vector whose sections are unchanged (still nearest the asset first).
export function migrateLegacyState(legacy = {}) {
  const sections = (legacy.sections || []).map((s) => ({
    id: s.id, sType: s.sType || 'STRAIGHT', sLength: +s.sLength || 0,
    radius: s.radius ?? MAX_RADIUS, description: s.description || '',
  }));
  return newProject({
    title: legacy.title || '',
    settings: { unit: legacy.unit === 'MPH' ? 'MPH' : 'KPH', order: legacy.order === 'FROM_ASSET' ? 'FROM_ASSET' : 'FROM_START', classSet: 'CURRENT' },
    vectors: [newVector({ name: 'Route 1', start: legacy.start === 'STANDING' ? 'STANDING' : 'ROLLING', source: 'manual', sections })],
  });
}

// Sections for the engine, plus what the drawing produced: impact angle, warnings, errors.
export function resolveVector(project, vector) {
  if (vector.source === 'manual') return { sections: vector.sections, warnings: [], errors: [], crossing: null };
  const errors = [];
  if ((vector.points || []).length < 2) return { sections: [], warnings: [], errors: ['Draw at least two points'], crossing: null };
  let points = vector.points, crossing = null;
  // A vector tied to one LoP uses it; otherwise the first LoP it crosses, measured along the vector.
  const lops = vector.lopId ? project.lops.filter((l) => l.id === vector.lopId) : project.lops;
  for (const lop of lops) {
    const c = clipAtLop(points, lop.closed ? [...lop.points, lop.points[0]] : lop.points);
    if (c && (!crossing || pathLength(c.points) < pathLength(crossing.points))) crossing = { ...c, lopId: lop.id };
  }
  if (lops.length && !crossing) errors.push('This vector does not cross the line of protection');
  if (crossing) points = crossing.points;
  try {
    const r = polylineToSections(points, vector.vertexOptions || []);
    // Speed-limit points (gates, chicanes, forced stops) are stored as map points and placed on
    // the route by projecting them onto the drawn path each time.
    const caps = (vector.caps || []).map((c) => ({ ...c, at: distanceAlong(r.pieces, c.point) })).filter((c) => c.at > 0.05 && c.at < r.length - 0.05);
    const sections = caps.length ? applyCaps(r.sections, caps) : r.sections;
    return { sections, pieces: r.pieces, vertices: r.vertices, warnings: r.warnings, errors, crossing, caps };
  } catch (e) {
    return { sections: [], warnings: [], errors: [...errors, e.message], crossing };
  }
}

export const pathLength = (pts) => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

// Split route sections (nearest-asset first) at distances from the START of the route and put a
// speed cap at each split. caps: [{ at: metres from the start, kph }]. A cap of 0 is a forced stop.
export function applyCaps(sections, caps) {
  const travel = [...sections].reverse().map((x) => ({ ...x }));
  for (const cap of [...caps].sort((a, b) => a.at - b.at)) {
    let run = 0;
    for (let i = 0; i < travel.length; i++) {
      const s = travel[i], end = run + s.sLength;
      if (cap.at <= end + 1e-9) {
        const first = cap.at - run;
        if (first < s.sLength - 1e-6 && first > 1e-6) {
          travel.splice(i, 1, { ...s, sLength: first, capAfter: Math.min(cap.kph, s.capAfter ?? Infinity) }, { ...s, sLength: s.sLength - first, capAfter: s.capAfter });
          if (travel[i + 1].capAfter === undefined) delete travel[i + 1].capAfter;
        } else {
          const k = first <= 1e-6 && i > 0 ? i - 1 : i;
          travel[k].capAfter = Math.min(cap.kph, travel[k].capAfter ?? Infinity);
        }
        break;
      }
      run = end;
    }
  }
  return travel.reverse();
}

// Distance from the start of a filleted route (pieces in travel order) to the point on it nearest p.
export function distanceAlong(pieces, p) {
  let best = { d: Infinity, at: 0 }, run = 0;
  for (const q of pieces) {
    const pts = q.kind === 'line' ? [q.from, q.to] : arcPoints(q, 24);
    let local = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
      const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
      if (d < best.d) best = { d, at: run + (local + t * L) * (q.length / (q.kind === 'line' ? q.length : chordLength(pts))) };
      local += L;
    }
    run += q.length;
  }
  return best.at;
}
const chordLength = (pts) => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0) || 1;
export function arcPoints(a, n) {
  const a0 = Math.atan2(a.from.y - a.centre.y, a.from.x - a.centre.x), sweep = (a.side === 'LEFT' ? 1 : -1) * a.angle;
  return Array.from({ length: n + 1 }, (_, k) => ({ x: a.centre.x + Math.cos(a0 + (sweep * k) / n) * a.radius, y: a.centre.y + Math.sin(a0 + (sweep * k) / n) * a.radius }));
}
