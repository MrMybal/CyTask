# Changelog

All notable changes to CyTask are documented in this file.

[Back to README](README.md) · [Français](CHANGELOG.fr.md)

## [Unreleased]

## [0.2.3] - 2026-11-06

**Stage: IN DEVELOPMENT · Published client: Windows x64.**

This is a development release for testing and feedback, not a declaration of production maturity. [Downloads and release notes](https://github.com/MrMybal/CyTask/releases/tag/v0.2.3) include the portable executable, installer and SHA-256 checksums.

### Added

- Published CyDoc reader on GitHub Pages with automatic documentation builds and localized README links.
- Local CyDoc documentation with complete English/French user guides, public API contracts and SDK signatures, screenshot galleries and SVG diagrams.
- Direct file-based Desktop help, contextual links and a downloadable self-contained offline manual.
- Documentation entry points in the Web interface, sign-in screen and Desktop selector, plus the Desktop Help menu and F1 shortcut.

- Server-like project navigation with categories, typed rooms, room links and project-specific roles.
- Markdown composers with mentions, task suggestions and embedded CyMD editing.
- Plugin actions on messages, text and shared media, including CyAnnota annotations.
- Live voice and camera rooms with independent screen sharing, device selection and configurable STUN/TURN connectivity.
- Optional or required two-factor authentication using authenticator apps or email codes, with account settings and recovery codes.
- Optional content encryption at rest for local/Sync workspaces, uploaded media and PostgreSQL content, with external desktop key files and an explicit offline conversion command.

### Improved

- Updated documentation reader with global header search, nested navigation, wider sidebar, descriptive tooltips and preserved reading positions.
- Standard Documentation.html/DocData layout with separate agent guidance, offline archive and compatible contextual help links.
- Clearer text, status and priority contrast across all six themes, including selected rows and keyboard focus.
- More readable compact-table labels and controls while preserving the compact layout.
- Expanded regression coverage for project access, content extensions, calls, authentication, encrypted storage and interface themes.

### Known issues

The published release notes do not provide an itemized confirmed-bug list. Consult the [issue tracker](https://github.com/MrMybal/CyTask/issues) or [report a problem](https://github.com/MrMybal/CyTask/issues/new). The limitations below are documented product boundaries, not invented bug tickets or a claim that no bugs exist.

### Documented limitations

- The published 0.2.3 native packages are Windows x64 only. Linux/macOS packaging targets exist in source but are not supplied as release binaries. No Android client is published.
- Windows executables are not Authenticode-signed; SmartScreen may display a warning. Close CyTask before updating and keep project folders and encryption-key backups.
- The Unreal connector is a source plugin, built separately for each engine/platform. Builds are documented for UE 5.2 and 5.8; the 4.27 target still needs validation on a complete engine installation. Compatibility across the entire 4.27–5.8 range is not guaranteed.
- Automatic task-upload video transcoding and antivirus scanning are not implemented. CyAnnota's separate WASM media engine does not provide those server-wide features. Playback depends on the browser's codecs.
- Calls use a peer-to-peer mesh, with 8 participants by default and a configurable maximum of 16. Separate networks can need a private TURN relay. No SFU, recording or guaranteed system-audio capture is provided.
- ClickUp/Jira migration keeps remote attachments as source links; it does not download their binary contents automatically.
- Sync requires a separately configured external transport and trusted folder participants. It is not a backup and must not replicate a live database directory.
- Encryption at rest is optional and is not end-to-end encryption. Existing data needs explicit offline conversion; losing the storage key is not recoverable by resetting an account password.

## [0.2.2] - 2026-10-25

### Added

- Solo local workspaces open directly without an interactive account screen.
- Agent members support durable work calls, notifications and atomic task claiming.
- A dependency-free JavaScript SDK and an MCP stdio bridge expose project and task orchestration to other applications.

### Fixed

- Local shutdown waits for a confirmed checkpoint, and large workspaces and annotations survive restarts.
- Synchronization preserves updated statuses, task assignments and concurrent changes.
- Canvas media are stored in the project library and shared between sessions.
- PostgreSQL collaboration reads use batched queries, and background workers recover from database outages.
- Collaboration refreshes are grouped to reduce redundant requests.

### Distribution

- Rebuilt Windows x64 portable client with the updated Web interface, local server and Electron runtime.
- The executable is not Authenticode-signed; Windows SmartScreen may display a warning.

## [0.2.1] - 2026-09-13

### Changed

- Desktop release builds now omit Web source maps and .NET debug symbols.
- The desktop sidecar now builds and embeds the CyAnnota Web plugin during every release build.
- Added a dedicated release build mode for the main Web interface and the CyAnnota integration.

### Distribution

- Updated Windows x64 portable executable and interactive NSIS installer.
- Binaries are not yet Authenticode-signed. Verify SHA256SUMS.txt before running them; Windows SmartScreen may display a warning.

## [0.2.0] - 2026-08-31

### Added

- ClickUp and Jira Cloud migration tool with a source preview, status and assignee mapping, and duplicate detection on repeated imports.
- Six persistent interface themes: Graphite, Midnight, Forest, Cloud, Paper and High contrast.
- Visual theme selection from Settings and tools, with English and French labels.
- Collapsible nested folders and task/group creation directly in the current view.

### Improved

- More compact workspace navigation, controls, task lists and settings.
- Consistent opaque surfaces, clearer borders and improved contrast across light and dark themes, including task tabs, menus, forms and plugin panels.
- Local sessions survive client restarts until their configured expiry; their storage stays on the device, outside synchronized project folders.
- Password confirmation when creating the first account.

### Fixed

- Blank local-workspace rendering and unreadable dark hover backgrounds in light-theme task tabs.
- Local session cookies and device-side session records are cleared when their saved workspace profile is removed.

### Windows update

- Windows x64 portable executable and interactive NSIS installer, both including the updated local server and Web interface.
- Back up your project folders before upgrading. Close CyTask, then run the new installer or replace the portable executable; keep your existing project data folders.
- Binaries are not yet Authenticode-signed. Verify SHA256SUMS.txt before running them; Windows SmartScreen may display a warning.

### Migration notes

Source credentials are not saved. Review the preview and mappings before importing. Source attachments are linked; their binary contents are not downloaded automatically.

## [0.1.0] - 2026-08-28

First public Windows client release.

### Highlights

- self-hosted project and task management with List, Compact, Kanban, Canvas and Graph views;
- local-folder mode with immutable snapshots designed for Syncthing and CyRevision Sync;
- English interface by default with persistent French support on Web and Desktop;
- project folders, custom colored statuses, multiple assignees, bulk editing and saved views;
- team chat with channels, private groups, task previews, attachments, voice and screen-sharing foundations;
- declarative Git, AI Assistant, Unreal Engine, CyRevision and CyAnnota plugin integrations;
- Windows x64 portable client and interactive NSIS installer including the local CyTask sidecar.

### Distribution note

The Windows binaries are not yet Authenticode-signed. Verify the published SHA-256 checksums before launching them.

[Unreleased]: https://github.com/MrMybal/CyTask/compare/v0.2.3...main
[0.2.3]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.3
[0.2.2]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.2
[0.2.1]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.1
[0.2.0]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.0
[0.1.0]: https://github.com/MrMybal/CyTask/releases/tag/v0.1.0
