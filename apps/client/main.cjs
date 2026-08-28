"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  net,
  protocol,
  session,
  shell
} = require("electron");
const { createHash, randomUUID } = require("node:crypto");
const { promises: fs } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_SCHEME = "cytask-client";
const MAX_SERVERS = 20;
const SERVER_ID = /^[a-f0-9-]{36}$/i;
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "notifications",
  "fullscreen",
  "display-capture",
  "clipboard-sanitized-write",
  "speaker-selection"
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      codeCache: true
    }
  }
]);
app.enableSandbox();

let selectorWindow = null;
let workspaceWindow = null;
let currentProfile = null;
let pendingSelectorError = "";

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const target = workspaceWindow ?? selectorWindow;
    if (!target) return;
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
  });
}

function rendererRoot() {
  return path.join(__dirname, "renderer");
}

function iconPath() {
  return path.join(__dirname, "build", "icon.png");
}

function profilesPath() {
  return path.join(app.getPath("userData"), "servers.json");
}

function normalizeServerUrl(value) {
  if (typeof value !== "string") throw new Error("L’adresse du serveur est obligatoire.");
  let candidate = value.trim();
  if (!candidate || candidate.length > 2048) throw new Error("L’adresse du serveur est invalide.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `http://${candidate}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Utilisez une adresse comme https://cytask.exemple.fr ou 192.168.1.20:8080.");
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Seules les adresses HTTP(S) sans identifiants sont acceptées.");
  }
  if (!parsed.hostname || parsed.search || parsed.hash) {
    throw new Error("L’adresse ne doit pas contenir de paramètres ni de fragment.");
  }
  return {
    url: parsed.origin,
    insecure: parsed.protocol === "http:",
    suggestedName: parsed.hostname
  };
}

function safeName(value, fallback) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return (text || fallback).slice(0, 80);
}

function normalizeStoredProfile(value) {
  if (!value || typeof value !== "object" || !SERVER_ID.test(String(value.id ?? ""))) return null;
  try {
    const normalized = normalizeServerUrl(value.url);
    return {
      id: String(value.id),
      name: safeName(value.name, normalized.suggestedName),
      url: normalized.url,
      insecure: normalized.insecure,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      lastUsedAt: typeof value.lastUsedAt === "string" ? value.lastUsedAt : null
    };
  } catch {
    return null;
  }
}

async function readProfiles() {
  try {
    const raw = await fs.readFile(profilesPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredProfile).filter(Boolean).slice(0, MAX_SERVERS);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    return [];
  }
}

async function writeProfiles(profiles) {
  await fs.mkdir(path.dirname(profilesPath()), { recursive: true });
  const safe = profiles.map(normalizeStoredProfile).filter(Boolean).slice(0, MAX_SERVERS);
  await fs.writeFile(profilesPath(), `${JSON.stringify(safe, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

function assertSelectorSender(event) {
  if (!selectorWindow || event.sender.id !== selectorWindow.webContents.id) {
    throw new Error("Requête desktop refusée.");
  }
}

async function checkServer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const endpoint = new URL("/health/ready", url);
    const response = await net.fetch(endpoint.toString(), {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Le serveur a répondu ${response.status}.`);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Le serveur ne répond pas dans le délai prévu.");
    throw new Error(error instanceof Error ? error.message : "Le serveur est inaccessible.");
  } finally {
    clearTimeout(timeout);
  }
}

function partitionFor(url) {
  const digest = createHash("sha256").update(new URL(url).origin).digest("hex").slice(0, 24);
  return `persist:cytask-${digest}`;
}

function requestOrigin(details, fallback = "") {
  const candidates = [
    details?.requestingUrl,
    details?.securityOrigin,
    details?.requestingOrigin,
    fallback
  ];
  for (const candidate of candidates) {
    try {
      return new URL(candidate).origin;
    } catch {
      // Continue with the next browser-provided value.
    }
  }
  return "";
}

function configureTrustedSession(targetSession, trustedOrigin) {
  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const origin = requestOrigin(details, requestingOrigin || webContents?.getURL());
    return origin === trustedOrigin && ALLOWED_PERMISSIONS.has(permission);
  });
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = requestOrigin(details, webContents.getURL());
    callback(origin === trustedOrigin && ALLOWED_PERMISSIONS.has(permission));
  });
  targetSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!request.userGesture || requestOrigin(request, request.frame?.url) !== trustedOrigin || !request.frame) {
      callback({});
      return;
    }

    try {
      const sourceId = workspaceWindow?.getMediaSourceId();
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 0, height: 0 }
      });
      const source = sources.find((candidate) => candidate.id === sourceId);
      if (!source) {
        callback({});
        return;
      }
      callback({ video: source });
    } catch {
      callback({});
    }
  }, { useSystemPicker: true });
}

function safeExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function installWorkspaceGuards(win, trustedOrigin) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const target = safeExternalUrl(url);
    if (target) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    let targetOrigin = "";
    try { targetOrigin = new URL(url).origin; } catch { /* Invalid navigation. */ }
    if (targetOrigin === trustedOrigin) return;
    event.preventDefault();
    const target = safeExternalUrl(url);
    if (target) void shell.openExternal(target);
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function buildMenu() {
  const isWorkspace = Boolean(workspaceWindow && !workspaceWindow.isDestroyed());
  const template = [];
  if (process.platform === "darwin") template.push({ role: "appMenu" });
  template.push(
    {
      label: "Serveur",
      submenu: [
        {
          label: currentProfile ? `Connecté à ${currentProfile.name}` : "Aucun serveur connecté",
          enabled: false
        },
        {
          label: "Changer de serveur…",
          accelerator: "CmdOrCtrl+Shift+S",
          enabled: isWorkspace,
          click: () => showSelector()
        },
        { type: "separator" },
        { role: "quit", label: "Quitter CyTask" }
      ]
    },
    {
      label: "Affichage",
      submenu: [
        { role: "reload", label: "Actualiser" },
        { role: "forceReload", label: "Actualiser complètement" },
        { type: "separator" },
        { role: "resetZoom", label: "Taille réelle" },
        { role: "zoomIn", label: "Agrandir" },
        { role: "zoomOut", label: "Réduire" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Plein écran" },
        ...(!app.isPackaged ? [{ role: "toggleDevTools", label: "Outils de développement" }] : [])
      ]
    },
    { role: "windowMenu", label: "Fenêtre" }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createSelectorWindow() {
  if (selectorWindow && !selectorWindow.isDestroyed()) {
    selectorWindow.show();
    selectorWindow.focus();
    return;
  }
  currentProfile = null;
  selectorWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 780,
    minHeight: 560,
    show: false,
    title: "CyTask — Connexion au serveur",
    backgroundColor: "#0d1219",
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });
  selectorWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  selectorWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://app/`)) event.preventDefault();
  });
  selectorWindow.once("ready-to-show", () => selectorWindow?.show());
  selectorWindow.webContents.on("did-finish-load", () => {
    if (pendingSelectorError) {
      selectorWindow?.webContents.send("cytask:connection-error", pendingSelectorError);
      pendingSelectorError = "";
    }
  });
  selectorWindow.on("closed", () => { selectorWindow = null; });
  void selectorWindow.loadURL(`${APP_SCHEME}://app/index.html`);
  buildMenu();
}

function showSelector(error = "") {
  pendingSelectorError = error;
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.destroy();
    workspaceWindow = null;
  }
  createSelectorWindow();
}

function openWorkspace(profile) {
  currentProfile = profile;
  const trustedOrigin = new URL(profile.url).origin;
  const targetSession = session.fromPartition(partitionFor(profile.url));
  configureTrustedSession(targetSession, trustedOrigin);

  workspaceWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: `CyTask — ${profile.name}`,
    backgroundColor: "#0d1219",
    icon: iconPath(),
    webPreferences: {
      partition: partitionFor(profile.url),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: true
    }
  });
  installWorkspaceGuards(workspaceWindow, trustedOrigin);
  workspaceWindow.webContents.once("did-finish-load", () => {
    workspaceWindow?.show();
    workspaceWindow?.focus();
    if (selectorWindow && !selectorWindow.isDestroyed()) selectorWindow.destroy();
    buildMenu();
  });
  workspaceWindow.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    showSelector(`Connexion impossible : ${description} (${code}).`);
  });
  workspaceWindow.webContents.on("render-process-gone", (_event, details) => {
    showSelector(`Le client CyTask s’est interrompu (${details.reason}).`);
  });
  workspaceWindow.on("closed", () => {
    workspaceWindow = null;
    currentProfile = null;
    buildMenu();
  });
  void workspaceWindow.loadURL(profile.url);
}

function registerIpc() {
  ipcMain.handle("cytask:list-servers", async (event) => {
    assertSelectorSender(event);
    return { servers: await readProfiles(), version: app.getVersion() };
  });
  ipcMain.handle("cytask:remove-server", async (event, id) => {
    assertSelectorSender(event);
    if (typeof id !== "string" || !SERVER_ID.test(id)) throw new Error("Serveur invalide.");
    const profiles = (await readProfiles()).filter((profile) => profile.id !== id);
    await writeProfiles(profiles);
    return profiles;
  });
  ipcMain.handle("cytask:connect-server", async (event, payload) => {
    assertSelectorSender(event);
    if (!payload || typeof payload !== "object") throw new Error("Configuration invalide.");
    const normalized = normalizeServerUrl(payload.url);
    if (normalized.insecure && payload.allowInsecure !== true) {
      throw new Error("Confirmez l’utilisation de HTTP non chiffré pour ce serveur local.");
    }
    await checkServer(normalized.url);

    const profiles = await readProfiles();
    const existingId = typeof payload.id === "string" && SERVER_ID.test(payload.id)
      ? payload.id
      : null;
    const existing = profiles.find((profile) => profile.id === existingId || profile.url === normalized.url);
    const now = new Date().toISOString();
    const profile = {
      id: existing?.id ?? randomUUID(),
      name: safeName(payload.name, existing?.name ?? normalized.suggestedName),
      url: normalized.url,
      insecure: normalized.insecure,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: now
    };
    const updated = [profile, ...profiles.filter((item) => item.id !== profile.id)].slice(0, MAX_SERVERS);
    await writeProfiles(updated);
    setImmediate(() => openWorkspace(profile));
    return { ok: true, profile };
  });
}

app.whenReady().then(async () => {
  await protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app") return new Response("Not found", { status: 404 });
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const root = rendererRoot();
    const file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
  registerIpc();
  createSelectorWindow();
});

app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) createSelectorWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});