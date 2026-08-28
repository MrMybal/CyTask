'use client';

import JSZip from 'jszip';
import VideoAnnotator, { buildVideoPrompt, videoFrameStopFileName, type VideoProjectData } from './video-annotator';
import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type Tool = 'select' | 'pan' | 'frame' | 'shape' | 'rect' | 'arrow' | 'text' | 'draw' | 'cut' | 'polycut' | 'delete' | 'eyedropper';
type Category = 'modifier' | 'ajouter' | 'supprimer' | 'deplacer' | 'question';
type Point = { x: number; y: number };
type Layer = { id: string; name: string; color: string; visible: boolean };
type ReferenceImage = { id: string; name: string; dataUrl: string };

type AnnotationBase = {
  id: string;
  layerId: string;
  color: string;
  description: string;
  category: Category;
  references: ReferenceImage[];
  createdAt: number;
  groupId?: string;
};

type RectAnnotation = AnnotationBase & {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
};

type ArrowAnnotation = AnnotationBase & {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type TextAnnotation = AnnotationBase & {
  type: 'text';
  x: number;
  y: number;
};

type DrawAnnotation = AnnotationBase & {
  type: 'draw';
  points: Point[];
};

type CutAnnotation = AnnotationBase & {
  type: 'cut';
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
  w: number;
  h: number;
  imageData: string;
  polygon?: Point[];
};

type FrameAnnotation = AnnotationBase & {
  type: 'frame';
  x: number;
  y: number;
  w: number;
  h: number;
};

type ShapeAnnotation = AnnotationBase & {
  type: 'shape';
  shape: 'rectangle' | 'ellipse' | 'line';
  x: number;
  y: number;
  w: number;
  h: number;
  fillColor: string;
};

type DeleteAnnotation = AnnotationBase & {
  type: 'delete';
  x: number;
  y: number;
  w: number;
  h: number;
};

type ColorAnnotation = AnnotationBase & {
  type: 'color';
  x: number;
  y: number;
  sampledColor: string;
  replacementColor: string;
};

type Annotation =
  | RectAnnotation
  | ArrowAnnotation
  | TextAnnotation
  | DrawAnnotation
  | CutAnnotation
  | FrameAnnotation
  | ShapeAnnotation
  | DeleteAnnotation
  | ColorAnnotation;

type Draft = {
  tool: Exclude<Tool, 'select' | 'text' | 'pan' | 'polycut' | 'eyedropper'>;
  start: Point;
  end: Point;
  points: Point[];
};

type DragState =
  | { kind: 'create'; draft: Draft }
  | { kind: 'move'; id: string; start: Point; original: Annotation; before: Annotation[] }
  | {
      kind: 'pan';
      clientX: number;
      clientY: number;
      panX: number;
      panY: number;
    };

type ProjectFile = {
  version: 1;
  title: string;
  globalInstructions: string;
  image: { src: string; name: string } | null;
  layers: Layer[];
  annotations: Annotation[];
};

type CyTaskBridge = {
  session: string;
  parentOrigin: string;
  attachmentId: string;
  readOnly: boolean;
  maximumDocumentBytes: number;
};

type CyTaskBridgeMessage = {
  source?: unknown;
  type?: unknown;
  session?: unknown;
  attachmentId?: unknown;
  taskId?: unknown;
  title?: unknown;
  mediaKind?: unknown;
  file?: unknown;
  document?: unknown;
  readOnly?: unknown;
  maximumDocumentBytes?: unknown;
  ok?: unknown;
  revision?: unknown;
  error?: unknown;
};

type ImageBoardTab = {
  id: string;
  label: string;
  kind: 'image';
  project: ProjectFile;
};

type VideoBoardTab = {
  id: string;
  label: string;
  kind: 'video';
  file: File;
  project: VideoProjectData;
};

type BoardTab = ImageBoardTab | VideoBoardTab;

const INITIAL_LAYERS: Layer[] = [
  { id: 'ui', name: 'Corrections UI', color: '#ff5c49', visible: true },
  { id: 'questions', name: 'Questions', color: '#e9ad4a', visible: true },
];

function createBlankProject(): ProjectFile {
  return {
    version: 1,
    title: 'Corrections interface',
    globalInstructions: '',
    image: null,
    layers: structuredClone(INITIAL_LAYERS),
    annotations: [],
  };
}

const TOOL_LABELS: Record<Tool, string> = {
  select: 'Sélectionner et déplacer',
  pan: 'Main — déplacer la vue',
  frame: 'Cadre de groupe',
  shape: 'Forme simple',
  rect: 'Encadrer une zone',
  arrow: 'Tracer une flèche',
  text: 'Placer une note',
  draw: 'Dessiner librement',
  cut: 'Découpe rectangulaire',
  polycut: 'Découpe polygonale',
  delete: 'Zone à supprimer',
  eyedropper: 'Pipette de couleur',
};

const TOOL_HELP: Record<Tool, string> = {
  select: 'Clique une correction ou une découpe pour la déplacer.',
  pan: 'Fais glisser l’image. Raccourcis : clic droit ou Espace + glisser.',
  frame: 'Crée un cadre ; les formes et textes posés dedans lui seront liés.',
  shape: 'Dessine une forme simple, puis choisis rectangle, ellipse ou ligne.',
  rect: 'Glisse autour de la zone à corriger.',
  arrow: 'Glisse du point de départ vers la cible.',
  text: 'Clique à l’endroit où placer une note.',
  draw: 'Maintiens et dessine directement sur la capture.',
  cut: 'Glisse autour d’un élément, puis déplace la découpe créée.',
  polycut: 'Clique les sommets puis double-clique ou clique le premier point pour fermer.',
  delete: 'Encadre une zone : elle sera automatiquement marquée à supprimer.',
  eyedropper: 'Clique une couleur, puis choisis la couleur de remplacement.',
};

const CATEGORY_LABELS: Record<Category, string> = {
  modifier: 'Modifier',
  ajouter: 'Ajouter',
  supprimer: 'Supprimer',
  deplacer: 'Déplacer',
  question: 'Question',
};

const TYPE_LABELS: Record<Annotation['type'], string> = {
  rect: 'Zone',
  arrow: 'Flèche',
  text: 'Note',
  draw: 'Dessin',
  cut: 'Découpe déplacée',
  frame: 'Cadre de groupe',
  shape: 'Forme',
  delete: 'Zone supprimée',
  color: 'Couleur',
};

function createId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneAnnotations(value: Annotation[]) {
  return structuredClone(value);
}

function normalizeRect(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function annotationBounds(annotation: Annotation) {
  if (
    annotation.type === 'rect' ||
    annotation.type === 'cut' ||
    annotation.type === 'frame' ||
    annotation.type === 'shape' ||
    annotation.type === 'delete'
  ) {
    return { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h };
  }
  if (annotation.type === 'arrow') {
    return normalizeRect(
      { x: annotation.x1, y: annotation.y1 },
      { x: annotation.x2, y: annotation.y2 },
    );
  }
  if (annotation.type === 'text') {
    return { x: annotation.x, y: annotation.y - 28, w: 150, h: 34 };
  }
  if (annotation.type === 'color') {
    return { x: annotation.x - 18, y: annotation.y - 18, w: 96, h: 36 };
  }
  const xs = annotation.points.map((point) => point.x);
  const ys = annotation.points.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

function pointSegmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function moveAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (
    annotation.type === 'rect' ||
    annotation.type === 'cut' ||
    annotation.type === 'text' ||
    annotation.type === 'frame' ||
    annotation.type === 'shape' ||
    annotation.type === 'delete' ||
    annotation.type === 'color'
  ) {
    return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  }
  if (annotation.type === 'arrow') {
    return {
      ...annotation,
      x1: annotation.x1 + dx,
      y1: annotation.y1 + dy,
      x2: annotation.x2 + dx,
      y2: annotation.y2 + dy,
    };
  }
  return {
    ...annotation,
    points: annotation.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  };
}

function safeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'fichier';
}

function formatVideoTime(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const milliseconds = Math.floor((safe % 1) * 1000);
  return (
    (hours ? String(hours).padStart(2, '0') + ':' : '') +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0') + '.' +
    String(milliseconds).padStart(3, '0')
  );
}

function dataUrlBytes(source: string, label: string) {
  const separator = source.indexOf(',');
  if (!source.startsWith('data:') || separator < 0) {
    throw new Error(`${label} n’est pas incorporée au projet.`);
  }

  const metadata = source.slice(5, separator);
  const payload = source.slice(separator + 1);
  try {
    if (metadata.split(';').includes('base64')) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} est illisible : ${detail}`);
  }
}

type PreparedFileSave = {
  name: string;
  desktopToken?: string;
};

async function prepareFileSave(name: string): Promise<PreparedFileSave | null> {
  if (!window.cyAnnotaDesktop) return { name };

  const result = await window.cyAnnotaDesktop.chooseSaveFile({ name });
  if (result.canceled || !result.token) return null;
  return { name, desktopToken: result.token };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const characterChunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += characterChunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + characterChunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

async function showSaveFailure(message: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || 'Erreur inconnue');
  if (window.cyAnnotaDesktop) {
    try {
      await window.cyAnnotaDesktop.showErrorMessage({
        title: 'CyAnnota - erreur de sauvegarde',
        message,
        detail:
          detail +
          '\n\nLe fichier final n’a pas été remplacé. Vous pouvez fermer cette fenêtre et réessayer.',
      });
      return;
    } catch {
      // Le dialogue natif a lui-même échoué : le navigateur garde un dernier recours visible.
    }
  }
  window.alert(message + '\n\nDétail technique : ' + detail);
}

async function savePreparedBlob(blob: Blob, prepared: PreparedFileSave) {
  if (prepared.desktopToken) {
    if (!window.cyAnnotaDesktop) throw new Error('Pont de sauvegarde desktop indisponible');
    if (!blob.size) throw new Error('Le fichier généré est vide.');

    const desktop = window.cyAnnotaDesktop;
    const token = prepared.desktopToken;
    try {
      await desktop.beginSaveFile({ token });
      const chunkSize = 512 * 1024;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const slice = blob.slice(offset, Math.min(offset + chunkSize, blob.size));
        const base64 = arrayBufferToBase64(await slice.arrayBuffer());
        const result = await desktop.writeSaveChunk({ token, base64 });
        if (result.written !== slice.size) {
          throw new Error(`Écriture incomplète : ${result.written} octets sur ${slice.size}.`);
        }
      }
      const result = await desktop.finishSaveFile({ token });
      if (result.bytesWritten !== blob.size) {
        throw new Error(`Fichier incomplet : ${result.bytesWritten} octets sur ${blob.size}.`);
      }
      return result.saved;
    } catch (error) {
      await desktop.abortSaveFile({ token }).catch(() => undefined);
      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = prepared.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

async function downloadBlob(blob: Blob, name: string) {
  const prepared = await prepareFileSave(name);
  if (!prepared) return false;
  return savePreparedBlob(blob, prepared);
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function openDraftDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('annota-local', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('projects')) {
        request.result.createObjectStore('projects');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeDraft(project: ProjectFile) {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put(project, 'last');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function readDraft() {
  const database = await openDraftDatabase();
  const result = await new Promise<ProjectFile | undefined>((resolve, reject) => {
    const request = database.transaction('projects', 'readonly').objectStore('projects').get('last');
    request.onsuccess = () => resolve(request.result as ProjectFile | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

export default function Home() {
  const [tool, setTool] = useState<Tool>('select');
  const [tabs, setTabs] = useState<BoardTab[]>([
    { id: 'board-1', label: 'Nouvelle image', kind: 'image', project: createBlankProject() },
  ]);
  const [activeTabId, setActiveTabId] = useState('board-1');
  const [imageSource, setImageSource] = useState<string | null>(null);
  const [imageName, setImageName] = useState('Aucune capture');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [layers, setLayers] = useState<Layer[]>(INITIAL_LAYERS);
  const [activeLayerId, setActiveLayerId] = useState('ui');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [projectTitle, setProjectTitle] = useState('Corrections interface');
  const [globalInstructions, setGlobalInstructions] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPrompt, setExportPrompt] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Prêt');
  const [renderTick, setRenderTick] = useState(0);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const [isPanning, setIsPanning] = useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [isDraggingReference, setIsDraggingReference] = useState(false);
  const [cyTaskBridge, setCyTaskBridge] = useState<CyTaskBridge | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const annotationsRef = useRef<Annotation[]>(annotations);
  const cutImageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const colorSampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const importNoticeTimer = useRef<number | null>(null);
  const spaceHeldRef = useRef(false);
  const zoomRef = useRef(zoom);
  const panRef = useRef<Point>(pan);
  const cyTaskBridgeRef = useRef<CyTaskBridge | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  const hasExportableMedia = tabs.some(
    (tab) => tab.kind === 'video' || Boolean(tab.project.image),
  );
  const selected = annotations.find((annotation) => annotation.id === selectedId) ?? null;
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? layers[0];
  const visibleLayerIds = useMemo(
    () => new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id)),
    [layers],
  );

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const hostWindow = window.opener ?? (window.parent !== window ? window.parent : null);
    if (parameters.get('integration') !== 'cytask' || !hostWindow) return;

    const session = parameters.get('session') || '';
    const attachmentId = parameters.get('attachmentId') || '';
    const requestedParentOrigin = parameters.get('parentOrigin') || '';
    let parentOrigin = '';
    try {
      const parsed = new URL(requestedParentOrigin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== requestedParentOrigin) return;
      parentOrigin = parsed.origin;
    } catch {
      return;
    }
    if (!session || !attachmentId) return;


    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== hostWindow || event.origin !== parentOrigin || !isRecord(event.data)) return;
      const message = event.data as CyTaskBridgeMessage;
      if (message.source !== 'cytask' || message.session !== session) return;

      if (message.type === 'open-media' && message.attachmentId === attachmentId) {
        openCyTaskMedia(message, parentOrigin, session, attachmentId).catch((error) => {
          const text = error instanceof Error ? error.message : 'Média CyTask invalide';
          setSaveStatus('Échec du chargement CyTask');
          showImportNotice(text);
        });
        return;
      }

      if (message.type === 'save-result') {
        if (message.ok === true) {
          setSaveStatus(
            typeof message.revision === 'number'
              ? 'Enregistré dans CyTask · rév. ' + message.revision
              : 'Enregistré dans CyTask',
          );
          showImportNotice('Annotations enregistrées dans la tâche CyTask');
        } else {
          const text = typeof message.error === 'string'
            ? message.error
            : 'CyTask a refusé la sauvegarde';
          setSaveStatus('Sauvegarde CyTask refusée');
          showImportNotice(text);
        }
      }
    };

    window.addEventListener('message', receive);
    hostWindow.postMessage({ source: 'cyannota', type: 'ready', session }, parentOrigin);
    return () => window.removeEventListener('message', receive);
  }, []);

  async function openCyTaskMedia(
    message: CyTaskBridgeMessage,
    parentOrigin: string,
    session: string,
    attachmentId: string,
  ) {
    if (!(message.file instanceof Blob)) throw new Error('Le fichier CyTask est absent.');
    if (message.mediaKind !== 'image' && message.mediaKind !== 'video') {
      throw new Error('Le type de média CyTask est invalide.');
    }

    const title = typeof message.title === 'string' && message.title.trim()
      ? message.title.trim()
      : message.mediaKind === 'video' ? 'video.mp4' : 'image.png';
    const file = message.file instanceof File
      ? message.file
      : new File([message.file], title, { type: message.file.type });
    const bridge: CyTaskBridge = {
      session,
      parentOrigin,
      attachmentId,
      readOnly: message.readOnly === true,
      maximumDocumentBytes: typeof message.maximumDocumentBytes === 'number'
        ? message.maximumDocumentBytes
        : 4_194_304,
    };
    cyTaskBridgeRef.current = bridge;
    setCyTaskBridge(bridge);

    if (message.mediaKind === 'video') {
      const project = isRecord(message.document)
        ? message.document as unknown as VideoProjectData
        : undefined;
      if (project && (project.version !== 1 || project.kind !== 'video'
        || !Array.isArray(project.annotations))) {
        throw new Error('Le projet vidéo CyTask est invalide.');
      }
      loadVideoFile(file, project, true);
    } else {
      const dataUrl = await readAsDataUrl(file);
      const project = isRecord(message.document)
        ? structuredClone(message.document) as unknown as ProjectFile
        : createBlankProject();
      if (project.version !== 1 || !Array.isArray(project.layers)
        || !Array.isArray(project.annotations)) {
        throw new Error('Le projet image CyTask est invalide.');
      }
      project.title = project.title || title.replace(/.[^.]+$/, '');
      project.image = { src: dataUrl, name: title };
      const id = createId();
      setTabs([{ id, label: title, kind: 'image', project: structuredClone(project) }]);
      setActiveTabId(id);
      applyProject(project);
      setTool('select');
    }

    setSaveStatus(bridge.readOnly ? 'Consultation CyTask' : 'Lié à CyTask · prêt');
    showImportNotice(
      bridge.readOnly
        ? 'Média CyTask ouvert en consultation'
        : 'Média CyTask prêt à annoter',
    );
  }

  function sendCyTaskDocument(document: ProjectFile | VideoProjectData) {
    const bridge = cyTaskBridgeRef.current;
    const hostWindow = window.opener ?? (window.parent !== window ? window.parent : null);
    if (!bridge || !hostWindow) return false;
    if (bridge.readOnly) {
      setSaveStatus('Consultation seule');
      showImportNotice('Votre rôle CyTask ne permet pas de modifier les annotations');
      return false;
    }

    const clean = structuredClone(document);
    if (!('kind' in clean)) {
      clean.image = clean.image
        ? { ...clean.image, src: 'cytask-attachment:' + bridge.attachmentId }
        : { src: 'cytask-attachment:' + bridge.attachmentId, name: imageName };
    }
    const size = new Blob([JSON.stringify(clean)]).size;
    if (size > bridge.maximumDocumentBytes) {
      setSaveStatus('Document CyTask trop volumineux');
      showImportNotice('Réduisez les captures de référence avant de sauver');
      return false;
    }

    hostWindow.postMessage({
      source: 'cyannota',
      type: 'save-annotations',
      session: bridge.session,
      attachmentId: bridge.attachmentId,
      document: clean,
    }, bridge.parentOrigin);
    setSaveStatus('Enregistrement dans CyTask…');
    return true;
  }

  function projectData(): ProjectFile {
    return {
      version: 1,
      title: projectTitle,
      globalInstructions,
      image: imageSource ? { src: imageSource, name: imageName } : null,
      layers,
      annotations,
    };
  }

  function applyProject(project: ProjectFile) {
    if (project.version !== 1 || !Array.isArray(project.layers) || !Array.isArray(project.annotations)) {
      throw new Error('Format de projet CyAnnota invalide');
    }
    setProjectTitle(project.title || 'Corrections interface');
    setGlobalInstructions(project.globalInstructions || '');
    setLayers(project.layers.length ? project.layers : INITIAL_LAYERS);
    setActiveLayerId(project.layers[0]?.id || 'ui');
    setAnnotations(project.annotations);
    setImageSource(project.image?.src || null);
    setImageName(project.image?.name || 'Aucune capture');
    setSelectedId(null);
    setPast([]);
    setFuture([]);
    setPolygonPoints([]);
    cutImageCache.current.clear();
  }

  function saveActiveTab(items: BoardTab[]) {
    const snapshot = structuredClone(projectData());
    return items.map((tab) =>
      tab.id === activeTabId && tab.kind === 'image'
        ? {
            ...tab,
            label: snapshot.image?.name || snapshot.title || 'Nouvelle image',
            project: snapshot,
          }
        : tab,
    );
  }

  function activateTab(tabId: string) {
    if (tabId === activeTabId) return;
    const target = tabs.find((tab) => tab.id === tabId);
    if (!target) return;
    setTabs((items) => saveActiveTab(items));
    setActiveTabId(tabId);
    if (target.kind === 'image') {
      applyProject(structuredClone(target.project));
      setTool('select');
    }
  }

  function createTab(project: ProjectFile = createBlankProject(), label = 'Nouvelle image') {
    const id = createId();
    const nextTab: ImageBoardTab = {
      id,
      label,
      kind: 'image',
      project: structuredClone(project),
    };
    setTabs((items) => [...saveActiveTab(items), nextTab]);
    setActiveTabId(id);
    applyProject(structuredClone(project));
    setTool('select');
  }

  function closeTab(tabId: string) {
    if (tabs.length === 1) {
      const project = createBlankProject();
      setTabs([{ id: tabs[0].id, label: 'Nouvelle image', kind: 'image', project }]);
      setActiveTabId(tabs[0].id);
      applyProject(project);
      return;
    }

    if (tabId !== activeTabId) {
      setTabs((items) => items.filter((tab) => tab.id !== tabId));
      return;
    }

    const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
    const target = tabs[currentIndex + 1] || tabs[currentIndex - 1];
    setTabs((items) => items.filter((tab) => tab.id !== tabId));
    setActiveTabId(target.id);
    if (target.kind === 'image') {
      applyProject(structuredClone(target.project));
      setTool('select');
    }
  }

  useEffect(() => {
    const snapshot = projectData();
    setTabs((items) =>
      items.map((tab) =>
        tab.id === activeTabId && tab.kind === 'image'
          ? {
              ...tab,
              label: snapshot.image?.name || snapshot.title || 'Nouvelle image',
              project: snapshot,
            }
          : tab,
      ),
    );
  }, [
    activeTabId,
    imageSource,
    imageName,
    layers,
    annotations,
    projectTitle,
    globalInstructions,
  ]);

  useEffect(() => {
    readDraft().then((project) => setHasLocalDraft(Boolean(project?.image))).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!imageSource) {
      imageRef.current = null;
      setImageSize({ width: 0, height: 0 });
      return;
    }
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      window.requestAnimationFrame(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const nextZoom = Math.min(
          1,
          Math.max(
            0.1,
            Math.min(
              (stage.clientWidth - 76) / image.naturalWidth,
              (stage.clientHeight - 76) / image.naturalHeight,
            ),
          ),
        );
        const nextPan = {
          x: (stage.clientWidth - image.naturalWidth * nextZoom) / 2,
          y: (stage.clientHeight - image.naturalHeight * nextZoom) / 2,
        };
        zoomRef.current = nextZoom;
        panRef.current = nextPan;
        setZoom(nextZoom);
        setPan(nextPan);
      });
    };
    image.src = imageSource;
  }, [imageSource]);

  useEffect(() => {
    for (const annotation of annotations) {
      if (annotation.type !== 'cut' || cutImageCache.current.has(annotation.id)) continue;
      const cutImage = new Image();
      cutImage.onload = () => {
        cutImageCache.current.set(annotation.id, cutImage);
        setRenderTick((value) => value + 1);
      };
      cutImage.src = annotation.imageData;
    }
  }, [annotations]);

  useEffect(() => {
    if (!imageSource || cyTaskBridgeRef.current) return;
    setSaveStatus('Enregistrement…');
    const timeout = window.setTimeout(() => {
      storeDraft(projectData())
        .then(() => {
          setSaveStatus('Enregistré localement');
          setHasLocalDraft(true);
        })
        .catch(() => setSaveStatus('Sauvegarde manuelle conseillée'));
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [imageSource, imageName, annotations, layers, projectTitle, globalInstructions]);

  function unitSize() {
    return Math.max(1, Math.min(3.2, imageSize.width / 1100));
  }

  function drawArrow(
    context: CanvasRenderingContext2D,
    start: Point,
    end: Point,
    color: string,
    lineWidth: number,
  ) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = lineWidth * 5;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = 'round';
    context.stroke();
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  function drawBadge(
    context: CanvasRenderingContext2D,
    annotation: Annotation,
    index: number,
    unit: number,
  ) {
    const bounds = annotationBounds(annotation);
    const radius = 11 * unit;
    const centerX = bounds.x - radius * 0.25;
    const centerY = bounds.y - radius * 0.25;
    context.save();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = annotation.color;
    context.fill();
    context.lineWidth = 2 * unit;
    context.strokeStyle = '#171513';
    context.stroke();
    context.fillStyle = '#171513';
    context.font = '800 ' + 10 * unit + 'px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1).padStart(2, '0'), centerX, centerY + unit * 0.4);
    context.restore();
  }

  function drawAnnotation(
    context: CanvasRenderingContext2D,
    annotation: Annotation,
    index: number,
    showSelection: boolean,
    renderWidth = imageSize.width,
    cutImages = cutImageCache.current,
    selectionId: string | null = selectedId,
    sourceAnnotations = annotations,
  ) {
    const unit = Math.max(1, Math.min(3.2, renderWidth / 1100));
    const lineWidth = 2.4 * unit;
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';

    if (annotation.type === 'rect') {
      context.strokeStyle = annotation.color;
      context.lineWidth = lineWidth;
      context.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
      context.fillStyle = annotation.color + '18';
      context.fillRect(annotation.x, annotation.y, annotation.w, annotation.h);
    }

    if (annotation.type === 'frame') {
      context.fillStyle = annotation.color + '10';
      context.fillRect(annotation.x, annotation.y, annotation.w, annotation.h);
      context.strokeStyle = annotation.color;
      context.lineWidth = lineWidth;
      context.setLineDash([10 * unit, 6 * unit]);
      context.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
      context.setLineDash([]);
      context.strokeStyle = annotation.color + '66';
      context.lineWidth = unit;
      context.strokeRect(
        annotation.x + 6 * unit,
        annotation.y + 6 * unit,
        Math.max(0, annotation.w - 12 * unit),
        Math.max(0, annotation.h - 12 * unit),
      );
      const childCount = sourceAnnotations.filter((item) => item.groupId === annotation.id).length;
      context.font = '800 ' + 9 * unit + 'px Arial';
      const frameLabel = 'CADRE · ' + childCount + ' ÉLÉMENT' + (childCount > 1 ? 'S' : '');
      const frameLabelWidth = context.measureText(frameLabel).width + 16 * unit;
      context.fillStyle = annotation.color;
      context.fillRect(annotation.x, annotation.y - 21 * unit, frameLabelWidth, 21 * unit);
      context.fillStyle = '#171513';
      context.textBaseline = 'middle';
      context.fillText(frameLabel, annotation.x + 8 * unit, annotation.y - 10 * unit);
    }

    if (annotation.type === 'shape') {
      context.strokeStyle = annotation.color;
      context.fillStyle = annotation.fillColor + '30';
      context.lineWidth = lineWidth;
      if (annotation.shape === 'ellipse') {
        context.beginPath();
        context.ellipse(
          annotation.x + annotation.w / 2,
          annotation.y + annotation.h / 2,
          Math.abs(annotation.w / 2),
          Math.abs(annotation.h / 2),
          0,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.stroke();
      } else if (annotation.shape === 'line') {
        context.beginPath();
        context.moveTo(annotation.x, annotation.y);
        context.lineTo(annotation.x + annotation.w, annotation.y + annotation.h);
        context.stroke();
      } else {
        context.fillRect(annotation.x, annotation.y, annotation.w, annotation.h);
        context.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
      }
    }

    if (annotation.type === 'delete') {
      const deleteColor = '#ff453a';
      context.fillStyle = deleteColor + '26';
      context.fillRect(annotation.x, annotation.y, annotation.w, annotation.h);
      context.strokeStyle = deleteColor;
      context.lineWidth = 2.5 * unit;
      context.setLineDash([9 * unit, 5 * unit]);
      context.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
      context.setLineDash([]);
      context.beginPath();
      context.moveTo(annotation.x, annotation.y);
      context.lineTo(annotation.x + annotation.w, annotation.y + annotation.h);
      context.moveTo(annotation.x + annotation.w, annotation.y);
      context.lineTo(annotation.x, annotation.y + annotation.h);
      context.stroke();
      context.font = '900 ' + 10 * unit + 'px Arial';
      const deleteLabel = 'SUPPRIMER';
      const deleteWidth = context.measureText(deleteLabel).width + 16 * unit;
      context.fillStyle = deleteColor;
      context.fillRect(annotation.x, annotation.y, deleteWidth, 22 * unit);
      context.fillStyle = '#ffffff';
      context.textBaseline = 'middle';
      context.fillText(deleteLabel, annotation.x + 8 * unit, annotation.y + 11 * unit);
    }

    if (annotation.type === 'arrow') {
      drawArrow(
        context,
        { x: annotation.x1, y: annotation.y1 },
        { x: annotation.x2, y: annotation.y2 },
        annotation.color,
        lineWidth,
      );
    }

    if (annotation.type === 'text') {
      const label = annotation.description.trim() || 'Ajouter une explication';
      context.font = '700 ' + 12 * unit + 'px Arial';
      const textWidth = Math.min(320 * unit, context.measureText(label).width + 24 * unit);
      context.fillStyle = '#191817eF';
      context.strokeStyle = annotation.color;
      context.lineWidth = 1.5 * unit;
      context.beginPath();
      context.roundRect(annotation.x, annotation.y - 27 * unit, textWidth, 29 * unit, 7 * unit);
      context.fill();
      context.stroke();
      context.save();
      context.beginPath();
      context.rect(annotation.x + 8 * unit, annotation.y - 25 * unit, textWidth - 16 * unit, 25 * unit);
      context.clip();
      context.fillStyle = '#ffffff';
      context.textBaseline = 'middle';
      context.fillText(label, annotation.x + 12 * unit, annotation.y - 12.5 * unit);
      context.restore();
    }

    if (annotation.type === 'draw') {
      if (annotation.points.length > 1) {
        context.beginPath();
        context.moveTo(annotation.points[0].x, annotation.points[0].y);
        for (const point of annotation.points.slice(1)) context.lineTo(point.x, point.y);
        context.strokeStyle = annotation.color;
        context.lineWidth = lineWidth;
        context.stroke();
      }
    }

    if (annotation.type === 'color') {
      context.beginPath();
      context.arc(annotation.x, annotation.y, 9 * unit, 0, Math.PI * 2);
      context.fillStyle = annotation.sampledColor;
      context.fill();
      context.strokeStyle = '#ffffff';
      context.lineWidth = 2 * unit;
      context.stroke();
      context.beginPath();
      context.arc(annotation.x, annotation.y, 14 * unit, 0, Math.PI * 2);
      context.strokeStyle = annotation.color;
      context.lineWidth = 1.5 * unit;
      context.stroke();

      const swatchY = annotation.y;
      const oldX = annotation.x + 25 * unit;
      const newX = annotation.x + 58 * unit;
      context.fillStyle = annotation.sampledColor;
      context.fillRect(oldX, swatchY - 9 * unit, 18 * unit, 18 * unit);
      context.strokeStyle = '#ffffff88';
      context.lineWidth = unit;
      context.strokeRect(oldX, swatchY - 9 * unit, 18 * unit, 18 * unit);
      drawArrow(
        context,
        { x: oldX + 20 * unit, y: swatchY },
        { x: newX - 3 * unit, y: swatchY },
        annotation.color,
        unit,
      );
      context.fillStyle = annotation.replacementColor;
      context.fillRect(newX, swatchY - 9 * unit, 18 * unit, 18 * unit);
      context.strokeRect(newX, swatchY - 9 * unit, 18 * unit, 18 * unit);
    }

    if (annotation.type === 'cut') {
      const moved = Math.abs(annotation.x - annotation.sourceX) > 1 || Math.abs(annotation.y - annotation.sourceY) > 1;
      const destinationPolygon = annotation.polygon?.map((point) => ({
        x: annotation.x + point.x - annotation.sourceX,
        y: annotation.y + point.y - annotation.sourceY,
      }));

      if (moved) {
        context.save();
        context.fillStyle = annotation.color + '1f';
        context.strokeStyle = annotation.color + 'bb';
        context.lineWidth = 1.5 * unit;
        context.setLineDash([7 * unit, 5 * unit]);
        if (annotation.polygon?.length) {
          context.beginPath();
          context.moveTo(annotation.polygon[0].x, annotation.polygon[0].y);
          for (const point of annotation.polygon.slice(1)) context.lineTo(point.x, point.y);
          context.closePath();
          context.fill();
          context.stroke();
        } else {
          context.fillRect(annotation.sourceX, annotation.sourceY, annotation.w, annotation.h);
          context.strokeRect(annotation.sourceX, annotation.sourceY, annotation.w, annotation.h);
        }
        context.restore();
        drawArrow(
          context,
          { x: annotation.sourceX + annotation.w / 2, y: annotation.sourceY + annotation.h / 2 },
          { x: annotation.x + annotation.w / 2, y: annotation.y + annotation.h / 2 },
          annotation.color + 'cc',
          1.5 * unit,
        );
      }

      const cutImage = cutImages.get(annotation.id);
      if (cutImage) context.drawImage(cutImage, annotation.x, annotation.y, annotation.w, annotation.h);
      context.strokeStyle = annotation.color;
      context.lineWidth = lineWidth;
      if (destinationPolygon?.length) {
        context.beginPath();
        context.moveTo(destinationPolygon[0].x, destinationPolygon[0].y);
        for (const point of destinationPolygon.slice(1)) context.lineTo(point.x, point.y);
        context.closePath();
        context.stroke();
      } else {
        context.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
      }
    }

    drawBadge(context, annotation, index, unit);

    if (showSelection && annotation.id === selectionId) {
      const bounds = annotationBounds(annotation);
      context.setLineDash([6 * unit, 4 * unit]);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.3 * unit;
      context.strokeRect(bounds.x - 5 * unit, bounds.y - 5 * unit, bounds.w + 10 * unit, bounds.h + 10 * unit);
    }
    context.restore();
  }

  function drawDraft(context: CanvasRenderingContext2D, value: Draft) {
    const unit = unitSize();
    const color = value.tool === 'delete' ? '#ff453a' : activeLayer?.color || '#ff5c49';
    const lineWidth = 2 * unit;
    const bounds = normalizeRect(value.start, value.end);
    context.save();
    context.setLineDash(value.tool === 'draw' ? [] : [7 * unit, 5 * unit]);
    context.strokeStyle = color;
    context.fillStyle = color + '1f';
    context.lineWidth = lineWidth;

    if (
      value.tool === 'rect' ||
      value.tool === 'cut' ||
      value.tool === 'frame' ||
      value.tool === 'delete'
    ) {
      context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    }
    if (value.tool === 'delete') {
      context.beginPath();
      context.moveTo(bounds.x, bounds.y);
      context.lineTo(bounds.x + bounds.w, bounds.y + bounds.h);
      context.moveTo(bounds.x + bounds.w, bounds.y);
      context.lineTo(bounds.x, bounds.y + bounds.h);
      context.stroke();
    }
    if (value.tool === 'shape') {
      context.beginPath();
      context.ellipse(
        bounds.x + bounds.w / 2,
        bounds.y + bounds.h / 2,
        bounds.w / 2,
        bounds.h / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.stroke();
    }
    if (value.tool === 'arrow') drawArrow(context, value.start, value.end, color, lineWidth);
    if (value.tool === 'draw' && value.points.length > 1) {
      context.beginPath();
      context.moveTo(value.points[0].x, value.points[0].y);
      for (const point of value.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
    context.restore();
  }

  function drawPolygonDraft(context: CanvasRenderingContext2D, points: Point[]) {
    if (!points.length) return;
    const unit = unitSize();
    const color = activeLayer?.color || '#ff5c49';
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color + '18';
    context.lineWidth = 2 * unit;
    context.setLineDash([7 * unit, 5 * unit]);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    if (points.length > 2) {
      context.closePath();
      context.fill();
    }
    context.stroke();
    for (const point of points) {
      context.beginPath();
      context.arc(point.x, point.y, 5 * unit, 0, Math.PI * 2);
      context.fillStyle = '#171513';
      context.fill();
      context.strokeStyle = color;
      context.setLineDash([]);
      context.stroke();
    }
    context.restore();
  }

  function paintCanvas(
    context: CanvasRenderingContext2D,
    layerIds: Set<string>,
    showSelection = false,
    currentDraft: Draft | null = null,
  ) {
    context.clearRect(0, 0, imageSize.width, imageSize.height);
    if (imageRef.current) {
      context.drawImage(imageRef.current, 0, 0, imageSize.width, imageSize.height);
    }
    annotations.forEach((annotation, index) => {
      if (layerIds.has(annotation.layerId)) drawAnnotation(context, annotation, index, showSelection);
    });
    if (currentDraft) drawDraft(context, currentDraft);
    if (showSelection && polygonPoints.length) drawPolygonDraft(context, polygonPoints);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSize.width || !imageSize.height) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    paintCanvas(context, visibleLayerIds, true, draft);
  }, [imageSize, annotations, layers, selectedId, draft, polygonPoints, renderTick]);

  function commitAnnotations(next: Annotation[], before = annotationsRef.current) {
    setPast((items) => [...items, cloneAnnotations(before)].slice(-50));
    setFuture([]);
    setAnnotations(next);
  }

  function updateAnnotation(id: string, patch: Partial<Annotation>) {
    setAnnotations((items) =>
      items.map((annotation) =>
        annotation.id === id ? ({ ...annotation, ...patch } as Annotation) : annotation,
      ),
    );
  }

  function undo() {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setFuture((items) => [cloneAnnotations(annotationsRef.current), ...items].slice(0, 50));
    setAnnotations(previous);
    setPast((items) => items.slice(0, -1));
    setSelectedId(null);
  }

  function redo() {
    if (!future.length) return;
    const next = future[0];
    setPast((items) => [...items, cloneAnnotations(annotationsRef.current)].slice(-50));
    setAnnotations(next);
    setFuture((items) => items.slice(1));
    setSelectedId(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    commitAnnotations(annotationsRef.current.filter((annotation) => annotation.id !== selectedId));
    setSelectedId(null);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.code === 'Space' && imageSource) {
        event.preventDefault();
        spaceHeldRef.current = true;
        setIsSpaceHeld(true);
      }
      if (event.key === 'Escape' && polygonPoints.length) {
        event.preventDefault();
        setPolygonPoints([]);
      }
      if (event.key === 'Enter' && polygonPoints.length >= 3) {
        event.preventDefault();
        finishPolygonCut();
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code !== 'Space') return;
      spaceHeldRef.current = false;
      setIsSpaceHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, ((event.clientX - bounds.left) / bounds.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((event.clientY - bounds.top) / bounds.height) * canvas.height)),
    };
  }

  function changeZoom(nextValue: number, clientX?: number, clientY?: number) {
    const nextZoom = Math.max(0.1, Math.min(5, nextValue));
    const stage = stageRef.current;
    if (!stage || !imageSize.width || !imageSize.height) {
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      return;
    }

    const stageBounds = stage.getBoundingClientRect();
    const focusX = (clientX ?? stageBounds.left + stage.clientWidth / 2) - stageBounds.left;
    const focusY = (clientY ?? stageBounds.top + stage.clientHeight / 2) - stageBounds.top;
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;
    const imageX = (focusX - currentPan.x) / currentZoom;
    const imageY = (focusY - currentPan.y) / currentZoom;
    const nextPan = {
      x: focusX - imageX * nextZoom,
      y: focusY - imageY * nextZoom,
    };

    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  }

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    function onWheel(event: WheelEvent) {
      if (!imageSource) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      changeZoom(zoomRef.current * factor, event.clientX, event.clientY);
    }
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [imageSource, imageSize.width, imageSize.height]);

  function hitAnnotation(point: Point) {
    const tolerance = 12 / Math.max(zoom, 0.1);
    return [...annotationsRef.current].reverse().find((annotation) => {
      if (!visibleLayerIds.has(annotation.layerId)) return false;
      if (annotation.type === 'arrow') {
        return pointSegmentDistance(
          point,
          { x: annotation.x1, y: annotation.y1 },
          { x: annotation.x2, y: annotation.y2 },
        ) <= tolerance;
      }
      const bounds = annotationBounds(annotation);
      return (
        point.x >= bounds.x - tolerance &&
        point.x <= bounds.x + bounds.w + tolerance &&
        point.y >= bounds.y - tolerance &&
        point.y <= bounds.y + bounds.h + tolerance
      );
    });
  }

  function groupAtPoint(point?: Point) {
    if (!point) return undefined;
    return [...annotationsRef.current]
      .reverse()
      .find((annotation): annotation is FrameAnnotation => {
        if (annotation.type !== 'frame') return false;
        return (
          point.x >= annotation.x &&
          point.x <= annotation.x + annotation.w &&
          point.y >= annotation.y &&
          point.y <= annotation.y + annotation.h
        );
      })?.id;
  }

  function baseAnnotation(
    category: Category,
    description: string,
    point?: Point,
  ): AnnotationBase {
    return {
      id: createId(),
      layerId: activeLayerId,
      color: activeLayer?.color || '#ff5c49',
      description,
      category,
      references: [],
      createdAt: Date.now(),
      groupId: groupAtPoint(point),
    };
  }

  function addAnnotation(annotation: Annotation) {
    commitAnnotations([...annotationsRef.current, annotation]);
    setSelectedId(annotation.id);
  }

  function sampleImageColor(point: Point) {
    const image = imageRef.current;
    if (!image) return '#000000';
    const sampleCanvas = colorSampleCanvasRef.current || document.createElement('canvas');
    colorSampleCanvasRef.current = sampleCanvas;
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) return '#000000';
    const sampleX = Math.max(0, Math.min(image.naturalWidth - 1, Math.floor(point.x)));
    const sampleY = Math.max(0, Math.min(image.naturalHeight - 1, Math.floor(point.y)));
    context.clearRect(0, 0, 1, 1);
    context.drawImage(image, sampleX, sampleY, 1, 1, 0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return (
      '#' +
      [red, green, blue]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
    );
  }

  function colorInstruction(sampledColor: string) {
    return 'Remplacer la couleur ' + sampledColor + ' par la couleur choisie.';
  }

  function moveAnnotationAndRefreshColor(annotation: Annotation, dx: number, dy: number) {
    const moved = moveAnnotation(annotation, dx, dy);
    if (moved.type !== 'color') return moved;
    const sampledColor = sampleImageColor({ x: moved.x, y: moved.y });
    const hasAutomaticDescription =
      /^Remplacer la couleur #[0-9a-f]{6} par la couleur choisie\.$/i.test(
        annotation.description.trim(),
      );
    return {
      ...moved,
      sampledColor,
      description: hasAutomaticDescription
        ? colorInstruction(sampledColor)
        : moved.description,
    };
  }

  function createColorAnnotation(point: Point) {
    const sampledColor = sampleImageColor(point);
    const base = baseAnnotation(
      'modifier',
      colorInstruction(sampledColor),
      point,
    );
    addAnnotation({
      ...base,
      type: 'color',
      x: point.x,
      y: point.y,
      sampledColor,
      replacementColor: '#ffffff',
    });
    showImportNotice('Couleur capturée : ' + sampledColor);
    setTool('select');
  }

  function finishPolygonCut(points: Point[] = polygonPoints) {
    if (!imageRef.current || points.length < 3) return;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const sourceX = Math.max(0, Math.floor(Math.min(...xs)));
    const sourceY = Math.max(0, Math.floor(Math.min(...ys)));
    const width = Math.max(1, Math.ceil(Math.max(...xs)) - sourceX);
    const height = Math.max(1, Math.ceil(Math.max(...ys)) - sourceY);
    const cutCanvas = document.createElement('canvas');
    cutCanvas.width = width;
    cutCanvas.height = height;
    const context = cutCanvas.getContext('2d');
    if (!context) return;
    context.save();
    context.beginPath();
    context.moveTo(points[0].x - sourceX, points[0].y - sourceY);
    for (const point of points.slice(1)) {
      context.lineTo(point.x - sourceX, point.y - sourceY);
    }
    context.closePath();
    context.clip();
    context.drawImage(
      imageRef.current,
      sourceX,
      sourceY,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    context.restore();

    const base = baseAnnotation(
      'deplacer',
      'Déplacer cet élément découpé selon le contour polygonal.',
      points[0],
    );
    const annotation: CutAnnotation = {
      ...base,
      type: 'cut',
      sourceX,
      sourceY,
      x: sourceX,
      y: sourceY,
      w: width,
      h: height,
      imageData: cutCanvas.toDataURL('image/png'),
      polygon: points,
    };
    addAnnotation(annotation);
    setPolygonPoints([]);
    setTool('select');
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!imageSource || ![0, 1, 2].includes(event.button)) return;
    if (event.button === 2) event.preventDefault();
    const point = canvasPoint(event);

    if (event.button === 0 && tool === 'polycut') {
      const firstPoint = polygonPoints[0];
      const closesOnFirstPoint =
        polygonPoints.length >= 3 &&
        firstPoint &&
        Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= 14 / Math.max(zoom, 0.1);
      if ((event.detail >= 2 && polygonPoints.length >= 3) || closesOnFirstPoint) {
        finishPolygonCut(polygonPoints);
      } else {
        setPolygonPoints((items) => [...items, point]);
      }
      return;
    }

    if (event.button === 0 && tool === 'eyedropper') {
      createColorAnnotation(point);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'pan' || event.button === 1 || event.button === 2 || spaceHeldRef.current) {
      dragRef.current = {
        kind: 'pan',
        clientX: event.clientX,
        clientY: event.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      };
      setIsPanning(true);
      return;
    }

    if (tool === 'select') {
      const found = hitAnnotation(point);
      setSelectedId(found?.id || null);
      if (found) {
        dragRef.current = {
          kind: 'move',
          id: found.id,
          start: point,
          original: structuredClone(found),
          before: cloneAnnotations(annotationsRef.current),
        };
      }
      return;
    }

    if (tool === 'text') {
      const base = baseAnnotation('modifier', 'Écris ici ton message lié à cette zone.', point);
      addAnnotation({ ...base, type: 'text', x: point.x, y: point.y });
      setTool('select');
      return;
    }

    if (tool === 'polycut' || tool === 'eyedropper') {
      return;
    }
    const nextDraft: Draft = { tool, start: point, end: point, points: [point] };
    dragRef.current = { kind: 'create', draft: nextDraft };
    setDraft(nextDraft);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.kind === 'pan') {
      const nextPan = {
        x: drag.panX + (event.clientX - drag.clientX),
        y: drag.panY + (event.clientY - drag.clientY),
      };
      panRef.current = nextPan;
      setPan(nextPan);
      return;
    }

    const point = canvasPoint(event);

    if (drag.kind === 'move') {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      setAnnotations((items) =>
        items.map((annotation) => {
          if (annotation.id === drag.id) return moveAnnotationAndRefreshColor(drag.original, dx, dy);
          if (drag.original.type === 'frame' && annotation.groupId === drag.original.id) {
            const originalChild = drag.before.find((item) => item.id === annotation.id);
            return originalChild ? moveAnnotationAndRefreshColor(originalChild, dx, dy) : annotation;
          }
          return annotation;
        }),
      );
      return;
    }

    drag.draft.end = point;
    if (drag.draft.tool === 'draw') drag.draft.points = [...drag.draft.points, point];
    setDraft({ ...drag.draft, points: [...drag.draft.points] });
  }

  function handlePointerMoveEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDraft(null);

    if (drag.kind === 'pan') {
      setIsPanning(false);
      return;
    }

    if (drag.kind === 'move') {
      setPast((items) => [...items, drag.before].slice(-50));
      setFuture([]);
      return;
    }

    const value = drag.draft;
    const bounds = normalizeRect(value.start, value.end);
    if (value.tool !== 'draw' && (bounds.w < 5 || bounds.h < 5)) return;

    if (value.tool === 'frame') {
      const base = baseAnnotation(
        'modifier',
        'Tous les éléments placés dans ce cadre font partie de la même correction.',
      );
      addAnnotation({ ...base, type: 'frame', ...bounds, groupId: undefined });
    }

    if (value.tool === 'shape') {
      const base = baseAnnotation(
        'ajouter',
        'Ajouter cette forme dans le cadre associé.',
        value.start,
      );
      addAnnotation({
        ...base,
        type: 'shape',
        shape: 'ellipse',
        fillColor: activeLayer?.color || '#ff5c49',
        ...bounds,
      });
    }

    if (value.tool === 'delete') {
      const base = baseAnnotation(
        'supprimer',
        'Supprimer tous les éléments présents dans cette zone.',
        value.start,
      );
      addAnnotation({ ...base, type: 'delete', ...bounds, color: '#ff453a' });
    }

    if (value.tool === 'rect') {
      const base = baseAnnotation('modifier', 'Décris précisément ce qui doit changer dans cette zone.', value.start);
      addAnnotation({ ...base, type: 'rect', ...bounds });
    }

    if (value.tool === 'arrow') {
      const base = baseAnnotation('modifier', 'Décris la correction indiquée par cette flèche.', value.start);
      addAnnotation({
        ...base,
        type: 'arrow',
        x1: value.start.x,
        y1: value.start.y,
        x2: value.end.x,
        y2: value.end.y,
      });
    }

    if (value.tool === 'draw' && value.points.length > 1) {
      const base = baseAnnotation('modifier', 'Décris la correction dessinée sur la capture.', value.points[0]);
      addAnnotation({ ...base, type: 'draw', points: value.points });
    }

    if (value.tool === 'cut' && imageRef.current) {
      const source = {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        w: Math.max(1, Math.min(Math.round(bounds.w), imageSize.width - Math.round(bounds.x))),
        h: Math.max(1, Math.min(Math.round(bounds.h), imageSize.height - Math.round(bounds.y))),
      };
      const cutCanvas = document.createElement('canvas');
      cutCanvas.width = source.w;
      cutCanvas.height = source.h;
      cutCanvas
        .getContext('2d')
        ?.drawImage(
          imageRef.current,
          source.x,
          source.y,
          source.w,
          source.h,
          0,
          0,
          source.w,
          source.h,
        );
      const base = baseAnnotation('deplacer', 'Déplacer cet élément vers la nouvelle position indiquée.', value.start);
      const annotation: CutAnnotation = {
        ...base,
        type: 'cut',
        sourceX: source.x,
        sourceY: source.y,
        x: source.x,
        y: source.y,
        w: source.w,
        h: source.h,
        imageData: cutCanvas.toDataURL('image/png'),
      };
      addAnnotation(annotation);
      setTool('select');
    }
  }

  function showImportNotice(message: string) {
    setImportNotice(message);
    if (importNoticeTimer.current) window.clearTimeout(importNoticeTimer.current);
    importNoticeTimer.current = window.setTimeout(() => setImportNotice(''), 2600);
  }

  function loadVideoFile(file?: File, project?: VideoProjectData, fromCyTask = false) {
    if (!file) return false;
    if (cyTaskBridgeRef.current && !fromCyTask) {
      showImportNotice('Le média lié à CyTask ne peut pas être remplacé dans cette session');
      return false;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    const supportedExtension = ['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(extension || '');
    if (!file.type.startsWith('video/') && !supportedExtension) return false;

    const videoProject: VideoProjectData = project
      ? structuredClone(project)
      : {
          version: 1,
          kind: 'video',
          title: file.name.replace(/\.[^.]+$/, '') || 'Corrections vidéo',
          videoName: file.name,
          videoType: file.type || 'video/mp4',
          duration: 0,
          sourcePath: 'media/original-' + safeFileName(file.name),
          generalInstructions: '',
          annotations: [],
          frameStops: [],
        };
    const id = createId();
    const nextTab: VideoBoardTab = {
      id,
      label: videoProject.title || file.name,
      kind: 'video',
      file,
      project: videoProject,
    };
    const replaceBlank =
      tabs.length === 1 &&
      activeTab?.kind === 'image' &&
      !imageSource &&
      !activeTab.project.image;

    setTabs((items) => (replaceBlank ? [nextTab] : [...saveActiveTab(items), nextTab]));
    setActiveTabId(id);
    setSelectedId(null);
    setTool('select');
    showImportNotice(replaceBlank ? 'Vidéo ouverte dans le premier onglet' : 'Vidéo ouverte dans un nouvel onglet');
    return true;
  }

  function updateVideoTab(tabId: string, project: VideoProjectData) {
    setTabs((items) =>
      items.map((tab) =>
        tab.id === tabId && tab.kind === 'video'
          ? { ...tab, label: project.title || project.videoName, project: structuredClone(project) }
          : tab,
      ),
    );
  }

  async function openVideoFrameAsImage(file: File, time: number, videoTitle: string) {
    const dataUrl = await readAsDataUrl(file);
    const project = createBlankProject();
    project.title = file.name.replace(/\.[^.]+$/, '') || 'Capture vidéo';
    project.globalInstructions =
      'Capture extraite de la vidéo « ' + videoTitle + ' » au timecode ' +
      formatVideoTime(time) + '.';
    project.image = { src: dataUrl, name: file.name };
    createTab(project, file.name);
    showImportNotice('Capture vidéo ouverte dans un onglet image');
  }

  async function loadImageFile(file?: File, source: 'file' | 'clipboard' = 'file') {
    if (cyTaskBridgeRef.current) {
      showImportNotice('Le média lié à CyTask ne peut pas être remplacé dans cette session');
      return false;
    }
    if (!file || !file.type.startsWith('image/')) return false;
    const dataUrl = await readAsDataUrl(file);
    const nextImageName =
      file.name ||
      (source === 'clipboard'
        ? 'capture-collee-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png'
        : 'capture-importee.png');
    const project = createBlankProject();
    project.title = nextImageName.replace(/\.[^.]+$/, '') || 'Corrections interface';
    project.image = { src: dataUrl, name: nextImageName };

    const openedInNewTab = activeTab?.kind === 'video' || Boolean(imageSource);
    if (openedInNewTab) {
      createTab(project, nextImageName);
    } else {
      applyProject(project);
    }

    showImportNotice(
      source === 'clipboard'
        ? openedInNewTab
          ? 'Image collée dans un nouvel onglet'
          : 'Image collée depuis le presse-papiers'
        : openedInNewTab
          ? 'Image ouverte dans un nouvel onglet'
          : 'Image importée par glisser-déposer',
    );
    return true;
  }

  async function pasteImageFromClipboard() {
    try {
      if (!navigator.clipboard || !('read' in navigator.clipboard)) {
        showImportNotice('Utilise Ctrl+V pour coller l’image');
        return;
      }
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const extension = imageType === 'image/jpeg' ? 'jpg' : imageType.split('/')[1] || 'png';
        const file = new File(
          [blob],
          'capture-collee-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + extension,
          { type: imageType },
        );
        await loadImageFile(file, 'clipboard');
        return;
      }
      showImportNotice('Le presse-papiers ne contient pas d’image');
    } catch {
      showImportNotice('Autorise le presse-papiers ou utilise Ctrl+V');
    }
  }

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const imageFiles = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (!imageFiles.length) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const pasteAsReference = Boolean(target?.closest('[data-reference-paste="true"]'));
      event.preventDefault();
      if (pasteAsReference && selectedId) {
        addReferences(imageFiles, selectedId).catch(() =>
          showImportNotice('Impossible de coller cette référence'),
        );
        return;
      }

      loadImageFile(imageFiles[0], 'clipboard').catch(() =>
        showImportNotice('Impossible de coller cette image'),
      );
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [imageSource, selectedId]);

  function hasDraggedMedia(dataTransfer: DataTransfer) {
    return (
      Array.from(dataTransfer.items).some(
        (item) =>
          item.kind === 'file' &&
          (!item.type || item.type.startsWith('image/') || item.type.startsWith('video/')),
      ) ||
      Array.from(dataTransfer.files).some(
        (file) => file.type.startsWith('image/') || file.type.startsWith('video/'),
      )
    );
  }

  function handleImageDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedMedia(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDraggingImage(true);
  }

  function handleImageDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setIsDraggingImage(false);
  }

  function handleImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingImage(false);
    const files = Array.from(event.dataTransfer.files);
    const videoFile = files.find((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      return (
        file.type.startsWith('video/') ||
        ['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(extension || '')
      );
    });
    if (videoFile) {
      loadVideoFile(videoFile);
      return;
    }
    const imageFile = files.find((file) => file.type.startsWith('image/'));
    if (!imageFile) {
      showImportNotice('Dépose une image PNG, JPG, WebP ou une vidéo MP4/WebM');
      return;
    }
    loadImageFile(imageFile).catch(() => showImportNotice('Impossible d’importer cette image'));
  }

  function addLayer() {
    const palette = ['#5ec8ff', '#a986ff', '#65d195', '#f47ec1', '#f2d05e'];
    const id = createId();
    const layer: Layer = {
      id,
      name: 'Calque ' + (layers.length + 1),
      color: palette[layers.length % palette.length],
      visible: true,
    };
    setLayers((items) => [...items, layer]);
    setActiveLayerId(id);
  }

  function renameLayer(layer: Layer) {
    const name = window.prompt('Nom du calque', layer.name)?.trim();
    if (name) setLayers((items) => items.map((item) => (item.id === layer.id ? { ...item, name } : item)));
  }

  function toggleLayer(layerId: string) {
    setLayers((items) =>
      items.map((layer) => (layer.id === layerId ? { ...layer, visible: !layer.visible } : layer)),
    );
  }

  async function addReferences(
    files: FileList | File[] | null,
    annotationId: string | null = selectedId,
  ) {
    if (!annotationId || !files?.length) return;
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!imageFiles.length) {
      showImportNotice('Ajoute uniquement des images PNG, JPG ou WebP');
      return;
    }
    const newReferences = await Promise.all(
      imageFiles.map(async (file) => ({
        id: createId(),
        name: file.name || 'reference-collee.png',
        dataUrl: await readAsDataUrl(file),
      })),
    );
    const annotation = annotationsRef.current.find((item) => item.id === annotationId);
    if (!annotation) return;
    updateAnnotation(annotationId, {
      references: [...annotation.references, ...newReferences],
    });
    showImportNotice(
      newReferences.length + ' image' + (newReferences.length > 1 ? 's' : '') + ' ajoutée' +
        (newReferences.length > 1 ? 's' : '') + ' en référence',
    );
  }

  function hasDraggedImage(dataTransfer: DataTransfer) {
    return (
      Array.from(dataTransfer.items).some(
        (item) => item.kind === 'file' && (!item.type || item.type.startsWith('image/')),
      ) || Array.from(dataTransfer.files).some((file) => file.type.startsWith('image/'))
    );
  }

  function handleReferenceDragOver(event: DragEvent<HTMLElement>) {
    event.stopPropagation();
    if (!hasDraggedImage(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDraggingReference(true);
  }

  function handleReferenceDragLeave(event: DragEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setIsDraggingReference(false);
  }

  function handleReferenceDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingReference(false);
    const targetId = selectedId;
    if (!targetId) return;
    addReferences(Array.from(event.dataTransfer.files), targetId).catch(() =>
      showImportNotice('Impossible d’ajouter cette référence'),
    );
  }

  function removeReference(referenceId: string) {
    if (!selected) return;
    updateAnnotation(selected.id, {
      references: selected.references.filter((reference) => reference.id !== referenceId),
    });
  }

  async function saveProjectFile() {
    if (cyTaskBridgeRef.current) {
      sendCyTaskDocument(projectData());
      return;
    }
    await downloadPackage(false);
  }

  async function openProjectFile(file?: File) {
    if (cyTaskBridgeRef.current) {
      showImportNotice('Cette fenêtre est liée à un média CyTask');
      return;
    }
    if (!file) return;
    try {
      let project: ProjectFile;
      if (file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip')) {
        const archive = await JSZip.loadAsync(file);
        const workspaceEntry =
          archive.file('workspace.cyannota.json') ||
          Object.values(archive.files).find(
            (entry) => !entry.dir && entry.name.toLowerCase().endsWith('/workspace.cyannota.json'),
          );

        if (workspaceEntry) {
          type StoredTab =
            | { id: string; label: string; kind?: 'image'; project: ProjectFile }
            | { id: string; label: string; kind: 'video'; project: VideoProjectData; sourcePath?: string };
          const workspace = JSON.parse(await workspaceEntry.async('string')) as {
            workspaceVersion: number;
            activeTabId: string;
            tabs: StoredTab[];
          };
          if (![1, 2].includes(workspace.workspaceVersion) || !Array.isArray(workspace.tabs)) {
            throw new Error('Espace de travail invalide');
          }

          const restoredTabs: BoardTab[] = [];
          for (const storedTab of workspace.tabs) {
            if (storedTab.kind === 'video') {
              const videoProject = storedTab.project;
              if (
                videoProject?.version !== 1 ||
                videoProject.kind !== 'video' ||
                !Array.isArray(videoProject.annotations) ||
                !videoProject.sourcePath
              ) {
                throw new Error('Onglet vidéo invalide');
              }
              const sourceEntry =
                archive.file(storedTab.sourcePath || '') ||
                archive.file(videoProject.sourcePath) ||
                Object.values(archive.files).find(
                  (entry) => !entry.dir && entry.name.endsWith('/' + videoProject.sourcePath),
                );
              if (!sourceEntry) throw new Error('Vidéo source absente de l’onglet « ' + storedTab.label + ' »');
              const sourceBlob = await sourceEntry.async('blob');
              restoredTabs.push({
                id: storedTab.id,
                label: storedTab.label,
                kind: 'video',
                file: new File([sourceBlob], videoProject.videoName || 'video.mp4', {
                  type: videoProject.videoType || sourceBlob.type || 'video/mp4',
                  lastModified: Date.now(),
                }),
                project: structuredClone(videoProject),
              });
              continue;
            }

            const imageProject = storedTab.project;
            if (
              imageProject?.version !== 1 ||
              !Array.isArray(imageProject.layers) ||
              !Array.isArray(imageProject.annotations)
            ) {
              throw new Error('Onglet image invalide');
            }
            restoredTabs.push({
              id: storedTab.id,
              label: storedTab.label,
              kind: 'image',
              project: structuredClone(imageProject),
            });
          }

          if (!restoredTabs.length) throw new Error('Espace de travail vide');
          const nextActive =
            restoredTabs.find((tab) => tab.id === workspace.activeTabId) || restoredTabs[0];
          setTabs(restoredTabs);
          setActiveTabId(nextActive.id);
          if (nextActive.kind === 'image') applyProject(structuredClone(nextActive.project));
          showImportNotice(restoredTabs.length + ' onglet(s) image/vidéo restauré(s) depuis le ZIP');
          return;
        }

        const videoProjectEntry =
          archive.file('video-project.cyannota.json') ||
          Object.values(archive.files).find(
            (entry) =>
              !entry.dir && entry.name.toLowerCase().endsWith('/video-project.cyannota.json'),
          );

        if (videoProjectEntry) {
          const videoProject = JSON.parse(await videoProjectEntry.async('string')) as VideoProjectData;
          if (
            videoProject.version !== 1 ||
            videoProject.kind !== 'video' ||
            !Array.isArray(videoProject.annotations) ||
            !videoProject.sourcePath
          ) {
            throw new Error('Projet vidéo CyAnnota invalide');
          }
          const sourceEntry =
            archive.file(videoProject.sourcePath) ||
            Object.values(archive.files).find(
              (entry) => !entry.dir && entry.name.endsWith('/' + videoProject.sourcePath),
            );
          if (!sourceEntry) throw new Error('Vidéo source absente du projet');
          const sourceBlob = await sourceEntry.async('blob');
          const restoredFile = new File([sourceBlob], videoProject.videoName || 'video.mp4', {
            type: videoProject.videoType || sourceBlob.type || 'video/mp4',
            lastModified: Date.now(),
          });
          loadVideoFile(restoredFile, videoProject);
          return;
        }

        const projectEntry =
          archive.file('project.annota.json') ||
          Object.values(archive.files).find(
            (entry) => !entry.dir && entry.name.toLowerCase().endsWith('/project.annota.json'),
          );
        if (!projectEntry) throw new Error('Projet CyAnnota absent du ZIP');
        project = JSON.parse(await projectEntry.async('string')) as ProjectFile;
      } else {
        project = JSON.parse(await file.text()) as ProjectFile;
      }

      if (
        project.version !== 1 ||
        !Array.isArray(project.layers) ||
        !Array.isArray(project.annotations)
      ) {
        throw new Error('Format invalide');
      }

      const label = project.image?.name || project.title || file.name;
      if (activeTab?.kind === 'video' || imageSource) createTab(project, label);
      else applyProject(project);
      showImportNotice(
        file.name.toLowerCase().endsWith('.zip')
          ? 'ZIP CyAnnota ouvert dans un onglet'
          : 'Projet CyAnnota ouvert',
      );
    } catch {
      window.alert('Ce fichier ne contient pas de projet CyAnnota modifiable.');
    }
  }

  async function resumeDraft() {
    const project = await readDraft();
    if (!project) return;
    if (activeTab?.kind === 'video' || imageSource) createTab(project, project.image?.name || project.title);
    else applyProject(project);
  }

  function locationText(annotation: Annotation) {
    if (annotation.type === 'arrow') {
      return 'de (' + Math.round(annotation.x1) + ', ' + Math.round(annotation.y1) + ') vers (' + Math.round(annotation.x2) + ', ' + Math.round(annotation.y2) + ')';
    }
    if (annotation.type === 'text') {
      return 'au point (' + Math.round(annotation.x) + ', ' + Math.round(annotation.y) + ')';
    }
    if (annotation.type === 'draw') {
      const bounds = annotationBounds(annotation);
      return 'zone x=' + Math.round(bounds.x) + ', y=' + Math.round(bounds.y) + ', largeur=' + Math.round(bounds.w) + ', hauteur=' + Math.round(bounds.h);
    }
    if (annotation.type === 'cut') {
      const dx = Math.round(annotation.x - annotation.sourceX);
      const dy = Math.round(annotation.y - annotation.sourceY);
      return 'source x=' + Math.round(annotation.sourceX) + ', y=' + Math.round(annotation.sourceY) + ', ' + Math.round(annotation.w) + '×' + Math.round(annotation.h) + ' px ; destination x=' + Math.round(annotation.x) + ', y=' + Math.round(annotation.y) + ' ; déplacement Δx=' + dx + ', Δy=' + dy;
    }
    const bounds = annotationBounds(annotation);
    return 'x=' + Math.round(bounds.x) + ', y=' + Math.round(bounds.y) + ', largeur=' + Math.round(bounds.w) + ', hauteur=' + Math.round(bounds.h);
  }

  function buildPrompt(project: ProjectFile = projectData()) {
    const sourceAnnotations = project.annotations;
    const sourceLayers = project.layers;
    const sourceImageName = project.image?.name || 'image.png';
    const lines = [
      '# Brief de corrections — ' + project.title,
      '',
      'Modifie l’interface à partir de « images/original-' + safeFileName(sourceImageName) + ' » en suivant « images/annotated.png » et les corrections numérotées ci-dessous.',
      '',
      '## Intention générale',
      '',
      project.globalInstructions.trim() || 'Aucune instruction générale supplémentaire.',
      '',
      '## Règles',
      '',
      '- Respecter l’ordre et la numérotation des annotations.',
      '- Les éléments liés au même cadre constituent une seule correction structurée.',
      '- Les zones rouges marquées SUPPRIMER doivent être retirées sans instruction supplémentaire.',
      '- Pour une annotation de couleur, remplacer la couleur prélevée par la couleur souhaitée.',
      '- Conserver tous les éléments qui ne sont pas explicitement concernés.',
      '- Utiliser les images de référence uniquement pour la correction à laquelle elles sont jointes.',
      '',
      '## Corrections',
      '',
    ];

    sourceAnnotations.forEach((annotation, index) => {
      const layer = sourceLayers.find((item) => item.id === annotation.layerId);
      const groupIndex = annotation.groupId
        ? sourceAnnotations.findIndex((item) => item.id === annotation.groupId)
        : -1;
      lines.push('### ' + String(index + 1).padStart(2, '0') + ' — ' + CATEGORY_LABELS[annotation.category]);
      lines.push('');
      lines.push('- Type : ' + TYPE_LABELS[annotation.type]);
      lines.push('- Calque : ' + (layer?.name || 'Sans calque'));
      if (groupIndex >= 0) {
        lines.push('- Appartient au cadre : ' + String(groupIndex + 1).padStart(2, '0'));
      }
      lines.push('- Position : ' + locationText(annotation));
      lines.push('- Instruction : ' + (annotation.description.trim() || 'Instruction à préciser.'));

      if (annotation.type === 'frame') {
        const children = sourceAnnotations
          .map((item, childIndex) => ({ item, childIndex }))
          .filter(({ item }) => item.groupId === annotation.id)
          .map(({ childIndex }) => String(childIndex + 1).padStart(2, '0'));
        lines.push('- Éléments du cadre : ' + (children.join(', ') || 'aucun'));
      }
      if (annotation.type === 'shape') {
        lines.push('- Forme : ' + annotation.shape + ' ; remplissage : ' + annotation.fillColor);
      }
      if (annotation.type === 'delete') {
        lines.push('- Action automatique : supprimer tout le contenu de cette zone.');
      }
      if (annotation.type === 'color') {
        lines.push(
          '- Couleur : ' +
            annotation.sampledColor.toUpperCase() +
            ' → ' +
            annotation.replacementColor.toUpperCase(),
        );
      }
      if (annotation.references.length) {
        lines.push(
          '- Références : ' +
            annotation.references
              .map((reference) => '« references/' + String(index + 1).padStart(2, '0') + '-' + safeFileName(reference.name) + ' »')
              .join(', '),
        );
      }
      if (annotation.type === 'cut') {
        lines.push(
          '- Découpe : « decoupes/' +
            String(index + 1).padStart(2, '0') +
            '-element.png »' +
            (annotation.polygon?.length ? ' ; contour polygonal.' : '.'),
        );
      }
      lines.push('');
    });

    if (!sourceAnnotations.length) lines.push('Aucune correction annotée.');
    lines.push(
      '## Critère de fin',
      '',
      'Le résultat final doit intégrer toutes les corrections visibles sans modifier le reste de l’interface.',
    );
    return lines.join('\n');
  }

  function openExport() {
    setExportPrompt(
      activeTab?.kind === 'video'
        ? buildVideoPrompt(activeTab.project)
        : buildPrompt(),
    );
    setExportOpen(true);
  }

  function loadImageElement(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image illisible'));
      image.src = source;
    });
  }

  async function loadProjectCutImages(project: ProjectFile) {
    const cache = new Map<string, HTMLImageElement>();
    await Promise.all(
      project.annotations
        .filter((annotation): annotation is CutAnnotation => annotation.type === 'cut')
        .map(async (annotation) => {
          try {
            cache.set(annotation.id, await loadImageElement(annotation.imageData));
          } catch {
            return;
          }
        }),
    );
    return cache;
  }

  async function renderProjectCanvas(
    project: ProjectFile,
    layerIds = new Set(project.layers.filter((layer) => layer.visible).map((layer) => layer.id)),
  ) {
    if (!project.image) throw new Error('Projet sans image');
    const original = await loadImageElement(project.image.src);
    const cutImages = await loadProjectCutImages(project);
    const output = document.createElement('canvas');
    output.width = original.naturalWidth;
    output.height = original.naturalHeight;
    const context = output.getContext('2d');
    if (!context) throw new Error('Canevas indisponible');
    context.drawImage(original, 0, 0, output.width, output.height);
    project.annotations.forEach((annotation, index) => {
      if (layerIds.has(annotation.layerId)) {
        drawAnnotation(
          context,
          annotation,
          index,
          false,
          output.width,
          cutImages,
          null,
          project.annotations,
        );
      }
    });
    return output;
  }

  function canvasBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Export impossible'))), 'image/png');
    });
  }

  async function downloadAnnotatedImage() {
    if (!imageSource) return;
    const canvas = await renderProjectCanvas(projectData());
    const saved = await downloadBlob(
      await canvasBlob(canvas),
      safeFileName(projectTitle) + '-annotated.png',
    );
    setSaveStatus(saved ? 'Image annotée enregistrée' : 'Enregistrement annulé');
  }

  async function addProjectToZip(
    zip: JSZip,
    project: ProjectFile,
    folderPath: string,
    prompt: string,
  ) {
    zip.file(folderPath + 'project.annota.json', JSON.stringify(project, null, 2));
    zip.file(folderPath + 'prompt.md', prompt);

    if (!project.image) return;
    zip.file(
      folderPath + 'images/original-' + safeFileName(project.image.name),
      dataUrlBytes(project.image.src, `L’image source « ${project.image.name} »`),
    );

    const annotatedCanvas = await renderProjectCanvas(project);
    zip.file(folderPath + 'images/annotated.png', await canvasBlob(annotatedCanvas));

    for (const layer of project.layers) {
      const layerCanvas = await renderProjectCanvas(project, new Set([layer.id]));
      zip.file(
        folderPath + 'images/calque-' + safeFileName(layer.name) + '.png',
        await canvasBlob(layerCanvas),
      );
    }

    project.annotations.forEach((annotation, index) => {
      const number = String(index + 1).padStart(2, '0');
      if (annotation.type === 'cut') {
        zip.file(
          folderPath + 'decoupes/' + number + '-element.png',
          dataUrlBytes(annotation.imageData, `La découpe ${number}`),
        );
      }
      annotation.references.forEach((reference) => {
        zip.file(
          folderPath + 'references/' + number + '-' + safeFileName(reference.name),
          dataUrlBytes(reference.dataUrl, `La référence « ${reference.name} »`),
        );
      });
    });
  }

  async function addVideoProjectToZip(
    zip: JSZip,
    tab: VideoBoardTab,
    folderPath: string,
    prompt: string,
  ) {
    zip.file(folderPath + 'video-project.cyannota.json', JSON.stringify(tab.project, null, 2));
    zip.file(folderPath + 'prompt.md', prompt);
    zip.file(folderPath + tab.project.sourcePath, tab.file, { compression: 'STORE' });
    tab.project.annotations.forEach((annotation, index) => {
      if (!annotation.snapshot) return;
      zip.file(
        folderPath + 'captures/' + String(index + 1).padStart(2, '0') + '-annotation.png',
        dataUrlBytes(annotation.snapshot, 'La capture vidéo ' + String(index + 1).padStart(2, '0')),
      );
    });
    const sortedStops = [...(tab.project.frameStops || [])].sort((a, b) => a.time - b.time);
    sortedStops.forEach((stop, index) => {
      zip.file(
        folderPath + 'frames/' + videoFrameStopFileName(stop, index),
        dataUrlBytes(stop.imageData, 'La frame vidéo ' + String(index + 1).padStart(2, '0')),
      );
    });
    if (sortedStops.length) {
      zip.file(
        folderPath + 'frames/manifest.json',
        JSON.stringify(
          sortedStops.map((stop, index) => ({
            frame: index + 1,
            sourceFrameIndex: stop.frameIndex ?? null,
            sourceFrameNumber: stop.frameIndex === undefined ? null : stop.frameIndex + 1,
            time: stop.time,
            file: videoFrameStopFileName(stop, index),
          })),
          null,
          2,
        ),
      );
    }
  }

  async function downloadPackage(useEditedExportPrompt = true) {
    const workspaceTabs = saveActiveTab(tabs);
    const exportableTabs = workspaceTabs.filter(
      (tab) => tab.kind === 'video' || Boolean(tab.project.image),
    );
    if (!exportableTabs.length) return false;
    const currentActive = workspaceTabs.find((tab) => tab.id === activeTabId);
    const packageTitle =
      currentActive?.kind === 'video' ? currentActive.project.title : projectTitle;
    const packageName = safeFileName(packageTitle || 'cyannota') + '.cyannota.zip';
    const exportFolder = (tab: BoardTab, index: number) =>
      'onglets/' +
      String(index + 1).padStart(2, '0') +
      '-' +
      safeFileName(tab.label) +
      '/';

    setIsExporting(true);
    try {
      const preparedSave = await prepareFileSave(packageName);
      if (!preparedSave) {
        setSaveStatus('Enregistrement annulé');
        return false;
      }

      const zip = new JSZip();
      const storedTabs = workspaceTabs.map((tab) => {
        if (tab.kind === 'image') {
          return { id: tab.id, label: tab.label, kind: 'image' as const, project: tab.project };
        }
        const exportIndex = exportableTabs.findIndex((item) => item.id === tab.id);
        const folder = exportFolder(tab, Math.max(0, exportIndex));
        return {
          id: tab.id,
          label: tab.label,
          kind: 'video' as const,
          project: tab.project,
          sourcePath: folder + tab.project.sourcePath,
        };
      });
      zip.file(
        'workspace.cyannota.json',
        JSON.stringify(
          {
            workspaceVersion: 2,
            activeTabId,
            tabs: storedTabs,
          },
          null,
          2,
        ),
      );
      zip.file(
        'LISEZ-MOI.txt',
        'Archive CyAnnota contenant ' +
          exportableTabs.length +
          ' onglet(s) image/vidéo. Ouvrez directement ce ZIP dans CyAnnota pour restaurer tout l’espace de travail.',
      );

      for (let index = 0; index < exportableTabs.length; index += 1) {
        const tab = exportableTabs[index];
        const folder = exportFolder(tab, index);
        const generatedPrompt =
          tab.kind === 'video' ? buildVideoPrompt(tab.project) : buildPrompt(tab.project);
        const prompt =
          useEditedExportPrompt && tab.id === activeTabId && exportPrompt
            ? exportPrompt
            : generatedPrompt;
        try {
          if (tab.kind === 'video') {
            await addVideoProjectToZip(zip, tab, folder, prompt);
          } else {
            await addProjectToZip(zip, tab.project, folder, prompt);
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error('Onglet « ' + tab.label + ' » : ' + detail);
        }
      }
      const archive = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      const saved = await savePreparedBlob(archive, preparedSave);
      setSaveStatus(
        saved
          ? useEditedExportPrompt
            ? 'Export ZIP enregistré'
            : 'Espace de travail enregistré'
          : 'Enregistrement annulé',
      );
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erreur inconnue';
      setSaveStatus('Échec de l’enregistrement ZIP');
      showImportNotice('Enregistrement impossible : ' + message);
      await showSaveFailure('Impossible d’enregistrer le fichier ZIP.', error);
      throw error;
    } finally {
      setIsExporting(false);
    }
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(exportPrompt);
  }

  function renderExportDialog() {
    if (!exportOpen) return null;
    const correctionCount = tabs.reduce(
      (count, tab) => count + tab.project.annotations.length,
      0,
    );
    const videoCount = tabs.filter((tab) => tab.kind === 'video').length;
    const frameStopCount = tabs.reduce(
      (count, tab) =>
        count +
        (tab.kind === 'video'
          ? (tab.project.frameStops || []).length
          : 0),
      0,
    );

    return (
      <div className="modal-backdrop" onMouseDown={() => setExportOpen(false)}>
        <section className="export-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header className="modal-header">
            <div>
              <p className="eyebrow">PAQUET DE CORRECTIONS COMPLET</p>
              <h2>Images et vidéos prêtes à envoyer</h2>
              <p>Le ZIP contient un dossier par onglet, les sources originales, les arrêts exportés en images, les annotations temporelles et tous les prompts.</p>
            </div>
            <button className="modal-close" aria-label="Fermer" onClick={() => setExportOpen(false)}>×</button>
          </header>

          <div className="export-stats">
            <div><strong>{tabs.length}</strong><span>onglets</span></div>
            <div><strong>{correctionCount}</strong><span>corrections</span></div>
            <div><strong>{videoCount}</strong><span>vidéos</span></div>
            <div><strong>{frameStopCount}</strong><span>arrêts image</span></div>
          </div>

          <label className="prompt-editor">
            <span>Prompt de l’onglet actif — tu peux encore le modifier</span>
            <textarea value={exportPrompt} onChange={(event) => setExportPrompt(event.target.value)} />
          </label>

          <footer className="modal-actions">
            <button className="button ghost" onClick={() => copyPrompt().catch(() => undefined)}>Copier le prompt</button>
            {activeTab?.kind === 'image' && activeTab.project.image && (
              <button className="button ghost" onClick={() => downloadAnnotatedImage().catch(() => undefined)}>Image annotée</button>
            )}
            <button
              className="button primary large"
              onClick={() => downloadPackage(true).catch(() => undefined)}
              disabled={isExporting}
            >
              {isExporting ? 'Création du ZIP…' : 'Enregistrer le ZIP complet'}
            </button>
          </footer>
        </section>
      </div>
    );
  }

  const toolIcons: Record<Tool, string> = {
    select: '↖',
    pan: '✥',
    frame: '▣',
    shape: '○',
    rect: '□',
    arrow: '↗',
    text: 'T',
    draw: '✎',
    cut: '✂',
    polycut: '△',
    delete: '⌫',
    eyedropper: '◉',
  };

  function renderMediaTabs() {
    return (
      <div className="board-tabs" role="tablist" aria-label="Médias ouverts">
        <div className="board-tabs-scroll">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={
                'board-tab ' +
                (tab.kind === 'video' ? 'media-video ' : 'media-image ') +
                (tab.id === activeTabId ? 'active' : '')
              }
              role="presentation"
            >
              <button
                className="board-tab-main"
                role="tab"
                aria-selected={tab.id === activeTabId}
                onClick={() => activateTab(tab.id)}
                title={tab.label}
              >
                <span className="board-tab-index">
                  {tab.kind === 'video' ? 'VID' : String(index + 1).padStart(2, '0')}
                </span>
                <span className="board-tab-label">{tab.label}</span>
              </button>
              <button
                className="board-tab-close"
                aria-label={'Fermer ' + tab.label}
                onClick={() => closeTab(tab.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {!cyTaskBridge && (
          <button
            className="new-board-tab"
            aria-label="Nouvel onglet d’image"
            title="Nouvel onglet d’image"
            onClick={() => createTab()}
          >
            +
          </button>
        )}
      </div>
    );
  }

  if (activeTab?.kind === 'video') {
    return (
      <>
        <VideoAnnotator
          key={activeTab.id}
          file={activeTab.file}
          initialProject={activeTab.project}
          onSaveBlob={downloadBlob}
          onProjectChange={(project) => updateVideoTab(activeTab.id, project)}
          onCaptureFrame={(captureFile, time) =>
            openVideoFrameAsImage(captureFile, time, activeTab.project.title)
          }
          tabBar={renderMediaTabs()}
          onOpenWorkspace={cyTaskBridge ? undefined : () => projectInputRef.current?.click()}
          onAddImage={cyTaskBridge ? undefined : () => imageInputRef.current?.click()}
          onAddVideo={cyTaskBridge ? undefined : () => videoInputRef.current?.click()}
          onSaveWorkspace={() => {
            if (cyTaskBridge) sendCyTaskDocument(activeTab.project);
            else saveProjectFile().catch(() => undefined);
          }}
          onExportWorkspace={openExport}
        />
        <input
          ref={projectInputRef}
          hidden
          type="file"
          accept=".json,.annota.json,.zip,application/json,application/zip"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            openProjectFile(event.target.files?.[0]).catch(() => undefined);
            event.target.value = '';
          }}
        />
        <input
          ref={videoInputRef}
          hidden
          type="file"
          accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogg,.mov,.m4v"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            loadVideoFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <input
          ref={imageInputRef}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            loadImageFile(event.target.files?.[0]).catch(() => undefined);
            event.target.value = '';
          }}
        />
        {renderExportDialog()}
      </>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Cy</span>
          <div>
            <strong>CyAnnota</strong>
            <span>Corrections d’interface</span>
          </div>
        </div>

        <label className="project-title">
          <span className="status-dot" />
          <input
            aria-label="Nom du projet"
            value={projectTitle}
            onChange={(event) => setProjectTitle(event.target.value)}
          />
        </label>

        <div className="top-actions">
          {hasLocalDraft && !imageSource && (
            <button className="button ghost compact" onClick={() => resumeDraft().catch(() => undefined)}>
              Reprendre
            </button>
          )}
          {cyTaskBridge && (
            <span className="cytask-bridge-badge">
              {cyTaskBridge.readOnly ? 'CyTask · consultation' : 'CyTask · lié'}
            </span>
          )}
          {!cyTaskBridge && (
            <>
              <button className="button ghost compact" onClick={() => projectInputRef.current?.click()}>
                Ouvrir
              </button>
              <button className="button ghost compact" onClick={() => videoInputRef.current?.click()}>
                Vidéo
              </button>
            </>
          )}
          <button
            className="button ghost compact"
            onClick={() => saveProjectFile().catch(() => undefined)}
            disabled={!hasExportableMedia || isExporting}
          >
            {cyTaskBridge ? 'Sauver dans CyTask' : 'Sauver'}
          </button>
          <button className="button primary" onClick={openExport} disabled={!hasExportableMedia}>
            Exporter
          </button>
        </div>

        <input
          ref={projectInputRef}
          hidden
          type="file"
          accept=".json,.annota.json,.zip,application/json,application/zip"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            openProjectFile(event.target.files?.[0]).catch(() => undefined);
            event.target.value = '';
          }}
        />
        <input
          ref={videoInputRef}
          hidden
          type="file"
          accept="video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.ogg,.mov,.m4v"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            loadVideoFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </header>

      <section className="workspace">
        <aside className="toolrail" aria-label="Outils d’annotation">
          {(Object.keys(toolIcons) as Tool[]).map((item) => (
            <button
              key={item}
              className={'tool ' + (tool === item ? 'active' : '')}
              data-label={TOOL_LABELS[item]}
              aria-label={TOOL_LABELS[item]}
              onClick={() => {
                setTool(item);
                if (item !== 'polycut') setPolygonPoints([]);
              }}
              disabled={!imageSource}
            >
              {toolIcons[item]}
            </button>
          ))}
          <span className="tool-divider" />
          <button
            className="tool"
            data-label="Annuler"
            aria-label="Annuler"
            onClick={undo}
            disabled={!past.length}
          >
            ↶
          </button>
          <button
            className="tool"
            data-label="Rétablir"
            aria-label="Rétablir"
            onClick={redo}
            disabled={!future.length}
          >
            ↷
          </button>
          <span className="tool-spacer" />
          <button
            className="tool danger"
            data-label="Supprimer la sélection"
            aria-label="Supprimer la sélection"
            onClick={deleteSelected}
            disabled={!selected}
          >
            ×
          </button>
        </aside>

        <section className="stage-wrap">
          {renderMediaTabs()}

          <div className="stage-toolbar">
            <div className="tool-context">
              <span className="mini-tool">{toolIcons[tool]}</span>
              <div>
                <strong>{TOOL_LABELS[tool]}</strong>
                <span>{TOOL_HELP[tool]}</span>
              </div>
            </div>
            <div className="zoom-controls">
              <button className="paste-shortcut" onClick={() => pasteImageFromClipboard().catch(() => undefined)}>
                Coller <kbd>Ctrl+V</kbd>
              </button>
              <i className="zoom-divider" />
              <button aria-label="Réduire le zoom" onClick={() => changeZoom(zoomRef.current - 0.1)}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button aria-label="Augmenter le zoom" onClick={() => changeZoom(zoomRef.current + 0.1)}>+</button>
            </div>
          </div>

          <div
            ref={stageRef}
            className={
              'stage ' +
              (imageSource ? 'has-image ' : '') +
              (isDraggingImage ? 'is-dragging' : '')
            }
            onDragEnter={handleImageDragOver}
            onDragOver={handleImageDragOver}
            onDragLeave={handleImageDragLeave}
            onDrop={handleImageDrop}
          >
            {imageSource ? (
              <div className="canvas-scroll-space">
                <div
                  className="canvas-wrap"
                  style={{
                    width: imageSize.width,
                    height: imageSize.height,
                    transform: 'translate3d(' + pan.x + 'px, ' + pan.y + 'px, 0) scale(' + zoom + ')',
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    width={imageSize.width}
                    height={imageSize.height}
                    className={
                      'annotation-canvas cursor-' +
                      (isPanning ? 'panning' : isSpaceHeld ? 'pan' : tool)
                    }
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerMoveEnd}
                    onPointerCancel={handlePointerMoveEnd}
                    onContextMenu={(event) => event.preventDefault()}
                  />
                </div>
              </div>
            ) : (
              <div className="drop-card">
                <div className="drop-icon">⌁</div>
                <p className="eyebrow">NOUVELLE PLANCHE</p>
                <h1>Dépose une image ou une vidéo</h1>
                <p>PNG, JPG, WebP, MP4 ou WebM — tous les fichiers restent sur cet ordinateur.</p>
                <div className="import-actions">
                  <button className="button primary large" onClick={() => imageInputRef.current?.click()}>
                    Choisir une image
                  </button>
                  <button className="button ghost large" onClick={() => videoInputRef.current?.click()}>
                    Choisir une vidéo
                  </button>
                  <button className="button ghost large" onClick={() => pasteImageFromClipboard().catch(() => undefined)}>
                    Coller l’image
                  </button>
                </div>
                <span>ou glisse-dépose un fichier · Ctrl+V fonctionne pour les images</span>
                {hasLocalDraft && (
                  <button className="text-button" onClick={() => resumeDraft().catch(() => undefined)}>
                    Reprendre le dernier projet
                  </button>
                )}
              </div>
            )}
            {isDraggingImage && (
              <div className="stage-drop-overlay" aria-live="polite">
                <span>↓</span>
                <strong>Dépose le fichier ici</strong>
                <small>Image ou vidéo, il restera traité localement</small>
              </div>
            )}
            {importNotice && <div className="import-notice" role="status">{importNotice}</div>}
            <input
              ref={imageInputRef}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                loadImageFile(event.target.files?.[0]).catch(() => undefined);
                event.target.value = '';
              }}
            />
          </div>

          <footer className="stage-footer">
            <span>{annotations.length} correction{annotations.length === 1 ? '' : 's'}</span>
            <span>{imageSize.width ? imageSize.width + ' × ' + imageSize.height + ' px · Molette : zoom · clic droit : déplacer' : 'Aucune image'}</span>
            <span>{saveStatus}</span>
          </footer>
        </section>

        <aside className="inspector">
          <section className="panel-section layers-section">
            <div className="inspector-heading">
              <div>
                <p className="eyebrow">ORGANISATION</p>
                <h2>Calques</h2>
              </div>
              <button className="icon-button" title="Ajouter un calque" onClick={addLayer}>+</button>
            </div>

            <div className="layers-list">
              {layers.map((layer) => (
                <div
                  key={layer.id}
                  className={'layer-row ' + (activeLayerId === layer.id ? 'active' : '')}
                  onClick={() => setActiveLayerId(layer.id)}
                >
                  <input
                    type="color"
                    className="layer-color-input"
                    aria-label={'Couleur du calque ' + layer.name}
                    value={layer.color}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const color = event.target.value;
                      setLayers((items) => items.map((item) => (item.id === layer.id ? { ...item, color } : item)));
                      setAnnotations((items) => items.map((annotation) => (annotation.layerId === layer.id ? { ...annotation, color } : annotation)));
                    }}
                  />
                  <button className="layer-name" onDoubleClick={() => renameLayer(layer)}>
                    <strong>{layer.name}</strong>
                    <span>{annotations.filter((annotation) => annotation.layerId === layer.id).length} élément(s)</span>
                  </button>
                  <button
                    className={'visibility ' + (layer.visible ? 'visible' : '')}
                    title={layer.visible ? 'Masquer ce calque' : 'Afficher ce calque'}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleLayer(layer.id);
                    }}
                  >
                    {layer.visible ? '◉' : '○'}
                  </button>
                </div>
              ))}
            </div>
            <p className="micro-hint">Double-clique le nom d’un calque pour le renommer.</p>
          </section>

          <section className="general-message">
            <label htmlFor="global-message">
              <span>MESSAGE DE LA CAPTURE</span>
              <small>Contexte général ajouté au prompt</small>
            </label>
            <textarea
              id="global-message"
              value={globalInstructions}
              onChange={(event) => setGlobalInstructions(event.target.value)}
              placeholder="Ex. Je veux conserver le style général, mais rendre l’écran plus clair et plus compact…"
            />
          </section>

          <section className="corrections-section">
            <div className="corrections-heading">
              <div>
                <p className="eyebrow">ANNOTATIONS</p>
                <h2>Corrections <span>{annotations.length}</span></h2>
              </div>
            </div>

            <div className="corrections-list">
              {!annotations.length && (
                <div className="empty-notes">
                  <span>01</span>
                  <p>Sélectionne un outil puis dessine sur l’image pour créer ta première correction.</p>
                </div>
              )}

              {annotations.map((annotation, index) => {
                const layer = layers.find((item) => item.id === annotation.layerId);
                return (
                  <button
                    key={annotation.id}
                    className={'correction-card ' + (selectedId === annotation.id ? 'selected' : '') + (!layer?.visible ? ' hidden-layer' : '')}
                    onClick={() => {
                      setSelectedId(annotation.id);
                      setActiveLayerId(annotation.layerId);
                      setTool('select');
                    }}
                  >
                    <span className="correction-number" style={{ background: annotation.color }}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="correction-copy">
                      <strong>{CATEGORY_LABELS[annotation.category]} · {TYPE_LABELS[annotation.type]}</strong>
                      <span>{annotation.description || 'Message à préciser'}</span>
                      {annotation.groupId && (
                        <em>
                          Dans cadre {String(annotations.findIndex((item) => item.id === annotation.groupId) + 1).padStart(2, '0')}
                        </em>
                      )}
                    </span>
                    <span className="card-chevron">›</span>
                  </button>
                );
              })}
            </div>
          </section>

          {selected && (
            <section
              className={'annotation-editor ' + (isDraggingReference ? 'is-reference-dragging' : '')}
              onDragEnter={handleReferenceDragOver}
              onDragOver={handleReferenceDragOver}
              onDragLeave={handleReferenceDragLeave}
              onDrop={handleReferenceDrop}
            >
              {isDraggingReference && (
                <div className="reference-drop-overlay" aria-live="polite">
                  <span>＋</span>
                  <strong>Ajouter comme référence</strong>
                  <small>Cette image restera liée uniquement à cette correction.</small>
                </div>
              )}
              <div className="editor-heading">
                <div>
                  <p className="eyebrow">CORRECTION {String(annotations.findIndex((item) => item.id === selected.id) + 1).padStart(2, '0')}</p>
                  <h3>{TYPE_LABELS[selected.type]}</h3>
                </div>
                <button className="close-editor" title="Fermer" onClick={() => setSelectedId(null)}>×</button>
              </div>

              <div className="form-grid">
                <label>
                  <span>Action</span>
                  <select
                    value={selected.category}
                    onChange={(event) => updateAnnotation(selected.id, { category: event.target.value as Category })}
                  >
                    {(Object.keys(CATEGORY_LABELS) as Category[]).map((category) => (
                      <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Calque</span>
                  <select
                    value={selected.layerId}
                    onChange={(event) => {
                      const layer = layers.find((item) => item.id === event.target.value);
                      updateAnnotation(selected.id, {
                        layerId: event.target.value,
                        color: layer?.color || selected.color,
                      });
                    }}
                  >
                    {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                  </select>
                </label>
              </div>

              {selected.type !== 'frame' && (
                <label className="group-field">
                  <span>Cadre associé</span>
                  <select
                    value={selected.groupId || ''}
                    onChange={(event) =>
                      updateAnnotation(selected.id, { groupId: event.target.value || undefined })
                    }
                  >
                    <option value="">Aucun cadre</option>
                    {annotations
                      .filter((annotation): annotation is FrameAnnotation => annotation.type === 'frame')
                      .map((frame) => (
                        <option key={frame.id} value={frame.id}>
                          Cadre {String(annotations.findIndex((item) => item.id === frame.id) + 1).padStart(2, '0')}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              {selected.type === 'frame' && (
                <div className="frame-summary">
                  <span>Groupe actif</span>
                  <strong>
                    {annotations.filter((annotation) => annotation.groupId === selected.id).length} élément(s) lié(s)
                  </strong>
                  <small>Les formes et notes créées dans ce cadre sont automatiquement regroupées.</small>
                </div>
              )}

              {selected.type === 'shape' && (
                <div className="shape-controls">
                  <label>
                    <span>Forme</span>
                    <select
                      value={selected.shape}
                      onChange={(event) =>
                        updateAnnotation(selected.id, {
                          shape: event.target.value as ShapeAnnotation['shape'],
                        })
                      }
                    >
                      <option value="rectangle">Rectangle</option>
                      <option value="ellipse">Ellipse</option>
                      <option value="line">Ligne</option>
                    </select>
                  </label>
                  <label>
                    <span>Remplissage</span>
                    <input
                      type="color"
                      value={selected.fillColor}
                      onChange={(event) =>
                        updateAnnotation(selected.id, { fillColor: event.target.value })
                      }
                    />
                  </label>
                </div>
              )}

              {selected.type === 'color' && (
                <div className="color-replacement">
                  <div>
                    <span>Couleur prélevée</span>
                    <input
                      type="color"
                      value={selected.sampledColor}
                      onChange={(event) =>
                        updateAnnotation(selected.id, { sampledColor: event.target.value })
                      }
                    />
                    <code>{selected.sampledColor.toUpperCase()}</code>
                  </div>
                  <b>→</b>
                  <div>
                    <span>Couleur souhaitée</span>
                    <input
                      type="color"
                      value={selected.replacementColor}
                      onChange={(event) =>
                        updateAnnotation(selected.id, { replacementColor: event.target.value })
                      }
                    />
                    <code>{selected.replacementColor.toUpperCase()}</code>
                  </div>
                </div>
              )}

              <label className="message-field" data-reference-paste="true">
                <span>Message lié à l’image</span>
                <textarea
                  value={selected.description}
                  onChange={(event) => updateAnnotation(selected.id, { description: event.target.value })}
                  placeholder="Explique exactement ce que tu veux changer ici…"
                />
              </label>

              {selected.type === 'cut' && (
                <div className="cut-summary">
                  <span>{selected.polygon?.length ? 'Découpe polygonale déplaçable' : 'Découpe déplaçable'}</span>
                  <strong>Δx {Math.round(selected.x - selected.sourceX)} px · Δy {Math.round(selected.y - selected.sourceY)} px</strong>
                  <small>Sélectionne l’outil ↖ et fais glisser l’élément sur l’image.</small>
                </div>
              )}

              <div className="references" data-reference-paste="true">
                <div className="references-heading">
                  <div>
                    <span>Images de référence</span>
                    <small>{selected.type === 'frame' ? 'Liées à ce cadre · dépôt ou Ctrl+V dans le message' : 'Liées à cette correction · dépôt ou Ctrl+V dans le message'}</small>
                  </div>
                  <button className="mini-button" onClick={() => referenceInputRef.current?.click()}>+ Ajouter</button>
                </div>

                <input
                  ref={referenceInputRef}
                  hidden
                  multiple
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    addReferences(event.target.files).catch(() => undefined);
                    event.target.value = '';
                  }}
                />

                {!!selected.references.length && (
                  <div className="reference-grid">
                    {selected.references.map((reference) => (
                      <div className="reference-item" key={reference.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={reference.dataUrl} alt={reference.name} />
                        <button title="Retirer cette référence" onClick={() => removeReference(reference.id)}>×</button>
                        <span>{reference.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button className="delete-button" onClick={deleteSelected}>Supprimer cette correction</button>
            </section>
          )}
        </aside>
      </section>

      {renderExportDialog()}
    </main>
  );
}
