import { type FormEvent, useState } from "react";
import type { ProjectLabel } from "../api";
import { useI18n } from "../i18n";

interface TaskLabelChipsProps {
  labels: ProjectLabel[];
}

export function TaskLabelChips({ labels }: TaskLabelChipsProps) {
  const { t } = useI18n();
  if (labels.length === 0) return null;

  return (
    <span className="task-label-chips" aria-label={t("Task labels")}>
      {labels.map((label) => (
        <span className="task-label-chip" key={label.id} title={label.name}>
          <i aria-hidden="true" style={{ backgroundColor: label.color }} />
          {label.name}
        </span>
      ))}
    </span>
  );
}

interface TaskLabelsSectionProps {
  labels: ProjectLabel[];
  assignedLabelIds: ReadonlySet<string>;
  pendingLabelIds: ReadonlySet<string>;
  canContribute: boolean;
  canDeleteLabels: boolean;
  onToggle: (label: ProjectLabel, assigned: boolean) => Promise<void>;
  onCreate: (name: string, color: string) => Promise<boolean>;
  onDelete: (label: ProjectLabel) => Promise<void>;
}

export function TaskLabelsSection({
  labels,
  assignedLabelIds,
  pendingLabelIds,
  canContribute,
  canDeleteLabels,
  onToggle,
  onCreate,
  onDelete
}: TaskLabelsSectionProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [creating, setCreating] = useState(false);
  const assignedLabels = labels.filter((label) => assignedLabelIds.has(label.id));

  async function createLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || !name.trim()) return;
    setCreating(true);
    try {
      if (await onCreate(name.trim(), color)) {
        setName("");
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteLabel(label: ProjectLabel) {
    if (!window.confirm(
      t("Delete label “{name}” from the project and all its tasks?", { name: label.name })
    )) return;
    await onDelete(label);
  }

  return (
    <section className="task-labels-section" aria-labelledby="task-labels-title">
      <div className="task-labels-heading">
        <div>
          <h3 id="task-labels-title">{t("Labels")}</h3>
          <p>{assignedLabels.length === 0
            ? t("No label assigned")
            : t(assignedLabels.length === 1 ? "{count} label" : "{count} labels", { count: assignedLabels.length })}</p>
        </div>
        <TaskLabelChips labels={assignedLabels} />
      </div>

      {canContribute && (
        <details className="label-manager">
          <summary>{t("Manage labels")}</summary>
          <div className="label-options">
            {labels.map((label) => {
              const pending = pendingLabelIds.has(label.id);
              return (
                <div className="label-option" key={label.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={assignedLabelIds.has(label.id)}
                      disabled={pending}
                      onChange={(event) => void onToggle(label, event.currentTarget.checked)}
                    />
                    <i aria-hidden="true" style={{ backgroundColor: label.color }} />
                    <span>{label.name}</span>
                  </label>
                  {canDeleteLabels && (
                    <button
                      className="icon-button quiet"
                      type="button"
                      disabled={pending}
                      aria-label={t("Delete label {name}", { name: label.name })}
                      onClick={() => void deleteLabel(label)}
                    >×</button>
                  )}
                </div>
              );
            })}
            {labels.length === 0 && (
              <p className="empty-note">{t("Create the first label for this project.")}</p>
            )}
          </div>

          <form className="label-create-form" onSubmit={createLabel}>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.currentTarget.value.toUpperCase())}
              aria-label={t("New label color")}
              disabled={creating || labels.length >= 64}
            />
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={80}
              placeholder={t("New label…")}
              aria-label={t("New label name")}
              disabled={creating || labels.length >= 64}
              required
            />
            <button
              className="primary-button small"
              type="submit"
              disabled={creating || labels.length >= 64}
            >{t(creating ? "Creating…" : "Create")}</button>
          </form>
        </details>
      )}
    </section>
  );
}

