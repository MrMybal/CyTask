import { type FormEvent, useState } from "react";
import { ApiError, api, type Session } from "../api";
import { LanguageSwitcher, useI18n } from "../i18n";

interface AuthScreenProps {
  bootstrapRequired: boolean;
  onAuthenticated: (session: Session) => void;
}

export function AuthScreen({ bootstrapRequired, onAuthenticated }: AuthScreenProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);

    try {
      const session = bootstrapRequired
        ? await api.bootstrap({
            email: String(data.get("email")),
            displayName: String(data.get("displayName")),
            password: String(data.get("password")),
            organizationName: String(data.get("organizationName"))
          })
        : await api.login({
            email: String(data.get("email")),
            password: String(data.get("password"))
          });
      onAuthenticated(session);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("Unable to sign in."));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a className="brand" href="/" aria-label="CyTask">
          <span className="brand-mark"><img src="/icons/cytask.png" alt="" /></span>
          <span>CyTask</span>
        </a>
        <div>
          <p className="eyebrow">{t("Connected production")}</p>
          <h1>{t("Clear work, from commit to asset.")}</h1>
          <p className="hero-copy">{t("A fast, self-hosted workspace for tasks, media and Unreal.")}</p>
        </div>
        <p className="auth-footnote">{t("Open source · Self-hosted · Extensible")}</p>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-language"><LanguageSwitcher /></div>
          <div>
            <p className="eyebrow">{t(bootstrapRequired ? "First launch" : "Welcome back")}</p>
            <h2>{t(bootstrapRequired ? "Create your workspace" : "Sign in")}</h2>
            <p className="muted">
              {t(bootstrapRequired
                ? "The first account becomes the owner of this installation."
                : "Open your production workspace.")}
            </p>
          </div>

          {bootstrapRequired && (
            <>
              <label>
                {t("Display name")}
                <input name="displayName" autoComplete="name" minLength={1} maxLength={80} required />
              </label>
              <label>
                {t("Organization")}
                <input name="organizationName" autoComplete="organization" minLength={2} maxLength={120} required />
              </label>
            </>
          )}

          <label>
            {t("Email address")}
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
          <label>
            {t("Password")}
            <input
              name="password"
              type="password"
              autoComplete={bootstrapRequired ? "new-password" : "current-password"}
              minLength={bootstrapRequired ? 12 : 1}
              maxLength={200}
              required
            />
            {bootstrapRequired && <small>{t("At least 12 characters. A long passphrase works very well.")}</small>}
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? t("Just a moment…") : t(bootstrapRequired ? "Initialize CyTask" : "Continue")}
          </button>
        </form>
      </section>
    </main>
  );
}
