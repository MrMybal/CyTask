import { useCallback, useEffect, useState } from "react";
import { api, type ProjectResource, type TaskOption } from "../api";
import { useI18n } from "../i18n";
import { ProjectCanvas } from "./ProjectCanvas";

interface Props {
  projectId: string;
  tasks: TaskOption[];
  canEdit: boolean;
  onOpenTask: (id: string) => void;
  onError: (message: string) => void;
}

export function SharedProjectCanvas({ projectId, tasks, canEdit, onOpenTask, onError }: Props) {
  const { t } = useI18n();
  const [resource, setResource] = useState<ProjectResource>();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const changed = useCallback((body: string) => setDraft(body), []);
  useEffect(() => {
    let active = true;
    void (async () => {
      const items = await api.projectResources(projectId);
      let canvas = items.find(item => item.resourceType === "canvas"
        && item.folderLabelId === null && item.name === "Project canvas");
      if (!canvas && canEdit) {
        let body = JSON.stringify({ version: 1, objects: [], strokes: [] });
        try { body = localStorage.getItem(`cytask.canvas.v1.${projectId}`) || body; } catch { /* Empty cache. */ }
        canvas = await api.createProjectResource(projectId, {
          name: "Project canvas", resourceType: "canvas", body, folderLabelId: null
        });
      }
      if (active) { setResource(canvas); setDraft(canvas?.body ?? ""); }
    })().catch(() => { if (active) onError(t("Unable to load workspace contents.")); });
    return () => { active = false; };
  }, [projectId, canEdit, onError, t]);

  async function save() {
    if (!resource || saving || !canEdit) return;
    setSaving(true);
    try {
      setResource(await api.updateProjectResource(resource.id, {
        name: resource.name, body: draft, folderLabelId: resource.folderLabelId,
        expectedRevision: resource.revision
      }));
    } catch { onError(t("Unable to save this content. Reload it if it was edited elsewhere.")); }
    finally { setSaving(false); }
  }

  return <section className="shared-project-canvas">
    {canEdit && resource && <button type="button" className="primary-button small"
      disabled={saving || draft === resource.body} onClick={() => void save()}>
      {t(saving ? "Saving…" : "Save")}
    </button>}
    {resource ? <ProjectCanvas key={resource.id} projectId={projectId} storageId={resource.id}
      initialState={resource.body} tasks={tasks} onOpenTask={onOpenTask}
      canEdit={canEdit} onBoardChange={canEdit ? changed : undefined} />
      : <p>{t(canEdit ? "Loading…" : "No shared canvas yet.")}</p>}
  </section>;
}
