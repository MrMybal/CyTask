# CyTask documentation — CyDoc

[Documentation](https://mrmybal.github.io/CyTask/#/en/getting-started) · [Français](https://mrmybal.github.io/CyTask/#/fr/getting-started)

CyTask uses the locally packaged CyDoc 0.1.0 library at revision
774f2a7eabf7dd181a98ffc5add115b580b67f42. The MIT-licensed archive is pinned by
package-lock.json and kept in vendor; no private Git access is needed to rebuild.

## Generate

~~~sh
npm ci --prefix packages/documentation
node scripts/build-help.mjs
node scripts/build-help.mjs --check
~~~

Both build and check compile and validate a fresh export. Output is copied to
apps/web/public/help and bundled by the Web, Docker and Desktop builds.
apps/client/build/help-links.cjs is generated from CyDoc's DOM-free core for the
native application; it is included in the ASAR, not loaded as Node code from a
documentation file.

To read, open apps/web/public/help/index.html using a file URL. The offline ZIP
contains the same complete reader tree. Extract it before opening index.html.
No Web server or Node runtime is required for reading.

## GitHub Pages

The Documentation workflow generates the same reader on main and deploys only
the staged export using GitHub Pages Actions. Resources and hash-based routes
are relative to the project site, including its /CyTask/ prefix. English and
French README links select their locale explicitly; the standalone entry defaults
to English. The downloadable offline ZIP stays part of the site.

To reproduce site staging after generating the guide:

~~~sh
node --test scripts/tests/help-pages.test.mjs
node scripts/stage-help-pages.mjs
~~~

The site is generated below .build/pages. Staging copies reader resources byte
for byte, adds .nojekyll, checks the offline archive and rejects unknown files or
linked resources. Application builds still use apps/web/public/help unchanged.

## Modules and theme

Only image and gallery are selected. They cover the actual screenshots and media
collections in the existing documentation. Static diagrams use CyDoc's compiled
SVG blocks, not the interactive graph module. There are no documentary videos,
controllable GIFs or 3D assets to justify video, gif or mesh. Three.js is not
installed in either CyTask documentation or Web dependencies.

The application-owned bootstrap supplies the generated local module/asset
providers and a Graphite-like default theme. It keeps CyDoc's keyboard, touch,
in-window expansion, bookmarks and reading-position tools. It also identifies
CyTask's GPL license separately from the CyDoc reader's MIT license.

## Content and source scope

- docs/user-guide/en and fr: native CyDoc Markdown, 24 guide chapters per locale.
- imports.json: inventory and status of every imported technical reference.
- sourceAllowlist: only public SDK code, C# request/response contracts, exported
  Unreal headers and the contextual-help adapter are distributed as source pages.
- CyDoc extracts explicit bilingual annotations and builds a lexical source index.
- The checked-in OpenAPI contract is converted to CyDoc's neutral API-import
  schema. CyDoc does not supply a native OpenAPI importer or C# XML converter.
- Original monolingual technical content is retained with a source-language notice
  instead of being advertised as a completed translation.
- Vision, target architecture, roadmap and older interface notes are marked as
  design/history; the current guide explains shipped behavior.

The native translation report lists revision status. migration-report.json also
records provenance, source hashes, monolingual references and unresolved links.
Missing source links fail the export. reference-anchors.json maps the translated
technical headings to shared IDs. Sections absent from an original translation
retain their source-language content as an explicit fallback; translationGaps in
the migration report tracks those incomplete references.

## Links and compatibility

Page IDs and explicit anchors are shared between translations. Use CyDoc createLink.
Web entries use /help/manual.html to avoid an old HTTP cache; Desktop intercepts
trusted help routes and opens the installed index.html through pathToFileURL.
legacy-anchors.json preserves the old #/guide/page?section=... addresses, including
French heading slugs. The previous help service worker has a one-time retirement
script; it is not needed by the local reader.

A normal Web browser cannot open an arbitrary file on the user's machine. Web
users can read the static copy or download/extract the complete offline ZIP.
Desktop opens file:// directly, before any workspace or server is started.
Its separate persistent reader profile keeps bookmarks, notes and reading
positions between application launches, without sharing workspace cookies or IPC.

## Verify

~~~sh
npm run build --prefix apps/web
npm run test:help --prefix apps/web
npm run test:help-server --prefix apps/web
node --test apps/client/tests/help.test.cjs
node apps/web/tests/help-desktop.mjs
~~~

The file test extracts the ZIP into a path with spaces and non-ASCII text and opens
it with the network disabled. The Desktop smoke test needs installed Electron
dependencies. An installed browser channel can be selected with CYTASK_TEST_BROWSER.
Windows is available for native validation; Linux/macOS and Android devices still
need their own file/storage, touch and native-integration checks.

## Français

Le lecteur est exporté intégralement et s'ouvre en file://. Le Web propose aussi
l'archive complète à extraire. Seuls image et gallery sont activés ; les schémas
sont compilés en SVG. Modifiez les guides anglais/français ensemble et conservez
leurs identifiants. Les références monolingues et historiques restent explicites.
