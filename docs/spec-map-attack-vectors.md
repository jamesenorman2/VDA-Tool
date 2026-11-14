# Spec: Map-based attack vector assessment

Status: **Draft v0.2**. The answers to Q1–Q27 are recorded in §0 and change the plan in several places. Follow-up questions raised by those answers are in §13. The Phase 0/1 build plan is in [`plan-p0-p1.md`](plan-p0-p1.md).

---

## 0. Decisions (v0.2)

| Q | Decision | What it changes |
|---|---|---|
| Q1 | Specialist assessors; clients view reports only | – |
| Q2 | **MapLibre GL** | WebGL vector map, rotation and plan-image overlays in one library. It is the first runtime dependency |
| Q3 | **Online maps are fine by default** | No longer offline-first. Basemap, imagery and address search are in **P1**, not P2 (see §13 F1, F2) |
| Q4 | UK first (EPSG:27700), WGS84 always stored | – |
| Q5–Q9 | Defaults: PDF + PNG/JPG; DXF later; always two-point calibration; warn > 2 %, block > 5 %; ± band from P3 | – |
| Q10 | Largest radius that fits (worst case) | – |
| Q11 | **S-bends, chicanes and roundabouts are common** | The full minimum-curvature racing-line solver (§7.3 B) moves up to the automation phase. The per-bend formula is no longer enough |
| Q12 | Manual class exclusion in P1, automatic swept-path check later | – |
| Q13 | **Everything is traversable except buildings** | The "corridor" is the open site, so no surface drawing is needed. Racing lines and route search work in open space bounded by buildings and barriers |
| Q14 | Only rated products and buildings stop a vehicle | Consistent with Q13 |
| Q15 | **ISO 22343, PAS 68 and ASTM F2656**, with ISO 22343 as the current standard (it supersedes IWA 14-1) | Ratings are shown in all three. The class ↔ test-vehicle mapping per standard is §13 F3 |
| Q16–Q19 | Angle reported only; 1.2 m gap; gradients out of scope until P4; local only, no server | – |
| Q20 | **Choose from a fixed set of protective markings** | Marking list needed (§13 F4) |
| Q21 | Lock and version in P1, full workflow later | Needs a light review state as well, given Q24 (§13 F5) |
| Q22 | **Word as well as PDF** | `.docx` report generation in P1 |
| Q23 | Tablet is nice to have; desktop first | – |
| Q24 | **The tool produces a full assessment that a reviewer checks** | Auto-generation of vectors is the target, not a P4 extra. The audit trail and "generated vs drawn" marking matter more |
| Q25 | Study area is assessor-drawn, with a 440 m default ring | – |
| Q26 | **Seed buildings and roads from OSM by default** | With Q13, OSM buildings alone give a usable first obstacle map |
| Q27 | 2–3 anonymised past sites are available as test cases | They become regression fixtures in P1 |

---

## 1. The idea in one paragraph

Today the assessor measures a route by hand, then types it in as straights and curves. In the new version the assessor **drops in a site plan or opens a map, sets its scale, marks the asset and its line of protection, and draws approach routes on it**. The tool turns each drawn route into the straights and curves the existing engine already uses. It works out the **fastest line a hostile driver could take** through each bend, and it reports the **impact speed, impact angle and kinetic energy for every vehicle class at every point where a route crosses the line of protection**. From those it **specifies the barrier rating needed on each stretch of the perimeter**. Later phases go further: the tool **finds the attack routes itself** and shows how much a chicane, a gate or a new barrier would cut impact speed.

From the assessor's point of view the change is: *measuring and typing → drawing, reviewing and justifying.*

---

## 2. What exists today (the starting point)

| Piece | Today | Kept? |
|---|---|---|
| `maths.js` | Power-law acceleration per class, v = √(μ·r·g) cornering capped at a slip speed, route traversal, rolling/standing start | **Yes, unchanged.** It becomes the solver behind each vector |
| `sketch.js` | Schematic route drawn from sections | Yes, as the per-vector "unrolled" view |
| `quickentry.js` | Text/CSV entry | Yes. Manual entry stays as a fallback and for audit |
| `app.js` | One route per page, state in `localStorage` | **Refactored** into project → site → many vectors |
| Vehicle classes | M1 1.5 t, N1G 2.5 t, N1 3.5 t, N2 7.5 t, N3 18 t, N3 30 t | Yes, plus per-vector filtering (see §6.4) |

