import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type AiProvider, type AiProviderConnection } from "../api";

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
  { id: "openai", label: "OpenAI", mode: "Jeton API chiffré" },
  { id: "anthropic", label: "Anthropic", mode: "Jeton API chiffré" },
  { id: "openai-compatible", label: "API compatible OpenAI", mode: "URL + jeton chiffré" },
  { id: "ollama", label: "Ollama", mode: "Serveur local", defaultUrl: "http://127.0.0.1:11434" },
  { id: "lm-studio", label: "LM Studio", mode: "Serveur local", defaultUrl: "http://127.0.0.1:1234/v1" },
  { id: "codex", label: "Codex CLI", mode: "Compte local du serveur" },
  { id: "claude-code", label: "Claude Code", mode: "Compte local du serveur" },
  { id: "opencode", label: "OpenCode", mode: "Compte local du serveur" }
];

export function AiConnectionManager({
  projectId,
  canAdminister,
  onError,
  onNotice
}: AiConnectionManagerProps) {
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
        onNotice("Connexion IA mise à jour.");
      } else {
        await api.createAiConnection(projectId, {
          name: name.trim(),
          provider,
          model: model.trim(),
          baseUrl: needsUrl ? baseUrl.trim() || null : null,
          secret: secret.trim() || null
        });
        onNotice("Connexion IA créée. Le secret n’est plus accessible depuis le navigateur.");
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
    if (!window.confirm(`Supprimer la connexion « ${connection.name} » ?`)) return;
    try {
      await api.deleteAiConnection(projectId, connection.id);
      if (editing?.id === connection.id) reset();
      await load();
      onNotice("Connexion IA supprimée.");
    } catch (reason) {
      onError(messageFor(reason));
    }
  }

  return (
    <section className="ai-connection-manager">
      <header className="ai-manager-heading">
        <div>
          <span className="eyebrow">AI ASSISTANT</span>
          <h3>Connexions du projet</h3>
          <p>
            Chaque ticket choisit un profil. Les jetons sont chiffrés côté serveur et ne sont
            jamais renvoyés au navigateur.
          </p>
        </div>
        <span className="ai-security-pill">Secrets chiffrés</span>
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
                  ? connection.hasSecret ? `Jeton ${connection.secretHint ?? "enregistré"}` : "Jeton manquant"
                  : connection.authenticationMode === "local-account"
                    ? "Compte connecté sur la machine serveur"
                    : connection.baseUrl}
              </small>
              {!connection.localExecutionEnabled && (
                <em>L’exécution locale doit être autorisée dans la configuration du serveur.</em>
              )}
            </div>
            {canAdminister && (
              <div className="ai-connection-actions">
                <button className="secondary-button small" type="button" onClick={() => beginEdit(connection)}>
                  Modifier
                </button>
                <button className="text-button" type="button" onClick={() => void remove(connection)}>
                  Supprimer
                </button>
              </div>
            )}
          </article>
        ))}
        {!loading && connections.length === 0 && (
          <p className="empty-note">Aucune connexion IA. Ajoutez un fournisseur ci-dessous.</p>
        )}
      </div>

      {canAdminister ? (
        <form className="ai-connection-form" onSubmit={save}>
          <div className="ai-form-heading">
            <strong>{editing ? "Modifier la connexion" : "Nouvelle connexion"}</strong>
            {editing && <button className="text-button" type="button" onClick={reset}>Annuler</button>}
          </div>
          <label>
            <span>Nom du profil</span>
            <input value={name} maxLength={120} required placeholder="Production · OpenAI" onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <label>
            <span>Fournisseur</span>
            <select value={provider} onChange={(event) => changeProvider(event.currentTarget.value as AiProvider)}>
              {providerOptions.map((item) => (
                <option value={item.id} key={item.id}>{item.label}</option>
              ))}
            </select>
            <small>{selectedProvider.mode}</small>
          </label>
          <label>
            <span>Modèle</span>
            <input value={model} maxLength={200} required placeholder="Nom exact du modèle" onChange={(event) => setModel(event.currentTarget.value)} />
          </label>
          {needsUrl && (
            <label>
              <span>URL du serveur</span>
              <input type="url" value={baseUrl} maxLength={2048} required placeholder="https://ai.example.org/v1" onChange={(event) => setBaseUrl(event.currentTarget.value)} />
            </label>
          )}
          {needsSecret && (
            <label className="ai-secret-field">
              <span>Jeton API</span>
              <input
                type="password"
                value={secret}
                maxLength={8192}
                required={!editing?.hasSecret}
                autoComplete="new-password"
                placeholder={editing?.hasSecret ? "Laisser vide pour conserver le jeton" : "Coller le jeton"}
                onChange={(event) => setSecret(event.currentTarget.value)}
              />
              <small>Le jeton est envoyé une seule fois et stocké chiffré.</small>
            </label>
          )}
          {selectedProvider.id === "codex" || selectedProvider.id === "claude-code" || selectedProvider.id === "opencode" ? (
            <p className="ai-local-note">
              CyTask utilisera le compte déjà connecté à ce CLI sur le serveur. Aucun fichier
              d’authentification n’est lu ni transmis au client.
            </p>
          ) : null}
          <div className="ai-form-actions">
            <button className="primary-button small" type="submit" disabled={saving}>
              {saving ? "Enregistrement…" : editing ? "Enregistrer" : "Ajouter la connexion"}
            </button>
          </div>
        </form>
      ) : (
        <p className="empty-note">Seul un administrateur peut gérer les connexions et les jetons.</p>
      )}
    </section>
  );
}

function providerLabel(provider: AiProvider) {
  return providerOptions.find((item) => item.id === provider)?.label ?? provider;
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "La connexion IA n’a pas pu être mise à jour.";
}