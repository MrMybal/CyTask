import type { FormEvent } from "react";
import type { ProjectLabel } from "../api";

export interface ProjectFolderTreeProps {
  labels: ProjectLabel[];
  counts: ReadonlyMap<string, number>;
  selectedLabelId?: string;
  editorParentId: string | null | undefined;
  canCreate: boolean;
  onSelect: (labelId: string) => void;
  onStartCreate: (parentLabelId: string | null) => void;
  onCancelCreate: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
}

interface FolderNode extends ProjectLabel {
  children: FolderNode[];
}

export function ProjectFolderTree({
  labels,
  counts,
  selectedLabelId,
  editorParentId,
  canCreate,
  onSelect,
  onStartCreate,
  onCancelCreate,
  onCreate
}: ProjectFolderTreeProps) {
  const roots = buildTree(labels);
  return (
    <div className="space-tree" aria-label="Dossiers du projet">
      <div className="space-tree-heading">
        <span className="space-tree-label">Dossiers</span>
        {canCreate && (
          <button
            className="folder-create-trigger"
            type="button"
            title="Créer un dossier"
            aria-label="Créer un dossier"
            onClick={() => onStartCreate(null)}
          >+</button>
        )}
      </div>
      {editorParentId === null && (
        <FolderCreateForm
          parentLabelId={null}
          defaultColor="#3B82F6"
          onSubmit={onCreate}
          onCancel={onCancelCreate}
        />
      )}
      {roots.map((folder) => (
        <FolderBranch
          key={folder.id}
          folder={folder}
          counts={counts}
          selectedLabelId={selectedLabelId}
          editorParentId={editorParentId}
          canCreate={canCreate}
          onSelect={onSelect}
          onStartCreate={onStartCreate}
          onCancelCreate={onCancelCreate}
          onCreate={onCreate}
        />
      ))}
      {labels.length === 0 && editorParentId === undefined && (
        <p className="folder-empty">Aucun dossier. Utilisez + pour commencer.</p>
      )}
    </div>
  );
}

interface FolderBranchProps extends Omit<ProjectFolderTreeProps, "labels"> {
  folder: FolderNode;
}

function FolderBranch({
  folder,
  counts,
  selectedLabelId,
  editorParentId,
  canCreate,
  onSelect,
  onStartCreate,
  onCancelCreate,
  onCreate
}: FolderBranchProps) {
  return (
    <div className="folder-branch">
      <div className="folder-row">
        <button
          className={selectedLabelId === folder.id ? "folder-link active" : "folder-link"}
          type="button"
          title={folder.name + " · " + (counts.get(folder.id) ?? 0) + " tâches"}
          onClick={() => onSelect(folder.id)}
        >
          <span className="folder-expander" aria-hidden="true">
            {folder.children.length > 0 ? "⌄" : "·"}
          </span>
          <span className="folder-icon" style={{ color: folder.color }}>▰</span>
          <span>{folder.name}</span>
          <small>{counts.get(folder.id) ?? 0}</small>
        </button>
        {canCreate && (
          <button
            className="folder-child-trigger"
            type="button"
            title={"Créer un sous-dossier dans " + folder.name}
            aria-label={"Créer un sous-dossier dans " + folder.name}
            onClick={() => onStartCreate(folder.id)}
          >+</button>
        )}
      </div>
      {editorParentId === folder.id && (
        <FolderCreateForm
          parentLabelId={folder.id}
          defaultColor={folder.color}
          onSubmit={onCreate}
          onCancel={onCancelCreate}
        />
      )}
      {folder.children.length > 0 && (
        <div className="folder-children">
          {folder.children.map((child) => (
            <FolderBranch
              key={child.id}
              folder={child}
              counts={counts}
              selectedLabelId={selectedLabelId}
              editorParentId={editorParentId}
              canCreate={canCreate}
              onSelect={onSelect}
              onStartCreate={onStartCreate}
              onCancelCreate={onCancelCreate}
              onCreate={onCreate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FolderCreateFormProps {
  parentLabelId: string | null;
  defaultColor: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function FolderCreateForm({
  parentLabelId,
  defaultColor,
  onSubmit,
  onCancel
}: FolderCreateFormProps) {
  return (
    <form className="folder-create-form" onSubmit={onSubmit}>
      <input name="parentLabelId" type="hidden" value={parentLabelId ?? ""} />
      <input
        name="color"
        type="color"
        defaultValue={defaultColor}
        title="Couleur du dossier"
        aria-label="Couleur du dossier"
      />
      <input
        name="name"
        type="text"
        minLength={1}
        maxLength={80}
        placeholder={parentLabelId ? "Nom du sous-dossier" : "Nom du dossier"}
        aria-label={parentLabelId ? "Nom du sous-dossier" : "Nom du dossier"}
        autoFocus
        required
      />
      <button type="submit" title="Créer">✓</button>
      <button type="button" title="Annuler" onClick={onCancel}>×</button>
    </form>
  );
}

function buildTree(labels: ProjectLabel[]): FolderNode[] {
  const nodes = new Map<string, FolderNode>(
    labels.map((label) => [label.id, { ...label, children: [] }])
  );
  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentLabelId ? nodes.get(node.parentLabelId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (items: FolderNode[]) => {
    items.sort((left, right) => left.name.localeCompare(right.name, "fr"));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}
