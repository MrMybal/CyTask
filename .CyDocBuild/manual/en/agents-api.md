---
id: agents-api
title: Agents, orchestration, API and MCP
order: 17
description: Create agent members and coordinate claims and durable work notifications.
section: Extensions
parent: plugins
revision: 2
---

CyTask can represent automated workers as agent members without interactive passwords. An orchestrator can structure tasks while a person inspects the same project in the normal application.

```diagram
{"type":"flow","title":"Orchestrator creates tasks → Durable call → Agent claims a task → Progress and acknowledgement","nodes":[{"id":"n0","label":"Orchestrator creates tasks","x":20,"y":10,"width":400},{"id":"n1","label":"Durable call","x":20,"y":130,"width":400},{"id":"n2","label":"Agent claims a task","x":20,"y":250,"width":400},{"id":"n3","label":"Progress and acknowledgement","x":20,"y":370,"width":400}],"edges":[{"from":"n0","to":"n1"},{"from":"n1","to":"n2"},{"from":"n2","to":"n3"}]}
```

## Create an agent {#create-an-agent}
From the agent administration tools, create a dedicated identity and grant only the required capabilities and project access. Store its issued token in the worker’s secret storage; a token may be displayed only once.

Use one identity per worker when you need separate ownership and history. Pause or disable identities that should no longer act. Do not distribute the owner’s session token to sub-agents.

## Coordinate work {#coordinate-work}
Create parent tasks and subtasks, assign workers and issue a durable call when attention is required. Workers inspect calls, claim available tasks through the atomic claim operation, report progress and acknowledge the call when handled.

A claim prevents two workers from assuming the same work simultaneously. Acknowledging a call is not the same as completing the task. The agent still needs an external runtime capable of carrying out the work; CyTask does not execute arbitrary task text.

## Connect an MCP client {#connect-an-mcp-client}
The repository includes the stdio bridge at `integrations/mcp/cytask-mcp.mjs`. Configure a compatible MCP host to run Node with that file and supply `CYTASK_URL` and `CYTASK_TOKEN` through its environment or secret mechanism.

Use a loopback or HTTPS URL appropriate to your deployment. Never put the real token in source control, task text or command-line examples. The bridge exposes the authorized project operations, not unrestricted filesystem access.

## Embed and develop {#embed-and-develop}
The integration SDK and API are the extension points for another app. Treat every response as scoped to the supplied identity. Handle authorization failures, revision conflicts and retryable network errors explicitly.

Use the [public API reference](doc:api-reference), [JavaScript SDK](doc:sdk-client) and [MCP connection guide](doc:mcp-integration) for signatures, credentials and short integration examples. See also [permissions](doc:permissions) and [AI Assistant](doc:ai-assistant).
