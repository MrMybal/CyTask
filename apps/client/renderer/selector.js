"use strict";

const api = window.cytaskDesktop;
const form = document.getElementById("server-form");
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
let servers = [];

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

function setPending(pending, label = "Connexion…") {
  connectButton.disabled = pending;
  connectButton.firstElementChild.textContent = pending ? label : "Se connecter";
  form.querySelectorAll("input").forEach((input) => { input.disabled = pending; });
}

function formatLastUse(value) {
  if (!value) return "Jamais ouvert";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date inconnue"
    : `Ouvert ${new Intl.RelativeTimeFormat("fr", { numeric: "auto" }).format(
      Math.round((date.getTime() - Date.now()) / 86_400_000), "day"
    )}`;
}

function renderServers() {
  savedSection.hidden = servers.length === 0;
  serverCount.textContent = String(servers.length);
  serverList.replaceChildren();

  for (const server of servers) {
    const card = document.createElement("article");
    card.className = "server-card";

    const mark = document.createElement("span");
    mark.className = "server-mark";
    mark.textContent = server.name.slice(0, 2).toUpperCase();

    const copy = document.createElement("div");
    copy.className = "server-copy";
    const title = document.createElement("strong");
    title.textContent = server.name;
    const address = document.createElement("span");
    address.textContent = server.url;
    const meta = document.createElement("small");
    meta.textContent = `${server.insecure ? "HTTP local" : "HTTPS"} · ${formatLastUse(server.lastUsedAt)}`;
    copy.append(title, address, meta);

    const actions = document.createElement("div");
    actions.className = "server-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "open-server";
    open.textContent = "Ouvrir";
    open.addEventListener("click", () => connect({ ...server, allowInsecure: server.insecure }));
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-button";
    edit.title = "Modifier";
    edit.setAttribute("aria-label", `Modifier ${server.name}`);
    edit.textContent = "✎";
    edit.addEventListener("click", () => {
      idInput.value = server.id;
      nameInput.value = server.name;
      urlInput.value = server.url;
      allowHttpInput.checked = server.insecure;
      updateTransportWarning();
      nameInput.focus();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button danger";
    remove.title = "Supprimer";
    remove.setAttribute("aria-label", `Supprimer ${server.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      try {
        servers = await api.removeServer(server.id);
        renderServers();
      } catch (error) {
        showError(error instanceof Error ? error.message : "Suppression impossible.");
      }
    });
    actions.append(open, edit, remove);
    card.append(mark, copy, actions);
    serverList.append(card);
  }
}

async function connect(profile) {
  showError("");
  setPending(true);
  try {
    await api.connectServer(profile);
    connectButton.firstElementChild.textContent = "Ouverture…";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Connexion impossible.");
    setPending(false);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url) {
    showError("Saisissez l’adresse du serveur CyTask.");
    urlInput.focus();
    return;
  }
  void connect({
    id: idInput.value || undefined,
    name: nameInput.value.trim(),
    url,
    allowInsecure: allowHttpInput.checked
  });
});
urlInput.addEventListener("input", updateTransportWarning);
api.onConnectionError((message) => {
  showError(message);
  setPending(false);
});

void api.listServers().then((result) => {
  servers = result.servers;
  version.textContent = result.version;
  renderServers();
  updateTransportWarning();
}).catch((error) => showError(error instanceof Error ? error.message : "Initialisation impossible."));