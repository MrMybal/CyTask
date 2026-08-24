import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api, type InvitationPreview, type Session } from "../api";

interface InvitationScreenProps {
  token: string;
  onAccepted: (session: Session) => void;
  onCancel: () => void;
}

const roleLabels: Record<InvitationPreview["role"], string> = {
  admin: "Administrateur",
  member: "Membre",
  viewer: "Lecteur"
};

export function InvitationScreen({ token, onAccepted, onCancel }: InvitationScreenProps) {
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
        if (active) setError("Cette invitation est invalide, expirée ou déjà utilisée.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [token]);

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
        ? "L’invitation n’est plus disponible. Demandez un nouveau lien."
        : "Impossible de rejoindre cet espace.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell invitation-shell">
      <section className="auth-story">
        <a className="brand" href="/" aria-label="CyTask, accueil">
          <span className="brand-mark"><img src="/icons/cytask.svg" alt="" /></span>
          <span>CyTask</span>
        </a>
        <div>
          <p className="eyebrow">Invitation sécurisée</p>
          <h1>Rejoignez le travail, sans friction.</h1>
          <p className="hero-copy">Ce lien est personnel, temporaire et ne peut être utilisé qu’une fois.</p>
        </div>
        <p className="auth-footnote">CyTask · Espace auto-hébergé</p>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div>
            <p className="eyebrow">Nouvel accès</p>
            <h2>{loading ? "Vérification…" : preview ? `Rejoindre ${preview.organizationName}` : "Lien indisponible"}</h2>
            {preview && (
              <p className="muted">
                Invitation pour <strong>{preview.email}</strong> · {roleLabels[preview.role]}
              </p>
            )}
          </div>

          {preview && (
            <>
              <label>
                Nom affiché
                <input name="displayName" autoComplete="name" minLength={1} maxLength={80} required autoFocus />
              </label>
              <label>
                Créer un mot de passe
                <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required />
                <small>12 caractères minimum. Utilisez une phrase longue et unique.</small>
              </label>
            </>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          {preview && (
            <button className="primary-button" disabled={pending} type="submit">
              {pending ? "Création du compte…" : "Rejoindre l’espace"}
            </button>
          )}
          {!loading && !preview && <button className="text-button" type="button" onClick={onCancel}>Retour à la connexion</button>}
        </form>
      </section>
    </main>
  );
}
