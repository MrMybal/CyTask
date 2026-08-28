[**English**](README.md) | [Français](README.fr.md)

<p align="center">
  <img src="assets/branding/cytask-logo.png" alt="CyTask logo" width="360" />
</p>

# CyTask

CyTask is an open-source, self-hostable project and task manager built for digital production teams and Unreal Engine projects.

It works with or without a Git repository. Git, Unreal Engine, media processing, AI assistants, CyRevision and CyAnnota are optional integrations around a standalone core.

## Goals

- fast installable Web application and Electron client for Windows, Linux and macOS, with Android planned;
- secure and auditable self-hosted team server;
- projects, folders, tasks, subtasks, labels, comments, dependencies, attachments and real-time updates;
- image and video previews with optional local conversion and server-side processing;
- commits, branches and pull requests linked to tasks through the Git plugin;
- CyTask panel for Unreal Engine 4.27 through 5.8;
- controlled asset recipes that can be reviewed and executed from Unreal;
- signed, permission-scoped extensions;
- local-first projects and folder synchronization compatible with Syncthing and CyRevision Sync.

## Current state

The first secure vertical slice is implemented: initial owner bootstrap, sessions, single-use invitations, roles, organizations, projects, editable revision-controlled tasks, multiple assignees, custom colored statuses, subtasks, labels, checklists, comments, dependencies, search, activity history, JSON export and real-time events.

The responsive Web client provides List, Compact table, Kanban, free multimedia Canvas and relationship Graph views. It includes persistent folders and subfolders, saved views, per-column sorting, configurable columns, bulk updates, light and dark themes, command palette, quick task creation, server cursor pagination and shareable task links. A demo seed generates 220 realistic tasks for interface and performance testing.

Attachments are hashed in the browser, uploaded in verified chunks and quarantined outside the Web root. The media worker validates PNG, JPEG, GIF, WebP, MP4 and WebM containers before making them available to their organization. Validated images and videos have previews, downloads and in-task playback with range requests. Video transcoding and antivirus scanning remain planned.

Each workspace has a resource library for documents, canvases and server files. Team chat supports project channels, private groups, mentions, task link previews, images, videos and files. Voice and screen sharing use authenticated WebRTC signaling; deployments across strict NAT or firewalls will require a private TURN relay.

The declarative plugin platform currently includes Git, AI Assistant, Unreal Engine, CyRevision and CyAnnota integrations. Plugin manifests cannot inject JavaScript or HTML: only server-validated declarative fields are rendered. AI Assistant supports multiple encrypted connection profiles for OpenAI, Anthropic, compatible APIs, Ollama, LM Studio, Codex, Claude Code and OpenCode.

CyTask Desktop can connect to multiple IP addresses or domains with sessions isolated by origin. It can also open a local folder through a self-contained sidecar bound to `127.0.0.1`. Local mode stores immutable snapshots and media in a format designed for Syncthing or CyRevision Sync without replicating a live database.

The Unreal source plugin includes a Slate panel, personal tasks, self-assigned task creation, file/asset history, browser PKCE sign-in, project and task browsing, token revocation and validated asset recipes. The connector currently compiles on UE 5.2 and 5.8; UE 4.27 validation still requires a complete engine installation.

PostgreSQL is the production persistence target. Explicit in-memory storage is available for tests and fast local development.

## Windows client

Download the latest Windows x64 installer or portable client from [GitHub Releases](https://github.com/MrMybal/CyTask/releases/latest). Published releases include SHA-256 checksums. The current binaries are not yet Authenticode-signed, so Windows SmartScreen may display a warning.
## Languages

English is the default language in the Web application, PWA metadata and Desktop workspace selector. French remains available from the **EN / FR** selector and the preference is saved locally on each client.

System status names are translated by the interface. Project names, custom status names, tasks, comments and other user-authored content are never translated or renamed automatically.

## Quick start

With Node.js 22 and the local `.tools/dotnet` SDK already installed:

```powershell
./scripts/dev.ps1
```

Then open `http://127.0.0.1:5173`. This development configuration uses in-memory storage and loses its data after restart. For PostgreSQL and container deployment, see [infra/README.md](infra/README.md).

Build the Desktop client from `apps/client`:

```powershell
Push-Location apps/client
npm ci
npm run dist:win
Pop-Location
```

To populate the local server with the fictional **Nebula Station** project, run this in another terminal while development mode is active:

```powershell
pwsh ./scripts/seed-demo.ps1
```

The idempotent seed creates a team, **220 tasks**, statuses, priorities, deadlines, multiple assignees, folders and subfolders, subtasks, checklists, comments, Git references, dependencies, plugin data, six workspace resources, four chat channels, a private group and example discussions. Demo credentials are printed at the end.

Plugins and scripts can use the API through a personal `cytask_pat_…` token created in the Web client's **API** section. Tokens support read-only or read/write scopes, optional expiration and immediate revocation. The OpenAPI contract is served at `/api/v1/openapi.json`.

```bash
curl -H "Authorization: Bearer cytask_pat_…" http://127.0.0.1:5080/api/v1/projects
```

## Documentation

Most detailed technical documents are currently written in French:

- [Product vision and scope](docs/01-vision-produit.md)
- [Architecture](docs/02-architecture.md)
- [Security](docs/03-securite.md)
- [Roadmap](docs/04-feuille-de-route.md)
- [Development guide](docs/05-developpement.md)
- [Task interface](docs/06-interface-taches.md)
- [Plugin and integration API](docs/07-api-plugins.md)
- [CyAnnota annotations](docs/08-cyannota.md)
- [Local mode and folder synchronization](docs/09-mode-local-sync.md)
- [Desktop client](apps/client/README.md)
- [Architecture decisions](docs/decisions)
- [Plugin contracts](packages/contracts)
- [Unreal plugin](integrations/unreal/README.md)

## Repository layout

```text
apps/                  server, Web and clients
integrations/unreal/   Unreal plugin and compatibility layers
packages/              shared contracts and SDKs
plugins/               official plugins, including Git
infra/                 local and production deployment
docs/                  product, architecture, security and decisions
```

## Verification

```powershell
./.tools/dotnet/dotnet test CyTask.slnx
Push-Location apps/web; npm run build; Pop-Location
Push-Location plugins/cyannota/web; npm run build; Pop-Location
Push-Location apps/client; npm run check; Pop-Location
```

Unreal build and test commands are documented in [`integrations/unreal/README.md`](integrations/unreal/README.md).

## License

CyTask is distributed under the [GNU Affero General Public License v3.0](LICENSE), like CyRevision. Modified versions offered over a network must preserve the same freedoms and make their corresponding source code available to users.
