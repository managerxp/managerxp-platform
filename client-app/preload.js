const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  onLog: (cb) => ipcRenderer.on("log", (_, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on("status", (_, status) => cb(status)),
  getStatus: (cb) => ipcRenderer.invoke("get-status").then(cb),
  onPcName: (cb) => ipcRenderer.on("pc-name", (_, name) => cb(name)),
  getPcName: (cb) => ipcRenderer.invoke("get-pc-name").then(cb),
  getAppVersion: (cb) => ipcRenderer.invoke("get-app-version").then(cb),

  // Volume — real level + mute state, from the actual Windows device.
  volumeGet: () => ipcRenderer.invoke("volume:get"),
  volumeSet: (level) => ipcRenderer.invoke("volume:set", level),
  volumeMuteToggle: () => ipcRenderer.invoke("volume:mute-toggle"),

  // Which game launchers this station has, and opening one.
  getLaunchers: (cb) => ipcRenderer.invoke("get-launchers").then(cb),
  openLauncher: (name) => ipcRenderer.invoke("open-launcher", name),
  // Where the backend API lives — corrected from "this machine" to the
  // console's real address once the station connects to one on another PC.
  onBackendBase: (cb) => ipcRenderer.on("backend-base", (_, base) => cb(base)),
  getBackendBase: (cb) => ipcRenderer.invoke("get-backend-base").then(cb),
  onStartTimer: (cb) => ipcRenderer.on("start-timer", (_, data) => cb(data)),
  onAppLaunching: (cb) => ipcRenderer.on("app-launching", (_, data) => cb(data)),
  onAppLaunched: (cb) => ipcRenderer.on("app-launched", (_, data) => cb(data)),
  onAppLaunchFailed: (cb) => ipcRenderer.on("app-launch-failed", (_, data) => cb(data)),
  onAppClosed: (cb) => ipcRenderer.on("app-closed", (_, data) => cb(data)),
  onSessionState: (cb) => ipcRenderer.on("session-state", (_, data) => cb(data)),
  // The games this station may offer the customer, pushed by the console.
  onGamesList: (cb) => ipcRenderer.on("games-list", (_, data) => cb(data)),
  getGames: (cb) => ipcRenderer.invoke("get-games").then(cb),
  // The customer chose a game — launch it through its launcher.
  launchGame: (game) => ipcRenderer.send("launch-game", game),
  // Warning shown before the station restarts, shuts down or signs out
  onPowerWarning: (cb) => ipcRenderer.on("power-warning", (_, data) => cb(data)),
  getSessionState: (cb) => ipcRenderer.invoke("get-session-state").then(cb),

  /*
   * Window controls — present, but refused while the kiosk is sealed.
   *
   * Each of these is checked against the lock state in the main process, so a
   * customer calling them from the page gets nothing. They start working the
   * moment staff unlock the station with the PIN, which is the point: someone
   * who has proved they work here needs to minimise and close the window like
   * any other application.
   *
   * `onKioskState` is how the on-screen control cluster knows whether to show
   * itself at all — sealed, there are no buttons to see.
   */
  toggleFullscreen: () => ipcRenderer.send("window:toggle-fullscreen"),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  isFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  onFullscreenChanged: (cb) => ipcRenderer.on("window:fullscreen-changed", (_, v) => cb(v)),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChanged: (cb) => ipcRenderer.on("window:maximized-changed", (_, v) => cb(v)),
  isKioskLocked: () => ipcRenderer.invoke("window:is-kiosk-locked"),
  onKioskState: (cb) => ipcRenderer.on("window:kiosk-state", (_, locked) => cb(locked)),
  timerExpired: (appName) => ipcRenderer.send("timer-expired", appName),
  // The player tapped Extend on the timer card. Fire-and-forget to the console.
  requestExtend: () => ipcRenderer.send("request-extend"),
  // The block ran out and the game was NOT closed — tell the console so it can
  // flag the station and staff can act.
  sessionOvertime: (appName) => ipcRenderer.send("session-overtime", appName),
  // The console added a block; grow the timer card's clock by these minutes.
  onExtendTimer: (cb) => ipcRenderer.on("extend-timer", (_, data) => cb(data)),
  // Self-service: ask what this station's customer could start (its games,
  // this café's prices), whether or not a session is already running.
  requestStartOptions: () => ipcRenderer.send("request-start-options"),
  onStartOptions: (cb) => ipcRenderer.on("start-options", (_, data) => cb(data)),
  // The customer picked a game and a price and tapped Start.
  requestStartSession: (payload) => ipcRenderer.send("request-start-session", payload),
  onStartSessionFailed: (cb) => ipcRenderer.on("start-session-failed", (_, data) => cb(data)),
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
