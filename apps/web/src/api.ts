export interface Session {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
  role: string;
  csrfToken: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  key: string;
  createdAt: string;
}

export interface ProjectStatus {
  organizationId: string;
  projectId: string;
  key: string;
  name: string;
  color: string;
  position: number;
  isSystem: boolean;
}

export interface TaskAssignee {
  userId: string;
  displayName: string;
}

export interface WorkItem {
  id: string;
  organizationId: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  description: string;
  status: string;
  priority: "low" | "normal" | "high" | "urgent";
  dueAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assignees: TaskAssignee[] | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskOption {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: WorkItem["status"];
}

export interface TaskPage {
  items: WorkItem[];
  totalCount: number;
  nextCursor: string | null;
}

export interface TaskPageFilters {
  query: string;
  status: string;
  priority: "all" | WorkItem["priority"];
  assignee: "all" | "unassigned" | string;
  due: "all" | "overdue" | "today" | "week" | "none";
  label: "all" | "none" | string;
  sort: "updated" | "created" | "due" | "key" | "title";
  limit?: number;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface TaskChecklistItem {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  position: number;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectLabel {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  color: string;
  createdBy: string;
  createdAt: string;
  parentLabelId: string | null;
}

export interface TaskLabelAssignment {
  taskId: string;
  labelId: string;
  assignedBy: string;
  assignedAt: string;
}

export interface ProjectLabelOverview {
  labels: ProjectLabel[];
  assignments: TaskLabelAssignment[];
}

export interface TaskParentAssignment {
  taskId: string;
  parentTaskId: string;
  linkedBy: string;
  linkedAt: string;
}

export interface ProjectTaskHierarchy {
  relations: TaskParentAssignment[];
}

export interface TaskDetails {
  task: WorkItem;
  comments: Comment[];
  checklist: TaskChecklistItem[];
}

export type PluginFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "asset-path"
  | "map-path"
  | "string-list";

export interface PluginFieldDefinition {
  key: string;
  label: string;
  type: PluginFieldType;
  required: boolean;
  description: string | null;
  placeholder: string | null;
  maxLength: number | null;
  options: string[] | null;
}

export interface PluginTaskTabDefinition {
  id: string;
  title: string;
  icon: string;
  fields: PluginFieldDefinition[];
}

export interface PluginManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  version: string;
  apiVersion: string;
  runtime: "sandbox" | "service-connector" | "ui-extension";
  permissions: string[];
  contributes: { taskTabs: PluginTaskTabDefinition[] };
  homepage: string | null;
}

export interface ProjectPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  enabledAt: string | null;
}

export interface TaskPlugin {
  manifest: PluginManifest;
  data: Record<string, unknown>;
  revision: number;
  updatedAt: string | null;
}

export interface TaskRelation {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: WorkItem["status"];
  linkedAt: string;
}

export interface TaskDependencyOverview {
  dependsOn: TaskRelation[];
  blocking: TaskRelation[];
}

export interface OrganizationMember {
  userId: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "member" | "viewer";
  joinedAt: string;
}

export interface InvitationPreview {
  organizationName: string;
  email: string;
  role: "admin" | "member" | "viewer";
  expiresAt: string;
}

export interface CreatedInvitation {
  id: string;
  email: string;
  role: "admin" | "member" | "viewer";
  token: string;
  expiresAt: string;
}

export interface ActivityEntry {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorId?: string;
  actorName: string;
  summary: string;
  createdAt: string;
}

export interface SearchHit {
  type: "project" | "task";
  id: string;
  key: string;
  title: string;
  excerpt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  declaredContentType: string;
  detectedContentType?: string;
  sizeBytes: number;
  sha256: string;
  status: "uploading" | "quarantined" | "available" | "rejected";
  optimizedLocally: boolean;
  createdAt: string;
  rejectionReason?: string;
  width?: number;
  height?: number;
  reviewedAt?: string;
  durationSeconds?: number;
}

export interface UploadChunk {
  index: number;
  sizeBytes: number;
  sha256: string;
}

export interface AttachmentUpload {
  id: string;
  attachment: Attachment;
  chunkSizeBytes: number;
  expiresAt: string;
  status: "active" | "completed" | "rejected" | "expired";
  chunks: UploadChunk[];
}

export interface ProjectResource {
  id: string;
  organizationId: string;
  projectId: string;
  folderLabelId: string | null;
  resourceType: "document" | "canvas" | "file";
  name: string;
  body: string;
  declaredContentType: string | null;
  detectedContentType: string | null;
  sizeBytes: number;
  sha256: string | null;
  status: "ready" | "uploading" | "available" | "rejected";
  rejectionReason: string | null;
  revision: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceUploadChunk {
  index: number;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ProjectResourceUpload {
  id: string;
  resource: ProjectResource;
  chunkSizeBytes: number;
  expiresAt: string;
  status: "active" | "completed" | "rejected" | "expired";
  chunks: ResourceUploadChunk[];
}

export interface ChatChannel {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  slug: string;
  topic: string;
  channelType: "channel" | "group";
  memberIds: string[];
  createdBy: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  organizationId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  resources: ProjectResource[];
  mentionedUserIds: string[];
}

export interface ExternalReference {
  id: string;
  taskId: string;
  provider: string;
  repository: string;
  referenceType: "commit" | "branch" | "tag" | "merge_request";
  referenceValue: string;
  label: string;
  webUrl?: string;
  createdAt: string;
}

export interface NativeAuthorizationRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
}

export interface ApiToken {
  id: string;
  name: string;
  scopes: "read" | "read write";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiToken {
  token: ApiToken;
  secret: string;
}

export interface NativeAuthorizationResponse {
  redirectUri: string;
  expiresAt: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message);
  }
}

function readCookie(name: string): string | undefined {
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : undefined;
}

function csrfToken(): string | undefined {
  return readCookie("CyTask.Csrf") ?? readCookie("__Host-CyTask.Csrf");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const method = init?.method?.toUpperCase() ?? "GET";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers.set("X-CSRF-Token", token);
  }

  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = undefined;
    }
    throw new ApiError(`La requête a échoué (${response.status}).`, response.status, details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  bootstrapStatus: () => request<{ required: boolean }>("/api/v1/bootstrap/status"),
  bootstrap: (body: {
    email: string;
    displayName: string;
    password: string;
    organizationName: string;
  }) => request<Session>("/api/v1/bootstrap", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request<Session>("/api/v1/sessions", { method: "POST", body: JSON.stringify(body) }),
  invitationPreview: (token: string) =>
    request<InvitationPreview>("/api/v1/invitations/preview", {
      method: "POST",
      body: JSON.stringify({ token })
    }),
  acceptInvitation: (body: { token: string; displayName: string; password: string }) =>
    request<Session>("/api/v1/invitations/accept", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  me: () => request<Session>("/api/v1/me"),
  logout: () => request<void>("/api/v1/session", { method: "DELETE" }),
  createNativeAuthorization: (body: NativeAuthorizationRequest) =>
    request<NativeAuthorizationResponse>("/api/v1/oauth/native/authorizations", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  activity: (limit = 50) => request<ActivityEntry[]>(`/api/v1/activity?limit=${limit}`),
  search: (query: string, limit = 30) =>
    request<SearchHit[]>(`/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  members: () => request<OrganizationMember[]>("/api/v1/members"),
  createInvitation: (body: { email: string; role: "admin" | "member" | "viewer" }) =>
    request<CreatedInvitation>("/api/v1/invitations", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  projects: () => request<Project[]>("/api/v1/projects"),
  createProject: (body: { name: string; key: string }) =>
    request<Project>("/api/v1/projects", { method: "POST", body: JSON.stringify(body) }),
  projectStatuses: (projectId: string) =>
    request<ProjectStatus[]>(`/api/v1/projects/${projectId}/statuses`),
  createProjectStatus: (projectId: string, body: { name: string; color: string }) =>
    request<ProjectStatus>(`/api/v1/projects/${projectId}/statuses`, {
      method: "POST", body: JSON.stringify(body)
    }),
  updateProjectStatus: (projectId: string, statusKey: string, body: { name: string; color: string }) =>
    request<ProjectStatus>(`/api/v1/projects/${projectId}/statuses/${statusKey}`, {
      method: "PATCH", body: JSON.stringify(body)
    }),
  plugins: () => request<PluginManifest[]>("/api/v1/plugins/catalog"),
  projectPlugins: (projectId: string) =>
    request<ProjectPlugin[]>(`/api/v1/projects/${projectId}/plugins`),
  enableProjectPlugin: (projectId: string, pluginId: string) =>
    request<ProjectPlugin>(`/api/v1/projects/${projectId}/plugins/${encodeURIComponent(pluginId)}`, {
      method: "PUT"
    }),
  disableProjectPlugin: (projectId: string, pluginId: string) =>
    request<void>(`/api/v1/projects/${projectId}/plugins/${encodeURIComponent(pluginId)}`, {
      method: "DELETE"
    }),
  projectLabels: (projectId: string) =>
    request<ProjectLabelOverview>(`/api/v1/projects/${projectId}/labels`),
  createProjectLabel: (projectId: string, body: { name: string; color: string; parentLabelId?: string | null }) =>
    request<ProjectLabel>(`/api/v1/projects/${projectId}/labels`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  deleteProjectLabel: (projectId: string, labelId: string) =>
    request<void>(`/api/v1/projects/${projectId}/labels/${labelId}`, {
      method: "DELETE"
    }),
  addTaskLabel: (taskId: string, labelId: string) =>
    request<TaskLabelAssignment>(`/api/v1/tasks/${taskId}/labels/${labelId}`, {
      method: "PUT"
    }),
  removeTaskLabel: (taskId: string, labelId: string) =>
    request<void>(`/api/v1/tasks/${taskId}/labels/${labelId}`, {
      method: "DELETE"
    }),
  projectTaskHierarchy: (projectId: string) =>
    request<ProjectTaskHierarchy>(`/api/v1/projects/${projectId}/task-hierarchy`),
  setTaskParent: (taskId: string, parentTaskId: string) =>
    request<TaskParentAssignment>(`/api/v1/tasks/${taskId}/parent/${parentTaskId}`, {
      method: "PUT"
    }),
  removeTaskParent: (taskId: string) =>
    request<void>(`/api/v1/tasks/${taskId}/parent`, {
      method: "DELETE"
    }),
  taskPage: (
    projectId: string,
    filters: TaskPageFilters,
    cursor?: string
  ) => {
    const parameters = new URLSearchParams({
      query: filters.query,
      status: filters.status,
      priority: filters.priority,
      assignee: filters.assignee,
      due: filters.due,
      label: filters.label,
      sort: filters.sort,
      limit: String(filters.limit ?? 50),
      utcOffsetMinutes: String(new Date().getTimezoneOffset())
    });
    if (cursor) parameters.set("cursor", cursor);
    return request<TaskPage>(`/api/v1/projects/${projectId}/task-page?${parameters}`);
  },
  taskOptions: (projectId: string) =>
    request<TaskOption[]>(`/api/v1/projects/${projectId}/task-options`),
  projectMediaPreviews: (projectId: string) =>
    request<Attachment[]>(`/api/v1/projects/${projectId}/media-previews`),

  projectResources: (projectId: string) =>
    request<ProjectResource[]>(`/api/v1/projects/${projectId}/resources`),
  projectResource: (resourceId: string) =>
    request<ProjectResource>(`/api/v1/resources/${resourceId}`),
  createProjectResource: (projectId: string, body: {
    resourceType: "document" | "canvas"; name: string; body: string; folderLabelId: string | null;
  }) => request<ProjectResource>(`/api/v1/projects/${projectId}/resources`, {
    method: "POST", body: JSON.stringify(body)
  }),
  updateProjectResource: (resourceId: string, body: {
    name: string; body: string; folderLabelId: string | null; expectedRevision: number;
  }) => request<ProjectResource>(`/api/v1/resources/${resourceId}`, {
    method: "PATCH", body: JSON.stringify(body)
  }),
  resourceContentUrl: (resourceId: string) => `/api/v1/resources/${resourceId}/content`,
  resourceUpload: (uploadId: string) =>
    request<ProjectResourceUpload>(`/api/v1/resource-uploads/${uploadId}`),
  createResourceUpload: (projectId: string, body: {
    fileName: string; contentType: string; sizeBytes: number; sha256: string;
    folderLabelId: string | null;
  }) => request<ProjectResourceUpload>(`/api/v1/projects/${projectId}/resource-uploads`, {
    method: "POST", body: JSON.stringify(body)
  }),
  uploadResourceChunk: (uploadId: string, index: number, chunk: Blob, sha256Value: string) =>
    request<ResourceUploadChunk>(`/api/v1/resource-uploads/${uploadId}/chunks/${index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "X-Chunk-SHA256": sha256Value },
      body: chunk
    }),
  completeResourceUpload: (uploadId: string) =>
    request<ProjectResource>(`/api/v1/resource-uploads/${uploadId}/complete`, { method: "POST" }),
  chatChannels: (projectId: string) =>
    request<ChatChannel[]>(`/api/v1/projects/${projectId}/chat/channels`),
  createChatChannel: (projectId: string, body: {
    name: string; topic: string; channelType: "channel" | "group"; memberIds: string[] }) =>
    request<ChatChannel>(`/api/v1/projects/${projectId}/chat/channels`, {
      method: "POST", body: JSON.stringify(body)
    }),
  chatMessages: (channelId: string, before?: string) =>
    request<ChatMessage[]>(`/api/v1/chat/channels/${channelId}/messages${
      before ? `?before=${encodeURIComponent(before)}` : ""
    }`),
  createChatMessage: (channelId: string, body: {
    body: string; resourceIds: string[]; mentionedUserIds: string[];
  }) => request<ChatMessage>(`/api/v1/chat/channels/${channelId}/messages`, {
    method: "POST", body: JSON.stringify(body)
  }),

  tasks: (projectId: string) => request<WorkItem[]>(`/api/v1/projects/${projectId}/tasks`),
  createTask: (projectId: string, body: {
    title: string;
    description: string;
    priority: WorkItem["priority"];
    dueAt: string | null;
    assigneeId: string | null;
    assigneeIds?: string[];
  }) =>
    request<WorkItem>(`/api/v1/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body)
    }),
  task: (taskId: string) => request<TaskDetails>(`/api/v1/tasks/${taskId}`),
  taskPlugins: (taskId: string) =>
    request<TaskPlugin[]>(`/api/v1/tasks/${taskId}/plugins`),
  updateTaskPluginData: (
    taskId: string,
    pluginId: string,
    body: { data: Record<string, unknown>; expectedRevision: number }
  ) => request<TaskPlugin>(`/api/v1/tasks/${taskId}/plugins/${encodeURIComponent(pluginId)}/data`, {
    method: "PUT", body: JSON.stringify(body)
  }),
  taskDependencies: (taskId: string) =>
    request<TaskDependencyOverview>(`/api/v1/tasks/${taskId}/dependencies`),
  addTaskDependency: (taskId: string, dependsOnTaskId: string) =>
    request<TaskRelation>(`/api/v1/tasks/${taskId}/dependencies`, {
      method: "POST",
      body: JSON.stringify({ dependsOnTaskId })
    }),
  removeTaskDependency: (taskId: string, dependsOnTaskId: string) =>
    request<void>(`/api/v1/tasks/${taskId}/dependencies/${dependsOnTaskId}`, {
      method: "DELETE"
    }),
  attachments: (taskId: string) => request<Attachment[]>(`/api/v1/tasks/${taskId}/attachments`),
  apiTokens: () => request<ApiToken[]>("/api/v1/tokens"),
  createApiToken: (body: { name: string; scope: "read" | "write"; expiresInDays?: number }) =>
    request<CreatedApiToken>("/api/v1/tokens", { method: "POST", body: JSON.stringify(body) }),
  revokeApiToken: (tokenId: string) =>
    request<void>(`/api/v1/tokens/${tokenId}`, { method: "DELETE" }),
  attachmentContentUrl: (attachmentId: string) => `/api/v1/attachments/${attachmentId}/content`,
  externalReferences: (taskId: string) =>
    request<ExternalReference[]>(`/api/v1/tasks/${taskId}/external-references`),
  createExternalReference: (taskId: string, body: {
    provider: string;
    repository: string;
    referenceType: ExternalReference["referenceType"];
    referenceValue: string;
    label: string;
    webUrl?: string;
  }) => request<ExternalReference>(`/api/v1/tasks/${taskId}/external-references`, {
    method: "POST",
    body: JSON.stringify(body)
  }),
  attachmentUploads: (taskId: string) =>
    request<AttachmentUpload[]>(`/api/v1/tasks/${taskId}/attachment-uploads`),
  attachmentUpload: (uploadId: string) =>
    request<AttachmentUpload>(`/api/v1/attachment-uploads/${uploadId}`),
  createAttachmentUpload: (taskId: string, body: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    optimizedLocally: boolean;
  }) => request<AttachmentUpload>(`/api/v1/tasks/${taskId}/attachment-uploads`, {
    method: "POST",
    body: JSON.stringify(body)
  }),
  uploadAttachmentChunk: (uploadId: string, index: number, chunk: Blob, sha256: string) =>
    request<UploadChunk>(`/api/v1/attachment-uploads/${uploadId}/chunks/${index}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Chunk-SHA256": sha256
      },
      body: chunk
    }),
  completeAttachmentUpload: (uploadId: string) =>
    request<Attachment>(`/api/v1/attachment-uploads/${uploadId}/complete`, { method: "POST" }),
  updateTask: (
    taskId: string,
    body: {
      title: string;
      description: string;
      status: string;
      priority: WorkItem["priority"];
      dueAt: string | null;
      assigneeId?: string | null;
      assigneeIds?: string[];
      expectedRevision: number;
    }
  ) => request<WorkItem>(`/api/v1/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  }),
  addComment: (taskId: string, body: string) =>
    request<Comment>(`/api/v1/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body })
    }),
  createChecklistItem: (taskId: string, title: string) =>
    request<TaskChecklistItem>(`/api/v1/tasks/${taskId}/checklist`, {
      method: "POST",
      body: JSON.stringify({ title })
    }),
  updateChecklistItem: (
    taskId: string,
    itemId: string,
    body: Pick<TaskChecklistItem, "title" | "isCompleted"> & { expectedRevision: number }
  ) => request<TaskChecklistItem>(`/api/v1/tasks/${taskId}/checklist/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  }),
  deleteChecklistItem: (taskId: string, itemId: string, expectedRevision: number) =>
    request<void>(
      `/api/v1/tasks/${taskId}/checklist/${itemId}?expectedRevision=${expectedRevision}`,
      { method: "DELETE" }
    )
};
