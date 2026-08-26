import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import type {
  OrganizationMember,
  ProjectLabel,
  TaskLabelAssignment,
  TaskOption,
  TaskParentAssignment,
  WorkItem
} from "../api";
import { TaskAssigneePicker } from "./TaskAssigneePicker";

const priorityLabels: Record<WorkItem["priority"], string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente"
};

interface CompactTaskTableProps {
  tasks: WorkItem[];
  labelsByTask: ReadonlyMap<string, ProjectLabel[]>;
  statusLabels: Readonly<Record<string, string>>;
  statusColors: Readonly<Record<string, string>>;
  statusOrder: readonly string[];
  members: OrganizationMember[];
  canEdit: boolean;
  pendingTaskIds: ReadonlySet<string>;
  selectedTaskId?: string;
  onOpenTask: (taskId: string) => void;
  onChangeStatus: (task: WorkItem, status: WorkItem["status"]) => void;
  onChangeAssignees: (task: WorkItem, assigneeIds: string[]) => void;
}

type CompactSort = "name" | "assignee" | "due" | "priority" | "status" | "folder";

export function CompactTaskTable({
  tasks,
  labelsByTask,
  statusLabels,
  statusColors,
  statusOrder,
  members,
  canEdit,
  pendingTaskIds,
  selectedTaskId,
  onOpenTask,
  onChangeStatus,
  onChangeAssignees
}: CompactTaskTableProps) {
  const [sortColumn, setSortColumn] = useState<CompactSort>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const statusRanks = useMemo(
    () => new Map(statusOrder.map((status, index) => [status, index])),
    [statusOrder]
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, { label?: ProjectLabel; tasks: WorkItem[] }>();
    for (const task of tasks) {
      const label = labelsByTask.get(task.id)?.find((candidate) => candidate.name !== "Urgent")
        ?? labelsByTask.get(task.id)?.[0];
      const key = label?.id ?? "unfiled";
      const group = grouped.get(key) ?? { label, tasks: [] };
      group.tasks.push(task);
      grouped.set(key, group);
    }
    const direction = sortDirection === "asc" ? 1 : -1;
    const result = [...grouped.values()].sort((left, right) => {
      const comparison = (left.label?.name ?? "Sans dossier").localeCompare(
        right.label?.name ?? "Sans dossier",
        "fr"
      );
      return sortColumn === "folder" ? comparison * direction : comparison;
    });
    const priorityOrder = { low: 0, normal: 1, high: 2, urgent: 3 };
    for (const group of result) {
      group.tasks.sort((left, right) => {
        const comparison = sortColumn === "name" ? left.title.localeCompare(right.title, "fr")
          : sortColumn === "assignee" ? taskAssigneeSortName(left).localeCompare(taskAssigneeSortName(right), "fr")
          : sortColumn === "due" ? (left.dueAt ? Date.parse(left.dueAt) : Number.MAX_SAFE_INTEGER)
            - (right.dueAt ? Date.parse(right.dueAt) : Number.MAX_SAFE_INTEGER)
          : sortColumn === "priority" ? priorityOrder[left.priority] - priorityOrder[right.priority]
          : sortColumn === "status" ? (statusRanks.get(left.status) ?? 99) - (statusRanks.get(right.status) ?? 99)
          : 0;
        return comparison * direction;
      });
    }
    return result;
  }, [labelsByTask, sortColumn, sortDirection, statusRanks, tasks]);

  function sort(column: CompactSort) {
    if (column === sortColumn) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  return (
    <section className="compact-table" aria-label="Tâches en tableau compact">
      {groups.map((group) => (
        <section className="compact-group" key={group.label?.id ?? "unfiled"}>
          <header className="compact-group-header">
            <span
              className="compact-folder-mark"
              style={{ backgroundColor: group.label?.color ?? "#94A3B8" }}
              aria-hidden="true"
            />
            <strong>{group.label?.name ?? "Sans dossier"}</strong>
            <span>{group.tasks.length}</span>
          </header>
          <div className="compact-columns" aria-label="Trier les tâches par colonne">
            {([
              ["name", "Nom"],
              ["assignee", "Assignée"],
              ["due", "Échéance"],
              ["priority", "Priorité"],
              ["status", "Statut"],
              ["folder", "Dossier"]
            ] as const).map(([column, label]) => (
              <button type="button" key={column} onClick={() => sort(column)}>
                {label}{sortColumn === column ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
              </button>
            ))}
          </div>
          {group.tasks.map((task) => {
            const pending = pendingTaskIds.has(task.id);
            return (
              <div
                className={task.id === selectedTaskId ? "compact-task-row active" : "compact-task-row"}
                key={task.id}
                aria-busy={pending}
              >
                <button
                  className="compact-task-name compact-cell-button"
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                >
                  <i
                    className={"compact-status-dot status-dot-" + task.status}
                    style={{ backgroundColor: statusColors[task.status] ?? "#94A3B8" }}
                    aria-hidden="true"
                  />
                  <strong>{task.title}</strong>
                  <small>{task.key}</small>
                </button>
                <TaskAssigneePicker
                  compact
                  members={members}
                  selectedIds={taskAssigneeIds(task)}
                  disabled={!canEdit || pending}
                  onChange={(assigneeIds) => onChangeAssignees(task, assigneeIds)}
                />
                <span>{task.dueAt ? compactDate(task.dueAt) : "—"}</span>
                <span className={"compact-priority priority-" + task.priority}>
                  {priorityLabels[task.priority]}
                </span>
                <select
                  className={"compact-status-select status-" + task.status}
                  value={task.status}
                  disabled={!canEdit || pending}
                  aria-label={"Modifier le statut de " + task.key}
                  style={{
                    color: statusColors[task.status] ?? "#94A3B8",
                    borderColor: statusColors[task.status] ?? "#94A3B8"
                  }}
                  onChange={(event) => onChangeStatus(task, event.currentTarget.value)}
                >
                  {statusOrder.map((status) => (
                    <option value={status} key={status}>{statusLabels[status] ?? status}</option>
                  ))}
                </select>
                <span className="compact-folder-value">
                  <i style={{ backgroundColor: group.label?.color ?? "#94A3B8" }} />
                  {group.label?.name ?? "Sans dossier"}
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </section>
  );
}

function taskAssigneeIds(task: WorkItem): string[] {
  if (task.assignees && task.assignees.length > 0) {
    return task.assignees.map((assignee) => assignee.userId);
  }
  return task.assigneeId ? [task.assigneeId] : [];
}

function taskAssigneeSortName(task: WorkItem): string {
  return task.assignees?.map((assignee) => assignee.displayName).join(" ")
    ?? task.assigneeName
    ?? "";
}

type CanvasMode = "canvas" | "graph";

interface TaskCanvasProps {
  mode: CanvasMode;
  tasks: TaskOption[];
  labels: ProjectLabel[];
  assignments: TaskLabelAssignment[];
  hierarchy: TaskParentAssignment[];
  onOpenTask: (taskId: string) => void;
}

interface CanvasNode {
  id: string;
  type: "folder" | "task";
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  subtitle: string;
  color: string;
  status?: WorkItem["status"];
  taskId?: string;
  groupId?: string;
}

interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  type: "folder" | "membership" | "hierarchy";
}

interface CanvasLayout {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  width: number;
  height: number;
}

interface DragState {
  kind: "pan" | "node";
  pointerId: number;
  nodeId?: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

export function TaskCanvas({
  mode,
  tasks,
  labels,
  assignments,
  hierarchy,
  onOpenTask
}: TaskCanvasProps) {
  const layout = useMemo(
    () => mode === "canvas"
      ? buildGroupedCanvasLayout(tasks, labels, assignments)
      : buildGraphLayout(tasks, labels, assignments, hierarchy),
    [assignments, hierarchy, labels, mode, tasks]
  );
  const [viewport, setViewport] = useState({ x: 28, y: 28, scale: mode === "graph" ? 0.72 : 0.9 });
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<DragState | undefined>(undefined);

  function resetViewport() {
    setViewport({ x: 28, y: 28, scale: mode === "graph" ? 0.72 : 0.9 });
    if (mode === "canvas") setNodeOffsets({});
  }

  function zoom(delta: number) {
    setViewport((current) => ({
      ...current,
      scale: clamp(current.scale + delta, 0.28, 1.8)
    }));
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".canvas-node")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewport.x,
      startY: viewport.y
    };
  }

  function nodePointerDown(event: ReactPointerEvent<HTMLElement>, node: CanvasNode) {
    if (mode !== "canvas" || node.type !== "folder") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const offset = nodeOffsets[node.id] ?? { x: 0, y: 0 };
    drag.current = {
      kind: "node",
      nodeId: node.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: offset.x,
      startY: offset.y
    };
  }

  function pointerMove(event: ReactPointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - active.startClientX;
    const deltaY = event.clientY - active.startClientY;
    if (active.kind === "pan") {
      setViewport((current) => ({
        ...current,
        x: active.startX + deltaX,
        y: active.startY + deltaY
      }));
      return;
    }
    if (!active.nodeId) return;
    setNodeOffsets((current) => ({
      ...current,
      [active.nodeId!]: {
        x: active.startX + deltaX / viewport.scale,
        y: active.startY + deltaY / viewport.scale
      }
    }));
  }

  function pointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
  }

  function wheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const nextScale = clamp(viewport.scale * (event.deltaY > 0 ? 0.9 : 1.1), 0.28, 1.8);
    const worldX = (event.clientX - rect.left - viewport.x) / viewport.scale;
    const worldY = (event.clientY - rect.top - viewport.y) / viewport.scale;
    setViewport({
      x: event.clientX - rect.left - worldX * nextScale,
      y: event.clientY - rect.top - worldY * nextScale,
      scale: nextScale
    });
  }

  const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
  const position = (node: CanvasNode) => {
    const movableId = mode === "canvas" ? node.groupId ?? (node.type === "folder" ? node.id : undefined) : undefined;
    const offset = movableId ? nodeOffsets[movableId] ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    return { x: node.x + offset.x, y: node.y + offset.y };
  };

  return (
    <section className={`relation-canvas relation-canvas-${mode}`} aria-label={mode === "canvas" ? "Canvas groupé du projet" : "Graphe du projet"}>
      <header className="canvas-toolbar">
        <div>
          <strong>{mode === "canvas" ? "Canvas groupé" : "Graphe relationnel"}</strong>
          <small>{layout.nodes.length} éléments · molette pour zoomer · glisser le fond pour naviguer</small>
        </div>
        <div className="canvas-actions">
          <button type="button" onClick={() => zoom(-0.12)} aria-label="Dézoomer">−</button>
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button type="button" onClick={() => zoom(0.12)} aria-label="Zoomer">+</button>
          <button type="button" onClick={resetViewport}>Recentrer</button>
        </div>
      </header>
      <div
        className="canvas-viewport"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onWheel={wheel}
      >
        <div
          className="canvas-world"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
          }}
        >
          <svg className="canvas-edges" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id={`arrow-${mode}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const from = nodesById.get(edge.from);
              const to = nodesById.get(edge.to);
              if (!from || !to) return null;
              const fromPosition = position(from);
              const toPosition = position(to);
              return (
                <path
                  className={`canvas-edge canvas-edge-${edge.type}`}
                  key={edge.id}
                  d={curveBetween(from, to, fromPosition, toPosition)}
                  markerEnd={edge.type === "hierarchy" ? `url(#arrow-${mode})` : undefined}
                />
              );
            })}
          </svg>

          {layout.nodes.map((node) => {
            const nodePosition = position(node);
            const style = {
              left: nodePosition.x,
              top: nodePosition.y,
              width: node.width,
              height: node.height,
              "--node-color": node.color
            } as React.CSSProperties;
            if (node.type === "task") {
              return (
                <button
                  className={`canvas-node canvas-task-node status-${node.status ?? "todo"}`}
                  type="button"
                  key={node.id}
                  style={style}
                  onClick={() => node.taskId && onOpenTask(node.taskId)}
                >
                  <small>{node.subtitle}</small>
                  <strong>{node.title}</strong>
                </button>
              );
            }
            return (
              <article
                className="canvas-node canvas-folder-node"
                key={node.id}
                style={style}
                onPointerDown={(event) => nodePointerDown(event, node)}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
              >
                <span className="canvas-folder-icon">▰</span>
                <strong>{node.title}</strong>
                <small>{node.subtitle}</small>
                {mode === "canvas" && <em>Glisser le groupe</em>}
              </article>
            );
          })}
        </div>
      </div>
      <footer className="canvas-legend">
        <span><i className="legend-folder" /> Dossier</span>
        <span><i className="legend-membership" /> Affectation</span>
        <span><i className="legend-hierarchy" /> Sous-tâche</span>
      </footer>
    </section>
  );
}

