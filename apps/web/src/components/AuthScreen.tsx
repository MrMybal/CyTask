import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api, type Session, type MfaChallenge } from "../api";
import {MfaFlow} from "./MfaFlow";
import { LanguageSwitcher, useI18n } from "../i18n";

interface AuthScreenProps {
  bootstrapRequired: boolean;
  onAuthenticated: (session: Session) => void;
}

export function AuthScreen({ bootstrapRequired, onAuthenticated }: AuthScreenProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [challenge,setChallenge]=useState<MfaChallenge>();
  useEffect(()=>{let active=true;void api.mfaPending().then(result=>{if(active&&result.challenge)setChallenge(current=>current??result.challenge!);}).catch(()=>undefined);return()=>{active=false;};},[]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));

    if (bootstrapRequired && password !== String(data.get("confirmPassword"))) {
      setError(t("Passwords do not match."));
      return;
    }

    setPending(true);

    try {
      const session = bootstrapRequired
        ? await api.bootstrap({
            email: String(data.get("email")),
            displayName: String(data.get("displayName")),
            password,
            organizationName: String(data.get("organizationName"))
          })
        : await api.login({
            email: String(data.get("email")),
            password
          });
      if("mfaRequired" in session){setChallenge(session.challenge);event.currentTarget?.reset();}else onAuthenticated(session);
    } catch (reason) {
      setError(reason instanceof ApiError ? t(reason.message) : t("Unable to sign in."));
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
        {challenge?<div className="auth-card"><div className="auth-language"><LanguageSwitcher/></div><MfaFlow initial={challenge} onComplete={onAuthenticated} onCancel={()=>{setChallenge(undefined);window.location.reload();}}/></div>:<form className="auth-card" onSubmit={submit}>
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
              aria-label={t("Password")}
              type="password"
              autoComplete={bootstrapRequired ? "new-password" : "current-password"}
              minLength={bootstrapRequired ? 12 : 1}
              maxLength={200}
              required
            />
            {bootstrapRequired && <small>{t("At least 12 characters. A long passphrase works very well.")}</small>}
          </label>

          {bootstrapRequired && (
            <label>
              {t("Confirm password")}
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={200}
                required
              />
            </label>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? t("Just a moment…") : t(bootstrapRequired ? "Initialize CyTask" : "Continue")}
          </button>
        </form>}
      </section>
    </main>
  );
}
