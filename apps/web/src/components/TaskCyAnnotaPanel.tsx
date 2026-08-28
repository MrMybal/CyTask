import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface EmbeddedEditorProps extends TaskCyAnnotaPanelProps {
  attachment: Attachment;
  workspace: CyAnnotaWorkspace;
  initialRevision: number;
  onClose: () => void;
  onSaved: (document: CyAnnotaDocument) => void;
}

export function TaskCyAnnotaPanel({
  taskId,
  canEdit,
  onError,
  onNotice
}: TaskCyAnnotaPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [workspace, setWorkspace] = useState<CyAnnotaWorkspace>();
  const [loading, setLoading] = useState(true);
  const [activeAttachment, setActiveAttachment] = useState<Attachment>();

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
    setActiveAttachment(undefined);
    void load();
  }, [load]);

  const documents = useMemo(
    () => new Map((workspace?.documents ?? []).map((item) => [item.attachmentId, item])),
    [workspace]
  );

  const updateSummary = useCallback((updated: CyAnnotaDocument) => {
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
  }, []);

  if (activeAttachment && workspace) {
    return (
      <EmbeddedCyAnnotaEditor
        taskId={taskId}
        attachment={activeAttachment}
        workspace={workspace}
        initialRevision={documents.get(activeAttachment.id)?.revision ?? 0}
        canEdit={canEdit}
        onClose={() => setActiveAttachment(undefined)}
        onSaved={updateSummary}
        onError={onError}
        onNotice={onNotice}
      />
    );
  }

  return (
    <section className="task-plugin-panel cyannota-panel detail-section" aria-busy={loading}>
      <header className="task-plugin-heading">
        <span className="task-plugin-icon cyannota-icon" aria-hidden="true">CA</span>
        <div>
          <h3>Annotations CyAnnota</h3>
          <p>Cadrez, dessinez et commentez les images ou vidéos liées à cette tâche.</p>
        </div>
        <span className="plugin-security-badge">Plugin intégré</span>
      </header>

      <div className="cyannota-security-note">
        <strong>CyAnnota s’ouvre directement dans la tâche.</strong>
        <span>Le média est transféré en mémoire avec contrôle de l’origine et de la session.</span>
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
                disabled={!workspace}
                onClick={() => setActiveAttachment(attachment)}
              >
                {document ? (canEdit ? "Continuer" : "Consulter") : (canEdit ? "Annoter" : "Consulter")}
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
          <span>Module : {workspace.applicationUrl}</span>
          <span>Document maximal : {formatBytes(workspace.maximumDocumentBytes)}</span>
        </footer>
      )}
    </section>
  );
}