function buildGroupedCanvasLayout(
  tasks: TaskOption[],
  labels: ProjectLabel[],
  assignments: TaskLabelAssignment[]
): CanvasLayout {
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  const taskLabels = indexTaskLabels(assignments, labelsById);
  const groups = labels.map((label) => ({
    id: label.id,
    label,
    tasks: tasks.filter((task) => primaryLabelId(task.id, taskLabels, labelsById) === label.id)
  }));
  const unfiled = tasks.filter((task) => !primaryLabelId(task.id, taskLabels, labelsById));
  if (unfiled.length > 0) {
    groups.push({
      id: "unfiled",
      label: {
        id: "unfiled",
        organizationId: "",
        projectId: "",
        name: "Sans dossier",
        color: "#94A3B8",
        createdBy: "",
        createdAt: "",
        parentLabelId: null
      },
      tasks: unfiled
    });
  }

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const columns = 3;
  const groupWidth = 330;
  const groupHeight = 255;
  const gapX = 46;
  const gapY = 48;

  groups.forEach((group, index) => {
    const x = 70 + (index % columns) * (groupWidth + gapX);
    const y = 70 + Math.floor(index / columns) * (groupHeight + gapY);
    nodes.push({
      id: `folder:${group.id}`,
      type: "folder",
      x,
      y,
      width: groupWidth,
      height: groupHeight,
      title: group.label.name,
      subtitle: `${group.tasks.length} tâche${group.tasks.length > 1 ? "s" : ""}`,
      color: group.label.color
    });
    group.tasks.slice(0, 8).forEach((task, taskIndex) => {
      nodes.push({
        id: `task:${task.id}`,
        type: "task",
        x: x + 18 + (taskIndex % 2) * 151,
        y: y + 78 + Math.floor(taskIndex / 2) * 40,
        width: 143,
        height: 34,
        title: task.title,
        subtitle: task.key,
        color: group.label.color,
        status: task.status,
        taskId: task.id,
        groupId: `folder:${group.id}`
      });
    });
    if (group.label.parentLabelId) {
      edges.push({
        id: `folder-parent:${group.id}`,
        from: `folder:${group.label.parentLabelId}`,
        to: `folder:${group.id}`,
        type: "folder"
      });
    }
  });

  return {
    nodes,
    edges,
    width: 70 + columns * (groupWidth + gapX),
    height: 100 + Math.ceil(groups.length / columns) * (groupHeight + gapY)
  };
}

