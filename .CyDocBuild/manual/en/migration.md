---
id: migration
title: Migrate from ClickUp or Jira
order: 16
description: Preview, map and import tasks from ClickUp or Jira Cloud.
section: Extensions
parent: plugins
revision: 2
---

The migration tool imports work from ClickUp or Jira Cloud into a CyTask project. It provides an analysis and mapping step before writing destination tasks.

## Prepare {#prepare}
Create or select a destination project and confirm you can edit it. Obtain the source URL or workspace identifiers and a source API credential with only the required read access.

Decide whether you want a test import into a temporary project first. Keep the source system available until the result has been reviewed.

## Analyze and map {#analyze-and-map}
1. Open Migration in the destination project.
2. Choose ClickUp or Jira Cloud and enter its connection details.
3. Analyze the source to obtain a preview.
4. Map statuses, priorities, people and other offered options.
5. Review counts and warnings, then explicitly start the import.

The preview is temporary; if it expires, analyze again rather than assuming an old mapping still matches the source.

## Verify the result {#verify-the-result}
Open several imported tasks, including subtasks, comments and unusual states. Check assignees, dates, labels and links. Import tracking supports avoiding duplicates for recognized source records; it is not a general bidirectional synchronization service.

Source credentials are used for the migration request rather than saved as a permanent source account. Imported attachment references can remain external links: the migration does not promise to download every source binary.

The tool does not update or delete tasks in the source system. Permissions and features with no matching CyTask representation need manual review.

See [tasks](doc:tasks), [files](doc:files-media) and [permissions](doc:permissions).
