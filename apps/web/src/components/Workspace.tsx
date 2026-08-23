import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ApiError,
  api,
  type ActivityEntry,
  type Attachment,
  type ExternalReference,
  type OrganizationMember,
  type Project,
  type Session,
  type SearchHit,
  type TaskDependencyOverview,
  type TaskDetails,
  type WorkItem
} from "../api";
import { sha256 } from "../sha256";
import { CommandPalette, type PaletteAction } from "./CommandPalette";
import { ApiTokensPane } from "./ApiTokensPane";
import { ToastStack, useToasts } from "./Toasts";

interface WorkspaceProps {
  session: Session;
  onLogout: () => void;
}

const statusLabels: Record<WorkItem["status"], string> = {
  todo: "À faire",
  in_progress: "En cours",
  blocked: "Bloquée",
  done: "Terminée",
  cancelled: "Annulée"
};

const priorityLabels: Record<WorkItem["priority"], string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente"
};

const priorities: WorkItem["priority"][] = ["urgent", "high", "normal", "low"];

const boardStatuses: WorkItem["status"][] = ["todo", "in_progress", "blocked", "done", "cancelled"];
type TaskView = "list" | "board";
type TaskStatusFilter = "all" | WorkItem["status"];
type TaskPriorityFilter = "all" | WorkItem["priority"];
type TaskAssigneeFilter = "all" | "unassigned" | string;
type TaskDueFilter = "all" | "overdue" | "today" | "week" | "none";
type DetailTab = "overview" | "dependencies" | "files" | "git" | "activity";
type TaskSort = "updated" | "created" | "due" | "key" | "title";
type DetailBundle = [TaskDetails, Attachment[], ExternalReference[], TaskDependencyOverview];

