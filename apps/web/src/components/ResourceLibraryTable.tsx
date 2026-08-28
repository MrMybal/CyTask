import { useMemo, useState } from "react";
import type { ProjectLabel, ProjectResource } from "../api";
import { useI18n } from "../i18n";

type SortKey = "name" | "type" | "folder" | "author" | "updated" | "size";
type GroupKey = "folder" | "type" | "none";

interface Props {
  resources: ProjectResource[];
  labels: ProjectLabel[];
  selectedResourceId?: string;
  onOpen: (resource: ProjectResource) => void;
}

export function ResourceLibraryTable({ resources, labels, selectedResourceId, onOpen }: Props) {
  const { locale, t } = useI18n();
  const typeLabel = (type: ProjectResource["resourceType"]) => t({ document: "Document", canvas: "Canvas", file: "File" }[type]);
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [groupKey, setGroupKey] = useState<GroupKey>("folder");
  const labelsById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const sorted = useMemo(() => [...resources].sort((left, right) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const values: Record<SortKey, [string | number, string | number]> = {
      name: [left.name, right.name],
      type: [left.resourceType, right.resourceType],
      folder: [
        labelsById.get(left.folderLabelId ?? "")?.name ?? "",
        labelsById.get(right.folderLabelId ?? "")?.name ?? ""
      ],
      author: [left.createdByName, right.createdByName],
      updated: [Date.parse(left.updatedAt), Date.parse(right.updatedAt)],
      size: [left.sizeBytes, right.sizeBytes]
    };
    const [a, b] = values[sortKey];
    return (typeof a === "number" && typeof b === "number"
      ? a - b : String(a).localeCompare(String(b), locale)) * direction;
  }), [labelsById, locale, resources, sortDirection, sortKey]);

  const groups = useMemo(() => {
    const grouped = new Map<string, { title: string; color: string; items: ProjectResource[] }>();
    for (const resource of sorted) {
      const label = labelsById.get(resource.folderLabelId ?? "");
      const key = groupKey === "folder" ? resource.folderLabelId ?? "root"
        : groupKey === "type" ? resource.resourceType : "all";
      const title = groupKey === "folder" ? label?.name ?? t("Workspace root")
        : groupKey === "type" ? typeLabel(resource.resourceType) : t("All contents");
      const group = grouped.get(key) ?? { title, color: label?.color ?? "#7CF2C4", items: [] };
      group.items.push(resource);
      grouped.set(key, group);
    }
    return [...grouped.values()];
  }, [groupKey, labelsById, sorted, t]);

  function sort(next: SortKey) {
    if (sortKey === next) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(next);
      setSortDirection(next === "updated" ? "desc" : "asc");
    }
  }

  return (
    <section className="resource-library">
      <header className="resource-library-toolbar">
        <strong>{t(resources.length === 1 ? "{count} item" : "{count} items", { count: resources.length })}</strong>
        <label>
          {t("Group")}
          <select value={groupKey} onChange={(event) => setGroupKey(event.currentTarget.value as GroupKey)}>
            <option value="folder">{t("By folder")}</option>
            <option value="type">{t("By type")}</option>
            <option value="none">{t("No grouping")}</option>
          </select>
        </label>
      </header>
      {groups.map((group) => (
        <section className="resource-table-group" key={group.title + "-" + group.color}>
          <header>
            <i style={{ background: group.color }} />
            <strong>{group.title}</strong>
            <span>{group.items.length}</span>
          </header>
          <div className="resource-table-columns">
            <SortButton label={t("Name")} value="name" current={sortKey} direction={sortDirection} onSort={sort} />
            <SortButton label={t("Type")} value="type" current={sortKey} direction={sortDirection} onSort={sort} />
            <SortButton label={t("Folder")} value="folder" current={sortKey} direction={sortDirection} onSort={sort} />
            <SortButton label={t("Created by")} value="author" current={sortKey} direction={sortDirection} onSort={sort} />
            <SortButton label={t("Updated")} value="updated" current={sortKey} direction={sortDirection} onSort={sort} />
            <SortButton label={t("Size")} value="size" current={sortKey} direction={sortDirection} onSort={sort} />
          </div>
          {group.items.map((resource) => (
            <button
              className={selectedResourceId === resource.id ? "resource-table-row active" : "resource-table-row"}
              type="button"
              key={resource.id}
              onClick={() => onOpen(resource)}
            >
              <span className="resource-name">
                <i className={"resource-type-icon type-" + resource.resourceType}>
                  {resource.resourceType === "document" ? "D" : resource.resourceType === "canvas" ? "C" : "F"}
                </i>
                <strong>{resource.name}</strong>
                {resource.status === "rejected" && <em>{t("Rejected")}</em>}
                {resource.status === "uploading" && <em>{t("Uploading…")}</em>}
              </span>
              <span>{typeLabel(resource.resourceType)}</span>
              <span>{labelsById.get(resource.folderLabelId ?? "")?.name ?? t("Root")}</span>
              <span>{resource.createdByName}</span>
              <time dateTime={resource.updatedAt}>{compactDate(resource.updatedAt, locale)}</time>
              <span>{resource.resourceType === "file" ? formatBytes(resource.sizeBytes) : "—"}</span>
            </button>
          ))}
        </section>
      ))}
      {resources.length === 0 && (
        <div className="resource-empty">
          <span>◇</span>
          <strong>{t("No content here")}</strong>
          <p>{t("Create a document or canvas, or import a file.")}</p>
        </div>
      )}
    </section>
  );
}

function SortButton({ label, value, current, direction, onSort }: {
  label: string;
  value: SortKey;
  current: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  return (
    <button type="button" onClick={() => onSort(value)}>
      {label}{current === value ? <span>{direction === "asc" ? " ↑" : " ↓"}</span> : null}
    </button>
  );
}

function compactDate(value: string, locale: "en" | "fr") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024) return String(value) + " o";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " Kio";
  return (value / 1024 / 1024).toFixed(1) + " Mio";
}
