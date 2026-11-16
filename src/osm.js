// OpenStreetMap buildings and roads around a point, from the public Overpass API.
// Buildings become obstacles (a vehicle cannot pass through them); roads guide the vector search.
// Note: this sends the site's location to the Overpass service.

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
// Mapped barriers that stop a vehicle. Fences, hedges, gates and bollards are not included: most
// do not stop a vehicle, and the assessor can draw the ones that do.
export const WALLS = ['wall', 'retaining_wall', 'city_wall', 'jersey_barrier', 'block'];
const NOT_ROADS = new Set(['steps', 'elevator', 'proposed', 'construction', 'platform', 'corridor', 'bus_stop', 'raceway']);

export async function fetchOSM({ lat, lng }, radius, signal) {
  const r = Math.round(radius);
  const q = `[out:json][timeout:25];(way["building"](around:${r},${lat},${lng});way["highway"](around:${r},${lat},${lng});way["barrier"~"^(${WALLS.join('|')})$"](around:${r},${lat},${lng}););out geom;`;
  const res = await fetch(ENDPOINT, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
  if (!res.ok) throw new Error(res.status === 429 || res.status === 504 ? 'The map data service is busy. Try again in a minute.' : `Map data request failed (${res.status})`);
  return parseOverpass(await res.json());
}

// Returns { buildings: [{id, ll}], roads: [{id, kind, ll}], walls: [{id, kind, ll}] } with ll = [{lng,lat}]
export function parseOverpass(json) {
  const buildings = [], roads = [], walls = [];
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const ll = el.geometry.map((g) => ({ lng: g.lon, lat: g.lat }));
    const tags = el.tags || {};
    if (tags.building) {
      if (ll.length > 3 && ll[0].lng === ll[ll.length - 1].lng && ll[0].lat === ll[ll.length - 1].lat) ll.pop();
      if (ll.length >= 3) buildings.push({ id: el.id, ll });
    } else if (tags.barrier && WALLS.includes(tags.barrier) && ll.length >= 2) {
      walls.push({ id: el.id, kind: tags.barrier, ll });
    } else if (tags.highway && !NOT_ROADS.has(tags.highway) && ll.length >= 2) {
      roads.push({ id: el.id, kind: tags.highway, ll });
    }
  }
  return { buildings, roads, walls };
}
