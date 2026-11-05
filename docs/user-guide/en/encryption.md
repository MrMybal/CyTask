---
id: encryption
title: Optional encryption at rest
section: Security and operations
order: 19
revision: 1
---

CyTask can encrypt stored content with AES-256-GCM. The option is disabled by default. It protects storage, not a compromised running server, and is not end-to-end encryption.

## Local workspace {#local-workspace}
For a new local workspace, enable Encrypt project data at rest in the desktop selector. Create a new key file outside the workspace and synchronized folder. Back it up separately. To reopen that workspace on another device, choose its existing key through a trusted transfer.

The desktop retains the key file’s path, not the key in the shared project. Losing the key makes encrypted content unrecoverable; changing an account password cannot recover it.

## Coverage and limits {#coverage-and-limits}
Local workspace manifests, snapshots and conflicts are encrypted. Media is encrypted in storage, including quarantine. Persistent server content fields are encrypted, but PostgreSQL routing metadata remains readable: identities, project/channel names, relationships, roles, dates, sizes and other structural fields.

Explicit downloads, exports, browser caches, logs, swap and historical backups are outside this storage feature. Authorized users and the running server can decrypt content. HTTPS and access controls remain necessary.

## Existing data: offline conversion {#existing-data-offline-conversion}
A toggle does not convert an existing workspace. Stop every server and local peer, pause Sync and verify complete backups before conversion.

An administrator must configure the original storage, encryption and the intended key, apply the required migrations, then run:

~~~text
CyTask.Api --encrypt-storage --confirm-backup
~~~

This is a maintenance command, not a normal startup option. Follow the repository’s complete encryption procedure for all local-engine settings and convert every peer with the same key before resuming Sync.

There is no automatic downgrade, online key rotation or secure erasure of old disk blocks and backup history. See [Sync and backup](doc:sync-backup) and [administration](doc:administration).
