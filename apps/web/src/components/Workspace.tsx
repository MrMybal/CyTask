import {
  type CSSProperties,
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
  type AttachmentUpload,
  type ExternalReference,
  type OrganizationMember,
  type Project,
  type ProjectStatus,
  type ProjectLabel,
  type ProjectLabelOverview,
  type ProjectTaskHierarchy,
  type Session,
  type SearchHit,
  type TaskDependencyOverview,
  type TaskDetails,
  type TaskChecklistItem,
  type TaskOption,
  type TaskPlugin,
  type WorkItem
} from "../api";
import { sha256 } from "../sha256";
import { CommandPalette, type PaletteAction } from "./CommandPalette";
import { ApiTokensPane } from "./ApiTokensPane";
import { ToastStack, useToasts } from "./Toasts";
import { TaskLabelChips, TaskLabelsSection } from "./TaskLabels";
import { TaskHierarchyMeta, TaskHierarchySection } from "./TaskHierarchy";
import { TaskAssigneePicker } from "./TaskAssigneePicker";
import { ProjectFolderTree } from "./ProjectFolderTree";
import { ProjectCanvas } from "./ProjectCanvas";
import { CompactTaskTable, TaskCanvas } from "./TaskVisualViews";
import { ProjectContentPane } from "./ProjectContentPane";
import { TeamChatPane } from "./TeamChatPane";
import { PluginManagerPane } from "./PluginManagerPane";
import { TaskPluginPanel } from "./TaskPluginPanel";
import {
  parseSavedTaskViews,
  savedTaskViewsStorageKey,
  TaskSavedViews,
  taskFilterSnapshotsEqual,
  type SavedTaskView,
  type TaskFilterSnapshot,
  type TaskViewDefinition
} from "./TaskSavedViews";

interface WorkspaceProps {
  session: Session;
  onLogout: () => void;
}

const defaultProjectStatuses: ProjectStatus[] = [
  { organizationId: "", projectId: "", key: "todo", name: "À faire", color: "#7C8B9A", position: 0, isSystem: true },
  { organizationId: "", projectId: "", key: "in_progress", name: "En cours", color: "#F2A93B", position: 1, isSystem: true },
  { organizationId: "", projectId: "", key: "blocked", name: "Bloquée", color: "#FF5C6C", position: 2, isSystem: true },
  { organizationId: "", projectId: "", key: "done", name: "Terminée", color: "#61E6B5", position: 3, isSystem: true },
  { organizationId: "", projectId: "", key: "cancelled", name: "Annulée", color: "#7B8491", position: 4, isSystem: true }
];

const priorityLabels: Record<WorkItem["priority"], string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente"
};

const priorities: WorkItem["priority"][] = ["urgent", "high", "normal", "low"];

const gitPluginId = "dev.cytask.git";

type TaskView = TaskFilterSnapshot["view"];
type TaskStatusFilter = TaskFilterSnapshot["status"];
type TaskPriorityFilter = TaskFilterSnapshot["priority"];
type TaskAssigneeFilter = TaskFilterSnapshot["assignee"];
type TaskDueFilter = TaskFilterSnapshot["due"];
type TaskLabelFilter = TaskFilterSnapshot["label"];
type DetailTab =
  | "overview"
  | "dependencies"
  | "files"
  | "git"
  | "activity"
  | `plugin:${string}:${string}`;
type TaskSort = TaskFilterSnapshot["sort"];
type SidebarSection = "project" | "inbox" | "mine" | "today" | "later" | "completed";
type WorkspaceArea = "tasks" | "contents" | "chat" | "plugins";
type DetailBundle = [
  TaskDetails,
  Attachment[],
  AttachmentUpload[],
  ExternalReference[],
  TaskDependencyOverview,
  TaskPlugin[]
];

