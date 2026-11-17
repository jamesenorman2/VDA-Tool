// OpenStreetMap buildings, roads, walls and water around a point, from the public Overpass API.
// Buildings, walls and water become obstacles (a vehicle cannot pass through them); roads guide
// the vector search. Note: this sends the site's location to the Overpass service.

// Public Overpass servers, tried in turn: the main one is often busy.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// Mapped barriers that stop a vehicle. Fences, hedges, gates and bollards are not included: most
// do not stop a vehicle, and the assessor can draw the ones that do.
export const WALLS = ['wall', 'retaining_wall', 'city_wall', 'jersey_barrier', 'block'];
// Watercourses a vehicle cannot drive across, with the width (m) used when none is mapped.
// Ditches and drains are left out: many can be driven over; the assessor can draw those that cannot.
export const WATERWAYS = { river: 8, canal: 8, stream: 2 };
const NOT_ROADS = new Set(['steps', 'elevator', 'proposed', 'construction', 'platform', 'corridor', 'bus_stop', 'raceway']);
const isWaterArea = (t) => t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin';

export function overpassQuery({ lat, lng }, radius) {
  const a = `(around:${Math.round(radius)},${lat},${lng})`;
  return `[out:json][timeout:40];(way["building"]${a};relation["building"]${a};way["highway"]${a};way["barrier"~"^(${WALLS.join('|')})$"]${a};way["natural"="water"]${a};relation["natural"="water"]${a};way["waterway"~"^(riverbank|${Object.keys(WATERWAYS).join('|')})$"]${a};way["landuse"~"^(reservoir|basin)$"]${a};);out geom;`;
}

export async function fetchOSM(centre, radius, signal) {
  return parseOverpass(await overpass(overpassQuery(centre, radius), signal));
}

// Just the building(s) containing a point: a small, quick request.
export async function fetchBuildingAt({ lat, lng }, signal) {
  const q = `[out:json][timeout:15];is_in(${lat},${lng})->.a;(way(pivot.a)["building"];relation(pivot.a)["building"];);out geom;`;
  return parseOverpass(await overpass(q, signal)).buildings;
}

async function overpass(query, signal) {
  const body = 'data=' + encodeURIComponent(query);
  let last;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
      if (res.ok) {
        const json = await res.json();
        // A server that ran out of time returns a partial answer with a remark: try the next one.
        if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) { last = new Error('The map data service ran out of time.'); continue; }
        return json;
      }
      last = new Error(res.status === 429 || res.status === 504 ? 'The map data service is busy. Try again in a minute.' : `Map data request failed (${res.status})`);
    } catch (e) {
      if (signal?.aborted) throw e;
      last = new Error('The map data service could not be reached.');
    }
  }
  throw last;
}

const same = (p, q) => p.lng === q.lng && p.lat === q.lat;
// Join the outer member ways of a multipolygon into closed rings.
function rings(members) {
  const parts = members.filter((m) => m.type === 'way' && m.role !== 'inner' && Array.isArray(m.geometry) && m.geometry.length >= 2).map((m) => m.geometry.map((g) => ({ lng: g.lon, lat: g.lat })));
  const out = [];
  while (parts.length) {
    let ring = parts.shift();
    let grown = true;
    while (!same(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i], end = ring[ring.length - 1];
        if (same(p[0], end)) ring = ring.concat(p.slice(1));
        else if (same(p[p.length - 1], end)) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        parts.splice(i, 1); grown = true; break;
      }
    }
    if (same(ring[0], ring[ring.length - 1])) ring.pop();
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}
const closedRing = (ll) => { const r = ll.slice(); if (r.length > 3 && same(r[0], r[r.length - 1])) r.pop(); return r; };

// Returns { buildings: [{id, ll}], roads: [{id, kind, ll}], walls: [{id, kind, ll}],
//   water: [{id, kind, ll}] (areas), waterways: [{id, kind, width, ll}] (lines) } with ll = [{lng,lat}]
export function parseOverpass(json) {
  const buildings = [], roads = [], walls = [], water = [], waterways = [];
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    if (el.type === 'relation') {
      if (!Array.isArray(el.members)) continue;
      const rs = rings(el.members);
      if (tags.building) rs.forEach((ll, k) => buildings.push({ id: `r${el.id}${k ? `-${k}` : ''}`, ll }));
      else if (isWaterArea(tags)) rs.forEach((ll, k) => water.push({ id: `r${el.id}${k ? `-${k}` : ''}`, kind: 'water', ll }));
      continue;
    }
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const ll = el.geometry.map((g) => ({ lng: g.lon, lat: g.lat }));
    if (tags.building) {
      const r = closedRing(ll);
      if (r.length >= 3) buildings.push({ id: el.id, ll: r });
    } else if (tags.barrier && WALLS.includes(tags.barrier) && ll.length >= 2) {
      walls.push({ id: el.id, kind: tags.barrier, ll });
    } else if (isWaterArea(tags)) {
      const r = closedRing(ll);
      if (r.length >= 3 && same(ll[0], ll[ll.length - 1])) water.push({ id: el.id, kind: 'water', ll: r });
    } else if (tags.waterway && WATERWAYS[tags.waterway] && ll.length >= 2) {
      const w = parseFloat(tags.width);
      waterways.push({ id: el.id, kind: tags.waterway, width: w > 0 && w < 100 ? w : WATERWAYS[tags.waterway], ll });
    } else if (tags.highway && !NOT_ROADS.has(tags.highway) && ll.length >= 2) {
      // Culverts and bridges carry the road over the water, so roads are never cut by waterways.
      roads.push({ id: el.id, kind: tags.highway, ll });
    }
  }
  return { buildings, roads, walls, water, waterways };
}
