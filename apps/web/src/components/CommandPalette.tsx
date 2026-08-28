import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, WorkItem } from "../api";
import { useI18n } from "../i18n";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  projects: Project[];
  tasks: WorkItem[];
  actions: PaletteAction[];
  onOpenTask: (taskId: string) => void;
  onOpenProject: (projectId: string) => void;
  onClose: () => void;
}

interface PaletteEntry {
  id: string;
  kind: "action" | "task" | "project";
  label: string;
  hint?: string;
  badge: string;
  score: number;
  run: () => void;
}

/**
 * Score de correspondance approximative : sous-séquence ordonnée, avec bonus
 * pour les débuts de mots et les caractères contigus. 0 = aucune correspondance.
 */
function fuzzyScore(query: string, candidate: string, locale: "en" | "fr"): number {
  if (!query) return 1;
  const text = candidate.toLocaleLowerCase(locale);
  let score = 0;
  let position = 0;
  let previousMatch = -2;
  for (const character of query) {
    const found = text.indexOf(character, position);
    if (found === -1) return 0;
    score += found === previousMatch + 1 ? 3 : 1;
    if (found === 0 || text[found - 1] === " " || text[found - 1] === "-") score += 2;
    previousMatch = found;
    position = found + 1;
  }
  return score + Math.max(0, 20 - text.length / 4);
}

export function CommandPalette({
  open,
  projects,
  tasks,
  actions,
  onOpenTask,
  onOpenProject,
  onClose
}: CommandPaletteProps) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    const matches: PaletteEntry[] = [];

    for (const action of actions) {
      const score = fuzzyScore(needle, `${action.label} ${action.keywords ?? ""}`, locale);
      if (score > 0) {
        matches.push({
          id: `action-${action.id}`,
          kind: "action",
          label: action.label,
          hint: action.hint,
          badge: "⌁",
          score: score + 5,
          run: action.run
        });
      }
    }

    for (const task of tasks) {
      const score = fuzzyScore(needle, `${task.key} ${task.title}`, locale);
      if (score > 0) {
        matches.push({
          id: `task-${task.id}`,
          kind: "task",
          label: task.title,
          hint: task.key,
          badge: "TA",
          score,
          run: () => onOpenTask(task.id)
        });
      }
    }

    for (const project of projects) {
      const score = fuzzyScore(needle, `${project.key} ${project.name}`, locale);
      if (score > 0) {
        matches.push({
          id: `project-${project.id}`,
          kind: "project",
          label: project.name,
          hint: project.key,
          badge: "PR",
          score: score + 2,
          run: () => onOpenProject(project.id)
        });
      }
    }

    return matches.sort((left, right) => right.score - left.score).slice(0, 12);
  }, [actions, locale, onOpenProject, onOpenTask, projects, query, tasks]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  function activate(entry: PaletteEntry | undefined) {
    if (!entry) return;
    onClose();
    entry.run();
  }

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("Command palette")}>
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          autoFocus
          value={query}
          placeholder={t("Task, project or action…")}
          aria-label={t("Search commands")}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, entries.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              activate(entries[activeIndex]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="palette-list" role="listbox" ref={listRef}>
          {entries.map((entry, index) => (
            <li key={entry.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={index === activeIndex ? "palette-entry active" : "palette-entry"}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activate(entry)}
              >
                <span className="palette-badge" aria-hidden="true">{entry.badge}</span>
                <span className="palette-copy">
                  <strong>{entry.label}</strong>
                  {entry.hint && <small>{entry.hint}</small>}
                </span>
                {entry.kind === "action" && <kbd>↵</kbd>}
              </button>
            </li>
          ))}
          {entries.length === 0 && <li className="palette-empty">{t("No results.")}</li>}
        </ul>
        <footer className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t("navigate")}</span>
          <span><kbd>↵</kbd> {t("open")}</span>
          <span><kbd>Esc</kbd> {t("close")}</span>
        </footer>
      </div>
    </div>
  );
}
