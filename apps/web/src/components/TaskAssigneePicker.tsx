import { useMemo, useState } from "react";
import type { OrganizationMember } from "../api";

interface TaskAssigneePickerProps {
  members: OrganizationMember[];
  initialSelectedIds?: string[];
  selectedIds?: string[];
  name?: string;
  disabled?: boolean;
  compact?: boolean;
  onChange?: (userIds: string[]) => void;
}

export function TaskAssigneePicker({
  members,
  initialSelectedIds = [],
  selectedIds,
  name,
  disabled = false,
  compact = false,
  onChange
}: TaskAssigneePickerProps) {
  const [internalIds, setInternalIds] = useState(initialSelectedIds);
  const activeIds = selectedIds ?? internalIds;
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const selectedMembers = members.filter((member) => activeSet.has(member.userId));

  function toggle(userId: string, checked: boolean) {
    const next = checked
      ? [...activeIds, userId].filter((id, index, values) => values.indexOf(id) === index)
      : activeIds.filter((id) => id !== userId);
    if (selectedIds === undefined) setInternalIds(next);
    onChange?.(next);
  }

  return (
    <div className={compact ? "assignee-picker compact" : "assignee-picker"}>
      {name && activeIds.map((userId) => (
        <input type="hidden" name={name} value={userId} key={userId} />
      ))}
      <details>
        <summary aria-label="Modifier les responsables">
          <span className="assignee-picker-avatars" aria-hidden="true">
            {selectedMembers.slice(0, 3).map((member) => (
              <i key={member.userId}>{initials(member.displayName)}</i>
            ))}
          </span>
          <span>
            {selectedMembers.length === 0
              ? "Personne"
              : selectedMembers.length <= 2
                ? selectedMembers.map((member) => member.displayName).join(", ")
                : `${selectedMembers.length} responsables`}
          </span>
          {!disabled && <b aria-hidden="true">＋</b>}
        </summary>
        {!disabled && (
          <div className="assignee-picker-menu">
            <header>
              <strong>Responsables</strong>
              <small>Plusieurs personnes possibles</small>
            </header>
            {members.map((member) => (
              <label key={member.userId}>
                <input
                  type="checkbox"
                  checked={activeSet.has(member.userId)}
                  onChange={(event) => toggle(member.userId, event.currentTarget.checked)}
                />
                <i aria-hidden="true">{initials(member.displayName)}</i>
                <span>{member.displayName}<small>{member.email}</small></span>
              </label>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("") || "?";
}
