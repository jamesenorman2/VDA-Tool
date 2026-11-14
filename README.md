# VDA-Tool

Vehicle dynamics assessment for hostile vehicle mitigation: given an approach route
(straights and curves ending at an asset), it computes the maximum speeds six vehicle
classes can reach, with a route sketch, speed-vs-distance chart and speed table.

Dependency-free static app (vanilla ES modules, hand-rolled SVG).

```bash
npm start      # serves http://localhost:8080 (route calculator); map assessment at /map.html
npm test       # unit tests for the maths and sketch geometry
```

- `src/quickentry.js` – quick-entry/CSV line parser (units, left/right/straight)
- `src/maths.js` – acceleration curves, cornering limits, speed caps (`capAfter`), route traversal, chart subdivision, validation
- `src/sketch.js` – route sketch geometry (drawn in direction of travel; left = driver's left)
- `src/geometry/fillet.js` – drawn polyline → straights and tangent-arc curves (largest-fit or fixed radius per bend)
- `src/geometry/clip.js` – clip a vector at its first line-of-protection crossing; impact angle
- `src/model.js` – project / vector model, migration of the old single-route state, vector → sections
- `map.html`, `src/mapapp.js` – map assessment: basemap (MapTiler with a key, else OpenStreetMap), plan upload with two-point scale, check measurement and alignment, drawing of asset / line of protection / vectors, per-vector impact results, hand-off to the route calculator
- `src/frames.js` – local metric frame ↔ longitude/latitude
- `src/calibrate.js` – plan placement, two-point scale, check error, similarity fit
- `src/store.js` – localStorage project + IndexedDB plan images
- `vendor/maplibre-gl-4.7.1/` – vendored MapLibre GL JS (BSD-3-Clause)
- `src/app.js` – UI: settings, data entry (validation, keyboard shortcuts), outputs, print view

Sections are stored nearest-asset first; the "Entry order" setting (default: start of route → asset) controls how they are shown, numbered and added. State is kept in `localStorage`.

Planned map-based workflow: see `docs/spec-map-attack-vectors.md` and `docs/plan-p0-p1.md`.
