# Third-party source and replacement

The application source is provided in this package. Three.js 0.180.0 and esbuild 0.25.11 use MIT licenses; see THIRD_PARTY_LICENSES.txt.

occt-import-js 0.0.23 is distributed unmodified under LGPL 2.1. Its upstream source is https://github.com/kovacsv/occt-import-js and its npm release includes the C++ wrapper and build scripts, copied into vendor/occt-import-js-source. OpenCascade Technology is used under LGPL 2.1 with the upstream additional exception; see vendor/license.occt.txt and https://github.com/Open-Cascade-SAS/OCCT for its source. The wrapper build scripts record the upstream build configuration.

The unmodified JavaScript factory and WebAssembly binary are in vendor/. You can replace them and run npm run build to relink/rebuild the complete offline HTML with your chosen compatible build. No integrity lock prevents replacement. Reverse engineering needed to debug changes to these libraries is permitted. Keep original notices when redistributing.
