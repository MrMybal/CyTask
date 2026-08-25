import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import type { TaskOption } from "../api";

type CanvasTool = "select" | "draw";
type CanvasObjectKind = "text" | "rectangle" | "ellipse" | "task" | "image" | "video";

interface CanvasObject {
  id: string;
  kind: CanvasObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text?: string;
  taskId?: string;
  taskKey?: string;
  mediaId?: string;
  fileName?: string;
}

interface CanvasStroke {
  id: string;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
}

interface CanvasBoardState {
  version: 1;
  objects: CanvasObject[];
  strokes: CanvasStroke[];
}

interface ProjectCanvasProps {
  projectId: string;
  tasks: TaskOption[];
  onOpenTask: (taskId: string) => void;
  storageId?: string;
  initialState?: string;
  onBoardChange?: (serialized: string) => void;
}

interface DragState {
  kind: "pan" | "object" | "draw";
  pointerId: number;
  objectId?: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
}

const canvasWidth = 2400;
const canvasHeight = 1600;
const colors = ["#7CF2C4", "#F2C27C", "#8FB7FF", "#FF9FA4", "#C3A6FF"];

export function ProjectCanvas({
  projectId,
  tasks,
  onOpenTask,
  storageId,
  initialState,
  onBoardChange
}: ProjectCanvasProps) {
  const storageKey = `cytask.canvas.v1.${storageId ?? projectId}`;
  const [board, setBoard] = useState<CanvasBoardState>(() => readBoard(storageKey, initialState));
  const [viewport, setViewport] = useState({ x: 34, y: 34, scale: 0.9 });
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [draftStroke, setDraftStroke] = useState<Array<{ x: number; y: number }>>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const drag = useRef<DragState | undefined>(undefined);
  const mediaFingerprint = board.objects
    .map((object) => object.mediaId ?? "")
    .join("|");

  useEffect(() => {
    setBoard(readBoard(storageKey, initialState));
    setViewport({ x: 34, y: 34, scale: 0.9 });
    // initialState is applied only when the selected canvas changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(board));
    onBoardChange?.(JSON.stringify(board));
  }, [board, onBoardChange, storageKey]);

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    const mediaObjects = board.objects.filter((object) => object.mediaId);
    void Promise.all(mediaObjects.map(async (object) => {
      const blob = await readCanvasMedia(object.mediaId!);
      if (!blob || !active) return;
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      setMediaUrls((current) => ({ ...current, [object.mediaId!]: url }));
    }));
    return () => {
      active = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [mediaFingerprint]);

  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks]
  );

  function worldPoint(clientX: number, clientY: number, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewport.x) / viewport.scale,
      y: (clientY - rect.top - viewport.y) / viewport.scale
    };
  }

  function addObject(kind: CanvasObjectKind, overrides: Partial<CanvasObject> = {}) {
    setBoard((current) => {
      const index = current.objects.length;
      const object: CanvasObject = {
        id: crypto.randomUUID(),
        kind,
        x: 120 + (index % 6) * 34,
        y: 110 + (index % 7) * 28,
        width: kind === "text" ? 260 : 210,
        height: kind === "text" ? 130 : 150,
        color: colors[index % colors.length] ?? "#7CF2C4",
        ...overrides
      };
      return { ...current, objects: [...current.objects, object] };
    });
  }

  function addText() {
    addObject("text", {
      text: "Double-cliquez pour modifier ce texte",
      width: 280,
      height: 150
    });
  }

  function addTask() {
    const task = taskById.get(selectedTaskId);
    if (!task) return;
    addObject("task", {
      taskId: task.id,
      taskKey: task.key,
      text: task.title,
      width: 280,
      height: 135,
      color: statusColor(task.status)
    });
  }

  async function addMediaFiles(files: File[], point?: { x: number; y: number }) {
    const accepted = files.filter((file) =>
      file.type.startsWith("image/") || file.type.startsWith("video/"));
    if (accepted.length === 0) return;

    for (const [index, file] of accepted.entries()) {
      const mediaId = crypto.randomUUID();
      await writeCanvasMedia(mediaId, file);
      const url = URL.createObjectURL(file);
      setMediaUrls((current) => ({ ...current, [mediaId]: url }));
      addObject(file.type.startsWith("video/") ? "video" : "image", {
        mediaId,
        fileName: file.name,
        x: (point?.x ?? 180) + index * 28,
        y: (point?.y ?? 160) + index * 28,
        width: 340,
        height: 235,
        color: "#8FB7FF"
      });
    }
  }

  function selectMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    void addMediaFiles(files);
    event.currentTarget.value = "";
  }

  function dropMedia(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const point = worldPoint(event.clientX, event.clientY, event.currentTarget);
    void addMediaFiles(Array.from(event.dataTransfer.files), point);
  }

  function removeObject(object: CanvasObject) {
    setBoard((current) => ({
      ...current,
      objects: current.objects.filter((candidate) => candidate.id !== object.id)
    }));
    if (object.mediaId) {
      const url = mediaUrls[object.mediaId];
      if (url) URL.revokeObjectURL(url);
      setMediaUrls((current) => {
        const next = { ...current };
        delete next[object.mediaId!];
        return next;
      });
      void deleteCanvasMedia(object.mediaId);
    }
  }

  function editText(object: CanvasObject) {
    const value = window.prompt("Texte du Canvas", object.text ?? "");
    if (value === null) return;
    setBoard((current) => ({
      ...current,
      objects: current.objects.map((candidate) =>
        candidate.id === object.id ? { ...candidate, text: value.slice(0, 4000) } : candidate)
    }));
  }

  function objectPointerDown(event: ReactPointerEvent<HTMLElement>, object: CanvasObject) {
    if (tool === "draw" || (event.target as HTMLElement).closest("button, video")) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind: "object",
      objectId: object.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: object.x,
      startY: object.y
    };
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".project-canvas-object")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "draw") {
      const point = worldPoint(event.clientX, event.clientY, event.currentTarget);
      setDraftStroke([point]);
      drag.current = {
        kind: "draw",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: 0,
        startY: 0
      };
      return;
    }
    drag.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewport.x,
      startY: viewport.y
    };
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "pan") {
      setViewport((current) => ({
        ...current,
        x: active.startX + event.clientX - active.startClientX,
        y: active.startY + event.clientY - active.startClientY
      }));
      return;
    }
    if (active.kind === "draw") {
      const point = worldPoint(event.clientX, event.clientY, event.currentTarget);
      setDraftStroke((current) => [...current, point]);
      return;
    }
    if (!active.objectId) return;
    const deltaX = (event.clientX - active.startClientX) / viewport.scale;
    const deltaY = (event.clientY - active.startClientY) / viewport.scale;
    setBoard((current) => ({
      ...current,
      objects: current.objects.map((object) => object.id === active.objectId
        ? { ...object, x: active.startX + deltaX, y: active.startY + deltaY }
        : object)
    }));
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === "draw" && draftStroke.length > 1) {
      setBoard((current) => ({
        ...current,
        strokes: [...current.strokes, {
          id: crypto.randomUUID(),
          color: "#7CF2C4",
          width: 4,
          points: draftStroke
        }]
      }));
    }
    setDraftStroke([]);
    drag.current = undefined;
  }

  function wheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const nextScale = clamp(viewport.scale * (event.deltaY > 0 ? 0.9 : 1.1), 0.25, 2);
    const worldX = (event.clientX - rect.left - viewport.x) / viewport.scale;
    const worldY = (event.clientY - rect.top - viewport.y) / viewport.scale;
    setViewport({
      x: event.clientX - rect.left - worldX * nextScale,
      y: event.clientY - rect.top - worldY * nextScale,
      scale: nextScale
    });
  }

  function zoom(delta: number) {
    setViewport((current) => ({
      ...current,
      scale: clamp(current.scale + delta, 0.25, 2)
    }));
  }

  return (
    <section className="project-canvas" aria-label="Canvas libre du projet">
      <header className="project-canvas-toolbar">
        <div className="canvas-tool-group" role="group" aria-label="Outils Canvas">
          <button className={tool === "select" ? "active" : ""} type="button" onClick={() => setTool("select")}>Déplacer</button>
          <button className={tool === "draw" ? "active" : ""} type="button" onClick={() => setTool("draw")}>Dessiner</button>
          <button type="button" onClick={addText}>Texte</button>
          <button type="button" onClick={() => addObject("rectangle")}>Rectangle</button>
          <button type="button" onClick={() => addObject("ellipse")}>Ellipse</button>
          <button type="button" onClick={() => fileInput.current?.click()}>Image / vidéo</button>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={selectMedia}
          />
        </div>
        <div className="canvas-task-adder">
          <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.currentTarget.value)}>
            <option value="">Ajouter une tâche…</option>
            {tasks.map((task) => <option value={task.id} key={task.id}>{task.key} · {task.title}</option>)}
          </select>
          <button type="button" disabled={!selectedTaskId} onClick={addTask}>Ajouter</button>
        </div>
        <div className="canvas-zoom-actions">
          {board.strokes.length > 0 && (
            <button type="button" onClick={() => setBoard((current) => ({ ...current, strokes: [] }))}>Effacer les dessins</button>
          )}
          <button type="button" onClick={() => zoom(-0.12)} aria-label="Dézoomer">−</button>
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button type="button" onClick={() => zoom(0.12)} aria-label="Zoomer">+</button>
          <button type="button" onClick={() => setViewport({ x: 34, y: 34, scale: 0.9 })}>Recentrer</button>
        </div>
      </header>

      <div
        className={tool === "draw" ? "project-canvas-viewport drawing" : "project-canvas-viewport"}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onWheel={wheel}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={dropMedia}
      >
        <div
          className="project-canvas-world"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
          }}
        >
          <svg className="project-canvas-drawings" width={canvasWidth} height={canvasHeight} aria-hidden="true">
            {board.strokes.map((stroke) => (
              <polyline
                key={stroke.id}
                points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
                stroke={stroke.color}
                strokeWidth={stroke.width}
              />
            ))}
            {draftStroke.length > 1 && (
              <polyline
                points={draftStroke.map((point) => `${point.x},${point.y}`).join(" ")}
                stroke="#7CF2C4"
                strokeWidth="4"
              />
            )}
          </svg>

          {board.objects.map((object) => {
            const style = {
              left: object.x,
              top: object.y,
              width: object.width,
              height: object.height,
              "--canvas-color": object.color
            } as React.CSSProperties;
            if (object.kind === "image" || object.kind === "video") {
              const url = object.mediaId ? mediaUrls[object.mediaId] : undefined;
              return (
                <article className="project-canvas-object canvas-media-object" key={object.id} style={style}>
                  <header onPointerDown={(event) => objectPointerDown(event, object)}>
                    <span>{object.fileName ?? "Média"}</span>
                    <button type="button" aria-label="Retirer du Canvas" onClick={() => removeObject(object)}>×</button>
                  </header>
                  {url && object.kind === "image" && <img src={url} alt={object.fileName ?? ""} draggable={false} />}
                  {url && object.kind === "video" && <video src={url} controls preload="metadata" playsInline />}
                  {!url && <span className="canvas-media-loading">Chargement…</span>}
                </article>
              );
            }
            if (object.kind === "task") {
              return (
                <article
                  className="project-canvas-object canvas-task-object"
                  key={object.id}
                  style={style}
                  onPointerDown={(event) => objectPointerDown(event, object)}
                >
                  <header>
                    <span>{object.taskKey}</span>
                    <button type="button" aria-label="Retirer du Canvas" onClick={() => removeObject(object)}>×</button>
                  </header>
                  <strong>{object.text}</strong>
                  <button type="button" onClick={() => object.taskId && onOpenTask(object.taskId)}>Ouvrir la tâche</button>
                </article>
              );
            }
            if (object.kind === "text") {
              return (
                <article
                  className="project-canvas-object canvas-text-object"
                  key={object.id}
                  style={style}
                  onPointerDown={(event) => objectPointerDown(event, object)}
                  onDoubleClick={() => editText(object)}
                >
                  <button type="button" aria-label="Retirer du Canvas" onClick={() => removeObject(object)}>×</button>
                  <p>{object.text}</p>
                  <small>Double-cliquer pour modifier</small>
                </article>
              );
            }
            return (
              <article
                className={`project-canvas-object canvas-shape-object canvas-shape-${object.kind}`}
                key={object.id}
                style={style}
                onPointerDown={(event) => objectPointerDown(event, object)}
              >
                <button type="button" aria-label="Retirer du Canvas" onClick={() => removeObject(object)}>×</button>
              </article>
            );
          })}
        </div>
      </div>
      <footer className="project-canvas-status">
        <span>{board.objects.length} objets · {board.strokes.length} dessins</span>
        <span>Déposez directement des images ou vidéos dans l’espace.</span>
        <span>{onBoardChange ? "Enregistrez pour partager le canvas à l’équipe." : "Le contenu est conservé localement sur cet appareil."}</span>
      </footer>
    </section>
  );
}