The key design decision: **the map layer only produces `sections[]`**, the same nearest-asset-first array the engine takes today. The maths stays the single source of truth, it is already unit-tested, and every drawn vector can be exported to the current CSV format and checked by hand.

---

## 3. Users and use cases

- **HVM assessor / security consultant.** Produces the VDA for a site and needs results that are defensible and auditable.
- **Reviewer / client security manager.** Checks the assessment and wants to see *why* a route is the worst case.
- **Designer (landscape / civils).** Wants barrier ratings per perimeter segment, and wants to test mitigation options.

Core use cases:

1. Assess a site on a live basemap (aerial imagery or OSM), with a scaled plan overlaid where one exists.
2. Assess a site from a scaled plan (PDF/PNG) alone, when there is no usable imagery or the plan is newer than it.
3. Compare *as-is* with *proposed mitigation* and show the reduction in impact speed.
4. Produce a report pack: a map with vectors coloured by speed, a table per vector, the required ratings for each perimeter segment, and the assumptions.

---

## 4. End-to-end workflow

```
 ┌──────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────┐   ┌──────────┐
 │ 1 Base   │ → │ 2 Scale /  │ → │ 3 Asset &    │ → │ 4 Draw /     │ → │ 5 Review  │ → │ 6 Report │
 │   layer  │   │  georef    │   │  line of     │   │  generate    │   │  & mitigate│   │  & export│
 │          │   │            │   │  protection  │   │  vectors     │   │           │   │          │
 └──────────┘   └────────────┘   └──────────────┘   └──────────────┘   └───────────┘   └──────────┘
```

### Step 1: Base layer
- **Plan underlay:** upload PNG/JPG/PDF (PDF rendered page by page; choose the page). Later, possibly DXF/DWG (Q6).
- **Live map:** OSM / aerial basemap (Q2, Q3). Search by address or coordinates.
- The two can be combined: a plan underlay georeferenced on top of the map (Phase 2).

### Step 2: Scale / georeference
- **Two-point calibration (MVP).** Click two points and enter the real distance with a unit. The tool shows the resulting m/px.
- **Verification measurement (strongly encouraged).** Measure a second known dimension. The tool shows the error, e.g. "Check: 24.6 m measured vs 25.0 m known (−1.6 %)". It warns above a threshold (Q8).
- **Scale bar / ratio entry.** Enter "1:500 at A1" for vector PDFs, if the PDF page size is trustworthy.
- **Rotation / north.** Set north so that exported vectors and reports orient correctly.
- **Georeference (Phase 2).** Place ≥2 control points on the plan and the matching points on the map. A similarity transform is used with 2 points, an affine one with ≥3. Residuals are shown per point.
- The calibration is **recorded with the project**: who set it, when, the points, the known distance and the check error. It appears in the report.

### Step 3: Asset and line of protection (LoP)
- **Asset:** polygon (building footprint), point, or zone. There can be several assets.
- **LoP:** a polyline or polygon edge where vehicles must be stopped. This is the "finish line" for every vector. Vectors are assessed **to the LoP**, not to the asset centroid.
- Optional **standoff ring**: show the distance from the LoP to the asset façade (feeds the blast standoff conversation without modelling blast).

### Step 4: Vectors (attack routes)
Three ways to create a vector, in order of delivery:

**4a. Click-to-draw polyline (MVP).** The assessor clicks from the start point towards the LoP. Each interior vertex is a bend. The tool rounds every vertex with a tangent arc (a fillet):

- Turn angle θ at a vertex comes from the two adjacent legs. Left or right comes from the sign of the cross product, in the driver's frame. **Image y-down must be flipped**, a classic bug.
- With fillet radius r: tangent length T = r·tan(θ/2), arc length = r·θ, and each adjacent straight is shortened by T.
- Constraint: T at vertex *i* plus T at vertex *i+1* ≤ the leg length. If it is violated, the tool clamps and flags it.
- The radius per vertex has three modes (Q10):
  - **As drawn:** the assessor drags a radius handle, or types a value.
  - **Max feasible (worst case):** the largest radius that fits the legs. This is the *fastest* line.
  - **Corridor-limited (Phase 3):** the largest radius that fits inside the drawn road corridor (see 4c).