function buildGraphLayout(
  tasks: TaskOption[],
  labels: ProjectLabel[],
  assignments: TaskLabelAssignment[],
  hierarchy: TaskParentAssignment[]
): CanvasLayout {
  const labelsById = new Map(labels.map((label) => [label.id, label]));
  const taskLabels = indexTaskLabels(assignments, labelsById);
  const depthByLabel = new Map<string, number>();
  const labelDepth = (label: ProjectLabel): number => {
    const cached = depthByLabel.get(label.id);
    if (cached !== undefined) return cached;
    const parent = label.parentLabelId ? labelsById.get(label.parentLabelId) : undefined;
    const depth = parent ? Math.min(labelDepth(parent) + 1, 5) : 0;
    depthByLabel.set(label.id, depth);
    return depth;
  };
  labels.forEach(labelDepth);
  const maxDepth = Math.max(0, ...depthByLabel.values());
  const groups = [
    ...labels.map((label) => ({
      id: label.id,
      label,
      tasks: tasks.filter((task) => primaryLabelId(task.id, taskLabels, labelsById) === label.id)
    })),
    {
      id: "unfiled",
      label: undefined,
      tasks: tasks.filter((task) => !primaryLabelId(task.id, taskLabels, labelsById))
    }
  ].filter((group) => group.label || group.tasks.length > 0);

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const taskStartX = 340 + maxDepth * 220;
  let groupY = 70;

  for (const group of groups) {
    const label = group.label;
    const depth = label ? depthByLabel.get(label.id) ?? 0 : 0;
    const folderId = `folder:${group.id}`;
    nodes.push({
      id: folderId,
      type: "folder",
      x: 70 + depth * 220,
      y: groupY,
      width: 180,
      height: 72,
      title: label?.name ?? "Sans dossier",
      subtitle: `${group.tasks.length} tâche${group.tasks.length > 1 ? "s" : ""}`,
      color: label?.color ?? "#94A3B8"
    });
    if (label?.parentLabelId) {
      edges.push({
        id: `folder-parent:${label.id}`,
        from: `folder:${label.parentLabelId}`,
        to: folderId,
        type: "folder"
      });
    }

    const taskRows = Math.max(1, Math.ceil(group.tasks.length / 4));
    group.tasks.forEach((task, index) => {
      const taskId = `task:${task.id}`;
      nodes.push({
        id: taskId,
        type: "task",
        x: taskStartX + (index % 4) * 235,
        y: groupY + Math.floor(index / 4) * 76,
        width: 205,
        height: 58,
        title: task.title,
        subtitle: task.key,
        color: label?.color ?? "#94A3B8",
        status: task.status,
        taskId: task.id
      });
      edges.push({
        id: `membership:${group.id}:${task.id}`,
        from: folderId,
        to: taskId,
        type: "membership"
      });
    });
    groupY += Math.max(118, taskRows * 76 + 42);
  }

  for (const relation of hierarchy) {
    if (!tasks.some((task) => task.id === relation.taskId)
      || !tasks.some((task) => task.id === relation.parentTaskId)) continue;
    edges.push({
      id: `hierarchy:${relation.parentTaskId}:${relation.taskId}`,
      from: `task:${relation.parentTaskId}`,
      to: `task:${relation.taskId}`,
      type: "hierarchy"
    });
  }

  return {
    nodes,
    edges,
    width: taskStartX + 4 * 235 + 80,
    height: groupY + 80
  };
}

