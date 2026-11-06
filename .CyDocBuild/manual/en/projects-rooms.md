---
id: projects-rooms
title: Projects, categories and rooms
order: 3
description: Organize projects, room categories and the pages used by your team.
section: Daily work
revision: 2
---

A project is the main collaboration boundary. It has members, resources, tasks and rooms. Categories organize the room list; task folders organize tasks inside the project. They serve different purposes.

```diagram
{"type":"architecture","title":"Project → Production category → Tasks → Documents / canvas / files → Team category → Chat / announcements → Voice / video","nodes":[{"id":"n0","label":"Project","x":185,"y":10,"width":320},{"id":"n1","label":"Production category","x":20,"y":110,"width":320},{"id":"n2","label":"Tasks","x":20,"y":220,"width":320},{"id":"n3","label":"Documents / canvas / files","x":20,"y":330,"width":320},{"id":"n4","label":"Team category","x":370,"y":110,"width":320},{"id":"n5","label":"Chat / announcements","x":370,"y":220,"width":320},{"id":"n6","label":"Voice / video","x":370,"y":330,"width":320}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"},{"from":"n1","to":"n3"},{"from":"n0","to":"n4"},{"from":"n4","to":"n5"},{"from":"n4","to":"n6"}]}
```

## Choose a room type {#choose-a-room-type}
| Room | What you do there |
| --- | --- |
| Tasks | Browse and edit tasks using list, compact or board views |
| Chat / announcements | Discuss, share links and publish team news |
| Voice / video | Join a live call |
| Document | Write a shared project page |
| Canvas | Arrange notes, drawings, shapes and media spatially |
| Files | Browse project resources and stored attachments |
| Graph | Explore task hierarchy and relationships |

## Organize the sidebar {#organize-the-sidebar}
Use the add controls next to rooms or categories to create the appropriate item. Pick the target project carefully. Collapse categories to reduce clutter and expand them again when needed.

Task folders can contain subfolders. Their disclosure control changes only the navigation display; it does not delete hidden content. A category is not a task parent, and moving between rooms does not change a task’s dependencies.

## Share and access {#share-and-access}
Copy the current room or task link to send teammates to the right place. Recipients must sign in to the same server and have permission for the project. A private chat can impose additional membership restrictions.

The layout resembles a server-and-room application, but permissions are project-based: it is not a complete implementation of Discord’s per-channel permission overwrite model.

See [task folders and views](doc:views-folders), [chat](doc:chat) and [permissions](doc:permissions).
