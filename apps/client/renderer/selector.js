"use strict";

const api = window.cytaskDesktop;
const translations = {
  en: {
    pageTitle: "CyTask — Choose a workspace",
    desktopClient: "DESKTOP CLIENT",
    heroTitle: "Your projects, with a team or entirely local.",
    heroCopy: "Open a CyTask server or work from a simple folder. That folder can then be shared through Syncthing or the CyRevision Sync engine.",
    availableFeatures: "Available features",
    featureLocal: "Local folder, with no server to administer",
    featureSnapshots: "Immutable snapshots compatible with Syncthing",
    featureServer: "Team server for Windows, Linux and macOS",
    opening: "OPEN",
    chooseWorkspace: "Choose a workspace",
    chooseCopy: "Use local mode for personal projects, or a server for a centralized team.",
    language: "Language",
    recentWorkspaces: "Recent workspaces",
    connectionType: "Connection type",
    localFolder: "Local folder",
    teamServer: "Team server",
    projectName: "Project name",
    projectPlaceholder: "My project",
    dataFolder: "Data folder",
    chooseFolderPlaceholder: "Choose a folder…",
    browse: "Browse",
    readyToSync: "Ready to sync",
    syncNote: "CyTask creates verified snapshots in .cytask. Simply add this folder to Syncthing; the active database and sessions are never synchronized.",
    openLocally: "Open locally",
    serverName: "Server name",
    serverPlaceholder: "Main studio",
    serverAddress: "IP address or domain",
    unencryptedHttp: "Unencrypted HTTP connection",
    trustedNetworkOnly: "only on a trusted machine or local network.",
    signIn: "Sign in",
    securityNote: "Sessions, tokens and secrets remain on this computer.",
    startingLocal: "Starting locally…",
    connecting: "Connecting…",
    openingWorkspace: "Opening…",
    neverOpened: "Never opened",
    unknownDate: "Unknown date",
    opened: "Opened {value}",
    localSyncCompatible: "Local · Sync compatible",
    localHttp: "Local HTTP",
    open: "Open",
    edit: "Edit",
    editNamed: "Edit {name}",
    removeFromList: "Remove from list",
    removeNamed: "Remove {name}",
    deleteFailed: "Unable to remove this workspace.",
    connectionFailed: "Unable to connect.",
    localOpenFailed: "Unable to open the local workspace.",
    folderUnavailable: "Folder unavailable.",
    chooseDataFolder: "Choose the CyTask data folder.",
    enterServerAddress: "Enter the CyTask server address.",
    initializationFailed: "Unable to initialize the desktop client."
  },
  fr: {
    pageTitle: "CyTask — Choisir un espace",
    desktopClient: "CLIENT DESKTOP",
    heroTitle: "Tes projets, en équipe ou entièrement en local.",
    heroCopy: "Ouvre un serveur CyTask ou travaille dans un simple dossier. Ce dossier peut ensuite être partagé par Syncthing ou par le moteur Sync de CyRevision.",
    availableFeatures: "Fonctions disponibles",
    featureLocal: "Dossier local, sans serveur à administrer",
    featureSnapshots: "Snapshots immuables compatibles Syncthing",
    featureServer: "Serveur d’équipe Windows, Linux et macOS",
    opening: "OUVERTURE",
    chooseWorkspace: "Choisir un espace",
    chooseCopy: "Local pour tes projets personnels, serveur pour une équipe centralisée.",
    language: "Langue",
    recentWorkspaces: "Espaces récents",
    connectionType: "Type de connexion",
    localFolder: "Dossier local",
    teamServer: "Serveur équipe",
    projectName: "Nom du projet",
    projectPlaceholder: "Mon projet",
    dataFolder: "Dossier de données",
    chooseFolderPlaceholder: "Choisir un dossier…",
    browse: "Parcourir",
    readyToSync: "Prêt pour la synchronisation",
    syncNote: "CyTask crée des snapshots vérifiés dans .cytask. Ajoute simplement ce dossier à Syncthing ; la base active et les sessions ne sont jamais synchronisées.",
    openLocally: "Ouvrir en local",
    serverName: "Nom du serveur",
    serverPlaceholder: "Studio principal",
    serverAddress: "Adresse IP ou domaine",
    unencryptedHttp: "Connexion HTTP non chiffrée",
    trustedNetworkOnly: "uniquement sur une machine ou un réseau local de confiance.",
    signIn: "Se connecter",
    securityNote: "Les sessions, jetons et secrets restent propres à cet ordinateur.",
    startingLocal: "Démarrage local…",
    connecting: "Connexion…",
    openingWorkspace: "Ouverture…",
    neverOpened: "Jamais ouvert",
    unknownDate: "Date inconnue",
    opened: "Ouvert {value}",
    localSyncCompatible: "Local · compatible Sync",
    localHttp: "HTTP local",
    open: "Ouvrir",
    edit: "Modifier",
    editNamed: "Modifier {name}",
    removeFromList: "Retirer de la liste",
    removeNamed: "Retirer {name}",
    deleteFailed: "Suppression impossible.",
    connectionFailed: "Connexion impossible.",
    localOpenFailed: "Ouverture locale impossible.",
    folderUnavailable: "Dossier inaccessible.",
    chooseDataFolder: "Choisissez le dossier de données CyTask.",
    enterServerAddress: "Saisissez l’adresse du serveur CyTask.",
    initializationFailed: "Initialisation impossible."
  }
};

