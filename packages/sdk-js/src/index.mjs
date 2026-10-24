export class CyTaskApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "CyTaskApiError";
    this.status = status;
    this.details = details;
  }
}

export class CyTaskClient {
  constructor({ baseUrl, token, fetchImpl = globalThis.fetch } = {}) {
    if (typeof baseUrl !== "string" || baseUrl.length === 0) {
      throw new TypeError("baseUrl is required");
    }
    if (typeof token !== "string" || !token.startsWith("cytask_pat_")) {
      throw new TypeError("A CyTask API token is required");
    }
    if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError("baseUrl must use HTTP or HTTPS");
    }
    this.baseUrl = parsed.origin;
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(path, { method = "GET", body, signal } = {}) {
    const response = await this.fetch(new URL(`/api/v1${path}`, this.baseUrl), {
      method,
      signal,
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!response.ok) {
      const title = payload && typeof payload === "object" ? payload.title : null;
      throw new CyTaskApiError(title || `CyTask request failed (${response.status})`, response.status, payload);
    }
    return payload;
  }

  me(options) { return this.request("/me", options); }
  listProjects(options) { return this.request("/projects", options); }
  listTasks(projectId, options) { return this.request(`/projects/${encodeId(projectId)}/tasks`, options); }
  getTask(taskId, options) { return this.request(`/tasks/${encodeId(taskId)}`, options); }
  getTaskHierarchy(projectId, options) {
    return this.request(`/projects/${encodeId(projectId)}/task-hierarchy`, options);
  }
  setTaskParent(taskId, parentTaskId, options) {
    return this.request(`/tasks/${encodeId(taskId)}/parent/${encodeId(parentTaskId)}`, {
      ...options, method: "PUT"
    });
  }
  removeTaskParent(taskId, options) {
    return this.request(`/tasks/${encodeId(taskId)}/parent`, { ...options, method: "DELETE" });
  }
  async createTask(projectId, input, options) {
    const { parentTaskId, ...taskInput } = input ?? {};
    const task = await this.request(`/projects/${encodeId(projectId)}/tasks`, {
      ...options, method: "POST", body: taskInput
    });
    if (parentTaskId) await this.setTaskParent(task.id, parentTaskId, options);
    return task;
  }
  async updateTask(taskId, patch, options) {
    const details = await this.getTask(taskId, options);
    const task = details.task;
    return this.request(`/tasks/${encodeId(taskId)}`, {
      ...options,
      method: "PATCH",
      body: {
        title: patch.title ?? task.title,
        description: patch.description ?? task.description,
        status: patch.status ?? task.status,
        priority: patch.priority ?? task.priority,
        dueAt: Object.hasOwn(patch, "dueAt") ? patch.dueAt : task.dueAt,
        assigneeIds: Object.hasOwn(patch, "assigneeIds")
          ? patch.assigneeIds
          : (task.assignees ?? []).map((item) => item.userId),
        expectedRevision: patch.expectedRevision ?? task.revision
      }
    });
  }
  addComment(taskId, body, options) {
    return this.request(`/tasks/${encodeId(taskId)}/comments`, {
      ...options, method: "POST", body: { body }
    });
  }
  listAgents(options) { return this.request("/agents", options); }
  createAgent(input, options) {
    return this.request("/agents", { ...options, method: "POST", body: input });
  }
  callAgent(agentUserId, input, options) {
    return this.request(`/agents/${encodeId(agentUserId)}/notifications`, {
      ...options, method: "POST", body: input
    });
  }
  agentContext(options) { return this.request("/agent/context", options); }
  listAgentNotifications(includeAcknowledged = false, options) {
    return this.request(`/agent/notifications?includeAcknowledged=${includeAcknowledged}`, options);
  }
  acknowledgeNotification(notificationId, options) {
    return this.request(`/agent/notifications/${encodeId(notificationId)}/ack`, {
      ...options, method: "POST"
    });
  }
  claimTask(taskId, options) {
    return this.request(`/agent/tasks/${encodeId(taskId)}/claim`, {
      ...options, method: "POST"
    });
  }
}

function encodeId(value) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new TypeError("A valid UUID is required");
  }
  return encodeURIComponent(value);
}
