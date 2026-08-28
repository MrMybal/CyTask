import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type ProjectLabel, type ProjectResource, type TaskOption } from "../api";
import { ProjectCanvas } from "./ProjectCanvas";
import { useI18n } from "../i18n";

interface Props {
  resource: ProjectResource;
  labels: ProjectLabel[];
  tasks: TaskOption[];
  canContribute: boolean;
  onClose: () => void;
  onSaved: (resource: ProjectResource) => void;
  onOpenTask: (taskId: string) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function ResourceEditor({
  resource,
  labels,
  tasks,
  canContribute,
  onClose,
  onSaved,
  onOpenTask,
  onError,
  onNotice
}: Props) {
  const { t } = useI18n();
  const [draftBody, setDraftBody] = useState(resource.body);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraftBody(resource.body);
  }, [resource.id, resource.body]);
  const canvasChanged = useCallback((value: string) => setDraftBody(value), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    try {
      const updated = await api.updateProjectResource(resource.id, {
        name: String(data.get("name")),
        body: draftBody,
        folderLabelId: String(data.get("folderLabelId")) || null,
        expectedRevision: resource.revision
      });
      onSaved(updated);
      onNotice(t("Shared content saved."));
    } catch {
      onError(t("Unable to save this content. Reload it if it was edited elsewhere."));
    } finally {
      setSaving(false);
    }
  }

  if (resource.resourceType === "file") {
    const contentUrl = api.resourceContentUrl(resource.id);
    const type = resource.detectedContentType ?? resource.declaredContentType ?? "";
    return (
      <aside className="resource-editor">
        <header>
          <div><small>{t("FILE")}</small><h2>{resource.name}</h2></div>
          <button className="icon-button quiet" type="button" onClick={onClose}>×</button>
        </header>
        <div className="resource-preview">
          {resource.status === "available" && type.startsWith("image/") && (
            <img src={contentUrl} alt={resource.name} />
          )}
          {resource.status === "available" && type.startsWith("video/") && (
            <video src={contentUrl} controls preload="metadata" playsInline />
          )}
          {resource.status === "available" && !type.startsWith("image/") && !type.startsWith("video/") && (
            <div className="generic-file-preview"><span>F</span><strong>{resource.name}</strong></div>
          )}
          {resource.status === "rejected" && (
            <p className="resource-rejected">{resource.rejectionReason ?? t("This file was rejected.")}</p>
          )}
          {resource.status === "uploading" && <p>{t("Upload or verification in progress…")}</p>}
        </div>
        {resource.status === "available" && (
          <a className="primary-button" href={contentUrl} download={resource.name}>{t("Download")}</a>
        )}
      </aside>
    );
  }

  return (
    <aside className="resource-editor resource-editor-rich">
      <form onSubmit={save}>
        <header>
          <div>
            <small>{t(resource.resourceType === "canvas" ? "SHARED CANVAS" : "SHARED DOCUMENT")}</small>
            <input name="name" defaultValue={resource.name} maxLength={240} required readOnly={!canContribute} />
          </div>
          <div>
            {canContribute && <button className="primary-button small" type="submit" disabled={saving}>
              {t(saving ? "Saving…" : "Save")}
            </button>}
            <button className="icon-button quiet" type="button" onClick={onClose}>×</button>
          </div>
        </header>
        <label className="resource-folder-field">
          {t("Folder")}
          <select name="folderLabelId" defaultValue={resource.folderLabelId ?? ""} disabled={!canContribute}>
            <option value="">{t("Workspace root")}</option>
            {labels.map((label) => <option value={label.id} key={label.id}>{label.name}</option>)}
          </select>
        </label>
        {resource.resourceType === "document" ? (
          <textarea
            className="resource-document-editor"
            value={draftBody}
            onChange={(event) => setDraftBody(event.currentTarget.value)}
            readOnly={!canContribute}
            placeholder={t("Start writing… Markdown is supported.")}
          />
        ) : (
          <ProjectCanvas
            projectId={resource.projectId}
            storageId={resource.id}
            initialState={resource.body}
            tasks={tasks}
            onOpenTask={onOpenTask}
            onBoardChange={canContribute ? canvasChanged : undefined}
          />
        )}
      </form>
    </aside>
  );
}
