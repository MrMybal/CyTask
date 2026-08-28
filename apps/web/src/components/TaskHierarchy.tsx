import { type FormEvent, useEffect, useState } from "react";
import type { TaskOption, WorkItem } from "../api";
import { useI18n } from "../i18n";

interface TaskHierarchyMetaProps {
  parent?: TaskOption;
  childCount: number;
}

export function TaskHierarchyMeta({ parent, childCount }: TaskHierarchyMetaProps) {
  const { t } = useI18n();
  if (!parent && childCount === 0) return null;

  return (
    <span className="task-hierarchy-meta" aria-label={t("Task hierarchy")}>
      {parent && <span title={t("Subtask of {key}", { key: parent.key })}>↳ {parent.key}</span>}
      {childCount > 0 && (
        <span>{t(childCount === 1 ? "{count} subtask" : "{count} subtasks", { count: childCount })}</span>
      )}
    </span>
  );
}

interface TaskHierarchySectionProps {
  task: WorkItem;
  parent?: TaskOption;
  children: TaskOption[];
  parentCandidates: TaskOption[];
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
  const { t } = useI18n();
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
          <h3 id="task-hierarchy-title">{t("Subtasks")}</h3>
          <p>{t(children.length === 1 ? "{count} child" : "{count} children", { count: children.length })}</p>
        </div>
        <TaskHierarchyMeta parent={parent} childCount={children.length} />
      </div>

      {parent && (
        <div className="hierarchy-parent">
          <span>{t("Parent")}</span>
          <button type="button" onClick={() => onOpenTask(parent.id)}>
            <strong>{parent.key}</strong>
            <span>{parent.title}</span>
          </button>
          {canContribute && (
            <button
              className="icon-button quiet"
              type="button"
              disabled={pending}
              aria-label={t("Remove parent")}
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
              <small>{t(child.status === "done" ? "Done" : "Open subtask")}</small>
            </span>
          </button>
        ))}
        {children.length === 0 && (
          <p className="empty-note">{t("This task has no subtasks yet.")}</p>
        )}
      </div>

      {canContribute && (
        <div className="hierarchy-actions">
          <form className="hierarchy-parent-form" onSubmit={submitParent}>
            <select
              value={parentTaskId}
              onChange={(event) => setParentTaskId(event.currentTarget.value)}
              disabled={pending || parentCandidates.length === 0}
              aria-label={t("Choose parent task")}
            >
              <option value="">{t("Choose a parent…")}</option>
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
            >{t("Attach")}</button>
          </form>

          <form className="hierarchy-create-form" onSubmit={createSubtask}>
            <input
              value={subtaskTitle}
              onChange={(event) => setSubtaskTitle(event.currentTarget.value)}
              maxLength={240}
              placeholder={t("Create a subtask…")}
              aria-label={t("New subtask title")}
              disabled={creating || pending}
              required
            />
            <button
              className="primary-button small"
              type="submit"
              disabled={creating || pending}
            >{t(creating ? "Creating…" : "Create")}</button>
          </form>
        </div>
      )}
    </section>
  );
}
