import { useEffect, useState } from "react";
import { ApiError, api, type NativeAuthorizationRequest, type Session } from "./api";
import { AuthScreen } from "./components/AuthScreen";
import { InvitationScreen } from "./components/InvitationScreen";
import { NativeAuthorizationScreen } from "./components/NativeAuthorizationScreen";
import { Workspace } from "./components/Workspace";
import { LanguageSwitcher, useI18n } from "./i18n";

type AppState =
  | { mode: "loading" }
  | { mode: "auth"; bootstrapRequired: boolean; authorization?: NativeAuthorizationRequest }
  | { mode: "invite"; token: string }
  | { mode: "authorize"; request: NativeAuthorizationRequest; session: Session }
  | { mode: "workspace"; session: Session }
  | { mode: "error"; message: string };

function nativeAuthorizationRequest(): NativeAuthorizationRequest | "invalid" | undefined {
  if (window.location.pathname !== "/authorize") return undefined;

  const query = new URLSearchParams(window.location.search);
  const responseType = query.get("response_type");
  const clientId = query.get("client_id") ?? "";
  const redirectUri = query.get("redirect_uri") ?? "";
  const codeChallenge = query.get("code_challenge") ?? "";
  const codeChallengeMethod = query.get("code_challenge_method") ?? "";
  const state = query.get("state") ?? "";

  let callback: URL;
  try {
    callback = new URL(redirectUri);
  } catch {
    return "invalid";
  }
  const loopback = callback.hostname === "127.0.0.1" ||
    callback.hostname === "[::1]" || callback.hostname === "::1";
  const port = Number(callback.port);
  if (
    responseType !== "code" ||
    clientId !== "cytask-unreal" ||
    codeChallengeMethod !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(state) ||
    callback.protocol !== "http:" ||
    !loopback ||
    !Number.isInteger(port) || port < 1024 || port > 65535 ||
    callback.pathname !== "/cytask/oauth/callback" ||
    callback.search !== "" || callback.hash !== ""
  ) {
    return "invalid";
  }

  return { clientId, redirectUri, codeChallenge, codeChallengeMethod: "S256", state };
}

export default function App() {
  const { t } = useI18n();
  const [state, setState] = useState<AppState>({ mode: "loading" });

  useEffect(() => {
    let active = true;
    async function initialize() {
      const invitation = /^#\/invite\/([A-Za-z0-9_-]{40,128})$/.exec(window.location.hash);
      if (invitation) {
        setState({ mode: "invite", token: invitation[1]! });
        return;
      }

      const authorization = nativeAuthorizationRequest();
      if (authorization === "invalid") {
        setState({ mode: "error", message: "The Unreal sign-in request is invalid." });
        return;
      }

      try {
        const bootstrap = await api.bootstrapStatus();
        if (!active) return;
        if (bootstrap.required) {
          setState({ mode: "auth", bootstrapRequired: true, authorization });
          return;
        }

        try {
          const session = await api.me();
          if (active) {
            setState(authorization
              ? { mode: "authorize", request: authorization, session }
              : { mode: "workspace", session });
          }
        } catch (reason) {
          if (active && reason instanceof ApiError && reason.status === 401) {
            setState({ mode: "auth", bootstrapRequired: false, authorization });
          } else if (active) {
            throw reason;
          }
        }
      } catch {
        if (active) setState({ mode: "error", message: "The CyTask server cannot be reached." });
      }
    }
    void initialize();
    return () => { active = false; };
  }, []);

  if (state.mode === "loading") {
    return <div className="loading-screen"><span className="brand-mark pulse"><img src="/icons/cytask.png" alt="" /></span></div>;
  }

  if (state.mode === "error") {
    return (
      <main className="fatal-screen">
        <span className="brand-mark"><img src="/icons/cytask.png" alt="" /></span>
        <LanguageSwitcher />
        <h1>{t("Connection interrupted")}</h1>
        <p>{t(state.message)}</p>
        <button className="primary-button" onClick={() => window.location.reload()}>{t("Try again")}</button>
      </main>
    );
  }

  if (state.mode === "auth") {
    return (
      <AuthScreen
        bootstrapRequired={state.bootstrapRequired}
        onAuthenticated={(session) => setState(state.authorization
          ? { mode: "authorize", request: state.authorization, session }
          : { mode: "workspace", session })}
      />
    );
  }

  if (state.mode === "authorize") {
    return (
      <NativeAuthorizationScreen
        request={state.request}
        session={state.session}
        onCancel={() => {
          window.history.replaceState(null, "", "/");
          setState({ mode: "workspace", session: state.session });
        }}
      />
    );
  }


  if (state.mode === "invite") {
    return (
      <InvitationScreen
        token={state.token}
        onAccepted={(session) => {
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
          setState({ mode: "workspace", session });
        }}
        onCancel={() => {
          window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
          window.location.reload();
        }}
      />
    );
  }

  return (
    <Workspace
      session={state.session}
      onLogout={() => setState({ mode: "auth", bootstrapRequired: false })}
    />
  );
}
