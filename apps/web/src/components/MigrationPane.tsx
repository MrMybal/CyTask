import { useState, type FormEvent } from "react";
import {
  ApiError,
  api,
  type MigrationImportResult,
  type MigrationPreview,
  type MigrationSource,
  type OrganizationMember,
  type ProjectStatus
} from "../api";
import { localizedStatusName, useI18n } from "../i18n";

interface MigrationPaneProps {
  projectId: string;
  statuses: ProjectStatus[];
  members: OrganizationMember[];
  onImported: () => void | Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

interface ImportOptions {
  importComments: boolean;
  importChecklists: boolean;
  createLabels: boolean;
  linkParents: boolean;
  linkDependencies: boolean;
}

const defaultOptions: ImportOptions = {
  importComments: true,
  importChecklists: true,
  createLabels: true,
  linkParents: true,
  linkDependencies: true
};

export function MigrationPane({
  projectId,
  statuses,
  members,
  onImported,
  onError,
  onNotice
}: MigrationPaneProps) {
  const { locale, t } = useI18n();
  const [source, setSource] = useState<MigrationSource>("clickup");
  const [preview, setPreview] = useState<MigrationPreview>();
  const [result, setResult] = useState<MigrationImportResult>();
  const [statusMappings, setStatusMappings] = useState<Record<string, string>>({});
  const [assigneeMappings, setAssigneeMappings] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<ImportOptions>(defaultOptions);
  const [busy, setBusy] = useState<"analyze" | "import">();

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("analyze");
    setPreview(undefined);
    setResult(undefined);
    try {
      const next = await api.analyzeMigration({
        source,
        targetProjectId: projectId,
        apiToken: String(data.get("apiToken") ?? ""),
        containerId: String(data.get("containerId") ?? ""),
        siteUrl: source === "jira" ? String(data.get("siteUrl") ?? "") : null,
        accountEmail: source === "jira" ? String(data.get("accountEmail") ?? "") : null,
        includeCompleted: data.get("includeCompleted") === "on",
        includeComments: data.get("includeComments") === "on",
        maxItems: Number(data.get("maxItems") ?? 500)
      });
      setPreview(next);
      setStatusMappings(Object.fromEntries(
        next.statuses.map(status => [status.name, status.suggestedTargetStatus])
      ));
      setAssigneeMappings(Object.fromEntries(
        next.assignees.map(person => [person.identity, person.suggestedMemberId ?? ""])
      ));
      const secret = form.elements.namedItem("apiToken");
      if (secret instanceof HTMLInputElement) secret.value = "";
      onNotice(t("Source analyzed. Review the mappings before importing."));
    } catch (reason) {
      onError(messageFor(reason, t("Unable to analyze the source.")));
    } finally {
      setBusy(undefined);
    }
  }

  async function runImport() {
    if (!preview || busy) return;
    setBusy("import");
    try {
      const next = await api.importMigration(preview.id, {
        statusMappings: preview.statuses.map(status => ({
          sourceStatus: status.name,
          targetStatus: statusMappings[status.name] ?? status.suggestedTargetStatus
        })),
        assigneeMappings: preview.assignees.map(person => ({
          sourceIdentity: person.identity,
          targetUserId: assigneeMappings[person.identity] || null
        })),
        ...options
      });
      setResult(next);
      await onImported();
      onNotice(t("Migration completed."));
    } catch (reason) {
      onError(messageFor(reason, t("Unable to import these tasks.")));
    } finally {
      setBusy(undefined);
    }
  }

  function selectSource(next: MigrationSource) {
    setSource(next);
    setPreview(undefined);
    setResult(undefined);
    setStatusMappings({});
    setAssigneeMappings({});
  }

