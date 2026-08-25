import { useEffect, useRef, useState } from "react";
import {
  api, type ChatMessage, type OrganizationMember,
  type ProjectResource, type TaskOption
} from "../api";

interface Props {
  messages: ChatMessage[];
  members: OrganizationMember[];
  currentUserId: string;
  tasks: TaskOption[];
  onOpenTask: (taskId: string) => void;
}

export function ChatMessageList({
  messages, members, currentUserId, tasks, onOpenTask
}: Props) {
  const [viewerResource, setViewerResource] = useState<ProjectResource>();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);
  useEffect(() => {
    if (!viewerResource) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setViewerResource(undefined);
    }
    window.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("media-viewer-open");
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("media-viewer-open");
    };
  }, [viewerResource]);
  const membersById = new Map(members.map((member) => [member.userId, member]));
  return (
    <div className="chat-message-list" aria-live="polite">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const compact = previous?.authorId === message.authorId
          && Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000;
        const pinged = message.mentionedUserIds.includes(currentUserId);
        const linkedTasks = referencedTasks(message.body, tasks);
        return (
          <article className={(compact ? "chat-message compact" : "chat-message") + (pinged ? " pinged" : "")} key={message.id}>
            {!compact && <span className="chat-avatar">{initials(message.authorName)}</span>}
            <div>
              {!compact && (
                <header>
                  <strong>{message.authorName}</strong>
                  <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                  {pinged && <em>vous a mentionné</em>}
                </header>
              )}
              <p>{highlightMentions(message.body, members)}</p>
              {linkedTasks.length > 0 && (
                <div className="chat-task-previews">
                  {linkedTasks.map((task) => (
                    <button type="button" className="chat-task-preview" key={task.id}
                      onClick={() => onOpenTask(task.id)}>
                      <span>{task.key}</span><strong>{task.title}</strong>
                      <small data-status={task.status}>{statusLabel(task.status)}</small>
                    </button>
                  ))}
                </div>
              )}
              {message.resources.length > 0 && (
                <div className="chat-media-previews">
                  {message.resources.map((resource) => (
                    <ChatAttachment resource={resource} key={resource.id}
                      onPreview={() => setViewerResource(resource)} />
                  ))}
                </div>
              )}
              {message.mentionedUserIds.length > 0 && (
                <span className="sr-only">
                  Mentions : {message.mentionedUserIds.map((id) => membersById.get(id)?.displayName).filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </article>
        );
      })}
      {messages.length === 0 && (
        <div className="chat-empty"><span>#</span><strong>Commencez la discussion</strong><p>Les messages et fichiers de ce salon seront partagés avec l’équipe.</p></div>
      )}
      {viewerResource && (
        <MediaViewer resource={viewerResource} onClose={() => setViewerResource(undefined)} />
      )}
      <div ref={end} />
    </div>
  );
}

function highlightMentions(body: string, members: OrganizationMember[]) {
  const names = members.map((member) => member.displayName).sort((a, b) => b.length - a.length);
  const patterns = ["https?:\\/\\/[^\\s]+"];
  patterns.push(...names.map((name) => "@" + escapeRegex(name)));
  const expression = new RegExp("(" + patterns.join("|") + ")", "gi");
  return body.split(expression).map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      return <a className="chat-inline-link" href={part} key={index}>{part}</a>;
    }
    return part.startsWith("@") ? <mark key={index}>{part}</mark> : part;
  });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024) return String(value) + " o";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " Kio";
  return (value / 1024 / 1024).toFixed(1) + " Mio";
}