- Radius > 150 m is treated as a straight, as `quickentry.js` already does (conservative).
- Output: `sections[]` → `buildRouteSpeeds()`. No new physics.

**4b. Freehand / trace (Phase 2).** The assessor sketches along the road. The tool simplifies the line (Ramer–Douglas–Peucker), estimates curvature from three-point circumcircles, and splits the line into straights and constant-radius arcs. The result is shown as editable vertices plus fillets, so the assessor can always correct it.

**4c. Corridor / racing line (P2, the big automation win).** Per Q13, everything except buildings and rated barriers is traversable. Buildings come from OSM by default (Q26) and the assessor can edit them. The tool computes the **fastest line through each bend**, not the centreline. For a bend of deflection θ with traversable width w and inner kerb radius rᵢ:

  R = rᵢ + w / (1 − cos(θ/2))

  Worked example, a 7 m wide road at a sharp 90° junction: the centreline radius is about 6 m, which gives a car **23 km/h**. The racing-line radius is about 24 m, which gives a car **47 km/h**. That doubles the impact speed. This is exactly the error that drawing centrelines by hand introduces, and it is the tool's strongest selling point.

  Constraint: the approach and exit legs must be at least R·tan(θ/2) long, otherwise the tool falls back to the leg-limited radius. Consecutive bends (S-bends) need a joint optimisation (§7.3).

**4d. Auto-generated vectors (Phase 3/4).** Given the traversable surface, the obstacles (buildings, existing rated barriers, trees ≥ X mm, Q14) and the LoP, the tool **searches for the speed-maximising approach** to each LoP segment. It reports the top N per segment. See §7.4.

### Step 5: Review and mitigate
- Vectors are coloured by impact speed (worst class or chosen class) on the map. Clicking one shows its unrolled sketch, speed-vs-distance chart and table, i.e. the current UI, per vector.
- **Per LoP segment:** the governing vector, the max impact speed per class, the impact angle and the kinetic energy.
- **Mitigation objects** (Phase 3):
  - **Rated barrier line:** a rating per IWA 14-1 / PAS 68 / ASTM F2656 (Q16). It checks that each vector's crossing is covered and that **gaps are ≤ the clearance limit** (Q17, typically 1.2 m).
  - **Speed cap / forced stop:** a gate, an existing barrier with an access control, or a tight chicane. Mathematically it is a waypoint that caps the speed (stop → standing restart). It is a small extension to `traverseSection`.
  - **Chicane / build-out:** added geometry that reduces the corridor width or adds bends, so the speeds are recomputed.
  - **Scenario toggle:** *As-is* vs *Option A* vs *Option B*, with a delta table.

### Step 6: Report and export
- PDF/print report (§8), CSV per vector (the existing format), project file, and GeoJSON/KML of vectors and the LoP (Q22).

---

## 5. Outputs per vector and per LoP segment

| Output | Formula / source | Notes |
|---|---|---|
| Speed at LoP, per class | Existing engine | Already exists |
| Impact angle | Angle between the final heading and the LoP tangent at the crossing | 90° = head-on. Test standards quote the angle, so it is needed for rating |
| Kinetic energy | ½·m·v² (kJ) using the class test mass | Communicates severity, and is used by some standards |
| Required rating | Next tested speed ≥ impact speed: 16/32/48/64/80/96/112 km/h (IWA 14-1) or 30/40/50 mph (PAS 68) | e.g. `V/7200[N2]/48/90`. Needs the class↔test-vehicle mapping (Q15) |
| Run-up length | Path length from start to LoP | Shown on map |
| Limiting feature | Which bend governs the speed at the LoP | "Speed limited by bend 3 (r = 18 m)" helps designers |
| Sensitivity | Speed at the LoP with radius ±X % and calibration error ±Y % | Turns calibration and drawing error into a ± band (Q9) |

---

