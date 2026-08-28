import type { FormEvent } from "react";
import type { ProjectLabel } from "../api";
import { useI18n } from "../i18n";

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
  const { locale, t } = useI18n();
  const roots = buildTree(labels, locale);
  return (
    <div className="space-tree" aria-label={t("Project folders")}>
      <div className="space-tree-heading">
        <span className="space-tree-label">{t("Folders")}</span>
        {canCreate && (
          <button
            className="folder-create-trigger"
            type="button"
            title={t("Create a folder")}
            aria-label={t("Create a folder")}
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
        <p className="folder-empty">{t("No folders. Use + to get started.")}</p>
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
  const { t } = useI18n();
  return (
    <div className="folder-branch">
      <div className="folder-row">
        <button
          className={selectedLabelId === folder.id ? "folder-link active" : "folder-link"}
          type="button"
          title={folder.name + " · " + (counts.get(folder.id) ?? 0) + " " + t("tasks")}
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
            title={t("Create a subfolder in {name}", { name: folder.name })}
            aria-label={t("Create a subfolder in {name}", { name: folder.name })}
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
  const { t } = useI18n();
  return (
    <form className="folder-create-form" onSubmit={onSubmit}>
      <input name="parentLabelId" type="hidden" value={parentLabelId ?? ""} />
      <input
        name="color"
        type="color"
        defaultValue={defaultColor}
        title={t("Folder color")}
        aria-label={t("Folder color")}
      />
      <input
        name="name"
        type="text"
        minLength={1}
        maxLength={80}
        placeholder={t(parentLabelId ? "Subfolder name" : "Folder name")}
        aria-label={t(parentLabelId ? "Subfolder name" : "Folder name")}
        autoFocus
        required
      />
      <button type="submit" title={t("Create")}>✓</button>
      <button type="button" title={t("Cancel")} onClick={onCancel}>×</button>
    </form>
  );
}

function buildTree(labels: ProjectLabel[], locale: "en" | "fr"): FolderNode[] {
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
    items.sort((left, right) => left.name.localeCompare(right.name, locale));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}
