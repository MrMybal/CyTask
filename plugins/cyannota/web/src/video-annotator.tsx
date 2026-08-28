'use client';

import JSZip from 'jszip';
import {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type Point = { x: number; y: number };
export type VideoAnnotationType = 'rect' | 'arrow' | 'note' | 'draw';

export type VideoAnnotation = {
  id: string;
  type: VideoAnnotationType;
  start: number;
  end: number;
  color: string;
  message: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  points?: Point[];
  snapshot?: string;
};

export type VideoFrameStop = {
  id: string;
  time: number;
  frameIndex?: number;
  imageData: string;
};

type DecodedVideoFrame = {
  index: number;
  time: number;
  thumbnailUrl: string;
};

export type VideoProjectData = {
  version: 1;
  kind: 'video';
  title: string;
  videoName: string;
  videoType: string;
  duration: number;
  sourcePath: string;
  generalInstructions: string;
  annotations: VideoAnnotation[];
  frameStops?: VideoFrameStop[];
};

type VideoWorkspaceProps = {
  file: File;
  initialProject?: VideoProjectData;
  onClose?: () => void;
  onSaveBlob: (blob: Blob, name: string) => Promise<boolean>;
  onProjectChange?: (project: VideoProjectData) => void;
  onCaptureFrame?: (file: File, time: number) => Promise<void> | void;
  tabBar?: ReactNode;
  onOpenWorkspace?: () => void;
  onAddImage?: () => void;
  onAddVideo?: () => void;
  onSaveWorkspace?: () => void;
  onExportWorkspace?: () => void;
};

type VideoTool = 'select' | 'pan' | VideoAnnotationType;
type VideoDraft = {
  type: VideoAnnotationType;
  x: number;
  y: number;
  x2: number;
  y2: number;
  points: Point[];
};
type CompressionQuality = 'high' | 'balanced' | 'light';

const VIDEO_TOOL_LABELS: Record<VideoTool, string> = {
  select: 'Sélectionner une correction',
  pan: 'Main — déplacer la vidéo',
  rect: 'Encadrer une zone',
  arrow: 'Tracer une flèche',
  note: 'Placer une note',
  draw: 'Dessiner librement',
};

const VIDEO_TOOL_ICONS: Record<VideoTool, string> = {
  select: '↖',
  pan: '✥',
  rect: '□',
  arrow: '↗',
  note: 'T',
  draw: '✎',
};

function createId() {
  return globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
}

function safeFileName(value: string) {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'video'
  );
}

function formatTime(value: number, milliseconds = false) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const fraction = Math.floor((safe % 1) * 1000);
  const base =
    (hours ? String(hours).padStart(2, '0') + ':' : '') +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0');
  return milliseconds ? base + '.' + String(fraction).padStart(3, '0') : base;
}

function dataUrlPayload(dataUrl: string) {
  const separator = dataUrl.indexOf(',');
  return separator >= 0 ? dataUrl.slice(separator + 1) : '';
}

async function bytesToDataUrl(bytes: Uint8Array, mimeType: string) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: mimeType });
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Conversion de la frame impossible'));
    reader.readAsDataURL(blob);
  });
}

function annotationBounds(annotation: VideoAnnotation | VideoDraft) {
  if (annotation.type === 'draw') {
    const points = annotation.points || [];
    if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const x = annotation.x || 0;
  const y = annotation.y || 0;
  const x2 = annotation.x2 ?? x;
  const y2 = annotation.y2 ?? y;
  return {
    x: Math.min(x, x2),
    y: Math.min(y, y2),
    w: Math.abs(x2 - x),
    h: Math.abs(y2 - y),
  };
}

function drawArrow(context: CanvasRenderingContext2D, a: Point, b: Point, color: string, width: number) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(10, width * 5);
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
  context.beginPath();
  context.moveTo(b.x, b.y);
  context.lineTo(b.x - head * Math.cos(angle - Math.PI / 6), b.y - head * Math.sin(angle - Math.PI / 6));
  context.lineTo(b.x - head * Math.cos(angle + Math.PI / 6), b.y - head * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function paintVideoAnnotation(
  context: CanvasRenderingContext2D,
  annotation: VideoAnnotation | VideoDraft,
  index: number,
  selected = false,
) {
  const color = 'color' in annotation ? annotation.color : '#ff5c49';
  const unit = Math.max(1, context.canvas.width / 1100);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = (selected ? 4 : 3) * unit;

  if (annotation.type === 'rect') {
    const bounds = annotationBounds(annotation);
    context.fillStyle = color + '20';
    context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
  } else if (annotation.type === 'arrow') {
    drawArrow(
      context,
      { x: annotation.x || 0, y: annotation.y || 0 },
      { x: annotation.x2 || 0, y: annotation.y2 || 0 },
      color,
      context.lineWidth,
    );
  } else if (annotation.type === 'draw') {
    const points = annotation.points || [];
    if (points.length > 1) {
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  } else {
    const x = annotation.x || 0;
    const y = annotation.y || 0;
    context.beginPath();
    context.arc(x, y, 15 * unit, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#181513';
    context.font = `800 ${10 * unit}px Segoe UI`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1).padStart(2, '0'), x, y);
  }

  if ('id' in annotation && annotation.type !== 'note') {
    const bounds = annotationBounds(annotation);
    const badgeX = bounds.x;
    const badgeY = Math.max(0, bounds.y - 25 * unit);
    context.fillStyle = color;
    context.fillRect(badgeX, badgeY, 31 * unit, 21 * unit);
    context.fillStyle = '#181513';
    context.font = `850 ${9 * unit}px Segoe UI`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1).padStart(2, '0'), badgeX + 15.5 * unit, badgeY + 10.5 * unit);
  }
  context.restore();
}

function hitAnnotation(annotation: VideoAnnotation, point: Point) {
  if (annotation.type === 'note') {
    return Math.hypot(point.x - (annotation.x || 0), point.y - (annotation.y || 0)) <= 28;
  }
  const bounds = annotationBounds(annotation);
  const padding = 16;
  return (
    point.x >= bounds.x - padding &&
    point.x <= bounds.x + bounds.w + padding &&
    point.y >= bounds.y - padding &&
    point.y <= bounds.y + bounds.h + padding
  );
}

export function videoFrameStopFileName(stop: Pick<VideoFrameStop, 'time' | 'frameIndex'>, index: number) {
  const sourceFrame = stop.frameIndex === undefined
    ? ''
    : '-source-' + String(stop.frameIndex + 1).padStart(6, '0');
  return String(index + 1).padStart(2, '0') + '-frame' + sourceFrame + '-' + formatTime(stop.time, true).replace(/[:.]/g, '-') + '.png';
}

