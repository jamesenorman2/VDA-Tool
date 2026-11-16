// OpenStreetMap buildings and roads around a point, from the public Overpass API.
// Buildings become obstacles (a vehicle cannot pass through them); roads guide the vector search.
// Note: this sends the site's location to the Overpass service.

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const NOT_ROADS = new Set(['steps', 'elevator', 'proposed', 'construction', 'platform', 'corridor', 'bus_stop', 'raceway']);

export async function fetchOSM({ lat, lng }, radius, signal) {
  const q = `[out:json][timeout:25];(way["building"](around:${Math.round(radius)},${lat},${lng});way["highway"](around:${Math.round(radius)},${lat},${lng}););out geom;`;
  const res = await fetch(ENDPOINT, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
  if (!res.ok) throw new Error(res.status === 429 || res.status === 504 ? 'The map data service is busy. Try again in a minute.' : `Map data request failed (${res.status})`);
  return parseOverpass(await res.json());
}

// Returns { buildings: [{id, ll:[{lng,lat}]}], roads: [{id, kind, ll:[{lng,lat}]}] }
export function parseOverpass(json) {
  const buildings = [], roads = [];
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const ll = el.geometry.map((g) => ({ lng: g.lon, lat: g.lat }));
    const tags = el.tags || {};
    if (tags.building) {
      if (ll.length > 3 && ll[0].lng === ll[ll.length - 1].lng && ll[0].lat === ll[ll.length - 1].lat) ll.pop();
      if (ll.length >= 3) buildings.push({ id: el.id, ll });
    } else if (tags.highway && !NOT_ROADS.has(tags.highway) && ll.length >= 2) {
      roads.push({ id: el.id, kind: tags.highway, ll });
    }
  }
  return { buildings, roads };
}
