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
  
  // App management
  launchApp: (data) => ipcRenderer.invoke("launch-app", data),
  refreshApps: (simId) => ipcRenderer.invoke("refresh-apps", simId),
  getClientApps: (simId) => ipcRenderer.invoke("get-client-apps", simId),
  closeApp: (data) => ipcRenderer.invoke("close-app", data),
  
  // PC data
  getCafePCs: () => ipcRenderer.invoke("pcs:get-cafe-pcs"),
  
  // PC connection management (NEW)
  connectToPC: (ip, port, pcName) => ipcRenderer.invoke("pc:connect-to-pc", { ip, port, pcName }),
  reconnectAllPCs: () => ipcRenderer.invoke("pc:reconnect-all"),
  getConnectionStatus: () => ipcRenderer.invoke("pc:get-connection-status"),
  clearPCFailures: (pcName) => ipcRenderer.invoke("pc:clear-failures", { pcName }),
  
  // System info
  getMacAddress: () => ipcRenderer.invoke("system:get-mac-address")
});
