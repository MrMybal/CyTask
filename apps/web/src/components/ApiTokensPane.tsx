import { type FormEvent, useEffect, useState } from "react";
import { api, type ApiToken, type CreatedApiToken } from "../api";

interface ApiTokensPaneProps {
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function ApiTokensPane({ onClose, onError, onNotice }: ApiTokensPaneProps) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [created, setCreated] = useState<CreatedApiToken>();
  const [secretLabel, setSecretLabel] = useState("Copier le jeton");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.apiTokens().then(setTokens).catch(() => onError("Impossible de charger les jetons d’API."));
  }, [onError]);

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const expires = Number(data.get("expiresInDays"));
    setBusy(true);
    try {
      const result = await api.createApiToken({
        name: String(data.get("name")),
        scope: data.get("scope") === "write" ? "write" : "read",
        ...(expires > 0 ? { expiresInDays: expires } : {})
      });
      setCreated(result);
      setSecretLabel("Copier le jeton");
      setTokens(await api.apiTokens());
      form.reset();
      onNotice(`Jeton « ${result.token.name} » créé.`);
    } catch {
      onError("La création du jeton a échoué. Vérifiez le nom et la limite de jetons actifs.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(token: ApiToken) {
    try {
      await api.revokeApiToken(token.id);
      setTokens(await api.apiTokens());
      if (created?.token.id === token.id) setCreated(undefined);
      onNotice(`Jeton « ${token.name} » révoqué.`);
    } catch {
      onError("La révocation a échoué.");
    }
  }

  async function copySecret() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.secret);
      setSecretLabel("Jeton copié");
    } catch {
      setSecretLabel("Sélectionnez le jeton");
    }
  }

  const activeTokens = tokens.filter((token) => !token.revokedAt);
  const revokedTokens = tokens.filter((token) => token.revokedAt);

  return (
    <aside className="detail-pane tokens-pane">
      <header className="detail-header">
        <span className="task-key">API</span>
        <button className="icon-button quiet" aria-label="Fermer" onClick={onClose}>×</button>
      </header>
      <div className="detail-content">
        <h2>Jetons d’API</h2>
        <p className="description muted">
          Un jeton s’utilise avec l’en-tête <code>Authorization: Bearer …</code> depuis un plugin,
          un script ou une CI. La portée « lecture » refuse toute modification.
          Le contrat complet est décrit par <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">openapi.json</a>.
        </p>

        {created && (
          <section className="token-secret" aria-live="polite">
            <h3>Jeton « {created.token.name} »</h3>
            <p>Copiez-le maintenant : il ne sera plus jamais affiché.</p>
            <code>{created.secret}</code>
            <div>
              <button className="primary-button small" type="button" onClick={() => void copySecret()}>
                {secretLabel}
              </button>
              <button className="text-button" type="button" onClick={() => setCreated(undefined)}>Masquer</button>
            </div>
          </section>
        )}

        <form className="token-form" onSubmit={createToken}>
          <input name="name" placeholder="Nom · Robot CI, plugin Blender…" maxLength={80} required />
          <div className="token-form-row">
            <label>
              Portée
              <select name="scope" defaultValue="read">
                <option value="read">Lecture seule</option>
                <option value="write">Lecture et écriture</option>
              </select>
            </label>
            <label>
              Expiration
              <select name="expiresInDays" defaultValue="90">
                <option value="7">7 jours</option>
                <option value="30">30 jours</option>
                <option value="90">90 jours</option>
                <option value="365">1 an</option>
                <option value="0">Jamais</option>
              </select>
            </label>
            <button className="primary-button small" type="submit" disabled={busy}>Créer</button>
          </div>
        </form>

        <section className="token-list" aria-label="Jetons actifs">
          <h3>Actifs <span>{activeTokens.length}</span></h3>
          {activeTokens.map((token) => (
            <article className="token-row" key={token.id}>
              <span className="token-copy">
                <strong>{token.name}</strong>
                <small>
                  {token.scopes === "read" ? "Lecture" : "Lecture + écriture"}
                  {" · "}
                  {token.expiresAt ? `expire le ${new Date(token.expiresAt).toLocaleDateString("fr-FR")}` : "sans expiration"}
                  {" · "}
                  {token.lastUsedAt ? `utilisé ${relativeDate(token.lastUsedAt)}` : "jamais utilisé"}
                </small>
              </span>
              <button className="text-button danger" type="button" onClick={() => void revokeToken(token)}>
                Révoquer
              </button>
            </article>
          ))}
          {activeTokens.length === 0 && <p className="empty-note">Aucun jeton actif.</p>}
        </section>

        {revokedTokens.length > 0 && (
          <details className="token-revoked">
            <summary>Révoqués ou expirés ({revokedTokens.length})</summary>
            {revokedTokens.map((token) => (
              <article className="token-row muted" key={token.id}>
                <span className="token-copy">
                  <strong>{token.name}</strong>
                  <small>révoqué {token.revokedAt ? relativeDate(token.revokedAt) : ""}</small>
                </span>
              </article>
            ))}
          </details>
        )}
      </div>
    </aside>
  );
}

function relativeDate(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  const minutes = Math.round(elapsed / 60000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  return `il y a ${days} j`;
}
