"use strict";

const api = window.cytaskDesktop;
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
    ? (local ? "Démarrage local…" : "Connexion…")
    : (local ? "Ouvrir en local" : "Se connecter");
  localForm.querySelectorAll("input, button").forEach((item) => { item.disabled = pending; });
  serverForm.querySelectorAll("input, button").forEach((item) => { item.disabled = pending; });
}
function formatLastUse(value) {
  if (!value) return "Jamais ouvert";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date inconnue" : `Ouvert ${new Intl.RelativeTimeFormat("fr", { numeric: "auto" }).format(Math.round((date.getTime() - Date.now()) / 86_400_000), "day")}`;
}

function renderProfiles() {
  savedSection.hidden = profiles.length === 0;
  serverCount.textContent = String(profiles.length);
  serverList.replaceChildren();
  for (const profile of profiles) {
    const card = document.createElement("article");
    card.className = `server-card ${profile.type === "local" ? "local-card" : ""}`;
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
    meta.textContent = `${profile.type === "local" ? "Local · compatible Sync" : (profile.insecure ? "HTTP local" : "HTTPS")} · ${formatLastUse(profile.lastUsedAt)}`;
    copy.append(title, address, meta);

    const actions = document.createElement("div");
    actions.className = "server-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "open-server";
    open.textContent = "Ouvrir";
    open.addEventListener("click", () => profile.type === "local" ? openLocal(profile) : connect(profile));
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-button";
    edit.title = "Modifier";
    edit.setAttribute("aria-label", `Modifier ${profile.name}`);
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
    remove.title = "Retirer de la liste";
    remove.setAttribute("aria-label", `Retirer ${profile.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      try { profiles = await api.removeServer(profile.id); renderProfiles(); }
      catch (error) { showError(error instanceof Error ? error.message : "Suppression impossible."); }
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
    connectButton.firstElementChild.textContent = "Ouverture…";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Connexion impossible.");
    setPending(false, false);
  }
}
async function openLocal(profile) {
  showError("");
  setPending(true, true);
  try {
    await api.openLocal(profile);
    openLocalButton.firstElementChild.textContent = "Ouverture…";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Ouverture locale impossible.");
    setPending(false, true);
  }
}

localTab.addEventListener("click", () => setMode("local"));
serverTab.addEventListener("click", () => setMode("server"));
chooseFolderButton.addEventListener("click", async () => {
  try {
    const result = await api.chooseLocalFolder();
    if (result.canceled) return;
    localPathInput.value = result.folderPath;
    if (!localNameInput.value.trim()) localNameInput.value = result.suggestedName;
    showError("");
  } catch (error) { showError(error instanceof Error ? error.message : "Dossier inaccessible."); }
});
localForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!localPathInput.value) { showError("Choisissez le dossier de données CyTask."); return; }
  void openLocal({ id: localIdInput.value || undefined, name: localNameInput.value.trim(), folderPath: localPathInput.value });
});
serverForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url) { showError("Saisissez l’adresse du serveur CyTask."); urlInput.focus(); return; }
  void connect({ id: idInput.value || undefined, name: nameInput.value.trim(), url, allowInsecure: allowHttpInput.checked });
});
urlInput.addEventListener("input", updateTransportWarning);
api.onConnectionError((message) => { showError(message); setPending(false, false); setPending(false, true); });

void api.listServers().then((result) => {
  profiles = result.servers;
  version.textContent = result.version;
  renderProfiles();
  updateTransportWarning();
}).catch((error) => showError(error instanceof Error ? error.message : "Initialisation impossible."));