## 6. Data model

```
Project
 ├─ meta: title, site name, assessor, reviewer, classification marking (Q20), version, created/updated
 ├─ settings: units, default route start, active vehicle classes, rating standard
 ├─ baseLayers[]: { kind: 'plan'|'map', source (blob ref / tile URL), page, calibration{ points, knownDist, mPerPx, check{measured, known, errPct}, north, by, at }, georef{ controlPoints[], transform, residuals } }
 ├─ assets[]: { id, name, geometry (polygon|point) }
 ├─ lops[]: { id, assetId, geometry (polyline), segments[] (auto-split at vertices or every N m) }
 ├─ surfaces[]: { id, kind: 'carriageway'|'footway'|'verge'|'hard-standing'|'no-go', geometry (polygon), traversableBy: classIds[] }
 ├─ obstacles[]: { id, kind: 'building'|'rated-barrier'|'tree'|'street-furniture', geometry, rating? }
 ├─ vectors[]: { id, name, colour, start: 'ROLLING'|'STANDING', startNote, vertices[{x,y, radiusMode, radius}], waypoints[{at, speedCap}], classes[] , source: 'drawn'|'traced'|'generated', locked, notes }
 ├─ scenarios[]: { id, name, overrides: { add/remove barriers, surfaces, waypoints } }
 └─ audit[]: { at, who, action, detail }
```

- **Coordinates:** stored in a **local metric plane (metres, y-up)** per project. For georeferenced projects, a transform maps it to WGS84 and/or a national grid such as EPSG:27700 (Q4). All maths runs in metres, never pixels or degrees.
- **Derived data** (sections, speeds, ratings) is recomputed, never stored as truth. It is cached only for report snapshots.
- **Per-vector class filter (6.4):** a 30 t rigid may not physically fit a 2.4 m gap or a 6 m turning circle. The tool should at minimum let the assessor exclude a class with a reason. Ideally it would check swept path / minimum turning radius automatically (Q12).

### Storage
- Images and PDFs are too big for `localStorage`, so the project moves to **IndexedDB**. State keeps the current `localStorage` shape for migration.
- **Project file:** a single `.vda` (zip: `project.json` + plan images) for save, share and archive.
- No server is needed for the MVP. Whether there is ever a server is Q19.

---

## 7. Algorithms (the interesting bits)

### 7.1 Polyline + fillets → sections
For vertices P₀ (start) … Pₙ (LoP crossing):
1. Legs Lᵢ = |Pᵢ₊₁ − Pᵢ|, headings hᵢ.
2. At each interior vertex: θᵢ = wrap(hᵢ − hᵢ₋₁), side = sign(θᵢ) (in the y-up frame), Tᵢ = rᵢ·tan(|θᵢ|/2).
3. Leg straight length = Lᵢ − Tᵢ − Tᵢ₊₁. It must be ≥ 0. If it is negative, scale both radii down proportionally and flag the vertex.
4. Emit `STRAIGHT(len)`, `CURVE_LEFT|RIGHT(arc = rᵢ·|θᵢ|, radius = rᵢ)` in travel order, then reverse into nearest-asset-first.
5. Clip at the **first** intersection with the LoP. A vector that never crosses the LoP is an error.

Property test: re-drawing `buildSketch(sections)` must reproduce the filleted polyline within 1 cm (with rotation and translation normalised). This gives a free consistency check between the new geometry and the existing sketch code.

### 7.2 Racing line through a single bend
Closed form above. The inputs come from the corridor polygons: w = the traversable width measured across the bisector, rᵢ = the inner kerb radius (fitted from the inner edge, 0 for a sharp corner).

### 7.3 Racing line through a sequence of bends
Closed forms break down for S-bends and chicanes. Two options (Q11):
- **A. Iterative fillet optimisation:** maximise the minimum cornering speed along the path, subject to the arcs staying inside the corridor polygon. This is small and deterministic.
- **B. Minimum-curvature path:** a classic racing-line problem. Discretise the corridor centreline and pick a lateral offset per station to minimise Σκ² (a quadratic programme), then segment the result into arcs (§4b). This is more general and copes with arbitrary geometry.

