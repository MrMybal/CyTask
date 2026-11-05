# Authoring the CyTask manual

The manual is generated with the pinned local CyDoc package. See
[the integration and build documentation](../../packages/documentation/README.md).

## Edit a guide

Files under en and fr use CyDoc's frontmatter:

~~~markdown
---
id: tasks
title: Create and edit tasks
section: Everyday work
order: 4
revision: 1
---

## Update attributes {#update-attributes}

[Media](doc:files-media)
~~~

The French page uses the same id and explicit anchor, a translated title/section
and sourceRevision: 1 instead of revision. Increase the English revision when the
meaning changes; update sourceRevision only after the translation catches up.
Do not derive public anchors from translated wording.

Use image/gallery JSON fences with stable media IDs and assets/ paths. Use
diagram JSON fences for static SVG diagrams; Mermaid source in historical
references is preserved as code where applicable. Raw HTML is escaped by CyDoc.
Code highlighting is done at build time.

## Build and test

~~~sh
npm ci --prefix packages/documentation
node scripts/build-help.mjs
npm run test:help --prefix apps/web
npm run test:help-server --prefix apps/web
~~~

Both CyDoc build/check write the export. Do not hand-edit generated data.js,
manifest.json or reader scripts. Inputs, imports and the application-owned
bootstrap live in packages/documentation. Generated outputs are ignored.

Open the exported index.html directly with file://. For the Web, manual.html is a
compatibility entry and the Offline guide action downloads the complete ZIP.
Desktop Help/F1 opens the installed file and keeps an existing reader's position.

## Preserve source references

The importer retains the original technical documents and examples. Update their
source files rather than creating independent copies. imports.json marks
design/history and monolingual material. Native translation-report.json and the
migration report identify unfinished translation tracking and source gaps.

Source indexing is explicitly allowlisted. Adding an indexed file distributes its
complete contents with the manual. Keep indexes limited to public contracts and
SDK surfaces. CyDoc's index is lexical, not a semantic C#/C++ compiler.

## Français

Modifiez anglais et français ensemble. Les identifiants de pages, ancres et médias
restent identiques. Les révisions suivent les changements de sens, pas seulement
la date de génération. Le rapport distingue les traductions rédigées des références
originales monolingues. Ouvrez le résultat en fichier local pour tester réellement
la lecture hors ligne, et non uniquement via un serveur de développement.
