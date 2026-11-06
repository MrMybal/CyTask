---
id: administration
title: Server administration
order: 21
description: Deploy a persistent team server and configure storage, mail and live calls.
section: Server
revision: 2
---

Use a persistent database and deliberate deployment configuration for a real team. The in-memory server and demo seed script are test tools, not a production service.

## Deploy and update {#deploy-and-update}
The repository provides `infra/compose.yaml`, its environment example and a server Dockerfile. Prepare private deployment values, then build and start from the repository root:
Persistent server storage also requires a plugin-secret key: supply a fresh
base64-encoded 32-byte cryptographically random key as `CYTASK_PLUGIN_SECRET_KEY`
in the private environment. The base Compose file does not forward that setting;
create a private `infra/compose.private.yaml` override:

~~~yaml
services:
  server:
    environment:
      CYTASK__PLUGINSECRETKEY: ${CYTASK_PLUGIN_SECRET_KEY:?Set the persistent plugin key}
~~~

Then start with both files:

~~~sh
docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.private.yaml up --build -d
~~~

Create your own private `infra/.env` from the example first. Replace every sample credential. The Compose service binds its application port to loopback; place a TLS reverse proxy in front of it, keep PostgreSQL private and preserve the named database/media volumes.

Before updating, back up the database, media and required keys. Stop or drain writers, apply the release’s schema migrations and test the restored service before inviting members back. Never use volume deletion as an update step.

## Essential settings {#essential-settings}
| Setting | Purpose |
| --- | --- |
| `CYTASK_DB_PASSWORD` | Unique database credential for Compose |
| `CYTASK_ALLOWED_HOSTS` | Actual permitted host names, separated as configured |
| `CYTASK_PUBLIC_ORIGIN` | Exact public HTTPS origin for call signaling behind TLS termination |
| `CyTask__PluginSecretKey` | Persistent provider-secret protection key |
| `CyTask__DataEncryptionEnabled` / `CyTask__DataEncryptionKey` | Optional content encryption and its separate key |
| `CyTask__MfaPolicy` | `disabled`, `optional` or `required` |
| `CyTask__MfaEncryptionKey` | Persistent MFA-secret protection key |

The `CyTask__...` names are direct server environment settings. Compose maps its documented `CYTASK_...` variables; additional server settings must be passed explicitly to the service. Do not assume an arbitrary variable is automatically forwarded.

## Email and live calls {#email-and-live-calls}
Email MFA needs SMTP host, port, sender and TLS mode: `StartTls` or `SslOnConnect`. Username and password are supplied together when authentication is required. Test delivery before enforcing email verification.

Proxy WebSocket upgrades for the call signaling endpoint. Configure your own indexed `CyTask__WebRtcStunUrls__0` and `CyTask__WebRtcTurnUrls__0` as needed. TURN requires `CyTask__WebRtcTurnSharedSecret`; relay-only mode also requires a working TURN service.

No public STUN/TURN provider is contacted by default. Call signaling is in-process: use one server process for calls unless shared routing/signaling has been implemented for your deployment. Mesh calls default to 8 participants, at most 16.

## Acceptance checklist {#acceptance-checklist}
Verify health, fresh member login, non-admin permissions, task editing, upload/download, a two-device call when used, and backup restoration. Serve the Web build and bundled guide from the same release as the server.

Detailed storage conversion and key handling are covered under [encryption](doc:encryption); see also [MFA](doc:mfa), [calls](doc:calls) and [backup](doc:sync-backup).
