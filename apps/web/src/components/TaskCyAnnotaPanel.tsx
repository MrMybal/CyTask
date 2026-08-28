import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type Attachment,
  type CyAnnotaDocument,
  type CyAnnotaDocumentSummary,
  type CyAnnotaWorkspace
} from "../api";
import { useI18n } from "../i18n";

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
  const { locale, t } = useI18n();
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
      onError(messageFor(reason, t("CyAnnota integration failed.")));
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
          <h3>{t("CyAnnota annotations")}</h3>
          <p>{t("Frame, draw and comment on images or videos linked to this task.")}</p>
        </div>
        <span className="plugin-security-badge">{t("Integrated plugin")}</span>
      </header>

      <div className="cyannota-security-note">
        <strong>{t("CyAnnota opens directly inside the task.")}</strong>
        <span>{t("Media is transferred in memory with origin and session checks.")}</span>
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
                <span>{t(contentType.startsWith("video/") ? "VIDEO" : "IMAGE")}</span>
              </div>
              <div className="cyannota-media-copy">
                <strong title={attachment.fileName}>{attachment.fileName}</strong>
                <small>
                  {document
                    ? `${t(document.annotationCount === 1 ? "{count} annotation" : "{count} annotations", { count: document.annotationCount })} · ${t("rev.")} ${document.revision}`
                    : t("Not annotated yet")}
                </small>
              </div>
              <button
                className="primary-button small"
                type="button"
                disabled={!workspace}
                onClick={() => setActiveAttachment(attachment)}
              >
                {t(document ? (canEdit ? "Continue" : "View annotations") : (canEdit ? "Annotate" : "View annotations"))}
              </button>
            </article>
          );
        })}
      </div>

      {!loading && attachments.length === 0 && (
        <p className="empty-note">
          {t("Add a validated image or video in the Files tab to get started.")}
        </p>
      )}
      {workspace && (
        <footer className="cyannota-footer">
          <span>{t("Module")}: {workspace.applicationUrl}</span>
          <span>{t("Maximum document")}: {formatBytes(workspace.maximumDocumentBytes, locale)}</span>
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
  const { t } = useI18n();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const revisionRef = useRef(initialRevision);
  const session = useMemo(() => crypto.randomUUID(), [attachment.id]);
  const [status, setStatus] = useState(t("Loading plugin…"));

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
      setStatus(t("Invalid CyAnnota configuration"));
      onError(t("The CyAnnota URL configured by the server is invalid."));
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
      setStatus(t(canEdit ? "Ready to annotate" : "Read only"));
    };

    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== launch.origin
        || !isRecord(event.data)) return;
      const message = event.data as BridgeMessage;
      if (message.source !== "cyannota" || message.session !== session) return;

      if (message.type === "ready") {
        ready = true;
        setStatus(t("Opening media…"));
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
          error: t("Your role allows viewing, but not editing.")
        });
        return;
      }

      setStatus(t("Saving…"));
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
        setStatus(`${t("Saved")} · ${t("rev.")} ${updated.revision}`);
        onNotice(t("Annotations for “{name}” saved.", { name: attachment.fileName }));
      }).catch((reason) => {
        const error = messageFor(reason, t("CyAnnota integration failed."));
        post({ source: "cytask", type: "save-result", session, ok: false, error });
        setStatus(t("Save failed"));
        onError(error);
      });
    };

    window.addEventListener("message", receive);
    const timeout = window.setTimeout(() => {
      if (!ready && !stopped) {
        setStatus(t("Plugin not responding"));
        onError(t("CyAnnota is not responding. Check that the integrated module is available."));
      }
    }, 20_000);

    void Promise.all([
      fetch(api.attachmentContentUrl(attachment.id), {
        credentials: "same-origin",
        headers: { Accept: attachment.detectedContentType ?? attachment.declaredContentType }
      }),
      api.cyAnnotaDocument(taskId, attachment.id)
    ]).then(async ([contentResponse, stored]) => {
      if (!contentResponse.ok) throw new Error(t("The CyTask media is no longer available."));
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
      setStatus(t("Unable to load media"));
      onError(messageFor(reason, t("CyAnnota integration failed.")));
    });

    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [attachment, canEdit, launch, onError, onNotice, onSaved, session, taskId, workspace.maximumDocumentBytes, t]);

  return (
    <section ref={shellRef} className="cyannota-embedded-shell detail-section">
      <header className="cyannota-embedded-toolbar">
        <button className="text-button" type="button" onClick={onClose}>← {t("Back to media")}</button>
        <div>
          <strong>{attachment.fileName}</strong>
          <small>{status}</small>
        </div>
        <div className="cyannota-embedded-actions">
          <span className="plugin-security-badge">{t(canEdit ? "Editing" : "Read only")}</span>
          <button
            className="secondary-button small"
            type="button"
            onClick={() => void shellRef.current?.requestFullscreen()}
          >
            {t("Full screen")}
          </button>
          <button className="secondary-button small" type="button" onClick={onClose}>{t("Close")}</button>
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
        <div className="cyannota-embedded-error">{t("Invalid CyAnnota configuration.")}</div>
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

function messageFor(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function formatBytes(value: number, locale: "en" | "fr") {
  const numberLocale = locale === "fr" ? "fr-FR" : "en-US";
  return value >= 1_048_576
    ? `${(value / 1_048_576).toLocaleString(numberLocale, { maximumFractionDigits: 1 })} ${locale === "fr" ? "Mio" : "MiB"}`
    : `${Math.ceil(value / 1024).toLocaleString(numberLocale)} ${locale === "fr" ? "Kio" : "KiB"}`;
}