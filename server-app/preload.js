const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Authentication
  loginSuccess: (user) => ipcRenderer.send("auth:login-success", user),
  logout: () => ipcRenderer.send("auth:logout"),
  getAuthStorage: () => ipcRenderer.invoke("auth:get-storage"),
  
  // Web app navigation
  openWebApp: () => ipcRenderer.send("auth:open-web-app"),
  openWebAppSignup: () => ipcRenderer.send("auth:open-web-app-signup"),
  
  // Logging
  onLog: (cb) => ipcRenderer.on("log", (_, msg) => cb(msg)),
  onClients: (cb) => ipcRenderer.on("clients", (_, list) => cb(list)),
  onAppsUpdated: (cb) => ipcRenderer.on("apps-updated", (_, data) => cb(data)),
  onUserUpdated: (cb) => ipcRenderer.on("user:updated", (_, user) => cb(user)),
  
  // App management
  launchApp: (data) => ipcRenderer.invoke("launch-app", data),
  refreshApps: (simId) => ipcRenderer.invoke("refresh-apps", simId),
  getClientApps: (simId) => ipcRenderer.invoke("get-client-apps", simId),
  closeApp: (data) => ipcRenderer.invoke("close-app", data)
});