Decision (Q11): S-bends, chicanes and roundabouts are common, so **B is the target**. A remains useful as a fast first guess and as a check on B.

### 7.4 Auto vector generation
- Rasterise the traversable surface at 0.25–0.5 m, with obstacles as hard blocks and inflated by half the vehicle width per class.
- Search the state space (x, y, heading, speed) with curvature-limited motion primitives (hybrid A*), with the cost maximising arrival speed at the LoP. The speed update along each primitive uses **the same engine** (acceleration curves plus cornering limits).
- Start candidates: every road entry at the edge of the study area (rolling start), plus assessor-marked parking/loading areas (standing start).
- Output: the top N distinct vectors per LoP segment, converted to editable polylines with fillets, marked `source: 'generated'`. The assessor must review and accept each one, and the report says which vectors were generated and which were drawn.
- This is the most expensive feature. It runs in a Web Worker and must be cancellable.

### 7.5 Speed caps (waypoints)
Extend `traverseSection` with an optional `capAfter` value. After the section, `speed = min(speed, cap)` and `accDistance = null`, so acceleration resumes from the capped speed. A forced stop is cap = 0. It needs unit tests next to the existing ones.

---

## 8. Report pack

1. Cover: site, assessor, reviewer, date, version, **classification marking**, scenario.
2. Site map: base layer + asset + LoP + all vectors coloured by impact speed, plus a legend, scale bar and north arrow.
3. Summary table: one row per LoP segment, showing the governing vector, max impact speed per class, impact angle and **required rating**.
4. Per vector: a mini map, the unrolled sketch (existing), the speed-vs-distance chart (existing), the speed table (existing), the limiting feature and the sensitivity band.
5. Calibration and georeference record, including the check-measurement error.
6. Assumptions and limitations (extends the current list: racing-line assumption, kerb mounting, surfaces, calibration error, generated vs drawn vectors).
7. Optional appendix: raw sections CSV per vector, so the results can be reproduced in the existing tool.

---

## 9. Non-functional requirements

- **Online by default (Q3).** Basemaps, imagery, address search and OSM data are on by default. The plan-only workflow still works with no network, and a per-project "no online services" switch is proposed in §13 F2.
- **Determinism and reproducibility.** The same project file gives the same numbers. The report records the engine version, and vehicle data is versioned.
- **Performance.** 50 vectors × 6 classes recompute in < 100 ms. Dragging a vertex updates its speeds live, at 60 fps target. Auto-generation runs in a worker with progress shown.
- **Accuracy targets.** The geometry → sections round-trip is accurate to < 1 cm. A calibration check error > 2 % triggers a warning (Q8).
- **Accessibility.** Every map action also has a keyboard/numeric path, so a vertex can be typed in. The existing quick-entry stays.
- **Browsers.** Current Chrome, Edge, Firefox and Safari. Desktop first, tablet usable (Q23).
- **Dependencies.** Today the app has none. A map library is the first real dependency (Q2).

---

## 10. Phasing

| Phase | Scope | Gets you |
|---|---|---|
| **P0: Foundations** | Project model, IndexedDB, `.vda` file, multi-vector refactor of `app.js`, speed-cap waypoints in `maths.js`, local metric frame ↔ WGS84 ↔ EPSG:27700 | Many routes per project |
| **P1: Map and drawing MVP** | MapLibre basemap + imagery + address search; plan upload with two-point scale and check; plan placed on the map by control points; asset + LoP; click-to-draw vectors with largest-fit fillets; impact angle, KE, ratings in ISO 22343 / PAS 68 / ASTM; per-vector existing outputs; PDF + Word report v1 with chosen marking; lock and version; Q27 sites as regression tests | **The core ask** |
| **P2: Automation** | OSM buildings as obstacles by default; minimum-curvature racing line through any sequence of bends; auto vector search (hybrid A*) within the study area; generated vectors marked and listed for reviewer check | **The tool produces the assessment (Q24)** |
| **P3: Mitigation and depth** | Rated barrier lines with gap check; speed caps/gates; scenarios and deltas; sensitivity bands; automatic swept-path class check; review workflow; GeoJSON/DXF if needed | Design options and their effect on impact speed |
| **P4: Later** | Gradients (needs vehicle data), tablet / on-site GPS | – |

