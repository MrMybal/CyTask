import { type FormEvent, useState } from "react";
import { ApiError, api, type Session } from "../api";

interface AuthScreenProps {
  bootstrapRequired: boolean;
  onAuthenticated: (session: Session) => void;
}

export function AuthScreen({ bootstrapRequired, onAuthenticated }: AuthScreenProps) {
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
      setError(reason instanceof ApiError ? reason.message : "Connexion impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a className="brand" href="/" aria-label="CyTask, accueil">
          <span className="brand-mark"><img src="/icons/cytask.svg" alt="" /></span>
          <span>CyTask</span>
        </a>
        <div>
          <p className="eyebrow">Production connectée</p>
          <h1>Du travail clair, du commit à l’asset.</h1>
          <p className="hero-copy">
            Un espace rapide et auto-hébergeable pour piloter les tâches, les médias et Unreal.
          </p>
        </div>
        <p className="auth-footnote">Open source · Hébergeable · Extensible</p>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div>
            <p className="eyebrow">{bootstrapRequired ? "Première ouverture" : "Bon retour"}</p>
            <h2>{bootstrapRequired ? "Créer votre espace" : "Se connecter"}</h2>
            <p className="muted">
              {bootstrapRequired
                ? "Le premier compte devient propriétaire de l’installation."
                : "Accédez à votre espace de production."}
            </p>
          </div>

          {bootstrapRequired && (
            <>
              <label>
                Nom affiché
                <input name="displayName" autoComplete="name" minLength={1} maxLength={80} required />
              </label>
              <label>
                Organisation
                <input name="organizationName" autoComplete="organization" minLength={2} maxLength={120} required />
              </label>
            </>
          )}

          <label>
            Adresse e-mail
            <input name="email" type="email" autoComplete="email" maxLength={254} required />
          </label>
          <label>
            Mot de passe
            <input
              name="password"
              type="password"
              autoComplete={bootstrapRequired ? "new-password" : "current-password"}
              minLength={bootstrapRequired ? 12 : 1}
              maxLength={200}
              required
            />
            {bootstrapRequired && <small>12 caractères minimum. Une phrase longue fonctionne très bien.</small>}
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? "Un instant…" : bootstrapRequired ? "Initialiser CyTask" : "Continuer"}
          </button>
        </form>
      </section>
    </main>
  );
}