  return (
    <section className="migration-pane">
      <header className="migration-intro">
        <div>
          <p className="eyebrow">{t("Migration tool")}</p>
          <h2>{t("Bring your existing work into CyTask")}</h2>
          <p>{t("Analyze the source, verify every mapping, then import without duplicating tasks already migrated.")}</p>
        </div>
        <div className="migration-security">
          <span aria-hidden="true">⌁</span>
          <div>
            <strong>{t("Ephemeral credentials")}</strong>
            <small>{t("Tokens are sent only to the CyTask server for this analysis and are never saved.")}</small>
          </div>
        </div>
      </header>

      <form className="migration-source-form" onSubmit={analyze}>
        <fieldset className="migration-source-picker">
          <legend>{t("Source")}</legend>
          <button
            type="button"
            className={source === "clickup" ? "migration-source active clickup" : "migration-source clickup"}
            onClick={() => selectSource("clickup")}
          >
            <span>CU</span>
            <strong>ClickUp</strong>
            <small>{t("Import one list, including its subtasks.")}</small>
          </button>
          <button
            type="button"
            className={source === "jira" ? "migration-source active jira" : "migration-source jira"}
            onClick={() => selectSource("jira")}
          >
            <span>JR</span>
            <strong>Jira Cloud</strong>
            <small>{t("Import every issue from one project.")}</small>
          </button>
        </fieldset>

        <div className="migration-fields">
          {source === "jira" && (
            <>
              <label>
                {t("Jira site")}
                <input
                  name="siteUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://your-team.atlassian.net"
                  required
                />
              </label>
              <label>
                {t("Jira account email")}
                <input name="accountEmail" type="email" autoComplete="username" required />
              </label>
            </>
          )}
          <label>
            {source === "jira" ? t("Project key") : t("ClickUp list ID")}
            <input
              name="containerId"
              placeholder={source === "jira" ? "GAME" : "901234567890"}
              maxLength={80}
              required
            />
          </label>
          <label>
            {source === "jira" ? t("Jira API token") : t("ClickUp personal token")}
            <input
              name="apiToken"
              type="password"
              autoComplete="new-password"
              maxLength={4096}
              required
            />
          </label>
          <label>
            {t("Maximum tasks")}
            <input name="maxItems" type="number" min={1} max={2000} defaultValue={500} required />
          </label>
        </div>

        <div className="migration-source-options">
          <label><input name="includeCompleted" type="checkbox" defaultChecked /> {t("Include completed tasks")}</label>
          <label><input name="includeComments" type="checkbox" defaultChecked /> {t("Analyze comments")}</label>
          <button className="primary-button" type="submit" disabled={busy !== undefined}>
            {busy === "analyze" ? t("Analyzing…") : t("Analyze source")}
          </button>
        </div>
      </form>

      {preview && (
        <>
          <section className="migration-preview-heading">
            <div>
              <p className="eyebrow">{preview.source === "jira" ? "Jira Cloud" : "ClickUp"}</p>
              <h3>{preview.sourceName}</h3>
              <small>{t("Preview expires at {time}", {
                time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" })
                  .format(new Date(preview.expiresAt))
              })}</small>
            </div>
            <div className="migration-metrics">
              <Metric value={preview.summary.tasks} label={t("Tasks")} />
              <Metric value={preview.summary.comments} label={t("Comments")} />
              <Metric value={preview.summary.checklistItems} label={t("Checklist")} />
              <Metric value={preview.summary.attachments} label={t("Linked files")} />
              <Metric value={preview.summary.parentRelations} label={t("Parents")} />
              <Metric value={preview.summary.dependencies} label={t("Dependencies")} />
            </div>
          </section>

          {preview.warnings.length > 0 && (
            <div className="migration-warnings">
              <strong>{t("Review notes")}</strong>
              {preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
            </div>
          )}

          <div className="migration-mapping-grid">
            <section className="migration-mapping-card">
              <header>
                <div>
                  <h3>{t("Status mapping")}</h3>
                  <p>{t("Keep CyTask statuses or create the source status with its original color.")}</p>
                </div>
                <span>{preview.statuses.length}</span>
              </header>
              <div className="migration-mapping-list">
                {preview.statuses.map(status => (
                  <label className="migration-map-row" key={status.name}>
                    <span className="migration-source-value">
                      <i style={{ backgroundColor: status.color }} />
                      <span><strong>{status.name}</strong><small>{t("{count} task(s)", { count: status.taskCount })}</small></span>
                    </span>
                    <span aria-hidden="true">→</span>
                    <select
                      value={statusMappings[status.name] ?? status.suggestedTargetStatus}
                      onChange={event => setStatusMappings(current => ({
                        ...current,
                        [status.name]: event.target.value
                      }))}
                    >
                      {statuses.map(target => (
                        <option value={target.key} key={target.key}>
                          {localizedStatusName(locale, target.key, target.name)}
                        </option>
                      ))}
                      <option value="__create__">{t("Create “{name}”", { name: status.name })}</option>
                    </select>
                  </label>
                ))}
              </div>
            </section>

            <section className="migration-mapping-card">
              <header>
                <div>
                  <h3>{t("Assignee mapping")}</h3>
                  <p>{t("Matching email addresses are selected automatically.")}</p>
                </div>
                <span>{preview.assignees.length}</span>
              </header>
              <div className="migration-mapping-list">
                {preview.assignees.length === 0 && <p className="empty-note">{t("No assignee found in the source.")}</p>}
                {preview.assignees.map(person => (
                  <label className="migration-map-row" key={person.identity}>
                    <span className="migration-source-value">
                      <b>{initials(person.displayName)}</b>
                      <span><strong>{person.displayName}</strong><small>{person.email ?? person.identity}</small></span>
                    </span>
                    <span aria-hidden="true">→</span>
                    <select
                      value={assigneeMappings[person.identity] ?? ""}
                      onChange={event => setAssigneeMappings(current => ({
                        ...current,
                        [person.identity]: event.target.value
                      }))}
                    >
                      <option value="">{t("Leave unassigned")}</option>
                      {members.map(member => (
                        <option value={member.userId} key={member.userId}>{member.displayName}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          </div>

          <section className="migration-preview-table">
            <header>
              <div>
                <h3>{t("Task preview")}</h3>
                <p>{t("Nothing is written to CyTask until you start the import.")}</p>
              </div>
              <span>{t("{count} shown", { count: preview.items.length })}</span>
            </header>
            <div className="migration-table-scroll">
              <table>
                <thead><tr>
                  <th>{t("Source")}</th>
                  <th>{t("Task")}</th>
                  <th>{t("Status")}</th>
                  <th>{t("Priority")}</th>
                  <th>{t("Assignees")}</th>
                  <th>{t("Content")}</th>
                </tr></thead>
                <tbody>
                  {preview.items.map(item => (
                    <tr key={item.sourceId}>
                      <td><code>{item.sourceKey}</code></td>
                      <td><strong>{item.title}</strong>{item.hasParent && <small>{t("Subtask")}</small>}</td>
                      <td>{item.status}</td>
                      <td>{t(item.priority.charAt(0).toUpperCase() + item.priority.slice(1))}</td>
                      <td>{item.assignees.join(", ") || "—"}</td>
                      <td>
                        <span title={t("Comments")}>◌ {item.commentCount}</span>
                        <span title={t("Checklist")}>✓ {item.checklistCount}</span>
                        <span title={t("Linked files")}>◇ {item.attachmentCount}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="migration-import-bar">
            <div className="migration-import-options">
              {([
                ["importComments", "Import comments"],
                ["importChecklists", "Import checklists"],
                ["createLabels", "Create source folders and labels"],
                ["linkParents", "Link parent tasks"],
                ["linkDependencies", "Link dependencies"]
              ] as const).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={event => setOptions(current => ({ ...current, [key]: event.target.checked }))}
                  />
                  {t(label)}
                </label>
              ))}
            </div>
            <div>
              <small>{t("A repeated import skips tasks already linked to this source.")}</small>
              <button className="primary-button" type="button" disabled={busy !== undefined} onClick={() => void runImport()}>
                {busy === "import" ? t("Importing…") : t("Import {count} tasks", { count: preview.summary.tasks })}
              </button>
            </div>
          </section>
        </>
      )}

      {result && (
        <section className="migration-result">
          <span className={result.failed > 0 ? "migration-result-icon warning" : "migration-result-icon"}>✓</span>
          <div>
            <p className="eyebrow">{t("Import report")}</p>
            <h3>{t("Migration completed")}</h3>
            <p>{t("{created} created · {skipped} skipped · {failed} failed", {
              created: result.created,
              skipped: result.skipped,
              failed: result.failed
            })}</p>
            <small>{t("{comments} comments · {checklist} checklist items · {labels} labels", {
              comments: result.commentsCreated,
              checklist: result.checklistItemsCreated,
              labels: result.labelsCreated
            })}</small>
          </div>
        </section>
      )}
    </section>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <span><strong>{value}</strong><small>{label}</small></span>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "?";
}

function messageFor(reason: unknown, fallback: string) {
  return reason instanceof ApiError ? reason.message : fallback;
}