function ChatAttachment({
  resource,
  onPreview
}: {
  resource: ProjectResource;
  onPreview: () => void;
}) {
  const url = api.resourceContentUrl(resource.id);
  const type = resource.detectedContentType ?? resource.declaredContentType ?? "";
  const isImage = resource.resourceType === "file" && type.startsWith("image/");
  const isVideo = resource.resourceType === "file" && type.startsWith("video/");
  const canDownload = resource.resourceType === "file" && resource.status === "available";

  if (isImage) {
    return (
      <article className="chat-media-card image">
        <button type="button" className="chat-image-preview" onClick={onPreview}
          aria-label={"Agrandir " + resource.name}>
          <img src={url} alt={resource.name} loading="lazy" />
          <span>Agrandir</span>
        </button>
        <AttachmentFooter resource={resource} url={url} canDownload />
      </article>
    );
  }

  if (isVideo) {
    return (
      <article className="chat-media-card video">
        <video src={url} preload="metadata" controls playsInline />
        <div className="chat-video-actions">
          <button type="button" onClick={onPreview}>Agrandir</button>
          <a href={url} download={resource.name}>Télécharger</a>
        </div>
        <AttachmentFooter resource={resource} url={url} canDownload={false} />
      </article>
    );
  }

  return (
    <article className="chat-media-card file">
      <span className="chat-file-icon">
        {resource.resourceType === "canvas" ? "CA" :
          resource.resourceType === "document" ? "DO" : "FI"}
      </span>
      <div className="chat-file-copy">
        <strong>{resource.name}</strong>
        <small>{resource.resourceType === "file"
          ? formatBytes(resource.sizeBytes)
          : resource.resourceType === "canvas" ? "Canvas CyTask" : "Document CyTask"}</small>
        {resource.body && <p>{resource.body.slice(0, 140)}</p>}
      </div>
      {canDownload && <a href={url} download={resource.name}>Télécharger</a>}
    </article>
  );
}

function AttachmentFooter({
  resource,
  url,
  canDownload
}: {
  resource: ProjectResource;
  url: string;
  canDownload: boolean;
}) {
  return (
    <footer className="chat-attachment-footer">
      <span><strong>{resource.name}</strong><small>{formatBytes(resource.sizeBytes)}</small></span>
      {canDownload && <a href={url} download={resource.name}>Télécharger</a>}
    </footer>
  );
}

function MediaViewer({
  resource,
  onClose
}: {
  resource: ProjectResource;
  onClose: () => void;
}) {
  const url = api.resourceContentUrl(resource.id);
  const type = resource.detectedContentType ?? resource.declaredContentType ?? "";
  return (
    <div className="chat-media-viewer" role="dialog" aria-modal="true"
      aria-label={"Aperçu de " + resource.name}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section>
        <header>
          <div><strong>{resource.name}</strong><small>{formatBytes(resource.sizeBytes)}</small></div>
          <button type="button" onClick={onClose} aria-label="Fermer l’aperçu">×</button>
        </header>
        <div className="chat-media-viewer-content">
          {type.startsWith("image/")
            ? <img src={url} alt={resource.name} />
            : <video src={url} controls autoPlay playsInline />}
        </div>
        <footer>
          <a className="primary-button small" href={url} download={resource.name}>
            ↓ Télécharger
          </a>
          <button type="button" onClick={onClose}>Fermer</button>
        </footer>
      </section>
    </div>
  );
}

function referencedTasks(body: string, tasks: TaskOption[]) {
  const byId = new Map(tasks.map((task) => [task.id.toLowerCase(), task]));
  const byKey = new Map(tasks.map((task) => [task.key.toLowerCase(), task]));
  const matches = body.matchAll(/#\/tasks\/([0-9a-f-]{36})|\b([a-z][a-z0-9]{1,9}-\d+)\b/gi);
  const result = new Map<string, TaskOption>();
  for (const match of matches) {
    const task = match[1] ? byId.get(match[1].toLowerCase()) : byKey.get(match[2]!.toLowerCase());
    if (task) result.set(task.id, task);
  }
  return [...result.values()];
}

function statusLabel(status: TaskOption["status"]) {
  return {
    todo: "À faire", in_progress: "En cours", blocked: "Bloquée",
    done: "Terminée", cancelled: "Annulée"
  }[status];
}
