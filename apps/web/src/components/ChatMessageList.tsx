import { useEffect, useRef } from "react";
import { api, type ChatMessage, type OrganizationMember } from "../api";

interface Props {
  messages: ChatMessage[];
  members: OrganizationMember[];
  currentUserId: string;
}

export function ChatMessageList({ messages, members, currentUserId }: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages]);
  const membersById = new Map(members.map((member) => [member.userId, member]));
  return (
    <div className="chat-message-list" aria-live="polite">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const compact = previous?.authorId === message.authorId
          && Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000;
        const pinged = message.mentionedUserIds.includes(currentUserId);
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
              {message.resources.length > 0 && (
                <div className="chat-attachments">
                  {message.resources.map((resource) => {
                    const url = api.resourceContentUrl(resource.id);
                    const type = resource.detectedContentType ?? resource.declaredContentType ?? "";
                    return (
                      <a href={url} download={resource.name} key={resource.id}>
                        {type.startsWith("image/") && <img src={url} alt={resource.name} />}
                        {type.startsWith("video/") && <video src={url} preload="metadata" controls playsInline />}
                        {!type.startsWith("image/") && !type.startsWith("video/") && (
                          <span className="chat-file-icon">F</span>
                        )}
                        <span><strong>{resource.name}</strong><small>{formatBytes(resource.sizeBytes)}</small></span>
                      </a>
                    );
                  })}
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
      <div ref={end} />
    </div>
  );
}

function highlightMentions(body: string, members: OrganizationMember[]) {
  const names = members.map((member) => member.displayName).sort((a, b) => b.length - a.length);
  if (names.length === 0) return body;
  const expression = new RegExp("(@" + names.map(escapeRegex).join("|@") + ")", "gi");
  return body.split(expression).map((part, index) =>
    part.startsWith("@") ? <mark key={index}>{part}</mark> : part
  );
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