function indexTaskLabels(
  assignments: TaskLabelAssignment[],
  labelsById: ReadonlyMap<string, ProjectLabel>
) {
  const result = new Map<string, ProjectLabel[]>();
  for (const assignment of assignments) {
    const label = labelsById.get(assignment.labelId);
    if (!label) continue;
    const taskLabels = result.get(assignment.taskId) ?? [];
    taskLabels.push(label);
    result.set(assignment.taskId, taskLabels);
  }
  for (const taskLabels of result.values()) {
    taskLabels.sort((left, right) => {
      if (left.name === "Urgent") return 1;
      if (right.name === "Urgent") return -1;
      return left.name.localeCompare(right.name, "fr");
    });
  }
  return result;
}

function primaryLabelId(
  taskId: string,
  taskLabels: ReadonlyMap<string, ProjectLabel[]>,
  labelsById: ReadonlyMap<string, ProjectLabel>
) {
  return taskLabels.get(taskId)?.find((label) => labelsById.has(label.id))?.id;
}

function curveBetween(
  from: CanvasNode,
  to: CanvasNode,
  fromPosition: { x: number; y: number },
  toPosition: { x: number; y: number }
) {
  const x1 = fromPosition.x + from.width;
  const y1 = fromPosition.y + from.height / 2;
  const x2 = toPosition.x;
  const y2 = toPosition.y + to.height / 2;
  const control = Math.max(55, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + control} ${y1}, ${x2 - control} ${y2}, ${x2} ${y2}`;
}

function compactDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(new Date(value));
}


function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
