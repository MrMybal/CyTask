import { type FormEvent, useEffect, useState } from "react";
import type { WorkItem } from "../api";

interface TaskHierarchyMetaProps {
  parent?: WorkItem;
  childCount: number;
}

export function TaskHierarchyMeta({ parent, childCount }: TaskHierarchyMetaProps) {
  if (!parent && childCount === 0) return null;

  return (
    <span className="task-hierarchy-meta" aria-label="Hiérarchie de la tâche">
      {parent && <span title={`Sous-tâche de ${parent.key}`}>↳ {parent.key}</span>}
      {childCount > 0 && (
        <span>{childCount} sous-tâche{childCount > 1 ? "s" : ""}</span>
      )}
    </span>
  );
}

interface TaskHierarchySectionProps {
  task: WorkItem;
  parent?: WorkItem;
  children: WorkItem[];
  parentCandidates: WorkItem[];
  canContribute: boolean;
  pending: boolean;
  onOpenTask: (taskId: string) => void;
  onSetParent: (parentTaskId: string) => Promise<void>;
  onRemoveParent: () => Promise<void>;
  onCreateSubtask: (title: string) => Promise<boolean>;
}

export function TaskHierarchySection({
  task,
  parent,
  children,
  parentCandidates,
  canContribute,
  pending,
  onOpenTask,
  onSetParent,
  onRemoveParent,
  onCreateSubtask
}: TaskHierarchySectionProps) {
  const [parentTaskId, setParentTaskId] = useState(parent?.id ?? "");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setParentTaskId(parent?.id ?? "");
    setSubtaskTitle("");
  }, [parent?.id, task.id]);

  async function submitParent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parentTaskId || pending) return;
    await onSetParent(parentTaskId);
  }

  async function createSubtask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = subtaskTitle.trim();
    if (!title || creating || pending) return;
    setCreating(true);
    try {
      if (await onCreateSubtask(title)) setSubtaskTitle("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="task-hierarchy-section" aria-labelledby="task-hierarchy-title">
      <div className="hierarchy-heading">
        <div>
          <h3 id="task-hierarchy-title">Sous-tâches</h3>
          <p>{children.length} enfant{children.length > 1 ? "s" : ""}</p>
        </div>
        <TaskHierarchyMeta parent={parent} childCount={children.length} />
      </div>

      {parent && (
        <div className="hierarchy-parent">
          <span>Parent</span>
          <button type="button" onClick={() => onOpenTask(parent.id)}>
            <strong>{parent.key}</strong>
            <span>{parent.title}</span>
          </button>
          {canContribute && (
            <button
              className="icon-button quiet"
              type="button"
              disabled={pending}
              aria-label="Retirer le parent"
              onClick={() => void onRemoveParent()}
            >×</button>
          )}
        </div>
      )}

      <div className="hierarchy-children">
        {children.map((child) => (
          <button type="button" key={child.id} onClick={() => onOpenTask(child.id)}>
            <span className={`status-dot status-dot-${child.status}`} aria-hidden="true" />
            <span>
              <strong>{child.key} · {child.title}</strong>
              <small>{child.status === "done" ? "Terminée" : "Ouvrir la sous-tâche"}</small>
            </span>
          </button>
        ))}
        {children.length === 0 && (
          <p className="empty-note">Cette tâche ne possède pas encore de sous-tâche.</p>
        )}
      </div>

      {canContribute && (
        <div className="hierarchy-actions">
          <form className="hierarchy-parent-form" onSubmit={submitParent}>
            <select
              value={parentTaskId}
              onChange={(event) => setParentTaskId(event.currentTarget.value)}
              disabled={pending || parentCandidates.length === 0}
              aria-label="Choisir la tâche parente"
            >
              <option value="">Choisir un parent…</option>
              {parentCandidates.map((candidate) => (
                <option value={candidate.id} key={candidate.id}>
                  {candidate.key} — {candidate.title}
                </option>
              ))}
            </select>
            <button
              className="text-button"
              type="submit"
              disabled={pending || !parentTaskId}
            >Rattacher</button>
          </form>

          <form className="hierarchy-create-form" onSubmit={createSubtask}>
            <input
              value={subtaskTitle}
              onChange={(event) => setSubtaskTitle(event.currentTarget.value)}
              maxLength={240}
              placeholder="Créer une sous-tâche…"
              aria-label="Titre de la nouvelle sous-tâche"
              disabled={creating || pending}
              required
            />
            <button
              className="primary-button small"
              type="submit"
              disabled={creating || pending}
            >{creating ? "Création…" : "Créer"}</button>
          </form>
        </div>
      )}
    </section>
  );
}
