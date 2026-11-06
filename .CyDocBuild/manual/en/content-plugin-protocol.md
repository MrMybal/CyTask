---
id: content-plugin-protocol
title: Rich-content extension contract
description: Declare message, text and media actions with validated, revisioned data.
section: Developers
parent: api-reference
order: 168
revision: 1
---

Plugin catalogs keep `contributes.taskTabs` and may declare `contentActions`. A contribution is visible only when its plugin is enabled for the project. This is a fixed host-renderer contract, not an executable marketplace.

## Declare an action {#declare-action}

For example, an entry in `contentActions` can describe fields on messages and text:

~~~json
{
  "id": "context",
  "title": "Unreal context",
  "renderer": "fields",
  "surfaces": ["message", "text"],
  "fields": [
    {"key": "notes", "label": "Notes", "type": "textarea", "maxLength": 20000}
  ]
}
~~~

Supported surfaces are `editor`, `message`, `text` and `media`. Renderer `fields` opens a schema-validated panel; `cyannota` opens the bundled annotation editor; `cymd` edits a Markdown draft. A renderer must already be implemented and validated by the host: manifests cannot inject JavaScript or HTML.

CyMD saving updates the active draft; the user still submits the message or document normally. A `.cymd` archive is not a text-field value. Native short labels, credentials and structured fields remain native inputs rather than rich-text editors.

## Read and write action data {#action-data}

Use the [room/content operations](doc:rooms-api#operations):

~~~text
GET /api/v1/projects/{projectId}/content/{kind}/{id}/plugins/{pluginId}/{actionId}
PUT /api/v1/projects/{projectId}/content/{kind}/{id}/plugins/{pluginId}/{actionId}
~~~

`kind` is `message`, `task` or `resource`. The server resolves the real target, checks the project, private-conversation membership, plugin activation and contribution scope. Writes require a writable project role plus session/CSRF or scoped API authorization; undeclared fields are rejected.

~~~json
{"data": {"notes": "Review the selected assets"}, "expectedRevision": 0}
~~~

Use the revision returned by the last read. A stale revision returns 409: reload and reconcile rather than overwriting. Disabling a plugin hides its actions and blocks these operations without deleting existing data.

## Media and storage {#media-storage}

CyAnnota uses version-1 validated annotations, with a 4 MiB document limit. Media bytes stay in CyTask storage. The bridge identifies task attachments and shared resources with `cytask-attachment:{id}` markers. Media reads and annotation saves are authorized again by the host/server.

PostgreSQL stores content action data with tenant isolation and atomic outbox events. Local workspaces keep it in snapshots; Sync uses revisions and conflict reporting. The media folder must travel with the snapshots.

Bundled CyMD frames check origin, source, protocol, version and a random session value. They receive the active draft, not an authentication token. These are trusted bundled editors, not a sandbox for arbitrary code. External Markdown images remain links rather than automatic remote-image requests. See [plugins](doc:plugins), [media](doc:files-media) and [documents](doc:documents-markdown).