function EmbeddedCyAnnotaEditor({
  taskId,
  attachment,
  workspace,
  initialRevision,
  canEdit,
  onClose,
  onSaved,
  onError,
  onNotice
}: EmbeddedEditorProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const revisionRef = useRef(initialRevision);
  const session = useMemo(() => crypto.randomUUID(), [attachment.id]);
  const [status, setStatus] = useState("Chargement du plugin…");

  const launch = useMemo(() => {
    try {
      const url = new URL(workspace.applicationUrl, window.location.href);
      if (url.origin !== window.location.origin || url.username || url.password) return undefined;
      url.hash = "";
      url.searchParams.set("integration", "cytask");
      url.searchParams.set("presentation", "embedded");
      url.searchParams.set("session", session);
      url.searchParams.set("parentOrigin", window.location.origin);
      url.searchParams.set("attachmentId", attachment.id);
      return { url: url.toString(), origin: url.origin };
    } catch {
      return undefined;
    }
  }, [attachment.id, session, workspace.applicationUrl]);

  useEffect(() => {
    if (!launch) {
      setStatus("Configuration CyAnnota invalide");
      onError("L’URL CyAnnota configurée par le serveur est invalide.");
      return;
    }

    let ready = false;
    let stopped = false;
    let initialPayload: Record<string, unknown> | undefined;

    const post = (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage(message, launch.origin);
    };

    const sendInitialPayload = () => {
      if (!ready || !initialPayload || stopped) return;
      post(initialPayload);
      initialPayload = undefined;
      setStatus(canEdit ? "Prêt à annoter" : "Consultation seule");
    };

    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== launch.origin
        || !isRecord(event.data)) return;
      const message = event.data as BridgeMessage;
      if (message.source !== "cyannota" || message.session !== session) return;

      if (message.type === "ready") {
        ready = true;
        setStatus("Ouverture du média…");
        sendInitialPayload();
        return;
      }

      if (message.type !== "save-annotations" || message.attachmentId !== attachment.id
        || !isRecord(message.document)) return;

      if (!canEdit) {
        post({
          source: "cytask",
          type: "save-result",
          session,
          ok: false,
          error: "Votre rôle autorise la consultation, pas la modification."
        });
        return;
      }

      setStatus("Enregistrement…");
      void api.updateCyAnnotaDocument(taskId, attachment.id, {
        document: message.document,
        expectedRevision: revisionRef.current
      }).then((updated) => {
        revisionRef.current = updated.revision;
        onSaved(updated);
        post({
          source: "cytask",
          type: "save-result",
          session,
          ok: true,
          revision: updated.revision,
          updatedAt: updated.updatedAt
        });
        setStatus(`Enregistré · rév. ${updated.revision}`);
        onNotice(`Annotations de « ${attachment.fileName} » enregistrées.`);
      }).catch((reason) => {
        const error = messageFor(reason);
        post({ source: "cytask", type: "save-result", session, ok: false, error });
        setStatus("Échec de l’enregistrement");
        onError(error);
      });
    };

    window.addEventListener("message", receive);
    const timeout = window.setTimeout(() => {
      if (!ready && !stopped) {
        setStatus("Le plugin ne répond pas");
        onError("CyAnnota ne répond pas. Vérifiez que le module intégré est disponible.");
      }
    }, 20_000);

    void Promise.all([
      fetch(api.attachmentContentUrl(attachment.id), {
        credentials: "same-origin",
        headers: { Accept: attachment.detectedContentType ?? attachment.declaredContentType }
      }),
      api.cyAnnotaDocument(taskId, attachment.id)
    ]).then(async ([contentResponse, stored]) => {
      if (!contentResponse.ok) throw new Error("Le média CyTask n’est plus disponible.");
      const contentType = attachment.detectedContentType
        ?? contentResponse.headers.get("content-type")
        ?? attachment.declaredContentType;
      const blob = await contentResponse.blob();
      const file = new File([blob], attachment.fileName, {
        type: contentType,
        lastModified: Date.parse(attachment.reviewedAt ?? attachment.createdAt)
      });
      revisionRef.current = stored.revision;
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
    }).catch((reason) => {
      if (stopped) return;
      setStatus("Impossible de charger le média");
      onError(messageFor(reason));
    });

    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [attachment, canEdit, launch, onError, onNotice, onSaved, session, taskId, workspace.maximumDocumentBytes]);

  return (
    <section ref={shellRef} className="cyannota-embedded-shell detail-section">
      <header className="cyannota-embedded-toolbar">
        <button className="text-button" type="button" onClick={onClose}>← Médias</button>
        <div>
          <strong>{attachment.fileName}</strong>
          <small>{status}</small>
        </div>
        <div className="cyannota-embedded-actions">
          <span className="plugin-security-badge">{canEdit ? "Édition" : "Lecture seule"}</span>
          <button
            className="secondary-button small"
            type="button"
            onClick={() => void shellRef.current?.requestFullscreen()}
          >
            Plein écran
          </button>
          <button className="secondary-button small" type="button" onClick={onClose}>Fermer</button>
        </div>
      </header>
      {launch ? (
        <iframe
          ref={frameRef}
          className="cyannota-embedded-frame"
          src={launch.url}
          title={`CyAnnota — ${attachment.fileName}`}
          sandbox="allow-scripts allow-same-origin allow-downloads"
          allow="fullscreen"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="cyannota-embedded-error">Configuration CyAnnota invalide.</div>
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