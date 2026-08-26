import { useCallback, useEffect, useState } from "react";
import { api, type ProjectPlugin } from "../api";

interface PluginManagerPaneProps {
  projectId: string;
  canAdminister: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onChanged: () => void;
}

export function PluginManagerPane({
  projectId,
  canAdminister,
  onError,
  onNotice,
  onChanged
}: PluginManagerPaneProps) {
  const [plugins, setPlugins] = useState<ProjectPlugin[]>([]);
  const [pendingId, setPendingId] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlugins(await api.projectPlugins(projectId));
    } catch (reason) {
      onError(messageFor(reason));
    } finally {
      setLoading(false);
    }
  }, [onError, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(plugin: ProjectPlugin) {
    setPendingId(plugin.manifest.id);
    try {
      if (plugin.enabled) {
        await api.disableProjectPlugin(projectId, plugin.manifest.id);
        onNotice(`${plugin.manifest.name} désactivé pour ce projet.`);
      } else {
        await api.enableProjectPlugin(projectId, plugin.manifest.id);
        onNotice(`${plugin.manifest.name} activé : ses onglets sont disponibles dans les tickets.`);
      }
      await load();
      onChanged();
    } catch (reason) {
      onError(messageFor(reason));
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <section className="plugin-manager" aria-busy={loading}>
      <header className="plugin-manager-heading">
        <div>
          <span className="eyebrow">EXTENSIONS DU PROJET</span>
          <h2>Plugins CyTask</h2>
          <p>Les extensions ajoutent des onglets et des données structurées sans exécuter de code tiers dans le navigateur.</p>
        </div>
        <span className="plugin-security-badge">Manifeste validé</span>
      </header>

      <div className="plugin-card-grid">
        {plugins.map((plugin) => (
          <article className={plugin.enabled ? "plugin-card enabled" : "plugin-card"} key={plugin.manifest.id}>
            <div className="plugin-card-icon" aria-hidden="true">
              {plugin.manifest.contributes.taskTabs[0]?.icon ?? "PL"}
            </div>
            <div className="plugin-card-copy">
              <div className="plugin-card-title">
                <h3>{plugin.manifest.name}</h3>
                <span>v{plugin.manifest.version}</span>
              </div>
              <p>{plugin.manifest.description}</p>
              <div className="plugin-contributions">
                {plugin.manifest.contributes.taskTabs.map((tab) => (
                  <span key={tab.id}>{tab.title} · {tab.fields.length} champs</span>
                ))}
              </div>
              <small>{plugin.manifest.id} · API {plugin.manifest.apiVersion}</small>
            </div>
            <div className="plugin-card-actions">
              <span className={plugin.enabled ? "plugin-state active" : "plugin-state"}>
                {plugin.enabled ? "Activé" : "Inactif"}
              </span>
              {canAdminister ? (
                <button
                  className={plugin.enabled ? "secondary-button small" : "primary-button small"}
                  type="button"
                  disabled={pendingId === plugin.manifest.id}
                  onClick={() => void toggle(plugin)}
                >
                  {pendingId === plugin.manifest.id
                    ? "Mise à jour…"
                    : plugin.enabled ? "Désactiver" : "Activer"}
                </button>
              ) : (
                <small>Seul un administrateur peut modifier les extensions.</small>
              )}
            </div>
          </article>
        ))}
        {!loading && plugins.length === 0 && (
          <p className="empty-note">Aucun plugin compatible n’est publié sur ce serveur.</p>
        )}
      </div>
    </section>
  );
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "L’opération sur le plugin a échoué.";
}
