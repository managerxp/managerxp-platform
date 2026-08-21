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
  onSessionState: (cb) => ipcRenderer.on("session-state", (_, data) => cb(data)),
  // Warning shown before the station restarts, shuts down or signs out
  onPowerWarning: (cb) => ipcRenderer.on("power-warning", (_, data) => cb(data)),
  getSessionState: (cb) => ipcRenderer.invoke("get-session-state").then(cb),

  // Window controls
  toggleFullscreen: () => ipcRenderer.send("window:toggle-fullscreen"),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  isFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  onFullscreenChanged: (cb) => ipcRenderer.on("window:fullscreen-changed", (_, v) => cb(v)),
  // The OS frame is gone, so maximise/restore and close come from the portal
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChanged: (cb) => ipcRenderer.on("window:maximized-changed", (_, v) => cb(v)),
  timerExpired: (appName) => ipcRenderer.send("timer-expired", appName),
  navigateTo: (page) => ipcRenderer.send("navigate", page),
  storeToken: (token) => ipcRenderer.send("store-token", token),
  getToken: (cb) => ipcRenderer.invoke("get-token").then(cb),
  storeUserInfo: (user) => ipcRenderer.send("store-user-info", user),
  getUserInfo: (cb) => ipcRenderer.invoke("get-user-info").then(cb),

  // Payment checkout runs in its own window; the renderer only asks for it to
  // open and listens for the outcome.
  openCheckout: (path) => ipcRenderer.invoke("payment:open-checkout", path),
  onTopupResult: (cb) => ipcRenderer.on("payment:topup-result", (_, detail) => cb(detail)),
  onCheckoutClosed: (cb) => ipcRenderer.on("payment:checkout-closed", () => cb())
});
