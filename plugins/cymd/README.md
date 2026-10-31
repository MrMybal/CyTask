# CyMD editor integration

CyTask embeds a separate Web copy of [CyMD](https://github.com/MrMybal/CyMD), version 0.1.4, through its documented `cymd.integration` protocol. The original CyMD checkout is not changed.

CyMD retains its AGPL-3.0-only license, included in `LICENSE`. The Web package uses updated Markdown sanitization dependencies and supports the host's style nonce. Its distributable includes `LICENSE.txt` and the corresponding `source.zip` under `/plugins/cymd/`.

The common CyTask composer is implemented independently using CodeMirror and Markdown libraries. Its CyMD action opens the full editor in an iframe with exact-origin, source-window and session checks. Save a Markdown document (`.md`) to apply changes back to the field. Media pasted into the common composer are uploaded to the project library.

`npm run build:release` inside `web/` builds the editor and prepares its static files for the main Web build. No external hosted editor or desktop CyMD process is required.
