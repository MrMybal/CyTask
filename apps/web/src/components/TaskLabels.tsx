import { type FormEvent, useState } from "react";
import type { ProjectLabel } from "../api";

interface TaskLabelChipsProps {
  labels: ProjectLabel[];
}

export function TaskLabelChips({ labels }: TaskLabelChipsProps) {
  if (labels.length === 0) return null;

  return (
    <span className="task-label-chips" aria-label="Labels de la tâche">
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
      `Supprimer le label « ${label.name} » du projet et de toutes ses tâches ?`
    )) return;
    await onDelete(label);
  }

  return (
    <section className="task-labels-section" aria-labelledby="task-labels-title">
      <div className="task-labels-heading">
        <div>
          <h3 id="task-labels-title">Labels</h3>
          <p>{assignedLabels.length === 0
            ? "Aucun label affecté"
            : `${assignedLabels.length} label${assignedLabels.length > 1 ? "s" : ""}`}</p>
        </div>
        <TaskLabelChips labels={assignedLabels} />
      </div>

      {canContribute && (
        <details className="label-manager">
          <summary>Gérer les labels</summary>
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
                      aria-label={`Supprimer le label ${label.name}`}
                      onClick={() => void deleteLabel(label)}
                    >×</button>
                  )}
                </div>
              );
            })}
            {labels.length === 0 && (
              <p className="empty-note">Créez le premier label de ce projet.</p>
            )}
          </div>

          <form className="label-create-form" onSubmit={createLabel}>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.currentTarget.value.toUpperCase())}
              aria-label="Couleur du nouveau label"
              disabled={creating || labels.length >= 64}
            />
            <input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={80}
              placeholder="Nouveau label…"
              aria-label="Nom du nouveau label"
              disabled={creating || labels.length >= 64}
              required
            />
            <button
              className="primary-button small"
              type="submit"
              disabled={creating || labels.length >= 64}
            >{creating ? "Création…" : "Créer"}</button>
          </form>
        </details>
      )}
    </section>
  );
}