export function Workspace({ session, onLogout }: WorkspaceProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [tasks, setTasks] = useState<WorkItem[]>([]);
  const [taskOptions, setTaskOptions] = useState<TaskOption[]>([]);
  const [taskTotalCount, setTaskTotalCount] = useState(0);
  const [taskNextCursor, setTaskNextCursor] = useState<string | null>(null);
  const [projectLabels, setProjectLabels] = useState<ProjectLabelOverview>({ labels: [], assignments: [] });
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>(defaultProjectStatuses);
  const [taskHierarchy, setTaskHierarchy] = useState<ProjectTaskHierarchy>({ relations: [] });
  const [details, setDetails] = useState<TaskDetails>();
  const [dependencies, setDependencies] = useState<TaskDependencyOverview>({ dependsOn: [], blocking: [] });
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showStatusEditor, setShowStatusEditor] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [taskMediaPreviews, setTaskMediaPreviews] = useState<Attachment[]>([]);
  const [activeUploads, setActiveUploads] = useState<AttachmentUpload[]>([]);
  const [externalReferences, setExternalReferences] = useState<ExternalReference[]>([]);
  const [taskPlugins, setTaskPlugins] = useState<TaskPlugin[]>([]);
  const [pluginConfigurationRevision, setPluginConfigurationRevision] = useState(0);
  const [searchHits, setSearchHits] = useState<SearchHit[]>();
  const [invitationLink, setInvitationLink] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copier le lien");
  const [isEditing, setIsEditing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ label: string; percent: number }>();
  const { toasts, notify, dismiss } = useToasts();
  const setError = useCallback((message: string) => {
    if (message) notify("error", message);
  }, [notify]);
  const [taskView, setTaskView] = useState<TaskView>(() => {
    const saved = window.localStorage.getItem("cytask.taskView");
    if (saved === "miro") return "canvas";
    return saved === "board" || saved === "compact" || saved === "canvas" || saved === "graph"
      ? saved
      : "list";
  });
  const [taskQuery, setTaskQuery] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatusFilter>("all");
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<TaskPriorityFilter>("all");
  const [taskAssigneeFilter, setTaskAssigneeFilter] = useState<TaskAssigneeFilter>("all");
  const [taskDueFilter, setTaskDueFilter] = useState<TaskDueFilter>("all");
  const [taskLabelFilter, setTaskLabelFilter] = useState<TaskLabelFilter>("all");
  const [taskSort, setTaskSort] = useState<TaskSort>(() => {
    const saved = window.localStorage.getItem("cytask.taskSort");
    return saved === "created" || saved === "due" || saved === "key" || saved === "title"
      ? saved
      : "updated";
  });
  const [savedTaskViews, setSavedTaskViews] = useState<SavedTaskView[]>([]);
  const [activeTaskViewId, setActiveTaskViewId] = useState<string>();
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksLoadingMore, setTasksLoadingMore] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [draggedTaskId, setDraggedTaskId] = useState<string>();
  const [dragOverStatus, setDragOverStatus] = useState<WorkItem["status"]>();
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set());
  const [pendingChecklistItemIds, setPendingChecklistItemIds] =
    useState<Set<string>>(() => new Set());
  const [pendingLabelIds, setPendingLabelIds] = useState<Set<string>>(() => new Set());
  const [pendingStatusKeys, setPendingStatusKeys] = useState<Set<string>>(() => new Set());
  const [hierarchyPending, setHierarchyPending] = useState(false);
  const [checklistCreating, setChecklistCreating] = useState(false);
  const [taskLinkLabel, setTaskLinkLabel] = useState("Copier le lien");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.localStorage.getItem("cytask.sidebarCollapsed") === "true"
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workspaceArea, setWorkspaceArea] = useState<WorkspaceArea>("tasks");
  const [showTokens, setShowTokens] = useState(false);
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("project");
  const [themeMode, setThemeMode] = useState<"dark" | "light">(() =>
    window.localStorage.getItem("cytask.theme") === "light" ? "light" : "dark"
  );
  const [folderEditorParentId, setFolderEditorParentId] =
    useState<string | null | undefined>();
  const taskRequestSequence = useRef(0);
  const taskSupportRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const taskFilterInput = useRef<HTMLInputElement>(null);
  const detailPrefetch = useRef(new Map<string, { at: number; load: Promise<DetailBundle> }>());

  const canAdminister = session.role === "owner" || session.role === "admin";
  const canContribute = session.role !== "viewer";

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );
  const statusLabels = useMemo(() => Object.fromEntries(
    projectStatuses.map((status) => [status.key, status.name])
  ) as Record<string, string>, [projectStatuses]);
  const boardStatuses = useMemo(() => projectStatuses.map((status) => status.key), [projectStatuses]);
  const statusColors = useMemo(() => Object.fromEntries(
    projectStatuses.map((status) => [status.key, status.color])
  ) as Record<string, string>, [projectStatuses]);
  function taskStatusStyle(status: string): CSSProperties {
    const color = statusColors[status] ?? "#7C8B9A";
    return { color, borderColor: color, "--status-color": color } as CSSProperties;
  }

  const labelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const labelsById = new Map(projectLabels.labels.map((label) => [label.id, label]));
    for (const assignment of projectLabels.assignments) {
      let label = labelsById.get(assignment.labelId);
      const visited = new Set<string>();
      while (label && !visited.has(label.id)) {
        visited.add(label.id);
        counts.set(label.id, (counts.get(label.id) ?? 0) + 1);
        label = label.parentLabelId ? labelsById.get(label.parentLabelId) : undefined;
      }
    }
    return counts;
  }, [projectLabels.assignments, projectLabels.labels]);
  const selectedFolder = taskLabelFilter === "all" || taskLabelFilter === "none"
    ? undefined
    : projectLabels.labels.find((label) => label.id === taskLabelFilter);
  const workspaceAreaTitle = workspaceArea === "contents"
    ? (selectedFolder ? "Contenus · " + selectedFolder.name : "Contenus de l’espace")
    : workspaceArea === "chat"
      ? "Discussion d’équipe"
      : workspaceArea === "plugins" ? "Plugins du projet" : undefined;
  const workspaceTitle = selectedFolder?.name ?? (sidebarSection === "project"
    ? selectedProject?.name
    : {
        inbox: "Boîte de réception",
        mine: "Mes tâches",
        today: "Aujourd’hui",
        later: "Plus tard",
        completed: "Terminées"
      }[sidebarSection]);
  const taskViewsStorageKey = selectedProjectId
    ? savedTaskViewsStorageKey(session.organizationId, session.userId, selectedProjectId)
    : undefined;
  const taskViewPresets = useMemo<TaskViewDefinition[]>(() => [
    {
      id: "preset:mine",
      name: "Mes tâches",
      filters: createTaskFilterSnapshot({ assignee: session.userId, sort: "due" })
    },
    {
      id: "preset:overdue",
      name: "En retard",
      filters: createTaskFilterSnapshot({ due: "overdue", sort: "due" })
    },
    {
      id: "preset:blocked",
      name: "Bloquées",
      filters: createTaskFilterSnapshot({ status: "blocked", view: "board" })
    },
    {
      id: "preset:unassigned",
      name: "Sans responsable",
      filters: createTaskFilterSnapshot({ assignee: "unassigned", sort: "created" })
    }
  ], [session.userId]);

  const selectedTaskId = details?.task.id;
  const labelsByTask = useMemo(() => {
    const labelsById = new Map(projectLabels.labels.map((label) => [label.id, label]));
    const result = new Map<string, ProjectLabel[]>();
    for (const assignment of projectLabels.assignments) {
      const label = labelsById.get(assignment.labelId);
      if (!label) continue;
      const taskLabels = result.get(assignment.taskId) ?? [];
      taskLabels.push(label);
      result.set(assignment.taskId, taskLabels);
    }
    for (const taskLabels of result.values()) {
      taskLabels.sort((left, right) => left.name.localeCompare(right.name, "fr"));
    }
    return result;
  }, [projectLabels]);
  const mediaByTask = useMemo(() => {
    const result = new Map<string, Attachment[]>();
    for (const attachment of taskMediaPreviews) {
      const media = result.get(attachment.taskId) ?? [];
      media.push(attachment);
      result.set(attachment.taskId, media);
    }
    return result;
  }, [taskMediaPreviews]);
  const selectedTaskLabelIds = useMemo(() => new Set(
    projectLabels.assignments
      .filter((assignment) => assignment.taskId === selectedTaskId)
      .map((assignment) => assignment.labelId)
  ), [projectLabels.assignments, selectedTaskId]);
  const hierarchyIndex = useMemo(() => {
    const tasksById = new Map(taskOptions.map((task) => [task.id, task]));
    const parentsByTask = new Map<string, TaskOption>();
    const childrenByParent = new Map<string, TaskOption[]>();
    for (const relation of taskHierarchy.relations) {
      const task = tasksById.get(relation.taskId);
      const parent = tasksById.get(relation.parentTaskId);
      if (!task || !parent) continue;
      parentsByTask.set(task.id, parent);
      const children = childrenByParent.get(parent.id) ?? [];
      children.push(task);
      childrenByParent.set(parent.id, children);
    }
    for (const children of childrenByParent.values()) {
      children.sort((left, right) => left.key.localeCompare(right.key, "fr", { numeric: true }));
    }
    return { parentsByTask, childrenByParent };
  }, [taskHierarchy.relations, taskOptions]);
  const selectedParent = selectedTaskId
    ? hierarchyIndex.parentsByTask.get(selectedTaskId)
    : undefined;
  const selectedChildren = selectedTaskId
    ? hierarchyIndex.childrenByParent.get(selectedTaskId) ?? []
    : [];
  const descendantTaskIds = useMemo(() => {
    const descendants = new Set<string>();
    if (!selectedTaskId) return descendants;
    const pending = [...(hierarchyIndex.childrenByParent.get(selectedTaskId) ?? [])];
    while (pending.length > 0) {
      const child = pending.pop()!;
      if (descendants.has(child.id)) continue;
      descendants.add(child.id);
      pending.push(...(hierarchyIndex.childrenByParent.get(child.id) ?? []));
    }
    return descendants;
  }, [hierarchyIndex.childrenByParent, selectedTaskId]);
  const parentCandidates = useMemo(() => taskOptions.filter((task) =>
    task.id !== selectedTaskId && !descendantTaskIds.has(task.id)
  ), [descendantTaskIds, selectedTaskId, taskOptions]);
  const currentTaskFilters = useMemo<TaskFilterSnapshot>(
    () => ({
      query: taskQuery,
      status: taskStatusFilter,
      priority: taskPriorityFilter,
      assignee: taskAssigneeFilter,
      due: taskDueFilter,
      label: taskLabelFilter,
      sort: taskSort,
      view: taskView
    }),
    [taskAssigneeFilter, taskDueFilter, taskLabelFilter, taskPriorityFilter, taskQuery,
      taskSort, taskStatusFilter, taskView]
  );
  const taskFiltersRef = useRef(currentTaskFilters);
  taskFiltersRef.current = currentTaskFilters;
  const activeTaskView = taskViewPresets.find((view) => view.id === activeTaskViewId)
    ?? savedTaskViews.find((view) => view.id === activeTaskViewId);
  const activeTaskViewDirty = activeTaskView !== undefined
    && !taskFilterSnapshotsEqual(currentTaskFilters, activeTaskView.filters);

  const filteredTasks = tasks;
  const taskCounts = useMemo(() => Object.fromEntries(
    boardStatuses.map((status) => [status, taskOptions.filter((task) => task.status === status).length])
  ) as Record<string, number>, [boardStatuses, taskOptions]);
  const dependencyCandidates = useMemo(() => taskOptions.filter((task) =>
    task.id !== selectedTaskId
    && dependencies.dependsOn.every((dependency) => dependency.id !== task.id)
  ), [dependencies.dependsOn, selectedTaskId, taskOptions]);
  const completedChecklistItems = details?.checklist.filter((item) => item.isCompleted).length ?? 0;
  const checklistProgress = details?.checklist.length
    ? Math.round((completedChecklistItems / details.checklist.length) * 100)
    : 0;

  const loadProjects = useCallback(async () => {
    const nextProjects = await api.projects();
    setProjects(nextProjects);
    setSelectedProjectId((current) => current ?? nextProjects[0]?.id);
  }, []);

  const loadTaskPage = useCallback(async (
    projectId: string,
    filters: TaskFilterSnapshot,
    cursor?: string,
    append = false
  ) => {
    const request = ++taskRequestSequence.current;
    if (append) {
      setTasksLoadingMore(true);
    } else {
      setTasksLoading(true);
    }
    try {
      const page = await api.taskPage(projectId, filters, cursor);
      if (request !== taskRequestSequence.current) return;
      setTasks((current) => {
        if (!append) return page.items;
        const existingIds = new Set(current.map((task) => task.id));
        return [...current, ...page.items.filter((task) => !existingIds.has(task.id))];
      });
      setTaskTotalCount(page.totalCount);
      setTaskNextCursor(page.nextCursor);
    } finally {
      if (request === taskRequestSequence.current) {
        setTasksLoading(false);
        setTasksLoadingMore(false);
      }
    }
  }, []);

  const loadTaskSupport = useCallback(async (projectId: string) => {
    const request = ++taskSupportRequestSequence.current;
    const [nextOptions, nextLabels, nextHierarchy, nextMedia, nextStatuses] = await Promise.all([
      api.taskOptions(projectId),
      api.projectLabels(projectId),
      api.projectTaskHierarchy(projectId),
      api.projectMediaPreviews(projectId),
      api.projectStatuses(projectId)
    ]);
    if (request !== taskSupportRequestSequence.current) return;
    setTaskOptions(nextOptions);
    setProjectLabels(nextLabels);
    setTaskHierarchy(nextHierarchy);
    setTaskMediaPreviews(nextMedia);
    setProjectStatuses(nextStatuses);
  }, []);

  const loadTasks = useCallback(async (projectId: string) => {
    await Promise.all([
      loadTaskPage(projectId, taskFiltersRef.current),
      loadTaskSupport(projectId)
    ]);
  }, [loadTaskPage, loadTaskSupport]);

  const loadMoreTasks = useCallback(async () => {
    if (!selectedProjectId || !taskNextCursor || tasksLoadingMore) return;
    await loadTaskPage(
      selectedProjectId,
      taskFiltersRef.current,
      taskNextCursor,
      true);
  }, [loadTaskPage, selectedProjectId, taskNextCursor, tasksLoadingMore]);

  const fetchDetailBundle = useCallback((taskId: string): Promise<DetailBundle> => Promise.all([
    api.task(taskId),
    api.attachments(taskId),
    api.attachmentUploads(taskId),
    api.externalReferences(taskId),
    api.taskDependencies(taskId),
    api.taskPlugins(taskId)
  ]), [pluginConfigurationRevision]);

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
      const [
        nextDetails,
        nextAttachments,
        nextUploads,
        nextReferences,
        nextDependencies,
        nextTaskPlugins
      ] = await usable;
      if (request !== detailRequestSequence.current) return;
      setDetails(nextDetails);
      setAttachments(nextAttachments);
      setActiveUploads(nextUploads);
      setExternalReferences(nextReferences);
      setDependencies(nextDependencies);
      setTaskPlugins(nextTaskPlugins);
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
    taskRequestSequence.current += 1;
    setTasks([]);
    setTaskOptions([]);
    setTaskTotalCount(0);
    setTaskNextCursor(null);
    setProjectLabels({ labels: [], assignments: [] });
    setProjectStatuses(defaultProjectStatuses);
    setShowStatusEditor(false);
    setTaskMediaPreviews([]);
    setTaskHierarchy({ relations: [] });
    setTasksLoadingMore(false);
    if (selectedProjectId) {
      loadTaskSupport(selectedProjectId)
        .catch(() => setError("Impossible de charger les informations du projet."));
    } else {
      taskSupportRequestSequence.current += 1;
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
    setTaskLabelFilter("all");
    setTaskDueFilter("all");
  }, [loadTaskSupport, selectedProjectId, setError]);

  useEffect(() => {
    if (!selectedProjectId) return;
    const timeout = window.setTimeout(() => {
      void loadTaskPage(selectedProjectId, taskFiltersRef.current)
        .catch(() => setError("Impossible de charger les tâches."));
    }, taskQuery.trim().length > 0 ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [
    loadTaskPage,
    selectedProjectId,
    setError,
    taskAssigneeFilter,
    taskDueFilter,
    taskLabelFilter,
    taskPriorityFilter,
    taskQuery,
    taskSort,
    taskStatusFilter
  ]);
  useEffect(() => {
    setActiveTaskViewId(undefined);
    if (!taskViewsStorageKey) {
      setSavedTaskViews([]);
      return;
    }
    try {
      setSavedTaskViews(parseSavedTaskViews(window.localStorage.getItem(taskViewsStorageKey)));
    } catch {
      setSavedTaskViews([]);
    }
  }, [taskViewsStorageKey]);

  useEffect(() => {
    if (taskLabelFilter === "all" || taskLabelFilter === "none") return;
    if (!projectLabels.labels.some((label) => label.id === taskLabelFilter)) {
      setTaskLabelFilter("all");
    }
  }, [projectLabels.labels, taskLabelFilter]);

  useEffect(() => {
    window.localStorage.setItem("cytask.taskView", taskView);
  }, [taskView]);
  useEffect(() => {
    window.localStorage.setItem("cytask.theme", themeMode);
  }, [themeMode]);


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
    stream.addEventListener("task.checklist_item_created", refreshComment);
    stream.addEventListener("task.checklist_item_updated", refreshComment);
    stream.addEventListener("task.checklist_item_deleted", refreshComment);
    stream.addEventListener("project.label_created", refreshTasks);
    stream.addEventListener("project.label_deleted", refreshTasks);
    stream.addEventListener("task.label_added", refreshComment);
    stream.addEventListener("task.label_removed", refreshComment);
    stream.addEventListener("task.parent_set", refreshComment);
    stream.addEventListener("task.parent_removed", refreshComment);
    const refreshActivity = () => {
      if (showActivity) void loadActivity();
    };
    const resynchronize = () => {
      void loadProjects();
      void loadMembers();
      refreshComment();
      refreshActivity();
    };
    stream.addEventListener("reset", resynchronize);
    stream.addEventListener("project.created", refreshActivity);
    stream.addEventListener("task.created", refreshActivity);
    stream.addEventListener("task.updated", refreshActivity);
    stream.addEventListener("comment.created", refreshActivity);
    stream.addEventListener("task.checklist_item_created", refreshActivity);
    stream.addEventListener("task.checklist_item_updated", refreshActivity);
    stream.addEventListener("task.checklist_item_deleted", refreshActivity);
    stream.addEventListener("project.label_created", refreshActivity);
    stream.addEventListener("project.label_deleted", refreshActivity);
    stream.addEventListener("task.label_added", refreshActivity);
    stream.addEventListener("task.label_removed", refreshActivity);
    stream.addEventListener("task.parent_set", refreshActivity);
    stream.addEventListener("task.parent_removed", refreshActivity);
    stream.addEventListener("invitation.created", refreshActivity);
    const refreshAttachments = () => {
      if (selectedTaskId) void loadDetails(selectedTaskId);
      refreshTasks();
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

  function applyTaskFilters(filters: TaskFilterSnapshot) {
    setTaskQuery(filters.query);
    setTaskStatusFilter(filters.status);
    setTaskPriorityFilter(filters.priority);
    setTaskAssigneeFilter(filters.assignee);
    setTaskDueFilter(filters.due);
    setTaskLabelFilter(filters.label);
    setTaskSort(filters.sort);
    setTaskView(filters.view);
  }

  function resetTaskFilters() {
    setActiveTaskViewId(undefined);
    applyTaskFilters(createTaskFilterSnapshot({
      sort: taskSort,
      view: taskView
    }));
  }

  function selectSidebarSection(section: SidebarSection, labelId?: string) {
    closeTask();
    setShowTeam(false);
    setShowActivity(false);
    setShowTokens(false);
    setSearchHits(undefined);
    setWorkspaceArea("tasks");
    setSidebarSection(section);
    setActiveTaskViewId(undefined);

    const filters = createTaskFilterSnapshot({ view: taskView, sort: "updated" });
    if (section === "inbox") filters.status = "todo";
    if (section === "mine") {
      filters.assignee = session.userId;
      filters.sort = "due";
    }
    if (section === "today") {
      filters.due = "today";
      filters.sort = "due";
    }
    if (section === "later") {
      filters.due = "week";
      filters.sort = "due";
    }
    if (section === "completed") filters.status = "done";
    if (labelId) filters.label = labelId;
    applyTaskFilters(filters);
  }

  function selectTaskView(viewId?: string) {
    if (!viewId) {
      setActiveTaskViewId(undefined);
      return;
    }
    const view = taskViewPresets.find((candidate) => candidate.id === viewId)
      ?? savedTaskViews.find((candidate) => candidate.id === viewId);
    if (!view) {
      setActiveTaskViewId(undefined);
      return;
    }
    applyTaskFilters(view.filters);
    setActiveTaskViewId(view.id);
  }

  function persistSavedTaskViews(nextViews: SavedTaskView[]) {
    if (!taskViewsStorageKey) return false;
    try {
      window.localStorage.setItem(taskViewsStorageKey, JSON.stringify(nextViews));
      setSavedTaskViews(nextViews);
      return true;
    } catch {
      notify("error", "Le navigateur ne permet pas d’enregistrer cette vue.");
      return false;
    }
  }

  function taskViewNameIsAvailable(name: string, excludedId?: string) {
    const normalized = name.trim().toLocaleLowerCase("fr");
    return !savedTaskViews.some((view) =>
      view.id !== excludedId && view.name.toLocaleLowerCase("fr") === normalized
    );
  }

  function saveTaskView(name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40) {
      notify("error", "Le nom de la vue doit contenir entre 1 et 40 caractères.");
      return false;
    }
    if (!taskViewNameIsAvailable(trimmed)) {
      notify("error", "Une vue porte déjà ce nom dans ce projet.");
      return false;
    }
    if (savedTaskViews.length >= 20) {
      notify("error", "Ce projet possède déjà le maximum de 20 vues personnelles.");
      return false;
    }
    const now = new Date().toISOString();
    const view: SavedTaskView = {
      id: crypto.randomUUID(),
      name: trimmed,
      filters: currentTaskFilters,
      createdAt: now,
      updatedAt: now
    };
    if (!persistSavedTaskViews([...savedTaskViews, view])) return false;
    setActiveTaskViewId(view.id);
    notify("success", `Vue « ${view.name} » enregistrée.`);
    return true;
  }

  function updateActiveTaskView() {
    const active = savedTaskViews.find((view) => view.id === activeTaskViewId);
    if (!active) return;
    const nextViews = savedTaskViews.map((view) =>
      view.id === active.id
        ? { ...view, filters: currentTaskFilters, updatedAt: new Date().toISOString() }
        : view
    );
    if (persistSavedTaskViews(nextViews)) {
      notify("success", `Vue « ${active.name} » mise à jour.`);
    }
  }

  function renameActiveTaskView(name: string) {
    const active = savedTaskViews.find((view) => view.id === activeTaskViewId);
    const trimmed = name.trim();
    if (!active || !trimmed || trimmed.length > 40) {
      notify("error", "Le nom de la vue doit contenir entre 1 et 40 caractères.");
      return false;
    }
    if (!taskViewNameIsAvailable(trimmed, active.id)) {
      notify("error", "Une vue porte déjà ce nom dans ce projet.");
      return false;
    }
    const nextViews = savedTaskViews.map((view) =>
      view.id === active.id
        ? { ...view, name: trimmed, updatedAt: new Date().toISOString() }
        : view
    );
    if (!persistSavedTaskViews(nextViews)) return false;
    notify("success", `Vue renommée « ${trimmed} ».`);
    return true;
  }

  function deleteActiveTaskView() {
    const active = savedTaskViews.find((view) => view.id === activeTaskViewId);
    if (!active) return;
    const nextViews = savedTaskViews.filter((view) => view.id !== active.id);
    if (!persistSavedTaskViews(nextViews)) return;
    setActiveTaskViewId(undefined);
    notify("success", `Vue « ${active.name} » supprimée.`);
  }

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
      await loadTasks(selectedProjectId);
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


  async function createChecklistItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details || checklistCreating) return;
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title")).trim();
    if (!title) return;
    const taskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    setChecklistCreating(true);
    try {
      await api.createChecklistItem(taskId, title);
      form.reset();
      notify("success", "Élément ajouté à la checklist.");
      await Promise.all([loadDetails(taskId), loadTasks(projectId)]);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setChecklistCreating(false);
    }
  }

  async function toggleChecklistItem(item: TaskChecklistItem, isCompleted: boolean) {
    if (!details || pendingChecklistItemIds.has(item.id)) return;
    const taskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    setPendingChecklistItemIds((current) => new Set(current).add(item.id));
    setDetails((current) => current?.task.id === taskId
      ? {
        ...current,
        checklist: current.checklist.map((candidate) =>
          candidate.id === item.id ? { ...candidate, isCompleted } : candidate)
      }
      : current);
    try {
      await api.updateChecklistItem(taskId, item.id, {
        title: item.title,
        isCompleted,
        expectedRevision: item.revision
      });
      await Promise.all([loadDetails(taskId), loadTasks(projectId)]);
    } catch (reason) {
      await loadDetails(taskId).catch(() => undefined);
      setError(reason instanceof ApiError && reason.status === 409
        ? "La checklist a changé. Sa dernière version a été rechargée."
        : messageFor(reason));
    } finally {
      setPendingChecklistItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function deleteChecklistItem(item: TaskChecklistItem) {
    if (!details || pendingChecklistItemIds.has(item.id)) return;
    if (!window.confirm(`Supprimer « ${item.title} » de la checklist ?`)) return;
    const taskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    setPendingChecklistItemIds((current) => new Set(current).add(item.id));
    try {
      await api.deleteChecklistItem(taskId, item.id, item.revision);
      notify("success", "Élément supprimé de la checklist.");
      await Promise.all([loadDetails(taskId), loadTasks(projectId)]);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        await loadDetails(taskId).catch(() => undefined);
        setError("La checklist a changé. Sa dernière version a été rechargée.");
      } else {
        setError(messageFor(reason));
      }
    } finally {
      setPendingChecklistItemIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function toggleTaskLabel(label: ProjectLabel, shouldAssign: boolean) {
    if (!details || pendingLabelIds.has(label.id)) return;
    const taskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    setPendingLabelIds((current) => new Set(current).add(label.id));
    try {
      if (shouldAssign) await api.addTaskLabel(taskId, label.id);
      else await api.removeTaskLabel(taskId, label.id);
      await Promise.all([loadDetails(taskId), loadTasks(projectId)]);
    } catch (reason) {
      setError(messageFor(reason));
      await loadTasks(projectId).catch(() => undefined);
    } finally {
      setPendingLabelIds((current) => {
        const next = new Set(current);
        next.delete(label.id);
        return next;
      });
    }
  }

  async function createProjectStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || !canAdminister) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    try {
      await api.createProjectStatus(selectedProjectId, {
        name: String(data.get("name")),
        color: String(data.get("color"))
      });
      form.reset();
      setProjectStatuses(await api.projectStatuses(selectedProjectId));
      notify("success", "Nouvel état ajouté au projet.");
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function updateProjectStatus(
    event: FormEvent<HTMLFormElement>,
    projectStatus: ProjectStatus
  ) {
    event.preventDefault();
    if (!selectedProjectId || !canAdminister || pendingStatusKeys.has(projectStatus.key)) return;
    const data = new FormData(event.currentTarget);
    setPendingStatusKeys((current) => new Set(current).add(projectStatus.key));
    setError("");
    try {
      const updated = await api.updateProjectStatus(selectedProjectId, projectStatus.key, {
        name: String(data.get("name")),
        color: String(data.get("color"))
      });
      setProjectStatuses((current) => current.map((candidate) =>
        candidate.key === updated.key ? updated : candidate));
      notify("success", `État « ${updated.name} » mis à jour.`);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setPendingStatusKeys((current) => {
        const next = new Set(current);
        next.delete(projectStatus.key);
        return next;
      });
    }
  }

  async function createProjectLabel(name: string, color: string) {
    if (!details) return false;
    const taskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    try {
      const label = await api.createProjectLabel(projectId, { name, color });
      await api.addTaskLabel(taskId, label.id);
      notify("success", `Label « ${label.name} » créé et attribué.`);
      await Promise.all([loadDetails(taskId), loadTasks(projectId)]);
      return true;
    } catch (reason) {
      setError(messageFor(reason));
      await loadTasks(projectId).catch(() => undefined);
      return false;
    }
  }

  async function createProjectFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProjectId || !canContribute) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name")).trim();
    const color = String(data.get("color")).trim();
    const parentLabelId = String(data.get("parentLabelId")).trim() || null;
    if (!name) return;

    setError("");
    try {
      const folder = await api.createProjectLabel(selectedProjectId, {
        name,
        color,
        parentLabelId
      });
      form.reset();
      setFolderEditorParentId(undefined);
      await loadTaskSupport(selectedProjectId);
      notify(
        "success",
        parentLabelId
          ? `Sous-dossier « ${folder.name} » créé.`
          : `Dossier « ${folder.name} » créé.`
      );
    } catch (reason) {
      setError(messageFor(reason));
    }
  }

  async function deleteProjectLabel(label: ProjectLabel) {
    if (!selectedProjectId || pendingLabelIds.has(label.id)) return;
    const projectId = selectedProjectId;
    setError("");
    setPendingLabelIds((current) => new Set(current).add(label.id));
    try {
      await api.deleteProjectLabel(projectId, label.id);
      notify("success", `Label « ${label.name} » supprimé du projet.`);
      await loadTasks(projectId);
      if (selectedTaskId) await loadDetails(selectedTaskId).catch(() => undefined);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setPendingLabelIds((current) => {
        const next = new Set(current);
        next.delete(label.id);
        return next;
      });
    }
  }

  async function setTaskParent(parentTaskId: string) {
    if (!details || hierarchyPending) return;
    const taskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    setHierarchyPending(true);
    try {
      await api.setTaskParent(taskId, parentTaskId);
      notify("success", "Tâche parente mise à jour.");
      await Promise.all([loadDetails(taskId), loadTasks(projectId)]);
    } catch (reason) {
      setError(messageFor(reason));
      await loadTasks(projectId).catch(() => undefined);
    } finally {
      setHierarchyPending(false);
    }
  }

  async function removeTaskParent() {
    if (!details || hierarchyPending) return;
    const taskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    setHierarchyPending(true);
    try {
      await api.removeTaskParent(taskId);
      notify("success", "La tâche est maintenant à la racine du projet.");
      await Promise.all([loadDetails(taskId), loadTasks(projectId)]);
    } catch (reason) {
      setError(messageFor(reason));
      await loadTasks(projectId).catch(() => undefined);
    } finally {
      setHierarchyPending(false);
    }
  }

  async function createSubtask(title: string) {
    if (!details || hierarchyPending) return false;
    const parentTaskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    setHierarchyPending(true);
    try {
      const subtask = await api.createTask(projectId, {
        title,
        description: "",
        priority: "normal",
        dueAt: null,
        assigneeId: null
      });
      await api.setTaskParent(subtask.id, parentTaskId);
      notify("success", `Sous-tâche « ${subtask.title} » créée.`);
      await loadTasks(projectId);
      return true;
    } catch (reason) {
      setError(messageFor(reason));
      await loadTasks(projectId).catch(() => undefined);
      return false;
    } finally {
      setHierarchyPending(false);
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
        assigneeIds: data.getAll("assigneeIds").map(String),
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
        assigneeIds: taskAssigneeIds(task),
        expectedRevision: task.revision
      });
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetails((current) => current?.task.id === updated.id ? { ...current, task: updated } : current);
      await loadTasks(updated.projectId);
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

  async function changeTaskAssignees(task: WorkItem, assigneeIds: string[]) {
    if (!canContribute || pendingTaskIds.has(task.id)) return;
    setPendingTaskIds((current) => new Set(current).add(task.id));
    setError("");
    try {
      const updated = await api.updateTask(task.id, {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
        assigneeIds,
        expectedRevision: task.revision
      });
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetails((current) => current?.task.id === updated.id ? { ...current, task: updated } : current);
      await loadTasks(updated.projectId);
      notify("success", assigneeIds.length > 1
        ? `${assigneeIds.length} responsables assignés.`
        : assigneeIds.length === 1 ? "Responsable assigné." : "Responsables retirés.");
    } catch (reason) {
      if (selectedTaskId === task.id) await loadDetails(task.id).catch(() => undefined);
      setError(reason instanceof ApiError && reason.status === 409
        ? "Cette tâche a été modifiée ailleurs. Sa dernière version a été rechargée."
        : messageFor(reason));
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  async function changeTaskInline(
    task: WorkItem,
    changes: Partial<Pick<WorkItem, "priority" | "dueAt">>,
    confirmation: string
  ) {
    if (!canContribute || pendingTaskIds.has(task.id)) return;
    const optimistic = { ...task, ...changes };
    if (optimistic.priority === task.priority && optimistic.dueAt === task.dueAt) return;
    setError("");
    setPendingTaskIds((current) => new Set(current).add(task.id));
    setTasks((current) => current.map((item) => item.id === task.id ? optimistic : item));
    setDetails((current) => current?.task.id === task.id
      ? { ...current, task: { ...current.task, ...changes } }
      : current);
    try {
      const updated = await api.updateTask(task.id, {
        title: optimistic.title,
        description: optimistic.description,
        status: optimistic.status,
        priority: optimistic.priority,
        dueAt: optimistic.dueAt,
        assigneeIds: taskAssigneeIds(optimistic),
        expectedRevision: task.revision
      });
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetails((current) => current?.task.id === updated.id ? { ...current, task: updated } : current);
      notify("success", confirmation);
      await loadTasks(updated.projectId);
    } catch (reason) {
      if (selectedProjectId) await loadTasks(selectedProjectId).catch(() => undefined);
      if (selectedTaskId === task.id) await loadDetails(task.id).catch(() => undefined);
      setError(reason instanceof ApiError && reason.status === 409
        ? "Cette tâche a été modifiée ailleurs. Sa dernière version a été rechargée."
        : messageFor(reason));
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  async function changeTasksBulk(
    selectedTasks: WorkItem[],
    changes: Partial<Pick<WorkItem, "status" | "priority">>
  ): Promise<boolean> {
    if (!canContribute) return false;
    const eligible = selectedTasks.filter((task) =>
      !pendingTaskIds.has(task.id)
      && ((changes.status !== undefined && changes.status !== task.status)
        || (changes.priority !== undefined && changes.priority !== task.priority))
    );
    if (eligible.length === 0) return true;

    const eligibleIds = new Set(eligible.map((task) => task.id));
    const originalById = new Map(eligible.map((task) => [task.id, task]));
    const optimisticById = new Map(eligible.map((task) => [
      task.id,
      { ...task, ...changes }
    ]));
    setError("");
    setPendingTaskIds((current) => new Set([...current, ...eligibleIds]));
    setTasks((current) => current.map((task) => optimisticById.get(task.id) ?? task));
    setDetails((current) => {
      if (!current || !eligibleIds.has(current.task.id)) return current;
      return { ...current, task: { ...current.task, ...changes } };
    });

    const updatedTasks: WorkItem[] = [];
    const failures: unknown[] = [];
    const failedIds = new Set<string>();
    let cursor = 0;
    async function worker() {
      while (cursor < eligible.length) {
        const task = eligible[cursor++];
        if (!task) return;
        const optimistic = optimisticById.get(task.id)!;
        try {
          updatedTasks.push(await api.updateTask(task.id, {
            title: optimistic.title,
            description: optimistic.description,
            status: optimistic.status,
            priority: optimistic.priority,
            dueAt: optimistic.dueAt,
            assigneeIds: taskAssigneeIds(optimistic),
            expectedRevision: task.revision
          }));
        } catch (reason) {
          failures.push(reason);
          failedIds.add(task.id);
        }
      }
    }

    try {
      await Promise.all(Array.from(
        { length: Math.min(4, eligible.length) },
        () => worker()
      ));
      const updatedById = new Map(updatedTasks.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) =>
        updatedById.get(task.id)
        ?? (failedIds.has(task.id) ? originalById.get(task.id) ?? task : task)
      ));
      setDetails((current) => {
        if (!current) return current;
        const updated = updatedById.get(current.task.id);
        if (updated) return { ...current, task: updated };
        const original = failedIds.has(current.task.id) ? originalById.get(current.task.id) : undefined;
        return original ? { ...current, task: original } : current;
      });
      const projectId = selectedProjectId ?? eligible[0]?.projectId;
      if (projectId) await loadTasks(projectId).catch(() => undefined);
      if (selectedTaskId && eligibleIds.has(selectedTaskId)) {
        await loadDetails(selectedTaskId).catch(() => undefined);
      }

      if (failures.length === 0) {
        notify("success", eligible.length + " tâche(s) mise(s) à jour.");
        return true;
      }
      notify(
        "error",
        updatedTasks.length + " tâche(s) mise(s) à jour, " + failures.length + " en conflit ou en erreur."
      );
      return false;
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        for (const taskId of eligibleIds) next.delete(taskId);
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

  async function uploadAttachment(
    eventOrFile: FormEvent<HTMLFormElement> | File,
    optimizedOverride = false
  ) {
    const event = eventOrFile instanceof File ? undefined : eventOrFile;
    event?.preventDefault();
    if (!details || uploadProgress) return;
    const taskId = details.task.id;
    const form = event?.currentTarget;
    const data = form ? new FormData(form) : undefined;
    const formFiles = (data?.getAll("file") ?? [])
      .filter((value): value is File => value instanceof File && value.size > 0);
    const optimizedLocally = optimizedOverride || data?.get("optimizedLocally") === "on";
    if (!(eventOrFile instanceof File) && formFiles.length > 1) {
      for (const selectedFile of formFiles) {
        await uploadAttachment(selectedFile, optimizedLocally);
      }
      form?.reset();
      return;
    }
    const file = eventOrFile instanceof File ? eventOrFile : formFiles[0];
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

      let upload = activeUploads.find((candidate) =>
        candidate.attachment.fileName === file.name
        && candidate.attachment.sizeBytes === file.size
        && candidate.attachment.sha256 === fullSha256
      );
      if (upload) {
        try {
          upload = await api.attachmentUpload(upload.id);
        } catch (reason) {
          if (reason instanceof ApiError && reason.status === 404) {
            upload = undefined;
          } else {
            throw reason;
          }
        }
      }

      if (upload) {
        const receivedBytes = upload.chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0);
        notify(
          "info",
          `Reprise de ${file.name} à ${Math.round((receivedBytes / file.size) * 100)} %.`
        );
      } else {
        upload = await api.createAttachmentUpload(taskId, {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          sha256: fullSha256,
          optimizedLocally
        });
      }

      let index = upload.chunks.length;
      let sent = upload.chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0);
      const chunksAreContiguous = upload.chunks.every((chunk, chunkIndex) =>
        chunk.index === chunkIndex
        && chunk.sizeBytes === Math.min(upload.chunkSizeBytes, file.size - chunkIndex * upload.chunkSizeBytes)
      );
      if (!chunksAreContiguous || sent > file.size) {
        throw new ApiError("La session de reprise contient des blocs incohérents.", 409);
      }

      if (sent > 0) {
        setUploadProgress({
          label: `Reprise à ${formatBytes(sent)} / ${formatBytes(file.size)}`,
          percent: Math.round((sent / file.size) * 100)
        });
      }

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
      detailPrefetch.current.delete(taskId);
      await loadDetails(taskId);
      form?.reset();
    } catch (reason) {
      setError(messageFor(reason));
      if (selectedTaskId === taskId) {
        detailPrefetch.current.delete(taskId);
        await loadDetails(taskId).catch(() => undefined);
      }
    } finally {
      setUploadProgress(undefined);
    }
  }

  function dragTaskFiles(event: DragEvent<HTMLElement>) {
    if (!canContribute || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setAttachmentDragActive(true);
  }

  function leaveTaskFileDrop(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setAttachmentDragActive(false);
    }
  }

  async function dropTaskFiles(event: DragEvent<HTMLElement>) {
    if (!canContribute || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setAttachmentDragActive(false);
    setDetailTab("files");
    for (const file of Array.from(event.dataTransfer.files)) {
      await uploadAttachment(file);
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
    setTaskPlugins([]);
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
    <div className={`workspace-shell theme-${themeMode}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <a className="brand compact" href="/" aria-label="CyTask, accueil">
            <span className="brand-mark"><img src="/icons/cytask.png" alt="" /></span>
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

        <div className="sidebar-scroll">
          <nav className="sidebar-home" aria-label="Accueil">
            <p className="nav-label">Accueil</p>
            <button
              className={sidebarSection === "inbox" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title="Boîte de réception"
              onClick={() => selectSidebarSection("inbox")}
            >
              <span className="sidebar-nav-icon">▣</span>
              <span className="sidebar-nav-copy">Boîte de réception</span>
              <span className="nav-count">{taskCounts.todo}</span>
            </button>
            <button
              className={sidebarSection === "mine" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title="Mes tâches"
              onClick={() => selectSidebarSection("mine")}
            >
              <span className="sidebar-nav-icon">◎</span>
              <span className="sidebar-nav-copy">Mes tâches</span>
            </button>
            <button
              className={sidebarSection === "today" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title="Aujourd’hui"
              onClick={() => selectSidebarSection("today")}
            >
              <span className="sidebar-nav-icon">◷</span>
              <span className="sidebar-nav-copy">Aujourd’hui</span>
            </button>
            <button
              className={sidebarSection === "later" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title="Plus tard"
              onClick={() => selectSidebarSection("later")}
            >
              <span className="sidebar-nav-icon">↗</span>
              <span className="sidebar-nav-copy">Plus tard</span>
            </button>
            <button
              className={sidebarSection === "completed" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title="Terminées"
              onClick={() => selectSidebarSection("completed")}
            >
              <span className="sidebar-nav-icon">✓</span>
              <span className="sidebar-nav-copy">Terminées</span>
              <span className="nav-count">{taskCounts.done}</span>
            </button>
          </nav>

          <nav className="project-list" aria-label="Espaces et dossiers">
            <p className="nav-label">Espaces</p>
            {projects.map((project) => (
              <div className="project-tree" key={project.id}>
                <button
                  className={project.id === selectedProjectId && sidebarSection === "project" && !selectedFolder && workspaceArea === "tasks"
                    ? "project-link active"
                    : "project-link"}
                  title={project.name}
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    selectSidebarSection("project");
                  }}
                >
                  <span className="project-avatar">{project.key.slice(0, 2)}</span>
                  <span>{project.name}</span>
                </button>
                {project.id === selectedProjectId && (
                  <>
                    <ProjectFolderTree
                      labels={projectLabels.labels}
                      counts={labelCounts}
                      selectedLabelId={selectedFolder?.id}
                      editorParentId={folderEditorParentId}
                      canCreate={canContribute}
                      onSelect={(labelId) => selectSidebarSection("project", labelId)}
                      onStartCreate={setFolderEditorParentId}
                      onCancelCreate={() => setFolderEditorParentId(undefined)}
                      onCreate={(event) => void createProjectFolder(event)}
                    />
                    <div className="space-resource-links">
                      <button className={workspaceArea === "contents" ? "active" : ""} type="button"
                        onClick={() => {
                          closeTask(); setShowTeam(false); setShowActivity(false); setShowTokens(false);
                          setWorkspaceArea("contents"); setSidebarSection("project");
                        }}>
                        <span>◇</span><span>Contenus & fichiers</span>
                      </button>
                      <button className={workspaceArea === "chat" ? "active" : ""} type="button"
                        onClick={() => {
                          closeTask(); setShowTeam(false); setShowActivity(false); setShowTokens(false);
                          setWorkspaceArea("chat"); setSidebarSection("project");
                        }}>
                        <span>#</span><span>Chat d’équipe</span>
                      </button>
                      <button className={workspaceArea === "plugins" ? "active" : ""} type="button"
                        onClick={() => {
                          closeTask(); setShowTeam(false); setShowActivity(false); setShowTokens(false);
                          setWorkspaceArea("plugins"); setSidebarSection("project");
                        }}>
                        <span>＋</span><span>Plugins</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {projects.length === 0 && <p className="empty-note">Créez votre premier projet.</p>}
          </nav>
        </div>

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

        <button
          className="team-link theme-link"
          type="button"
          title={themeMode === "dark" ? "Passer au mode clair" : "Passer au mode sombre"}
          onClick={() => setThemeMode((current) => current === "dark" ? "light" : "dark")}
        >
          <span className="project-avatar">{themeMode === "dark" ? "☀" : "☾"}</span>
          <span>{themeMode === "dark" ? "Mode clair" : "Mode sombre"}</span>
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
            <h1>{workspaceAreaTitle ?? workspaceTitle ?? "Bienvenue dans CyTask"}</h1>
            {selectedProject && workspaceArea === "tasks" && (
              <p className="project-summary">
                {`${taskTotalCount} affichée${taskTotalCount === 1 ? "" : "s"} sur ${taskOptions.length} tâches · ${taskCounts.in_progress} en cours`}
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
            {selectedProject && canContribute && workspaceArea === "tasks" && (
              <button
                className="primary-button small"
                title="Nouvelle tâche (N)"
                onClick={() => setShowTaskForm((value) => !value)}
              >Nouvelle tâche <kbd>N</kbd></button>
            )}
          </div>
        </header>

        {showTaskForm && selectedProject && workspaceArea === "tasks" && (
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

        {workspaceArea === "plugins" && selectedProject ? (
          <PluginManagerPane
            projectId={selectedProject.id}
            canAdminister={canAdminister}
            onError={setError}
            onNotice={(message) => notify("success", message)}
            onChanged={() => setPluginConfigurationRevision((revision) => revision + 1)}
          />
        ) : workspaceArea === "contents" && selectedProject ? (
          <ProjectContentPane
            projectId={selectedProject.id}
            labels={projectLabels.labels}
            tasks={taskOptions}
            selectedFolderId={selectedFolder?.id}
            canContribute={canContribute}
            onOpenTask={openTask}
            onError={setError}
            onNotice={(message) => notify("success", message)}
          />
        ) : workspaceArea === "chat" && selectedProject ? (
          <TeamChatPane
            projectId={selectedProject.id}
            currentUserId={session.userId}
            members={members}
            canContribute={canContribute}
            onError={setError}
            tasks={taskOptions}
            onOpenTask={openTask}
            onNotice={(message) => notify("success", message)}
          />
        ) : searchHits ? (
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
                    && taskLabelFilter === "all"
                    && taskAssigneeFilter === "all"
                    && taskDueFilter === "all"
                    && !taskQuery
                    ? "task-metric active"
                    : "task-metric"}
                  type="button"
                  aria-pressed={taskStatusFilter === "all"
                    && taskLabelFilter === "all"
                    && taskPriorityFilter === "all"
                    && taskAssigneeFilter === "all"
                    && taskDueFilter === "all"
                    && !taskQuery}
                  onClick={resetTaskFilters}
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
              <TaskSavedViews
                presets={taskViewPresets}
                savedViews={savedTaskViews}
                activeViewId={activeTaskViewId}
                dirty={activeTaskViewDirty}
                onSelect={selectTaskView}
                onSave={saveTaskView}
                onUpdate={updateActiveTaskView}
                onRename={renameActiveTaskView}
                onDelete={deleteActiveTaskView}
                onReset={resetTaskFilters}
              />

              <div className="task-tools">
                <label className="task-filter-search">
                  <span className="sr-only">Filtrer les tâches</span>
                  <input
                    ref={taskFilterInput}
                    type="search"
                    maxLength={240}
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
                  className="task-label-filter"
                  aria-label="Filtrer par label"
                  value={taskLabelFilter}
                  onChange={(event) => setTaskLabelFilter(event.currentTarget.value)}
                >
                  <option value="all">Tous les labels</option>
                  <option value="none">Sans label</option>
                  {projectLabels.labels.map((label) => (
                    <option value={label.id} key={label.id}>{label.name}</option>
                  ))}
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
                    className={taskView === "compact" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "compact"}
                    onClick={() => setTaskView("compact")}
                  >Compact</button>
                  <button
                    className={taskView === "board" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "board"}
                    onClick={() => setTaskView("board")}
                  >Kanban</button>
                  <button
                    className={taskView === "canvas" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "canvas"}
                    onClick={() => setTaskView("canvas")}
                  >Canvas</button>
                  <button
                    className={taskView === "graph" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "graph"}
                    onClick={() => setTaskView("graph")}
                  >Graphe</button>
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
            ) : !tasksLoading && tasks.length === 0 && taskOptions.length > 0 ? (
              <section className="filter-empty" aria-live="polite">
                <span aria-hidden="true">⌕</span>
                <h2>Aucune tâche trouvée</h2>
                <p>Modifiez la recherche ou réinitialisez les filtres de ce projet.</p>
                <button className="text-button" type="button" onClick={resetTaskFilters}>Réinitialiser les filtres</button>
              </section>
            ) : taskView === "compact" ? (
              <CompactTaskTable
                tasks={filteredTasks}
                labelsByTask={labelsByTask}
                statusLabels={statusLabels}
                statusColors={statusColors}
                statusOrder={boardStatuses}
                members={members}
                canEdit={canContribute}
                pendingTaskIds={pendingTaskIds}
                selectedTaskId={selectedTaskId}
                onOpenTask={openTask}
                onChangeStatus={(task, status) => void changeTaskStatus(task, status)}
                onChangePriority={(task, priority) => void changeTaskInline(task, { priority }, "Priorité modifiée.")}
                onChangeDueAt={(task, dueAt) => void changeTaskInline(task, { dueAt }, "Échéance modifiée.")}
                onChangeAssignees={(task, assigneeIds) => void changeTaskAssignees(task, assigneeIds)}
                onBulkChange={changeTasksBulk}
              />
            ) : taskView === "canvas" ? (
              <ProjectCanvas
                key={selectedProjectId}
                projectId={selectedProjectId!}
                tasks={taskOptions}
                onOpenTask={openTask}
              />
            ) : taskView === "graph" ? (
              <TaskCanvas
                key="graph"
                mode="graph"
                tasks={taskOptions}
                labels={projectLabels.labels}
                assignments={projectLabels.assignments}
                hierarchy={taskHierarchy.relations}
                onOpenTask={openTask}
              />
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
                      <TaskLabelChips labels={labelsByTask.get(task.id) ?? []} />
                      <TaskHierarchyMeta
                        parent={hierarchyIndex.parentsByTask.get(task.id)}
                        childCount={hierarchyIndex.childrenByParent.get(task.id)?.length ?? 0}
                      />
                      <small>
                        {task.key} · {task.assigneeName ?? "Non assignée"} · {task.dueAt ? `Échéance ${shortDate(task.dueAt)}` : "Sans échéance"}
                        {task.description ? ` · ${task.description}` : ""}
                      </small>
                    </span>
                    <span className="task-state-stack">
                      <span
                        className={`status status-${task.status}`}
                        style={taskStatusStyle(task.status)}
                      >{statusLabels[task.status] ?? task.status}</span>
                      <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
                    </span>
                    <time dateTime={task.updatedAt}>{relativeDate(task.updatedAt)}</time>
                  </button>
                ))}
                {!tasksLoading && filteredTasks.length === 0 && (
                  <p className="empty-list">{taskOptions.length === 0
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
                          <span
                            className={`status-dot status-dot-${status}`}
                            style={{ backgroundColor: statusColors[status] ?? "#7C8B9A" }}
                            aria-hidden="true"
                          />
                          <h2>{statusLabels[status] ?? status}</h2>
                          <span>{columnTasks.length}{taskNextCursor ? "+" : ""}</span>
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
                                <TaskMediaStrip media={mediaByTask.get(task.id) ?? []} />
                                <TaskLabelChips labels={labelsByTask.get(task.id) ?? []} />
                                <TaskHierarchyMeta
                                  parent={hierarchyIndex.parentsByTask.get(task.id)}
                                  childCount={hierarchyIndex.childrenByParent.get(task.id)?.length ?? 0}
                                />
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
            {taskNextCursor && taskView !== "canvas" && taskView !== "graph" && (
              <div className="task-pagination">
                <button
                  className="primary-button small"
                  type="button"
                  disabled={tasksLoadingMore}
                  onClick={() => void loadMoreTasks().catch(() =>
                    setError("Impossible de charger la page suivante."))}
                >{tasksLoadingMore ? "Chargement…" : `Afficher plus (${tasks.length}/${taskTotalCount})`}</button>
              </div>
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
        <aside className="detail-pane task-detail-pane" aria-busy="true">
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
        <aside
          className="detail-pane task-detail-pane"
          aria-busy={detailsLoading}
          onDragEnter={dragTaskFiles}
          onDragOver={dragTaskFiles}
          onDragLeave={leaveTaskFileDrop}
          onDrop={(event) => void dropTaskFiles(event)}
        >
          {attachmentDragActive && (
            <div className="task-file-drop-overlay" aria-hidden="true">
              <strong>Déposer dans la tâche</strong>
              <span>Images, vidéos et autres fichiers seront envoyés de façon sécurisée.</span>
            </div>
          )}
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
              {taskPlugins.some((plugin) => plugin.manifest.id === gitPluginId) && (
                <button
                  className={detailTab === "git" ? "active plugin-tab" : "plugin-tab"}
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "git"}
                  onClick={() => { setDetailTab("git"); setIsEditing(false); }}
                ><span className="plugin-tab-icon">GT</span>Git <span>{externalReferences.length}</span></button>
              )}
              <button
                className={detailTab === "activity" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "activity"}
                onClick={() => { setDetailTab("activity"); setIsEditing(false); }}
              >Activité <span>{details.comments.length}</span></button>
              {taskPlugins.filter((plugin) => plugin.manifest.id !== gitPluginId).flatMap((plugin) => plugin.manifest.contributes.taskTabs.map((tab) => {
                const tabKey: DetailTab = `plugin:${plugin.manifest.id}:${tab.id}`;
                return (
                  <button
                    className={detailTab === tabKey ? "active plugin-tab" : "plugin-tab"}
                    type="button"
                    role="tab"
                    aria-selected={detailTab === tabKey}
                    key={tabKey}
                    onClick={() => { setDetailTab(tabKey); setIsEditing(false); }}
                  ><span className="plugin-tab-icon">{tab.icon}</span>{tab.title}</button>
                );
              }))}
            </nav>

            {detailsLoading && <p className="detail-loading" role="status">Synchronisation…</p>}

            {detailTab === "overview" && (isEditing ? (
              <form className="edit-task-form" key={`${details.task.id}-${details.task.revision}`} onSubmit={updateTask}>
                <label className="edit-field-title">
                  Titre
                  <input name="title" defaultValue={details.task.title} maxLength={240} required autoFocus />
                </label>
                <label>
                  État
                  <select name="status" defaultValue={details.task.status}>
                    {projectStatuses.map((projectStatus) => (
                      <option
                        value={projectStatus.key}
                        key={projectStatus.key}
                        style={{ color: projectStatus.color }}
                      >● {projectStatus.name}</option>
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
                <label className="edit-field-assignees">
                  Responsables
                  <TaskAssigneePicker
                    key={`${details.task.id}-${details.task.revision}-edit-assignees`}
                    members={members}
                    initialSelectedIds={taskAssigneeIds(details.task)}
                    name="assigneeIds"
                  />
                </label>
                <label className="edit-field-description">
                  Description
                  <textarea name="description" defaultValue={details.task.description} maxLength={20000} rows={6} />
                </label>
                <button className="primary-button small" type="submit">Enregistrer</button>
              </form>
            ) : (
              <>
                <h2>
                  {canContribute ? (
                    <button
                      className="editable-task-title"
                      type="button"
                      title="Cliquer pour modifier le titre"
                      onClick={() => setIsEditing(true)}
                    >{details.task.title}</button>
                  ) : details.task.title}
                </h2>
                <div className="quick-status">
                  <span className="quick-status-badges">
                    <span
                      className={`status status-${details.task.status}`}
                      style={taskStatusStyle(details.task.status)}
                    >{statusLabels[details.task.status] ?? details.task.status}</span>
                    <span className={`priority priority-${details.task.priority}`}>{priorityLabels[details.task.priority]}</span>
                  </span>
                  {canContribute && (
                    <div className="quick-status-controls">
                      <label>
                        <span>Changer l’état</span>
                        <select
                          value={details.task.status}
                          disabled={pendingTaskIds.has(details.task.id)}
                          style={taskStatusStyle(details.task.status)}
                          onChange={(event) => void changeTaskStatus(
                            details.task,
                            event.currentTarget.value
                          )}
                        >
                          {projectStatuses.map((projectStatus) => (
                            <option
                              value={projectStatus.key}
                              key={projectStatus.key}
                              style={{ color: projectStatus.color }}
                            >● {projectStatus.name}</option>
                          ))}
                        </select>
                      </label>
                      {canAdminister && (
                        <button
                          className="text-button status-settings-trigger"
                          type="button"
                          onClick={() => setShowStatusEditor((value) => !value)}
                        >{showStatusEditor ? "Fermer" : "Configurer les états"}</button>
                      )}
                    </div>
                  )}
                </div>
                {showStatusEditor && canAdminister && (
                  <section className="project-status-editor" aria-label="Configuration des états">
                    <header>
                      <div><h3>États du projet</h3><small>Nom et couleur visibles dans les tâches et les tableaux.</small></div>
                    </header>
                    <div className="project-status-list">
                      {projectStatuses.map((projectStatus) => (
                        <form
                          className="project-status-row"
                          onSubmit={(event) => void updateProjectStatus(event, projectStatus)}
                          key={projectStatus.key}
                        >
                          <input
                            type="color"
                            name="color"
                            defaultValue={projectStatus.color}
                            aria-label={`Couleur de ${projectStatus.name}`}
                          />
                          <input name="name" defaultValue={projectStatus.name} maxLength={60} required />
                          <code>{projectStatus.key}</code>
                          <button
                            className="secondary-button small"
                            type="submit"
                            disabled={pendingStatusKeys.has(projectStatus.key)}
                          >Enregistrer</button>
                        </form>
                      ))}
                    </div>
                    <form className="project-status-create" onSubmit={createProjectStatus}>
                      <input type="color" name="color" defaultValue="#8B5CF6" aria-label="Couleur du nouvel état" />
                      <input name="name" placeholder="Nouvel état, ex. En validation" maxLength={60} required />
                      <button className="primary-button small" type="submit">Ajouter</button>
                    </form>
                  </section>
                )}
                <TaskLabelsSection
                  labels={projectLabels.labels}
                  assignedLabelIds={selectedTaskLabelIds}
                  pendingLabelIds={pendingLabelIds}
                  canContribute={canContribute}
                  canDeleteLabels={canAdminister}
                  onToggle={toggleTaskLabel}
                  onCreate={createProjectLabel}
                  onDelete={deleteProjectLabel}
                />
                {canContribute ? (
                  <button
                    className={details.task.description ? "description editable-description" : "description editable-description muted"}
                    type="button"
                    title="Cliquer pour modifier la description"
                    onClick={() => setIsEditing(true)}
                  >{details.task.description || "Ajouter une description…"}</button>
                ) : (
                  <p className={details.task.description ? "description" : "description muted"}>
                    {details.task.description || "Aucune description."}
                  </p>
                )}
                {attachments.length > 0 && (
                  <section className="task-overview-media" aria-label="Médias et fichiers récents">
                    <header>
                      <div>
                        <h3>Médias et fichiers</h3>
                        <small>{attachments.length} fichier{attachments.length > 1 ? "s" : ""} lié{attachments.length > 1 ? "s" : ""}</small>
                      </div>
                      <button type="button" className="text-button" onClick={() => setDetailTab("files")}>
                        Tout afficher
                      </button>
                    </header>
                    <div className="task-overview-media-grid">
                      {attachments.slice(0, 4).map((attachment) => {
                        const served = attachment.detectedContentType ?? attachment.declaredContentType;
                        const available = attachment.status === "available";
                        const contentUrl = api.attachmentContentUrl(attachment.id);
                        if (available && served.startsWith("image/")) {
                          return <img src={contentUrl} alt={attachment.fileName} loading="lazy" key={attachment.id} />;
                        }
                        if (available && served.startsWith("video/")) {
                          return (
                            <video
                              src={contentUrl}
                              controls
                              preload="metadata"
                              playsInline
                              key={attachment.id}
                            />
                          );
                        }
                        return (
                          <article className="task-overview-file" key={attachment.id}>
                            <span>{served.startsWith("video/") ? "VIDÉO" : "FICHIER"}</span>
                            <strong>{attachment.fileName}</strong>
                            <small>{attachmentStatusLabel(attachment.status)}</small>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}

                <dl className="task-facts">
                  <div><dt>Créée</dt><dd title={fullDate(details.task.createdAt)}>{relativeDate(details.task.createdAt)}</dd></div>
                  <div><dt>Mise à jour</dt><dd title={fullDate(details.task.updatedAt)}>{relativeDate(details.task.updatedAt)}</dd></div>
                  <div>
                    <dt>Échéance</dt>
                    <dd className={isTaskOverdue(details.task) ? "overdue" : ""} title={details.task.dueAt ? fullDate(details.task.dueAt) : undefined}>
                      {details.task.dueAt ? shortDate(details.task.dueAt) : "Non définie"}
                    </dd>
                  </div>
                  <div className="task-assignee-fact">
                    <dt>Responsables</dt>
                    <dd>
                      <TaskAssigneePicker
                        key={`${details.task.id}-${details.task.revision}-quick-assignees`}
                        members={members}
                        selectedIds={taskAssigneeIds(details.task)}
                        disabled={!canContribute || pendingTaskIds.has(details.task.id)}
                        compact
                        onChange={(assigneeIds) => void changeTaskAssignees(details.task, assigneeIds)}
                      />
                    </dd>
                  </div>
                  <div><dt>Révision</dt><dd>#{details.task.revision}</dd></div>
                </dl>

                <TaskHierarchySection
                  task={details.task}
                  parent={selectedParent}
                  children={selectedChildren}
                  parentCandidates={parentCandidates}
                  canContribute={canContribute}
                  pending={hierarchyPending}
                  onOpenTask={openTask}
                  onSetParent={setTaskParent}
                  onRemoveParent={removeTaskParent}
                  onCreateSubtask={createSubtask}
                />

                <section className="task-checklist" aria-labelledby="task-checklist-title">
                  <div className="checklist-heading">
                    <div>
                      <h3 id="task-checklist-title">Checklist</h3>
                      <p>{completedChecklistItems} sur {details.checklist.length} terminés</p>
                    </div>
                    <strong>{checklistProgress}%</strong>
                  </div>
                  <progress
                    className="checklist-progress"
                    value={completedChecklistItems}
                    max={Math.max(details.checklist.length, 1)}
                    aria-label={`Progression de la checklist : ${checklistProgress}%`}
                  />
                  <div className="checklist-items">
                    {details.checklist.map((item) => {
                      const pending = pendingChecklistItemIds.has(item.id);
                      return (
                        <div
                          className={item.isCompleted ? "checklist-item completed" : "checklist-item"}
                          key={item.id}
                        >
                          <label>
                            <input
                              type="checkbox"
                              checked={item.isCompleted}
                              disabled={!canContribute || pending}
                              onChange={(event) =>
                                void toggleChecklistItem(item, event.currentTarget.checked)}
                            />
                            <span>{item.title}</span>
                          </label>
                          {canContribute && (
                            <button
                              className="icon-button quiet checklist-remove"
                              type="button"
                              disabled={pending}
                              aria-label={`Supprimer « ${item.title} » de la checklist`}
                              onClick={() => void deleteChecklistItem(item)}
                            >×</button>
                          )}
                        </div>
                      );
                    })}
                    {details.checklist.length === 0 && (
                      <p className="empty-note">Ajoutez les étapes nécessaires pour terminer cette tâche.</p>
                    )}
                  </div>
                  {canContribute && (
                    <form className="checklist-form" onSubmit={createChecklistItem}>
                      <input
                        name="title"
                        maxLength={500}
                        placeholder="Ajouter une étape…"
                        aria-label="Nouvel élément de checklist"
                        disabled={checklistCreating || details.checklist.length >= 200}
                        required
                      />
                      <button
                        className="primary-button small"
                        type="submit"
                        disabled={checklistCreating || details.checklist.length >= 200}
                      >{checklistCreating ? "Ajout…" : "Ajouter"}</button>
                    </form>
                  )}
                </section>
              </>
            ))}

            {taskPlugins.filter((plugin) => plugin.manifest.id !== gitPluginId).flatMap((plugin) =>
              plugin.manifest.contributes.taskTabs.map((tab) => {
                const tabKey: DetailTab = `plugin:${plugin.manifest.id}:${tab.id}`;
                return detailTab === tabKey ? (
                  <TaskPluginPanel
                    key={tabKey}
                    taskId={details.task.id}
                    plugin={plugin}
                    tab={tab}
                    canEdit={canContribute}
                    onError={setError}
                    onNotice={(message) => notify("success", message)}
                    onSaved={(updated) => setTaskPlugins((current) =>
                      current.map((item) => item.manifest.id === updated.manifest.id ? updated : item))}
                  />
                ) : null;
              })
            )}

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
                        <span
                          className={`status status-${dependency.status}`}
                          style={taskStatusStyle(dependency.status)}
                        >{statusLabels[dependency.status] ?? dependency.status}</span>
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
                        <span
                          className={`status status-${relation.status}`}
                          style={taskStatusStyle(relation.status)}
                        >{statusLabels[relation.status] ?? relation.status}</span>
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

            {detailTab === "git" && taskPlugins
              .filter((plugin) => plugin.manifest.id === gitPluginId)
              .flatMap((plugin) => plugin.manifest.contributes.taskTabs.slice(0, 1).map((tab) => (
                <div className="git-plugin-stack" key={plugin.manifest.id}>
                  <TaskPluginPanel
                    taskId={details.task.id}
                    plugin={plugin}
                    tab={tab}
                    canEdit={canContribute}
                    onError={setError}
                    onNotice={(message) => notify("success", message)}
                    onSaved={(updated) => setTaskPlugins((current) =>
                      current.map((item) => item.manifest.id === updated.manifest.id ? updated : item))}
                  />
                  <section className="external-references detail-section">
                    <h3>Références Git <span>{externalReferences.length}</span></h3>
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
                </div>
              )))}

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
                  {activeUploads.length > 0 && (
                    <div className="upload-resume-list" role="status">
                      <strong>Envois en cours ou à reprendre</strong>
                      {activeUploads.map((upload) => {
                        const received = upload.chunks.reduce(
                          (total, chunk) => total + chunk.sizeBytes,
                          0
                        );
                        return (
                          <span className="upload-resume-item" key={upload.id}>
                            <span>
                              <b>{upload.attachment.fileName}</b>
                              <small>
                                {formatBytes(received)} / {formatBytes(upload.attachment.sizeBytes)}
                                {" · "}expire le {new Date(upload.expiresAt).toLocaleString("fr-FR")}
                              </small>
                            </span>
                            <progress
                              max={upload.attachment.sizeBytes}
                              value={received}
                              aria-label={`Progression de ${upload.attachment.fileName}`}
                            />
                          </span>
                        );
                      })}
                      <small>
                        Resélectionnez le même fichier : son empreinte sera vérifiée avant la reprise.
                      </small>
                    </div>
                  )}
                  <label className="file-picker">
                    Ajouter une image, une vidéo ou un fichier
                    <input
                      name="file"
                      type="file"
                      accept="image/*,video/*,.pdf,.zip,.txt,.json"
                      multiple
                      required
                      disabled={Boolean(uploadProgress)}
                    />
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

function createTaskFilterSnapshot(
  overrides: Partial<TaskFilterSnapshot> = {}
): TaskFilterSnapshot {
  return {
    query: "",
    status: "all",
    priority: "all",
    assignee: "all",
    due: "all",
    label: "all",
    sort: "updated",
    view: "list",
    ...overrides
  };
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

function TaskMediaStrip({ media }: { media: Attachment[] }) {
  if (media.length === 0) return null;
  return (
    <span className={`board-card-media board-card-media-${Math.min(media.length, 4)}`}>
      {media.slice(0, 4).map((attachment) => {
        const contentType = attachment.detectedContentType ?? attachment.declaredContentType;
        const url = api.attachmentContentUrl(attachment.id);
        return contentType.startsWith("video/") ? (
          <video
            src={url}
            muted
            playsInline
            preload="metadata"
            aria-label={attachment.fileName}
            key={attachment.id}
          />
        ) : (
          <img src={url} alt={attachment.fileName} loading="lazy" key={attachment.id} />
        );
      })}
    </span>
  );
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

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function taskAssigneeIds(task: WorkItem): string[] {
  if (task.assignees && task.assignees.length > 0) {
    return task.assignees.map((assignee) => assignee.userId);
  }
  return task.assigneeId ? [task.assigneeId] : [];
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
