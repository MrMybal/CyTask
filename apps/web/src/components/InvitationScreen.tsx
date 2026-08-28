import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api, type InvitationPreview, type Session } from "../api";
import { LanguageSwitcher, useI18n } from "../i18n";

interface InvitationScreenProps {
  token: string;
  onAccepted: (session: Session) => void;
  onCancel: () => void;
}

export function InvitationScreen({ token, onAccepted, onCancel }: InvitationScreenProps) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<InvitationPreview>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.invitationPreview(token)
      .then((invitation) => {
        if (active) setPreview(invitation);
      })
      .catch(() => {
        if (active) setError(t("This invitation is invalid, expired or has already been used."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [t, token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const session = await api.acceptInvitation({
        token,
        displayName: String(data.get("displayName")),
        password: String(data.get("password"))
      });
      onAccepted(session);
    } catch (reason) {
      setError(reason instanceof ApiError
        ? t("This invitation is no longer available. Ask for a new link.")
        : t("Unable to join this workspace."));
    } finally {
      setPending(false);
    }
  }

  const roleLabel = preview
    ? t({ admin: "Administrator", member: "Member", viewer: "Viewer" }[preview.role])
    : "";

  return (
    <main className="auth-shell invitation-shell">
      <section className="auth-story">
        <a className="brand" href="/" aria-label="CyTask">
          <span className="brand-mark"><img src="/icons/cytask.png" alt="" /></span>
          <span>CyTask</span>
        </a>
        <div>
          <p className="eyebrow">{t("Secure invitation")}</p>
          <h1>{t("Join the work, without friction.")}</h1>
          <p className="hero-copy">{t("This link is personal, temporary and can only be used once.")}</p>
        </div>
        <p className="auth-footnote">{t("CyTask · Self-hosted workspace")}</p>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-language"><LanguageSwitcher /></div>
          <div>
            <p className="eyebrow">{t("New access")}</p>
            <h2>{loading
              ? t("Checking…")
              : preview ? t("Join {name}", { name: preview.organizationName }) : t("Link unavailable")}</h2>
            {preview && (
              <p className="muted">
                {t("Invitation for")} <strong>{preview.email}</strong> · {roleLabel}
              </p>
            )}
          </div>

          {preview && (
            <>
              <label>
                {t("Display name")}
                <input name="displayName" autoComplete="name" minLength={1} maxLength={80} required autoFocus />
              </label>
              <label>
                {t("Create a password")}
                <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required />
                <small>{t("At least 12 characters. Use a long, unique passphrase.")}</small>
              </label>
            </>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          {preview && (
            <button className="primary-button" disabled={pending} type="submit">
              {t(pending ? "Creating account…" : "Join workspace")}
            </button>
          )}
          {!loading && !preview && <button className="text-button" type="button" onClick={onCancel}>{t("Back to sign in")}</button>}
        </form>
      </section>
    </main>
  );
}
