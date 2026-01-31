const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onLog: (cb) => ipcRenderer.on("log", (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on("status", (_, status) => cb(status))
});
