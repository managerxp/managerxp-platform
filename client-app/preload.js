const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onLog: (cb) => ipcRenderer.on("log", (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on("status", (_, status) => cb(status)),
  onPcName: (cb) => ipcRenderer.on("pc-name", (_, name) => cb(name)),
  hideStatusBar: () => ipcRenderer.send("hide-statusbar"),
  showStatusBar: () => ipcRenderer.send("show-statusbar"),
  onStartTimer: (cb) => ipcRenderer.on("start-timer", (_, data) => cb(data)),
  timerExpired: (appName) => ipcRenderer.send("timer-expired", appName)
});
