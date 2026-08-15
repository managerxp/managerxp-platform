const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onLog: (cb) => ipcRenderer.on("log", (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on("status", (_, status) => cb(status)),
  getStatus: (cb) => ipcRenderer.invoke("get-status").then(cb),
  onPcName: (cb) => ipcRenderer.on("pc-name", (_, name) => cb(name)),
  getPcName: (cb) => ipcRenderer.invoke("get-pc-name").then(cb),
  hideStatusBar: () => ipcRenderer.send("hide-statusbar"),
  showStatusBar: () => ipcRenderer.send("show-statusbar"),
  onStartTimer: (cb) => ipcRenderer.on("start-timer", (_, data) => cb(data)),
  onAppLaunching: (cb) => ipcRenderer.on("app-launching", (_, data) => cb(data)),
  onAppLaunchFailed: (cb) => ipcRenderer.on("app-launch-failed", (_, data) => cb(data)),
  onAppClosed: (cb) => ipcRenderer.on("app-closed", (_, data) => cb(data)),
  timerExpired: (appName) => ipcRenderer.send("timer-expired", appName),
  navigateTo: (page) => ipcRenderer.send("navigate", page),
  storeToken: (token) => ipcRenderer.send("store-token", token),
  getToken: (cb) => ipcRenderer.invoke("get-token").then(cb),
  storeUserInfo: (user) => ipcRenderer.send("store-user-info", user),
  getUserInfo: (cb) => ipcRenderer.invoke("get-user-info").then(cb)
});
