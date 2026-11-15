# Optical Workbench

A browser-based planner for optical breadboards. Arrange and mount components, draw beam paths, and export an Excel parts list. The workbench includes the original optical component library and supports local STEP import.

## Run locally

Install Node.js 24, then run:

```sh
npm ci
npm test
node build-pages.mjs
```

Open `dist/Optical_Workbench.html` in Chrome or Edge. This build runs offline. The `dist` folder also contains the public landing page and example project. To try the example, choose **Project → Open** in the workbench and select `dist/Example.optics.json`.

## Publish on GitHub Pages

GitHub Pages serves the offline and guest workbench. For usernames, sign-in and saved projects there are two options:

- **Supabase (no server to run):** connect a free Supabase project and the Pages site gains username and password accounts. See [`supabase/README.md`](supabase/README.md).
- **Account server:** deploy the Node server below on an HTTPS host with persistent disk storage.

The GitHub repository can contain both builds.

1. Create a public repository named `optical-workbench` with `main` as the default branch. Push this folder as the repository root.
2. In **Settings → Pages → Build and deployment → Source**, choose **GitHub Actions**.
3. Run **Build and publish Optical Workbench** in the Actions tab if the initial push occurred before Pages was enabled. The deploy job shows the live URL.
4. Open the site and check the example project, STEP import, beam editing, save/reopen, and Excel export in a fresh browser profile.

See the [GitHub Pages publishing guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Run the account-enabled edition

```sh
npm ci
npm test
npm run build:accounts
npm start
```

Open `http://127.0.0.1:4173/`, launch the workbench and use **My projects → Create account**. Choose a unique username and a password of at least 8 characters. **Save to account** stores the current layout and its models. **My projects** lists saved layouts with their last modified dates and lets you open, delete or save a copy. Use **Project → Download project** for a portable backup. The hosted workspace uses manual saves.

The local server stores accounts, sessions and projects in `data/workbench.sqlite`. Set `NODE_ENV=production`, `HOST=0.0.0.0`, `PUBLIC_ORIGIN=https://your-workbench-host` and `DATABASE_PATH` pointing to a persistent volume when deploying behind an HTTPS reverse proxy. Set `PORT` if your host requires it. Run one server instance per database, back up the database, allow request bodies of at least 20 MiB, and enable edge rate limiting on account endpoints. The server uses the direct client address for its IP limit and does not trust forwarded headers. Each account has a 30-project and 100 MiB quota. Password recovery by email is outside this version.

## Data and dependencies

The workbench processes CAD geometry in the browser. Use **Project → Save** for a portable project. Autosave is browser- and origin-specific. The optional supplier finder opens an external site.

Built-in models include the Thorlabs MB1218 breadboard, NanoPlus laser, Alpes HHL QCL, flat and parabolic mirror frames, VIGO detector, and adjustable post holder. See `SOURCE_NOTICES.md`, `THIRD_PARTY_LICENSES.txt` and the notices under `vendor/` for dependency terms. Application source licensing is a separate decision for the project owner.
