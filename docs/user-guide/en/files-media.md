---
id: files-media
title: Files, images and videos
section: Everyday work
order: 7
revision: 1
---

Files can belong to tasks, chat messages or project resources. The Files room provides a project-level view of stored content, subject to your permissions.

## Attach and preview {#attach-and-preview}
Drop files into an open task or the supported chat upload area, or use the file picker. Wait for the upload to finish before leaving. Images appear as previews; videos can play inline when the browser supports their codec.

Click an image preview to enlarge it. The media viewer offers a download action. Video controls allow playback and seeking; downloading preserves the file rather than a screenshot of its preview.

```diagram
{"type":"flow","title":"Select / drop a file → Hash and upload chunks → Quarantine / inspection → Authorized preview / download","nodes":[{"id":"n0","label":"Select / drop a file","x":20,"y":10,"width":400},{"id":"n1","label":"Hash and upload chunks","x":20,"y":130,"width":400},{"id":"n2","label":"Quarantine / inspection","x":20,"y":250,"width":400},{"id":"n3","label":"Authorized preview / download","x":20,"y":370,"width":400}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"},{"from":"n2","to":"n3"}]}
```

## Understand upload processing {#understand-upload-processing}
Uploads use chunks and integrity hashes. New media is checked in quarantine before it becomes available. A failed or interrupted transfer is not a completed attachment. Retry through the displayed upload controls rather than manually placing a file in server storage.

Supported preview containers include common PNG, JPEG, GIF and WebP images, and MP4/WebM videos. An accepted container does not guarantee that every codec can be decoded by every browser.

Container inspection is not a general antivirus scanner. Do not open untrusted downloads merely because their upload succeeded. General automatic video transcoding is not provided.

## Reuse and annotate {#reuse-and-annotate}
A task’s uploaded images can supply Kanban card previews. Resource links can also be shared in chat. When the CyAnnota integration is enabled and supports the selected media, open its annotation action and save the result back through the integration.

An external URL is not a stored project file. In particular, migration can preserve source attachment links without downloading their binary content.

See [plugins](doc:plugins), [chat](doc:chat) and [backup](doc:sync-backup).
