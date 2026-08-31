# Changelog

All notable changes to CyTask are documented in this file.

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

[0.2.0]: https://github.com/MrMybal/CyTask/releases/tag/v0.2.0
[0.1.0]: https://github.com/MrMybal/CyTask/releases/tag/v0.1.0
