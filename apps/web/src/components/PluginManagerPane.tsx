import { useCallback, useEffect, useState } from "react";
import { api, type ProjectPlugin } from "../api";
import { AiConnectionManager } from "./AiConnectionManager";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
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
        onNotice(t("{name} disabled for this project.", { name: plugin.manifest.name }));
      } else {
        await api.enableProjectPlugin(projectId, plugin.manifest.id);
        onNotice(t("{name} enabled: its tabs are now available in tasks.", { name: plugin.manifest.name }));
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
          <span className="eyebrow">{t("PROJECT EXTENSIONS")}</span>
          <h2>Plugins CyTask</h2>
          <p>{t("Extensions add tabs and structured data without running third-party code in the browser.")}</p>
        </div>
        <span className="plugin-security-badge">{t("Validated manifest")}</span>
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
                  <span key={tab.id}>{tab.title} · {t(tab.fields.length === 1 ? "{count} field" : "{count} fields", { count: tab.fields.length })}</span>
                ))}
              </div>
              <small>{plugin.manifest.id} · API {plugin.manifest.apiVersion}</small>
            </div>
            <div className="plugin-card-actions">
              <span className={plugin.enabled ? "plugin-state active" : "plugin-state"}>
                {t(plugin.enabled ? "Enabled" : "Inactive")}
              </span>
              {canAdminister ? (
                <button
                  className={plugin.enabled ? "secondary-button small" : "primary-button small"}
                  type="button"
                  disabled={pendingId === plugin.manifest.id}
                  onClick={() => void toggle(plugin)}
                >
                  {pendingId === plugin.manifest.id
                    ? t("Updating…")
                    : t(plugin.enabled ? "Disable" : "Enable")}
                </button>
              ) : (
                <small>{t("Only an administrator can change extensions.")}</small>
              )}
            </div>
          </article>
        ))}
        {!loading && plugins.length === 0 && (
          <p className="empty-note">{t("No compatible plugin is published on this server.")}</p>
        )}
      </div>
      {plugins.some((plugin) =>
        plugin.manifest.id === "dev.cytask.ai-assistant" && plugin.enabled
      ) && (
        <AiConnectionManager
          projectId={projectId}
          canAdminister={canAdminister}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "The plugin operation failed.";
}
