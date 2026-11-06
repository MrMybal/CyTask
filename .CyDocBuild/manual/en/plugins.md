---
id: plugins
title: Plugins and rich content
order: 14
description: Enable project integrations and use rich content actions.
section: Extensions
revision: 2
---

Plugins extend projects and task tabs without making every optional feature part of the core workflow. Enable the integration in the project’s Plugins page before expecting its controls to appear.

## Available integration families {#available-integration-families}
- Git links tasks to commits, branches and repository URLs. It is optional; a project does not need Git.
- AI Assistant provides provider connections and task-aware assistance.
- Unreal adds structured task data for engine-oriented work and assets.
- CyRevision links revision workflows with tasks.
- CyAnnota adds annotation workflows for supported images and videos.
- CyMD supplies richer Markdown editing where integrated.

A disabled plugin can hide its controls without implying that the underlying task has been deleted.

## Message and text extensions {#message-and-text-extensions}
Supported plugins can contribute content cards, resource actions or task tabs. Use these controls from the message, attachment or resource context in which they are offered. A preview is still subject to the original content’s permissions.

CyAnnota runs through the packaged integration in Web and desktop contexts; annotation support depends on the selected media and integration configuration.

## Boundaries {#boundaries}
The plugin system uses registered capabilities and supported renderers. It is not an arbitrary untrusted JavaScript marketplace. Server-side provider access and local executables can require administrator configuration.

Git references do not turn CyTask into a complete Git client. The Unreal integration does not guarantee every engine version: compatibility must be tested against the plugin and engine build used by your project. Review any asset recipe before running it in Unreal.

See [AI Assistant](doc:ai-assistant), [media](doc:files-media) and [administration](doc:administration).
