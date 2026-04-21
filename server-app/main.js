const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const WebSocket = require("ws");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");
const authContext = require("./authContext");

let win;
let loginWin;
let tokenServer; // HTTP token server instance
let clientConnections = new Map(); // simId -> ws connection to client
let handlersRegistered = false;
const clients = new Map(); // simId -> { ws, apps }
let allRegisteredPCs = new Map(); // Track all registered PCs with their config for heartbeat
let discoveredPCs = new Map(); // Track auto-discovered PCs: ip_address -> { ip, mac, hostname, port, discovered_at }
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL = 5000; // Send heartbeat every 5 seconds
const RECONNECT_INTERVAL = 10000; // Try to reconnect dead clients every 10 seconds

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
      // Send discovered PCs list
      win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
    }
  });
}

function log(msg) {
  if (win) win.webContents.send("log", msg);
}

// Get the MAC address of the system
function getMacAddress() {
  try {
    const interfaces = os.networkInterfaces();
    
    // Try to find the first non-internal, active interface with a MAC address
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      
      // Skip loopback and internal interfaces
      if (iface[0]?.family === 'IPv4' && !iface[0]?.internal) {
        const macAddress = iface[0]?.mac;
        if (macAddress && macAddress !== '00:00:00:00:00:00') {
          console.log(`Found MAC address: ${macAddress} on interface: ${name}`);
          return macAddress;
        }
      }
    }
    
    // Fallback: get the first available MAC address
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      for (const addr of iface) {
        const macAddress = addr.mac;
        if (macAddress && macAddress !== '00:00:00:00:00:00') {
          console.log(`Found fallback MAC address: ${macAddress} on interface: ${name}`);
          return macAddress;
        }
      }
    }
    
    console.warn('No valid MAC address found, using default');
    return 'unknown';
  } catch (error) {
    console.error('Error getting MAC address:', error);
    return 'error';
  }
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

    // ===== PC DISCOVERY ENDPOINT =====
    if (req.method === 'POST' && req.url === '/api/pc-discovery') {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const { type, ip_address, mac_address, hostname, port } = data;
          
          if (type === 'PC_DISCOVERY' && ip_address && mac_address) {
            console.log(`[PC Discovery] ${hostname} (${ip_address}/${mac_address}) on port ${port}`);
            
            // Check if this PC is already connected by checking if any connected client has this IP
            let isAlreadyConnected = false;
            for (let [pcName, pcConfig] of allRegisteredPCs.entries()) {
              if (pcConfig.ip === ip_address && clients.has(pcName)) {
                isAlreadyConnected = true;
                console.log(`[PC Discovery] Ignoring - PC already connected: ${pcName}`);
                break;
              }
            }
            
            if (!isAlreadyConnected) {
              // Store discovered PC
              discoveredPCs.set(ip_address, {
                ip: ip_address,
                mac: mac_address,
                hostname: hostname,
                port: port || 9090,
                discovered_at: new Date().toISOString()
              });
              
              console.log(`[PC Discovery] Added to unknown list - Total: ${discoveredPCs.size}`);
            }
            
            // Send discovered PCs list to renderer (only non-connected PCs)
            if (win && !win.isDestroyed()) {
              win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
              console.log(`[PC Discovery] Sent ${discoveredPCs.size} unknown PCs to renderer`);
            } else {
              console.log(`[PC Discovery] Main window not ready`);
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'PC discovery received' }));
          } else {
            console.log(`[PC Discovery] Invalid data:`, data);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Invalid discovery data' }));
          }
        } catch (error) {
          console.error('[PC Discovery] Error parsing discovery data:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Invalid request' }));
        }
      });
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
            
            // Process the login and check if it was successful
            const loginSuccess = handleWebAppLogin(token, user);
            
            if (loginSuccess) {
              // Send success response
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: 'Token received and processed' }));
            } else {
              // Token was invalid
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: 'Invalid token or user data' }));
            }
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
  
  tokenServer = server;
  server.listen(3334, () => {
    console.log('Token receiver server listening on port 3334 with CORS enabled');
  });
}

