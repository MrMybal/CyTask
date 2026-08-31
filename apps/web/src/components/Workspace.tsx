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
  type LocalSyncStatus,
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
  type TaskLabelAssignment,
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
import { MigrationPane } from "./MigrationPane";
import { TaskPluginPanel } from "./TaskPluginPanel";
import { LanguageSwitcher, localizedStatusName, useI18n } from "../i18n";
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
  { organizationId: "", projectId: "", key: "todo", name: "To do", color: "#7C8B9A", position: 0, isSystem: true },
  { organizationId: "", projectId: "", key: "in_progress", name: "In progress", color: "#F2A93B", position: 1, isSystem: true },
  { organizationId: "", projectId: "", key: "blocked", name: "Blocked", color: "#FF5C6C", position: 2, isSystem: true },
  { organizationId: "", projectId: "", key: "done", name: "Done", color: "#61E6B5", position: 3, isSystem: true },
  { organizationId: "", projectId: "", key: "cancelled", name: "Cancelled", color: "#7B8491", position: 4, isSystem: true }
];

const priorityLabelKeys: Record<WorkItem["priority"], string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent"
};

const priorities: WorkItem["priority"][] = ["urgent", "high", "normal", "low"];

const gitPluginId = "dev.cytask.git";

type ThemeMode = "graphite" | "midnight" | "forest" | "cloud" | "paper" | "contrast";

interface ThemeOption {
  id: ThemeMode;
  label: string;
  description: string;
  preview: { background: string; surface: string; accent: string };
}

const themeOptions: ThemeOption[] = [
  { id: "graphite", label: "Graphite", description: "Neutral dark", preview: { background: "#11161c", surface: "#1a222b", accent: "#63b49b" } },
  { id: "midnight", label: "Midnight", description: "Deep navy", preview: { background: "#0d1520", surface: "#162334", accent: "#78a6d8" } },
  { id: "forest", label: "Forest", description: "Muted green", preview: { background: "#111713", surface: "#1b251c", accent: "#83b17d" } },
  { id: "cloud", label: "Cloud", description: "Cool light", preview: { background: "#e7ebef", surface: "#f7f8f9", accent: "#23745e" } },
  { id: "paper", label: "Paper", description: "Warm light", preview: { background: "#ece9e2", surface: "#f8f5ef", accent: "#7b6042" } },
  { id: "contrast", label: "High contrast", description: "Maximum readability", preview: { background: "#07090c", surface: "#141a21", accent: "#f3c85b" } }
];

const lightThemeModes = new Set<ThemeMode>(["cloud", "paper"]);

function storedThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem("cytask.theme");
  if (stored === "light") return "cloud";
  if (stored === "dark") return "graphite";
  return themeOptions.some((theme) => theme.id === stored) ? stored as ThemeMode : "graphite";
}

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
type WorkspaceArea = "tasks" | "contents" | "chat" | "plugins" | "migration";
type DetailBundle = [
  TaskDetails,
  Attachment[],
  AttachmentUpload[],
  ExternalReference[],
  TaskDependencyOverview,
  TaskPlugin[]
];

