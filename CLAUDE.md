# Optical Workbench handoff

Optical Workbench is a Three.js application for laying out laser spectroscopy experiments. This folder contains the latest account beta, the offline edition, and the GitHub Pages build. All editions use the original component library.

## Run and build

- Open `dist/Optical_Workbench.html` for the prebuilt offline edition.
- With Node.js 24, run `npm start` and open `http://127.0.0.1:4173/` for the account edition. The prebuilt files are included.
- For development, run `npm ci`, then `npm test` and `npm run build:accounts`. The latter rebuilds the account and offline editions plus the Pages landing page. `node build-pages.mjs` builds the public static edition on its own.

## Source map

- `src/main.js`, `src/index.html`, `src/style.css` are the editor, workbench layout, and styles.
- `src/route-ui.mjs`, `src/routes.mjs`, `src/beam-ui.mjs`, and `src/beam.mjs` handle beam paths and optical calculations.
- `src/optics.mjs` is the physical beam model: Gaussian beams with M², thin lenses and focusing mirrors via ABCD matrices, and glass dispersion. `src/optics-ui.mjs` adds the Optics section in Properties, the beam summary, the hover readout and the practice bench. `src/optics-tour.mjs` is the guided optics tour. Beams with `physics: true` use the model, and items keep their settings in `item.optics`. Both fields are optional, so older projects load unchanged. `src/mode.mjs` holds the Simple and Scientific mode switch. It is a per-viewer preference stored in localStorage, not saved in projects. Simple mode hides all optics UI and draws every beam at its set diameter. `node scripts/lens-asset.mjs` builds the library lens, `src/lens.json`. `node scripts/optics-assets.mjs` builds the procedural splitter, window, filter, gas cells and fibre port, `src/optics-parts.json`. Gas cells have a transparent tube and a `cellSpec`; `src/cell.mjs` stretches the body to the cell length, and multipass cells draw their bounce pattern inside it. `node scripts/nanoplus-holes-down.mjs` lays the NanoPlus ICL on its side with its two mounting holes facing the breadboard.
- `src/diagram.mjs` and `src/diagram-ui.mjs` are the Diagram Image Output mode, opened from the header's Diagram button. It draws a clean top view for papers: a separate orthographic render without the breadboard, the table, post holders or mesh parts named post or base. Beams, numbered callouts, the legend and the scale bar are drawn on top as vector graphics. It exports PNG with the print DPI embedded, and SVG. Figure widths are journal column widths and text size is in points. Labels, hidden components and dragged callout positions are saved as the optional project field `diagram`.
- `src/holder-ui.mjs`, `src/holders.mjs`, and `src/transforms.mjs` handle mounting, height, rotation, and groups.
- `src/core.mjs` validates `.optics.json` files. `src/cad-worker.js` converts imported STEP files locally using the vendored OpenCascade importer.
- `src/account-ui.mjs`, `server/accounts.mjs`, and `server/start.mjs` implement signup, sign-in, and the saved project dashboard. Account-project storage requires the Node server and a persistent SQLite database. The hosting instructions are in `README.md`.
- `web/index.html` is the landing page shown before the workbench. `src/landing.mjs` is its live 3D bench tour, bundled inline by `build-landing.mjs`. It loads `web/hero-scene.bin`, which `node scripts/hero-scene.mjs` builds from the packaged library meshes. Rerun that script if those meshes change. `src/scene-fx.mjs` holds the optical table, shadows and camera motion shared by both pages.
- `mcp/server.mjs` is the MCP server (stdio JSON-RPC, no dependencies) that lets Claude build setups by chat. `mcp/workbench.mjs` holds its setup model:
  - `PARTS` gives each library part's optical point and axis, which decide placement and aiming. They are measured from the meshes: a mirror's `face` is the way its reflecting surface points in the part's own frame (`'+x'`, `'-x'`, or a compass angle, 315 for the 90° parabolic), and its point is on that surface. `tests/mcp.test.mjs` checks each mirror against its mesh. `repairOldMirrors` turns round mirrors that were placed before this;
  - it places parts on post holders and builds beam paths from distances and turns;
  - it traces beams with `src/optics.mjs` and runs collision and board-edge checks.
  The server also serves `dist/Optical_Workbench.html` on 127.0.0.1 as a live view. `src/live.mjs` is the workbench side; it only runs when the page address carries the server's `?live=` key. Items it places carry an optional `mcpPart` field. `build-mcp.mjs` packs `dist/Optical_Workbench.mcpb` for Claude Desktop. Setup instructions are in `mcp/README.md`, and the tests are in `tests/mcp.test.mjs`.
- `src/cloud-accounts.mjs`, `build-cloud.mjs` and `supabase/schema.sql` give the GitHub Pages build the same accounts through Supabase when `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set. Setup is in `supabase/README.md`.

## Original STEP files and runtime meshes

The seven original active-library STEP models are in `cad/original-step/`. The old mirror assembly is in `cad/legacy-step/` for compatibility work. It is hidden from the current component library.

The app bundles processed meshes from `src/models.json`, `src/lasers.json`, `src/default-components.json`, and `src/holder.json`. A change to a STEP file does not automatically change the corresponding packaged mesh. The processed holder closes the cross-hole in the silver post. Its original STEP retains the geometry as supplied. The processed VIGO mesh omits duplicate STEP geometry. Preserve stable component IDs, orientation, mounting references, holder roles, and the flat mirror's separate opacity control when updating meshes.

Use `dist/Example.optics.json` to exercise project loading. Keep `.optics.json` compatibility, the original library, and both account and offline builds when making changes. This package contains no account database or production secrets. Check redistribution permissions for vendor CAD before publishing the bundle publicly.
