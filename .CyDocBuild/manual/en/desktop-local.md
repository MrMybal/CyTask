---
id: desktop-local
title: Desktop client and local workspaces
order: 1
description: Open a personal folder, retain your session and move a local workspace.
section: Start
parent: getting-started
revision: 2
---

The desktop client offers two distinct entry points: connect to a remote server, or open a local workspace folder. A local workspace is a real working environment, not a read-only demo.

## Open a local workspace {#open-a-local-workspace}
1. In the desktop selector, choose local mode and select a dedicated folder.
2. Use the folder on this machine alone, or configure external Sync later if you want replication. The local storage format is Sync-ready in either case.
3. The local solo workspace opens directly as its local owner, without a sign-in form. Account setup and password confirmation apply to team-server accounts, not to opening a solo folder.
4. Create your projects and tasks. Existing folders reopen their existing workspace rather than starting a new project.

Local solo uses a local owner session and a loopback engine. You do not need to re-enter a server password at every launch. Remote sessions are retained while valid, but expiration, revocation or an administrator policy can require a new sign-in.

## Understand storage {#understand-storage}
Choose the workspace root, not its internal metadata directory. Shared workspace data and media belong in this folder. Desktop preferences, device identity and retained connection credentials are device-specific.

Do not edit internal snapshots or use the data folder as a collection of manually editable task JSON files. Use the interface or [agent API](doc:agents-api).

## Close, move and restore {#close-move-and-restore}
Close the workspace normally before copying or moving it. Keep a backup of the entire workspace, including media and any separately stored encryption key. Reopen the destination through the folder picker.

A local workspace assumes that people with write access to its folder are trusted. Use a team server for untrusted members or centrally enforced accounts.

For multiple devices, follow [Sync and backup](doc:sync-backup). For a blank screen or startup failure, see [troubleshooting](doc:troubleshooting).
