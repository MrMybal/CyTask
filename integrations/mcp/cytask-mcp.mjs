#!/usr/bin/env node
import { createInterface } from "node:readline";
import { CyTaskClient, CyTaskApiError } from "../../packages/sdk-js/src/index.mjs";

const SUPPORTED_PROTOCOLS = new Set(["2025-11-25", "2025-06-18"]);
const DEFAULT_PROTOCOL = "2025-11-25";
const serverInfo = { name: "cytask", title: "CyTask Orchestrator", version: "0.1.0" };

let client;
try {
  client = new CyTaskClient({ baseUrl: process.env.CYTASK_URL, token: process.env.CYTASK_TOKEN });
} catch (error) {
  process.stderr.write(`CyTask MCP configuration error: ${error.message}\n`);
  process.exitCode = 2;
}

const tools = [
  tool("cytask_agent_context", "Read agent identity, projects, assigned tasks and pending calls.", emptySchema(), true),
  tool("cytask_list_projects", "List projects visible to the current CyTask identity.", emptySchema(), true),
  tool("cytask_list_tasks", "List all tasks in a project.", objectSchema({ projectId: uuid("Project UUID") }, ["projectId"]), true),
  tool("cytask_get_task", "Read a task, comments and checklist.", objectSchema({ taskId: uuid("Task UUID") }, ["taskId"]), true),
  tool("cytask_create_task", "Create a task and optionally attach it under a parent task.", objectSchema({
    projectId: uuid("Project UUID"),
    title: { type: "string", minLength: 1, maxLength: 240 },
    description: { type: "string", maxLength: 20000 },
    priority: { type: "string", enum: ["normal", "high", "urgent"] },
    dueAt: { type: ["string", "null"], format: "date-time" },
    assigneeIds: { type: "array", items: uuid("Member UUID"), uniqueItems: true },
    parentTaskId: { ...uuid("Optional parent task UUID"), type: ["string", "null"] }
  }, ["projectId", "title"])),
  tool("cytask_update_task", "Update task fields using the latest revision automatically.", objectSchema({
    taskId: uuid("Task UUID"),
    title: { type: "string", minLength: 1, maxLength: 240 },
    description: { type: "string", maxLength: 20000 },
    status: { type: "string", minLength: 1, maxLength: 40 },
    priority: { type: "string", enum: ["normal", "high", "urgent"] },
    dueAt: { type: ["string", "null"], format: "date-time" },
    assigneeIds: { type: "array", items: uuid("Member UUID"), uniqueItems: true },
    expectedRevision: { type: "integer", minimum: 1 }
  }, ["taskId"])),
  tool("cytask_split_task", "Create multiple child tasks beneath one parent task.", objectSchema({
    parentTaskId: uuid("Parent task UUID"),
    children: {
      type: "array", minItems: 1, maxItems: 25,
      items: objectSchema({
        title: { type: "string", minLength: 1, maxLength: 240 },
        description: { type: "string", maxLength: 20000 },
        priority: { type: "string", enum: ["normal", "high", "urgent"] },
        assigneeIds: { type: "array", items: uuid("Member UUID"), uniqueItems: true }
      }, ["title"])
    }
  }, ["parentTaskId", "children"])),
  tool("cytask_add_comment", "Add a progress note or execution result to a task.", objectSchema({
    taskId: uuid("Task UUID"), body: { type: "string", minLength: 1, maxLength: 10000 }
  }, ["taskId", "body"])),
  tool("cytask_claim_task", "Atomically claim an unassigned task for the current agent.", objectSchema({ taskId: uuid("Task UUID") }, ["taskId"])),
  tool("cytask_list_agents", "List the agent members available to the orchestrator.", emptySchema(), true),
  tool("cytask_create_agent", "Create a passwordless agent member and return its API token once.", objectSchema({
    key: { type: "string", pattern: "^[a-z][a-z0-9-]{1,39}$" },
    displayName: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", maxLength: 2000 },
    capabilities: { type: "array", maxItems: 32, uniqueItems: true, items: { type: "string", pattern: "^[a-z][a-z0-9:._-]{0,63}$" } }
  }, ["key", "displayName"])),
  tool("cytask_call_agent", "Send a durable work call to an agent, optionally linked to a task.", objectSchema({
    agentUserId: uuid("Agent user UUID"),
    type: { type: "string", pattern: "^[a-z][a-z0-9_.-]{0,39}$" },
    title: { type: "string", minLength: 1, maxLength: 160 },
    body: { type: "string", maxLength: 10000 },
    taskId: { ...uuid("Related task UUID"), type: ["string", "null"] }
  }, ["agentUserId", "title"])),
  tool("cytask_list_notifications", "List calls sent to the current agent.", objectSchema({
    includeAcknowledged: { type: "boolean", default: false }
  }), true),
  tool("cytask_ack_notification", "Acknowledge a call after it has been handled.", objectSchema({
    notificationId: uuid("Notification UUID")
  }, ["notificationId"]))
];

