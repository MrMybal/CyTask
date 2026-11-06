---
id: troubleshooting
title: Troubleshooting
order: 23
description: Resolve display, access, upload, call and local-workspace problems.
section: Help
parent: shortcuts
revision: 2
---

Start with the smallest reversible check. Do not delete a workspace, browser profile or database to fix a display problem.

## Blank screen or missing interface {#blank-screen-or-missing-interface}
Reload the page or reopen the workspace. Check that the server, Web assets and desktop bundle belong to the same build. In local mode, confirm the engine started and that the selected folder is the workspace root.

For remote mode, test the server address and HTTPS certificate. Keep any error message, but remove credentials before sharing diagnostics. Do not clear the data folder.

## Missing tasks or rejected edits {#missing-tasks-or-rejected-edits}
Clear filters, expand folders and use Show more on paginated lists. Verify you selected the expected project and room.

A forbidden response usually means missing project membership, a read-only role or restricted chat access. A revision conflict means another edit won: reload the record, compare and reapply only the intended change.

## Upload or playback problems {#upload-or-playback-problems}
Wait for all chunks and validation to finish. An attachment still in quarantine is not available. Check size/type errors and storage capacity. If a video downloads but does not play, its codec may be unsupported; try a compatible browser or convert a copy externally.

## Calls and account access {#calls-and-account-access}
Check operating-system and browser microphone/camera permissions, HTTPS and selected devices. For cross-network calls, verify TURN and WebSocket proxying. Use the call retry action after fixing the cause.

For MFA, use the latest email code, synchronize clocks for an authenticator, or use an unused recovery code. Never disable the installation’s security policy merely to skip an individual account problem.

## Local data and Sync {#local-data-and-sync}
A missing or wrong encryption key must be corrected with the original key; there is no plaintext fallback or password-based recovery. Stop before making further changes if files are unexpectedly unreadable.

Pause Sync before investigating conflicts or restoring backups. Keep copies until the authoritative state is identified.

## Help offline {#help-offline}
Desktop opens `Documentation/Documentation.html` as a local file. If resources are missing, reinstall the complete client rather than copying its executable alone. For a downloaded manual, extract the entire archive and keep `Documentation.html` beside its `DocData` folder. No Web server is required. Use the header search or Ctrl+K to find a topic. Bookmarks and notes depend on local browser storage; export notes when storage is unavailable.

See [backup](doc:sync-backup), [MFA](doc:mfa) and [administration](doc:administration) for the relevant procedures.
