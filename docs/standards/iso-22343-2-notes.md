# ISO 22343-2:2023 – reference notes for the VDA Tool

**What this is:** working notes, in our own words, on the parts of BS ISO 22343-2:2023 *Security and resilience — Vehicle security barriers — Part 2: Application* (incorporating corrigendum January 2024) that matter for this tool. It is **not** a copy of the standard. The standard is copyright ISO/BSI and licensed to a single named user; keep the purchased PDF in the owner's own files, not in this repository. Check any figure here against the standard before relying on it in a deliverable.

## Status of the standard

- Published 2023-09 (BS edition 2024). Replaces **IWA 14-2:2013**; in the UK it supersedes **PAS 69:2013** (withdrawn).
- Part 2 is guidance on selecting, installing and using vehicle security barriers (VSBs) and on writing operational requirements (ORs). Performance testing and rating is in **Part 1 (ISO 22343-1)**, which we do not hold yet.
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
| 7.5 t two-axle rigid (N2) | 7 500 kg | N2A, 7 200 kg (or N3C, 7 200 kg) | Close; owner to confirm which |
| 18 t two-axle rigid (N3) | 18 000 kg | No 18 t class in ISO 22343. Nearest: N3D 12 000 kg (2-axle) or N3E 24 000 kg (3-axle) | Owner to confirm |
| 30 t four-axle rigid (N3) | 30 000 kg | N3G, 30 000 kg | Exact match |

Until the owner confirms this table, the tool labels barrier designations as drafts.

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
2. Get ISO 22343-1 (Part 1) for the test speeds, the impact-angle options and the penetration part of the rating.
3. Add an Annex A Table A.12-style summary to the report: for each threat vehicle, the impact angle and speed.
4. When speed-reduction features are added to a vector, remind the user they should be impact-rated (9.2.4).
5. A future gap check should use 1 200 mm at 600 mm height.
6. A future stand-off check could compare each line of protection's distance to the asset with a product's penetration and debris distances (9.4.3).
