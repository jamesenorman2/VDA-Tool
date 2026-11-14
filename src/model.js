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
  const lop = project.lops.find((l) => l.id === vector.lopId);
  if (lop) {
    crossing = clipAtLop(points, lop.points);
    if (!crossing) errors.push('This vector does not cross the line of protection');
    else points = crossing.points;
  }
  try {
    const r = polylineToSections(points, vector.vertexOptions || []);
    return { sections: r.sections, pieces: r.pieces, vertices: r.vertices, warnings: r.warnings, errors, crossing };
  } catch (e) {
    return { sections: [], warnings: [], errors: [...errors, e.message], crossing };
  }
}
