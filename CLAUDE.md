# Optical Workbench handoff

Optical Workbench is a Three.js application for laying out laser spectroscopy experiments. This folder contains the latest account beta, the offline edition, and the GitHub Pages build. All editions use the original component library.

## Run and build

- Open `dist/Optical_Workbench.html` for the prebuilt offline edition.
- With Node.js 24, run `npm start` and open `http://127.0.0.1:4173/` for the account edition. The prebuilt files are included.
- For development, run `npm ci`, then `npm test` and `npm run build:accounts`. The latter rebuilds the account and offline editions plus the Pages landing page. `node build-pages.mjs` builds the public static edition on its own.

## Source map

- `src/main.js`, `src/index.html`, `src/style.css` are the editor, workbench layout, and styles.
- `src/route-ui.mjs`, `src/routes.mjs`, `src/beam-ui.mjs`, and `src/beam.mjs` handle beam paths and optical calculations.
- `src/holder-ui.mjs`, `src/holders.mjs`, and `src/transforms.mjs` handle mounting, height, rotation, and groups.
- `src/core.mjs` validates `.optics.json` files. `src/cad-worker.js` converts imported STEP files locally using the vendored OpenCascade importer.
- `src/account-ui.mjs`, `server/accounts.mjs`, and `server/start.mjs` implement signup, sign-in, and the saved project dashboard. Account-project storage requires the Node server and a persistent SQLite database. The hosting instructions are in `README.md`.

## Original STEP files and runtime meshes

The seven original active-library STEP models are in `cad/original-step/`. The old mirror assembly is in `cad/legacy-step/` for compatibility work. It is hidden from the current component library.

The app bundles processed meshes from `src/models.json`, `src/lasers.json`, `src/default-components.json`, and `src/holder.json`. A change to a STEP file does not automatically change the corresponding packaged mesh. The processed holder closes the cross-hole in the silver post. Its original STEP retains the geometry as supplied. The processed VIGO mesh omits duplicate STEP geometry. Preserve stable component IDs, orientation, mounting references, holder roles, and the flat mirror's separate opacity control when updating meshes.

Use `dist/Example.optics.json` to exercise project loading. Keep `.optics.json` compatibility, the original library, and both account and offline builds when making changes. This package contains no account database or production secrets. Check redistribution permissions for vendor CAD before publishing the bundle publicly.
