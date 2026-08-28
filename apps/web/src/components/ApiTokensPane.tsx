import { type FormEvent, useEffect, useState } from "react";
import { api, type ApiToken, type CreatedApiToken } from "../api";
import { useI18n } from "../i18n";

interface ApiTokensPaneProps {
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function ApiTokensPane({ onClose, onError, onNotice }: ApiTokensPaneProps) {
  const { locale, t } = useI18n();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [created, setCreated] = useState<CreatedApiToken>();
  const [secretLabel, setSecretLabel] = useState(t("Copy token"));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.apiTokens().then(setTokens).catch(() => onError(t("Unable to load API tokens.")));
  }, [onError, t]);

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
      setSecretLabel(t("Copy token"));
      setTokens(await api.apiTokens());
      form.reset();
      onNotice(t("Token “{name}” created.", { name: result.token.name }));
    } catch {
      onError(t("Token creation failed. Check the name and active token limit."));
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(token: ApiToken) {
    try {
      await api.revokeApiToken(token.id);
      setTokens(await api.apiTokens());
      if (created?.token.id === token.id) setCreated(undefined);
      onNotice(t("Token “{name}” revoked.", { name: token.name }));
    } catch {
      onError(t("Revocation failed."));
    }
  }

  async function copySecret() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.secret);
      setSecretLabel(t("Token copied"));
    } catch {
      setSecretLabel(t("Select the token"));
    }
  }

  const activeTokens = tokens.filter((token) => !token.revokedAt);
  const revokedTokens = tokens.filter((token) => token.revokedAt);

  return (
    <aside className="detail-pane tokens-pane">
      <header className="detail-header">
        <span className="task-key">API</span>
        <button className="icon-button quiet" aria-label={t("Close")} onClick={onClose}>×</button>
      </header>
      <div className="detail-content">
        <h2>{t("API tokens")}</h2>
        <p className="description muted">
          {t("Use a token with the")} <code>Authorization: Bearer …</code> {t("header from a plugin, script or CI. Read scope rejects all changes. The complete contract is described by")} <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">openapi.json</a>.
        </p>

        {created && (
          <section className="token-secret" aria-live="polite">
            <h3>Jeton « {created.token.name} »</h3>
            <p>{t("Copy it now: it will never be shown again.")}</p>
            <code>{created.secret}</code>
            <div>
              <button className="primary-button small" type="button" onClick={() => void copySecret()}>
                {secretLabel}
              </button>
              <button className="text-button" type="button" onClick={() => setCreated(undefined)}>{t("Hide")}</button>
            </div>
          </section>
        )}

        <form className="token-form" onSubmit={createToken}>
          <input name="name" placeholder={t("Name · CI bot, Blender plugin…")} maxLength={80} required />
          <div className="token-form-row">
            <label>
              {t("Scope")}
              <select name="scope" defaultValue="read">
                <option value="read">{t("Read only")}</option>
                <option value="write">{t("Read and write")}</option>
              </select>
            </label>
            <label>
              {t("Expiration")}
              <select name="expiresInDays" defaultValue="90">
                <option value="7">{t("7 days")}</option>
                <option value="30">{t("30 days")}</option>
                <option value="90">{t("90 days")}</option>
                <option value="365">{t("1 year")}</option>
                <option value="0">{t("Never")}</option>
              </select>
            </label>
            <button className="primary-button small" type="submit" disabled={busy}>{t("Create")}</button>
          </div>
        </form>

        <section className="token-list" aria-label={t("Active tokens")}>
          <h3>{t("Active")} <span>{activeTokens.length}</span></h3>
          {activeTokens.map((token) => (
            <article className="token-row" key={token.id}>
              <span className="token-copy">
                <strong>{token.name}</strong>
                <small>
                  {token.scopes === "read" ? t("Read") : t("Read + write")}
                  {" · "}
                  {token.expiresAt ? t("expires on {date}", { date: new Date(token.expiresAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US") }) : t("no expiration")}
                  {" · "}
                  {token.lastUsedAt ? t("used {date}", { date: relativeDate(token.lastUsedAt, locale) }) : t("never used")}
                </small>
              </span>
              <button className="text-button danger" type="button" onClick={() => void revokeToken(token)}>
                {t("Revoke")}
              </button>
            </article>
          ))}
          {activeTokens.length === 0 && <p className="empty-note">{t("No active tokens.")}</p>}
        </section>

        {revokedTokens.length > 0 && (
          <details className="token-revoked">
            <summary>{t("Revoked or expired")} ({revokedTokens.length})</summary>
            {revokedTokens.map((token) => (
              <article className="token-row muted" key={token.id}>
                <span className="token-copy">
                  <strong>{token.name}</strong>
                  <small>{t("revoked")} {token.revokedAt ? relativeDate(token.revokedAt, locale) : ""}</small>
                </span>
              </article>
            ))}
          </details>
        )}
      </div>
    </aside>
  );
}

function relativeDate(value: string, locale: "en" | "fr"): string {
  const elapsed = Date.now() - Date.parse(value);
  const minutes = Math.round(elapsed / 60000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.round(hours / 24), "day");
}
