---
id: sync-backup
title: Sync, backup and recovery
order: 20
description: Synchronize trusted devices and restore a workspace from an independent backup.
section: Start
parent: desktop-local
revision: 2
---

Sync mode is for trusted devices replicating a workspace folder, for example with Syncthing or a CyRevision-managed transport. CyTask’s shared-folder format is distinct from a live server database.

```diagram
{"type":"flow","title":"Device A · local workspace → Syncthing / CyRevision transport → Device B · local workspace","nodes":[{"id":"n0","label":"Device A · local workspace","x":20,"y":10,"width":400},{"id":"n1","label":"Syncthing / CyRevision transport","x":20,"y":130,"width":400},{"id":"n2","label":"Device B · local workspace","x":20,"y":250,"width":400}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"}]}
```

Snapshots and media travel with the folder. Sessions, tokens and keys stay device-specific.

## Set up Sync {#set-up-sync}
1. Create or open the workspace in Sync mode.
2. Configure the external synchronization tool to replicate the intended workspace root.
3. Let the first synchronization finish before opening it on another device.
4. On that device, choose the replicated root in the desktop client.
5. If encrypted, supply the same key separately; do not put it in the synchronized folder.

CyTask stores immutable workspace snapshots and media for this workflow. Device sessions, local access keys and private connection profiles must not be copied as shared credentials. Sync software is not automatically installed or configured by choosing this mode.

## Concurrent changes {#concurrent-changes}
Different devices can edit while disconnected. On reconnection, inspect reported conflicts and verify the resulting records. Do not erase a sync-conflict file simply because the name looks temporary; keep a recoverable copy until reconciliation is understood.

Do not synchronize an open PostgreSQL data directory or a live database file as a substitute for this mode. People who can write the shared folder are trusted workspace participants.

## Backup is different {#backup-is-different}
Synchronization propagates deletions and mistakes. Keep versioned, independently restorable backups of the full data and media, with encryption keys backed up separately.

For recovery, stop all writers and pause Sync on every peer. Restore into a separate location first, verify tasks and attachments with the matching software and key, then decide which copy is authoritative before resuming replication.

See [encryption](doc:encryption), [local workspaces](doc:desktop-local) and [troubleshooting](doc:troubleshooting).
## Export workspace data {#export-workspace-data}
Owners and administrators can open Team from Settings and tools, then choose
Export workspace. This downloads a versioned JSON export of data and members.
It is useful for inspection and interoperability, but is not a complete database,
media and encryption-key backup. Store an export as project data, not as a public
sample. Verify its intended contents before sharing it with another tool.
