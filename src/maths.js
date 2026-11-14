// Pure vehicle-dynamics maths: straight-line acceleration, cornering, route traversal.
// Speeds are km/h, distances metres.

export const MAX_RADIUS = 150;
export const KPH_PER_MPH = 1.609344;
export const GRAVITY = 9.81;
export const TERMINAL_DISTANCE = 440;

function makeVehicle(id, name, colour, bands, mu, slipMph) {
  let from = 0;
  const built = bands.map(([a, b, to]) => {
    const band = { a, b, from, to, toSpeed: a * Math.pow(to, b) };
    from = to;
    return band;
  });
  const last = built[built.length - 1];
  const slipSpeed = slipMph == null ? null : slipMph * KPH_PER_MPH;
  const slipRadius = slipSpeed == null ? MAX_RADIUS : (slipSpeed / 3.6) ** 2 / (mu * GRAVITY);
  return { id, name, colour, bands: built, plateau: last.toSpeed, mu, slipSpeed, slipRadius };
}

export const VEHICLES = [
  makeVehicle('CAR', '1.5t Car (M1)', '#1f77b4', [[9.99132, 0.46837, 20], [13.59771, 0.36429, 440]], 0.72, null),
  makeVehicle('PICKUP', '2.5t 4x4 / Pick-up (N1G)', '#ff7f0e', [[11.53982, 0.35988, 105], [13.90083, 0.3199, 440]], 0.537, 60.6),
  makeVehicle('FLATBED', '3.5t Flatbed (N1)', '#2ca02c', [[9.96979, 0.3938, 55], [14.10138, 0.30815, 440]], 0.66, 57.2),
  makeVehicle('SEVENTRIGID', '7.5t Two-axle rigid (N2)', '#d62728', [[7.82445, 0.38255, 440]], 0.572, 49.9),
  makeVehicle('EIGHTEENTRIGID', '18t Two-axle rigid (N3)', '#9467bd', [[5.93135, 0.39629, 280], [8.9997, 0.32245, 440]], 0.532829331519467, 39.8),
  makeVehicle('THIRTYTRIGID', '30t Four-axle rigid (N3)', '#8c564b', [[5.88472, 0.3963, 440]], 0.34, 40.8),
];

export function speedAtDistance(v, d) {
  if (d >= TERMINAL_DISTANCE) return v.plateau;
  if (d <= 0) return 0;
  const band = v.bands.find((b) => d < b.to);
  return band.a * Math.pow(d, band.b);
}

export function distanceForSpeed(v, s) {
  if (s >= v.plateau) return TERMINAL_DISTANCE;
  if (s <= 0) return 0;
  const band = v.bands.find((b) => s < b.toSpeed);
  return Math.pow(s / band.a, 1 / band.b);
}

export function maxCorneringSpeed(v, radius) {
  if (radius <= v.slipRadius) return 3.6 * Math.sqrt(radius * v.mu * GRAVITY);
  if (radius <= MAX_RADIUS) return v.slipSpeed;
  return Infinity;
}

const isCurve = (s) => s.sType === 'CURVE_LEFT' || s.sType === 'CURVE_RIGHT';

// A section may carry `capAfter` (km/h): a speed cap at its asset-side end, e.g. a gate or a
// forced stop (0). After a cap, acceleration resumes from the capped speed.
export function traverseSection(v, state, section) {
  return applyCap(moveThrough(v, state, section), section.capAfter);
}

function moveThrough(v, state, section) {
  if (section.sLength === 0) return state;
  const base = state.accDistance != null ? state.accDistance : distanceForSpeed(v, state.speed);
  const newDistance = base + section.sLength;
  const straightSpeed = speedAtDistance(v, newDistance);
  if (isCurve(section)) {
    const corner = maxCorneringSpeed(v, section.radius);
    if (corner < straightSpeed) return { speed: corner, accDistance: null };
  }
  return { speed: straightSpeed, accDistance: newDistance };
}

