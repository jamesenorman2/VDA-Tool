# VDA Tool – standing rules

These come from the project owner and apply to every change.

- **Version number.** `src/version.js` is the single source and must match `package.json` (a test checks it). It is shown at the top of every page and in every copied output. Bump it on every change merged to main: minor for features, patch for fixes.
- **Always merge to main.** Work on the session branch, open a pull request, and merge it to `main` when tests pass. The owner has given standing permission for this.
- **Outputs must be copyable into a report.** Every results table has a copy button that puts an HTML table (pastes into Word) and tab-separated text on the clipboard, with a source line naming the tool version. Charts and sketches copy as PNG on white. Copied content is always light-styled, whatever the page theme.
- **Dark mode is an option and on by default.** Every page sets `data-theme` from `localStorage['vda-theme']` (default `dark`) in an inline head script and has a toggle. Colours come from CSS tokens; print is always light.
- **Entry order is always start of route → asset.** There is no setting for it.
- **Start conditions:** standing (from rest), entry speed (km/h, capped at top speed) or rolling (already at top speed). Explain them in the UI; the calculator shows all three side by side.
- Run `npm test` before every commit. Do not put model identifiers in commits or code.