let locale = localStorage.getItem("cytask.desktop.locale") === "fr" ? "fr" : "en";
const localForm = document.getElementById("local-form");
const serverForm = document.getElementById("server-form");
const localTab = document.getElementById("local-tab");
const serverTab = document.getElementById("server-tab");
const localIdInput = document.getElementById("local-id");
const localNameInput = document.getElementById("local-name");
const localPathInput = document.getElementById("local-path");
const chooseFolderButton = document.getElementById("choose-folder");
const openLocalButton = document.getElementById("open-local-button");
const idInput = document.getElementById("server-id");
const nameInput = document.getElementById("server-name");
const urlInput = document.getElementById("server-url");
const allowHttpInput = document.getElementById("allow-http");
const httpWarning = document.getElementById("http-warning");
const errorBox = document.getElementById("form-error");
const connectButton = document.getElementById("connect-button");
const savedSection = document.getElementById("saved-section");
const serverList = document.getElementById("server-list");
const serverCount = document.getElementById("server-count");
const version = document.getElementById("version");
let profiles = [];

function tr(key, variables = {}) {
  let value = translations[locale][key] ?? translations.en[key] ?? key;
  for (const [name, replacement] of Object.entries(variables)) {
    value = value.replaceAll("{" + name + "}", String(replacement));
  }
  return value;
}

