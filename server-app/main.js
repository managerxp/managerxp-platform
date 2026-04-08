const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const WebSocket = require("ws");
const path = require("path");
const http = require("http");
const authContext = require("./authContext");

let win;
let loginWin;
let handlersRegistered = false;
const clients = new Map(); // simId -> { ws, apps }

// Create login window
function createLoginWindow() {
  loginWin = new BrowserWindow({
    width: 500,
    height: 600,
    minWidth: 400,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'Images', 'icon.png')
  });

  // Remove the application menu
  Menu.setApplicationMenu(null);

  loginWin.loadFile("login.html");
  // loginWin.webContents.openDevTools(); // Uncomment for debugging
}

// Create main window
function createWindow() {
  win = new BrowserWindow({
    width: 950,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'Images', 'icon.png')
  });

  // Remove the application menu
  Menu.setApplicationMenu(null);

  win.loadFile("index.html");
  
  // Send user info to renderer when window loads
  win.webContents.on('did-finish-load', () => {
    const authState = authContext.getAuthState();
    if (authState.isAuthenticated) {
      win.webContents.send('user:updated', authState);
    }
  });
}

function log(msg) {
  if (win) win.webContents.send("log", msg);
}

// Start token receiver HTTP server
function startTokenServer() {
  const server = http.createServer((req, res) => {
    // Add CORS headers to all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    if (req.method === 'POST' && req.url === '/auth/token') {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          const { token, user } = JSON.parse(body);
          
          if (token && user) {
            console.log('Token received from web app for user:', user.name || user.email);
            
            // Process the login
            handleWebAppLogin(token, user);
            
            // Send success response
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Token received' }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Missing token or user' }));
          }
        } catch (error) {
          console.error('Error parsing token:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Invalid request' }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Not found' }));
    }
  });
  
  server.listen(3334, () => {
    console.log('Token receiver server listening on port 3334 with CORS enabled');
  });
}

// Handle login from web app
function handleWebAppLogin(token, user) {
  // Store in auth context
  authContext.setAuth(user, token);
  
  const fs = require('fs');
  const authFile = path.join(app.getPath('userData'), 'auth.json');
  
  // Save to file as backup
  try {
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, JSON.stringify({ user, token }));
    console.log('Auth saved to file for user:', user.email || user.name);
  } catch (error) {
    console.error('Error saving auth:', error);
  }
  
  // Close login window if open
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.close();
  }
  
  // Create/show main window
  if (!win) {
    createWindow();
    startWebSocketServer();
  } else if (win.isDestroyed()) {
    createWindow();
    startWebSocketServer();
  } else {
    // Window already exists, update user info
    const authState = authContext.getAuthState();
    win.webContents.send('user:updated', authState);
  }
}

app.whenReady().then(() => {
  // Register IPC handlers (only once)
  registerIPCHandlers();
  
  // Start token receiver server
  startTokenServer();
  
  // Check if user is already authenticated
  const authFile = path.join(app.getPath('userData'), 'auth.json');
  const fs = require('fs');
  
  try {
    if (fs.existsSync(authFile)) {
      const authData = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
      if (authData.user && authData.token) {
        // Restore auth context
        authContext.setAuth(authData.user, authData.token);
        createWindow();
        startWebSocketServer();
      } else {
        createLoginWindow();
      }
    } else {
      createLoginWindow();
    }
  } catch (error) {
    console.error('Auth file error:', error);
    createLoginWindow();
  }
});

// Register all IPC handlers (call only once)
function registerIPCHandlers() {
  if (handlersRegistered) return;
  
  // Handle launch request from UI
  ipcMain.handle("launch-app", async (_, data) => {
    const { simId, appName, appPath, timerMinutes } = data;
    const client = clients.get(simId);
    
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: "LAUNCH_APP",
        appName: appName,
        appPath: appPath,
        timerMinutes: timerMinutes || 0
      }));
      log(`Sent launch command to ${simId}: ${appName}${timerMinutes ? ` (Timer: ${timerMinutes} min)` : ''}`);
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

  // Authentication IPC handlers
  ipcMain.on("auth:set-auth", (event, { user, token }) => {
    // Set auth in context
    authContext.setAuth(user, token);
    
    const fs = require('fs');
    const authFile = path.join(app.getPath('userData'), 'auth.json');
    
    // Save to file as backup
    try {
      fs.mkdirSync(path.dirname(authFile), { recursive: true });
      fs.writeFileSync(authFile, JSON.stringify({ user, token }));
      console.log('Auth context updated for user:', user.email || user.name);
    } catch (error) {
      console.error('Failed to save auth:', error);
    }
    
    // Close login window and create main window if needed
    if (loginWin && !loginWin.isDestroyed()) {
      loginWin.close();
    }
    
    if (!win || win.isDestroyed()) {
      createWindow();
      startWebSocketServer();
    }
  });

  ipcMain.on("auth:login-success", (event, user) => {
    const fs = require('fs');
    const authFile = path.join(app.getPath('userData'), 'auth.json');
    
    // Get token from login window localStorage (if available)
    if (loginWin && !loginWin.isDestroyed()) {
      authContext.setAuth(user, authContext.getToken());
      
      // Save to file
      try {
        fs.mkdirSync(path.dirname(authFile), { recursive: true });
        fs.writeFileSync(authFile, JSON.stringify({ 
          user, 
          token: authContext.getToken() 
        }));
      } catch (error) {
        console.error('Failed to save auth:', error);
      }
      
      // Close login window and create main window
      if (loginWin && !loginWin.isDestroyed()) {
        loginWin.close();
      }
      createWindow();
      startWebSocketServer();
    }
  });

  ipcMain.on("auth:logout", (event) => {
    const fs = require('fs');
    const authFile = path.join(app.getPath('userData'), 'auth.json');
    
    // Clear auth context
    authContext.clearAuth();
    clients.clear();
    
    // Delete auth file
    try {
      if (fs.existsSync(authFile)) {
        fs.unlinkSync(authFile);
      }
    } catch (error) {
      console.error('Error deleting auth file:', error);
    }
    
    // Close main window and create login window
    if (win && !win.isDestroyed()) {
      win.close();
    }
    createLoginWindow();
  });

  ipcMain.handle("auth:get-state", async (event) => {
    return authContext.getAuthState();
  });

  ipcMain.handle("auth:get-user", async (event) => {
    return authContext.getUser();
  });

  ipcMain.handle("auth:get-user-id", async (event) => {
    return authContext.getUserId();
  });

  ipcMain.handle("auth:get-cafe-id", async (event) => {
    return authContext.getCafeId();
  });

  ipcMain.handle("auth:get-token", async (event) => {
    return authContext.getToken();
  });

  ipcMain.on("auth:open-web-app", (event) => {
    shell.openExternal('http://localhost:5173/gamingxp-login');
  });

  ipcMain.on("auth:open-web-app-signup", (event) => {
    shell.openExternal('http://localhost:5173/signup');
  });
  
  handlersRegistered = true;
  console.log('IPC handlers registered');
}

// Start WebSocket server (can be called multiple times)
function startWebSocketServer() {
  const wss = new WebSocket.Server({ port: 8080, host: '0.0.0.0' });
  log("VMS Server started on port 8080 (accessible on network)");

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
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

