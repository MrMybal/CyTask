---
id: hierarchy
title: Subtasks and dependencies
section: Everyday work
order: 6
revision: 1
---

Hierarchy answers “what work is this part of?” A dependency answers “what must happen first?” Use both deliberately instead of encoding every relationship in a title.

```diagram
{"type":"dependency","title":"Milestone / parent task → Art subtask → Build subtask → Review depends on build","nodes":[{"id":"n0","label":"Milestone / parent task","x":185,"y":10,"width":320},{"id":"n1","label":"Art subtask","x":20,"y":120,"width":320},{"id":"n2","label":"Build subtask","x":370,"y":120,"width":320},{"id":"n3","label":"Review depends on build","x":370,"y":230,"width":320}],"edges":[{"from":"n0","to":"n1"},{"from":"n0","to":"n2"},{"from":"n2","to":"n3"}]}
```

A parent link groups work; a dependency describes order.

## Split a task {#split-a-task}
1. Open the parent task.
2. In Subtasks, create a child or attach an existing task using the parent selector.
3. Give each child its own assignees, status and acceptance criteria.
4. Keep the parent as a summary of the deliverable.

A checklist is usually enough for steps that do not need separate ownership or scheduling. A subtask is a real task and can be opened and linked independently.

## Set a dependency {#set-a-dependency}
In Relations, select a task that must progress first and add it to Depends on. The opposite side appears as Blocks on the prerequisite task. Remove the relation when the dependency no longer represents the work.

For example, “Review build” can depend on “Prepare build” without being its child. Parent links and dependency links are not interchangeable.

## Keep the graph usable {#keep-the-graph-usable}
Cycles and invalid cross-project relationships are rejected. If a relation cannot be created, check that it is in the same permitted project and would not create a loop.

Open the Graph view to inspect folders, parents, children and relation edges. Zoom and pan to inspect a group; open a task from its node to edit the underlying record.

Dependencies describe coordination. They are not an automation engine: adding an edge does not run a build, assign an agent or automatically complete other tasks.

For automated workers, see [agents and MCP](doc:agents-api).
