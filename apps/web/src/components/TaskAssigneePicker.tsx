import { useEffect, useMemo, useRef, useState } from "react";
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
  const [draftIds, setDraftIds] = useState(selectedIds ?? initialSelectedIds);
  const [isOpen, setIsOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const controlled = selectedIds !== undefined;
  const activeIds = selectedIds ?? internalIds;
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const menuIds = controlled ? draftIds : activeIds;
  const menuSet = useMemo(() => new Set(menuIds), [menuIds]);
  const selectedMembers = members.filter((member) => activeSet.has(member.userId));

  useEffect(() => {
    if (!isOpen && selectedIds !== undefined) setDraftIds(selectedIds);
  }, [isOpen, selectedIds]);

  useEffect(() => {
    if (!disabled || !detailsRef.current?.open) return;
    detailsRef.current.open = false;
    setIsOpen(false);
  }, [disabled]);

  function toggle(userId: string, checked: boolean) {
    const next = checked
      ? [...menuIds, userId].filter((id, index, values) => values.indexOf(id) === index)
      : menuIds.filter((id) => id !== userId);
    if (controlled) {
      setDraftIds(next);
      return;
    }
    setInternalIds(next);
    onChange?.(next);
  }

  function closeMenu() {
    if (detailsRef.current) detailsRef.current.open = false;
    setIsOpen(false);
  }

  function cancelDraft() {
    setDraftIds(activeIds);
    closeMenu();
  }

  function applyDraft() {
    if (!sameIds(activeIds, draftIds)) onChange?.(draftIds);
    closeMenu();
  }

  return (
    <div className={compact ? "assignee-picker compact" : "assignee-picker"}>
      {name && activeIds.map((userId) => (
        <input type="hidden" name={name} value={userId} key={userId} />
      ))}
      <details
        ref={detailsRef}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          if (open && controlled) setDraftIds(activeIds);
          setIsOpen(open);
        }}
      >
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
        {isOpen && !disabled && (
          <div className="assignee-picker-menu">
            <header>
              <strong>Responsables</strong>
              <small>Plusieurs personnes possibles</small>
            </header>
            {members.length === 0 && <p className="assignee-picker-empty">Aucun membre disponible.</p>}
            {members.map((member) => (
              <label key={member.userId}>
                <input
                  type="checkbox"
                  checked={menuSet.has(member.userId)}
                  onChange={(event) => toggle(member.userId, event.currentTarget.checked)}
                />
                <i aria-hidden="true">{initials(member.displayName)}</i>
                <span>{member.displayName}<small>{member.email}</small></span>
              </label>
            ))}
            {controlled && (
              <footer className="assignee-picker-actions">
                <button type="button" onClick={cancelDraft}>Annuler</button>
                <button type="button" className="primary" onClick={applyDraft}>Appliquer</button>
              </footer>
            )}
          </div>
        )}
      </details>
    </div>
  );
}

function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join("") || "?";
}
