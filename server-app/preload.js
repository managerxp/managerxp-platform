const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Authentication
  setAuth: (user, token) => ipcRenderer.send("auth:set-auth", { user, token }),
  loginSuccess: (user) => ipcRenderer.send("auth:login-success", user),
  logout: () => ipcRenderer.send("auth:logout"),
  login: () => ipcRenderer.send("auth:login"),
  getAuthStorage: () => ipcRenderer.invoke("auth:get-storage"),
  getAuthState: () => ipcRenderer.invoke("auth:get-state"),
  getUser: () => ipcRenderer.invoke("auth:get-user"),
  getUserId: () => ipcRenderer.invoke("auth:get-user-id"),
  getCafeId: () => ipcRenderer.invoke("auth:get-cafe-id"),
  getToken: () => ipcRenderer.invoke("auth:get-token"),
  
  // Web app navigation
  openWebApp: () => ipcRenderer.send("auth:open-web-app"),
  openWebAppSignup: () => ipcRenderer.send("auth:open-web-app-signup"),
  
  // Logging
  onLog: (cb) => ipcRenderer.on("log", (_, msg) => cb(msg)),
  onClients: (cb) => ipcRenderer.on("clients", (_, list) => cb(list)),
  onAppsUpdated: (cb) => ipcRenderer.on("apps-updated", (_, data) => cb(data)),
  onUserUpdated: (cb) => ipcRenderer.on("user:updated", (_, user) => cb(user)),
  onDiscoveredPCs: (cb) => ipcRenderer.on("discovered-pcs", (_, data) => cb(data)),
  onPCConnectionStatus: (cb) => ipcRenderer.on("pc-connection-status", (_, data) => cb(data)),
  onPCListRefreshed: (cb) => ipcRenderer.on("pc-list-refreshed", (_, data) => cb(data)),
  
  // App management
  launchApp: (data) => ipcRenderer.invoke("launch-app", data),
  refreshApps: (simId) => ipcRenderer.invoke("refresh-apps", simId),
  getClientApps: (simId) => ipcRenderer.invoke("get-client-apps", simId),
  closeApp: (data) => ipcRenderer.invoke("close-app", data),
  fetchPcSoftware: (simId) => ipcRenderer.invoke("fetch-pc-software", simId),
  getPcSoftwareFromAPI: (pcId) => ipcRenderer.invoke("get-pc-software-from-api", pcId),
  
  // PC data
  getCafePCs: () => ipcRenderer.invoke("pcs:get-cafe-pcs"),

  // Session state push to a station
  pushSessionState: (pcName, session) => ipcRenderer.invoke("session:push-state", { pcName, session }),
  // Grow a station's floating timer card after its session was extended.
  pushExtendTimer: (pcName, minutes) => ipcRenderer.invoke("session:push-extend-timer", { pcName, minutes }),
  // Send a station the games its customer may choose from (installed + enabled).
  pushGames: (pcName, games) => ipcRenderer.invoke("session:push-games", { pcName, games }),
  // End-of-session cleanup on a station (close game, sign launchers out, free PC).
  cleanupStation: (pcName, config, games) =>
    ipcRenderer.invoke("session:cleanup", { pcName, config, games }),
  onStationCleanupDone: (cb) => ipcRenderer.on("station:cleanup-done", (_, d) => cb(d)),
  // Which game launchers a station has installed (Steam, Riot, EA, …).
  getStationLaunchers: (pcName) => ipcRenderer.invoke("station:get-launchers", { pcName }),
  refreshStationLaunchers: (pcName) => ipcRenderer.invoke("station:refresh-launchers", { pcName }),
  onStationLaunchers: (cb) => ipcRenderer.on("station:launchers", (_, d) => cb(d)),
  // A player tapped Extend at the station; the console acts with its token.
  onStationExtendRequest: (cb) => ipcRenderer.on("station:extend-request", (_, d) => cb(d)),
  // A station's block ran out with the game still running.
  onStationOvertime: (cb) => ipcRenderer.on("station:overtime", (_, d) => cb(d)),
  // A logged-in customer opened the game picker while idle — send this
  // station's games and prices so they can choose without staff.
  onStationStartOptionsRequest: (cb) => ipcRenderer.on("station:start-options-request", (_, d) => cb(d)),
  pushStartOptions: (pcName, games, prices) =>
    ipcRenderer.invoke("session:push-start-options", { pcName, games, prices }),
  // The customer picked a game and a price and tapped Start.
  onStationStartRequest: (cb) => ipcRenderer.on("station:start-request", (_, d) => cb(d)),
  pushStartFailed: (pcName, message) => ipcRenderer.invoke("session:push-start-failed", { pcName, message }),

  // Telemetry — live readings live in the main process, history in the backend
  getLatestTelemetry: () => ipcRenderer.invoke("telemetry:get-latest"),
  requestTelemetry: (pcName) => ipcRenderer.invoke("telemetry:request", { pcName }),
  setTelemetryInterval: (seconds) => ipcRenderer.invoke("telemetry:set-interval", { seconds }),
  onTelemetry: (cb) => ipcRenderer.on("telemetry-updated", (_, payload) => cb(payload)),

  // Remote power — authorise with the backend first, then deliver
  stationPower: (pcName, action, delaySeconds) =>
    ipcRenderer.invoke("station:power", { pcName, action, delaySeconds }),

  /* Powering ON is the one action that cannot go through the client, because
     the machine is off. It goes out as a Wake-on-LAN broadcast instead. */
  stationWake: (pcName, macAddress) =>
    ipcRenderer.invoke("station:wake", { pcName, macAddress }),
  
  // PC connection management (NEW)
  connectToPC: (ip, port, pcName) => ipcRenderer.invoke("pc:connect-to-pc", { ip, port, pcName }),
  reconnectAllPCs: () => ipcRenderer.invoke("pc:reconnect-all"),
  getConnectionStatus: () => ipcRenderer.invoke("pc:get-connection-status"),
  // Pull the live connected list, for when the pushed event was missed
  getConnectedPCs: () => ipcRenderer.invoke("pc:get-connected"),
  clearPCFailures: (pcName) => ipcRenderer.invoke("pc:clear-failures", { pcName }),
  refreshPCList: () => ipcRenderer.invoke("pc:refresh-list"),
  
  // System info
  getMacAddress: () => ipcRenderer.invoke("system:get-mac-address"),

  // Custom window controls
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowToggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  windowClose: () => ipcRenderer.send("window:close"),
  windowIsMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onWindowMaximizedChanged: (cb) => ipcRenderer.on("window:maximized-changed", (_, v) => cb(v))
});
