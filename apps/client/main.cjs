"use strict";

const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  Menu,
  ipcMain,
  net,
  protocol,
  session,
  shell
} = require("electron");
const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fsSync = require("node:fs");
const { promises: fs } = fsSync;
const nodeNet = require("node:net");
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
let localServerProcess = null;
let localServerStopping = false;
let localServerError = "";
let localServerStopPromise = null;
let quittingAfterLocalStop = false;
let interfaceLocale = "en";

function nativeText(english, french) {
  return interfaceLocale === "fr" ? french : english;
}

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

function localSessionStoragePath(profile) {
  return path.join(app.getPath("userData"), "local-sessions", profile.id + ".json");
}

function normalizeServerUrl(value) {
  if (typeof value !== "string") throw new Error(nativeText("The server address is required.", "L’adresse du serveur est obligatoire."));
  let candidate = value.trim();
  if (!candidate || candidate.length > 2048) throw new Error(nativeText("The server address is invalid.", "L’adresse du serveur est invalide."));
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `http://${candidate}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(nativeText("Use an address such as https://cytask.example.com or 192.168.1.20:8080.", "Utilisez une adresse comme https://cytask.exemple.fr ou 192.168.1.20:8080."));
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(nativeText("Only HTTP(S) addresses without embedded credentials are accepted.", "Seules les adresses HTTP(S) sans identifiants sont acceptées."));
  }
  if (!parsed.hostname || parsed.search || parsed.hash) {
    throw new Error(nativeText("The address must not contain query parameters or a fragment.", "L’adresse ne doit pas contenir de paramètres ni de fragment."));
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

function normalizeLocalPath(value) {
  if (typeof value !== "string" || value.includes("\0")) throw new Error(nativeText("The local folder is invalid.", "Le dossier local est invalide."));
  const fullPath = path.resolve(value.trim());
  if (!path.isAbsolute(fullPath) || fullPath === path.parse(fullPath).root) {
    throw new Error(nativeText("Choose a project folder, not the root of a drive.", "Choisissez un dossier de projet, pas la racine d’un disque."));
  }
  return fullPath;
}

function normalizeStoredProfile(value) {
  if (!value || typeof value !== "object" || !SERVER_ID.test(String(value.id ?? ""))) return null;
  if (value.type === "local") {
    try {
      const folderPath = normalizeLocalPath(value.folderPath);
      return {
        id: String(value.id), type: "local",
        name: safeName(value.name, path.basename(folderPath)), folderPath, syncMode: "folder",
        createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
        lastUsedAt: typeof value.lastUsedAt === "string" ? value.lastUsedAt : null
      };
    } catch { return null; }
  }
  try {
    const normalized = normalizeServerUrl(value.url);
    return {
      id: String(value.id), type: "remote",
      name: safeName(value.name, normalized.suggestedName),
      url: normalized.url, insecure: normalized.insecure,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      lastUsedAt: typeof value.lastUsedAt === "string" ? value.lastUsedAt : null
    };
  } catch { return null; }
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

function deviceIdentityPath() {
  return path.join(app.getPath("userData"), "device.json");
}

async function getOrCreateDeviceId() {
  try {
    const value = JSON.parse(await fs.readFile(deviceIdentityPath(), "utf8"));
    if (SERVER_ID.test(String(value.deviceId ?? ""))) return String(value.deviceId);
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(nativeText("The local CyTask identity cannot be read.", "L’identité locale CyTask est illisible."));
  }
  const deviceId = randomUUID();
  await fs.mkdir(path.dirname(deviceIdentityPath()), { recursive: true });
  await fs.writeFile(deviceIdentityPath(), `${JSON.stringify({ deviceId }, null, 2)}\n`, {
    encoding: "utf8", mode: 0o600
  });
  return deviceId;
}

function runtimeIdentifier() {
  const architecture = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `win-${architecture}`;
  if (process.platform === "darwin") return `osx-${architecture}`;
  return `linux-${architecture}`;
}

function localServerExecutable() {
  const name = process.platform === "win32" ? "CyTask.Api.exe" : "CyTask.Api";
  return app.isPackaged
    ? path.join(process.resourcesPath, "server", name)
    : path.join(__dirname, "server", "current", name);
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = nodeNet.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function stopLocalServer() {
  if (localServerStopPromise) return localServerStopPromise;
  const child = localServerProcess;
  if (!child) return;
  localServerStopping = true;
  localServerStopPromise = (async () => {
    // Laisse au cycle de snapshot (1 s) le temps de rendre la dernière mutation durable.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    if (child.exitCode === null && !child.killed) child.kill();
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2_000))
      ]);
    }
    if (localServerProcess === child) localServerProcess = null;
    localServerStopping = false;
    localServerStopPromise = null;
  })();
  return localServerStopPromise;
}

async function startLocalServer(profile) {
  await stopLocalServer();
  const executable = localServerExecutable();
  if (!fsSync.existsSync(executable)) {
    throw new Error(nativeText(`The CyTask local engine is not installed (${runtimeIdentifier()}). Package the client again.`, `Le moteur local CyTask n’est pas installé (${runtimeIdentifier()}). Relancez le packaging du client.`));
  }
  const folderPath = normalizeLocalPath(profile.folderPath);
  await fs.mkdir(folderPath, { recursive: true });
  const port = await findAvailablePort();
  const url = `http://127.0.0.1:${port}`;
  const deviceId = await getOrCreateDeviceId();
  localServerError = "";
  localServerStopping = false;
  const child = spawn(executable, [], {
    cwd: path.dirname(executable), windowsHide: true,
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: "Production",
      ASPNETCORE_URLS: url,
      CyTask__UseInMemoryStore: "true",
      CyTask__LocalMode: "true",
      CyTask__LocalWorkspacePath: folderPath,
      CyTask__LocalDeviceId: deviceId,
      CyTask__LocalSyncSeconds: "1",
      CyTask__LocalSessionStoragePath: localSessionStoragePath(profile),
      CyTask__MediaStoragePath: path.join(folderPath, ".cytask", "media")
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  localServerProcess = child;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    localServerError = `${localServerError}${chunk}`.slice(-4000);
  });
  child.once("exit", (code) => {
    if (localServerProcess === child) localServerProcess = null;
    if (!localServerStopping && currentProfile?.id === profile.id) {
      setImmediate(() => showSelector(interfaceLocale === "fr" ? `Le moteur local CyTask s’est arrêté (${code ?? "inconnu"}).` : `The CyTask local engine stopped (${code ?? "unknown"}).`));
    }
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try { await checkServer(url); return url; } catch { /* Le serveur démarre encore. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  await stopLocalServer();
  const detail = localServerError.split(/\r?\n/).filter(Boolean).at(-1);
  throw new Error(detail ? nativeText(`The local engine did not start: ${detail}`, `Le moteur local n’a pas démarré : ${detail}`) : nativeText("The CyTask local engine did not start.", "Le moteur local CyTask n’a pas démarré."));
}
function assertSelectorSender(event) {
  if (!selectorWindow || event.sender.id !== selectorWindow.webContents.id) {
    throw new Error(nativeText("Desktop request denied.", "Requête desktop refusée."));
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
    if (!response.ok) throw new Error(nativeText(`The server responded with status ${response.status}.`, `Le serveur a répondu ${response.status}.`));
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(nativeText("The server did not respond within the expected time.", "Le serveur ne répond pas dans le délai prévu."));
    throw new Error(error instanceof Error ? error.message : nativeText("The server is unreachable.", "Le serveur est inaccessible."));
  } finally {
    clearTimeout(timeout);
  }
}

function partitionFor(profile) {
  const identity = profile.type === "local" ? `local:${profile.folderPath}` : new URL(profile.url).origin;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
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
      label: nativeText("Workspace", "Espace"),
      submenu: [
        {
          label: currentProfile ? nativeText(`Open: ${currentProfile.name}`, `Ouvert : ${currentProfile.name}`) : nativeText("No workspace open", "Aucun espace ouvert"),
          enabled: false
        },
        {
          label: nativeText("Switch workspace…", "Changer de projet…"),
          accelerator: "CmdOrCtrl+Shift+S",
          enabled: isWorkspace,
          click: () => showSelector()
        },
        { type: "separator" },
        { role: "quit", label: nativeText("Quit CyTask", "Quitter CyTask") }
      ]
    },
    {
      label: nativeText("View", "Affichage"),
      submenu: [
        { role: "reload", label: nativeText("Reload", "Actualiser") },
        { role: "forceReload", label: nativeText("Force reload", "Actualiser complètement") },
        { type: "separator" },
        { role: "resetZoom", label: nativeText("Actual size", "Taille réelle") },
        { role: "zoomIn", label: nativeText("Zoom in", "Agrandir") },
        { role: "zoomOut", label: nativeText("Zoom out", "Réduire") },
        { type: "separator" },
        { role: "togglefullscreen", label: nativeText("Full screen", "Plein écran") },
        ...(!app.isPackaged ? [{ role: "toggleDevTools", label: nativeText("Developer tools", "Outils de développement") }] : [])
      ]
    },
    { role: "windowMenu", label: nativeText("Window", "Fenêtre") }
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
    title: nativeText("CyTask — Choose a workspace", "CyTask — Choisir un espace"),
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
  if (currentProfile?.type === "local") void stopLocalServer();
  pendingSelectorError = error;
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.destroy();
    workspaceWindow = null;
  }
  createSelectorWindow();
}

function openWorkspace(profile, runtimeUrl = profile.url) {
  currentProfile = profile;
  const trustedOrigin = new URL(runtimeUrl).origin;
  const targetSession = session.fromPartition(partitionFor(profile));
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
      partition: partitionFor(profile),
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
    showSelector(nativeText(`Connection failed: ${description} (${code}).`, `Connexion impossible : ${description} (${code}).`));
  });
  workspaceWindow.webContents.on("render-process-gone", (_event, details) => {
    showSelector(nativeText(`The CyTask client stopped (${details.reason}).`, `Le client CyTask s’est interrompu (${details.reason}).`));
  });
  workspaceWindow.on("closed", () => {
    if (currentProfile?.type === "local") void stopLocalServer();
    workspaceWindow = null;
    currentProfile = null;
    buildMenu();
  });
  void workspaceWindow.loadURL(runtimeUrl);
}

function registerIpc() {
  ipcMain.handle("cytask:set-locale", async (event, locale) => {
    assertSelectorSender(event);
    interfaceLocale = locale === "fr" ? "fr" : "en";
    selectorWindow?.setTitle(nativeText("CyTask — Choose a workspace", "CyTask — Choisir un espace"));
    buildMenu();
    return { locale: interfaceLocale };
  });
  ipcMain.handle("cytask:list-servers", async (event) => {
    assertSelectorSender(event);
    return { servers: await readProfiles(), version: app.getVersion() };
  });
  ipcMain.handle("cytask:remove-server", async (event, id) => {
    assertSelectorSender(event);
    if (typeof id !== "string" || !SERVER_ID.test(id)) throw new Error(nativeText("Invalid server profile.", "Serveur invalide."));
    const storedProfiles = await readProfiles();
    const removedProfile = storedProfiles.find((profile) => profile.id === id);
    const profiles = storedProfiles.filter((profile) => profile.id !== id);
    await writeProfiles(profiles);
    if (removedProfile) {
      await session.fromPartition(partitionFor(removedProfile)).clearStorageData({ storages: ["cookies"] });
      if (removedProfile.type === "local") {
        await fs.rm(localSessionStoragePath(removedProfile), { force: true });
      }
    }
    return profiles;
  });
  ipcMain.handle("cytask:choose-local-folder", async (event) => {
    assertSelectorSender(event);
    const result = await dialog.showOpenDialog(selectorWindow, {
      title: nativeText("Choose or create a CyTask folder", "Choisir ou créer un dossier CyTask"),
      buttonLabel: nativeText("Use this folder", "Utiliser ce dossier"),
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length !== 1) return { canceled: true };
    const folderPath = normalizeLocalPath(result.filePaths[0]);
    return { canceled: false, folderPath, suggestedName: path.basename(folderPath) };
  });
  ipcMain.handle("cytask:open-local", async (event, payload) => {
    assertSelectorSender(event);
    if (!payload || typeof payload !== "object") throw new Error(nativeText("Invalid local configuration.", "Configuration locale invalide."));
    const folderPath = normalizeLocalPath(payload.folderPath);
    const profiles = await readProfiles();
    const existingId = typeof payload.id === "string" && SERVER_ID.test(payload.id) ? payload.id : null;
    const existing = profiles.find((item) => item.type === "local" &&
      (item.id === existingId || item.folderPath.toLowerCase() === folderPath.toLowerCase()));
    const now = new Date().toISOString();
    const profile = {
      id: existing?.id ?? randomUUID(), type: "local",
      name: safeName(payload.name, existing?.name ?? path.basename(folderPath)),
      folderPath, syncMode: "folder",
      createdAt: existing?.createdAt ?? now, lastUsedAt: now
    };
    const runtimeUrl = await startLocalServer(profile);
    const updated = [profile, ...profiles.filter((item) => item.id !== profile.id)].slice(0, MAX_SERVERS);
    await writeProfiles(updated);
    setImmediate(() => openWorkspace(profile, runtimeUrl));
    return { ok: true, profile };
  });
  ipcMain.handle("cytask:connect-server", async (event, payload) => {
    assertSelectorSender(event);
    if (!payload || typeof payload !== "object") throw new Error(nativeText("Invalid configuration.", "Configuration invalide."));
    const normalized = normalizeServerUrl(payload.url);
    if (normalized.insecure && payload.allowInsecure !== true) {
      throw new Error(nativeText("Confirm the use of unencrypted HTTP for this local server.", "Confirmez l’utilisation de HTTP non chiffré pour ce serveur local."));
    }
    await stopLocalServer();
    await checkServer(normalized.url);

    const profiles = await readProfiles();
    const existingId = typeof payload.id === "string" && SERVER_ID.test(payload.id)
      ? payload.id
      : null;
    const existing = profiles.find((profile) => profile.id === existingId || profile.url === normalized.url);
    const now = new Date().toISOString();
    const profile = {
      id: existing?.id ?? randomUUID(),
      type: "remote",
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
app.on("before-quit", (event) => {
  if (!localServerProcess || quittingAfterLocalStop) return;
  event.preventDefault();
  quittingAfterLocalStop = true;
  void stopLocalServer().finally(() => app.quit());
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});