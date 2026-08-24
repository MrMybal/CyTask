import { useState } from "react";
import {
  ApiError,
  api,
  type NativeAuthorizationRequest,
  type Session
} from "../api";

interface NativeAuthorizationScreenProps {
  request: NativeAuthorizationRequest;
  session: Session;
  onCancel: () => void;
}

function callbackLabel(value: string): string {
  try {
    const callback = new URL(value);
    return `${callback.hostname}:${callback.port}`;
  } catch {
    return "callback invalide";
  }
}

export function NativeAuthorizationScreen({
  request,
  session,
  onCancel
}: NativeAuthorizationScreenProps) {
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
        throw new Error("Le serveur a retourné un callback inattendu.");
      }
      window.location.replace(callback.toString());
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "L’autorisation a échoué.");
      setPending(false);
    }
  }

  return (
    <main className="native-auth-shell">
      <section className="native-auth-card">
        <a className="brand" href="/" aria-label="CyTask, accueil">
          <span className="brand-mark"><img src="/icons/cytask.svg" alt="" /></span>
          <span>CyTask</span>
        </a>

        <div>
          <p className="eyebrow">Connexion à l’éditeur</p>
          <h1>Autoriser CyTask pour Unreal Engine ?</h1>
          <p className="muted">
            Le plugin agira avec les droits du compte <strong>{session.displayName}</strong>
            {` (${session.role})`}.
          </p>
        </div>

        <div className="native-auth-client">
          <span className="native-auth-icon">UE</span>
          <div>
            <strong>CyTask Unreal</strong>
            <small>Retour local vers {callbackLabel(request.redirectUri)}</small>
          </div>
        </div>

        <div className="native-auth-permissions">
          <p>Cette connexion permettra au plugin de :</p>
          <ul>
            <li>consulter les projets, tâches, commentaires et pièces jointes ;</li>
            <li>créer ou modifier selon votre rôle dans l’espace ;</li>
            <li>préparer les recettes d’assets explicitement confirmées dans Unreal.</li>
          </ul>
        </div>

        <p className="security-note native-auth-note">
          Aucun mot de passe n’est transmis au plugin. Le code de retour expire rapidement,
          ne fonctionne qu’une fois et reste lié à la preuve PKCE créée par Unreal.
        </p>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="native-auth-actions">
          <button className="text-button" type="button" onClick={onCancel} disabled={pending}>
            Annuler
          </button>
          <button className="primary-button" type="button" onClick={() => void authorize()} disabled={pending}>
            {pending ? "Autorisation…" : "Autoriser et revenir à Unreal"}
          </button>
        </div>
      </section>
    </main>
  );
}
