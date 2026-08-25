import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import {
  api,
  type ProjectLabel,
  type ProjectResource,
  type TaskOption
} from "../api";
import { uploadProjectFile } from "../resourceUpload";
import { ResourceEditor } from "./ResourceEditor";
import { ResourceLibraryTable } from "./ResourceLibraryTable";

interface Props {
  projectId: string;
  labels: ProjectLabel[];
  tasks: TaskOption[];
  selectedFolderId?: string;
  canContribute: boolean;
  onOpenTask: (taskId: string) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export function ProjectContentPane({
  projectId,
  labels,
  tasks,
  selectedFolderId,
  canContribute,
  onOpenTask,
  onError,
  onNotice
}: Props) {
  const [resources, setResources] = useState<ProjectResource[]>([]);
  const [selected, setSelected] = useState<ProjectResource>();
  const [filter, setFilter] = useState<"all" | ProjectResource["resourceType"]>("all");
  const [showAllFolders, setShowAllFolders] = useState(!selectedFolderId);
  const [creating, setCreating] = useState<"document" | "canvas">();
  const [loading, setLoading] = useState(true);
  const [dropActive, setDropActive] = useState(false);
  const [progress, setProgress] = useState<{ label: string; percent: number }>();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResources(await api.projectResources(projectId));
    } catch {
      onError("Impossible de charger les contenus de l’espace.");
    } finally {
      setLoading(false);
    }
  }, [onError, projectId]);

  useEffect(() => {
    setSelected(undefined);
    setShowAllFolders(!selectedFolderId);
    void load();
  }, [load, selectedFolderId]);

  useEffect(() => {
    const stream = new EventSource("/api/v1/events");
    const refresh = () => void load();
    stream.addEventListener("project.resource_created", refresh);
    stream.addEventListener("project.resource_updated", refresh);
    stream.addEventListener("project.resource_available", refresh);
    return () => stream.close();
  }, [load]);

  const visible = useMemo(() => resources.filter((resource) =>
    (filter === "all" || resource.resourceType === filter)
    && (showAllFolders || resource.folderLabelId === (selectedFolderId ?? null))
  ), [filter, resources, selectedFolderId, showAllFolders]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creating) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const resource = await api.createProjectResource(projectId, {
        resourceType: creating,
        name: String(data.get("name")),
        body: creating === "canvas" ? JSON.stringify({ version: 1, objects: [], strokes: [] }) : "",
        folderLabelId: String(data.get("folderLabelId")) || null
      });
      setResources((current) => [resource, ...current]);
      setSelected(resource);
      setCreating(undefined);
      onNotice(creating === "canvas" ? "Canvas partagé créé." : "Document partagé créé.");
    } catch {
      onError("Impossible de créer ce contenu.");
    }
  }

  async function uploadFiles(files: File[]) {
    if (!canContribute || files.length === 0 || progress) return;
    try {
      for (const file of files) {
        setProgress({ label: file.name, percent: 0 });
        const resource = await uploadProjectFile(
          projectId,
          selectedFolderId ?? null,
          file,
          (label, percent) => setProgress({ label: file.name + " · " + label, percent })
        );
        setResources((current) => [resource, ...current.filter((item) => item.id !== resource.id)]);
      }
      onNotice(files.length > 1 ? "Fichiers ajoutés à l’espace." : "Fichier ajouté à l’espace.");
    } catch {
      onError("Impossible d’envoyer ce fichier.");
    } finally {
      setProgress(undefined);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function drag(event: DragEvent<HTMLElement>) {
    if (!canContribute || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }

  return (
    <section
      className={dropActive ? "project-content-pane drop-active" : "project-content-pane"}
      onDragEnter={drag}
      onDragOver={drag}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropActive(false);
        void uploadFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {dropActive && <div className="space-file-drop"><strong>Déposer dans l’espace</strong><span>Images, vidéos et fichiers</span></div>}
      <header className="content-pane-header">
        <div>
          <p className="eyebrow">CONTENUS DE L’ESPACE</p>
          <h2>Documents, canvas et fichiers</h2>
          <p>Les pièces jointes du chat peuvent utiliser cette même bibliothèque.</p>
        </div>
        {canContribute && (
          <div className="content-pane-actions">
            <button type="button" onClick={() => setCreating("document")}>+ Document</button>
            <button type="button" onClick={() => setCreating("canvas")}>+ Canvas</button>
            <button className="primary-button small" type="button" onClick={() => fileInput.current?.click()}>
              Importer
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => void uploadFiles(Array.from(event.currentTarget.files ?? []))}
            />
          </div>
        )}
      </header>

      {creating && (
        <form className="resource-create-form" onSubmit={create}>
          <strong>Nouveau {creating === "canvas" ? "canvas" : "document"}</strong>
          <input name="name" placeholder="Nom du contenu" maxLength={240} required autoFocus />
          <select name="folderLabelId" defaultValue={selectedFolderId ?? ""}>
            <option value="">Racine de l’espace</option>
            {labels.map((label) => <option value={label.id} key={label.id}>{label.name}</option>)}
          </select>
          <button className="primary-button small" type="submit">Créer</button>
          <button className="text-button" type="button" onClick={() => setCreating(undefined)}>Annuler</button>
        </form>
      )}

      <div className="content-filter-bar">
        <div className="content-type-tabs" role="group" aria-label="Filtrer les contenus">
          {(["all", "document", "canvas", "file"] as const).map((type) => (
            <button
              className={filter === type ? "active" : ""}
              type="button"
              key={type}
              onClick={() => setFilter(type)}
            >{{ all: "Tout", document: "Documents", canvas: "Canvas", file: "Fichiers" }[type]}</button>
          ))}
        </div>
        {selectedFolderId && (
          <label><input type="checkbox" checked={showAllFolders} onChange={(event) => setShowAllFolders(event.currentTarget.checked)} /> Tous les dossiers</label>
        )}
      </div>

      {progress && (
        <div className="resource-upload-progress" role="status">
          <span>{progress.label}</span><progress value={progress.percent} max={100} />
        </div>
      )}
      {loading ? <div className="content-loading">Chargement des contenus…</div> : (
        <ResourceLibraryTable
          resources={visible}
          labels={labels}
          selectedResourceId={selected?.id}
          onOpen={setSelected}
        />
      )}

      {selected && (
        <ResourceEditor
          resource={selected}
          labels={labels}
          tasks={tasks}
          canContribute={canContribute}
          onClose={() => setSelected(undefined)}
          onSaved={(resource) => {
            setSelected(resource);
            setResources((current) => current.map((item) => item.id === resource.id ? resource : item));
          }}
          onOpenTask={onOpenTask}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}