function readBoard(storageKey: string, initialState?: string): CanvasBoardState {
  const empty: CanvasBoardState = { version: 1, objects: [], strokes: [] };
  try {
    const source = initialState?.trim() || window.localStorage.getItem(storageKey) || "null";
    const parsed = JSON.parse(source) as Partial<CanvasBoardState> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.objects) || !Array.isArray(parsed.strokes)) return empty;
    return { version: 1, objects: parsed.objects, strokes: parsed.strokes };
  } catch {
    return empty;
  }
}

function statusColor(status: TaskOption["status"]) {
  return {
    todo: "#8FB7FF",
    in_progress: "#F2C27C",
    blocked: "#FF9FA4",
    done: "#7CF2C4",
    cancelled: "#A4AFBC"
  }[status];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

const mediaDatabaseName = "cytask-canvas-media";
const mediaStoreName = "media";

function openMediaDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(mediaDatabaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(mediaStoreName)) {
        request.result.createObjectStore(mediaStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeCanvasMedia(id: string, blob: Blob) {
  const database = await openMediaDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(mediaStoreName, "readwrite");
    transaction.objectStore(mediaStoreName).put(blob, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function readCanvasMedia(id: string) {
  const database = await openMediaDatabase();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(mediaStoreName, "readonly").objectStore(mediaStoreName).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return blob;
}

async function deleteCanvasMedia(id: string) {
  const database = await openMediaDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(mediaStoreName, "readwrite");
    transaction.objectStore(mediaStoreName).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}
