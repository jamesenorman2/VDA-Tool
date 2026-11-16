# ISO 22343 (Parts 1 and 2) – reference notes for the VDA Tool

**What this is:** working notes, in our own words, on the parts of BS ISO 22343-1:2023 *Part 1: Performance requirement, vehicle impact test method and performance rating* and BS ISO 22343-2:2023 *Part 2: Application* (both incorporating corrigendum January 2024) that matter for this tool. It is **not** a copy of the standard. The standard is copyright ISO/BSI and licensed to a single named user; keep the purchased PDF in the owner's own files, not in this repository. Check any figure here against the standard before relying on it in a deliverable.

## Status of the standards

- **Part 1** (impact test and rating), published 2023-09. Replaces **IWA 14-1:2013**; in the UK it supersedes **PAS 68:2013** (withdrawn). Covers a single impact by an unmanned test vehicle, with penetration up to 25 m.

- Published 2023-09 (BS edition 2024). Replaces **IWA 14-2:2013**; in the UK it supersedes **PAS 69:2013** (withdrawn).
- **Part 2** is guidance on selecting, installing and using vehicle security barriers (VSBs) and on writing operational requirements (ORs). Performance testing and rating is in Part 1 (notes below).
- Out of scope: slow-speed encroachment, nudging and ramming, blast, ballistic and manual attack, and attacks on control systems (clause 1).

## Threat vehicles (ISO 22343 classes)

From the Level 2 OR proforma, Annex A (Table A.12 for threat vehicles, Table A.14 for legitimate traffic):

| ISO code | Test mass | Description |
|---|---:|---|
| M1 | 1 500 kg | Car |
| N1G | 2 500 kg | 4×4 single or crew cab pick-up |
| N1 | 3 500 kg | Flatbed, single cab |
| N2A | 7 200 kg | 2-axle rigid, day cab |
| N2B | 6 800 kg | 2-axle rigid |
| N3C | 7 200 kg | 2-axle rigid, day cab |
| N3D | 12 000 kg | 2-axle rigid, day cab |
| N3E | 24 000 kg | 3-axle rigid, day cab |
| N3F | 26 000 kg | 3-axle rigid |
| N3G | 30 000 kg | 4-axle rigid, day cab |

### Mapping to this tool's six classes (PROPOSED, NOT YET CONFIRMED)

| Tool class | Nominal mass | Proposed ISO class | Confidence |
|---|---:|---|---|
| 1.5 t car (M1) | 1 500 kg | M1, 1 500 kg | Exact match |
| 2.5 t 4×4 / pick-up (N1G) | 2 500 kg | N1G, 2 500 kg | Exact match |
| 3.5 t flatbed (N1) | 3 500 kg | N1, 3 500 kg | Exact match |
| 7.5 t two-axle rigid (N2) | 7 500 kg | N2A, 7 200 kg, cab over (or N3C, 7 200 kg, cab over) | Close; owner to confirm which |
| 18 t two-axle rigid (N3) | 18 000 kg | No 18 t class in ISO 22343. Nearest 2-axle: N3D 12 000 kg; nearest by mass: N3F 24 000 kg (3-axle, cab over) | Owner to confirm |
| 30 t four-axle rigid (N3) | 30 000 kg | N3G, 30 000 kg | Exact match |

Until the owner confirms this table, the tool labels barrier designations as drafts.

## Part 1: test vehicles, speeds and ratings

### Test vehicles (Part 1, Tables 1 and 2) – these govern

