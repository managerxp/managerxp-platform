const { contextBridge, ipcRenderer } = require("electron");

/*
 * The timer card's own preload — deliberately not the full preload.js.
 *
 * This window is a read-only countdown pill: timercard.js only ever calls
 * these five. It previously shared the main preload wholesale (storeToken,
 * launchGame, openCheckout, requestEndSession, every IPC channel the real
 * kiosk window has), harmless only because focusable:false kept it out of
 * reach — a latent overexposure one unrelated future change away from being
 * reachable, rather than a page that simply cannot call what it doesn't need.
 */
contextBridge.exposeInMainWorld("api", {
  onStartTimer: (cb) => ipcRenderer.on("start-timer", (_, data) => cb(data)),
  showTimerCard: () => ipcRenderer.send("timer-card:show"),
  hideTimerCard: () => ipcRenderer.send("timer-card:hide"),
  onExtendTimer: (cb) => ipcRenderer.on("extend-timer", (_, data) => cb(data)),
  sessionOvertime: (appName) => ipcRenderer.send("session-overtime", appName)
});
