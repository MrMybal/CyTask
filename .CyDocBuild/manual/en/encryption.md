---
id: encryption
title: Optional encryption at rest
order: 19
description: Protect stored content and retain the keys needed to reopen it.
section: Server
parent: administration
revision: 2
---

CyTask can encrypt stored content with AES-256-GCM. The option is disabled by default. It protects storage, not a compromised running server, and is not end-to-end encryption.

## Local workspace {#local-workspace}
For a new local workspace, enable Encrypt project data at rest in the desktop selector. Create a new key file outside the workspace and synchronized folder. Back it up separately. To reopen that workspace on another device, choose its existing key through a trusted transfer.

The desktop retains the key file’s path, not the key in the shared project. Losing the key makes encrypted content unrecoverable; changing an account password cannot recover it.

## Coverage and limits {#coverage-and-limits}
Local workspace manifests, snapshots and conflicts are encrypted. Media is encrypted in storage, including quarantine. Persistent server content fields are encrypted, but PostgreSQL routing metadata remains readable: identities, project/channel names, relationships, roles, dates, sizes and other structural fields.

Explicit downloads, exports, browser caches, logs, swap and historical backups are outside this storage feature. Authorized users and the running server can decrypt content. HTTPS and access controls remain necessary.

## Server configuration {#server-configuration}
For a new server, supply these settings through your deployment's protected configuration mechanism:

~~~text
CyTask__DataEncryptionEnabled=true
CyTask__DataEncryptionKey=<base64 encoding of 32 cryptographically random bytes>
~~~

Generate a fresh key with a cryptographically secure generator; do not reuse the MFA or provider key. For Compose, the names are `CYTASK_DATA_ENCRYPTION_ENABLED` and `CYTASK_DATA_ENCRYPTION_KEY`. A desktop `.cytask-key` file's `key` property contains the base64 value used by the local engine. Never store a real key in the project, synchronized folder or application image. Process owners can inspect environment variables: use an appropriate secret manager or protected environment.

Settings and `GET /api/v1/storage/security` show whether encryption is enabled, without returning the key or its path.

## Existing data: offline conversion {#existing-data-offline-conversion}
A toggle does not convert existing data. Conversion is an administrator operation:

1. Stop **all** CyTask server and desktop processes. Pause Sync on every device so no peer writes during conversion.
2. Back up the complete database or workspace, media and key separately. Check that the backups can be restored. Old backups remain unencrypted.
3. Configure the original storage connection and paths, enable encryption and supply the intended key. Apply schema migration 032 first, or set `ApplyMigrations=true`. For a local folder, also supply its normal `LocalMode`, `UseInMemoryStore`, `LocalWorkspacePath`, `LocalDeviceId`, `LocalAccessKey` and `MediaStoragePath` settings. Run the engine once:

~~~text
CyTask.Api --encrypt-storage --confirm-backup
~~~

Or use `dotnet CyTask.Api.dll --encrypt-storage --confirm-backup`. This maintenance command does not start an HTTP listener and refuses a wrong key or invalid configuration.

4. Wait for success. Database conversion uses one transaction; files are replaced atomically one at a time. If interrupted, rerun with the **same key and arguments**. Do not resume normal use halfway through conversion.
5. Start normally with encryption enabled. Check tasks, messages and media. Convert every offline peer with the **same key** and use current binaries before resuming Sync. Mixed encrypted and unencrypted peers are unsupported.

Allow enough free space and database transaction/WAL capacity. Restoring an old backup requires its matching key and may require repeating conversion. Changing only the configured key makes existing content unreadable.

There is no automatic downgrade, online key rotation or secure erasure of old disk blocks and backup history. See [Sync and backup](doc:sync-backup) and [administration](doc:administration).
