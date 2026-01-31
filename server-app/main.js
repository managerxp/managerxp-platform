const { app, BrowserWindow, ipcMain } = require("electron");
const WebSocket = require("ws");
const path = require("path");

let win;
const clients = new Map(); // simId -> { ws, apps }

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("index.html");
}

function log(msg) {
  if (win) win.webContents.send("log", msg);
}

app.whenReady().then(() => {
  createWindow();

  const wss = new WebSocket.Server({ port: 8080 });
  log("VMS Server started on port 8080");

  wss.on("connection", (ws) => {
    log("Client connected");

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);

      if (msg.type === "REGISTER") {
        ws.simId = msg.simId;
        clients.set(msg.simId, { ws, apps: [] });
        log(`Registered: ${msg.simId}`);
        win.webContents.send("clients", [...clients.keys()]);
      }

      if (msg.type === "HEARTBEAT") {
        // alive check (silent)
      }

      if (msg.type === "APPS_LIST") {
        const client = clients.get(msg.simId);
        if (client) {
          client.apps = msg.apps;
          log(`Received ${msg.apps.length} apps from ${msg.simId}`);
          win.webContents.send("apps-updated", {
            simId: msg.simId,
            apps: msg.apps
          });
        }
      }
    });

    ws.on("close", () => {
      if (ws.simId) {
        clients.delete(ws.simId);
        log(`Disconnected: ${ws.simId}`);
        win.webContents.send("clients", [...clients.keys()]);
      }
    });
  });

  // Handle launch request from UI
  ipcMain.handle("launch-app", async (_, data) => {
    const { simId, appName, appPath } = data;
    const client = clients.get(simId);
    
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: "LAUNCH_APP",
        appName: appName,
        appPath: appPath
      }));
      log(`Sent launch command to ${simId}: ${appName}`);
      return true;
    }
    return false;
  });

  // Handle refresh request from UI
  ipcMain.handle("refresh-apps", async (_, simId) => {
    const client = clients.get(simId);
    
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: "REFRESH_APPS"
      }));
      log(`Sent refresh command to ${simId}`);
      return true;
    }
    return false;
  });

  // Get apps for a specific client
  ipcMain.handle("get-client-apps", async (_, simId) => {
    const client = clients.get(simId);
    return client ? client.apps : [];
  });

  // Handle close app request from UI
  ipcMain.handle("close-app", async (_, data) => {
    const { simId, appName, appPath } = data;
    const client = clients.get(simId);
    
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: "CLOSE_APP",
        appName: appName,
        appPath: appPath
      }));
      log(`Sent close command to ${simId}: ${appName}`);
      return true;
    }
    return false;
  });
});
