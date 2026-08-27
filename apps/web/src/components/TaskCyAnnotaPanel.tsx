import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type Attachment,
  type CyAnnotaDocument,
  type CyAnnotaDocumentSummary,
  type CyAnnotaWorkspace
} from "../api";

interface TaskCyAnnotaPanelProps {
  taskId: string;
  canEdit: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

type BridgeMessage = {
  source?: unknown;
  type?: unknown;
  session?: unknown;
  attachmentId?: unknown;
  document?: unknown;
};

export function TaskCyAnnotaPanel({
  taskId,
  canEdit,
  onError,
  onNotice
}: TaskCyAnnotaPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [workspace, setWorkspace] = useState<CyAnnotaWorkspace>();
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [files, integration] = await Promise.all([
        api.attachments(taskId),
        api.cyAnnotaWorkspace(taskId)
      ]);
      setAttachments(files.filter(isAnnotatable));
      setWorkspace(integration);
    } catch (reason) {
      onError(messageFor(reason));
    } finally {
      setLoading(false);
    }
  }, [onError, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const documents = useMemo(
    () => new Map((workspace?.documents ?? []).map((item) => [item.attachmentId, item])),
    [workspace]
  );

  async function openCyAnnota(attachment: Attachment) {
    if (!workspace || openingId) return;

    let applicationUrl: URL;
    try {
      applicationUrl = new URL(workspace.applicationUrl);
      if (!["http:", "https:"].includes(applicationUrl.protocol) || applicationUrl.username
        || applicationUrl.password) {
        throw new Error();
      }
    } catch {
      onError("L’URL CyAnnota configurée par le serveur est invalide.");
      return;
    }

    const session = crypto.randomUUID();
    applicationUrl.searchParams.set("integration", "cytask");
    applicationUrl.searchParams.set("session", session);
    applicationUrl.searchParams.set("parentOrigin", window.location.origin);
    applicationUrl.searchParams.set("attachmentId", attachment.id);
    const targetOrigin = applicationUrl.origin;
    const popup = window.open(
      applicationUrl.toString(),
      `cyannota-${session}`,
      "popup=yes,width=1680,height=980,resizable=yes,scrollbars=yes"
    );
    if (!popup) {
      onError("CyAnnota n’a pas pu s’ouvrir. Autorisez les fenêtres contextuelles pour CyTask.");
      return;
    }

    setOpeningId(attachment.id);
    let ready = false;
    let initialPayload: Record<string, unknown> | undefined;
    let revision = documents.get(attachment.id)?.revision ?? 0;
    let stopped = false;

    const cleanup = () => {
      stopped = true;
      window.removeEventListener("message", receive);
      window.clearTimeout(timeout);
      window.clearInterval(closedWatcher);
      setOpeningId((current) => current === attachment.id ? undefined : current);
    };

    const sendInitialPayload = () => {
      if (!ready || !initialPayload || stopped || popup.closed) return;
      popup.postMessage(initialPayload, targetOrigin);
      initialPayload = undefined;
      setOpeningId((current) => current === attachment.id ? undefined : current);
    };

    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== popup || event.origin !== targetOrigin || !isRecord(event.data)) return;
      const message = event.data as BridgeMessage;
      if (message.source !== "cyannota" || message.session !== session) return;

      if (message.type === "ready") {
        ready = true;
        sendInitialPayload();
        return;
      }

      if (message.type !== "save-annotations" || message.attachmentId !== attachment.id
        || !isRecord(message.document)) {
        return;
      }
      if (!canEdit) {
        popup.postMessage({
          source: "cytask",
          type: "save-result",
          session,
          ok: false,
          error: "Votre rôle autorise la consultation, pas la modification."
        }, targetOrigin);
        return;
      }

      void api.updateCyAnnotaDocument(taskId, attachment.id, {
        document: message.document,
        expectedRevision: revision
      }).then((updated) => {
        revision = updated.revision;
        updateSummary(updated);
        popup.postMessage({
          source: "cytask",
          type: "save-result",
          session,
          ok: true,
          revision: updated.revision,
          updatedAt: updated.updatedAt
        }, targetOrigin);
        onNotice(`Annotations de « ${attachment.fileName} » enregistrées.`);
      }).catch((reason) => {
        const error = messageFor(reason);
        popup.postMessage({
          source: "cytask",
          type: "save-result",
          session,
          ok: false,
          error
        }, targetOrigin);
        onError(error);
      });
    };

    window.addEventListener("message", receive);
    const timeout = window.setTimeout(() => {
      if (!ready) {
        onError("CyAnnota ne répond pas. Vérifiez qu’il est démarré et que son URL est correcte.");
        cleanup();
      }
    }, 20_000);
    const closedWatcher = window.setInterval(() => {
      if (popup.closed) cleanup();
    }, 1_000);

    try {
      const [contentResponse, stored] = await Promise.all([
        fetch(api.attachmentContentUrl(attachment.id), {
          credentials: "same-origin",
          headers: { Accept: attachment.detectedContentType ?? attachment.declaredContentType }
        }),
        api.cyAnnotaDocument(taskId, attachment.id)
      ]);
      if (!contentResponse.ok) throw new Error("Le média CyTask n’est plus disponible.");
      const contentType = attachment.detectedContentType
        ?? contentResponse.headers.get("content-type")
        ?? attachment.declaredContentType;
      const blob = await contentResponse.blob();
      const file = new File([blob], attachment.fileName, {
        type: contentType,
        lastModified: Date.parse(attachment.reviewedAt ?? attachment.createdAt)
      });
      revision = stored.revision;
      initialPayload = {
        source: "cytask",
        type: "open-media",
        session,
        attachmentId: attachment.id,
        taskId,
        title: attachment.fileName,
        mediaKind: stored.mediaKind,
        file,
        document: stored.document,
        readOnly: !canEdit,
        maximumDocumentBytes: workspace.maximumDocumentBytes
      };
      sendInitialPayload();
    } catch (reason) {
      onError(messageFor(reason));
      popup.close();
      cleanup();
    }

    function updateSummary(updated: CyAnnotaDocument) {
      setWorkspace((current) => {
        if (!current) return current;
        const summary: CyAnnotaDocumentSummary = {
          attachmentId: updated.attachmentId,
          mediaKind: updated.mediaKind,
          annotationCount: updated.annotationCount,
          revision: updated.revision,
          updatedAt: updated.updatedAt ?? new Date().toISOString()
        };
        return {
          ...current,
          documents: [
            summary,
            ...current.documents.filter((item) => item.attachmentId !== updated.attachmentId)
          ]
        };
      });
    }
  }

  return (
    <section className="task-plugin-panel cyannota-panel detail-section" aria-busy={loading}>
      <header className="task-plugin-heading">
        <span className="task-plugin-icon cyannota-icon" aria-hidden="true">CA</span>
        <div>
          <h3>Annotations CyAnnota</h3>
          <p>Cadrez, dessinez et commentez les images ou vidéos liées à cette tâche.</p>
        </div>
        <span className="plugin-security-badge">Pont local sécurisé</span>
      </header>

      <div className="cyannota-security-note">
        <strong>Le média reste dans CyTask.</strong>
        <span>CyAnnota reçoit une copie en mémoire par session, sans cookie ni token CyTask.</span>
      </div>

      <div className="cyannota-media-grid">
        {attachments.map((attachment) => {
          const contentType = attachment.detectedContentType ?? attachment.declaredContentType;
          const document = documents.get(attachment.id);
          const contentUrl = api.attachmentContentUrl(attachment.id);
          return (
            <article className="cyannota-media-card" key={attachment.id}>
              <div className="cyannota-media-preview">
                {contentType.startsWith("image/") ? (
                  <img src={contentUrl} alt="" loading="lazy" />
                ) : (
                  <video src={contentUrl} muted playsInline preload="metadata" />
                )}
                <span>{contentType.startsWith("video/") ? "VIDÉO" : "IMAGE"}</span>
              </div>
              <div className="cyannota-media-copy">
                <strong title={attachment.fileName}>{attachment.fileName}</strong>
                <small>
                  {document
                    ? `${document.annotationCount} annotation${document.annotationCount > 1 ? "s" : ""} · rév. ${document.revision}`
                    : "Pas encore annoté"}
                </small>
              </div>
              <button
                className="primary-button small"
                type="button"
                disabled={!workspace || Boolean(openingId)}
                onClick={() => void openCyAnnota(attachment)}
              >
                {openingId === attachment.id
                  ? "Ouverture…"
                  : document ? (canEdit ? "Continuer" : "Consulter") : (canEdit ? "Annoter" : "Consulter")}
              </button>
            </article>
          );
        })}
      </div>

      {!loading && attachments.length === 0 && (
        <p className="empty-note">
          Ajoutez une image ou une vidéo validée dans l’onglet Fichiers pour commencer.
        </p>
      )}
      {workspace && (
        <footer className="cyannota-footer">
          <span>Application : {workspace.applicationUrl}</span>
          <span>Document maximal : {formatBytes(workspace.maximumDocumentBytes)}</span>
        </footer>
      )}
    </section>
  );
}

function isAnnotatable(attachment: Attachment) {
  if (attachment.status !== "available") return false;
  const contentType = attachment.detectedContentType ?? attachment.declaredContentType;
  return contentType.startsWith("image/") || contentType.startsWith("video/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFor(reason: unknown) {
  return reason instanceof Error ? reason.message : "L’intégration CyAnnota a échoué.";
}

function formatBytes(value: number) {
  return value >= 1_048_576
    ? `${(value / 1_048_576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mio`
    : `${Math.ceil(value / 1024).toLocaleString("fr-FR")} Kio`;
}
