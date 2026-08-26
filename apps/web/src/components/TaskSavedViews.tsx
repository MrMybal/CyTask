import { type FormEvent, useEffect, useState } from "react";
import type { WorkItem } from "../api";

export type TaskFilterSnapshot = {
  query: string;
  status: "all" | WorkItem["status"];
  priority: "all" | WorkItem["priority"];
  assignee: "all" | "unassigned" | string;
  due: "all" | "overdue" | "today" | "week" | "none";
  label: "all" | "none" | string;
  sort: "updated" | "created" | "due" | "key" | "title";
  view: "list" | "board" | "compact" | "canvas" | "graph";
};

export interface TaskViewDefinition {
  id: string;
  name: string;
  filters: TaskFilterSnapshot;
}

export interface SavedTaskView extends TaskViewDefinition {
  createdAt: string;
  updatedAt: string;
}

interface TaskSavedViewsProps {
  presets: TaskViewDefinition[];
  savedViews: SavedTaskView[];
  activeViewId?: string;
  dirty: boolean;
  onSelect: (viewId?: string) => void;
  onSave: (name: string) => boolean;
  onUpdate: () => void;
  onRename: (name: string) => boolean;
  onDelete: () => void;
  onReset: () => void;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusPattern = /^(all|[a-z][a-z0-9_]{0,39})$/;
const priorities = new Set(["all", "low", "normal", "high", "urgent"]);
const dueFilters = new Set(["all", "overdue", "today", "week", "none"]);
const sorts = new Set(["updated", "created", "due", "key", "title"]);
const views = new Set(["list", "board", "compact", "canvas", "miro", "graph"]);

export function savedTaskViewsStorageKey(
  organizationId: string,
  userId: string,
  projectId: string
) {
  return `cytask.savedTaskViews.v1.${organizationId}.${userId}.${projectId}`;
}

export function parseSavedTaskViews(raw: string | null): SavedTaskView[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: SavedTaskView[] = [];
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const candidate of parsed.slice(0, 20)) {
      const view = parseSavedTaskView(candidate);
      if (!view) continue;
      const normalizedName = view.name.toLocaleLowerCase("fr");
      if (ids.has(view.id) || names.has(normalizedName)) continue;
      ids.add(view.id);
      names.add(normalizedName);
      result.push(view);
    }
    return result;
  } catch {
    return [];
  }
}

export function taskFilterSnapshotsEqual(left: TaskFilterSnapshot, right: TaskFilterSnapshot) {
  return left.query === right.query
    && left.status === right.status
    && left.priority === right.priority
    && left.assignee === right.assignee
    && left.due === right.due
    && left.label === right.label
    && left.sort === right.sort
    && left.view === right.view;
}

export function TaskSavedViews({
  presets,
  savedViews,
  activeViewId,
  dirty,
  onSelect,
  onSave,
  onUpdate,
  onRename,
  onDelete,
  onReset
}: TaskSavedViewsProps) {
  const [editor, setEditor] = useState<"save" | "rename">();
  const [name, setName] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const activeSavedView = savedViews.find((view) => view.id === activeViewId);

  useEffect(() => {
    setEditor(undefined);
    setName("");
    setDeleteArmed(false);
  }, [activeViewId]);

  function openEditor(nextEditor: "save" | "rename") {
    setEditor(nextEditor);
    setName(nextEditor === "rename" ? activeSavedView?.name ?? "" : "");
    setDeleteArmed(false);
  }

  function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accepted = editor === "rename" ? onRename(name) : onSave(name);
    if (!accepted) return;
    setEditor(undefined);
    setName("");
  }

  return (
    <div className="saved-view-bar" role="group" aria-label="Vues enregistrées">
      <label className="saved-view-select">
        <span>Vue</span>
        <select
          value={activeViewId ?? ""}
          onChange={(event) => onSelect(event.currentTarget.value || undefined)}
          aria-label="Appliquer une vue de tâches"
        >
          <option value="">Vue libre</option>
          <optgroup label="Vues rapides">
            {presets.map((view) => (
              <option value={view.id} key={view.id}>{view.name}</option>
            ))}
          </optgroup>
          {savedViews.length > 0 && (
            <optgroup label="Mes vues">
              {savedViews.map((view) => (
                <option value={view.id} key={view.id}>{view.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <span className={dirty ? "saved-view-state dirty" : "saved-view-state"} aria-live="polite">
        {activeViewId ? (dirty ? "Modifiée" : "Synchronisée") : "Filtres libres"}
      </span>

      <div className="saved-view-actions">
        <button className="text-button" type="button" onClick={() => openEditor("save")}>
          Enregistrer
        </button>
        {activeSavedView && (
          <>
            <button
              className="text-button"
              type="button"
              disabled={!dirty}
              onClick={onUpdate}
            >Mettre à jour</button>
            <button className="text-button" type="button" onClick={() => openEditor("rename")}>
              Renommer
            </button>
            <button
              className={deleteArmed ? "text-button danger" : "text-button"}
              type="button"
              onClick={() => {
                if (deleteArmed) onDelete();
                else setDeleteArmed(true);
              }}
            >{deleteArmed ? "Confirmer" : "Supprimer"}</button>
          </>
        )}
        <button className="text-button" type="button" onClick={onReset}>Réinitialiser</button>
      </div>

      {editor && (
        <form className="saved-view-editor" onSubmit={submitName}>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            minLength={1}
            maxLength={40}
            placeholder={editor === "rename" ? "Nouveau nom" : "Nom de la vue"}
            aria-label={editor === "rename" ? "Nouveau nom de la vue" : "Nom de la vue à enregistrer"}
            autoFocus
            required
          />
          <button className="primary-button small" type="submit">
            {editor === "rename" ? "Renommer" : "Créer"}
          </button>
          <button className="text-button" type="button" onClick={() => setEditor(undefined)}>
            Annuler
          </button>
        </form>
      )}
    </div>
  );
}

function parseSavedTaskView(candidate: unknown): SavedTaskView | undefined {
  if (!isRecord(candidate)
    || typeof candidate.id !== "string" || !uuidPattern.test(candidate.id)
    || typeof candidate.name !== "string"
    || candidate.name.trim().length === 0 || candidate.name.trim().length > 40
    || typeof candidate.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.createdAt))
    || typeof candidate.updatedAt !== "string" || !Number.isFinite(Date.parse(candidate.updatedAt))) {
    return undefined;
  }
  const filters = parseTaskFilterSnapshot(candidate.filters);
  if (!filters) return undefined;
  return {
    id: candidate.id,
    name: candidate.name.trim(),
    filters,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}

function parseTaskFilterSnapshot(candidate: unknown): TaskFilterSnapshot | undefined {
  if (!isRecord(candidate)
    || typeof candidate.query !== "string" || candidate.query.length > 240
    || typeof candidate.status !== "string" || !statusPattern.test(candidate.status)
    || typeof candidate.priority !== "string" || !priorities.has(candidate.priority)
    || !isDynamicFilter(candidate.assignee, "unassigned")
    || typeof candidate.due !== "string" || !dueFilters.has(candidate.due)
    || !isDynamicFilter(candidate.label, "none")
    || typeof candidate.sort !== "string" || !sorts.has(candidate.sort)
    || typeof candidate.view !== "string" || !views.has(candidate.view)) {
    return undefined;
  }
  return {
    ...candidate,
    view: candidate.view === "miro" ? "canvas" : candidate.view
  } as TaskFilterSnapshot;
}

function isDynamicFilter(value: unknown, secondary: string): value is string {
  return typeof value === "string" && (value === "all" || value === secondary || uuidPattern.test(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
