import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type AiProvider, type AiProviderConnection } from "../api";
import { useI18n } from "../i18n";

interface AiConnectionManagerProps {
  projectId: string;
  canAdminister: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const providerOptions: Array<{
  id: AiProvider;
  label: string;
  mode: string;
  defaultUrl?: string;
}> = [
  { id: "openai", label: "OpenAI", mode: "Encrypted API token" },
  { id: "anthropic", label: "Anthropic", mode: "Encrypted API token" },
  { id: "openai-compatible", label: "API compatible OpenAI", mode: "URL + encrypted token" },
  { id: "ollama", label: "Ollama", mode: "Local server", defaultUrl: "http://127.0.0.1:11434" },
  { id: "lm-studio", label: "LM Studio", mode: "Local server", defaultUrl: "http://127.0.0.1:1234/v1" },
  { id: "codex", label: "Codex CLI", mode: "Server local account" },
  { id: "claude-code", label: "Claude Code", mode: "Server local account" },
  { id: "opencode", label: "OpenCode", mode: "Server local account" }
];

export function AiConnectionManager({
  projectId,
  canAdminister,
  onError,
  onNotice
}: AiConnectionManagerProps) {
  const { t } = useI18n();
  const [connections, setConnections] = useState<AiProviderConnection[]>([]);
  const [editing, setEditing] = useState<AiProviderConnection | null>(null);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedProvider = useMemo(
    () => providerOptions.find((item) => item.id === provider)!,
    [provider]
  );
  const needsSecret = provider === "openai"
    || provider === "anthropic"
    || provider === "openai-compatible";
  const needsUrl = provider === "openai-compatible"
    || provider === "ollama"
    || provider === "lm-studio";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConnections(await api.aiConnections(projectId));
    } catch (reason) {
      onError(messageFor(reason));
    } finally {
      setLoading(false);
    }
  }, [onError, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function reset() {
    setEditing(null);
    setProvider("openai");
    setName("");
    setModel("");
    setBaseUrl("");
    setSecret("");
  }

  function beginEdit(connection: AiProviderConnection) {
    setEditing(connection);
    setProvider(connection.provider);
    setName(connection.name);
    setModel(connection.model);
    setBaseUrl(connection.baseUrl ?? "");
    setSecret("");
  }

  function changeProvider(next: AiProvider) {
    setProvider(next);
    const definition = providerOptions.find((item) => item.id === next);
    if (!editing || editing.provider !== next) setBaseUrl(definition?.defaultUrl ?? "");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.updateAiConnection(projectId, editing.id, {
          name: name.trim(),
          provider,
          model: model.trim(),
          baseUrl: needsUrl ? baseUrl.trim() || null : null,
          secret: secret.trim() || null,
          clearSecret: false,
          expectedRevision: editing.revision
        });
        onNotice(t("AI connection updated."));
      } else {
        await api.createAiConnection(projectId, {
          name: name.trim(),
          provider,
          model: model.trim(),
          baseUrl: needsUrl ? baseUrl.trim() || null : null,
          secret: secret.trim() || null
        });
        onNotice(t("AI connection created. The secret is no longer accessible from the browser."));
      }
      reset();
      await load();
    } catch (reason) {
      onError(messageFor(reason));
    } finally {
      setSaving(false);
    }
  }

  async function remove(connection: AiProviderConnection) {
    if (!window.confirm(t("Delete connection “{name}”?", { name: connection.name }))) return;
    try {
      await api.deleteAiConnection(projectId, connection.id);
      if (editing?.id === connection.id) reset();
      await load();
      onNotice(t("AI connection deleted."));
    } catch (reason) {
      onError(messageFor(reason));
    }
  }

  return (
    <section className="ai-connection-manager">
      <header className="ai-manager-heading">
        <div>
          <span className="eyebrow">AI ASSISTANT</span>
          <h3>{t("Project connections")}</h3>
          <p>
            {t("Each task chooses a profile. Tokens are encrypted server-side and never returned to the browser.")}
          </p>
        </div>
        <span className="ai-security-pill">{t("Encrypted secrets")}</span>
      </header>

      <div className="ai-connection-list" aria-busy={loading}>
        {connections.map((connection) => (
          <article className="ai-connection-card" key={connection.id}>
            <span className="ai-provider-mark" aria-hidden="true">
              {providerLabel(connection.provider).slice(0, 2).toUpperCase()}
            </span>
            <div className="ai-connection-copy">
              <strong>{connection.name}</strong>
              <span>{providerLabel(connection.provider)} · {connection.model}</span>
              <small>
                {connection.authenticationMode === "api-token"
                  ? connection.hasSecret ? t("Token {hint}", { hint: connection.secretHint ?? t("saved") }) : t("Missing token")
                  : connection.authenticationMode === "local-account"
                    ? t("Account connected on the server machine")
                    : connection.baseUrl}
              </small>
              {!connection.localExecutionEnabled && (
                <em>{t("Local execution must be enabled in the server configuration.")}</em>
              )}
            </div>
            {canAdminister && (
              <div className="ai-connection-actions">
                <button className="secondary-button small" type="button" onClick={() => beginEdit(connection)}>
                  {t("Edit")}
                </button>
                <button className="text-button" type="button" onClick={() => void remove(connection)}>
                  {t("Delete")}
                </button>
              </div>
            )}
          </article>
        ))}
        {!loading && connections.length === 0 && (
          <p className="empty-note">{t("No AI connection. Add a provider below.")}</p>
        )}
      </div>

      {canAdminister ? (
        <form className="ai-connection-form" onSubmit={save}>
          <div className="ai-form-heading">
            <strong>{t(editing ? "Edit connection" : "New connection")}</strong>
            {editing && <button className="text-button" type="button" onClick={reset}>{t("Cancel")}</button>}
          </div>
          <label>
            <span>{t("Profile name")}</span>
            <input value={name} maxLength={120} required placeholder="Production · OpenAI" onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <label>
            <span>{t("Provider")}</span>
            <select value={provider} onChange={(event) => changeProvider(event.currentTarget.value as AiProvider)}>
              {providerOptions.map((item) => (
                <option value={item.id} key={item.id}>{item.label}</option>
              ))}
            </select>
            <small>{t(selectedProvider.mode)}</small>
          </label>
          <label>
            <span>{t("Model")}</span>
            <input value={model} maxLength={200} required placeholder={t("Exact model name")} onChange={(event) => setModel(event.currentTarget.value)} />
          </label>
          {needsUrl && (
            <label>
              <span>{t("Server URL")}</span>
              <input type="url" value={baseUrl} maxLength={2048} required placeholder="https://ai.example.org/v1" onChange={(event) => setBaseUrl(event.currentTarget.value)} />
            </label>
          )}
          {needsSecret && (
            <label className="ai-secret-field">
              <span>{t("API token")}</span>
              <input
                type="password"
                value={secret}
                maxLength={8192}
                required={!editing?.hasSecret}
                autoComplete="new-password"
                placeholder={t(editing?.hasSecret ? "Leave blank to keep the token" : "Paste the token")}
                onChange={(event) => setSecret(event.currentTarget.value)}
              />
              <small>{t("The token is sent once and stored encrypted.")}</small>
            </label>
          )}
          {selectedProvider.id === "codex" || selectedProvider.id === "claude-code" || selectedProvider.id === "opencode" ? (
            <p className="ai-local-note">
              {t("CyTask will use the account already connected to this CLI on the server. No authentication file is read or sent to the client.")}
            </p>
          ) : null}
          <div className="ai-form-actions">
            <button className="primary-button small" type="submit" disabled={saving}>
              {t(saving ? "Saving…" : editing ? "Save" : "Add connection")}
            </button>
          </div>
        </form>
      ) : (
        <p className="empty-note">{t("Only an administrator can manage connections and tokens.")}</p>
      )}
    </section>
  );
}

function providerLabel(provider: AiProvider) {
  return providerOptions.find((item) => item.id === provider)?.label ?? provider;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "The AI connection could not be updated.";
}