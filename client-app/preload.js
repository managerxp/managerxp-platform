const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onLog: (cb) => ipcRenderer.on("log", (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on("status", (_, status) => cb(status)),
  hideStatusBar: () => ipcRenderer.send("hide-statusbar"),
  showStatusBar: () => ipcRenderer.send("show-statusbar"),
  setAssignedTime: (minutes) => ipcRenderer.send("set-assigned-time", minutes),
  onAssignedTime: (cb) => ipcRenderer.on("assigned-time", (_, minutes) => cb(minutes))
});
