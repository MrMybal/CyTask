import { type FormEvent, useEffect, useState } from "react";
import {
  api,
  type AgentMember,
  type CreatedAgentMember,
  type TaskOption
} from "../api";
import { useI18n } from "../i18n";
import { MarkdownComposer } from "./Markdown";

interface AgentsPaneProps {
  canAdminister: boolean;
  tasks: TaskOption[];
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function AgentsPane({
  canAdminister,
  tasks,
  onClose,
  onError,
  onNotice
}: AgentsPaneProps) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentMember[]>([]);
  const [created, setCreated] = useState<CreatedAgentMember>();
  const [copyLabel, setCopyLabel] = useState(t("Copy token"));
  const [endpointCopyLabel, setEndpointCopyLabel] = useState(t("Copy address"));
  const [busy, setBusy] = useState(false);
  const endpoint = window.location.origin;

  async function reload() {
    setAgents(await api.agents());
  }

  useEffect(() => {
    void reload().catch(() => onError(t("Unable to load agents.")));
  }, []); // The pane is mounted again when reopened.

  async function createAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      const result = await api.createAgent({
        key: String(data.get("key")),
        displayName: String(data.get("displayName")),
        description: String(data.get("description")),
        capabilities: String(data.get("capabilities"))
          .split(",").map((item) => item.trim()).filter(Boolean)
      });
      setCreated(result);
      setCopyLabel(t("Copy token"));
      form.reset();
      await reload();
      onNotice(t("Agent “{name}” created.", { name: result.agent.displayName }));
    } catch {
      onError(t("Unable to create the agent."));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(agent: AgentMember, status: AgentMember["status"]) {
    try {
      const updated = await api.updateAgentStatus(agent.userId, status);
      setAgents((current) => current.map((item) => item.userId === updated.userId ? updated : item));
      onNotice(t("Agent status updated."));
    } catch {
      onError(t("Unable to update the agent."));
    }
  }

  async function callAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const agentUserId = String(data.get("agentUserId"));
    try {
      await api.callAgent(agentUserId, {
        type: "work.requested",
        title: String(data.get("title")),
        body: String(data.get("body")),
        taskId: String(data.get("taskId")) || null
      });
      form.reset();
      onNotice(t("Call sent to the agent."));
    } catch {
      onError(t("Unable to call the agent."));
    }
  }

  async function copyToken() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.apiToken);
      setCopyLabel(t("Token copied"));
    } catch {
      setCopyLabel(t("Select the token"));
    }
  }

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setEndpointCopyLabel(t("Address copied"));
    } catch {
      setEndpointCopyLabel(t("Select the address"));
    }
  }

  return (
    <aside className="detail-pane agents-pane">
      <header className="detail-header">
        <span className="task-key">{t("AGENTS")}</span>
        <button className="icon-button quiet" aria-label={t("Close")} onClick={onClose}>×</button>
      </header>
      <div className="detail-content">
        <h2>{t("AI and automation members")}</h2>
        <p className="description muted">
          {t("Agents use a scoped API identity without an interactive password. They can receive calls, claim tasks and update the project through MCP or the SDK.")}
        </p>

        <section className="integration-endpoint">
          <span>
            <strong>{t("Connection address")}</strong>
            <small>{t("Use this address with the SDK or MCP while CyTask Desktop is open.")}</small>
          </span>
          <code>{endpoint}</code>
          <button className="text-button" type="button" onClick={() => void copyEndpoint()}>{endpointCopyLabel}</button>
        </section>

        {created && (
          <section className="token-secret" aria-live="polite">
            <h3>{created.agent.displayName}</h3>
            <p>{t("Copy it now: it will never be shown again.")}</p>
            <code>{created.apiToken}</code>
            <div>
              <button className="primary-button small" type="button" onClick={() => void copyToken()}>{copyLabel}</button>
              <button className="text-button" type="button" onClick={() => setCreated(undefined)}>{t("Hide")}</button>
            </div>
          </section>
        )}

        <section className="agent-list" aria-label={t("Agents")}>
          {agents.map((agent) => (
            <article className="agent-row" key={agent.userId}>
              <span className={`agent-presence ${agent.status}`} aria-hidden="true" />
              <span className="agent-copy">
                <strong>{agent.displayName}</strong>
                <small>@{agent.key}{agent.capabilities.length ? ` · ${agent.capabilities.join(" · ")}` : ""}</small>
              </span>
              {canAdminister ? (
                <select value={agent.status} aria-label={t("Agent status")}
                  onChange={(event) => void changeStatus(agent, event.target.value as AgentMember["status"])}>
                  <option value="active">{t("Active")}</option>
                  <option value="paused">{t("Paused")}</option>
                  <option value="disabled">{t("Disabled")}</option>
                </select>
              ) : <span className="role-badge">{t(agent.status)}</span>}
            </article>
          ))}
          {agents.length === 0 && <p className="empty-note">{t("No agent member yet.")}</p>}
        </section>

        {agents.some((agent) => agent.status !== "disabled") && (
          <section className="agent-section">
            <h3>{t("Call an agent")}</h3>
            <form className="agent-form" onSubmit={callAgent}>
              <select name="agentUserId" required defaultValue="">
                <option value="" disabled>{t("Choose an agent…")}</option>
                {agents.filter((agent) => agent.status !== "disabled").map((agent) => (
                  <option value={agent.userId} key={agent.userId}>{agent.displayName}</option>
                ))}
              </select>
              <input name="title" maxLength={160} required placeholder={t("Work request title")} />
              <MarkdownComposer name="body" maxLength={10000} placeholder={t("Instructions for the agent")} />
              <select name="taskId" defaultValue="">
                <option value="">{t("No linked task")}</option>
                {tasks.map((task) => <option value={task.id} key={task.id}>{task.key} · {task.title}</option>)}
              </select>
              <button className="primary-button small" type="submit">{t("Send call")}</button>
            </form>
          </section>
        )}

        {canAdminister && (
          <section className="agent-section">
            <h3>{t("Create an agent member")}</h3>
            <form className="agent-form" onSubmit={createAgent}>
              <div className="agent-form-row">
                <input name="displayName" maxLength={80} required placeholder={t("Display name")} />
                <input name="key" pattern="[a-z][a-z0-9-]{1,39}" maxLength={40} required placeholder="build-agent" />
              </div>
              <MarkdownComposer name="description" maxLength={2000} placeholder={t("Agent responsibility")} />
              <input name="capabilities" placeholder={t("Capabilities separated by commas")} />
              <button className="primary-button small" type="submit" disabled={busy}>{t("Create agent")}</button>
            </form>
          </section>
        )}
      </div>
    </aside>
  );
}