| ISO code | Test mass (tolerance) | Type | GVM |
|---|---|---|---|
| M1 | 1 500 kg (±75) | Car | – |
| N1G | 2 500 kg (±75) | 4×4 crew-cab pick-up | – |
| N1 | 3 500 kg (±100) | Flatbed, day cab, rear-wheel drive | 3 500 kg |
| N2A | 7 200 kg (±150) | 2-axle rigid, cab over | 8 000 kg |
| N2B | 6 800 kg (±150) | 2-axle rigid, cab behind | 14 970 kg |
| N3C | 7 200 kg (±150) | 2-axle rigid, cab over | 20 500 kg |
| N3D | 12 000 kg (±250) | 2-axle rigid, cab over | 20 500 kg |
| N3E | 29 500 kg (±590) | 3-axle rigid, cab behind, tipper | 27 300 kg |
| N3F | 24 000 kg (±400) | 3-axle rigid, cab over, tipper | 26 000 kg |
| N3G | 30 000 kg (±400) | 4-axle rigid, cab over, tipper | 36 000 kg |

**Discrepancy to note:** Part 2's Annex A tables list N3E as 24 000 kg and N3F as 26 000 kg. Part 1, which defines the test vehicles, gives N3E 29 500 kg and N3F 24 000 kg. Use Part 1's figures.

Test vehicles must be no more than 10 years old (M1, N1G) or 15 years old (all others).

### Impact speeds (Part 1, Table 5)

The test speeds are 16, 32, 48, 64, 80, 96 and 112 km/h. **Not every class can be tested at every speed:**

| Classes | Highest test speed |
|---|---|
| M1, N1G | 112 km/h |
| N1 | 96 km/h |
| N2 and N3 (all trucks) | 80 km/h |

Tolerances are +3/−1 km/h up to 64 km/h and +4/−2 km/h at 80 km/h and above.

**What this means for the VDA:** if a truck can reach more than 80 km/h at the line of protection, no ISO 22343-1 rated product exists for that speed. The speed has to be brought down, for example with impact-rated speed-reduction features (Part 2, 9.2.4) or by moving the line. The tool now reports this as "above 80" instead of suggesting a test speed that does not exist. The same applies to a flatbed above 96 km/h and a car or pick-up above 112 km/h.

### Impact angle (Part 1, 3.5.2 and 6.3.3)

- The impact angle is between the barrier's datum line and the vehicle's approach path, and is more than 0° and at most 90°. This is the same definition the tool uses.
- Tests are at 90°; or at whichever angle is most likely to make the barrier fail; or, for a specific site, at 5° steps from 5° to 85°.

### Performance requirement and rating (Part 1, Clauses 4 and 7)

A barrier passes if it does one of these:
- stops the vehicle before its datum line;
- redirects the vehicle so it stays on the unprotected side;
- stops it beyond the line but leaves it unable to drive on.

There is **no rating if penetration exceeds 25 m**.

The classification code is a chain: `ISO 22343-1 <VSB> V/<test mass>[<class>]/<impact speed>/<impact angle>:<penetration m>/<major debris m>`. Part 1's examples are `Blocker V/2500[N1G]/48/90:7.6/5.0` and `Bollard V/7200[N3C]/48/90:2.6/5.0`.

- Penetration is measured from the barrier datum line to the vehicle datum point:
  - cars and pick-ups: the base of the windscreen at the A-pillars;
  - N1, N2 and N3: the leading edge of the load bed at the chassis rail;
  - if the vehicle yaws or pitches 90° or more, to its furthest part instead.
- Major debris means detached pieces of 2 kg or more.

**What the tool should output as the requirement:** for each section and class, `V/<ISO test mass>[<ISO class>]/<test speed>/<angle>`. The penetration and debris values come from the product, so the specifier then checks them against the stand-off available between the line of protection and the asset (Part 2, 9.4.3).

### Other useful facts (Part 1)

- Test site gradient is no more than 2.5 %. The run-out beyond the barrier is at least 25 m, firm and clear.
- Impact speed is measured within 5 m of contact, to ±2 %.
- Post-impact gaps: a gap of more than 1.2 m at 0.6 m above ground counts as passable by a second vehicle (Annex C).
- The test summary reports the impact kinetic energy in kJ. Once the class mapping is confirmed, the tool's energy figures should use the ISO test masses.

## How ratings are written

The standard's design-method example (Annex B.6, Table B.2) shows the rating as a chain:
`<VSB type> <test type>/<test mass kg>[<vehicle class>]/<impact speed km/h>/<impact angle °>:<penetration m>`. Its example is `Gate D/7200[N2A]/64/90:2.8`.

