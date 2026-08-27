import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type AiAssistantRunResult, type AiProviderConnection, type TaskPlugin } from "../api";

interface TaskAiAssistantPanelProps {
  taskId: string;
  plugin: TaskPlugin;
  canEdit: boolean;
  onSaved: (plugin: TaskPlugin) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const outputModes = ["Plan", "Résumé", "Checklist", "Commentaire", "Revue technique"];

export function TaskAiAssistantPanel({
  taskId,
  plugin,
  canEdit,
  onSaved,
  onError,
  onNotice
}: TaskAiAssistantPanelProps) {
  const [connections, setConnections] = useState<AiProviderConnection[]>([]);
  const [connectionId, setConnectionId] = useState(readString(plugin.data.connectionId));
  const [goal, setGoal] = useState(readString(plugin.data.goal));
  const [outputMode, setOutputMode] = useState(readString(plugin.data.outputMode) || "Plan");
  const [instructions, setInstructions] = useState(readString(plugin.data.instructions));
  const [includeComments, setIncludeComments] = useState(plugin.data.includeComments !== false);
  const [lastSummary, setLastSummary] = useState(readString(plugin.data.lastSummary));
  const [revision, setRevision] = useState(plugin.revision);
  const [result, setResult] = useState<AiAssistantRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const selectedConnection = useMemo(
    () => connections.find((item) => item.id === connectionId),
    [connectionId, connections]
  );

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.taskAiConnections(taskId);
      setConnections(items);
      setConnectionId((current) =>
        items.some((item) => item.id === current) ? current : items[0]?.id ?? ""
      );
    } catch (reason) {
      onError(messageFor(reason));
    } finally {
      setLoading(false);
    }
  }, [onError, taskId]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    setConnectionId(readString(plugin.data.connectionId));
    setGoal(readString(plugin.data.goal));
    setOutputMode(readString(plugin.data.outputMode) || "Plan");
    setInstructions(readString(plugin.data.instructions));
    setIncludeComments(plugin.data.includeComments !== false);
    setLastSummary(readString(plugin.data.lastSummary));
    setRevision(plugin.revision);
  }, [plugin.data, plugin.revision, taskId]);

  function data(summary = lastSummary) {
    return {
      connectionId,
      goal: goal.trim(),
      includeComments,
      outputMode,
      instructions: instructions.trim(),
      lastSummary: summary
    };
  }

  async function persist(summary = lastSummary) {
    const updated = await api.updateTaskPluginData(taskId, plugin.manifest.id, {
      data: data(summary),
      expectedRevision: revision
    });
    setRevision(updated.revision);
    onSaved(updated);
    return updated;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await persist();
      onNotice("Configuration de l’assistant enregistrée dans le ticket.");
    } catch (reason) {
      onError(messageFor(reason));
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    if (!selectedConnection || !goal.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const response = await api.runAiAssistant(taskId, {
        connectionId: selectedConnection.id,
        goal: goal.trim(),
        outputMode,
        instructions: instructions.trim(),
        includeComments
      });
      setResult(response);
      setLastSummary(response.text);
      await persist(response.text);
      onNotice(`Réponse reçue en ${formatDuration(response.durationMilliseconds)} et conservée dans le ticket.`);
    } catch (reason) {
      onError(messageFor(reason));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="task-ai-panel detail-section">
      <header className="task-plugin-heading">
        <span className="task-plugin-icon" aria-hidden="true">AI</span>
        <div>
          <h3>AI Assistant</h3>
          <p>Analyse ce ticket avec une connexion contrôlée par le projet.</p>
        </div>
        <span className="plugin-revision">rév. {revision}</span>
      </header>

      <form className="task-ai-form" onSubmit={save}>
        <label className="plugin-field">
          <span>Connexion IA</span>
          <select
            value={connectionId}
            disabled={!canEdit || saving || running || loading}
            required
            onChange={(event) => setConnectionId(event.currentTarget.value)}
          >
            <option value="">{loading ? "Chargement…" : "Choisir une connexion"}</option>
            {connections.map((connection) => (
              <option value={connection.id} key={connection.id}>
                {connection.name} · {providerLabel(connection.provider)} · {connection.model}
              </option>
            ))}
          </select>
          {selectedConnection && (
            <small>
              {selectedConnection.authenticationMode === "local-account"
                ? "Compte local du serveur · exécution lecture seule/plan"
                : selectedConnection.hasSecret
                  ? `Jeton chiffré ${selectedConnection.secretHint ?? ""}`
                  : selectedConnection.baseUrl}
            </small>
          )}
        </label>

        <label className="plugin-field">
          <span>Sortie attendue</span>
          <select value={outputMode} disabled={!canEdit || saving || running} onChange={(event) => setOutputMode(event.currentTarget.value)}>
            {outputModes.map((mode) => <option value={mode} key={mode}>{mode}</option>)}
          </select>
        </label>

        <label className="plugin-field plugin-field-wide">
          <span>Objectif</span>
          <textarea
            value={goal}
            disabled={!canEdit || saving || running}
            required
            rows={5}
            maxLength={12000}
            placeholder="Analyse le ticket et propose les prochaines étapes concrètes…"
            onChange={(event) => setGoal(event.currentTarget.value)}
          />
        </label>

        <label className="plugin-field plugin-field-wide">
          <span>Instructions de l’équipe</span>
          <textarea
            value={instructions}
            disabled={!canEdit || saving || running}
            rows={4}
            maxLength={12000}
            placeholder="Contraintes techniques, format de réponse, règles du projet…"
            onChange={(event) => setInstructions(event.currentTarget.value)}
          />
        </label>

        <label className="plugin-field plugin-field-checkbox">
          <input type="checkbox" checked={includeComments} disabled={!canEdit || saving || running} onChange={(event) => setIncludeComments(event.currentTarget.checked)} />
          <span>
            <strong>Inclure les commentaires</strong>
            <small>Les 100 commentaires les plus récents sont ajoutés au contexte.</small>
          </span>
        </label>

        {connections.length === 0 && !loading && (
          <p className="ai-empty-warning">
            Aucune connexion n’est configurée. Un administrateur doit en créer une dans Plugins.
          </p>
        )}

        <div className="task-ai-actions">
          <small>Le fournisseur reçoit uniquement le contexte affiché et les options ci-dessus.</small>
          {canEdit && (
            <div>
              <button className="secondary-button small" type="submit" disabled={saving || running}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button
                className="primary-button small"
                type="button"
                disabled={running || saving || !selectedConnection || !goal.trim()
                  || selectedConnection.localExecutionEnabled === false}
                onClick={() => void run()}
              >
                {running ? "Analyse en cours…" : "Lancer l’assistant"}
              </button>
            </div>
          )}
        </div>
      </form>

      {(result || lastSummary) && (
        <section className="ai-result">
          <header>
            <div>
              <span className="eyebrow">DERNIÈRE RÉPONSE</span>
              <strong>
                {result
                  ? `${providerLabel(result.provider)} · ${result.model} · ${formatDuration(result.durationMilliseconds)}`
                  : "Réponse conservée dans le ticket"}
              </strong>
            </div>
            <button className="secondary-button small" type="button" onClick={() => void navigator.clipboard.writeText(result?.text ?? lastSummary)}>
              Copier
            </button>
          </header>
          <pre>{result?.text ?? lastSummary}</pre>
        </section>
      )}
    </section>
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function providerLabel(provider: string) {
  return ({
    openai: "OpenAI",
    anthropic: "Anthropic",
    "openai-compatible": "API compatible",
    ollama: "Ollama",
    "lm-studio": "LM Studio",
    codex: "Codex",
    "claude-code": "Claude Code",
    opencode: "OpenCode"
  } as Record<string, string>)[provider] ?? provider;
}

function formatDuration(milliseconds: number) {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "L’assistant IA n’a pas pu terminer l’opération.";
}