import { useState } from "react";
import {
  ApiError,
  api,
  type NativeAuthorizationRequest,
  type Session
} from "../api";
import { LanguageSwitcher, useI18n } from "../i18n";

interface NativeAuthorizationScreenProps {
  request: NativeAuthorizationRequest;
  session: Session;
  onCancel: () => void;
}

function callbackLabel(value: string, invalidLabel: string): string {
  try {
    const callback = new URL(value);
    return callback.hostname + ":" + callback.port;
  } catch {
    return invalidLabel;
  }
}

export function NativeAuthorizationScreen({
  request,
  session,
  onCancel
}: NativeAuthorizationScreenProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function authorize() {
    setPending(true);
    setError("");
    try {
      const result = await api.createNativeAuthorization(request);
      const expected = new URL(request.redirectUri);
      const callback = new URL(result.redirectUri);
      if (
        callback.protocol !== expected.protocol ||
        callback.hostname !== expected.hostname ||
        callback.port !== expected.port ||
        callback.pathname !== expected.pathname ||
        callback.searchParams.get("state") !== request.state ||
        !callback.searchParams.has("code")
      ) {
        throw new Error("Unexpected callback returned by the server.");
      }
      window.location.replace(callback.toString());
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t("Authorization failed."));
      setPending(false);
    }
  }

  return (
    <main className="native-auth-shell">
      <section className="native-auth-card">
        <div className="native-auth-topline">
          <a className="brand" href="/" aria-label="CyTask">
            <span className="brand-mark"><img src="/icons/cytask.png" alt="" /></span>
            <span>CyTask</span>
          </a>
          <LanguageSwitcher />
        </div>

        <div>
          <p className="eyebrow">{t("Editor sign-in")}</p>
          <h1>{t("Authorize CyTask for Unreal Engine?")}</h1>
          <p className="muted">
            {t("The plugin will use the permissions of")} <strong>{session.displayName}</strong>
            {" (" + session.role + ")"}.
          </p>
        </div>

        <div className="native-auth-client">
          <span className="native-auth-icon">UE</span>
          <div>
            <strong>CyTask Unreal</strong>
            <small>{t("Local return to")} {callbackLabel(request.redirectUri, t("invalid callback"))}</small>
          </div>
        </div>

        <div className="native-auth-permissions">
          <p>{t("This connection lets the plugin:")}</p>
          <ul>
            <li>{t("view projects, tasks, comments and attachments;")}</li>
            <li>{t("create or edit according to your workspace role;")}</li>
            <li>{t("prepare asset recipes explicitly confirmed in Unreal.")}</li>
          </ul>
        </div>

        <p className="security-note native-auth-note">
          {t("No password is sent to the plugin. The return code expires quickly, works only once and remains bound to the PKCE proof created by Unreal.")}
        </p>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="native-auth-actions">
          <button className="text-button" type="button" onClick={onCancel} disabled={pending}>{t("Cancel")}</button>
          <button className="primary-button" type="button" onClick={() => void authorize()} disabled={pending}>
            {t(pending ? "Authorizing…" : "Authorize and return to Unreal")}
          </button>
        </div>
      </section>
    </main>
  );
}
