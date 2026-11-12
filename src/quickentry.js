// Parse quick-entry text into route sections (all lengths returned in metres).
//   s 45            straight, 45 m
//   l 30 25         left curve, arc length 30 m, radius 25 m
//   r 30,25,High St right curve (commas, tabs or spaces; trailing text = description)
//   l 100ft 50ft    units: mm cm m ft in ' "   (a space before mm/cm/m/ft is fine; write 45in or 45" for inches)
// Decimals use a dot: commas are separators, so "l 12,5" means length 12, radius 5.
// A "type,length,radius,description" header line is ignored, so exported CSV re-imports.
import { MAX_RADIUS } from './maths.js';

const UNIT = { mm: 0.001, cm: 0.01, m: 1, ft: 0.3048, "'": 0.3048, in: 0.0254, '"': 0.0254 };
// "in" is only a unit when attached to the number (45in): as a separate word it is far more likely
// the start of a description ("s 45 in High Street").
const SPACED_UNITS = new Set(['mm', 'cm', 'm', 'ft']);
const TYPES = { s: 'STRAIGHT', st: 'STRAIGHT', straight: 'STRAIGHT', l: 'CURVE_LEFT', left: 'CURVE_LEFT', r: 'CURVE_RIGHT', right: 'CURVE_RIGHT' };
const NUM = /^(\d+\.?\d*|\.\d+)(mm|cm|m|ft|in|'|")?$/i;
const round = (n) => Math.round(n * 1000) / 1000;

export function parseQuickEntry(text) {
  const sections = [], notes = [], errors = [];
  text.split(/\r?\n/).forEach((raw, ln) => {
    const hash = raw.indexOf('#');
    const body = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    let desc = hash >= 0 ? raw.slice(hash + 1).trim() : '';
    if (!body) return;
    let toks = body.split(/[\s,;]+/).filter(Boolean);
    // Allow the type letter to run into the first number: "S45", "l30 25".
    const glued = /^(straight|left|right|st|s|l|r)(\d.*)$/i.exec(toks[0]);
    if (glued) toks = [glued[1], glued[2], ...toks.slice(1)];
    const type = TYPES[toks[0].toLowerCase()];
    if (!type) {
      if (toks[0].toLowerCase() === 'type') return; // CSV header
      errors.push(`Line ${ln + 1}: "${raw.trim()}" – start with s, l or r`);
      return;
    }
    // Join "45" "ft" into "45ft".
    const merged = [];
    for (const t of toks.slice(1)) {
      if (SPACED_UNITS.has(t.toLowerCase()) && merged.length && NUM.test(merged[merged.length - 1]) && !/[a-z'"]$/i.test(merged[merged.length - 1])) merged[merged.length - 1] += t;
      else merged.push(t);
    }
    const nums = [];
    let k = 0;
    while (k < merged.length) {
      const m = NUM.exec(merged[k]);
      if (!m) break;
      nums.push(round(parseFloat(m[1]) * (m[2] ? UNIT[m[2].toLowerCase()] : 1)));
      k++;
    }
    const rest = merged.slice(k).join(' ').replace(/^"|"$/g, '');
    if (rest) desc = desc ? `${rest} ${desc}` : rest;
    const need = type === 'STRAIGHT' ? 1 : 2;
    if (nums.length !== need) {
      errors.push(`Line ${ln + 1}: "${raw.trim()}" – ${type === 'STRAIGHT' ? 'a straight needs a length' : 'a curve needs a length then a radius'}`);
      return;
    }
    if (type !== 'STRAIGHT') {
      if (nums[1] <= 0) { errors.push(`Line ${ln + 1}: radius must be above 0`); return; }
      if (nums[1] > MAX_RADIUS) {
        // No cornering limit applies beyond the model's range; treating it as a straight never understates speed.
        notes.push(`Line ${ln + 1}: radius ${nums[1]} m is over the ${MAX_RADIUS} m limit – entered as a straight (conservative).`);
        sections.push({ sType: 'STRAIGHT', sLength: nums[0], radius: MAX_RADIUS, description: desc });
        return;
      }
      sections.push({ sType: type, sLength: nums[0], radius: nums[1], description: desc });
    } else sections.push({ sType: 'STRAIGHT', sLength: nums[0], radius: MAX_RADIUS, description: desc });
  });
  return { sections, notes, errors };
}
