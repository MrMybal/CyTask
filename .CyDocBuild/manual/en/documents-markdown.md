---
id: documents-markdown
title: Documents and formatted text
order: 9
description: Write shared documents and formatted descriptions with Markdown and CyMD.
section: Daily work
parent: projects-rooms
revision: 2
---

Use a Document resource for a shared page, and task descriptions or chat messages for text attached to ongoing work. Documents can be organized with other resources in project folders.

## Write a document {#write-a-document}
Create a document from the resource controls, give it a descriptive name and choose its folder. Edit its content, inspect the rendered preview and save. Reopen it to confirm the intended revision is present.

Markdown supports headings, emphasis, lists, links, quotes and code blocks. For example:

~~~markdown
## Acceptance criteria
- Reproduce the issue
- Attach a test video
- **Confirm** the expected result

See the related task using its shared link.
~~~

## Editor and preview {#editor-and-preview}
CyTask uses its integrated formatted-text tools and the CyMD integration where available. Opening a dedicated editor edits a draft. Applying the draft returns text to the calling form; save or send that form to persist the final result.

A preview is a rendering of text, not permission to execute HTML or scripts. Copying code into a message does not execute it on the server.

## Links and extensions {#links-and-extensions}
Use the link control or paste a task URL to reference existing work. Message and text extensions can provide richer previews through supported plugins. A plugin must be enabled for the project and match the resource type.

Do not place access tokens or passwords in documents as a convenient way to configure an integration. Use the integration’s connection settings instead.

For shared media use [files](doc:files-media); for supported text extensions see [plugins](doc:plugins).
