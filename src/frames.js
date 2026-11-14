// Coordinate frames. All assessment geometry lives in a local metric frame (metres, x east,
// y north) centred on the project anchor. MapLibre works in longitude/latitude.
//
// The local frame is a tangent plane using the WGS84 radii of curvature at the anchor. Within the
// 440 m study ring its distance error is well under 1 cm per 100 m.

const A = 6378137;
const E2 = 0.00669437999014;
const RAD = Math.PI / 180;

function radii(lat) {
  const s = Math.sin(lat * RAD), w = 1 - E2 * s * s;
  return { M: (A * (1 - E2)) / Math.pow(w, 1.5), N: A / Math.sqrt(w) };
}

/** @param {{lng:number,lat:number}} anchor */
export function makeFrame(anchor) {
  const { M, N } = radii(anchor.lat);
  const kx = N * Math.cos(anchor.lat * RAD) * RAD, ky = M * RAD;
  return {
    anchor,
    toLocal: ({ lng, lat }) => ({ x: (lng - anchor.lng) * kx, y: (lat - anchor.lat) * ky }),
    toLngLat: ({ x, y }) => ({ lng: anchor.lng + x / kx, lat: anchor.lat + y / ky }),
  };
}

// Great-circle (haversine) distance in metres, used only to cross-check the local frame.
export function haversine(a, b) {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