// Handle login from web app
function handleWebAppLogin(token, user) {
  // Validate token and user data
  if (!token || typeof token !== 'string' || token.trim() === '') {
    console.error('Invalid token received');
    return false;
  }
  
  if (!user || typeof user !== 'object') {
    console.error('Invalid user data received');
    return false;
  }
  
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
    connectToClients().catch(err => console.error('Error connecting to clients:', err));
  } else if (win.isDestroyed()) {
    createWindow();
    connectToClients().catch(err => console.error('Error connecting to clients:', err));
  } else {
    // Window already exists, update user info
    const authState = authContext.getAuthState();
    win.webContents.send('user:updated', authState);
    // Send discovered PCs list
    win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
  }
  
  return true;
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
        connectToClients().catch(err => console.error('Error connecting to clients:', err));
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
    
    // Close login window if open and create main window
    if (loginWin && !loginWin.isDestroyed()) {
      loginWin.close();
    }
    
    if (!win || win.isDestroyed()) {
      createWindow();
      connectToClients();
    } else {
      // Window already exists, just update user info
      const authState = authContext.getAuthState();
      win.webContents.send('user:updated', authState);
      // Send discovered PCs list
      win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
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
      // Connect to clients from API (async)
      connectToClients().catch(err => console.error('Error connecting to clients:', err));
    }
  });

  ipcMain.on("auth:logout", (event) => {
    const fs = require('fs');
    const authFile = path.join(app.getPath('userData'), 'auth.json');
    
    // Close WebSocket client connections
    if (clientConnections && clientConnections.size > 0) {
      try {
        clientConnections.forEach(ws => {
          ws.close();
        });
        clientConnections.clear();
        console.log('WebSocket client connections closed');
      } catch (error) {
        console.error('Error closing WebSocket connections:', error);
      }
    }
    
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
    
    // Close previous login window if exists
    if (loginWin && !loginWin.isDestroyed()) {
      loginWin.close();
    }
    
    // Close main window and create fresh login window
    if (win && !win.isDestroyed()) {
      win.close();
    }
    
    // Create a fresh login window (this clears any localStorage from previous session)
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

  // Fetch PCs data for the current user
  ipcMain.handle("pcs:get-cafe-pcs", async (event) => {
    try {
      const cafeId = authContext.getCafeId();
      const token = authContext.getToken();
      
      if (!cafeId || !token) {
        console.log("Missing cafeId or token for PC fetch");
        return { success: false, data: [], error: "Not authenticated" };
      }

      const response = await fetch(`http://localhost:5000/api/pcs/cafe/${cafeId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`PC fetch failed: ${response.status} ${errorText}`);
        return { success: false, data: [], error: `HTTP ${response.status}` };
      }

      const result = await response.json();
      console.log("PC data fetched:", result.data?.length, "PCs found");
      return result;
    } catch (error) {
      console.error("Error fetching PCs:", error.message);
      return { success: false, data: [], error: error.message };
    }
  });

  ipcMain.on("auth:open-web-app", (event) => {
    shell.openExternal('http://localhost:5173/gamingxp-login');
  });

  ipcMain.on("auth:open-web-app-signup", (event) => {
    shell.openExternal('http://localhost:5173/signup');
  });

  // Get system MAC address
  ipcMain.handle("system:get-mac-address", async (event) => {
    try {
      const macAddress = getMacAddress();
      console.log('Returning MAC address:', macAddress);
      return { success: true, macAddress: macAddress };
    } catch (error) {
      console.error('Error in MAC address handler:', error);
      return { success: false, error: error.message };
    }
  });
  
  handlersRegistered = true;
  console.log('IPC handlers registered');
}

// Load client configuration
function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config;
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return { clients: [], serverPort: 8080 };
}

// Fetch PCs from API instead of config.json
async function fetchClientsFromAPI() {
  try {
    const cafeId = authContext.getCafeId();
    const token = authContext.getToken();
    
    if (!cafeId || !token) {
      log("Not authenticated - cannot fetch PCs from API");
      return [];
    }

    const response = await fetch(`http://localhost:5000/api/pcs/cafe/${cafeId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch PCs: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.success && Array.isArray(result.data)) {
      log(`Fetched ${result.data.length} PCs from API`);
      // Convert API PC data to config format
      return result.data.map(pc => ({
        simId: pc.name,
        ip: pc.ip_address,
        port: pc.port
      }));
    }
    
    return [];
  } catch (error) {
    log(`Error fetching PCs from API: ${error.message}`);
    return [];
  }
}

// Heartbeat function - sends heartbeat to connected clients and tries to reconnect dead ones
async function heartbeat() {
  try {
    // Send heartbeat to all connected clients
    clients.forEach((client, simId) => {
      if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify({
            type: "HEARTBEAT_PING"
          }));
        } catch (error) {
          log(`Heartbeat send error for ${simId}: ${error.message}`);
        }
      }
    });

    // Check for disconnected PCs and try to reconnect them
    if (allRegisteredPCs.size > 0) {
      const connectedPCNames = new Set(clients.keys());
      
      allRegisteredPCs.forEach((pcConfig, pcName) => {
        // If this PC is not in the connected clients list, try to reconnect
        if (!connectedPCNames.has(pcName)) {
          log(`Heartbeat: Attempting to reconnect ${pcName} at ${pcConfig.ip}:${pcConfig.port}`);
          
          const clientUrl = `ws://${pcConfig.ip}:${pcConfig.port}`;
          const ws = new WebSocket(clientUrl);
          
          const setupClientHandlers = () => {
            ws.on("message", (raw) => {
              try {
                const msg = JSON.parse(raw);

                if (msg.type === "REGISTER") {
                  ws.simId = msg.simId;
                  clients.set(msg.simId, { ws, apps: [], pcName: pcName });
                  clients.set(pcName, { ws, apps: [], pcName: pcName });
                  log(`[Heartbeat Reconnect] Registered: ${msg.simId} (${msg.hostname})`);
                  
                  // Remove this PC from discovered list since it's now connected
                  if (pcConfig.ip && discoveredPCs.has(pcConfig.ip)) {
                    const removed = discoveredPCs.get(pcConfig.ip);
                    discoveredPCs.delete(pcConfig.ip);
                    log(`[PC Discovery] Removed reconnected PC from unknown list: ${pcConfig.ip} (${removed.mac})`);
                    
                    // Send updated discovered PCs list to renderer
                    if (win && !win.isDestroyed()) {
                      win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
                      log(`[PC Discovery] Sent updated list - ${discoveredPCs.size} unknown PCs remaining`);
                    }
                  }
                  
                  if (win) win.webContents.send("clients", [...clients.keys()]);
                }

                if (msg.type === "HEARTBEAT_PONG") {
                  // Client is alive
                  log(`Heartbeat response from ${msg.simId}`);
                }

                if (msg.type === "APPS_LIST") {
                  const client = clients.get(msg.simId) || clients.get(pcName);
                  if (client) {
                    client.apps = msg.apps;
                    log(`Received ${msg.apps.length} apps from ${msg.simId}`);
                    if (win) win.webContents.send("apps-updated", {
                      simId: msg.simId,
                      pcName: pcName,
                      apps: msg.apps
                    });
                  }
                }
              } catch (error) {
                log(`Error parsing message: ${error.message}`);
              }
            });

            ws.on("close", () => {
              if (ws.simId) {
                clients.delete(ws.simId);
                clients.delete(pcName);
                clientConnections.delete(ws.simId);
                log(`[Heartbeat] Disconnected: ${ws.simId}`);
                if (win) win.webContents.send("clients", [...clients.keys()]);
              }
            });

            ws.on("error", (error) => {
              log(`[Heartbeat] Connection error for ${pcName}: ${error.message}`);
            });
          };
          
          ws.on("open", () => {
            log(`[Heartbeat] Connected to ${pcName}`);
            ws.send(JSON.stringify({
              type: "SET_NAME",
              name: pcName
            }));
            setupClientHandlers();
            clientConnections.set(pcName, ws);
          });
          
          ws.on("error", (error) => {
            log(`[Heartbeat] Failed to connect to ${pcName}: ${error.message}`);
          });
        }
      });
    }
  } catch (error) {
    log(`Heartbeat error: ${error.message}`);
  }
}