- Test type is **V** for a full-scale vehicle impact test and **D** for the design method (interpolation between tests only).
- The design method may not interpolate between different vehicle classes, and only applies to 90° tests at the same impact point (B.2).
- FEA modelling alone cannot give a rating (9.7, B.8).
- A requirement this tool produces therefore reads like `V/7200[N2A]/64/90` per section. The test speeds and the full rating rules are in Part 1, which is still to be checked.

## Guidance that bears on the VDA (clause references)

- **7.3 Site survey:**
  - consider *all* traversable routes: carriageways, footways, cycle paths, open spaces and gaps;
  - vehicles may drive against the normal direction of traffic, and drop kerbs matter;
  - a VDA is part of the site survey, giving the speed a threat vehicle (as identified in Part 1) can reach at each location;
  - swept-path analysis may also be needed.
- **9.2.2:** a VDA should be done at each site to find the impact speed for each identified threat vehicle, so risk can be assessed and VSBs specified.
- **9.2.3 / 9.2.4 Road layout and speed reduction:** layout changes can limit approach speed. **Speed reduction features (chicanes, serpentines) should themselves be built from impact-rated products.** One element may be removable for emergency access.
- **9.3 Impact angle:** most tests are at 90°, so consider the real approach angle. Shallow angles may redirect a vehicle rather than stop it.
- **9.4 Penetration and debris:**
  - penetration beyond the datum line is recorded in Part 1 tests;
  - over 25 m means no classification;
  - major debris distance is recorded as an observation;
  - **stand-off (9.4.3):** the VSB should sit further from the asset than its penetration distance, its major debris distance and the blast stand-off.
- **9.1 Impact performance:**
  - products may be tested to ISO 22343-1, IWA 14-1, PAS 68, CWA 16221 or ASTM F2656, so know the differences;
  - don't restrict a specification to a single standard;
  - where the tested vehicle, mass, speed or angle differ from the threat, get an engineer's assessment.
- **12.5 / 12.6.2 / 12.10.2 Gaps:**
  - gaps between VSB elements, or between a VSB and other structures, no more than **1 200 mm, measured 600 mm above the finished surface**;
  - for measures lower than 600 mm, measure at the widest point;
  - for a 6–7 m road, deploy in each lane with gaps of no more than 1 200 mm;
  - non-fixed VSBs must be checked to keep this spacing (15.1).
- **12.4 Foundations:** deep (excavation over 0.5 m), shallow (under 0.5 m), or surface-placed with no excavation.
- **5.1 Threat methods:** parked vehicle, encroachment, penetrative, deception, duress, insider, and tamper/sabotage, plus layered combinations. The tool addresses **penetrative attack** speeds. Encroachment through gaps is addressed by the gap rule above.
- **Annex A Level 2 OR:**
  - Table A.12 asks, for each threat vehicle, the **impact angle and impact speed**. That is exactly what this tool's required-protection output provides, so the report can fill that table;
  - it also asks for blast stand-off, permitted penetration and debris distances;
  - A.7.2 lists attack scenarios.
- **Annex D:** an engineer should sign off installations against the tested performance.

## Implications for the tool (to do)

1. Once the owner confirms the mapping above, switch the draft designations to ISO 22343 form (e.g. `V/7200[N2A]/64/90`) using ISO test masses, and drop the "draft" label.
2. Done: test speeds are capped per class (Part 1 Table 5), so trucks above 80 km/h, flatbeds above 96 km/h, and cars or pick-ups above 112 km/h show "above …".
3. Add an Annex A Table A.12-style summary to the report: for each threat vehicle, the impact angle and speed.
4. When speed-reduction features are added to a vector, remind the user they should be impact-rated (9.2.4).
5. A future gap check should use 1 200 mm at 600 mm height.
6. A future stand-off check could compare each line of protection's distance to the asset with a product's penetration and debris distances (9.4.3).
