"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cytaskDesktop", Object.freeze({
  listServers: () => ipcRenderer.invoke("cytask:list-servers"),
  setLocale: (locale) => ipcRenderer.invoke("cytask:set-locale", locale),
  connectServer: (profile) => ipcRenderer.invoke("cytask:connect-server", profile),
  chooseLocalFolder: () => ipcRenderer.invoke("cytask:choose-local-folder"),
  openLocal: (profile) => ipcRenderer.invoke("cytask:open-local", profile),
  removeServer: (id) => ipcRenderer.invoke("cytask:remove-server", id),
  onConnectionError: (callback) => {
    const listener = (_event, message) => callback(String(message));
    ipcRenderer.on("cytask:connection-error", listener);
    return () => ipcRenderer.removeListener("cytask:connection-error", listener);
  }
}));