P1 acceptance criteria (draft):
- Calibrate a plan with two clicks and a distance. A second measurement shows the error as a percentage.
- Draw a 3-vertex vector with a 90° bend at r = 20 m. The tool produces `[STRAIGHT, CURVE_x(31.42, 20), STRAIGHT]` with the leg lengths shortened by 20 m each, and the speeds match the manual entry of the same sections exactly.
- Dragging the bend radius updates the speeds at the LoP live.
- A vector that does not cross the LoP shows an error. Crossing it twice uses the first crossing.
- The report prints the map, the per-vector pages and the calibration record.

---

## 11. Risks and things that will bite

- **y-axis flip.** Image and SVG coordinates are y-down, the maths is y-up, and "left" is the driver's left. One wrong sign swaps every left and right curve. It needs a test with a known plan.
- **Plan scale is a lie surprisingly often.** Rescaled PDFs and "NOT TO SCALE" stamps are common, which is why the check measurement is in the MVP and not later.
- **Racing line makes the numbers go up.** That is correct, but clients may push back. The report must explain it clearly, and the tool should show centreline and racing line side by side.
- **The model's validity envelope.** The engine assumes flat, dry and level roads, and radius ≤ 150 m. Auto-generation can produce paths outside the envelope (gradients, mixed surfaces), so it must flag them rather than silently produce numbers.
- **Sensitivity of site data.** Plans of sensitive sites often carry protective markings. Sending tiles, geocoding or anything else to third parties may be unacceptable, which is why the questions in §12C come first.
- **Liability.** Generated vectors are suggestions, and the assessor remains responsible. The UI and report must make this explicit.

---

## 12. Questions to tighten the spec

**Answered 14 Nov 2026. See §0 for the decisions.** The list is kept below for reference. Proposed defaults are in *italics*.

### A. Scope and users
- **Q1.** Who is the primary user: in-house assessors only, external consultants, or clients self-serving? *Specialist assessors; clients view reports only.*
- **Q2.** Can we take a map dependency (Leaflet ≈ 40 kB, or MapLibre for vector/rotated maps), or must the app stay dependency-free? *Leaflet, vendored locally, no CDN.*
- **Q3.** Can site locations or imagery ever be sent to third-party tile or geocoding services? *Plan-underlay mode is fully offline. Online basemaps need an explicit per-project opt-in.*
- **Q4.** Which country / grid? Is UK (EPSG:27700, NPSA guidance) the main market? *UK first, WGS84 always stored.*

### B. Base layers and scale
- **Q5.** Which inputs matter most: PDF, PNG/JPG, photos of paper plans, drone orthomosaics, GeoTIFF? *PDF and PNG/JPG in P1, GeoTIFF in P2.*
- **Q6.** Is CAD (DXF/DWG) import needed? DXF is feasible. DWG really isn't in the browser. *DXF in P3 if asked for. Assessors export PDFs meanwhile.*
- **Q7.** Do plans usually have a reliable scale bar or ratio, or are they "not to scale" sketches? *Assume unreliable: always calibrate by two points.*
- **Q8.** What calibration check error is acceptable before warning or blocking? *Warn > 2 %, block report > 5 % unless the assessor overrides it with a reason.*
- **Q9.** Should calibration and drawing error be shown as a ± speed band in results? *Yes, from P3.*

### C. Drawing and geometry
- **Q10.** What should the default radius mode be for drawn bends: as-drawn, max-feasible, or corridor-limited? *Max-feasible: conservative (worst case) by default, the assessor can reduce it with a note.*
- **Q11.** How common are S-bends, chicanes and roundabouts on your sites? This decides whether 7.3-A is enough. *A in P3, B only if needed.*
- **Q12.** Should the tool automatically exclude classes that physically can't make a turn or fit a gap (swept path / turning circle), or leave that to judgement? *Manual exclusion with a reason in P1, auto-check in P3.*
- **Q13.** Can vehicles be assumed to mount kerbs and cross footways and verges by default? Are there surfaces (soft ground, steps, water, steep banks) the tool should treat as impassable? *Kerbs up to 150 mm and footways/verges are traversable. Steps, water and buildings are not. Configurable per surface.*
- **Q14.** Which existing features count as obstacles: only rated products, or also trees, walls, street furniture? Is there a threshold (e.g. tree trunk ≥ 300 mm)? *Only rated products and buildings stop a vehicle by default. Everything else is "assessor-classified".*