export function Workspace({ session, onLogout }: WorkspaceProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [tasks, setTasks] = useState<WorkItem[]>([]);
  const [details, setDetails] = useState<TaskDetails>();
  const [dependencies, setDependencies] = useState<TaskDependencyOverview>({ dependsOn: [], blocking: [] });
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [externalReferences, setExternalReferences] = useState<ExternalReference[]>([]);
  const [searchHits, setSearchHits] = useState<SearchHit[]>();
  const [invitationLink, setInvitationLink] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copier le lien");
  const [isEditing, setIsEditing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ label: string; percent: number }>();
  const { toasts, notify, dismiss } = useToasts();
  const setError = useCallback((message: string) => {
    if (message) notify("error", message);
  }, [notify]);
  const [taskView, setTaskView] = useState<TaskView>(() =>
    window.localStorage.getItem("cytask.taskView") === "board" ? "board" : "list"
  );
  const [taskQuery, setTaskQuery] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilter>("all");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<TaskPriorityFilter>("all");
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState<TaskAssigneeFilter>("all");
  const [taskDueFilter, setTaskDueFilter] = useState<TaskDueFilter>("all");
  const [taskSort, setTaskSort] = useState<TaskSort>(() => {
    const saved = window.localStorage.getItem("cytask.taskSort");
    return saved === "created" || saved === "due" || saved === "key" || saved === "title"
      ? saved
      : "updated";
  });
  const [tasksLoading, setTasksLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [draggedTaskId, setDraggedTaskId] = useState<string>();
  const [dragOverStatus, setDragOverStatus] = useState<WorkItem["status"]>();
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set());
  const [taskLinkLabel, setTaskLinkLabel] = useState("Copier le lien");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.localStorage.getItem("cytask.sidebarCollapsed") === "true"
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  const taskRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const taskFilterInput = useRef<HTMLInputElement>(null);
  const detailPrefetch = useRef(new Map<string, { at: number; load: Promise<DetailBundle> }>());

  const canAdminister = session.role === "owner" || session.role === "admin";
  const canContribute = session.role !== "viewer";

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );
  const selectedTaskId = details?.task.id;
  const filteredTasks = useMemo(() => {
    const query = taskQuery.trim().toLocaleLowerCase("fr");
    const matching = tasks.filter((task) => {
      if (taskStatusFilter !== "all" && task.status !== taskStatusFilter) return false;
      if (taskPriorityFilter !== "all" && task.priority !== taskPriorityFilter) return false;
      if (taskAssigneeFilter === "unassigned" && task.assigneeId) return false;
      if (taskAssigneeFilter !== "all" && taskAssigneeFilter !== "unassigned"
        && task.assigneeId !== taskAssigneeFilter) return false;
      if (!matchesDueFilter(task, taskDueFilter)) return false;
      if (!query) return true;
      return `${task.key} ${task.title} ${task.description} ${task.assigneeName ?? ""}`
        .toLocaleLowerCase("fr")
        .includes(query);
    });
    return matching.sort((left, right) => {
      if (taskSort === "key") return left.key.localeCompare(right.key, "fr", { numeric: true });
      if (taskSort === "title") return left.title.localeCompare(right.title, "fr");
      if (taskSort === "created") return Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (taskSort === "due") {
        if (!left.dueAt) return right.dueAt ? 1 : 0;
        if (!right.dueAt) return -1;
        return Date.parse(left.dueAt) - Date.parse(right.dueAt);
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  }, [taskAssigneeFilter, taskDueFilter, taskPriorityFilter, taskQuery, taskSort, taskStatusFilter, tasks]);
  const taskCounts = useMemo(() => Object.fromEntries(
    boardStatuses.map((status) => [status, tasks.filter((task) => task.status === status).length])
  ) as Record<WorkItem["status"], number>, [tasks]);
  const dependencyCandidates = useMemo(() => tasks.filter((task) =>
    task.id !== selectedTaskId
    && dependencies.dependsOn.every((dependency) => dependency.id !== task.id)
  ), [dependencies.dependsOn, selectedTaskId, tasks]);

  const loadProjects = useCallback(async () => {
    const nextProjects = await api.projects();
    setProjects(nextProjects);
    setSelectedProjectId((current) => current ?? nextProjects[0]?.id);
  }, []);

  const loadTasks = useCallback(async (projectId: string) => {
    const request = ++taskRequestSequence.current;
    setTasksLoading(true);
    try {
      const nextTasks = await api.tasks(projectId);
      if (request === taskRequestSequence.current) setTasks(nextTasks);
    } finally {
      if (request === taskRequestSequence.current) setTasksLoading(false);
    }
  }, []);

  const fetchDetailBundle = useCallback((taskId: string): Promise<DetailBundle> => Promise.all([
    api.task(taskId),
    api.attachments(taskId),
    api.externalReferences(taskId),
    api.taskDependencies(taskId)
  ]), []);

  const prefetchDetails = useCallback((taskId: string) => {
    const cache = detailPrefetch.current;
    const cached = cache.get(taskId);
    if (cached && Date.now() - cached.at < 15000) return;
    const load = fetchDetailBundle(taskId);
    load.catch(() => cache.delete(taskId));
    cache.set(taskId, { at: Date.now(), load });
    if (cache.size > 20) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
  }, [fetchDetailBundle]);

  const loadDetails = useCallback(async (taskId: string) => {
    const request = ++detailRequestSequence.current;
    setDetailsLoading(true);
    try {
      const cached = detailPrefetch.current.get(taskId);
      const usable = cached && Date.now() - cached.at < 15000 ? cached.load : fetchDetailBundle(taskId);
      detailPrefetch.current.delete(taskId);
      const [nextDetails, nextAttachments, nextReferences, nextDependencies] = await usable;
      if (request !== detailRequestSequence.current) return;
      setDetails(nextDetails);
      setAttachments(nextAttachments);
      setExternalReferences(nextReferences);
      setDependencies(nextDependencies);
      setSelectedProjectId((current) => current === nextDetails.task.projectId
        ? current
        : nextDetails.task.projectId);
    } catch (reason) {
      if (request === detailRequestSequence.current) setError(messageFor(reason));
    } finally {
      if (request === detailRequestSequence.current) setDetailsLoading(false);
    }
  }, [fetchDetailBundle, setError]);

  const loadMembers = useCallback(async () => {
    setMembers(await api.members());
  }, []);

  const loadActivity = useCallback(async () => {
    setActivity(await api.activity());
  }, []);

  useEffect(() => {
    loadProjects().catch(() => setError("Impossible de charger les projets."));
  }, [loadProjects]);

  useEffect(() => {
    loadMembers().catch(() => setError("Impossible de charger les membres de l’équipe."));
  }, [loadMembers]);

  useEffect(() => {
    if (selectedProjectId) {
      setTasks([]);
      loadTasks(selectedProjectId).catch(() => setError("Impossible de charger les tâches."));
    } else {
      taskRequestSequence.current += 1;
      setTasks([]);
      setTasksLoading(false);
    }
    detailRequestSequence.current += 1;
    setDetails(undefined);
    setDependencies({ dependsOn: [], blocking: [] });
    setDetailsLoading(false);
    setShowTaskForm(false);
    setTaskQuery("");
    setTaskStatusFilter("all");
    setTaskPriorityFilter("all");
    setTaskAssigneeFilter("all");
    setTaskDueFilter("all");
  }, [loadTasks, selectedProjectId]);

  useEffect(() => {
    window.localStorage.setItem("cytask.taskView", taskView);
  }, [taskView]);

  useEffect(() => {
    window.localStorage.setItem("cytask.taskSort", taskSort);
  }, [taskSort]);

  useEffect(() => {
    window.localStorage.setItem("cytask.sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLocaleLowerCase("fr") === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      if (editing) return;

      if (event.key === "/") {
        event.preventDefault();
        taskFilterInput.current?.focus();
      } else if (event.key.toLocaleLowerCase("fr") === "n" && selectedProjectId && canContribute) {
        event.preventDefault();
        setShowTaskForm(true);
      } else if (event.key.toLocaleLowerCase("fr") === "b") {
        event.preventDefault();
        setSidebarCollapsed((value) => !value);
      } else if (event.key === "Escape") {
        if (paletteOpen) {
          setPaletteOpen(false);
        } else if (details) {
          closeTask();
        } else if (searchHits) {
          setSearchHits(undefined);
        } else {
          setShowTaskForm(false);
          setShowProjectForm(false);
        }
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [canContribute, details, paletteOpen, searchHits, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const taskId = taskIdFromHash(window.location.hash);
    if (!taskId) return;
    setDetailTab("overview");
    setDetails(undefined);
    void loadDetails(taskId);
  }, [loadDetails, selectedProjectId]);

  useEffect(() => {
    const restoreLocation = () => {
      const taskId = taskIdFromHash(window.location.hash);
      detailRequestSequence.current += 1;
      setDetailsLoading(false);
      setIsEditing(false);
      setTaskLinkLabel("Copier le lien");
      if (!taskId) {
        setDetails(undefined);
        return;
      }
      setDetailTab("overview");
      setDetails(undefined);
      void loadDetails(taskId);
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [loadDetails]);

  useEffect(() => {
    const stream = new EventSource("/api/v1/events");
    const refreshProjects = () => void loadProjects();
    const refreshTasks = () => {
      if (selectedProjectId) void loadTasks(selectedProjectId);
    };
    const refreshComment = () => {
      refreshTasks();
      if (selectedTaskId) void loadDetails(selectedTaskId);
    };
    stream.addEventListener("project.created", refreshProjects);
    stream.addEventListener("task.created", refreshTasks);
    stream.addEventListener("task.updated", refreshComment);
    stream.addEventListener("task.dependency_added", refreshComment);
    stream.addEventListener("task.dependency_removed", refreshComment);
    stream.addEventListener("comment.created", refreshComment);
    const refreshActivity = () => {
      if (showActivity) void loadActivity();
    };
    stream.addEventListener("project.created", refreshActivity);
    stream.addEventListener("task.created", refreshActivity);
    stream.addEventListener("task.updated", refreshActivity);
    stream.addEventListener("comment.created", refreshActivity);
    stream.addEventListener("invitation.created", refreshActivity);
    const refreshAttachments = () => {
      if (selectedTaskId) void loadDetails(selectedTaskId);
      refreshActivity();
    };
    stream.addEventListener("attachment.upload_started", refreshAttachments);
    stream.addEventListener("attachment.quarantined", refreshAttachments);
    stream.addEventListener("attachment.available", refreshAttachments);
    stream.addEventListener("attachment.rejected", refreshAttachments);
    stream.addEventListener("external_reference.created", refreshAttachments);
    stream.addEventListener("invitation.accepted", () => {
      void loadMembers();
      refreshActivity();
    });
    return () => stream.close();
  }, [
    loadActivity,
    loadDetails,
    loadMembers,
    loadProjects,
    loadTasks,
    selectedProjectId,
    selectedTaskId,
    showActivity
  ]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const project = await api.createProject({
        name: String(data.get("name")),
        key: String(data.get("key"))
      });
      form.reset();
      setShowProjectForm(false);
      await loadProjects();
      setSelectedProjectId(project.id);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId) return;
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const task = await api.createTask(selectedProjectId, {
        title: String(data.get("title")),
        description: String(data.get("description")),
        priority: String(data.get("priority")) as WorkItem["priority"],
        dueAt: localDateTimeToIso(String(data.get("dueAt"))),
        assigneeId: optionalId(data.get("assigneeId"))
      });
      form.reset();
      setShowTaskForm(false);
      notify("success", `${task.key} créée.`);
      await loadTasks(selectedProjectId);
      setDetailTab("overview");
      setDetails(undefined);
      await loadDetails(task.id);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function quickAddTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId) return;
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title")).trim();
    if (!title) return;
    form.reset();
    try {
      const task = await api.createTask(selectedProjectId, {
        title,
        description: "",
        priority: "normal",
        dueAt: null,
        assigneeId: null
      });
      setTasks((current) => current.some((item) => item.id === task.id)
        ? current
        : [task, ...current]);
      notify("success", `${task.key} créée.`);
    } catch (reason) {
      setError(messageFor(reason));
      if (selectedProjectId) await loadTasks(selectedProjectId).catch(() => undefined);
    }
  }

  async function createComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get("body"));
    if (!body.trim()) return;
    try {
      await api.addComment(details.task.id, body);
      form.reset();
      await loadDetails(details.task.id);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function createDependency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    const form = event.currentTarget;
    const dependsOnTaskId = optionalId(new FormData(form).get("dependsOnTaskId"));
    if (!dependsOnTaskId) return;
    setError("");
    try {
      await api.addTaskDependency(details.task.id, dependsOnTaskId);
      form.reset();
      await Promise.all([
        loadDetails(details.task.id),
        loadTasks(details.task.projectId)
      ]);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function removeDependency(taskId: string, dependsOnTaskId: string) {
    if (!details) return;
    setError("");
    try {
      await api.removeTaskDependency(taskId, dependsOnTaskId);
      await Promise.all([
        loadDetails(details.task.id),
        loadTasks(details.task.projectId)
      ]);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function updateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    try {
      const updated = await api.updateTask(details.task.id, {
        title: String(data.get("title")),
        description: String(data.get("description")),
        status: String(data.get("status")) as WorkItem["status"],
        priority: String(data.get("priority")) as WorkItem["priority"],
        dueAt: localDateTimeToIso(String(data.get("dueAt"))),
        assigneeId: optionalId(data.get("assigneeId")),
        expectedRevision: details.task.revision
      });
      setDetails((current) => current ? { ...current, task: updated } : current);
      setIsEditing(false);
      await loadTasks(updated.projectId);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        await loadDetails(details.task.id);
        setIsEditing(false);
        setError("Cette tâche a changé pendant votre édition. La dernière version a été rechargée.");
      } else {
        setError(messageFor(reason));
      }
    }
  }

  async function changeTaskStatus(task: WorkItem, status: WorkItem["status"]) {
    if (!canContribute || task.status === status || pendingTaskIds.has(task.id)) return;
    setError("");
    setPendingTaskIds((current) => new Set(current).add(task.id));
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status } : item));
    setDetails((current) => current?.task.id === task.id
      ? { ...current, task: { ...current.task, status } }
      : current);
    try {
      const updated = await api.updateTask(task.id, {
        title: task.title,
        description: task.description,
        status,
        priority: task.priority,
        dueAt: task.dueAt,
        assigneeId: task.assigneeId,
        expectedRevision: task.revision
      });
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetails((current) => current?.task.id === updated.id ? { ...current, task: updated } : current);
    } catch (reason) {
      if (selectedProjectId) await loadTasks(selectedProjectId).catch(() => undefined);
      if (selectedTaskId === task.id) await loadDetails(task.id);
      setError(reason instanceof ApiError && reason.status === 409
        ? "Cette tâche a été modifiée ailleurs. Son état actuel a été rechargé."
        : messageFor(reason));
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  function startTaskDrag(event: DragEvent<HTMLElement>, taskId: string) {
    if (!canContribute || pendingTaskIds.has(taskId)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", taskId);
    setDraggedTaskId(taskId);
  }

  function dropTask(event: DragEvent<HTMLElement>, status: WorkItem["status"]) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
    const task = tasks.find((item) => item.id === taskId);
    setDraggedTaskId(undefined);
    setDragOverStatus(undefined);
    if (task) void changeTaskStatus(task, status);
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    try {
      const invitation = await api.createInvitation({
        email: String(data.get("email")),
        role: String(data.get("role")) as "admin" | "member" | "viewer"
      });
      const link = `${window.location.origin}${window.location.pathname}#/invite/${invitation.token}`;
      setInvitationLink(link);
      setCopyLabel("Copier le lien");
      form.reset();
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function uploadAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details || uploadProgress) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    setError("");
    try {
      setUploadProgress({ label: "Calcul de l’empreinte…", percent: 0 });
      const fullSha256 = await sha256(file, (bytesRead) => {
        setUploadProgress({
          label: `Empreinte ${formatBytes(bytesRead)} / ${formatBytes(file.size)}`,
          percent: Math.round((bytesRead / file.size) * 100)
        });
      });
      const upload = await api.createAttachmentUpload(details.task.id, {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        sha256: fullSha256,
        optimizedLocally: data.get("optimizedLocally") === "on"
      });

      let index = 0;
      let sent = 0;
      while (sent < file.size) {
        const chunk = file.slice(sent, Math.min(sent + upload.chunkSizeBytes, file.size));
        const chunkSha256 = await sha256(chunk);
        await api.uploadAttachmentChunk(upload.id, index, chunk, chunkSha256);
        sent += chunk.size;
        index += 1;
        setUploadProgress({
          label: `Envoi ${formatBytes(sent)} / ${formatBytes(file.size)}`,
          percent: Math.round((sent / file.size) * 100)
        });
      }

      setUploadProgress({ label: "Vérification serveur…", percent: 100 });
      await api.completeAttachmentUpload(upload.id);
      notify("success", `${file.name} envoyé, analyse en cours.`);
      await loadDetails(details.task.id);
      form.reset();
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setUploadProgress(undefined);
    }
  }

  async function createExternalReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    try {
      await api.createExternalReference(details.task.id, {
        provider: String(data.get("provider")),
        repository: String(data.get("repository")),
        referenceType: String(data.get("referenceType")) as ExternalReference["referenceType"],
        referenceValue: String(data.get("referenceValue")),
        label: String(data.get("label")),
        webUrl: String(data.get("webUrl")) || undefined
      });
      form.reset();
      await loadDetails(details.task.id);
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function openTeam() {
    closeTask();
    setShowActivity(false);
    setShowTokens(false);
    setShowTeam(true);
    setError("");
    try {
      await loadMembers();
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function openActivity() {
    closeTask();
    setShowTeam(false);
    setShowTokens(false);
    setShowActivity(true);
    setError("");
    try {
      await loadActivity();
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = String(data.get("query")).trim();
    if (query.length < 2) return;
    setError("");
    try {
      setSearchHits(await api.search(query));
      setShowTeam(false);
      setShowActivity(false);
      closeTask();
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  function openSearchHit(hit: SearchHit) {
    if (hit.type === "project") {
      setSelectedProjectId(hit.id);
      setSearchHits(undefined);
      return;
    }

    setShowTeam(false);
    setShowActivity(false);
    openTask(hit.id);
  }

  function openTask(taskId: string) {
    setShowTeam(false);
    setShowActivity(false);
    setShowTokens(false);
    setIsEditing(false);
    setDetailTab("overview");
    setTaskLinkLabel("Copier le lien");
    setError("");
    if (selectedTaskId !== taskId) setDetails(undefined);
    const taskHash = `#/tasks/${taskId}`;
    if (window.location.hash !== taskHash) window.history.pushState(null, "", taskHash);
    void loadDetails(taskId);
  }

  function closeTask() {
    detailRequestSequence.current += 1;
    setDetailsLoading(false);
    setDetails(undefined);
    setIsEditing(false);
    setTaskLinkLabel("Copier le lien");
    if (taskIdFromHash(window.location.hash)) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }

  async function copyTaskLink() {
    if (!details) return;
    const taskHash = `#/tasks/${details.task.id}`;
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${taskHash}`;
    try {
      await navigator.clipboard.writeText(url);
      setTaskLinkLabel("Lien copié");
      notify("success", "Lien de la tâche copié.");
    } catch {
      setTaskLinkLabel("Copie impossible");
    }
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(invitationLink);
      setCopyLabel("Lien copié");
    } catch {
      setCopyLabel("Sélectionnez le lien");
    }
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  }

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [];
    if (selectedProjectId && canContribute) {
      actions.push({
        id: "new-task",
        label: "Nouvelle tâche",
        hint: "N",
        keywords: "créer ajouter task",
        run: () => setShowTaskForm(true)
      });
    }
    actions.push(
      {
        id: "toggle-view",
        label: taskView === "list" ? "Passer en vue Kanban" : "Passer en vue Liste",
        keywords: "kanban liste board vue",
        run: () => setTaskView((value) => value === "list" ? "board" : "list")
      },
      {
        id: "team",
        label: "Ouvrir l’équipe",
        keywords: "membres inviter equipe",
        run: () => void openTeam()
      },
      {
        id: "activity",
        label: "Ouvrir le journal d’activité",
        keywords: "historique audit",
        run: () => void openActivity()
      },
      {
        id: "tokens",
        label: "Gérer les jetons d’API",
        keywords: "api token plugin integration",
        run: () => {
          closeTask();
          setShowTeam(false);
          setShowActivity(false);
          setShowTokens(true);
        }
      },
      {
        id: "sidebar",
        label: sidebarCollapsed ? "Afficher la barre latérale" : "Masquer la barre latérale",
        hint: "B",
        keywords: "sidebar navigation",
        run: () => setSidebarCollapsed((value) => !value)
      }
    );
    if (canAdminister) {
      actions.push({
        id: "new-project",
        label: "Créer un projet",
        keywords: "projet nouveau",
        run: () => setShowProjectForm(true)
      });
    }
    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdminister, canContribute, selectedProjectId, sidebarCollapsed, taskView]);

  return (
    <div className={sidebarCollapsed ? "workspace-shell sidebar-collapsed" : "workspace-shell"}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <a className="brand compact" href="/" aria-label="CyTask, accueil">
            <span className="brand-mark">CY</span>
            <span>CyTask</span>
          </a>
          {canAdminister && (
            <button className="icon-button" title="Créer un projet" onClick={() => setShowProjectForm((value) => !value)}>+</button>
          )}
        </div>

        {showProjectForm && (
          <form className="inline-form" onSubmit={createProject}>
            <input name="name" placeholder="Nom du projet" maxLength={120} required autoFocus />
            <input name="key" placeholder="Clé · CY" minLength={2} maxLength={10} required />
            <button type="submit">Créer</button>
          </form>
        )}

        <nav className="project-list" aria-label="Projets">
          <p className="nav-label">Projets</p>
          {projects.map((project) => (
            <button
              className={project.id === selectedProjectId ? "project-link active" : "project-link"}
              key={project.id}
              title={project.name}
              onClick={() => {
                closeTask();
                setShowTeam(false);
                setShowActivity(false);
                setSelectedProjectId(project.id);
                setSearchHits(undefined);
              }}
            >
              <span className="project-avatar">{project.key.slice(0, 2)}</span>
              <span>{project.name}</span>
            </button>
          ))}
          {projects.length === 0 && <p className="empty-note">Créez votre premier projet.</p>}
        </nav>

        <button className="team-link" title="Équipe" onClick={() => void openTeam()}>
          <span className="project-avatar">EQ</span>
          <span>Équipe</span>
        </button>
        <button className="team-link activity-link" title="Activité" onClick={() => void openActivity()}>
          <span className="project-avatar">AC</span>
          <span>Activité</span>
        </button>
        <button className="team-link" title="API et jetons" onClick={() => {
          closeTask();
          setShowTeam(false);
          setShowActivity(false);
          setShowTokens(true);
        }}>
          <span className="project-avatar">AP</span>
          <span>API</span>
        </button>

        <div className="profile-block">
          <span className="profile-avatar">{initials(session.displayName)}</span>
          <span className="profile-copy">
            <strong>{session.displayName}</strong>
            <small>{session.role}</small>
          </span>
          <button className="text-button" onClick={logout}>Quitter</button>
        </div>
      </aside>

      <main className="task-pane">
        <header className="pane-header">
          <div>
            <p className="eyebrow">{selectedProject?.key ?? "ESPACE"}</p>
            <h1>{selectedProject?.name ?? "Bienvenue dans CyTask"}</h1>
            {selectedProject && (
              <p className="project-summary">
                {tasksLoading
                  ? "Synchronisation…"
                  : `${tasks.length} tâche${tasks.length > 1 ? "s" : ""} · ${taskCounts.in_progress} en cours`}
              </p>
            )}
          </div>
          <div className="pane-actions">
            <button
              className="icon-button sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? "Déployer la barre latérale" : "Replier la barre latérale"}
              aria-pressed={sidebarCollapsed}
              title={sidebarCollapsed ? "Afficher la navigation (B)" : "Agrandir l’espace de travail (B)"}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >{sidebarCollapsed ? "›" : "‹"}</button>
            <button
              className="palette-trigger"
              type="button"
              title="Palette de commandes (Ctrl+K)"
              onClick={() => setPaletteOpen(true)}
            >
              <span aria-hidden="true">⌘</span> Commandes <kbd>Ctrl K</kbd>
            </button>
            <form className="workspace-search" role="search" onSubmit={search}>
              <input name="query" aria-label="Rechercher" placeholder="Rechercher…" minLength={2} maxLength={100} required />
              <button type="submit" aria-label="Lancer la recherche">⌕</button>
            </form>
            {selectedProject && canContribute && (
              <button
                className="primary-button small"
                title="Nouvelle tâche (N)"
                onClick={() => setShowTaskForm((value) => !value)}
              >Nouvelle tâche <kbd>N</kbd></button>
            )}
          </div>
        </header>

        {showTaskForm && selectedProject && (
          <form className="task-form" onSubmit={createTask}>
            <input name="title" placeholder="Que faut-il accomplir ?" maxLength={240} required autoFocus />
            <textarea name="description" placeholder="Description optionnelle" maxLength={20000} rows={3} />
            <div className="task-planning-fields">
              <label>
                Priorité
                <select name="priority" defaultValue="normal">
                  {priorities.map((priority) => (
                    <option value={priority} key={priority}>{priorityLabels[priority]}</option>
                  ))}
                </select>
              </label>
              <label>
                Échéance
                <input name="dueAt" type="datetime-local" />
              </label>
              <label>
                Assignée à
                <select name="assigneeId" defaultValue="">
                  <option value="">Personne</option>
                  {members.map((member) => (
                    <option value={member.userId} key={member.userId}>{member.displayName}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <button className="primary-button small" type="submit">Créer la tâche</button>
              <button className="text-button" type="button" onClick={() => setShowTaskForm(false)}>Annuler</button>
            </div>
          </form>
        )}

        {searchHits ? (
          <section className="search-results" aria-label="Résultats de recherche">
            <div className="search-title">
              <h2>Résultats</h2>
              <button className="text-button" onClick={() => setSearchHits(undefined)}>Fermer la recherche</button>
            </div>
            {searchHits.map((hit) => (
              <button className="search-hit" key={`${hit.type}-${hit.id}`} onClick={() => openSearchHit(hit)}>
                <span className="project-avatar">{hit.type === "task" ? "TA" : "PR"}</span>
                <span className="search-hit-copy">
                  <strong>{hit.title}</strong>
                  <small>{hit.key} · {hit.excerpt || "Sans description"}</small>
                </span>
                <time dateTime={hit.updatedAt}>{relativeDate(hit.updatedAt)}</time>
              </button>
            ))}
            {searchHits.length === 0 && <p className="empty-list">Aucun résultat dans cet espace.</p>}
          </section>
        ) : !selectedProject ? (
          <section className="empty-state">
            <span className="empty-symbol">↗</span>
            <h2>Commencez par un projet</h2>
            <p>Un projet rassemble ses tâches, ses médias et bientôt ses références Git.</p>
            {canAdminister && (
              <button className="primary-button" onClick={() => setShowProjectForm(true)}>Créer un projet</button>
            )}
          </section>
        ) : (
          <>
            <section className="task-command" aria-label="Pilotage des tâches">
              <div className="task-metrics" aria-label="Résumé par état">
                <button
                  className={taskStatusFilter === "all"
                    && taskPriorityFilter === "all"
                    && taskAssigneeFilter === "all"
                    && taskDueFilter === "all"
                    && !taskQuery
                    ? "task-metric active"
                    : "task-metric"}
                  type="button"
                  aria-pressed={taskStatusFilter === "all"
                    && taskPriorityFilter === "all"
                    && taskAssigneeFilter === "all"
                    && taskDueFilter === "all"
                    && !taskQuery}
                  onClick={() => {
                    setTaskQuery("");
                    setTaskStatusFilter("all");
                    setTaskPriorityFilter("all");
                    setTaskAssigneeFilter("all");
                    setTaskDueFilter("all");
                  }}
                >
                  <strong>{tasks.length}</strong><span>Total</span>
                </button>
                <button
                  className={taskStatusFilter === "in_progress" ? "task-metric active" : "task-metric"}
                  type="button"
                  aria-pressed={taskStatusFilter === "in_progress"}
                  onClick={() => setTaskStatusFilter("in_progress")}
                >
                  <strong>{taskCounts.in_progress}</strong><span>En cours</span>
                </button>
                <button
                  className={taskStatusFilter === "blocked" ? "task-metric active warning" : "task-metric warning"}
                  type="button"
                  aria-pressed={taskStatusFilter === "blocked"}
                  onClick={() => setTaskStatusFilter("blocked")}
                >
                  <strong>{taskCounts.blocked}</strong><span>Bloquées</span>
                </button>
                <button
                  className={taskStatusFilter === "done" ? "task-metric active success" : "task-metric success"}
                  type="button"
                  aria-pressed={taskStatusFilter === "done"}
                  onClick={() => setTaskStatusFilter("done")}
                >
                  <strong>{taskCounts.done}</strong><span>Terminées</span>
                </button>
              </div>

              <div className="task-tools">
                <label className="task-filter-search">
                  <span className="sr-only">Filtrer les tâches</span>
                  <input
                    ref={taskFilterInput}
                    type="search"
                    value={taskQuery}
                    onChange={(event) => setTaskQuery(event.currentTarget.value)}
                    placeholder="Filtrer par titre, clé…"
                  />
                </label>
                <select
                  className="task-status-filter"
                  aria-label="Filtrer par état"
                  value={taskStatusFilter}
                  onChange={(event) => setTaskStatusFilter(event.currentTarget.value as TaskStatusFilter)}
                >
                  <option value="all">Tous les états</option>
                  {boardStatuses.map((status) => (
                    <option value={status} key={status}>{statusLabels[status]} · {taskCounts[status]}</option>
                  ))}
                </select>
                <select
                  className="task-priority-filter"
                  aria-label="Filtrer par priorité"
                  value={taskPriorityFilter}
                  onChange={(event) => setTaskPriorityFilter(event.currentTarget.value as TaskPriorityFilter)}
                >
                  <option value="all">Toutes priorités</option>
                  {priorities.map((priority) => (
                    <option value={priority} key={priority}>{priorityLabels[priority]}</option>
                  ))}
                </select>
                <select
                  className="task-assignee-filter"
                  aria-label="Filtrer par personne assignée"
                  value={taskAssigneeFilter}
                  onChange={(event) => setTaskAssigneeFilter(event.currentTarget.value)}
                >
                  <option value="all">Toutes les personnes</option>
                  <option value="unassigned">Non assignées</option>
                  {members.map((member) => (
                    <option value={member.userId} key={member.userId}>{member.displayName}</option>
                  ))}
                </select>
                <select
                  className="task-due-filter"
                  aria-label="Filtrer par échéance"
                  value={taskDueFilter}
                  onChange={(event) => setTaskDueFilter(event.currentTarget.value as TaskDueFilter)}
                >
                  <option value="all">Toutes échéances</option>
                  <option value="overdue">En retard</option>
                  <option value="today">Pour aujourd’hui</option>
                  <option value="week">Dans les 7 jours</option>
                  <option value="none">Sans échéance</option>
                </select>
                <select
                  className="task-sort"
                  aria-label="Trier les tâches"
                  value={taskSort}
                  onChange={(event) => setTaskSort(event.currentTarget.value as TaskSort)}
                >
                  <option value="updated">Dernière activité</option>
                  <option value="created">Création récente</option>
                  <option value="due">Échéance proche</option>
                  <option value="key">Clé de tâche</option>
                  <option value="title">Titre A–Z</option>
                </select>
                <div className="view-switch" role="group" aria-label="Présentation des tâches">
                  <button
                    className={taskView === "list" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "list"}
                    onClick={() => setTaskView("list")}
                  >Liste</button>
                  <button
                    className={taskView === "board" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "board"}
                    onClick={() => setTaskView("board")}
                  >Kanban</button>
                </div>
              </div>
            </section>

            {tasksLoading && <p className="task-loading" role="status">Actualisation des tâches…</p>}

            {tasksLoading && tasks.length === 0 ? (
              <div className="task-skeleton" aria-hidden="true">
                {Array.from({ length: taskView === "board" ? 4 : 6 }, (_, index) => (
                  <span key={index} />
                ))}
              </div>
            ) : !tasksLoading && tasks.length > 0 && filteredTasks.length === 0 ? (
              <section className="filter-empty" aria-live="polite">
                <span aria-hidden="true">⌕</span>
                <h2>Aucune tâche trouvée</h2>
                <p>Modifiez la recherche ou réinitialisez les filtres de ce projet.</p>
                <button className="text-button" type="button" onClick={() => {
                  setTaskQuery("");
                  setTaskStatusFilter("all");
                  setTaskPriorityFilter("all");
                  setTaskAssigneeFilter("all");
                  setTaskDueFilter("all");
                }}>Réinitialiser les filtres</button>
              </section>
            ) : taskView === "list" ? (
              <section className="task-list" aria-label="Tâches en liste">
                {canContribute && (
                  <form className="quick-add" onSubmit={quickAddTask}>
                    <input
                      name="title"
                      placeholder="Ajout rapide : titre puis Entrée"
                      aria-label="Ajouter rapidement une tâche"
                      maxLength={240}
                      autoComplete="off"
                    />
                  </form>
                )}
                <div className="list-header"><span>Tâche</span><span>État</span><span>Mise à jour</span></div>
                {filteredTasks.map((task) => (
                  <button
                    className={task.id === selectedTaskId ? "task-row active" : "task-row"}
                    key={task.id}
                    onMouseEnter={() => prefetchDetails(task.id)}
                    onFocus={() => prefetchDetails(task.id)}
                    onClick={() => openTask(task.id)}
                  >
                    <span className="task-main">
                      <strong>{task.title}</strong>
                      <small>
                        {task.key} · {task.assigneeName ?? "Non assignée"} · {task.dueAt ? `Échéance ${shortDate(task.dueAt)}` : "Sans échéance"}
                        {task.description ? ` · ${task.description}` : ""}
                      </small>
                    </span>
                    <span className="task-state-stack">
                      <span className={`status status-${task.status}`}>{statusLabels[task.status]}</span>
                      <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
                    </span>
                    <time dateTime={task.updatedAt}>{relativeDate(task.updatedAt)}</time>
                  </button>
                ))}
                {!tasksLoading && filteredTasks.length === 0 && (
                  <p className="empty-list">{tasks.length === 0
                    ? "Aucune tâche dans ce projet pour le moment."
                    : "Aucune tâche ne correspond à ces filtres."}</p>
                )}
              </section>
            ) : (
              <section className="task-board" aria-label="Tâches en tableau Kanban">
                {boardStatuses
                  .filter((status) => taskStatusFilter === "all" || taskStatusFilter === status)
                  .map((status) => {
                    const columnTasks = filteredTasks.filter((task) => task.status === status);
                    return (
                      <section
                        className={dragOverStatus === status
                          ? `board-column board-${status} drop-target`
                          : `board-column board-${status}`}
                        key={status}
                        aria-label={statusLabels[status]}
                        onDragOver={(event) => {
                          if (!canContribute || !draggedTaskId) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragOverStatus(status);
                        }}
                        onDragLeave={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                            setDragOverStatus(undefined);
                          }
                        }}
                        onDrop={(event) => dropTask(event, status)}
                      >
                        <header className="board-column-header">
                          <span className={`status-dot status-dot-${status}`} aria-hidden="true" />
                          <h2>{statusLabels[status]}</h2>
                          <span>{columnTasks.length}</span>
                        </header>
                        <div className="board-column-body">
                          {status === "todo" && canContribute && (
                            <form className="quick-add board-quick-add" onSubmit={quickAddTask}>
                              <input
                                name="title"
                                placeholder="Ajout rapide…"
                                aria-label="Ajouter rapidement une tâche à faire"
                                maxLength={240}
                                autoComplete="off"
                              />
                            </form>
                          )}
                          {columnTasks.map((task) => (
                            <article
                              className={[
                                "board-card",
                                task.id === selectedTaskId ? "active" : "",
                                pendingTaskIds.has(task.id) ? "pending" : ""
                              ].filter(Boolean).join(" ")}
                              key={task.id}
                              draggable={canContribute && !pendingTaskIds.has(task.id)}
                              onDragStart={(event) => startTaskDrag(event, task.id)}
                              onDragEnd={() => { setDraggedTaskId(undefined); setDragOverStatus(undefined); }}
                            >
                              <button
                                className="board-card-open"
                                type="button"
                                onMouseEnter={() => prefetchDetails(task.id)}
                                onFocus={() => prefetchDetails(task.id)}
                                onClick={() => openTask(task.id)}
                              >
                                <span className="board-card-meta">
                                  <span className="board-card-key">{task.key}</span>
                                  <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
                                </span>
                                <strong>{task.title}</strong>
                                <p>{task.description || "Sans description"}</p>
                              </button>
                              <footer className="board-card-footer">
                                <span className="board-card-dates">
                                  {task.assigneeName && (
                                    <span className="assignee-chip" title={`Assignée à ${task.assigneeName}`}>
                                      <span aria-hidden="true">{initials(task.assigneeName)}</span>
                                      {task.assigneeName}
                                    </span>
                                  )}
                                  {task.dueAt && (
                                    <time
                                      className={isTaskOverdue(task) ? "due-date overdue" : "due-date"}
                                      dateTime={task.dueAt}
                                      title={fullDate(task.dueAt)}
                                    >{shortDate(task.dueAt)}</time>
                                  )}
                                  <time dateTime={task.updatedAt}>{relativeDate(task.updatedAt)}</time>
                                </span>
                                {canContribute && (
                                  <select
                                    aria-label={`Déplacer ${task.key}`}
                                    value={task.status}
                                    disabled={pendingTaskIds.has(task.id)}
                                    onChange={(event) => void changeTaskStatus(
                                      task,
                                      event.currentTarget.value as WorkItem["status"]
                                    )}
                                  >
                                    {boardStatuses.map((nextStatus) => (
                                      <option value={nextStatus} key={nextStatus}>{statusLabels[nextStatus]}</option>
                                    ))}
                                  </select>
                                )}
                              </footer>
                            </article>
                          ))}
                          {!tasksLoading && columnTasks.length === 0 && <p className="board-empty">Aucune tâche</p>}
                        </div>
                      </section>
                    );
                  })}
              </section>
            )}
          </>
        )}
      </main>

      {showActivity && (
        <aside className="detail-pane activity-pane">
          <header className="detail-header">
            <span className="task-key">ACTIVITÉ</span>
            <button className="icon-button quiet" aria-label="Fermer" onClick={() => setShowActivity(false)}>×</button>
          </header>
          <div className="detail-content">
            <h2>Journal récent</h2>
            <p className="description muted">Les mutations importantes sont consignées durablement.</p>
            <section className="activity-list" aria-label="Journal d’activité">
              {activity.map((entry) => (
                <article className="activity-row" key={entry.id}>
                  <span className="activity-dot" aria-hidden="true" />
                  <div>
                    <p>{entry.summary}</p>
                    <small>{entry.actorName} · <time dateTime={entry.createdAt}>{relativeDate(entry.createdAt)}</time></small>
                  </div>
                </article>
              ))}
              {activity.length === 0 && <p className="empty-list">Aucune activité pour le moment.</p>}
            </section>
          </div>
        </aside>
      )}

      {showTeam && !showActivity && !showTokens && (
        <aside className="detail-pane team-pane">
          <header className="detail-header">
            <span className="task-key">ÉQUIPE</span>
            <button className="icon-button quiet" aria-label="Fermer" onClick={() => setShowTeam(false)}>×</button>
          </header>
          <div className="detail-content">
            <h2>Membres de l’espace</h2>
            <p className="description muted">Les permissions sont vérifiées par le serveur pour chaque action.</p>

            <section className="member-list" aria-label="Membres">
              {members.map((member) => (
                <article className="member-row" key={member.userId}>
                  <span className="profile-avatar">{initials(member.displayName)}</span>
                  <span className="member-copy">
                    <strong>{member.displayName}</strong>
                    <small>{member.email}</small>
                  </span>
                  <span className="role-badge">{roleLabel(member.role)}</span>
                </article>
              ))}
            </section>

            {canAdminister && (
              <section className="invite-section">
                <a className="export-link" href="/api/v1/export" download>
                  <span>Exporter l’espace</span>
                  <small>JSON versionné · données et membres</small>
                </a>
                <h3>Inviter une personne</h3>
                <form className="invite-form" onSubmit={createInvitation}>
                  <input name="email" type="email" placeholder="personne@studio.fr" maxLength={254} required />
                  <select name="role" defaultValue="member">
                    <option value="member">Membre</option>
                    <option value="viewer">Lecteur</option>
                    {session.role === "owner" && <option value="admin">Administrateur</option>}
                  </select>
                  <button className="primary-button small" type="submit">Créer l’invitation</button>
                </form>
                {invitationLink && (
                  <div className="invite-result" role="status">
                    <label>
                      Lien à transmettre — visible une seule fois
                      <input value={invitationLink} readOnly onFocus={(event) => event.currentTarget.select()} />
                    </label>
                    <button className="text-button" type="button" onClick={() => void copyInvitation()}>{copyLabel}</button>
                  </div>
                )}
              </section>
            )}
          </div>
        </aside>
      )}

      {showTokens && !showTeam && !showActivity && (
        <ApiTokensPane
          onClose={() => setShowTokens(false)}
          onError={setError}
          onNotice={(message) => notify("success", message)}
        />
      )}

      {!details && detailsLoading && !showTeam && !showActivity && !showTokens && (
        <aside className="detail-pane" aria-busy="true">
          <div className="detail-skeleton" aria-hidden="true">
            <span className="skeleton-line wide" />
            <span className="skeleton-line" />
            <span className="skeleton-block" />
            <span className="skeleton-line" />
            <span className="skeleton-line narrow" />
          </div>
        </aside>
      )}

      {details && !showTeam && !showActivity && !showTokens && (
        <aside className="detail-pane" aria-busy={detailsLoading}>
          <header className="detail-header">
            <span className="task-key">{details.task.key}</span>
            <div className="detail-actions">
              <button className="text-button" type="button" onClick={() => void copyTaskLink()}>
                {taskLinkLabel}
              </button>
              {canContribute && (
                <button className="text-button" onClick={() => {
                  setDetailTab("overview");
                  setIsEditing((value) => detailTab === "overview" ? !value : true);
                }}>
                  {isEditing ? "Annuler" : "Modifier"}
                </button>
              )}
              <button className="icon-button quiet" aria-label="Fermer" onClick={closeTask}>×</button>
            </div>
          </header>
          <div className="detail-content">
            <nav className="detail-tabs" role="tablist" aria-label="Sections de la tâche">
              <button
                className={detailTab === "overview" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "overview"}
                onClick={() => { setDetailTab("overview"); setIsEditing(false); }}
              >Détails</button>
              <button
                className={detailTab === "dependencies" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "dependencies"}
                onClick={() => { setDetailTab("dependencies"); setIsEditing(false); }}
              >Relations <span>{dependencies.dependsOn.length + dependencies.blocking.length}</span></button>
              <button
                className={detailTab === "files" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "files"}
                onClick={() => { setDetailTab("files"); setIsEditing(false); }}
              >Fichiers <span>{attachments.length}</span></button>
              <button
                className={detailTab === "git" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "git"}
                onClick={() => { setDetailTab("git"); setIsEditing(false); }}
              >Git <span>{externalReferences.length}</span></button>
              <button
                className={detailTab === "activity" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "activity"}
                onClick={() => { setDetailTab("activity"); setIsEditing(false); }}
              >Activité <span>{details.comments.length}</span></button>
            </nav>

            {detailsLoading && <p className="detail-loading" role="status">Synchronisation…</p>}

            {detailTab === "overview" && (isEditing ? (
              <form className="edit-task-form" key={`${details.task.id}-${details.task.revision}`} onSubmit={updateTask}>
                <label>
                  Titre
                  <input name="title" defaultValue={details.task.title} maxLength={240} required autoFocus />
                </label>
                <label>
                  État
                  <select name="status" defaultValue={details.task.status}>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priorité
                  <select name="priority" defaultValue={details.task.priority}>
                    {priorities.map((priority) => (
                      <option value={priority} key={priority}>{priorityLabels[priority]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Échéance
                  <input
                    name="dueAt"
                    type="datetime-local"
                    defaultValue={isoToLocalDateTime(details.task.dueAt)}
                  />
                </label>
                <label>
                  Assignée à
                  <select name="assigneeId" defaultValue={details.task.assigneeId ?? ""}>
                    <option value="">Personne</option>
                    {members.map((member) => (
                      <option value={member.userId} key={member.userId}>{member.displayName}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Description
                  <textarea name="description" defaultValue={details.task.description} maxLength={20000} rows={6} />
                </label>
                <button className="primary-button small" type="submit">Enregistrer</button>
              </form>
            ) : (
              <>
                <h2>{details.task.title}</h2>
                <div className="quick-status">
                  <span className="quick-status-badges">
                    <span className={`status status-${details.task.status}`}>{statusLabels[details.task.status]}</span>
                    <span className={`priority priority-${details.task.priority}`}>{priorityLabels[details.task.priority]}</span>
                  </span>
                  {canContribute && (
                    <label>
                      <span>Changer l’état</span>
                      <select
                        value={details.task.status}
                        disabled={pendingTaskIds.has(details.task.id)}
                        onChange={(event) => void changeTaskStatus(
                          details.task,
                          event.currentTarget.value as WorkItem["status"]
                        )}
                      >
                        {boardStatuses.map((status) => (
                          <option value={status} key={status}>{statusLabels[status]}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <p className={details.task.description ? "description" : "description muted"}>
                  {details.task.description || "Aucune description."}
                </p>
                <dl className="task-facts">
                  <div><dt>Créée</dt><dd title={fullDate(details.task.createdAt)}>{relativeDate(details.task.createdAt)}</dd></div>
                  <div><dt>Mise à jour</dt><dd title={fullDate(details.task.updatedAt)}>{relativeDate(details.task.updatedAt)}</dd></div>
                  <div>
                    <dt>Échéance</dt>
                    <dd className={isTaskOverdue(details.task) ? "overdue" : ""} title={details.task.dueAt ? fullDate(details.task.dueAt) : undefined}>
                      {details.task.dueAt ? shortDate(details.task.dueAt) : "Non définie"}
                    </dd>
                  </div>
                  <div><dt>Assignée à</dt><dd>{details.task.assigneeName ?? "Personne"}</dd></div>
                  <div><dt>Révision</dt><dd>#{details.task.revision}</dd></div>
                </dl>
              </>
            ))}

            {detailTab === "dependencies" && (
              <section className="task-dependencies detail-section">
                <div className="dependency-heading">
                  <h3>Dépend de <span>{dependencies.dependsOn.length}</span></h3>
                  <p>Ces tâches doivent avancer avant celle-ci.</p>
                </div>
                <div className="dependency-list">
                  {dependencies.dependsOn.map((dependency) => (
                    <article className="dependency-row" key={dependency.id}>
                      <button type="button" onClick={() => openTask(dependency.id)}>
                        <span className="relation-mark relation-in" aria-hidden="true">←</span>
                        <span>
                          <strong>{dependency.key} · {dependency.title}</strong>
                          <small>Liée {relativeDate(dependency.linkedAt)}</small>
                        </span>
                        <span className={`status status-${dependency.status}`}>{statusLabels[dependency.status]}</span>
                      </button>
                      {canContribute && (
                        <button
                          className="icon-button quiet dependency-remove"
                          type="button"
                          aria-label={`Retirer la dépendance vers ${dependency.key}`}
                          onClick={() => void removeDependency(details.task.id, dependency.id)}
                        >×</button>
                      )}
                    </article>
                  ))}
                  {dependencies.dependsOn.length === 0 && (
                    <p className="empty-note">Cette tâche ne dépend d’aucune autre.</p>
                  )}
                </div>

                {canContribute && (
                  <form className="dependency-form" onSubmit={createDependency}>
                    <select name="dependsOnTaskId" defaultValue="" required>
                      <option value="" disabled>Choisir une tâche de ce projet…</option>
                      {dependencyCandidates.map((candidate) => (
                        <option value={candidate.id} key={candidate.id}>
                          {candidate.key} · {candidate.title}
                        </option>
                      ))}
                    </select>
                    <button className="primary-button small" type="submit" disabled={dependencyCandidates.length === 0}>
                      Ajouter
                    </button>
                  </form>
                )}

                <div className="dependency-heading blocking-heading">
                  <h3>Bloque <span>{dependencies.blocking.length}</span></h3>
                  <p>Ces tâches attendent celle-ci.</p>
                </div>
                <div className="dependency-list">
                  {dependencies.blocking.map((relation) => (
                    <article className="dependency-row" key={relation.id}>
                      <button type="button" onClick={() => openTask(relation.id)}>
                        <span className="relation-mark relation-out" aria-hidden="true">→</span>
                        <span>
                          <strong>{relation.key} · {relation.title}</strong>
                          <small>Liée {relativeDate(relation.linkedAt)}</small>
                        </span>
                        <span className={`status status-${relation.status}`}>{statusLabels[relation.status]}</span>
                      </button>
                      {canContribute && (
                        <button
                          className="icon-button quiet dependency-remove"
                          type="button"
                          aria-label={`Ne plus bloquer ${relation.key}`}
                          onClick={() => void removeDependency(relation.id, details.task.id)}
                        >×</button>
                      )}
                    </article>
                  ))}
                  {dependencies.blocking.length === 0 && (
                    <p className="empty-note">Aucune tâche n’attend celle-ci.</p>
                  )}
                </div>
              </section>
            )}

            {detailTab === "git" && (
            <section className="external-references detail-section">
              <h3>Git <span>{externalReferences.length}</span></h3>
              {externalReferences.map((reference) => (
                <article className="reference-row" key={reference.id}>
                  <span className="reference-provider">{reference.provider.slice(0, 2).toUpperCase()}</span>
                  <span className="reference-copy">
                    {reference.webUrl ? (
                      <a href={reference.webUrl} target="_blank" rel="noopener noreferrer">{reference.label}</a>
                    ) : (
                      <strong>{reference.label}</strong>
                    )}
                    <small>{reference.repository} · {reference.referenceType} · {reference.referenceValue}</small>
                  </span>
                </article>
              ))}
              {externalReferences.length === 0 && <p className="empty-note">Aucun commit ou branche lié.</p>}
              {canContribute && (
                <details className="reference-form-shell">
                  <summary>Ajouter une référence Git</summary>
                  <form className="reference-form" onSubmit={createExternalReference}>
                    <div className="reference-grid">
                      <select name="provider" defaultValue="git">
                        <option value="git">Git</option>
                        <option value="github">GitHub</option>
                        <option value="gitlab">GitLab</option>
                        <option value="forgejo">Forgejo</option>
                      </select>
                      <select name="referenceType" defaultValue="commit">
                        <option value="commit">Commit</option>
                        <option value="branch">Branche</option>
                        <option value="tag">Tag</option>
                        <option value="merge_request">Merge request</option>
                      </select>
                    </div>
                    <input name="repository" placeholder="organisation/dépôt" maxLength={240} required />
                    <input name="referenceValue" placeholder="SHA, branche ou numéro" maxLength={240} required />
                    <input name="label" placeholder="Libellé visible" maxLength={240} required />
                    <input name="webUrl" type="url" placeholder="https://… (optionnel)" maxLength={2048} />
                    <button className="primary-button small" type="submit">Lier à la tâche</button>
                  </form>
                </details>
              )}
            </section>
            )}

            {detailTab === "files" && (
            <section className="attachments detail-section">
              <h3>Fichiers <span>{attachments.length}</span></h3>
              {attachments.map((attachment) => {
                const served = attachment.detectedContentType ?? attachment.declaredContentType;
                const isAvailable = attachment.status === "available";
                const contentUrl = api.attachmentContentUrl(attachment.id);
                const isVideo = isAvailable && served.startsWith("video/");
                return (
                  <article className={isVideo ? "attachment-row with-player" : "attachment-row"} key={attachment.id}>
                    <span className="attachment-line">
                      {isAvailable && served.startsWith("image/") ? (
                        <img className="attachment-thumb" src={contentUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="attachment-icon" aria-hidden="true">{served.startsWith("video/") ? "VI" : "FI"}</span>
                      )}
                      <span className="attachment-copy">
                        <strong>{attachment.fileName}</strong>
                        <small>
                          {formatBytes(attachment.sizeBytes)} · {attachmentStatusLabel(attachment.status)}
                          {attachment.width && attachment.height ? ` · ${attachment.width}×${attachment.height}` : ""}
                          {attachment.durationSeconds ? ` · ${formatDuration(attachment.durationSeconds)}` : ""}
                        </small>
                        {attachment.rejectionReason && (
                          <small className="attachment-reason">{attachment.rejectionReason}</small>
                        )}
                      </span>
                      {isAvailable ? (
                        <a className="attachment-download" href={contentUrl} download={attachment.fileName}>
                          Télécharger
                        </a>
                      ) : (
                        <span className={`attachment-state attachment-${attachment.status}`}>
                          {attachmentBadgeLabel(attachment.status)}
                        </span>
                      )}
                    </span>
                    {isVideo && (
                      <video
                        className="attachment-player"
                        src={contentUrl}
                        controls
                        preload="metadata"
                        playsInline
                      />
                    )}
                  </article>
                );
              })}
              {attachments.length === 0 && <p className="empty-note">Aucun fichier lié à cette tâche.</p>}
              {canContribute && (
                <form className="attachment-form" onSubmit={uploadAttachment}>
                  <label className="file-picker">
                    Ajouter une image, une vidéo ou un fichier
                    <input name="file" type="file" required disabled={Boolean(uploadProgress)} />
                  </label>
                  <label className="checkbox-line">
                    <input name="optimizedLocally" type="checkbox" />
                    Variante déjà optimisée localement
                  </label>
                  {uploadProgress && (
                    <div className="upload-progress" role="status">
                      <span>{uploadProgress.label}</span>
                      <progress max={100} value={uploadProgress.percent} />
                    </div>
                  )}
                  <button className="primary-button small" type="submit" disabled={Boolean(uploadProgress)}>
                    {uploadProgress ? "Envoi en cours…" : "Envoyer en quarantaine"}
                  </button>
                  <small className="security-note">L’original reste en quarantaine jusqu’à la validation de son format par le serveur.</small>
                </form>
              )}
            </section>
            )}

            {detailTab === "activity" && (
            <section className="comments detail-section">
              <h3>Activité <span>{details.comments.length}</span></h3>
              {canContribute ? (
                <form className="comment-form comment-form-top" onSubmit={createComment}>
                  <textarea
                    name="body"
                    placeholder="Ajouter un commentaire…"
                    maxLength={10000}
                    rows={3}
                    required
                    onKeyDown={submitOnModEnter}
                  />
                  <div className="comment-form-actions">
                    <small className="comment-shortcut">Ctrl/⌘ + Entrée pour envoyer</small>
                    <button className="primary-button small" type="submit">Commenter</button>
                  </div>
                </form>
              ) : (
                <p className="empty-note">Votre rôle permet la consultation uniquement.</p>
              )}
              {details.comments.map((comment) => (
                <article className="comment" key={comment.id}>
                  <span className="profile-avatar small-avatar">{initials(comment.authorName)}</span>
                  <div>
                    <p><strong>{comment.authorName}</strong> <time dateTime={comment.createdAt} title={fullDate(comment.createdAt)}>{relativeDate(comment.createdAt)}</time></p>
                    <p>{comment.body}</p>
                  </div>
                </article>
              ))}
            </section>
            )}
          </div>
        </aside>
      )}

      <CommandPalette
        open={paletteOpen}
        projects={projects}
        tasks={tasks}
        actions={paletteActions}
        onOpenTask={openTask}
        onOpenProject={(projectId) => {
          closeTask();
          setShowTeam(false);
          setShowActivity(false);
          setShowTokens(false);
          setSearchHits(undefined);
          setSelectedProjectId(projectId);
        }}
        onClose={() => setPaletteOpen(false)}
      />
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function taskIdFromHash(hash: string): string | undefined {
  return /^#\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(hash)?.[1];
}

function submitOnModEnter(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function relativeDate(value: string): string {
  const formatter = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const difference = new Date(value).getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function fullDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(value));
}

function isTaskOverdue(task: WorkItem): boolean {
  if (!task.dueAt) return false;
  return task.status !== "done"
    && task.status !== "cancelled"
    && Date.parse(task.dueAt) < Date.now();
}

function matchesDueFilter(task: WorkItem, filter: TaskDueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "none") return task.dueAt === null;
  if (!task.dueAt) return false;
  if (filter === "overdue") return isTaskOverdue(task);

  const dueAt = new Date(task.dueAt).getTime();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + (filter === "today" ? 1 : 8));
  return dueAt >= start.getTime() && dueAt < end.getTime();
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function optionalId(value: FormDataEntryValue | null): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return id || null;
}

function isoToLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function messageFor(reason: unknown): string {
  if (reason instanceof ApiError && reason.details && typeof reason.details === "object") {
    if ("errors" in reason.details && reason.details.errors && typeof reason.details.errors === "object") {
      const messages = Object.values(reason.details.errors)
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .filter((value): value is string => typeof value === "string");
      if (messages.length > 0) return messages.join(" ");
    }
    if ("title" in reason.details) return String(reason.details.title);
  }
  return reason instanceof ApiError ? reason.message : "Une erreur inattendue est survenue.";
}

function roleLabel(role: OrganizationMember["role"]): string {
  return { owner: "Propriétaire", admin: "Admin", member: "Membre", viewer: "Lecteur" }[role];
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes < 60) return `${minutes} min ${String(rest).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Kio`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mio`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} Gio`;
}

function attachmentBadgeLabel(status: Attachment["status"]): string {
  return {
    uploading: "Incomplet",
    quarantined: "Analyse",
    available: "Validé",
    rejected: "Refusé"
  }[status];
}

function attachmentStatusLabel(status: Attachment["status"]): string {
  return {
    uploading: "Envoi incomplet",
    quarantined: "En quarantaine, analyse en cours",
    available: "Validé",
    rejected: "Refusé à l’analyse"
  }[status];
}
