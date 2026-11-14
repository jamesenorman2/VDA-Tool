# Build plan: Phase 0 and Phase 1

This plan follows [spec v0.2](spec-map-attack-vectors.md). Each work package (WP) is a reviewable pull request with its own tests. The follow-up questions in spec §13 are answered; the only thing still awaited is the Word template file.

The app is deployed as a **static website**. There is no server, a project's data stays in the browser, and the MapTiler key is kept in browser settings, restricted to the site's address.

## Guiding rules

- `maths.js` stays the only place speeds are computed. Map code only produces `sections[]` (nearest-asset first) and reads results.
- All geometry runs in a **local metric frame**: metres, y-up, origin at the project anchor. The frame is a local tangent plane, so the error stays under 1 cm over the 440 m study ring. MapLibre (lon/lat) and EPSG:27700 are display and export conversions only.
- Each new module is pure and unit-tested in `test/`, like `maths.js` and `quickentry.js` today. UI modules are kept thin.
- The current single-route page keeps working until WP1.6 replaces it.

---

## Phase 0: Foundations

| WP | What | Files | Tests / done when |
|---|---|---|---|
| **0.1 Project model** | `Project`, `Vector`, `Asset`, `LoP`, `BaseLayer`, `Calibration` types (JSDoc). Migrate the current `localStorage` state into one project with one vector | `src/model.js` | Old saved state loads as a project with identical sections and speeds |
| **0.2 Storage** | IndexedDB store for projects and plan images; `.vda` file = zip of `project.json` + images (small zip writer, or `fflate`) | `src/store.js`, `src/vdafile.js` | Save → load round trip keeps the project byte-identical; a 20 MB plan stores without hitting the `localStorage` quota |
| **0.3 Speed caps** | `traverseSection` honours `capAfter` (min with cap, `accDistance = null`); cap 0 = forced stop | `src/maths.js` | New tests: a cap of 0 halfway equals a standing start from that point; a cap above the current speed changes nothing |
| **0.4 Frames** | Local plane ↔ WGS84 (local tangent plane at the anchor) and WGS84 ↔ EPSG:27700 (Helmert or OSTN15-lite, accurate to ±5 m, which is enough for export) | `src/frames.js` | Known OS trig points convert to within 5 m; local plane round trip < 1 mm |
| **0.5 Multi-vector UI shell** | `app.js` split into a project bar, a vector list and the existing per-vector panels (sketch, chart, table) | `src/app.js`, `src/ui/*.js` | Two vectors in one project, each with its own results; existing e2e behaviour unchanged |

## Phase 1: Map and drawing MVP

| WP | What | Files | Tests / done when |
|---|---|---|---|
| **1.1 Map** | MapLibre GL (pinned, vendored) with **MapTiler** streets + satellite and MapTiler address search; key entered in settings, stored in the browser, never committed; attribution shown; scale bar, north arrow; warning when a project's marking is above OFFICIAL (F2) | `src/map/map.js` | The map opens at the project anchor; a scale bar is visible; it works at phone width |
| **1.2 Plan overlay** | Upload PNG/JPG/PDF (PDF.js renders the chosen page). Two-point calibration with a known distance; a check measurement shows the % error (warn > 2 %, block report > 5 % unless a reason is given). Place it on the map with ≥2 control points (similarity, affine with ≥3); show residuals; opacity slider | `src/map/plan.js`, `src/calibrate.js` | Pure tests: two-point scale, similarity/affine fit, residuals. A known test plan measures within 0.5 % |
| **1.3 Asset and LoP** | Draw an asset polygon or point and a LoP polyline; snap to vertices; edit by dragging | `src/map/draw.js` | Geometry is saved in the local frame and reloads exactly |
| **1.4 Vectors → sections** | Click-to-draw vector polyline. Each vertex gets a fillet with **largest-fit radius** by default (Q10); the assessor can reduce it with a note. Clip at the first LoP crossing; error if there is none. Radius > 150 m becomes a straight | `src/geometry/fillet.js`, `src/geometry/clip.js` | 90° bend at r = 20 m gives `[S, C(31.42, 20), S]` with legs shortened by 20 m. Sign test: a plan with a known left turn gives `CURVE_LEFT` (y-flip guard). Round trip through `buildSketch` within 1 cm |
| **1.5 Impact outputs** | Impact angle at the LoP, KE per class, limiting bend, required rating in **ISO 22343, PAS 68 and ASTM F2656**. Class set selectable per project: current six (default) or ISO 22343 (F3); classes without data show "no data". The test-vehicle mapping table is flagged "unconfirmed" until checked | `src/ratings.js` | Rating = next tested speed ≥ impact speed; the angle is correct on synthetic crossings at 90°, 45° and 30° |
| **1.6 Results on the map** | Vectors coloured by impact speed (selected class or worst class); click a vector to open its sketch, chart and table; summary table per LoP segment | `src/map/results.js`, `src/ui/summary.js` | Dragging a vertex updates its speeds live (target < 16 ms per vector) |
| **1.7 Manual class exclusion** | Per vector, untick classes with a mandatory reason; the reason appears in the report | `src/ui/vector.js` | An excluded class is absent from results and shown as excluded in the report |
| **1.8 Reports** | PDF (generated in the browser with a library such as pdf-lib, since printing is unreliable for maps) and **Word `.docx`** (the `docx` library). Contents as spec §8. Marking from the UK GSC list or a client-specific marking with handling text (F4), in header and footer. The Word export fills the house template at `docs/templates/report.docx` (F6; **waiting for the template file**) | `src/report/*.js` | Both formats contain the map snapshot, all vectors, the calibration record and the assumptions; marking on every page |
| **1.9 Lock and version** | Lock an assessment: freeze inputs, stamp engine version and date, save a numbered version; unlocking creates a new version | `src/model.js`, `src/ui/project.js` | A locked project refuses edits; reports show the version number |
| **1.10 Regression sites** | The 2–3 anonymised past sites (Q27) as fixtures: plan, calibration, drawn vectors, expected speeds | `test/fixtures/site-*/` | Tool results within ±1 km/h of the hand assessments, or each difference is explained (usually the corner-cutting line) |

## Order and dependencies

```
0.1 → 0.2 → 0.5 ─┐
0.3              ├→ 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9
0.4 → 1.1 → 1.2 → 1.3 ┘                          1.10 runs alongside from 1.4
```

Suggested first pull request: **0.1 + 0.3 + 1.4's pure geometry** (`fillet.js`, `clip.js` with tests). It needs no map and no decisions, and it proves the drawing → sections → speeds chain against the existing engine.

## Dependencies introduced

| Library | Why | Notes |
|---|---|---|
| MapLibre GL JS | Map, rotation, image overlay (Q2) | Vendored, exact version |
| PDF.js | Render uploaded PDF plans | Worker build |
| pdf-lib | PDF report | – |
| docx | Word report (Q22) | – |
| fflate | `.vda` zip | Tiny; optional if a hand-rolled store-only zip is enough |

## Not in P1 (by decision)

Corner-cutting racing line, auto vector search and OSM buildings (P2). Barriers and gap check, scenarios, sensitivity bands (P3). Gradients and tablet use (P4).