export function buildVideoPrompt(project: VideoProjectData) {
  const frameStops = [...(project.frameStops || [])].sort((a, b) => a.time - b.time);
  const lines = [
    '# Brief de corrections vidéo — ' + project.title,
    '',
    'Applique les corrections temporelles ci-dessous à la vidéo « ' + project.sourcePath + ' ».',
    '',
    '## Intention générale',
    '',
    project.generalInstructions.trim() || 'Aucune instruction générale supplémentaire.',
    '',
    '## Corrections temporelles',
    '',
  ];
  project.annotations.forEach((annotation, index) => {
    const bounds = annotationBounds(annotation);
    lines.push(
      '### ' + String(index + 1).padStart(2, '0') + ' — ' + formatTime(annotation.start, true) + ' → ' + formatTime(annotation.end, true),
      '',
      '- Type : ' + VIDEO_TOOL_LABELS[annotation.type],
      '- Zone : x=' + Math.round(bounds.x) + ', y=' + Math.round(bounds.y) + ', largeur=' + Math.round(bounds.w) + ', hauteur=' + Math.round(bounds.h),
      '- Instruction : ' + (annotation.message.trim() || 'Instruction à préciser.'),
      '- Capture : captures/' + String(index + 1).padStart(2, '0') + '-annotation.png',
      '',
    );
  });
  if (!project.annotations.length) lines.push('Aucune correction temporelle annotée.', '');
  lines.push('## Arrêts sur image', '');
  frameStops.forEach((stop, index) => {
    lines.push(
      '### Frame ' + String(index + 1).padStart(2, '0') + ' — ' + formatTime(stop.time, true),
      '',
      '- Image exportée : frames/' + videoFrameStopFileName(stop, index),
      ...(stop.frameIndex === undefined
        ? ['- Ancien arrêt temporel sans index de frame source.']
        : ['- Frame source exacte : #' + (stop.frameIndex + 1) + ' (index décodé ' + stop.frameIndex + ').']),
      '- Utiliser cette image comme capture autonome de la vidéo à cet instant.',
      '',
    );
  });
  if (!frameStops.length) lines.push('Aucun arrêt sur image demandé.', '');
  lines.push(
    '## Critère de fin',
    '',
    'Respecter les timecodes et conserver toutes les séquences qui ne sont pas explicitement concernées.',
  );
  return lines.join('\n');
}
export default function VideoAnnotator({
  file,
  initialProject,
  onClose,
  onSaveBlob,
  onProjectChange,
  onCaptureFrame,
  tabBar,
  onOpenWorkspace,
  onAddImage,
  onAddVideo,
  onSaveWorkspace,
  onExportWorkspace,
}: VideoWorkspaceProps) {
  const [originalSourceUrl] = useState(() => URL.createObjectURL(file));
  const [playbackUrl, setPlaybackUrl] = useState(originalSourceUrl);
  const [title, setTitle] = useState(
    initialProject?.title || file.name.replace(/\.[^.]+$/, '') || 'Corrections vidéo',
  );
  const [generalInstructions, setGeneralInstructions] = useState(
    initialProject?.generalInstructions || '',
  );
  const [annotations, setAnnotations] = useState<VideoAnnotation[]>(
    initialProject?.annotations || [],
  );
  const [frameStops, setFrameStops] = useState<VideoFrameStop[]>(() =>
    [...(initialProject?.frameStops || [])].sort((a, b) => a.time - b.time),
  );
  const [selectedFrameStopId, setSelectedFrameStopId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<VideoTool>('rect');
  const [draft, setDraft] = useState<VideoDraft | null>(null);
  const [duration, setDuration] = useState(initialProject?.duration || 0);
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9 });
  const [videoError, setVideoError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [saveStatus, setSaveStatus] = useState('Prêt');
  const [compressionOpen, setCompressionOpen] = useState(false);
  const [compressionQuality, setCompressionQuality] = useState<CompressionQuality>('balanced');
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [compressionStatus, setCompressionStatus] = useState('Moteur prêt à charger');
  const [isCompressing, setIsCompressing] = useState(false);
  const [isPreparingPreview, setIsPreparingPreview] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewStatus, setPreviewStatus] = useState('Aperçu compatible prêt à créer');
  const [hasCompatiblePreview, setHasCompatiblePreview] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<'timeline' | 'capture' | 'step'>('timeline');
  const [decodedFrames, setDecodedFrames] = useState<DecodedVideoFrame[]>([]);
  const [selectedDecodedFrameIndex, setSelectedDecodedFrameIndex] = useState<number | null>(null);
  const [isBuildingFilmstrip, setIsBuildingFilmstrip] = useState(false);
  const [isExtractingFrame, setIsExtractingFrame] = useState(false);
  const [filmstripProgress, setFilmstripProgress] = useState(0);
  const [filmstripStatus, setFilmstripStatus] = useState('Pellicule prête à créer');
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState<Point>({ x: 0, y: 0 });
  const [isViewPanning, setIsViewPanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef<VideoDraft | null>(null);
  const ffmpegRef = useRef<import('@ffmpeg/ffmpeg').FFmpeg | null>(null);
  const ffmpegWasmUrlRef = useRef<string | null>(null);
  const compressionCanceledRef = useRef(false);
  const previewCanceledRef = useRef(false);
  const ffmpegOperationRef = useRef<'preview' | 'compression' | 'filmstrip' | 'frame' | null>(null);
  const compatiblePreviewUrlRef = useRef<string | null>(null);
  const filmstripCanceledRef = useRef(false);
  const filmstripPtsRef = useRef(new Map<number, number>());
  const filmstripUrlsRef = useRef<string[]>([]);
  const filmstripScrollRef = useRef<HTMLDivElement>(null);
  const videoStageRef = useRef<HTMLDivElement>(null);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const viewZoomRef = useRef(1);
  const viewPanRef = useRef<Point>({ x: 0, y: 0 });
  const viewPanDragRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const onProjectChangeRef = useRef(onProjectChange);

  const selected = annotations.find((annotation) => annotation.id === selectedId) || null;
  const selectedDecodedFrame = useMemo(
    () => decodedFrames.find((frame) => frame.index === selectedDecodedFrameIndex) || null,
    [decodedFrames, selectedDecodedFrameIndex],
  );
  const selectedDecodedFrameStop = selectedDecodedFrame
    ? frameStops.find((stop) => stop.frameIndex === selectedDecodedFrame.index) || null
    : null;
  const stoppedFrameIndexes = useMemo(
    () => new Set(frameStops.flatMap((stop) => (stop.frameIndex === undefined ? [] : [stop.frameIndex]))),
    [frameStops],
  );
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => currentTime >= annotation.start && currentTime <= annotation.end),
    [annotations, currentTime],
  );

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(originalSourceUrl);
      if (compatiblePreviewUrlRef.current) URL.revokeObjectURL(compatiblePreviewUrlRef.current);
      filmstripUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      if (ffmpegWasmUrlRef.current) URL.revokeObjectURL(ffmpegWasmUrlRef.current);
      ffmpegRef.current?.terminate();
    };
  }, [originalSourceUrl]);

  useEffect(() => {
    onProjectChangeRef.current = onProjectChange;
  }, [onProjectChange]);

  useEffect(() => {
    viewZoomRef.current = viewZoom;
  }, [viewZoom]);

  useEffect(() => {
    viewPanRef.current = viewPan;
  }, [viewPan]);

  useEffect(() => {
    onProjectChangeRef.current?.(projectData());
  }, [title, generalInstructions, annotations, frameStops, duration, file.name, file.type]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    annotations.forEach((annotation, index) => {
      if (currentTime >= annotation.start && currentTime <= annotation.end) {
        paintVideoAnnotation(context, annotation, index, annotation.id === selectedId);
      }
    });
    if (draft) paintVideoAnnotation(context, draft, annotations.length, true);
  }, [annotations, currentTime, draft, selectedId]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
    }, 40);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.matches('input, textarea, select')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (workspaceMode === 'step' && decodedFrames.length) moveOneFrame(-1);
        else seek(currentTime - (event.shiftKey ? 5 : 0.1));
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (workspaceMode === 'step' && decodedFrames.length) moveOneFrame(1);
        else seek(currentTime + (event.shiftKey ? 5 : 0.1));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function changeViewZoom(nextValue: number, clientX?: number, clientY?: number) {
    const nextZoom = Math.max(0.25, Math.min(6, nextValue));
    const frame = videoFrameRef.current;
    const stage = videoStageRef.current;
    if (!frame || !stage) {
      viewZoomRef.current = nextZoom;
      setViewZoom(nextZoom);
      return;
    }
    const frameBounds = frame.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    const focusX = clientX ?? stageBounds.left + stage.clientWidth / 2;
    const focusY = clientY ?? stageBounds.top + stage.clientHeight / 2;
    const currentZoom = viewZoomRef.current;
    const currentPan = viewPanRef.current;
    const baseLeft = frameBounds.left - currentPan.x;
    const baseTop = frameBounds.top - currentPan.y;
    const videoX = (focusX - frameBounds.left) / currentZoom;
    const videoY = (focusY - frameBounds.top) / currentZoom;
    const nextPan = {
      x: focusX - baseLeft - videoX * nextZoom,
      y: focusY - baseTop - videoY * nextZoom,
    };
    viewZoomRef.current = nextZoom;
    viewPanRef.current = nextPan;
    setViewZoom(nextZoom);
    setViewPan(nextPan);
  }

  function resetVideoView() {
    viewZoomRef.current = 1;
    viewPanRef.current = { x: 0, y: 0 };
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  }

  useEffect(() => {
    const stage = videoStageRef.current;
    if (!stage) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      changeViewZoom(viewZoomRef.current * factor, event.clientX, event.clientY);
    }
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [videoSize.width, videoSize.height]);

  async function captureCurrentFrame() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight || !onCaptureFrame) return;
    video.pause();
    setIsPlaying(false);
    setSaveStatus('Création de la capture…');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Capture vidéo indisponible');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Impossible de créer la capture'))),
        'image/png',
      );
    });
    const captureTime = video.currentTime;
    const timeLabel = formatTime(captureTime, true).replace(/[:.]/g, '-');
    const captureFile = new File(
      [blob],
      safeFileName(title || file.name.replace(/\.[^.]+$/, '')) + '-capture-' + timeLabel + '.png',
      { type: 'image/png', lastModified: Date.now() },
    );
    await onCaptureFrame(captureFile, captureTime);
    setSaveStatus('Capture ouverte dans un onglet image');
  }


  function scrollToDecodedFrame(frameIndex: number) {
    window.requestAnimationFrame(() => {
      const button = filmstripScrollRef.current?.querySelector<HTMLElement>(
        '[data-frame-index="' + frameIndex + '"]',
      );
      button?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  }

  function selectDecodedFrame(frame: DecodedVideoFrame) {
    videoRef.current?.pause();
    setIsPlaying(false);
    setSelectedDecodedFrameIndex(frame.index);
    setSelectedId(null);
    const existing = frameStops.find((stop) => stop.frameIndex === frame.index);
    setSelectedFrameStopId(existing?.id || null);
    seek(frame.time);
    scrollToDecodedFrame(frame.index);
  }

  async function addFrameStop(frameOverride?: DecodedVideoFrame) {
    const frame = frameOverride || selectedDecodedFrame;
    if (!frame) {
      window.alert('Crée la pellicule puis sélectionne précisément une image.');
      return;
    }
    const duplicate = frameStops.find((stop) => stop.frameIndex === frame.index);
    if (duplicate) {
      setSelectedFrameStopId(duplicate.id);
      setSaveStatus('Cette frame exacte est déjà sélectionnée');
      return;
    }
    if (isPreparingPreview || isCompressing || isBuildingFilmstrip || isExtractingFrame) return;
    if (file.size >= 2 * 1024 * 1024 * 1024) {
      window.alert('L’extraction locale accepte des vidéos de moins de 2 Go.');
      return;
    }
    setIsExtractingFrame(true);
    setFilmstripStatus('Extraction PNG pleine résolution de la frame #' + (frame.index + 1) + '…');
    ffmpegOperationRef.current = 'frame';
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'video';
    const inputName = 'frame-input-' + createId() + '.' + extension;
    const outputName = 'frame-output-' + createId() + '.png';
    try {
      ffmpeg = await getFfmpeg();
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-map', '0:v:0',
        '-vf', `select=eq(n\\,${frame.index})`,
        '-vsync', '0',
        '-frames:v', '1',
        outputName,
      ]);
      if (exitCode !== 0) throw new Error('Le moteur vidéo a terminé avec le code ' + exitCode + '.');
      const output = await ffmpeg.readFile(outputName);
      if (typeof output === 'string') throw new Error('La frame PNG générée est invalide.');
      const imageData = await bytesToDataUrl(output, 'image/png');
      const stop: VideoFrameStop = {
        id: createId(),
        time: frame.time,
        frameIndex: frame.index,
        imageData,
      };
      setFrameStops((items) => [...items, stop].sort((a, b) => a.time - b.time));
      setSelectedFrameStopId(stop.id);
      setSaveStatus('Frame source #' + (frame.index + 1) + ' ajoutée en pleine résolution');
      setFilmstripStatus(decodedFrames.length + ' frames décodées · frame #' + (frame.index + 1) + ' exportée');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setFilmstripStatus('Extraction de la frame impossible');
      window.alert('Impossible d’extraire cette frame exacte.\n\n' + detail);
    } finally {
      if (ffmpeg) {
        await ffmpeg.deleteFile(inputName).catch(() => undefined);
        await ffmpeg.deleteFile(outputName).catch(() => undefined);
      }
      if (ffmpegOperationRef.current === 'frame') ffmpegOperationRef.current = null;
      setIsExtractingFrame(false);
    }
  }

  function toggleSelectedDecodedFrameStop() {
    if (selectedDecodedFrameStop) {
      removeFrameStop(selectedDecodedFrameStop.id);
      return;
    }
    addFrameStop().catch(() => undefined);
  }

  function selectFrameStop(stop: VideoFrameStop) {
    videoRef.current?.pause();
    setIsPlaying(false);
    setSelectedFrameStopId(stop.id);
    setSelectedId(null);
    if (stop.frameIndex !== undefined) {
      setSelectedDecodedFrameIndex(stop.frameIndex);
      scrollToDecodedFrame(stop.frameIndex);
    }
    seek(stop.time);
  }

  function removeFrameStop(id: string) {
    setFrameStops((items) => items.filter((stop) => stop.id !== id));
    setSelectedFrameStopId((current) => (current === id ? null : current));
    setSaveStatus('Arrêt image supprimé');
  }

  function moveOneFrame(direction: -1 | 1) {
    if (!decodedFrames.length) return;
    const currentPosition = selectedDecodedFrame
      ? decodedFrames.findIndex((frame) => frame.index === selectedDecodedFrame.index)
      : decodedFrames.reduce(
          (best, frame, index) =>
            Math.abs(frame.time - currentTime) < Math.abs(decodedFrames[best].time - currentTime) ? index : best,
          0,
        );
    const nextPosition = Math.max(0, Math.min(decodedFrames.length - 1, currentPosition + direction));
    selectDecodedFrame(decodedFrames[nextPosition]);
  }
  function annotationWindow() {
    const start = Math.max(0, Math.min(currentTime, Math.max(0, duration - 0.1)));
    return { start, end: Math.max(start + 0.1, Math.min(duration || start + 3, start + 3)) };
  }

  function captureSnapshot(annotation: VideoAnnotation, index: number) {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    paintVideoAnnotation(context, annotation, index, true);
    return canvas.toDataURL('image/png');
  }

  function commitAnnotation(shape: VideoDraft) {
    const window = annotationWindow();
    const annotation: VideoAnnotation = {
      id: createId(),
      type: shape.type,
      start: window.start,
      end: window.end,
      color: '#ff5c49',
      message: 'Décris la correction à appliquer pendant cette séquence.',
      x: shape.x,
      y: shape.y,
      x2: shape.x2,
      y2: shape.y2,
      points: shape.points,
    };
    annotation.snapshot = captureSnapshot(annotation, annotations.length);
    setAnnotations((items) => [...items, annotation]);
    setSelectedId(annotation.id);
    setTool('select');
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (![0, 1, 2].includes(event.button)) return;
    if (event.button === 2) event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === 'pan' || event.button === 1 || event.button === 2) {
      viewPanDragRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        panX: viewPanRef.current.x,
        panY: viewPanRef.current.y,
      };
      setIsViewPanning(true);
      return;
    }

    if (event.button !== 0 || workspaceMode !== 'timeline') return;
    videoRef.current?.pause();
    setIsPlaying(false);
    const point = canvasPoint(event);

    if (tool === 'select') {
      const hit = [...visibleAnnotations].reverse().find((annotation) => hitAnnotation(annotation, point));
      setSelectedId(hit?.id || null);
      return;
    }

    const next: VideoDraft = {
      type: tool,
      x: point.x,
      y: point.y,
      x2: point.x,
      y2: point.y,
      points: [point],
    };
    if (tool === 'note') {
      commitAnnotation(next);
      return;
    }
    draftRef.current = next;
    setDraft(next);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const panDrag = viewPanDragRef.current;
    if (panDrag) {
      const nextPan = {
        x: panDrag.panX + event.clientX - panDrag.clientX,
        y: panDrag.panY + event.clientY - panDrag.clientY,
      };
      viewPanRef.current = nextPan;
      setViewPan(nextPan);
      return;
    }

    if (!draftRef.current) return;
    const point = canvasPoint(event);
    const next = {
      ...draftRef.current,
      x2: point.x,
      y2: point.y,
      points:
        draftRef.current.type === 'draw'
          ? [...draftRef.current.points, point]
          : draftRef.current.points,
    };
    draftRef.current = next;
    setDraft(next);
  }

  function handlePointerUp() {
    if (viewPanDragRef.current) {
      viewPanDragRef.current = null;
      setIsViewPanning(false);
      return;
    }
    const value = draftRef.current;
    if (!value) return;
    draftRef.current = null;
    setDraft(null);
    const bounds = annotationBounds(value);
    if (value.type === 'draw' ? value.points.length > 1 : bounds.w + bounds.h > 8) {
      commitAnnotation(value);
    }
  }
  function handleLoadedMetadata() {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    if (!video || !canvas) return;
    setDuration(video.duration || initialProject?.duration || 0);
    setVideoSize({ width: video.videoWidth || 16, height: video.videoHeight || 9 });
    setVideoError('');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    setCurrentTime(0);
    resetVideoView();
  }

  function seek(value: number) {
    const next = Math.max(0, duration > 0 ? Math.min(duration, value) : value);
    if (videoRef.current) videoRef.current.currentTime = next;
    setCurrentTime(next);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => undefined);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  function updateSelected(patch: Partial<VideoAnnotation>) {
    if (!selectedId) return;
    setAnnotations((items) =>
      items.map((annotation) =>
        annotation.id === selectedId ? ({ ...annotation, ...patch } as VideoAnnotation) : annotation,
      ),
    );
  }

  function deleteSelected() {
    if (!selectedId) return;
    setAnnotations((items) => items.filter((annotation) => annotation.id !== selectedId));
    setSelectedId(null);
  }

  function buildPrompt() {
    return buildVideoPrompt(projectData());
  }
  function projectData(): VideoProjectData {
    return {
      version: 1,
      kind: 'video',
      title,
      videoName: file.name,
      videoType: file.type || 'video/mp4',
      duration,
      sourcePath: 'media/original-' + safeFileName(file.name),
      generalInstructions,
      annotations,
      frameStops,
    };
  }

  async function saveProject() {
    setSaveStatus('Création du projet vidéo…');
    try {
      const project = projectData();
      const zip = new JSZip();
      zip.file('video-project.cyannota.json', JSON.stringify(project, null, 2));
      zip.file('prompt.md', buildPrompt());
      zip.file(project.sourcePath, file, { compression: 'STORE' });
      annotations.forEach((annotation, index) => {
        const payload = annotation.snapshot ? dataUrlPayload(annotation.snapshot) : '';
        if (payload) {
          zip.file('captures/' + String(index + 1).padStart(2, '0') + '-annotation.png', payload, {
            base64: true,
          });
        }
      });
      const sortedStops = [...frameStops].sort((a, b) => a.time - b.time);
      sortedStops.forEach((stop, index) => {
        const payload = dataUrlPayload(stop.imageData);
        if (payload) zip.file('frames/' + videoFrameStopFileName(stop, index), payload, { base64: true });
      });
      if (sortedStops.length) {
        zip.file(
          'frames/manifest.json',
          JSON.stringify(
            sortedStops.map((stop, index) => ({
              frame: index + 1,
              sourceFrameIndex: stop.frameIndex ?? null,
              sourceFrameNumber: stop.frameIndex === undefined ? null : stop.frameIndex + 1,
              time: stop.time,
              timecode: formatTime(stop.time, true),
              file: videoFrameStopFileName(stop, index),
            })),
            null,
            2,
          ),
        );
      }
      const archive = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 }, streamFiles: true },
        (metadata) => setSaveStatus('Création du ZIP · ' + Math.round(metadata.percent) + '%'),
      );
      const saved = await onSaveBlob(archive, safeFileName(title) + '.cyannota-video.zip');
      setSaveStatus(saved ? 'Projet vidéo enregistré' : 'Enregistrement annulé');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSaveStatus('Échec de l’enregistrement');
      window.alert('Impossible d’enregistrer le projet vidéo.\n\n' + detail);
    }
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(buildPrompt());
    setSaveStatus('Prompt copié');
  }

  async function getFfmpeg() {
    if (ffmpegRef.current) return ffmpegRef.current;
    if (ffmpegOperationRef.current === 'preview') setPreviewStatus('Chargement du moteur local…');
    else if (ffmpegOperationRef.current === 'compression') setCompressionStatus('Chargement du moteur local…');
    else setFilmstripStatus('Chargement du moteur vidéo local…');
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
      if (Number.isFinite(progress)) {
        const nextProgress = Math.max(0, Math.min(99, Math.round(progress * 100)));
        if (ffmpegOperationRef.current === 'preview') setPreviewProgress(nextProgress);
        else if (ffmpegOperationRef.current === 'compression') setCompressionProgress(nextProgress);
        else if (ffmpegOperationRef.current === 'filmstrip') setFilmstripProgress(nextProgress);
      }
    });
    ffmpeg.on('log', ({ message }) => {
      if (!message) return;
      if (ffmpegOperationRef.current === 'preview') setPreviewStatus(message.slice(-140));
      else if (ffmpegOperationRef.current === 'compression') setCompressionStatus(message.slice(-140));
      else if (ffmpegOperationRef.current === 'filmstrip') {
        const match = message.match(/\bn:\s*(\d+)\b.*\bpts_time:([+-]?(?:\d+(?:\.\d*)?|\.\d+))/);
        if (match) filmstripPtsRef.current.set(Number(match[1]), Number(match[2]));
      }
    });
    const baseUrl = new URL('./ffmpeg/', window.location.href);
    const manifestResponse = await fetch(
      new URL('ffmpeg-core.wasm.parts.json', baseUrl),
      { cache: 'force-cache' },
    );
    if (!manifestResponse.ok) throw new Error('Manifest FFmpeg local introuvable');
    const manifest = await manifestResponse.json() as {
      version?: unknown;
      size?: unknown;
      parts?: unknown;
    };
    if (manifest.version !== 1 || typeof manifest.size !== 'number'
      || manifest.size < 1 || manifest.size > 64 * 1024 * 1024
      || !Array.isArray(manifest.parts) || manifest.parts.length < 1
      || manifest.parts.length > 16
      || manifest.parts.some((name) =>
        typeof name !== 'string' || !/^ffmpeg-core\.wasm\.part\d+$/.test(name))) {
      throw new Error('Manifest FFmpeg local invalide');
    }
    const chunks = await Promise.all(manifest.parts.map(async (name) => {
      const response = await fetch(new URL(name as string, baseUrl), { cache: 'force-cache' });
      if (!response.ok) throw new Error('Bloc FFmpeg local manquant');
      return response.arrayBuffer();
    }));
    const wasm = new Blob(chunks, { type: 'application/wasm' });
    if (wasm.size !== manifest.size) throw new Error('Moteur FFmpeg local incomplet');
    const wasmUrl = URL.createObjectURL(wasm);
    ffmpegWasmUrlRef.current = wasmUrl;
    await ffmpeg.load({
      coreURL: new URL('ffmpeg-core.js', baseUrl).href,
      wasmURL: wasmUrl,
    });
    ffmpegRef.current = ffmpeg;
    if (ffmpegOperationRef.current === 'preview') setPreviewStatus('Moteur local chargé');
    else if (ffmpegOperationRef.current === 'compression') setCompressionStatus('Moteur local chargé');
    else setFilmstripStatus('Moteur vidéo local chargé');
    return ffmpeg;
  }

  async function buildFilmstrip() {
    if (isPreparingPreview || isCompressing || isBuildingFilmstrip || isExtractingFrame) return;
    if (file.size >= 2 * 1024 * 1024 * 1024) {
      window.alert('La pellicule locale accepte des vidéos de moins de 2 Go.');
      return;
    }
    setIsBuildingFilmstrip(true);
    setFilmstripProgress(0);
    setFilmstripStatus('Préparation du fichier source…');
    filmstripCanceledRef.current = false;
    filmstripPtsRef.current.clear();
    ffmpegOperationRef.current = 'filmstrip';
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const nextUrls: string[] = [];
    const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'video';
    const sessionId = createId().replace(/[^a-z0-9]/gi, '');
    const inputName = 'filmstrip-input-' + sessionId + '.' + extension;
    const outputPrefix = 'filmstrip-' + sessionId + '-';
    try {
      ffmpeg = await getFfmpeg();
      if (filmstripCanceledRef.current) return;
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      if (filmstripCanceledRef.current) return;
      setFilmstripStatus('Décodage de toutes les frames réelles…');
      const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-map', '0:v:0',
        '-an',
        '-vf', 'showinfo,scale=320:-2:force_original_aspect_ratio=decrease',
        '-vsync', '0',
        '-q:v', '7',
        outputPrefix + '%08d.jpg',
      ]);
      if (exitCode !== 0) throw new Error('Le moteur vidéo a terminé avec le code ' + exitCode + '.');
      const nodes = await ffmpeg.listDir('/');
      const frameFiles = nodes
        .filter((node) => !node.isDir && node.name.startsWith(outputPrefix) && node.name.endsWith('.jpg'))
        .map((node) => node.name)
        .sort();
      if (!frameFiles.length) throw new Error('Aucune image n’a été décodée dans cette vidéo.');
      const nextFrames: DecodedVideoFrame[] = [];
      for (let index = 0; index < frameFiles.length; index += 1) {
        if (filmstripCanceledRef.current) break;
        const frameFile = frameFiles[index];
        const output = await ffmpeg.readFile(frameFile);
        await ffmpeg.deleteFile(frameFile).catch(() => undefined);
        if (typeof output === 'string') continue;
        const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
        const thumbnailUrl = URL.createObjectURL(new Blob([buffer], { type: 'image/jpeg' }));
        nextUrls.push(thumbnailUrl);
        const exactPts = filmstripPtsRef.current.get(index);
        const fallbackTime = duration ? (index * duration) / frameFiles.length : 0;
        nextFrames.push({
          index,
          time: Number.isFinite(exactPts) ? Math.max(0, exactPts as number) : fallbackTime,
          thumbnailUrl,
        });
        if (index % 12 === 0 || index === frameFiles.length - 1) {
          setFilmstripProgress(Math.round(((index + 1) / frameFiles.length) * 100));
          setFilmstripStatus('Chargement des vignettes · ' + (index + 1) + ' / ' + frameFiles.length);
        }
      }
      if (filmstripCanceledRef.current) {
        nextUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      filmstripUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      filmstripUrlsRef.current = nextUrls;
      setDecodedFrames(nextFrames);
      const preferredIndex = frameStops.find((stop) => stop.frameIndex !== undefined)?.frameIndex ?? 0;
      const preferredFrame = nextFrames.find((frame) => frame.index === preferredIndex) || nextFrames[0];
      setSelectedDecodedFrameIndex(preferredFrame.index);
      seek(preferredFrame.time);
      scrollToDecodedFrame(preferredFrame.index);
      if (!duration && nextFrames.length > 1) {
        const last = nextFrames[nextFrames.length - 1];
        const previous = nextFrames[nextFrames.length - 2];
        setDuration(last.time + Math.max(0, last.time - previous.time));
      }
      setFilmstripProgress(100);
      setFilmstripStatus(nextFrames.length + ' frames réelles prêtes à sélectionner');
      setSaveStatus('Pellicule créée · ' + nextFrames.length + ' frames réelles');
    } catch (error) {
      nextUrls.forEach((url) => URL.revokeObjectURL(url));
      if (!filmstripCanceledRef.current) {
        const detail = error instanceof Error ? error.message : String(error);
        setFilmstripStatus('Création de la pellicule impossible');
        window.alert('Impossible de décoder la vidéo image par image.\n\n' + detail);
      }
    } finally {
      if (ffmpeg && !filmstripCanceledRef.current) {
        await ffmpeg.deleteFile(inputName).catch(() => undefined);
        const leftovers = await ffmpeg.listDir('/').catch(() => []);
        for (const node of leftovers) {
          if (!node.isDir && node.name.startsWith(outputPrefix)) {
            await ffmpeg.deleteFile(node.name).catch(() => undefined);
          }
        }
      }
      if (ffmpegOperationRef.current === 'filmstrip') ffmpegOperationRef.current = null;
      setIsBuildingFilmstrip(false);
    }
  }

  function cancelFilmstrip() {
    filmstripCanceledRef.current = true;
    ffmpegOperationRef.current = null;
    ffmpegRef.current?.terminate();
    ffmpegRef.current = null;
    setIsBuildingFilmstrip(false);
    setFilmstripProgress(0);
    setFilmstripStatus('Création de la pellicule annulée');
  }
  async function createCompatiblePreview() {
    if (isPreparingPreview || isCompressing || isBuildingFilmstrip || isExtractingFrame) return;
    if (file.size >= 2 * 1024 * 1024 * 1024) {
      window.alert('La création d’un aperçu local accepte des vidéos de moins de 2 Go.');
      return;
    }
    setIsPreparingPreview(true);
    setPreviewProgress(0);
    setPreviewStatus('Préparation de la vidéo originale…');
    previewCanceledRef.current = false;
    ffmpegOperationRef.current = 'preview';
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'video';
    const inputName = 'preview-input-' + createId() + '.' + extension;
    const outputName = 'preview-output-' + createId() + '.mp4';
    try {
      ffmpeg = await getFfmpeg();
      if (previewCanceledRef.current) return;
      setPreviewStatus('Lecture du fichier original…');
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      if (previewCanceledRef.current) return;
      setPreviewStatus('Création de l’aperçu H.264 compatible…');
      const exitCode = await ffmpeg.exec([
        '-i', inputName,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-vf', 'scale=1920:-2:force_original_aspect_ratio=decrease',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '25',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputName,
      ]);
      if (exitCode !== 0) throw new Error('Le moteur vidéo a terminé avec le code ' + exitCode + '.');
      const output = await ffmpeg.readFile(outputName);
      if (typeof output === 'string') throw new Error('L’aperçu vidéo généré est invalide.');
      const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
      const previewBlob = new Blob([buffer], { type: 'video/mp4' });
      const nextUrl = URL.createObjectURL(previewBlob);
      if (compatiblePreviewUrlRef.current) URL.revokeObjectURL(compatiblePreviewUrlRef.current);
      compatiblePreviewUrlRef.current = nextUrl;
      setHasCompatiblePreview(true);
      setVideoError('');
      setCurrentTime(0);
      setPlaybackUrl(nextUrl);
      setPreviewProgress(100);
      setPreviewStatus('Aperçu compatible prêt');
      setSaveStatus('Aperçu compatible prêt · original conservé');
    } catch (error) {
      if (!previewCanceledRef.current) {
        const detail = error instanceof Error ? error.message : String(error);
        setPreviewStatus('Impossible de créer l’aperçu compatible');
        window.alert(
          'Impossible de convertir cette vidéo pour la lecture.\n\n' +
          detail +
          '\n\nLe fichier original n’a pas été modifié.',
        );
      }
    } finally {
      if (ffmpeg && !previewCanceledRef.current) {
        await ffmpeg.deleteFile(inputName).catch(() => undefined);
        await ffmpeg.deleteFile(outputName).catch(() => undefined);
      }
      if (ffmpegOperationRef.current === 'preview') ffmpegOperationRef.current = null;
      setIsPreparingPreview(false);
    }
  }

  function cancelCompatiblePreview() {
    previewCanceledRef.current = true;
    ffmpegOperationRef.current = null;
    ffmpegRef.current?.terminate();
    ffmpegRef.current = null;
    setIsPreparingPreview(false);
    setPreviewProgress(0);
    setPreviewStatus('Création de l’aperçu annulée');
  }
  async function compressVideo() {
    if (isPreparingPreview || isCompressing || isBuildingFilmstrip || isExtractingFrame) return;
    if (file.size >= 2 * 1024 * 1024 * 1024) {
      window.alert('La compression web accepte des vidéos de moins de 2 Go.');
      return;
    }
    setIsCompressing(true);
    setCompressionProgress(0);
    compressionCanceledRef.current = false;
    ffmpegOperationRef.current = 'compression';
    let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | null = null;
    const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '') || 'video';
    const inputName = 'input-' + createId() + '.' + extension;
    const outputName = 'output-' + createId() + '.mp4';
    try {
      ffmpeg = await getFfmpeg();
      setCompressionStatus('Préparation de la vidéo…');
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      const qualityArgs: Record<CompressionQuality, string[]> = {
        high: ['-preset', 'medium', '-crf', '19'],
        balanced: ['-preset', 'veryfast', '-crf', '24'],
        light: [
          '-vf',
          'scale=1280:-2:force_original_aspect_ratio=decrease',
          '-preset',
          'veryfast',
          '-crf',
          '30',
        ],
      };
      setCompressionStatus('Compression locale en cours…');
      const exitCode = await ffmpeg.exec([
        '-i',
        inputName,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        ...qualityArgs[compressionQuality],
        '-c:a',
        'aac',
        '-b:a',
        compressionQuality === 'light' ? '96k' : '128k',
        '-movflags',
        '+faststart',
        outputName,
      ]);
      if (exitCode !== 0) throw new Error('Le moteur vidéo a terminé avec le code ' + exitCode + '.');
      const output = await ffmpeg.readFile(outputName);
      if (typeof output === 'string') throw new Error('Le fichier vidéo généré est invalide.');
      const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
      const blob = new Blob([buffer], { type: 'video/mp4' });
      setCompressionProgress(100);
      setCompressionStatus('Compression terminée · ' + (blob.size / 1024 / 1024).toFixed(1) + ' Mo');
      await onSaveBlob(blob, safeFileName(title) + '-compressee.mp4');
    } catch (error) {
      if (!compressionCanceledRef.current) {
        const detail = error instanceof Error ? error.message : String(error);
        setCompressionStatus('Compression impossible');
        window.alert('Impossible de compresser cette vidéo localement.\n\n' + detail);
      }
    } finally {
      if (ffmpeg && !compressionCanceledRef.current) {
        await ffmpeg.deleteFile(inputName).catch(() => undefined);
        await ffmpeg.deleteFile(outputName).catch(() => undefined);
      }
      if (ffmpegOperationRef.current === 'compression') ffmpegOperationRef.current = null;
      setIsCompressing(false);
    }
  }

  function cancelCompression() {
    compressionCanceledRef.current = true;
    ffmpegOperationRef.current = null;
    ffmpegRef.current?.terminate();
    ffmpegRef.current = null;
    setIsCompressing(false);
    setCompressionProgress(0);
    setCompressionStatus('Compression annulée');
  }

  function timelineSeek(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * duration);
  }

  return (
    <main className="video-shell">
      <header className="video-topbar">
        <div className="video-brand">
          {onClose && <button className="video-back" onClick={onClose} aria-label="Revenir aux images">←</button>}
          <span className="brand-mark">Cy</span>
          <div><strong>CyAnnota Vidéo</strong><span>Annotations temporelles locales</span></div>
        </div>
        <label className="project-title video-title">
          <span className="status-dot" />
          <input aria-label="Nom du projet vidéo" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="top-actions">
          <span className="video-local-badge">● 100% local</span>
          {onOpenWorkspace && <button className="button ghost compact" onClick={onOpenWorkspace}>Ouvrir</button>}
          {onAddImage && <button className="button ghost compact" onClick={onAddImage}>Image</button>}
          {onAddVideo && <button className="button ghost compact" onClick={onAddVideo}>Vidéo</button>}
          <button className="button ghost compact" onClick={() => copyPrompt().catch(() => undefined)}>Prompt</button>
          <button className="button ghost compact" onClick={() => setCompressionOpen(true)} disabled={isPreparingPreview || isBuildingFilmstrip || isExtractingFrame}>Compresser</button>
          <button className="button ghost compact" onClick={onSaveWorkspace || (() => saveProject().catch(() => undefined))}>Sauver</button>
          {onExportWorkspace && <button className="button primary" onClick={onExportWorkspace}>Exporter</button>}
        </div>
      </header>

      {tabBar}
      <div className="video-modebar">
        <div className="video-mode-switch" aria-label="Mode d’édition vidéo">
          <button className={workspaceMode === 'timeline' ? 'active' : ''} onClick={() => { setWorkspaceMode('timeline'); setTool('select'); }}>Timeline complète</button>
          <button className={workspaceMode === 'capture' ? 'active' : ''} onClick={() => { setWorkspaceMode('capture'); setTool('pan'); }}>Capture → onglet</button>
          <button className={workspaceMode === 'step' ? 'active' : ''} onClick={() => { videoRef.current?.pause(); setIsPlaying(false); setWorkspaceMode('step'); setTool('pan'); }}>Step frame → export</button>
        </div>
        <span>
          {workspaceMode === 'timeline'
            ? 'Annotations temporelles · molette : zoom · clic droit : déplacer'
            : workspaceMode === 'capture'
              ? 'Crée immédiatement un onglet image éditable depuis la frame affichée'
              : 'Pellicule de toutes les frames réellement décodées · sélection exacte par image'}
        </span>
        {workspaceMode === 'capture' && (
          <button className="button primary compact" onClick={() => captureCurrentFrame().catch((error) => window.alert(error instanceof Error ? error.message : String(error)))} disabled={!duration || Boolean(videoError)}>
            Capturer à {formatTime(currentTime, true)}
          </button>
        )}
        {workspaceMode === 'step' && (
          <div className="video-step-actions">
            {isBuildingFilmstrip ? (
              <button className="button ghost compact" onClick={cancelFilmstrip}>Annuler {filmstripProgress}%</button>
            ) : (
              <button className="button ghost compact" onClick={() => buildFilmstrip().catch(() => undefined)} disabled={isCompressing || isPreparingPreview || isExtractingFrame}>
                {decodedFrames.length ? 'Reconstruire la pellicule' : 'Créer la pellicule'}
              </button>
            )}
            <button className="button ghost compact" onClick={() => moveOneFrame(-1)} disabled={!decodedFrames.length || isBuildingFilmstrip}>−1 frame réelle</button>
            <button className="button primary compact" onClick={toggleSelectedDecodedFrameStop} disabled={!selectedDecodedFrame || isBuildingFilmstrip || isExtractingFrame}>
              {isExtractingFrame ? 'Extraction…' : selectedDecodedFrameStop ? 'Retirer #' + (selectedDecodedFrame!.index + 1) : selectedDecodedFrame ? 'Sélectionner #' + (selectedDecodedFrame.index + 1) : 'Sélectionner une frame'}
            </button>
            <button className="button ghost compact" onClick={() => moveOneFrame(1)} disabled={!decodedFrames.length || isBuildingFilmstrip}>+1 frame réelle</button>
          </div>
        )}
        <div className="video-view-zoom">
          <button onClick={() => changeViewZoom(viewZoomRef.current - 0.1)} aria-label="Réduire le zoom vidéo">−</button>
          <strong>{Math.round(viewZoom * 100)}%</strong>
          <button onClick={() => changeViewZoom(viewZoomRef.current + 0.1)} aria-label="Augmenter le zoom vidéo">+</button>
          <button onClick={resetVideoView}>Ajuster</button>
        </div>
      </div>

      <section className={'video-layout ' + (tabBar ? 'has-media-tabs' : '')}>
        <aside className="toolrail video-toolrail" aria-label="Outils vidéo">
          {(Object.keys(VIDEO_TOOL_ICONS) as VideoTool[]).map((item) => (
            <button
              key={item}
              className={'tool ' + (tool === item ? 'active' : '')}
              data-label={VIDEO_TOOL_LABELS[item]}
              aria-label={VIDEO_TOOL_LABELS[item]}
              onClick={() => setTool(item)}
              disabled={workspaceMode !== 'timeline' && item !== 'pan'}
            >
              {VIDEO_TOOL_ICONS[item]}
            </button>
          ))}
          <span className="tool-spacer" />
          <button className="tool danger" data-label="Supprimer" onClick={deleteSelected} disabled={!selected}>×</button>
        </aside>

        <section className={'video-center ' + (workspaceMode === 'capture' ? 'capture-mode' : '')}>
          <div ref={videoStageRef} className="video-stage">
            <div
              ref={videoFrameRef}
              className="video-frame"
              style={{
                aspectRatio: videoSize.width + ' / ' + videoSize.height,
                transform: 'translate3d(' + viewPan.x + 'px, ' + viewPan.y + 'px, 0) scale(' + viewZoom + ')',
              }}
            >
              <video
                ref={videoRef}
                src={playbackUrl}
                preload="metadata"
                onLoadedMetadata={handleLoadedMetadata}
                onError={() => setVideoError(hasCompatiblePreview ? 'L’aperçu converti reste illisible.' : 'Le codec de ce MP4 ne peut pas être lu directement.')}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
              {workspaceMode === 'step' && selectedDecodedFrame && (
                <img
                  className="video-step-preview"
                  src={selectedDecodedFrame.thumbnailUrl}
                  alt={'Frame source #' + (selectedDecodedFrame.index + 1)}
                  draggable={false}
                  onLoad={(event) => setVideoSize({ width: event.currentTarget.naturalWidth || 16, height: event.currentTarget.naturalHeight || 9 })}
                />
              )}
              <canvas
                ref={overlayRef}
                className={'video-overlay video-cursor-' + (isViewPanning ? 'panning' : tool)}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onContextMenu={(event) => event.preventDefault()}
              />
            </div>
            {videoError && !(workspaceMode === 'step' && selectedDecodedFrame) ? (
              <div className="video-loading video-load-error" role="alert">
                <strong>{videoError}</strong>
                {isPreparingPreview ? (
                  <>
                    <span>{previewStatus}</span>
                    <div className="video-preview-progress"><progress max="100" value={previewProgress} /><b>{previewProgress}%</b></div>
                    <button className="button ghost compact" onClick={cancelCompatiblePreview}>Annuler</button>
                  </>
                ) : !hasCompatiblePreview ? (
                  <>
                    <span>CyAnnota peut créer localement une copie de lecture H.264. L’original Discord restera intact dans le projet.</span>
                    <button className="button primary compact" onClick={() => createCompatiblePreview().catch(() => undefined)}>Créer un aperçu compatible</button>
                  </>
                ) : (
                  <span>La conversion a réussi, mais Chromium ne parvient toujours pas à afficher la vidéo.</span>
                )}
              </div>
            ) : (
              !duration && !(workspaceMode === 'step' && selectedDecodedFrame) && <div className="video-loading">Préparation de la vidéo…</div>
            )}
          </div>

          <div className="video-transport">
            <button onClick={() => seek(currentTime - 1)} aria-label="Reculer d’une seconde">−1s</button>
            <button className="video-play" onClick={togglePlayback} aria-label={isPlaying ? 'Pause' : 'Lire'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
            <button onClick={() => seek(currentTime + 1)} aria-label="Avancer d’une seconde">+1s</button>
            <strong>{formatTime(currentTime, true)}</strong>
            <span>/ {formatTime(duration, true)}</span>
            <input
              aria-label="Position de lecture"
              type="range"
              min="0"
              max={Math.max(duration, 0.01)}
              step="0.01"
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </div>

          {workspaceMode === 'timeline' && <div className="video-timeline-panel">
            <div className="video-timeline-heading">
              <div><span>TIMELINE</span><strong>{annotations.length} correction{annotations.length === 1 ? '' : 's'} · {frameStops.length} arrêt{frameStops.length === 1 ? '' : 's'} image</strong></div>
              <label>Zoom <input type="range" min="1" max="5" step="0.25" value={timelineZoom} onChange={(event) => setTimelineZoom(Number(event.target.value))} /></label>
            </div>
            <div className="video-timeline-scroll">
              <div className="video-timeline" style={{ width: timelineZoom * 100 + '%' }} onPointerDown={timelineSeek}>
                <div className="video-time-ruler">
                  {Array.from({ length: 11 }, (_, index) => (
                    <span key={index} style={{ left: index * 10 + '%' }}>{formatTime((duration * index) / 10)}</span>
                  ))}
                </div>
                <div className="video-tracks">
                  {annotations.map((annotation, index) => (
                    <button
                      key={annotation.id}
                      className={'video-clip ' + (annotation.id === selectedId ? 'selected' : '')}
                      style={{
                        left: duration ? (annotation.start / duration) * 100 + '%' : '0%',
                        width: duration ? Math.max(0.6, ((annotation.end - annotation.start) / duration) * 100) + '%' : '1%',
                        top: (index % 3) * 25 + 3,
                        background: annotation.color,
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => { setSelectedId(annotation.id); seek(annotation.start); }}
                      title={formatTime(annotation.start, true) + ' — ' + annotation.message}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </button>
                  ))}
                  {frameStops.map((stop, index) => (
                    <button
                      key={stop.id}
                      className={'video-frame-stop ' + (stop.id === selectedFrameStopId ? 'selected' : '')}
                      data-label={'F' + String(index + 1).padStart(2, '0')}
                      style={{ left: duration ? (stop.time / duration) * 100 + '%' : '0%' }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => selectFrameStop(stop)}
                      title={'Frame ' + String(index + 1).padStart(2, '0') + ' — ' + formatTime(stop.time, true)}
                      aria-label={'Aller à la frame ' + String(index + 1).padStart(2, '0') + ' à ' + formatTime(stop.time, true)}
                    />
                  ))}
                  <i className="video-playhead" style={{ left: duration ? (currentTime / duration) * 100 + '%' : '0%' }} />
                </div>
              </div>
            </div>
          </div>}
          {workspaceMode === 'step' && (
            <div className="video-filmstrip-panel">
              <div className="video-filmstrip-heading">
                <div>
                  <span>PELLICULE · FRAMES RÉELLES</span>
                  <strong>{decodedFrames.length ? decodedFrames.length + ' images décodées' : filmstripStatus}</strong>
                </div>
                {isBuildingFilmstrip && <div className="video-filmstrip-progress"><progress max="100" value={filmstripProgress} /><b>{filmstripProgress}%</b></div>}
                {!isBuildingFilmstrip && decodedFrames.length > 0 && <small>{filmstripStatus}</small>}
              </div>
              <div ref={filmstripScrollRef} className="video-filmstrip-scroll">
                {decodedFrames.map((frame) => {
                  const isStopped = stoppedFrameIndexes.has(frame.index);
                  return (
                    <button
                      key={frame.index}
                      data-frame-index={frame.index}
                      className={'video-filmstrip-frame ' + (frame.index === selectedDecodedFrameIndex ? 'selected ' : '') + (isStopped ? 'stopped' : '')}
                      onClick={() => selectDecodedFrame(frame)}
                      onDoubleClick={() => { selectDecodedFrame(frame); if (!isStopped) addFrameStop(frame).catch(() => undefined); }}
                      title={'Frame source #' + (frame.index + 1) + ' · ' + formatTime(frame.time, true)}
                      aria-pressed={isStopped}
                    >
                      <img src={frame.thumbnailUrl} alt="" draggable={false} loading="lazy" />
                      <span><b>#{String(frame.index + 1).padStart(5, '0')}</b><small>{formatTime(frame.time, true)}</small></span>
                      {isStopped && <i>✓</i>}
                    </button>
                  );
                })}
                {!decodedFrames.length && !isBuildingFilmstrip && (
                  <button className="video-filmstrip-empty" onClick={() => buildFilmstrip().catch(() => undefined)}>
                    <strong>Créer la pellicule image par image</strong>
                    <span>FFmpeg décodera localement chaque frame de la vidéo. Aucune cadence fixe n’est supposée.</span>
                  </button>
                )}
                {isBuildingFilmstrip && <div className="video-filmstrip-empty"><strong>{filmstripStatus}</strong><span>La durée dépend du nombre réel d’images.</span></div>}
              </div>
            </div>
          )}        </section>

        <aside className="video-inspector">
          {workspaceMode === 'capture' && (
            <section className="video-capture-panel">
              <p className="eyebrow">CAPTURE À UN INSTANT</p>
              <strong>{formatTime(currentTime, true)}</strong>
              <span>La frame sera ouverte comme un nouvel onglet image avec tous les outils de découpe, formes, pipette et annotations.</span>
              <button className="button primary" onClick={() => captureCurrentFrame().catch((error) => window.alert(error instanceof Error ? error.message : String(error)))} disabled={!duration || Boolean(videoError)}>Créer l’onglet image</button>
            </section>
          )}
          {workspaceMode === 'step' && (
            <section className="video-frame-stops-panel">
              <div className="video-frame-stops-heading">
                <div><p className="eyebrow">STEP FRAME EXACT</p><strong>{frameStops.length} image{frameStops.length === 1 ? '' : 's'} sélectionnée{frameStops.length === 1 ? '' : 's'}</strong></div>
              </div>
              <span>Choisis une vignette dans la pellicule. CyAnnota exporte ensuite cette frame source exacte en PNG pleine résolution dans <b>frames</b>.</span>
              {!decodedFrames.length && !isBuildingFilmstrip && (
                <button className="button primary compact" onClick={() => buildFilmstrip().catch(() => undefined)}>Créer la pellicule complète</button>
              )}
              {isBuildingFilmstrip && (
                <div className="video-step-build-status"><progress max="100" value={filmstripProgress} /><span>{filmstripStatus}</span></div>
              )}
              {selectedDecodedFrame && (
                <div className="video-selected-source-frame">
                  <img src={selectedDecodedFrame.thumbnailUrl} alt="" />
                  <div><strong>Frame source #{selectedDecodedFrame.index + 1}</strong><span>{formatTime(selectedDecodedFrame.time, true)}</span></div>
                  <button className={selectedDecodedFrameStop ? 'button ghost compact danger' : 'button primary compact'} onClick={toggleSelectedDecodedFrameStop} disabled={isExtractingFrame || isBuildingFilmstrip}>
                    {isExtractingFrame ? 'Extraction PNG…' : selectedDecodedFrameStop ? 'Retirer' : 'Ajouter cette frame'}
                  </button>
                </div>
              )}
              <div className="video-frame-stop-list">
                {frameStops.map((stop, index) => (
                  <div key={stop.id} className={'video-frame-stop-row ' + (stop.id === selectedFrameStopId ? 'selected' : '')}>
                    <button onClick={() => selectFrameStop(stop)}>
                      <span>{stop.frameIndex === undefined ? 'F' + String(index + 1).padStart(2, '0') : '#' + String(stop.frameIndex + 1).padStart(5, '0')}</span>
                      <strong>{formatTime(stop.time, true)}</strong>
                    </button>
                    <button className="video-frame-stop-delete" onClick={() => removeFrameStop(stop.id)} aria-label={'Supprimer la frame ' + String(index + 1).padStart(2, '0')}>×</button>
                  </div>
                ))}
                {!frameStops.length && <p className="video-empty">Aucune frame sélectionnée. Un clic choisit une image ; “Ajouter cette frame” l’inclut dans l’export.</p>}
              </div>
            </section>
          )}          <section className="video-general">
            <p className="eyebrow">MESSAGE DE LA VIDÉO</p>
            <textarea value={generalInstructions} onChange={(event) => setGeneralInstructions(event.target.value)} placeholder="Contexte général pour toutes les corrections…" />
          </section>
          <section className="video-corrections">
            <div className="video-corrections-heading"><div><p className="eyebrow">ANNOTATIONS</p><h2>Corrections <span>{annotations.length}</span></h2></div></div>
            <div className="video-correction-list">
              {annotations.map((annotation, index) => (
                <button
                  key={annotation.id}
                  className={'video-correction-card ' + (annotation.id === selectedId ? 'selected' : '')}
                  onClick={() => { setSelectedId(annotation.id); seek(annotation.start); }}
                >
                  <span style={{ background: annotation.color }}>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{VIDEO_TOOL_LABELS[annotation.type]}</strong><small>{formatTime(annotation.start, true)} → {formatTime(annotation.end, true)}</small><em>{annotation.message}</em></div>
                </button>
              ))}
              {!annotations.length && <p className="video-empty">Choisis un outil puis dessine directement sur la vidéo. La correction sera ajoutée à la timeline.</p>}
            </div>
          </section>

          {selected && (
            <section className="video-editor">
              <div className="video-editor-heading"><div><p className="eyebrow">CORRECTION</p><h3>{VIDEO_TOOL_LABELS[selected.type]}</h3></div><button onClick={() => setSelectedId(null)}>×</button></div>
              <div className="video-time-fields">
                <label><span>Début</span><input type="number" min="0" max={selected.end} step="0.01" value={selected.start.toFixed(2)} onChange={(event) => updateSelected({ start: Math.max(0, Math.min(Number(event.target.value), selected.end - 0.01)) })} /></label>
                <label><span>Fin</span><input type="number" min={selected.start} max={duration} step="0.01" value={selected.end.toFixed(2)} onChange={(event) => updateSelected({ end: Math.max(selected.start + 0.01, Math.min(duration, Number(event.target.value))) })} /></label>
              </div>
              <label className="video-color-field"><span>Couleur</span><input type="color" value={selected.color} onChange={(event) => updateSelected({ color: event.target.value })} /></label>
              <label className="message-field"><span>Message lié à cette séquence</span><textarea value={selected.message} onChange={(event) => updateSelected({ message: event.target.value })} /></label>
              {selected.snapshot && <img className="video-snapshot" src={selected.snapshot} alt="Capture de la correction" />}
              <button className="delete-button" onClick={deleteSelected}>Supprimer cette correction</button>
            </section>
          )}
          <footer className="video-status">{saveStatus}</footer>
        </aside>
      </section>

      {compressionOpen && (
        <div className="modal-backdrop">
          <section className="video-compression-modal">
            <header className="modal-header">
              <div><p className="eyebrow">COMPRESSION LOCALE</p><h2>Réduire la vidéo</h2><p>Tout le traitement reste dans ce navigateur. La vidéo originale n’est jamais modifiée.</p></div>
              <button className="modal-close" onClick={() => !isCompressing && setCompressionOpen(false)} disabled={isCompressing}>×</button>
            </header>
            <div className="video-source-summary"><div><span>Source</span><strong>{file.name}</strong></div><div><span>Taille</span><strong>{(file.size / 1024 / 1024).toFixed(1)} Mo</strong></div><div><span>Durée</span><strong>{formatTime(duration)}</strong></div></div>
            <div className="video-quality-options">
              {([
                ['high', 'Haute qualité', 'Image très proche de l’original, fichier plus lourd.'],
                ['balanced', 'Équilibré', 'Bon compromis pour partager une capture d’interface.'],
                ['light', 'Fichier léger', 'Réduit aussi la définition à 1280 px maximum.'],
              ] as const).map(([value, label, help]) => (
                <label key={value} className={compressionQuality === value ? 'selected' : ''}><input type="radio" name="video-quality" value={value} checked={compressionQuality === value} onChange={() => setCompressionQuality(value)} disabled={isCompressing} /><div><strong>{label}</strong><span>{help}</span></div></label>
              ))}
            </div>
            <div className="video-compression-progress"><div><span>{compressionStatus}</span><strong>{compressionProgress}%</strong></div><progress max="100" value={compressionProgress} /></div>
            <footer className="modal-actions">
              {isCompressing ? <button className="button ghost" onClick={cancelCompression}>Annuler la compression</button> : <button className="button ghost" onClick={() => setCompressionOpen(false)}>Fermer</button>}
              <button className="button primary large" onClick={() => compressVideo().catch(() => undefined)} disabled={isCompressing}>{isCompressing ? 'Compression en cours…' : 'Compresser et enregistrer'}</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
