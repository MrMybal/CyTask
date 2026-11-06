# CyTask documentation workspace

The human manual is English by default, with a complete French translation.
This directory is build input; it is never part of the distributed manual.
CyDoc 0.1.0 is pinned at `6ddf9a582defb2f11fbb3f992afef6f98dcadc93` in
the local MIT-licensed vendor archive. Normal builds need no private Git access.

## Generate and verify

From the repository root:

~~~sh
npm ci --prefix .CyDocBuild --no-audit --no-fund
node scripts/build-help.mjs
node scripts/build-help.mjs --check
node --test scripts/tests/help-pages.test.mjs apps/client/tests/help.test.cjs
npm run test:help --prefix apps/web
npm run test:help-server --prefix apps/web
node apps/web/tests/help-desktop.mjs
~~~

Both build and check write the export. Open `Documentation/Documentation.html`
directly with `file://`. Its only siblings are `DocAI.md` and `DocData/`.
`DocAI.md` is separate agent guidance, never a human navigation/search entry.
`DocData/cytask-help.zip` contains the same complete `Documentation/` tree;
extract it before opening. Reading needs neither Node nor an HTTP server.

The build copies the complete export into `apps/web/public/Documentation/`.
Web, Docker and the desktop sidecar include that directory. A DOM-free helper
is bundled separately into `apps/client/build/help-links.cjs` for native help.
Web builds and desktop startup invoke the stable `scripts/build-help.mjs` wrapper.

Tests write results only under `internal/`. Select an installed browser with
`CYTASK_TEST_BROWSER=msedge` if necessary. The desktop test requires Electron;
`CYTASK_TEST_HELP_LOCAL=1` also exercises a fresh local engine and contextual help.
`CYTASK_TEST_DESKTOP_EXE` selects an assembled client for the same checks.

## Authoring

- `manual/en/`, `manual/fr/`: human guides. Maintain matching page IDs and explicit
  anchors. English uses `revision`; French uses matching `sourceRevision`.
- Guide frontmatter: useful descriptions and the actual `parent`/`section` tree.
- `assets/`: only the screenshots and branding used in the manual.
- `public-api.mjs`, `api-titles.json`, `api-behavior.json`: bilingual API contracts.
  The checked-in OpenAPI is converted through CyDoc's structured `importApi`;
  no native OpenAPI or semantic C#/C++ importer is assumed.
- SDK annotations use CyDoc's `extractComments`. Only comments, public signatures
  and short examples are emitted, not method implementations or source listings.
- `extra-pages.mjs`: bilingual API introductions, gallery and connector guidance.
- `manual/*/reference/`, `generated/`, `Documentation/`: regenerated outputs.
- `reader/`: application-owned template/bootstrap/palette. Edit these sources,
  not exported scripts. CyDoc's current header search, tree, tooltips and 330px
  sidebar are retained, without old layout overrides.
- `internal/`: local work notes, former tooling and verification records, excluded
  from the reader, assets, Docker build context and Pages artifact.

Every generated API page has a real EN/FR pair, description and revision tracking.
Missing/outdated/untracked translations, mismatched anchors or source pages fail
the build. Historical design documents and maintenance notes stay in the repository,
not in the human reader. Never add account data or project exports as examples.

Only `image` and `gallery` modules are selected: actual screenshots and collections
need them. Diagrams compile to static SVG. No video, GIF, mesh or interactive graph
assets justify those readers; Three.js is not installed. Media enlargement stays
inside the window and closes with Escape. Themes and reading positions use the
existing `cytask-help` storage namespace.

## Links and distribution

Use stable CyDoc page IDs, anchors and `createLink`. Canonical Web help is
`/Documentation/Documentation.html`; native Help/F1 opens the installed file
before any workspace starts. `/help/index.html`, `/help/manual.html`, old
`#/guide/...` routes and known translated anchors retain compatibility redirects
or aliases. Removed source-browser routes resolve to the relevant public guide.
Old help service workers retire once and are not required by the reader.

The native reader keeps its own persistent, sandboxed profile with no application
IPC or Node bridge. Its local resources are confined to the installed manual.
Web users can download the ZIP, since browsers cannot open arbitrary local files.

~~~sh
node scripts/stage-help-pages.mjs
~~~

Pages staging checks the complete export and ZIP, then copies it byte for byte to
`.build/pages`, adds `.nojekyll` and a site-only `index.html` compatibility entry.
The canonical `Documentation.html` is the real reader, not an iframe/redirect.
The existing Documentation workflow builds and deploys that export on main.

Windows/Edge/Electron can be tested here. Linux/macOS, Android and platform-specific
media/storage behavior require validation on those platforms. Docker input tests
are not a substitute for an actual image build where Docker is available.

## Français

Modifiez les guides dans `manual/en` et `manual/fr`, avec les mêmes identifiants,
ancres et révisions suivies. Régénérez par `node scripts/build-help.mjs --check`,
puis ouvrez `Documentation/Documentation.html`. Le manuel humain ne contient ni
rapports de travail, ni consignes IA, ni fichiers d'implémentation. Les résultats de
vérification restent dans `internal/` ; les consignes IA distribuées sont séparées
dans `Documentation/DocAI.md`. Ne modifiez pas les exports à la main.
