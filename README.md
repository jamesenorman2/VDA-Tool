# VDA-Tool

Vehicle dynamics assessment for hostile vehicle mitigation: given an approach route
(straights and curves ending at an asset), it computes the maximum speeds six vehicle
classes can reach, with a route sketch, speed-vs-distance chart and speed table.

Dependency-free static app (vanilla ES modules, hand-rolled SVG).

```bash
npm start      # serves http://localhost:8080
npm test       # unit tests for the maths and sketch geometry
```

- `src/quickentry.js` – quick-entry/CSV line parser (units, left/right/straight)
- `src/maths.js` – acceleration curves, cornering limits, route traversal, chart subdivision, validation
- `src/sketch.js` – route sketch geometry (drawn in direction of travel; left = driver's left)
- `src/app.js` – UI: settings, data entry (validation, keyboard shortcuts), outputs, print view

Sections are stored nearest-asset first; the "Entry order" setting (default: start of route → asset) controls how they are shown, numbered and added. State is kept in `localStorage`.
