"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cytaskDesktop", Object.freeze({
  listServers: () => ipcRenderer.invoke("cytask:list-servers"),
  connectServer: (profile) => ipcRenderer.invoke("cytask:connect-server", profile),
  removeServer: (id) => ipcRenderer.invoke("cytask:remove-server", id),
  onConnectionError: (callback) => {
    const listener = (_event, message) => callback(String(message));
    ipcRenderer.on("cytask:connection-error", listener);
    return () => ipcRenderer.removeListener("cytask:connection-error", listener);
  }
}));