// Start the heartbeat mechanism
function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  // Start heartbeat that runs periodically
  heartbeatInterval = setInterval(() => {
    heartbeat();
  }, HEARTBEAT_INTERVAL);
  
  log("Heartbeat mechanism started (interval: " + HEARTBEAT_INTERVAL + "ms)");
}

// Connect to all configured clients
async function connectToClients() {
  log("Loading client configurations from API...");
  
  // Disconnect from previous connections
  clientConnections.forEach(ws => {
    try {
      ws.close();
    } catch (e) {}
  });
  clientConnections.clear();
  clients.clear();
  
  // Fetch clients from API instead of config
  const clients_list = await fetchClientsFromAPI();
  
  if (!clients_list || clients_list.length === 0) {
    log("No clients configured in API");
    return;
  }

  // Store all PCs for heartbeat mechanism
  allRegisteredPCs.clear();
  clients_list.forEach(cfg => {
    allRegisteredPCs.set(cfg.simId, cfg);
  });
  log(`Stored ${allRegisteredPCs.size} PCs for heartbeat monitoring`);

  // Connect to each client from API
  clients_list.forEach(clientConfig => {
    const { simId, ip, port } = clientConfig;
    const clientUrl = `ws://${ip}:${port}`;
    
    log(`Connecting to client ${simId} at ${clientUrl}...`);
    
    const ws = new WebSocket(clientUrl);
    
    const setupClientHandlers = () => {
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw);

          if (msg.type === "REGISTER") {
            ws.simId = msg.simId;
            // Store with both the registered simId and the PC name as keys
            clients.set(msg.simId, { ws, apps: [], pcName: simId });
            clients.set(simId, { ws, apps: [], pcName: simId }); // Also store by PC name for lookup
            log(`Registered: ${msg.simId} (${msg.hostname})`);
            
            // Remove this PC from discovered list since it's now connected
            if (ip && discoveredPCs.has(ip)) {
              const removed = discoveredPCs.get(ip);
              discoveredPCs.delete(ip);
              log(`[PC Discovery] Removed connected PC from unknown list: ${ip} (${removed.mac})`);
              
              // Send updated discovered PCs list to renderer
              if (win && !win.isDestroyed()) {
                win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
                log(`[PC Discovery] Sent updated list - ${discoveredPCs.size} unknown PCs remaining`);
              }
            }
            
            if (win) win.webContents.send("clients", [...clients.keys()]);
          }

          if (msg.type === "HEARTBEAT_PONG") {
            // Client responded to heartbeat - it's alive
            log(`Heartbeat response from ${msg.simId}`);
          }

          if (msg.type === "APPS_LIST") {
            const client = clients.get(msg.simId) || clients.get(simId);
            if (client) {
              client.apps = msg.apps;
              log(`Received ${msg.apps.length} apps from ${msg.simId}`);
              if (win) win.webContents.send("apps-updated", {
                simId: msg.simId,
                pcName: simId,  // Send PC name so renderer can match
                apps: msg.apps
              });
            }
          }
        } catch (error) {
          log(`Error parsing message: ${error.message}`);
        }
      });

      ws.on("close", () => {
        if (ws.simId) {
          clients.delete(ws.simId);
          clients.delete(simId); // Also delete by PC name
          clientConnections.delete(ws.simId);
          log(`Disconnected: ${ws.simId} - Heartbeat will attempt reconnection`);
          if (win) win.webContents.send("clients", [...clients.keys()]);
        }
        // Don't reconnect here - let the heartbeat mechanism handle it
      });

      ws.on("error", (error) => {
        log(`Connection error for ${simId}: ${error.message}`);
      });
    };
    
    ws.on("open", () => {
      log(`Connected to client ${simId}`);
      // Send the expected PC name from API to client
      ws.send(JSON.stringify({
        type: "SET_NAME",
        name: simId
      }));
      log(`Sent PC name to client: ${simId}`);
      setupClientHandlers();
      clientConnections.set(simId, ws);
    });
    
    ws.on("error", (error) => {
      log(`Failed to connect to ${simId}: ${error.message}`);
      // Heartbeat will handle reconnection attempts
    });
  });

  // Start heartbeat after initial connection attempt
  startHeartbeat();
}

app.on('window-all-closed', () => {
  // Cleanup heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  // Cleanup any remaining connections
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  clientConnections.forEach(ws => {
    try {
      ws.close();
    } catch (e) {}
  });
  clientConnections.clear();
});