### D. Standards and outputs
- **Q15.** Which standard should ratings be expressed in: IWA 14-1, PAS 68, ASTM F2656, or all three? And how do the current six classes map to their test vehicles (e.g. the tool's 7.5 t N2 vs the IWA 7.2 t N2)? *IWA 14-1 primary, PAS 68 shown alongside. The mapping needs to be confirmed by you.*
- **Q16.** Is impact angle used to downgrade or upgrade the required rating, or only reported? *Report only, and round up to the tested angle.*
- **Q17.** What maximum gap between barrier elements should the gap checker use? *1.2 m, configurable.*
- **Q18.** Is gradient modelling needed? The current fits assume a level road, so this needs new vehicle data or a physics correction, not just UI. *Out of scope until P4. Flag gradients > X % as outside the envelope.*
- **Q19.** Is a server ever needed (shared projects, multi-user review, central vehicle-data updates), or does everything stay local? *Local only, with project files shared through existing secure channels.*

### E. Governance, audit and reporting
- **Q20.** Do reports need protective markings (e.g. OFFICIAL-SENSITIVE) in the header and footer, and a handling statement? *Yes, a free-text marking on every page.*
- **Q21.** Is a formal sign-off workflow needed (assessor → checker → approver, with locked versions)? *A "lock and version" button in P1, full workflow in P4.*
- **Q22.** Which export formats do recipients actually need: PDF, Word, GeoJSON/KML, DXF back to designers? *PDF + CSV in P1, GeoJSON in P2, DXF in P3.*
- **Q23.** Is on-site use on a tablet (walk the site, mark start points with GPS) a real use case? *Nice to have. Desktop first.*

### F. Automation appetite
- **Q24.** How far should automation go: suggest vectors for the assessor to accept, or produce a complete assessment that a reviewer only checks? *Suggest only. A human accepts every vector.*
- **Q25.** For auto-generation, what is the study-area boundary: a fixed radius around the asset (e.g. 300 m), the site boundary, or assessor-drawn? *Assessor-drawn, with a 440 m default ring. 440 m is where the engine's acceleration curves reach terminal speed.*
- **Q26.** Should OSM road and building data be imported automatically to seed surfaces and obstacles? This raises the same data-egress question as Q3. *Optional in P2/P3, behind the same opt-in.*
- **Q27.** Do you have real past assessments (plan + hand-measured routes + results) we can use as regression tests for the drawing → sections pipeline and for the racing-line maths? *Yes please. Two or three anonymised sites would be ideal.*

---

## 13. Follow-up questions (raised by the v0.2 answers)

- **F1. Imagery and tile provider.** The OpenStreetMap tile servers do not allow use by applications like this one, and aerial imagery needs a licensed provider. Options: MapTiler, Esri World Imagery, Mapbox, or Ordnance Survey (OS Maps API, good UK detail, has a free tier). These need an API key and have licence terms that restrict printing in reports. Which provider does the organisation have, or want?
- **F2. Sensitive projects.** Q3 makes online services the default, while Q20 adds protective markings. Should choosing a marking above a set level automatically switch off online services (tiles, search, OSM) for that project?
- **F3. ISO 22343 details.** Confirm which parts apply (22343-1 rating, 22343-2 application/assessment). For each of the six classes, give the test vehicle designation in ISO 22343, PAS 68 and ASTM F2656, so the required-rating output is correct.
- **F4. Marking list.** Which protective markings should the report offer (e.g. OFFICIAL, OFFICIAL-SENSITIVE, client-specific), and what handling text goes with each?
- **F5. Reviewer check.** With the tool producing a full assessment (Q24), what must a reviewer do before the report can be issued: accept each generated vector, or sign off the assessment as a whole?
- **F6. Word report.** Is there a house Word template (styles, cover page, logo) the `.docx` must follow?
