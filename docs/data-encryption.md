# Optional data encryption at rest

Disabled by default. This protects stored content, not a compromised running server.
The application decrypts content for authorized users, search, previews and agents.
It is **not end-to-end encryption** and does not replace HTTPS, access controls or
disk/volume encryption. It does not hide information from the server administrator
who controls the running process and its key.

## Coverage

- Local/Sync: complete workspace manifest, immutable snapshots and conflict JSON.
  Tasks, project names, messages, documents, permissions and plugin data in those
  snapshots are encrypted before writing to disk. Syncthing transports ciphertext.
- All modes: uploaded media chunks, quarantine and available media objects. Video
  seeking/range requests decrypt bounded 64 KiB blocks, without plaintext temporary
  media files. Media inspection receives a decrypting stream, not a disk copy.
- PostgreSQL: task titles/descriptions, comments, checklists, activity actor names
  and summaries, attachment filenames, external-link labels/URLs, resource names
  and bodies, channel topics, messages, task plugin data/history, annotations,
  room configuration, content plugin data, agent descriptions/notifications and
  event outbox payloads.
- PostgreSQL routing metadata stays readable: IDs, relationships, project and
  channel names/keys, folder/status/label names, identities/email, roles,
  assignments, timestamps, sizes, MIME types, hashes and external-reference
  identifiers. Protect the database volume too if these are confidential.
- Authentication hashes and provider/MFA secret protections retain their separate
  existing mechanisms and keys. Device-only session registries are not workspace
  content. Explicit downloads, exports, backups, browser caches, logs, swap and
  crash dumps are outside this content-storage feature.

## New desktop local workspace

In the local workspace selector, enable **Encrypt project data at rest**, select
**New key** and save the `.cytask-key` file outside the project/synchronized folder.
Back it up separately before storing important work. **Choose key** opens an
existing encrypted workspace, including a copy synchronized to another computer.
The desktop stores only the key file's path in its private connection profile;
the key does not pass through the web renderer or enter the synchronized folder.
The key file contains a secret: secure its permissions/location and transfer it
through a separate trusted channel. Never commit it or send it in a chat.

The toggle cannot convert an existing unencrypted workspace. Such a workspace is
refused until the explicit offline conversion below has completed. An encrypted
workspace also refuses to open with encryption disabled or a different/missing key.

## New server or command-line local workspace

Supply these via your deployment's secret/configuration mechanism:

```text
CyTask__DataEncryptionEnabled=true
CyTask__DataEncryptionKey=<base64 encoding of 32 cryptographically random bytes>
```

Generate a fresh key with a cryptographically secure generator. Do not reuse the
MFA/provider key. Do not place a real key in appsettings, source control, an image
or a workspace. For Compose the corresponding names are
`CYTASK_DATA_ENCRYPTION_ENABLED` and `CYTASK_DATA_ENCRYPTION_KEY`.
Use a secret manager/protected environment; process owners can inspect environment
variables. A desktop `.cytask-key` file's `key` property is the base64 value for
the local engine's environment.

Authenticated users can check `/api/v1/storage/security`; settings show the same
enabled/disabled state. No key, key path or key fingerprint is exposed by this API.

## Converting existing data — offline only

1. Stop **all** CyTask server/desktop processes and pause synchronization on every
   device. Use the current binary for every peer afterwards. Do not convert a
   live database or let another device write old plaintext snapshots.
2. Back up the entire database/workspace/media and the encryption key separately.
   Check that those backups can be restored. Old backups remain unencrypted.
3. Configure the original storage paths/connection, enable encryption and supply
   the intended key, then run the server engine once with these explicit arguments:

   ```text
   CyTask.Api --encrypt-storage --confirm-backup
   ```

   Or `dotnet CyTask.Api.dll --encrypt-storage --confirm-backup`. For a local folder
   also supply the normal `LocalMode`, `UseInMemoryStore`, `LocalWorkspacePath`,
   `LocalDeviceId`, `LocalAccessKey` and `MediaStoragePath` settings. Apply schema
   migration 032 first (or set `ApplyMigrations=true`). This command does not start
   the HTTP listener. It exits on a wrong key or invalid configuration.
4. Wait for success. Database conversion is one transaction. Files are replaced
   atomically, one at a time; interrupted conversions can be rerun with the same
   key and arguments. Do not resume ordinary use partway through conversion.
5. Start normally with encryption enabled and the same key. Verify tasks, chat
   and media. Migrate each offline peer with the **same** key before resuming sync.
   Encryption is a workspace-wide choice: mixed encrypted/plain peers are unsupported.

The normal startup path never converts existing content. There is no automatic
decryption/downgrade or online key rotation. Restoring an old backup requires its
matching key and may require repeating the explicit conversion. Changing the key
alone makes stored data unreadable; keep it stable and backed up. There is no
password reset or administrator recovery for a lost storage key.

Replacing files/rows is **not secure erasure** of old disk blocks, PostgreSQL WAL,
replicas, filesystem history or Syncthing versions. Handle historical plaintext
copies according to your storage/backup retention policy. Consider an encrypted
volume from the start. Conversions can require substantial temporary space and
database transaction/WAL capacity.

## Format and performance

AES-256-GCM with authenticated 128-bit tags. Random per-value/file salts derive
independent keys with HKDF-SHA256. Text uses randomized nonces; binary storage
uses unique indexed nonces under each derived file key and an authenticated
length header. Altered/truncated content or a wrong key fails authentication.
The format is versioned; it is not intended as a standalone interoperable vault.

Database metadata filters still run in SQL. Text search and alphabetical task
sorting decrypt matching candidates in the server process rather than retaining
a plaintext search index. Expect additional CPU/I/O for large searches. The
encryption key is global to the configured server; separate installations/keys
are needed for cryptographic tenant separation.

Implementation uses [.NET authenticated AES-GCM](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.aesgcm.encrypt?view=net-10.0).