export function Workspace({ session, onLogout }: WorkspaceProps) {
  const { locale, t } = useI18n();
  const priorityLabels = useMemo(() => Object.fromEntries(
    Object.entries(priorityLabelKeys).map(([key, label]) => [key, t(label)])
  ) as Record<WorkItem["priority"], string>, [t]);
  const relativeDate = useCallback((value: string) => formatRelativeDate(value, locale), [locale]);
  const fullDate = useCallback((value: string) => formatFullDate(value, locale), [locale]);
  const shortDate = useCallback((value: string) => formatShortDate(value, locale), [locale]);
  const [localSync, setLocalSync] = useState<LocalSyncStatus>();
  const [localSyncFlushing, setLocalSyncFlushing] = useState(false);
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
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [showInlineFolderForm, setShowInlineFolderForm] = useState(false);
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
  const [copyLabel, setCopyLabel] = useState("Copy link");
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
  const [taskLinkLabel, setTaskLinkLabel] = useState("Copy link");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.localStorage.getItem("cytask.sidebarCollapsed") === "true"
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workspaceArea, setWorkspaceArea] = useState<WorkspaceArea>("tasks");
  const [showTokens, setShowTokens] = useState(false);
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>("project");
  const [themeMode, setThemeMode] = useState<ThemeMode>(storedThemeMode);
  const themeTone = lightThemeModes.has(themeMode) ? "light" : "dark";
  const [folderEditorParentId, setFolderEditorParentId] =
    useState<string | null | undefined>();
  const taskRequestSequence = useRef(0);
  const taskSupportRequestSequence = useRef(0);
  const detailRequestSequence = useRef(0);
  const taskFilterInput = useRef<HTMLInputElement>(null);
  const detailPrefetch = useRef(new Map<string, { at: number; load: Promise<DetailBundle> }>());

  useEffect(() => {
    let active = true;
    const refresh = () => api.localSyncStatus()
      .then((status) => { if (active) setLocalSync(status); })
      .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function flushLocalSync() {
    setLocalSyncFlushing(true);
    try { setLocalSync(await api.flushLocalSync()); }
    catch { setError(t("Unable to save the local folder.")); }
    finally { setLocalSyncFlushing(false); }
  }
  const canAdminister = session.role === "owner" || session.role === "admin";
  const canContribute = session.role !== "viewer";

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );
  const statusLabels = useMemo(() => Object.fromEntries(
    projectStatuses.map((status) => [status.key, status.isSystem
      ? localizedStatusName(locale, status.key, status.name)
      : status.name])
  ) as Record<string, string>, [locale, projectStatuses]);
  const boardStatuses = useMemo(() => projectStatuses.map((status) => status.key), [projectStatuses]);
  const statusColors = useMemo(() => Object.fromEntries(
    projectStatuses.map((status) => [status.key, status.color])
  ) as Record<string, string>, [locale, projectStatuses]);
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
    ? (selectedFolder ? t("Contents") + " · " + selectedFolder.name : t("Workspace contents"))
    : workspaceArea === "chat"
      ? t("Team chat")
      : workspaceArea === "plugins" ? t("Project plugins")
        : workspaceArea === "migration" ? t("Migration tool") : undefined;
  const workspaceTitle = selectedFolder?.name ?? (sidebarSection === "project"
    ? selectedProject?.name
    : {
        inbox: t("Inbox"),
        mine: t("My tasks"),
        today: t("Today"),
        later: t("Later"),
        completed: t("Completed")
      }[sidebarSection]);
  const taskViewsStorageKey = selectedProjectId
    ? savedTaskViewsStorageKey(session.organizationId, session.userId, selectedProjectId)
    : undefined;
  const taskViewPresets = useMemo<TaskViewDefinition[]>(() => [
    {
      id: "preset:mine",
      name: t("My tasks"),
      filters: createTaskFilterSnapshot({ assignee: session.userId, sort: "due" })
    },
    {
      id: "preset:overdue",
      name: t("Overdue"),
      filters: createTaskFilterSnapshot({ due: "overdue", sort: "due" })
    },
    {
      id: "preset:blocked",
      name: t("Blocked"),
      filters: createTaskFilterSnapshot({ status: "blocked", view: "board" })
    },
    {
      id: "preset:unassigned",
      name: t("Unassigned"),
      filters: createTaskFilterSnapshot({ assignee: "unassigned", sort: "created" })
    }
  ], [session.userId, t]);

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
      taskLabels.sort((left, right) => left.name.localeCompare(right.name, locale));
    }
    return result;
  }, [locale, projectLabels]);
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
      children.sort((left, right) => left.key.localeCompare(right.key, locale, { numeric: true }));
    }
    return { parentsByTask, childrenByParent };
  }, [locale, taskHierarchy.relations, taskOptions]);
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
    loadProjects().catch(() => setError(t("Unable to load projects.")));
  }, [loadProjects]);

  useEffect(() => {
    loadMembers().catch(() => setError(t("Unable to load team members.")));
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
        .catch(() => setError(t("Unable to load project information.")));
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
        .catch(() => setError(t("Unable to load tasks.")));
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
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLocaleLowerCase(locale) === "k") {
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
      } else if (event.key.toLocaleLowerCase(locale) === "n" && selectedProjectId && canContribute) {
        event.preventDefault();
        setShowTaskForm(true);
      } else if (event.key.toLocaleLowerCase(locale) === "b") {
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
      setTaskLinkLabel("Copy link");
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
      notify("error", t("The browser cannot save this view."));
      return false;
    }
  }

  function taskViewNameIsAvailable(name: string, excludedId?: string) {
    const normalized = name.trim().toLocaleLowerCase(locale);
    return !savedTaskViews.some((view) =>
      view.id !== excludedId && view.name.toLocaleLowerCase(locale) === normalized
    );
  }

  function saveTaskView(name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40) {
      notify("error", t("The view name must contain between 1 and 40 characters."));
      return false;
    }
    if (!taskViewNameIsAvailable(trimmed)) {
      notify("error", t("A view already has this name in the project."));
      return false;
    }
    if (savedTaskViews.length >= 20) {
      notify("error", t("This project already has the maximum of 20 personal views."));
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
    notify("success", t("View “{name}” saved.", { name: view.name }));
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
      notify("success", t("View “{name}” updated.", { name: active.name }));
    }
  }

  function renameActiveTaskView(name: string) {
    const active = savedTaskViews.find((view) => view.id === activeTaskViewId);
    const trimmed = name.trim();
    if (!active || !trimmed || trimmed.length > 40) {
      notify("error", t("The view name must contain between 1 and 40 characters."));
      return false;
    }
    if (!taskViewNameIsAvailable(trimmed, active.id)) {
      notify("error", t("A view already has this name in the project."));
      return false;
    }
    const nextViews = savedTaskViews.map((view) =>
      view.id === active.id
        ? { ...view, name: trimmed, updatedAt: new Date().toISOString() }
        : view
    );
    if (!persistSavedTaskViews(nextViews)) return false;
    notify("success", t("View renamed to “{name}”.", { name: trimmed }));
    return true;
  }

  function deleteActiveTaskView() {
    const active = savedTaskViews.find((view) => view.id === activeTaskViewId);
    if (!active) return;
    const nextViews = savedTaskViews.filter((view) => view.id !== active.id);
    if (!persistSavedTaskViews(nextViews)) return;
    setActiveTaskViewId(undefined);
    notify("success", t("View “{name}” deleted.", { name: active.name }));
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
      if (selectedFolder) await api.addTaskLabel(task.id, selectedFolder.id);
      form.reset();
      setShowTaskForm(false);
      notify("success", t("{key} created.", { key: task.key }));
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
      if (selectedFolder) await api.addTaskLabel(task.id, selectedFolder.id);
      await loadTasks(selectedProjectId);
      notify("success", t("{key} created.", { key: task.key }));
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
      notify("success", t("Checklist item added."));
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
        ? t("The checklist changed. Its latest version has been reloaded.")
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
    if (!window.confirm(t("Remove “{title}” from the checklist?", { title: item.title }))) return;
    const taskId = details.task.id;
    const projectId = details.task.projectId;
    setError("");
    setPendingChecklistItemIds((current) => new Set(current).add(item.id));
    try {
      await api.deleteChecklistItem(taskId, item.id, item.revision);
      notify("success", t("Checklist item removed."));
      await Promise.all([loadDetails(taskId), loadTasks(projectId)]);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        await loadDetails(taskId).catch(() => undefined);
        setError(t("The checklist changed. Its latest version has been reloaded."));
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
      notify("success", t("New status added to the project."));
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
      notify("success", t("Status “{name}” updated.", { name: updated.name }));
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
      notify("success", t("Label “{name}” created and assigned.", { name: label.name }));
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
      setShowInlineFolderForm(false);
      await loadTaskSupport(selectedProjectId);
      notify(
        "success",
        parentLabelId
          ? t("Subfolder “{name}” created.", { name: folder.name })
          : t("Folder “{name}” created.", { name: folder.name })
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
      notify("success", t("Label “{name}” removed from project.", { name: label.name }));
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
      notify("success", t("Parent task updated."));
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
      notify("success", t("The task is now at the project root."));
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
      notify("success", t("Subtask “{name}” created.", { name: subtask.title }));
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
        setError(t("This task changed while you were editing. The latest version has been reloaded."));
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
        ? t("This task was changed elsewhere. Its current status has been reloaded.")
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
        ? t("{count} assignees assigned.", { count: assigneeIds.length })
        : assigneeIds.length === 1 ? t("Assignee assigned.") : t("Assignees removed."));
    } catch (reason) {
      if (selectedTaskId === task.id) await loadDetails(task.id).catch(() => undefined);
      setError(reason instanceof ApiError && reason.status === 409
        ? t("This task was changed elsewhere. Its latest version has been reloaded.")
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
        ? t("This task was changed elsewhere. Its latest version has been reloaded.")
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
    changes: Partial<Pick<WorkItem, "status" | "priority" | "dueAt">> & { assigneeIds?: string[] }
  ): Promise<boolean> {
    if (!canContribute) return false;
    const eligible = selectedTasks.filter((task) =>
      !pendingTaskIds.has(task.id)
      && ((changes.status !== undefined && changes.status !== task.status)
        || (changes.priority !== undefined && changes.priority !== task.priority)
        || (changes.dueAt !== undefined && changes.dueAt !== task.dueAt)
        || (changes.assigneeIds !== undefined
          && !sameIdSet(taskAssigneeIds(task), changes.assigneeIds)))
    );
    if (eligible.length === 0) return true;

    const eligibleIds = new Set(eligible.map((task) => task.id));
    const originalById = new Map(eligible.map((task) => [task.id, task]));
    const membersById = new Map(members.map((member) => [member.userId, member]));
    const optimisticById = new Map<string, WorkItem>(eligible.map((task) => {
      if (changes.assigneeIds === undefined) {
        return [task.id, {
          ...task,
          status: changes.status ?? task.status,
          priority: changes.priority ?? task.priority,
          dueAt: changes.dueAt === undefined ? task.dueAt : changes.dueAt
        }];
      }
      const assignees = changes.assigneeIds.flatMap((userId) => {
        const member = membersById.get(userId);
        return member ? [{ userId, displayName: member.displayName }] : [];
      });
      return [task.id, {
        ...task,
        status: changes.status ?? task.status,
        priority: changes.priority ?? task.priority,
        dueAt: changes.dueAt === undefined ? task.dueAt : changes.dueAt,
        assigneeId: assignees[0]?.userId ?? null,
        assigneeName: assignees[0]?.displayName ?? null,
        assignees
      }];
    }));
    setError("");
    setPendingTaskIds((current) => new Set([...current, ...eligibleIds]));
    setTasks((current) => current.map((task) => optimisticById.get(task.id) ?? task));
    setDetails((current) => {
      if (!current) return current;
      const optimistic = optimisticById.get(current.task.id);
      return optimistic ? { ...current, task: optimistic } : current;
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
            assigneeIds: changes.assigneeIds ?? taskAssigneeIds(optimistic),
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
        notify("success", t("{count} task(s) updated.", { count: eligible.length }));
        return true;
      }
      notify(
        "error",
        t("{updated} task(s) updated, {failed} in conflict or error.", { updated: updatedTasks.length, failed: failures.length })
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

  async function changeTaskLabelsBulk(
    selectedTasks: WorkItem[],
    labelId: string,
    shouldAssign: boolean
  ): Promise<boolean> {
    if (!canContribute) return false;
    const currentlyAssigned = new Set(
      projectLabels.assignments
        .filter((assignment) => assignment.labelId === labelId)
        .map((assignment) => assignment.taskId)
    );
    const eligible = selectedTasks.filter((task) =>
      !pendingTaskIds.has(task.id)
      && (shouldAssign ? !currentlyAssigned.has(task.id) : currentlyAssigned.has(task.id))
    );
    if (eligible.length === 0) return true;

    const eligibleIds = new Set(eligible.map((task) => task.id));
    const createdAssignments: TaskLabelAssignment[] = [];
    const successfulIds = new Set<string>();
    const failures: unknown[] = [];
    let cursor = 0;
    setError("");
    setPendingTaskIds((current) => new Set([...current, ...eligibleIds]));

    async function worker() {
      while (cursor < eligible.length) {
        const task = eligible[cursor++];
        if (!task) return;
        try {
          if (shouldAssign) {
            createdAssignments.push(await api.addTaskLabel(task.id, labelId));
          } else {
            await api.removeTaskLabel(task.id, labelId);
          }
          successfulIds.add(task.id);
        } catch (reason) {
          failures.push(reason);
        }
      }
    }

    try {
      await Promise.all(Array.from(
        { length: Math.min(4, eligible.length) },
        () => worker()
      ));
      setProjectLabels((current) => shouldAssign
        ? {
          ...current,
          assignments: [
            ...current.assignments,
            ...createdAssignments.filter((assignment) =>
              !current.assignments.some((candidate) =>
                candidate.taskId === assignment.taskId && candidate.labelId === assignment.labelId
              )
            )
          ]
        }
        : {
          ...current,
          assignments: current.assignments.filter((assignment) =>
            assignment.labelId !== labelId || !successfulIds.has(assignment.taskId)
          )
        });

      const projectId = selectedProjectId ?? eligible[0]?.projectId;
      if (projectId) await loadTasks(projectId).catch(() => undefined);
      if (failures.length === 0) {
        notify(
          "success",
          t(shouldAssign ? "{count} task(s) added to the folder/label." : "{count} task(s) removed from the folder/label.", { count: eligible.length })
        );
        return true;
      }
      notify(
        "error",
        t("{processed} task(s) processed, {failed} failed.", { processed: successfulIds.size, failed: failures.length })
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
      setCopyLabel("Copy link");
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
          t("Resuming {name} at {percent}%.", { name: file.name, percent: Math.round((receivedBytes / file.size) * 100) })
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
        throw new ApiError(t("The resume session contains inconsistent chunks."), 409);
      }

      if (sent > 0) {
        setUploadProgress({
          label: t("Resuming at {sent} / {total}", { sent: formatBytes(sent), total: formatBytes(file.size) }),
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

      setUploadProgress({ label: t("Server verification…"), percent: 100 });
      await api.completeAttachmentUpload(upload.id);
      notify("success", t("{name} uploaded; scanning in progress.", { name: file.name }));
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
    setTaskLinkLabel("Copy link");
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
    setTaskLinkLabel("Copy link");
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
      setTaskLinkLabel("Link copied");
      notify("success", t("Task link copied."));
    } catch {
      setTaskLinkLabel("Copy failed");
    }
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(invitationLink);
      setCopyLabel("Link copied");
    } catch {
      setCopyLabel("Select the link");
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
        label: t("New task"),
        hint: "N",
        keywords: "create add task créer ajouter tâche",
        run: () => setShowTaskForm(true)
      });
    }
    actions.push(
      {
        id: "toggle-view",
        label: t(taskView === "list" ? "Switch to Kanban view" : "Switch to List view"),
        keywords: "kanban liste board vue",
        run: () => setTaskView((value) => value === "list" ? "board" : "list")
      },
      {
        id: "team",
        label: t("Open team"),
        keywords: "membres inviter equipe",
        run: () => void openTeam()
      },
      {
        id: "activity",
        label: t("Open activity log"),
        keywords: "historique audit",
        run: () => void openActivity()
      },
      {
        id: "tokens",
        label: t("Manage API tokens"),
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
        label: t(sidebarCollapsed ? "Show sidebar" : "Hide sidebar"),
        hint: "B",
        keywords: "sidebar navigation",
        run: () => setSidebarCollapsed((value) => !value)
      }
    );
    if (canAdminister) {
      actions.push({
        id: "new-project",
        label: t("Create project"),
        keywords: "projet nouveau",
        run: () => setShowProjectForm(true)
      });
    }
    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdminister, canContribute, selectedProjectId, sidebarCollapsed, taskView]);

  return (
    <div className={`workspace-shell theme-${themeTone} theme-${themeMode}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <a className="brand compact" href="/" aria-label={t("CyTask home")}>
            <span className="brand-mark"><img src="/icons/cytask.png" alt="" /></span>
            <span>CyTask</span>
          </a>
          {canAdminister && (
            <button className="icon-button" title={t("Create project")} onClick={() => setShowProjectForm((value) => !value)}>+</button>
          )}
        </div>

        {showProjectForm && (
          <form className="inline-form" onSubmit={createProject}>
            <input name="name" placeholder={t("Project name")} maxLength={120} required autoFocus />
            <input name="key" placeholder={t("Key · CY")} minLength={2} maxLength={10} required />
            <button type="submit">{t("Create")}</button>
          </form>
        )}

        <div className="sidebar-scroll">
          <nav className="sidebar-home" aria-label={t("Home")}>
            <p className="nav-label">{t("Home")}</p>
            <button
              className={sidebarSection === "inbox" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title={t("Inbox")}
              onClick={() => selectSidebarSection("inbox")}
            >
              <span className="sidebar-nav-icon">▣</span>
              <span className="sidebar-nav-copy">{t("Inbox")}</span>
              <span className="nav-count">{taskCounts.todo}</span>
            </button>
            <button
              className={sidebarSection === "mine" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title={t("My tasks")}
              onClick={() => selectSidebarSection("mine")}
            >
              <span className="sidebar-nav-icon">◎</span>
              <span className="sidebar-nav-copy">{t("My tasks")}</span>
            </button>
            <button
              className={sidebarSection === "today" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title={t("Today")}
              onClick={() => selectSidebarSection("today")}
            >
              <span className="sidebar-nav-icon">◷</span>
              <span className="sidebar-nav-copy">{t("Today")}</span>
            </button>
            <button
              className={sidebarSection === "later" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title={t("Later")}
              onClick={() => selectSidebarSection("later")}
            >
              <span className="sidebar-nav-icon">↗</span>
              <span className="sidebar-nav-copy">{t("Later")}</span>
            </button>
            <button
              className={sidebarSection === "completed" ? "sidebar-nav-link active" : "sidebar-nav-link"}
              type="button"
              title={t("Completed")}
              onClick={() => selectSidebarSection("completed")}
            >
              <span className="sidebar-nav-icon">✓</span>
              <span className="sidebar-nav-copy">{t("Completed")}</span>
              <span className="nav-count">{taskCounts.done}</span>
            </button>
          </nav>

          <nav className="project-list" aria-label={`${t("Spaces")} · ${t("Folders")}`}>
            <p className="nav-label">{t("Spaces")}</p>
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
                        <span>◇</span><span>{t("Contents")} &amp; {t("Files").toLocaleLowerCase(locale)}</span>
                      </button>
                      <button className={workspaceArea === "chat" ? "active" : ""} type="button"
                        onClick={() => {
                          closeTask(); setShowTeam(false); setShowActivity(false); setShowTokens(false);
                          setWorkspaceArea("chat"); setSidebarSection("project");
                        }}>
                        <span>#</span><span>{t("Team chat")}</span>
                      </button>
                      <button className={workspaceArea === "plugins" ? "active" : ""} type="button"
                        onClick={() => {
                          closeTask(); setShowTeam(false); setShowActivity(false); setShowTokens(false);
                          setWorkspaceArea("plugins"); setSidebarSection("project");
                        }}>
                        <span>＋</span><span>Plugins</span>
                      </button>
                      {canAdminister && (
                        <button className={workspaceArea === "migration" ? "active" : ""} type="button"
                          onClick={() => {
                            closeTask(); setShowTeam(false); setShowActivity(false); setShowTokens(false);
                            setWorkspaceArea("migration"); setSidebarSection("project");
                          }}>
                          <span>↥</span><span>{t("Migration")}</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
            {projects.length === 0 && <p className="empty-note">{t("Create your first project.")}</p>}
          </nav>
        </div>

        <button
          className={`team-link workspace-settings-trigger${localSync?.conflictCount ? " has-conflicts" : ""}`}
          type="button"
          title={t("Settings and tools")}
          onClick={() => setShowWorkspaceSettings(true)}
        >
          <span className="project-avatar">⚙</span>
          <span>{t("Settings and tools")}</span>
          {localSync?.conflictCount ? <strong>{localSync.conflictCount}</strong> : null}
        </button>
        <div className="profile-block">
          <span className="profile-avatar">{initials(session.displayName)}</span>
          <span className="profile-copy">
            <strong>{session.displayName}</strong>
            <small>{session.role}</small>
          </span>
          <button className="text-button" onClick={logout}>{t("Log out")}</button>
        </div>
      </aside>

      {showWorkspaceSettings && (
        <div className="workspace-settings-backdrop">
          <button
            className="workspace-settings-scrim"
            type="button"
            aria-label={t("Close settings")}
            onClick={() => setShowWorkspaceSettings(false)}
          />
          <section className="workspace-settings" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title">
            <header>
              <div>
                <p className="eyebrow">{t("Workspace")}</p>
                <h2 id="workspace-settings-title">{t("Settings and tools")}</h2>
              </div>
              <button className="icon-button quiet" type="button" aria-label={t("Close")} onClick={() => setShowWorkspaceSettings(false)}>×</button>
            </header>

            <div className="workspace-settings-grid">
              {localSync?.enabled && (
                <button
                  className={`workspace-settings-option wide${localSync.conflictCount > 0 ? " has-conflicts" : ""}`}
                  type="button"
                  disabled={localSyncFlushing}
                  onClick={() => void flushLocalSync()}
                >
                  <span className="project-avatar">{localSync.conflictCount > 0 ? "!" : "↻"}</span>
                  <span><strong>{localSyncFlushing ? t("Saving…") : t("Local sync")}</strong><small>{localSync.message ?? t("Local · Synced")}</small></span>
                  <em>{t("{count} snapshot(s)", { count: localSync.snapshotCount ?? 0 })}</em>
                </button>
              )}
              <button className="workspace-settings-option" type="button" onClick={() => { setShowWorkspaceSettings(false); void openTeam(); }}>
                <span className="project-avatar">EQ</span><span><strong>{t("Team")}</strong><small>{t("Members and invitations")}</small></span>
              </button>
              <button className="workspace-settings-option" type="button" onClick={() => { setShowWorkspaceSettings(false); void openActivity(); }}>
                <span className="project-avatar">AC</span><span><strong>{t("Activity")}</strong><small>{t("Workspace history")}</small></span>
              </button>
              <button className="workspace-settings-option" type="button" onClick={() => {
                setShowWorkspaceSettings(false); closeTask(); setShowTeam(false); setShowActivity(false); setShowTokens(true);
              }}>
                <span className="project-avatar">AP</span><span><strong>{t("API")}</strong><small>{t("API tokens")}</small></span>
              </button>
            </div>

            <section className="workspace-settings-section theme-setting">
              <div className="theme-setting-copy"><h3>{t("Appearance")}</h3><small>{t("Choose the interface theme.")}</small></div>
              <div className="theme-picker" role="radiogroup" aria-label={t("Color theme")}>
                {themeOptions.map((theme) => (
                  <button
                    className={themeMode === theme.id ? "theme-option active" : "theme-option"}
                    type="button"
                    role="radio"
                    aria-checked={themeMode === theme.id}
                    key={theme.id}
                    onClick={() => setThemeMode(theme.id)}
                    style={{
                      "--theme-preview-bg": theme.preview.background,
                      "--theme-preview-surface": theme.preview.surface,
                      "--theme-preview-accent": theme.preview.accent
                    } as CSSProperties}
                  >
                    <span className="theme-preview" aria-hidden="true"><i /><i /><i /></span>
                    <span className="theme-option-copy"><strong>{t(theme.label)}</strong><small>{t(theme.description)}</small></span>
                    <span className="theme-option-check" aria-hidden="true">✓</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="workspace-settings-section language-setting">
              <div><h3>{t("Language")}</h3><small>{t("Interface language")}</small></div>
              <LanguageSwitcher />
            </section>
          </section>
        </div>
      )}

      <main className="task-pane">
        <header className="pane-header">
          <div>
            <p className="eyebrow">{selectedProject?.key ?? t("WORKSPACE")}</p>
            <h1>{workspaceAreaTitle ?? workspaceTitle ?? t("Welcome to CyTask")}</h1>
            {selectedProject && workspaceArea === "tasks" && (
              <p className="project-summary">
                {t("{shown} shown out of {total} tasks · {progress} in progress", { shown: taskTotalCount, total: taskOptions.length, progress: taskCounts.in_progress ?? 0 })}
              </p>
            )}
          </div>
          <div className="pane-actions">
            <button
              className="icon-button sidebar-toggle"
              type="button"
              aria-label={t(sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")}
              aria-pressed={sidebarCollapsed}
              title={t(sidebarCollapsed ? "Show navigation (B)" : "Expand workspace (B)")}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >{sidebarCollapsed ? "›" : "‹"}</button>
            <button
              className="palette-trigger"
              type="button"
              title={t("Command palette (Ctrl+K)")}
              onClick={() => setPaletteOpen(true)}
            >
              <span aria-hidden="true">⌘</span> {t("Commands")} <kbd>Ctrl K</kbd>
            </button>
            <form className="workspace-search" role="search" onSubmit={search}>
              <input name="query" aria-label={t("Search")} placeholder={t("Search…")} minLength={2} maxLength={100} required />
              <button type="submit" aria-label={t("Run search")}>⌕</button>
            </form>
            {selectedProject && canContribute && workspaceArea === "tasks" && (
              <button
                className="primary-button small"
                title={t("New task (N)")}
                onClick={() => setShowTaskForm((value) => !value)}
              >{t("New task")} <kbd>N</kbd></button>
            )}
          </div>
        </header>

        {showTaskForm && selectedProject && workspaceArea === "tasks" && (
          <form className="task-form" onSubmit={createTask}>
            <input name="title" placeholder={t("What needs to be done?")} maxLength={240} required autoFocus />
            <textarea name="description" placeholder={t("Optional description")} maxLength={20000} rows={3} />
            <div className="task-planning-fields">
              <label>
                {t("Priority")}
                <select name="priority" defaultValue="normal">
                  {priorities.map((priority) => (
                    <option value={priority} key={priority}>{priorityLabels[priority]}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("Due date")}
                <input name="dueAt" type="datetime-local" />
              </label>
              <label>
                {t("Assignees")}
                <select name="assigneeId" defaultValue="">
                  <option value="">{t("Nobody")}</option>
                  {members.map((member) => (
                    <option value={member.userId} key={member.userId}>{member.displayName}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <button className="primary-button small" type="submit">{t("Create task")}</button>
              <button className="text-button" type="button" onClick={() => setShowTaskForm(false)}>{t("Cancel")}</button>
            </div>
          </form>
        )}

        {workspaceArea === "migration" && selectedProject ? (
          <MigrationPane
            projectId={selectedProject.id}
            statuses={projectStatuses}
            members={members}
            onImported={() => loadTasks(selectedProject.id)}
            onError={setError}
            onNotice={(message) => notify("success", message)}
          />
        ) : workspaceArea === "plugins" && selectedProject ? (
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
          <section className="search-results" aria-label={t("Search results")}>
            <div className="search-title">
              <h2>{t("Results")}</h2>
              <button className="text-button" onClick={() => setSearchHits(undefined)}>{t("Close search")}</button>
            </div>
            {searchHits.map((hit) => (
              <button className="search-hit" key={`${hit.type}-${hit.id}`} onClick={() => openSearchHit(hit)}>
                <span className="project-avatar">{hit.type === "task" ? "TA" : "PR"}</span>
                <span className="search-hit-copy">
                  <strong>{hit.title}</strong>
                  <small>{hit.key} · {hit.excerpt || t("No description")}</small>
                </span>
                <time dateTime={hit.updatedAt}>{relativeDate(hit.updatedAt)}</time>
              </button>
            ))}
            {searchHits.length === 0 && <p className="empty-list">{t("No results in this workspace.")}</p>}
          </section>
        ) : !selectedProject ? (
          <section className="empty-state">
            <span className="empty-symbol">↗</span>
            <h2>{t("Start with a project")}</h2>
            <p>{t("A project brings together tasks, media and Git references.")}</p>
            {canAdminister && (
              <button className="primary-button" onClick={() => setShowProjectForm(true)}>{t("Create project")}</button>
            )}
          </section>
        ) : (
          <>
            <section className="task-command" aria-label={t("Task controls")}>
              <div className="task-metrics" aria-label={t("Status summary")}>
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
                  <strong>{tasks.length}</strong><span>{t("Total")}</span>
                </button>
                <button
                  className={taskStatusFilter === "in_progress" ? "task-metric active" : "task-metric"}
                  type="button"
                  aria-pressed={taskStatusFilter === "in_progress"}
                  onClick={() => setTaskStatusFilter("in_progress")}
                >
                  <strong>{taskCounts.in_progress}</strong><span>{t("In progress")}</span>
                </button>
                <button
                  className={taskStatusFilter === "blocked" ? "task-metric active warning" : "task-metric warning"}
                  type="button"
                  aria-pressed={taskStatusFilter === "blocked"}
                  onClick={() => setTaskStatusFilter("blocked")}
                >
                  <strong>{taskCounts.blocked}</strong><span>{t("Blocked")}</span>
                </button>
                <button
                  className={taskStatusFilter === "done" ? "task-metric active success" : "task-metric success"}
                  type="button"
                  aria-pressed={taskStatusFilter === "done"}
                  onClick={() => setTaskStatusFilter("done")}
                >
                  <strong>{taskCounts.done}</strong><span>{t("Done")}</span>
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
                  <span className="sr-only">{t("Filter tasks")}</span>
                  <input
                    ref={taskFilterInput}
                    type="search"
                    maxLength={240}
                    value={taskQuery}
                    onChange={(event) => setTaskQuery(event.currentTarget.value)}
                    placeholder={t("Search by title or key…")}
                  />
                </label>
                <select
                  className="task-status-filter"
                  aria-label={t("Filter by status")}
                  value={taskStatusFilter}
                  onChange={(event) => setTaskStatusFilter(event.currentTarget.value as TaskStatusFilter)}
                >
                  <option value="all">{t("All statuses")}</option>
                  {boardStatuses.map((status) => (
                    <option value={status} key={status}>{statusLabels[status]} · {taskCounts[status]}</option>
                  ))}
                </select>
                <select
                  className="task-priority-filter"
                  aria-label={t("Filter by priority")}
                  value={taskPriorityFilter}
                  onChange={(event) => setTaskPriorityFilter(event.currentTarget.value as TaskPriorityFilter)}
                >
                  <option value="all">{t("All priorities")}</option>
                  {priorities.map((priority) => (
                    <option value={priority} key={priority}>{priorityLabels[priority]}</option>
                  ))}
                </select>
                <select
                  className="task-assignee-filter"
                  aria-label={t("Filter by assignee")}
                  value={taskAssigneeFilter}
                  onChange={(event) => setTaskAssigneeFilter(event.currentTarget.value)}
                >
                  <option value="all">{t("All people")}</option>
                  <option value="unassigned">{t("Unassigned")}</option>
                  {members.map((member) => (
                    <option value={member.userId} key={member.userId}>{member.displayName}</option>
                  ))}
                </select>
                <select
                  className="task-due-filter"
                  aria-label={t("Filter by due date")}
                  value={taskDueFilter}
                  onChange={(event) => setTaskDueFilter(event.currentTarget.value as TaskDueFilter)}
                >
                  <option value="all">{t("All due dates")}</option>
                  <option value="overdue">{t("Overdue")}</option>
                  <option value="today">{t("Due today")}</option>
                  <option value="week">{t("Next 7 days")}</option>
                  <option value="none">{t("No due date")}</option>
                </select>
                <select
                  className="task-label-filter"
                  aria-label={t("Filter by label")}
                  value={taskLabelFilter}
                  onChange={(event) => setTaskLabelFilter(event.currentTarget.value)}
                >
                  <option value="all">{t("All labels")}</option>
                  <option value="none">{t("No label")}</option>
                  {projectLabels.labels.map((label) => (
                    <option value={label.id} key={label.id}>{label.name}</option>
                  ))}
                </select>
                <select
                  className="task-sort"
                  aria-label={t("Sort tasks")}
                  value={taskSort}
                  onChange={(event) => setTaskSort(event.currentTarget.value as TaskSort)}
                >
                  <option value="updated">{t("Last activity")}</option>
                  <option value="created">{t("Recently created")}</option>
                  <option value="due">{t("Upcoming due date")}</option>
                  <option value="key">{t("Task key")}</option>
                  <option value="title">{t("Title A–Z")}</option>
                </select>
                <div className="view-switch" role="group" aria-label={t("Task presentation")}>
                  <button
                    className={taskView === "list" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "list"}
                    onClick={() => setTaskView("list")}
                  >{t("List")}</button>
                  <button
                    className={taskView === "compact" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "compact"}
                    onClick={() => setTaskView("compact")}
                  >{t("Compact")}</button>
                  <button
                    className={taskView === "board" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "board"}
                    onClick={() => setTaskView("board")}
                  >{t("Kanban")}</button>
                  <button
                    className={taskView === "canvas" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "canvas"}
                    onClick={() => setTaskView("canvas")}
                  >{t("Canvas")}</button>
                  <button
                    className={taskView === "graph" ? "active" : ""}
                    type="button"
                    aria-pressed={taskView === "graph"}
                    onClick={() => setTaskView("graph")}
                  >{t("Graph")}</button>
                </div>
              </div>
            </section>

            {canContribute && (
              <section className="task-context-create" aria-label={t("Create in the current view")}>
                <form className="context-task-form" onSubmit={quickAddTask}>
                  <input
                    name="title"
                    maxLength={240}
                    autoComplete="off"
                    placeholder={t("Add a task to {name}…", { name: selectedFolder?.name ?? t("Project root") })}
                    aria-label={t("Quickly add a task")}
                    required
                  />
                  <button className="primary-button small" type="submit">+ {t("Task")}</button>
                </form>
                <button
                  className="secondary-button small context-group-trigger"
                  type="button"
                  aria-expanded={showInlineFolderForm}
                  onClick={() => setShowInlineFolderForm((value) => !value)}
                >+ {t("Group")}</button>
                {showInlineFolderForm && (
                  <form className="context-group-form" onSubmit={createProjectFolder}>
                    <input name="parentLabelId" type="hidden" value={selectedFolder?.id ?? ""} />
                    <input name="color" type="color" defaultValue={selectedFolder?.color ?? "#3B82F6"} aria-label={t("Folder color")} />
                    <input name="name" maxLength={80} placeholder={t("Group name")} aria-label={t("Group name")} autoFocus required />
                    <button className="primary-button small" type="submit">{t("Create")}</button>
                    <button className="text-button" type="button" onClick={() => setShowInlineFolderForm(false)}>{t("Cancel")}</button>
                  </form>
                )}
              </section>
            )}
            {tasksLoading && <p className="task-loading" role="status">{t("Refreshing tasks…")}</p>}

            {tasksLoading && tasks.length === 0 ? (
              <div className="task-skeleton" aria-hidden="true">
                {Array.from({ length: taskView === "board" ? 4 : 6 }, (_, index) => (
                  <span key={index} />
                ))}
              </div>
            ) : !tasksLoading && tasks.length === 0 && taskOptions.length > 0 ? (
              <section className="filter-empty" aria-live="polite">
                <span aria-hidden="true">⌕</span>
                <h2>{t("No task found")}</h2>
                <p>{t("Change the search or reset this project’s filters.")}</p>
                <button className="text-button" type="button" onClick={resetTaskFilters}>{t("Reset filters")}</button>
              </section>
            ) : taskView === "compact" ? (
              <CompactTaskTable
                tasks={filteredTasks}
                labels={projectLabels.labels}
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
                onChangePriority={(task, priority) => void changeTaskInline(task, { priority }, t("Priority updated."))}
                onChangeDueAt={(task, dueAt) => void changeTaskInline(task, { dueAt }, t("Due date updated."))}
                onChangeAssignees={(task, assigneeIds) => void changeTaskAssignees(task, assigneeIds)}
                onBulkChange={changeTasksBulk}
                onBulkLabelChange={changeTaskLabelsBulk}
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
              <section className="task-list" aria-label={t("Tasks in list view")}>
                <div className="list-header"><span>{t("Task")}</span><span>{t("Status")}</span><span>{t("Updated")}</span></div>
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
                        {task.key} · {task.assigneeName ?? t("Unassigned")} · {task.dueAt ? t("Due {date}", { date: shortDate(task.dueAt) }) : t("No due date")}
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
                    ? t("No tasks in this project yet.")
                    : t("No tasks match these filters.")}</p>
                )}
              </section>
            ) : (
              <section className="task-board" aria-label={t("Tasks in Kanban board")}>
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
                                aria-label={t("Quickly add a to-do task")}
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
                                    <span className="assignee-chip" title={t("Assigned to {name}", { name: task.assigneeName })}>
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
                                    aria-label={t("Move {key}", { key: task.key })}
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
                          {!tasksLoading && columnTasks.length === 0 && <p className="board-empty">{t("No task")}</p>}
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
                    setError(t("Unable to load the next page.")))}
                >{tasksLoadingMore ? t("Loading…") : t("Show more ({current}/{total})", { current: tasks.length, total: taskTotalCount })}</button>
              </div>
            )}
          </>
        )}
      </main>

      {showActivity && (
        <aside className="detail-pane activity-pane">
          <header className="detail-header">
            <span className="task-key">{t("ACTIVITY")}</span>
            <button className="icon-button quiet" aria-label={t("Close")} onClick={() => setShowActivity(false)}>×</button>
          </header>
          <div className="detail-content">
            <h2>{t("Recent activity")}</h2>
            <p className="description muted">{t("Important changes are recorded durably.")}</p>
            <section className="activity-list" aria-label={t("Activity log")}>
              {activity.map((entry) => (
                <article className="activity-row" key={entry.id}>
                  <span className="activity-dot" aria-hidden="true" />
                  <div>
                    <p>{entry.summary}</p>
                    <small>{entry.actorName} · <time dateTime={entry.createdAt}>{relativeDate(entry.createdAt)}</time></small>
                  </div>
                </article>
              ))}
              {activity.length === 0 && <p className="empty-list">{t("No activity yet.")}</p>}
            </section>
          </div>
        </aside>
      )}

      {showTeam && !showActivity && !showTokens && (
        <aside className="detail-pane team-pane">
          <header className="detail-header">
            <span className="task-key">{t("TEAM")}</span>
            <button className="icon-button quiet" aria-label={t("Close")} onClick={() => setShowTeam(false)}>×</button>
          </header>
          <div className="detail-content">
            <h2>{t("Workspace members")}</h2>
            <p className="description muted">{t("Permissions are checked by the server for every action.")}</p>

            <section className="member-list" aria-label={t("Members")}>
              {members.map((member) => (
                <article className="member-row" key={member.userId}>
                  <span className="profile-avatar">{initials(member.displayName)}</span>
                  <span className="member-copy">
                    <strong>{member.displayName}</strong>
                    <small>{member.email}</small>
                  </span>
                  <span className="role-badge">{t(roleLabel(member.role))}</span>
                </article>
              ))}
            </section>

            {canAdminister && (
              <section className="invite-section">
                <a className="export-link" href="/api/v1/export" download>
                  <span>{t("Export workspace")}</span>
                  <small>{t("Versioned JSON · data and members")}</small>
                </a>
                <h3>{t("Invite someone")}</h3>
                <form className="invite-form" onSubmit={createInvitation}>
                  <input name="email" type="email" placeholder="personne@studio.fr" maxLength={254} required />
                  <select name="role" defaultValue="member">
                    <option value="member">{t("Member")}</option>
                    <option value="viewer">{t("Viewer")}</option>
                    {session.role === "owner" && <option value="admin">{t("Administrator")}</option>}
                  </select>
                  <button className="primary-button small" type="submit">{t("Create invitation")}</button>
                </form>
                {invitationLink && (
                  <div className="invite-result" role="status">
                    <label>
                      {t("Link to share — shown only once")}
                      <input value={invitationLink} readOnly onFocus={(event) => event.currentTarget.select()} />
                    </label>
                    <button className="text-button" type="button" onClick={() => void copyInvitation()}>{t(copyLabel)}</button>
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
              <strong>{t("Drop into task")}</strong>
              <span>{t("Images, videos and other files will be uploaded securely.")}</span>
            </div>
          )}
          <header className="detail-header">
            <span className="task-key">{details.task.key}</span>
            <div className="detail-actions">
              <button className="text-button" type="button" onClick={() => void copyTaskLink()}>
                {t(taskLinkLabel)}
              </button>
              {canContribute && (
                <button className="text-button" onClick={() => {
                  setDetailTab("overview");
                  setIsEditing((value) => detailTab === "overview" ? !value : true);
                }}>
                  {t(isEditing ? "Cancel" : "Edit")}
                </button>
              )}
              <button className="icon-button quiet" aria-label={t("Close")} onClick={closeTask}>×</button>
            </div>
          </header>
          <div className="detail-content">
            <nav className="detail-tabs" role="tablist" aria-label={t("Task sections")}>
              <button
                className={detailTab === "overview" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "overview"}
                onClick={() => { setDetailTab("overview"); setIsEditing(false); }}
              >{t("Details")}</button>
              <button
                className={detailTab === "dependencies" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "dependencies"}
                onClick={() => { setDetailTab("dependencies"); setIsEditing(false); }}
              >{t("Relations")} <span>{dependencies.dependsOn.length + dependencies.blocking.length}</span></button>
              <button
                className={detailTab === "files" ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={detailTab === "files"}
                onClick={() => { setDetailTab("files"); setIsEditing(false); }}
              >{t("Files")} <span>{attachments.length}</span></button>
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
              >{t("Activity")} <span>{details.comments.length}</span></button>
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

            {detailsLoading && <p className="detail-loading" role="status">{t("Syncing…")}</p>}

            {detailTab === "overview" && (isEditing ? (
              <form className="edit-task-form" key={`${details.task.id}-${details.task.revision}`} onSubmit={updateTask}>
                <label className="edit-field-title">
                  {t("Title")}
                  <input name="title" defaultValue={details.task.title} maxLength={240} required autoFocus />
                </label>
                <label>
                  {t("Status")}
                  <select name="status" defaultValue={details.task.status}>
                    {projectStatuses.map((projectStatus) => (
                      <option
                        value={projectStatus.key}
                        key={projectStatus.key}
                        style={{ color: projectStatus.color }}
                      >● {statusLabels[projectStatus.key] ?? projectStatus.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Priority")}
                  <select name="priority" defaultValue={details.task.priority}>
                    {priorities.map((priority) => (
                      <option value={priority} key={priority}>{priorityLabels[priority]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Due date")}
                  <input
                    name="dueAt"
                    type="datetime-local"
                    defaultValue={isoToLocalDateTime(details.task.dueAt)}
                  />
                </label>
                <label className="edit-field-assignees">
                  {t("Assignees")}
                  <TaskAssigneePicker
                    key={`${details.task.id}-${details.task.revision}-edit-assignees`}
                    members={members}
                    initialSelectedIds={taskAssigneeIds(details.task)}
                    name="assigneeIds"
                  />
                </label>
                <label className="edit-field-description">
                  {t("Description")}
                  <textarea name="description" defaultValue={details.task.description} maxLength={20000} rows={6} />
                </label>
                <button className="primary-button small" type="submit">{t("Save")}</button>
              </form>
            ) : (
              <>
                <h2>
                  {canContribute ? (
                    <button
                      className="editable-task-title"
                      type="button"
                      title={t("Click to edit title")}
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
                        <span>{t("Change status")}</span>
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
                            >● {statusLabels[projectStatus.key] ?? projectStatus.name}</option>
                          ))}
                        </select>
                      </label>
                      {canAdminister && (
                        <button
                          className="text-button status-settings-trigger"
                          type="button"
                          onClick={() => setShowStatusEditor((value) => !value)}
                        >{t(showStatusEditor ? "Close" : "Configure statuses")}</button>
                      )}
                    </div>
                  )}
                </div>
                {showStatusEditor && canAdminister && (
                  <section className="project-status-editor" aria-label={t("Status configuration")}>
                    <header>
                      <div><h3>{t("Project statuses")}</h3><small>{t("Name and color shown in tasks and boards.")}</small></div>
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
                            aria-label={t("Color of {name}", { name: projectStatus.name })}
                          />
                          <input name="name" defaultValue={projectStatus.name} maxLength={60} required />
                          <code>{projectStatus.key}</code>
                          <button
                            className="secondary-button small"
                            type="submit"
                            disabled={pendingStatusKeys.has(projectStatus.key)}
                          >{t("Save")}</button>
                        </form>
                      ))}
                    </div>
                    <form className="project-status-create" onSubmit={createProjectStatus}>
                      <input type="color" name="color" defaultValue="#8B5CF6" aria-label={t("New status color")} />
                      <input name="name" placeholder={t("New status, e.g. In review")} maxLength={60} required />
                      <button className="primary-button small" type="submit">{t("Add")}</button>
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
                    title={t("Click to edit description")}
                    onClick={() => setIsEditing(true)}
                  >{details.task.description || t("Add a description…")}</button>
                ) : (
                  <p className={details.task.description ? "description" : "description muted"}>
                    {details.task.description || t("No description.")}
                  </p>
                )}
                {attachments.length > 0 && (
                  <section className="task-overview-media" aria-label={t("Recent media and files")}>
                    <header>
                      <div>
                        <h3>{t("Media and files")}</h3>
                        <small>{t(attachments.length === 1 ? "{count} linked file" : "{count} linked files", { count: attachments.length })}</small>
                      </div>
                      <button type="button" className="text-button" onClick={() => setDetailTab("files")}>
                        {t("Show all")}
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
                            <span>{served.startsWith("video/") ? t("VIDEO") : t("FILE")}</span>
                            <strong>{attachment.fileName}</strong>
                            <small>{t(attachmentStatusLabel(attachment.status))}</small>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}

                <dl className="task-facts">
                  <div><dt>{t("Created")}</dt><dd title={fullDate(details.task.createdAt)}>{relativeDate(details.task.createdAt)}</dd></div>
                  <div><dt>{t("Updated")}</dt><dd title={fullDate(details.task.updatedAt)}>{relativeDate(details.task.updatedAt)}</dd></div>
                  <div>
                    <dt>{t("Due date")}</dt>
                    <dd className={isTaskOverdue(details.task) ? "overdue" : ""} title={details.task.dueAt ? fullDate(details.task.dueAt) : undefined}>
                      {details.task.dueAt ? shortDate(details.task.dueAt) : t("Not set")}
                    </dd>
                  </div>
                  <div className="task-assignee-fact">
                    <dt>{t("Assignees")}</dt>
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
                  <div><dt>{t("Revision")}</dt><dd>#{details.task.revision}</dd></div>
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
                      <p>{t("{completed} of {total} completed", { completed: completedChecklistItems, total: details.checklist.length })}</p>
                    </div>
                    <strong>{checklistProgress}%</strong>
                  </div>
                  <progress
                    className="checklist-progress"
                    value={completedChecklistItems}
                    max={Math.max(details.checklist.length, 1)}
                    aria-label={t("Checklist progress: {progress}%", { progress: checklistProgress })}
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
                              aria-label={t("Remove “{title}” from checklist", { title: item.title })}
                              onClick={() => void deleteChecklistItem(item)}
                            >×</button>
                          )}
                        </div>
                      );
                    })}
                    {details.checklist.length === 0 && (
                      <p className="empty-note">{t("Add the steps needed to complete this task.")}</p>
                    )}
                  </div>
                  {canContribute && (
                    <form className="checklist-form" onSubmit={createChecklistItem}>
                      <input
                        name="title"
                        maxLength={500}
                        placeholder={t("Add a step…")}
                        aria-label={t("New checklist item")}
                        disabled={checklistCreating || details.checklist.length >= 200}
                        required
                      />
                      <button
                        className="primary-button small"
                        type="submit"
                        disabled={checklistCreating || details.checklist.length >= 200}
                      >{t(checklistCreating ? "Adding…" : "Add")}</button>
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
                  <h3>{t("Depends on")} <span>{dependencies.dependsOn.length}</span></h3>
                  <p>{t("These tasks must progress before this one.")}</p>
                </div>
                <div className="dependency-list">
                  {dependencies.dependsOn.map((dependency) => (
                    <article className="dependency-row" key={dependency.id}>
                      <button type="button" onClick={() => openTask(dependency.id)}>
                        <span className="relation-mark relation-in" aria-hidden="true">←</span>
                        <span>
                          <strong>{dependency.key} · {dependency.title}</strong>
                          <small>{t("Linked")} {relativeDate(dependency.linkedAt)}</small>
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
                          aria-label={t("Remove dependency on {key}", { key: dependency.key })}
                          onClick={() => void removeDependency(details.task.id, dependency.id)}
                        >×</button>
                      )}
                    </article>
                  ))}
                  {dependencies.dependsOn.length === 0 && (
                    <p className="empty-note">{t("This task has no dependencies.")}</p>
                  )}
                </div>

                {canContribute && (
                  <form className="dependency-form" onSubmit={createDependency}>
                    <select name="dependsOnTaskId" defaultValue="" required>
                      <option value="" disabled>{t("Choose a task from this project…")}</option>
                      {dependencyCandidates.map((candidate) => (
                        <option value={candidate.id} key={candidate.id}>
                          {candidate.key} · {candidate.title}
                        </option>
                      ))}
                    </select>
                    <button className="primary-button small" type="submit" disabled={dependencyCandidates.length === 0}>
                      {t("Add")}
                    </button>
                  </form>
                )}

                <div className="dependency-heading blocking-heading">
                  <h3>{t("Blocks")} <span>{dependencies.blocking.length}</span></h3>
                  <p>{t("These tasks are waiting for this one.")}</p>
                </div>
                <div className="dependency-list">
                  {dependencies.blocking.map((relation) => (
                    <article className="dependency-row" key={relation.id}>
                      <button type="button" onClick={() => openTask(relation.id)}>
                        <span className="relation-mark relation-out" aria-hidden="true">→</span>
                        <span>
                          <strong>{relation.key} · {relation.title}</strong>
                          <small>{t("Linked")} {relativeDate(relation.linkedAt)}</small>
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
                          aria-label={t("Stop blocking {key}", { key: relation.key })}
                          onClick={() => void removeDependency(relation.id, details.task.id)}
                        >×</button>
                      )}
                    </article>
                  ))}
                  {dependencies.blocking.length === 0 && (
                    <p className="empty-note">{t("No task is waiting for this one.")}</p>
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
                    <h3>{t("Git references")} <span>{externalReferences.length}</span></h3>
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
              {externalReferences.length === 0 && <p className="empty-note">{t("No commit or branch linked.")}</p>}
              {canContribute && (
                <details className="reference-form-shell">
                  <summary>{t("Add a Git reference")}</summary>
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
                        <option value="branch">{t("Branch")}</option>
                        <option value="tag">Tag</option>
                        <option value="merge_request">Merge request</option>
                      </select>
                    </div>
                    <input name="repository" placeholder={t("organization/repository")} maxLength={240} required />
                    <input name="referenceValue" placeholder={t("SHA, branch or number")} maxLength={240} required />
                    <input name="label" placeholder={t("Visible label")} maxLength={240} required />
                    <input name="webUrl" type="url" placeholder="https://… (optionnel)" maxLength={2048} />
                    <button className="primary-button small" type="submit">{t("Link to task")}</button>
                  </form>
                </details>
              )}
                  </section>
                </div>
              )))}

            {detailTab === "files" && (
            <section className="attachments detail-section">
              <h3>{t("Files")} <span>{attachments.length}</span></h3>
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
                          {formatBytes(attachment.sizeBytes)} · {t(attachmentStatusLabel(attachment.status))}
                          {attachment.width && attachment.height ? ` · ${attachment.width}×${attachment.height}` : ""}
                          {attachment.durationSeconds ? ` · ${formatDuration(attachment.durationSeconds)}` : ""}
                        </small>
                        {attachment.rejectionReason && (
                          <small className="attachment-reason">{attachment.rejectionReason}</small>
                        )}
                      </span>
                      {isAvailable ? (
                        <a className="attachment-download" href={contentUrl} download={attachment.fileName}>
                          {t("Download")}
                        </a>
                      ) : (
                        <span className={`attachment-state attachment-${attachment.status}`}>
                          {t(attachmentBadgeLabel(attachment.status))}
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
              {attachments.length === 0 && <p className="empty-note">{t("No file linked to this task.")}</p>}
              {canContribute && (
                <form className="attachment-form" onSubmit={uploadAttachment}>
                  {activeUploads.length > 0 && (
                    <div className="upload-resume-list" role="status">
                      <strong>{t("Uploads in progress or ready to resume")}</strong>
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
                                {" · "}expire le {new Date(upload.expiresAt).toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}
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
                        {t("Select the same file again: its fingerprint will be verified before resuming.")}
                      </small>
                    </div>
                  )}
                  <label className="file-picker">
                    {t("Add an image, video or file")}
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
                    {t("Already optimized locally")}
                  </label>
                  {uploadProgress && (
                    <div className="upload-progress" role="status">
                      <span>{uploadProgress.label}</span>
                      <progress max={100} value={uploadProgress.percent} />
                    </div>
                  )}
                  <button className="primary-button small" type="submit" disabled={Boolean(uploadProgress)}>
                    {t(uploadProgress ? "Uploading…" : "Upload to quarantine")}
                  </button>
                  <small className="security-note">{t("The original remains quarantined until the server validates its format.")}</small>
                </form>
              )}
            </section>
            )}

            {detailTab === "activity" && (
            <section className="comments detail-section">
              <h3>{t("Activity")} <span>{details.comments.length}</span></h3>
              {canContribute ? (
                <form className="comment-form comment-form-top" onSubmit={createComment}>
                  <textarea
                    name="body"
                    placeholder={t("Add a comment…")}
                    maxLength={10000}
                    rows={3}
                    required
                    onKeyDown={submitOnModEnter}
                  />
                  <div className="comment-form-actions">
                    <small className="comment-shortcut">{t("Ctrl/⌘ + Enter to send")}</small>
                    <button className="primary-button small" type="submit">{t("Post comment")}</button>
                  </div>
                </form>
              ) : (
                <p className="empty-note">{t("Your role is read-only.")}</p>
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

function formatRelativeDate(value: string, locale: "en" | "fr"): string {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const difference = new Date(value).getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function formatFullDate(value: string, locale: "en" | "fr"): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
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

function formatShortDate(value: string, locale: "en" | "fr"): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short" }).format(new Date(value));
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

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
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
  return { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" }[role];
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
    uploading: "Incomplete",
    quarantined: "Scanning",
    available: "Validated",
    rejected: "Rejected"
  }[status];
}

function attachmentStatusLabel(status: Attachment["status"]): string {
  return {
    uploading: "Incomplete upload",
    quarantined: "Quarantined, scanning",
    available: "Validated",
    rejected: "Rejected during scanning"
  }[status];
}
