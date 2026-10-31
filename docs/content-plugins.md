# Rooms and content extensions

Projects are displayed as server-like workspaces. Categories organize rooms for
tasks, chat, announcements, voice, shared documents, canvases, the file library and
task graphs. Existing tasks, folders, channels and resources are retained.

Project settings support inherited organization roles or an explicit private
membership list. Project members can be administrators, contributors or viewers.
Organization owners and administrators retain access. Private chat groups retain
their own membership checks; their metadata is not stored in the shared room list.
Announcement publishing is restricted to project administrators.

Room links use `#/servers/{projectId}/rooms/{roomId}`; task links can append
`/tasks/{taskId}`. Older `#/tasks/{taskId}` links remain supported. New-message dots
use per-user read timestamps on the current device, not synchronized read receipts
or push notifications. Voice/video rooms support live microphone, camera and
independent screen tracks with configurable STUN/TURN connectivity. See
[`live-calls.md`](live-calls.md) for deployment settings and current limits.

## Declarative contributions

The catalog retains `contributes.taskTabs` and adds optional `contentActions`:

```json
{
  "id": "context",
  "title": "Unreal context",
  "renderer": "fields",
  "surfaces": ["message", "text"],
  "fields": [{ "key": "notes", "label": "Notes", "type": "textarea", "maxLength": 20000 }]
}
```

Surfaces are `editor`, `message`, `text`, and `media`. Actions are shown only when
their plugin is enabled for the current project. The host implements a fixed
renderer registry, not arbitrary manifest-provided HTML or JavaScript:

- `fields`: a schema-validated panel attached to an existing message, task or
  resource. The Unreal plugin demonstrates this on message and text contexts.
- `cyannota`: the bundled image/video editor, also available on reviewed project
  resources in chat and the file library, independently of task attachments.
- `cymd`: the separately bundled Markdown editor. Saving a `.md` file updates the
  current draft; the user still submits the message or document normally. `.cymd`
  archives are not accepted as the value of a text field. Inline editors also
  support Markdown formatting, preview, mentions, task completion and file paste.

This is a host extension contract; it is not an installation marketplace for
untrusted executable plugins. Adding another renderer requires host code and
validation. Existing short labels, paths, credentials and structured lists remain
appropriate native inputs instead of rich-text editors.

## Versioned data and access

`GET` and `PUT` use:

```text
/api/v1/projects/{projectId}/content/{kind}/{id}/plugins/{pluginId}/{actionId}
```

`kind` is `message`, `task`, or `resource`. The server resolves the real target,
checks its project, checks private-channel membership for messages, checks plugin
activation and contribution scope, and rejects undeclared fields. Writes require
CSRF/session authorization or the existing scoped API authentication and a writable
project role. They include `{ "data": {}, "expectedRevision": 0 }`; a stale revision
returns 409 rather than overwriting another editor's changes. Disabling a plugin
hides its actions and blocks these endpoints without deleting existing data.

CyAnnota resource documents use the same version-1 annotation validation and 4 MiB
limit as task annotations. Media bytes stay in CyTask storage; image source markers
use `cytask-attachment:{id}` in the bridge format, including for resource IDs.

PostgreSQL stores content data in `content_plugin_data` with tenant isolation and
atomic outbox events. Local workspaces include the same data in their snapshots;
sync merges use revisions and the existing conflict reporting. Media files still
need to travel with the workspace's media folder.

## Bundled editors

CyAnnota and CyMD are integrated from copies inside `plugins/`; upstream projects
are not modified. CyMD runs in a same-origin frame with origin, source, protocol,
version and random session checks. It receives only the active draft, never an
authentication token. The copy retains its AGPL-3.0-only license and distributes
its corresponding frontend sources with the built plugin. See
[`plugins/cymd/README.md`](../plugins/cymd/README.md).

These frames contain trusted, bundled modules, not a security boundary for running
arbitrary untrusted code. Media access and annotation saves are authorized again
by the host/server. External images are links in the standard Markdown renderer,
not automatic tracking-image requests.