function applyLocale(nextLocale, notifyMain = true) {
  locale = nextLocale === "fr" ? "fr" : "en";
  localStorage.setItem("cytask.desktop.locale", locale);
  document.documentElement.lang = locale;
  document.title = tr("pageTitle");
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = tr(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = tr(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", tr(element.dataset.i18nAria));
  });
  document.querySelectorAll("[data-locale]").forEach((button) => {
    const active = button.dataset.locale === locale;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderProfiles();
  if (notifyMain && typeof api.setLocale === "function") void api.setLocale(locale);
}

function setMode(mode) {
  const local = mode === "local";
  localForm.hidden = !local;
  serverForm.hidden = local;
  localTab.classList.toggle("active", local);
  serverTab.classList.toggle("active", !local);
  localTab.setAttribute("aria-selected", String(local));
  serverTab.setAttribute("aria-selected", String(!local));
  showError("");
}

function isHttp(value) {
  const trimmed = value.trim();
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^http:\/\//i.test(trimmed);
}
function updateTransportWarning() {
  const visible = isHttp(urlInput.value);
  httpWarning.hidden = !visible;
  if (!visible) allowHttpInput.checked = false;
}
function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}
function setPending(pending, local = false) {
  const button = local ? openLocalButton : connectButton;
  button.disabled = pending;
  button.firstElementChild.textContent = pending
    ? tr(local ? "startingLocal" : "connecting")
    : tr(local ? "openLocally" : "signIn");
  localForm.querySelectorAll("input, button").forEach((item) => { item.disabled = pending; });
  serverForm.querySelectorAll("input, button").forEach((item) => { item.disabled = pending; });
}
function formatLastUse(value) {
  if (!value) return tr("neverOpened");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tr("unknownDate");
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    .format(Math.round((date.getTime() - Date.now()) / 86_400_000), "day");
  return tr("opened", { value: relative });
}

function renderProfiles() {
  savedSection.hidden = profiles.length === 0;
  serverCount.textContent = String(profiles.length);
  serverList.replaceChildren();
  for (const profile of profiles) {
    const card = document.createElement("article");
    card.className = "server-card " + (profile.type === "local" ? "local-card" : "");
    const mark = document.createElement("span");
    mark.className = "server-mark";
    mark.textContent = profile.type === "local" ? "LO" : profile.name.slice(0, 2).toUpperCase();
    const copy = document.createElement("div");
    copy.className = "server-copy";
    const title = document.createElement("strong");
    title.textContent = profile.name;
    const address = document.createElement("span");
    address.textContent = profile.type === "local" ? profile.folderPath : profile.url;
    const meta = document.createElement("small");
    const transport = profile.type === "local"
      ? tr("localSyncCompatible")
      : (profile.insecure ? tr("localHttp") : "HTTPS");
    meta.textContent = transport + " · " + formatLastUse(profile.lastUsedAt);
    copy.append(title, address, meta);

    const actions = document.createElement("div");
    actions.className = "server-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "open-server";
    open.textContent = tr("open");
    open.addEventListener("click", () => profile.type === "local" ? openLocal(profile) : connect(profile));
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-button";
    edit.title = tr("edit");
    edit.setAttribute("aria-label", tr("editNamed", { name: profile.name }));
    edit.textContent = "✎";
    edit.addEventListener("click", () => {
      if (profile.type === "local") {
        setMode("local");
        localIdInput.value = profile.id;
        localNameInput.value = profile.name;
        localPathInput.value = profile.folderPath;
        localNameInput.focus();
      } else {
        setMode("server");
        idInput.value = profile.id;
        nameInput.value = profile.name;
        urlInput.value = profile.url;
        allowHttpInput.checked = profile.insecure;
        updateTransportWarning();
        nameInput.focus();
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button danger";
    remove.title = tr("removeFromList");
    remove.setAttribute("aria-label", tr("removeNamed", { name: profile.name }));
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      try { profiles = await api.removeServer(profile.id); renderProfiles(); }
      catch (error) { showError(error instanceof Error ? error.message : tr("deleteFailed")); }
    });
    actions.append(open, edit, remove);
    card.append(mark, copy, actions);
    serverList.append(card);
  }
}

async function connect(profile) {
  showError("");
  setPending(true, false);
  try {
    await api.connectServer({ ...profile, allowInsecure: profile.insecure ?? allowHttpInput.checked });
    connectButton.firstElementChild.textContent = tr("openingWorkspace");
  } catch (error) {
    showError(error instanceof Error ? error.message : tr("connectionFailed"));
    setPending(false, false);
  }
}
async function openLocal(profile) {
  showError("");
  setPending(true, true);
  try {
    await api.openLocal(profile);
    openLocalButton.firstElementChild.textContent = tr("openingWorkspace");
  } catch (error) {
    showError(error instanceof Error ? error.message : tr("localOpenFailed"));
    setPending(false, true);
  }
}

document.querySelectorAll("[data-locale]").forEach((button) => {
  button.addEventListener("click", () => applyLocale(button.dataset.locale));
});
localTab.addEventListener("click", () => setMode("local"));
serverTab.addEventListener("click", () => setMode("server"));
chooseFolderButton.addEventListener("click", async () => {
  try {
    const result = await api.chooseLocalFolder();
    if (result.canceled) return;
    localPathInput.value = result.folderPath;
    if (!localNameInput.value.trim()) localNameInput.value = result.suggestedName;
    showError("");
  } catch (error) { showError(error instanceof Error ? error.message : tr("folderUnavailable")); }
});
localForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!localPathInput.value) { showError(tr("chooseDataFolder")); return; }
  void openLocal({ id: localIdInput.value || undefined, name: localNameInput.value.trim(), folderPath: localPathInput.value });
});
serverForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url) { showError(tr("enterServerAddress")); urlInput.focus(); return; }
  void connect({ id: idInput.value || undefined, name: nameInput.value.trim(), url, allowInsecure: allowHttpInput.checked });
});
urlInput.addEventListener("input", updateTransportWarning);
api.onConnectionError((message) => { showError(message); setPending(false, false); setPending(false, true); });

applyLocale(locale);
void api.listServers().then((result) => {
  profiles = result.servers;
  version.textContent = result.version;
  renderProfiles();
  updateTransportWarning();
}).catch((error) => showError(error instanceof Error ? error.message : tr("initializationFailed")));
