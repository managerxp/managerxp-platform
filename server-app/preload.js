const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onLog: (cb) => ipcRenderer.on("log", (_, msg) => cb(msg)),
  onClients: (cb) => ipcRenderer.on("clients", (_, list) => cb(list)),
  onAppsUpdated: (cb) => ipcRenderer.on("apps-updated", (_, data) => cb(data)),
  launchApp: (data) => ipcRenderer.invoke("launch-app", data),
  refreshApps: (simId) => ipcRenderer.invoke("refresh-apps", simId),
  getClientApps: (simId) => ipcRenderer.invoke("get-client-apps", simId),
  closeApp: (data) => ipcRenderer.invoke("close-app", data)
});