const handlers = {
  cytask_agent_context: () => client.agentContext(),
  cytask_list_projects: () => client.listProjects(),
  cytask_list_tasks: ({ projectId }) => client.listTasks(projectId),
  cytask_get_task: ({ taskId }) => client.getTask(taskId),
  cytask_create_task: ({ projectId, ...input }) => client.createTask(projectId, input),
  cytask_update_task: ({ taskId, ...patch }) => client.updateTask(taskId, patch),
  cytask_split_task: splitTask,
  cytask_add_comment: ({ taskId, body }) => client.addComment(taskId, body),
  cytask_claim_task: ({ taskId }) => client.claimTask(taskId),
  cytask_list_agents: () => client.listAgents(),
  cytask_create_agent: (input) => client.createAgent(input),
  cytask_call_agent: ({ agentUserId, ...input }) => client.callAgent(agentUserId, input),
  cytask_list_notifications: ({ includeAcknowledged = false } = {}) => client.listAgentNotifications(includeAcknowledged),
  cytask_ack_notification: ({ notificationId }) => client.acknowledgeNotification(notificationId)
};

async function splitTask({ parentTaskId, children }) {
  const parent = (await client.getTask(parentTaskId)).task;
  const created = [];
  for (const child of children) {
    created.push(await client.createTask(parent.projectId, { ...child, parentTaskId }));
  }
  return { parentTaskId, children: created };
}

function tool(name, description, inputSchema, readOnly = false) {
  return {
    name,
    title: description.split(".")[0],
    description,
    inputSchema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false
    }
  };
}
function emptySchema() { return { type: "object", additionalProperties: false }; }
function objectSchema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
function uuid(description) { return { type: "string", format: "uuid", description }; }

async function dispatch(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (message?.id !== undefined) respond(message.id, null, error(-32600, "Invalid Request"));
    return;
  }
  if (message.id === undefined) return;
  try {
    if (!client) throw new Error("CyTask MCP is not configured");
    if (message.method === "initialize") {
      const requested = message.params?.protocolVersion;
      respond(message.id, {
        protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo
      });
      return;
    }
    if (message.method === "ping") { respond(message.id, {}); return; }
    if (message.method === "tools/list") { respond(message.id, { tools }); return; }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const handler = handlers[name];
      if (!handler) { respond(message.id, null, error(-32602, `Unknown tool: ${name}`)); return; }
      try {
        const value = await handler(message.params?.arguments ?? {});
        respond(message.id, toolResult(value));
      } catch (toolError) {
        respond(message.id, toolResult({
          error: toolError.message,
          status: toolError instanceof CyTaskApiError ? toolError.status : undefined,
          details: toolError instanceof CyTaskApiError ? toolError.details : undefined
        }, true));
      }
      return;
    }
    respond(message.id, null, error(-32601, "Method not found"));
  } catch (requestError) {
    respond(message.id, null, error(-32603, requestError.message));
  }
}

function toolResult(value, isError = false) {
  const structuredContent = value && typeof value === "object" ? value : { value };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError
  };
}
function error(code, message) { return { code, message }; }
function respond(id, result, rpcError) {
  process.stdout.write(`${JSON.stringify(rpcError
    ? { jsonrpc: "2.0", id, error: rpcError }
    : { jsonrpc: "2.0", id, result })}\n`);
}

if (client) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch { respond(null, null, error(-32700, "Parse error")); return; }
    void dispatch(message);
  });
}
