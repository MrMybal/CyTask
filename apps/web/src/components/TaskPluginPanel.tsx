import { useEffect, useState, type FormEvent } from "react";
import { api, type PluginFieldDefinition, type PluginTaskTabDefinition, type TaskPlugin } from "../api";
import { TaskAiAssistantPanel } from "./TaskAiAssistantPanel";
import { TaskCyAnnotaPanel } from "./TaskCyAnnotaPanel";

interface TaskPluginPanelProps {
  taskId: string;
  plugin: TaskPlugin;
  tab: PluginTaskTabDefinition;
  canEdit: boolean;
  onSaved: (plugin: TaskPlugin) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function TaskPluginPanel(props: TaskPluginPanelProps) {
  if (props.plugin.manifest.id === "dev.cytask.ai-assistant") {
    return (
      <TaskAiAssistantPanel
        taskId={props.taskId}
        plugin={props.plugin}
        canEdit={props.canEdit}
        onSaved={props.onSaved}
        onError={props.onError}
        onNotice={props.onNotice}
      />
    );
  }
  if (props.plugin.manifest.id === "dev.cytask.cyannota") {
    return (
      <TaskCyAnnotaPanel
        taskId={props.taskId}
        canEdit={props.canEdit}
        onError={props.onError}
        onNotice={props.onNotice}
      />
    );
  }
  return <GenericTaskPluginPanel {...props} />;
}
function GenericTaskPluginPanel({
  taskId,
  plugin,
  tab,
  canEdit,
  onSaved,
  onError,
  onNotice
}: TaskPluginPanelProps) {
  const [values, setValues] = useState<Record<string, unknown>>(plugin.data);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(plugin.data);
  }, [plugin.data, plugin.revision, taskId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const clean = Object.fromEntries(tab.fields.map((field) => [
        field.key,
        normalizeValue(field, values[field.key])
      ]));
      const updated = await api.updateTaskPluginData(taskId, plugin.manifest.id, {
        data: clean,
        expectedRevision: plugin.revision
      });
      onSaved(updated);
      onNotice(`Données ${plugin.manifest.name} enregistrées.`);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "L’enregistrement du plugin a échoué.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="task-plugin-panel detail-section">
      <header className="task-plugin-heading">
        <span className="task-plugin-icon" aria-hidden="true">{tab.icon}</span>
        <div>
          <h3>{tab.title}</h3>
          <p>{plugin.manifest.description}</p>
        </div>
        <span className="plugin-revision">rév. {plugin.revision}</span>
      </header>

      <form className="task-plugin-form" onSubmit={save}>
        {tab.fields.map((field) => (
          <PluginField
            key={field.key}
            field={field}
            value={values[field.key]}
            disabled={!canEdit || saving}
            onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
          />
        ))}
        <div className="task-plugin-actions">
          <small>
            Schéma {plugin.manifest.id} · les champs inconnus sont refusés par le serveur.
          </small>
          {canEdit && (
            <button className="primary-button small" type="submit" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function PluginField({
  field,
  value,
  disabled,
  onChange
}: {
  field: PluginFieldDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const text = field.type === "string-list"
    ? Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : ""
    : typeof value === "string" || typeof value === "number" ? String(value) : "";

  if (field.type === "boolean") {
    return (
      <label className="plugin-field plugin-field-checkbox">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>
          <strong>{field.label}</strong>
          {field.description && <small>{field.description}</small>}
        </span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="plugin-field">
        <span>{field.label}</span>
        <select
          value={text}
          required={field.required}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Non défini</option>
          {(field.options ?? []).map((option) => <option value={option} key={option}>{option}</option>)}
        </select>
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }

  const multiline = field.type === "textarea" || field.type === "string-list";
  return (
    <label className={multiline ? "plugin-field plugin-field-wide" : "plugin-field"}>
      <span>{field.label}</span>
      {multiline ? (
        <textarea
          value={text}
          required={field.required}
          disabled={disabled}
          rows={field.type === "textarea" ? 6 : 4}
          maxLength={field.type === "string-list" ? undefined : field.maxLength ?? undefined}
          placeholder={field.placeholder ?? undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      ) : (
        <input
          type={field.type === "number" ? "number" : "text"}
          value={text}
          required={field.required}
          disabled={disabled}
          maxLength={field.maxLength ?? undefined}
          placeholder={field.placeholder ?? undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
      {field.description && <small>{field.description}</small>}
    </label>
  );
}

function normalizeValue(field: PluginFieldDefinition, value: unknown): unknown {
  if (field.type === "string-list") {
    const source = Array.isArray(value) ? value.join("\n") : String(value ?? "");
    return source.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }
  if (field.type === "number") {
    if (value === "" || value === undefined || value === null) return 0;
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }
  if (field.type === "boolean") return value === true;
  return typeof value === "string" ? value.trim() : "";
}