function applyCap(state, cap) {
  if (!Number.isFinite(cap) || state.speed <= cap) return state;
  return { speed: Math.max(0, cap), accDistance: null };
}

export function startingSpeeds(routeStart, vehicles = VEHICLES) {
  const m = new Map();
  for (const v of vehicles) {
    m.set(v.id, routeStart === 'ROLLING'
      ? { speed: v.plateau, accDistance: Infinity }
      : { speed: 0, accDistance: null });
  }
  return m;
}

// sections[0] is nearest the asset. Result[i] = state at asset-side end of sections[i];
// result[sections.length] = the start of the route.
export function buildRouteSpeeds(sections, routeStart, vehicles = VEHICLES) {
  const total = sections.reduce((t, s) => t + s.sLength, 0);
  let current = startingSpeeds(routeStart, vehicles);
  const result = [];
  result[sections.length] = { section: null, distanceToAsset: total, exitSpeeds: current };
  let remaining = total;
  for (let i = sections.length - 1; i >= 0; i--) {
    remaining -= sections[i].sLength;
    const next = new Map();
    for (const v of vehicles) next.set(v.id, traverseSection(v, current.get(v.id), sections[i]));
    result[i] = { section: sections[i], distanceToAsset: Math.max(0, remaining), exitSpeeds: next };
    current = next;
  }
  return result;
}

// Split sections into finer pieces for a smooth chart. Piece length is at least
// minLength and aims for total/budget. The piece at the asset-side end of each
// original section (lowest index of its group) is flagged `major`.
export function subdivide(sections, budget = 250, minLength = 2) {
  const total = sections.reduce((t, s) => t + s.sLength, 0);
  const target = Math.max(total / budget, minLength);
  const out = [];
  sections.forEach((s, parentIndex) => {
    const n = Math.max(1, Math.ceil(s.sLength / target));
    for (let k = 0; k < n; k++) {
      const piece = { ...s, sLength: s.sLength / n, parentIndex, major: k === 0 };
      // A cap sits at the asset-side end of the section, i.e. only on its k === 0 piece.
      if (k !== 0) delete piece.capAfter;
      out.push(piece);
    }
  });
  return out;
}

export function chartSeries(sections, routeStart, vehicles = VEHICLES) {
  const fine = subdivide(sections);
  const rows = buildRouteSpeeds(fine, routeStart, vehicles);
  return rows.map((r, i) => ({
    distance: r.distanceToAsset,
    major: i === fine.length || fine[i].major,
    section: r.section ? sections[r.section.parentIndex] : null,
    speeds: Object.fromEntries(vehicles.map((v) => [v.id, r.exitSpeeds.get(v.id).speed])),
  }));
}

export function validateSection(s) {
  const errors = {};
  if (!Number.isFinite(s.sLength) || s.sLength < 0) errors.sLength = 'Length must be a number ≥ 0';
  if (isCurve(s) && !(Number.isFinite(s.radius) && s.radius > 0 && s.radius <= MAX_RADIUS)) {
    errors.radius = `Radius must be > 0 and ≤ ${MAX_RADIUS}`;
  }
  if (s.capAfter != null && !(Number.isFinite(s.capAfter) && s.capAfter >= 0)) errors.capAfter = 'Speed cap must be a number ≥ 0';
  return errors;
}

// Nominal mass per class (kg), used for impact energy (½·m·v²).
export const MASS_KG = { CAR: 1500, PICKUP: 2500, FLATBED: 3500, SEVENTRIGID: 7500, EIGHTEENTRIGID: 18000, THIRTYTRIGID: 30000 };
// Impact test speeds (km/h) used by ISO 22343 / IWA 14-1 / PAS 68 test series.
export const TEST_SPEEDS_KPH = [16, 32, 48, 64, 80, 96, 112];
export const nextTestSpeed = (kph) => TEST_SPEEDS_KPH.find((t) => t >= kph - 1e-9) ?? null;
