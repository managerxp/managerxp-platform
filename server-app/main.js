const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const WebSocket = require("ws");
const path = require("path");
const http = require("http");

let win;
let loginWin;
let currentUser = null;
let currentToken = null;
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
    icon: path.join(__dirname, 'icon.ico') // Optional: add an icon
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
    }
  });

  // Remove the application menu
  Menu.setApplicationMenu(null);

  win.loadFile("index.html");
  
  // Send user info to renderer when window loads
  win.webContents.on('did-finish-load', () => {
    if (currentUser) {
      win.webContents.send('user:updated', {
        user: currentUser,
        token: currentToken
      });
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
  const fs = require('fs');
  const authFile = path.join(app.getPath('userData'), 'auth.json');
  
  // Store auth data
  currentUser = user;
  currentToken = token;
  
  // Save to file
  try {
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, JSON.stringify({ user, token }));
    console.log('Auth saved to file');
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
    win.webContents.send('user:updated', {
      user: currentUser,
      token: currentToken
    });
  }
}

app.whenReady().then(() => {
  // Start token receiver server
  startTokenServer();
  
  // Check if user is already authenticated
  const authFile = path.join(app.getPath('userData'), 'auth.json');
  const fs = require('fs');
  
  try {
    if (fs.existsSync(authFile)) {
      const authData = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
      if (authData.user && authData.token) {
        currentUser = authData.user;
        currentToken = authData.token;
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

// Start WebSocket server
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
}

// Authentication IPC handlers
ipcMain.on("auth:login-success", (event, user) => {
  const fs = require('fs');
  const authFile = path.join(app.getPath('userData'), 'auth.json');
  
  // Get token from login window localStorage
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.webContents.executeJavaScript(`
      localStorage.getItem('auth')
    `).then(authData => {
      if (authData) {
        const auth = JSON.parse(authData);
        currentUser = auth.user;
        currentToken = auth.token;
        
        // Save to file
        try {
          fs.mkdirSync(path.dirname(authFile), { recursive: true });
          fs.writeFileSync(authFile, JSON.stringify(auth));
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
    }).catch(err => console.error('Error retrieving auth:', err));
  }
});

ipcMain.on("auth:logout", (event) => {
  const fs = require('fs');
  const authFile = path.join(app.getPath('userData'), 'auth.json');
  
  // Clear current session
  currentUser = null;
  currentToken = null;
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

ipcMain.on("auth:open-web-app", (event) => {
  shell.openExternal('http://localhost:5173/gamingxp-login');
});

ipcMain.on("auth:open-web-app-signup", (event) => {
  shell.openExternal('http://localhost:5173/signup');
});

ipcMain.handle("auth:get-storage", async (event) => {
  if (loginWin && !loginWin.isDestroyed()) {
    try {
      const authData = await loginWin.webContents.executeJavaScript(`
        localStorage.getItem('auth')
      `);
      return authData ? JSON.parse(authData) : null;
    } catch (error) {
      console.error('Error getting storage:', error);
      return null;
    }
  }
  return { user: currentUser, token: currentToken };
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

