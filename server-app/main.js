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
let pcConnectionStats = new Map(); // Track connection failures: pcName -> { failures, lastError, lastAttempt }
let heartbeatInterval = null;
let pcRefreshInterval = null; // Periodic PC list refresh
const HEARTBEAT_INTERVAL = 5000; // Send heartbeat every 5 seconds
const RECONNECT_INTERVAL = 10000; // Try to reconnect dead clients every 10 seconds
const PC_REFRESH_INTERVAL = 15000; // Check for new PCs every 15 seconds
const MAX_FAILED_ATTEMPTS = 3; // Mark as failed after 3 attempts

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
  loginWin.show(); // Ensure the window is shown
  loginWin.focus(); // Focus on the login window
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

// Track connection failure and update UI with status
function recordConnectionFailure(pcName, error) {
  if (!pcConnectionStats.has(pcName)) {
    pcConnectionStats.set(pcName, { failures: 0, lastError: null, lastAttempt: null });
  }
  
  const stats = pcConnectionStats.get(pcName);
  stats.failures++;
  stats.lastError = error.message || String(error);
  stats.lastAttempt = new Date().toISOString();
  
  log(`[Connection Stats] ${pcName}: ${stats.failures} failed attempts - ${stats.lastError}`);
  
  // Send status to UI
  if (win && !win.isDestroyed()) {
    win.webContents.send('pc-connection-status', {
      pcName: pcName,
      status: 'failed',
      failures: stats.failures,
      maxFailures: MAX_FAILED_ATTEMPTS,
      error: stats.lastError
    });
  }
}

// Record successful connection
function recordConnectionSuccess(pcName) {
  if (pcConnectionStats.has(pcName)) {
    pcConnectionStats.delete(pcName);
  }
  
  log(`[Connection Stats] ${pcName}: ✅ Connected successfully`);
  
  // Send status to UI
  if (win && !win.isDestroyed()) {
    win.webContents.send('pc-connection-status', {
      pcName: pcName,
      status: 'connected',
      failures: 0
    });
  }
}

// Get connection status for all PCs
function getConnectionStatus() {
  const status = {};
  allRegisteredPCs.forEach((pcConfig, pcName) => {
    const isConnected = clients.has(pcName);
    const stats = pcConnectionStats.get(pcName);
    status[pcName] = {
      name: pcName,
      ip: pcConfig.ip,
      port: pcConfig.port,
      connected: isConnected,
      failures: stats?.failures || 0,
      lastError: stats?.lastError || null,
      lastAttempt: stats?.lastAttempt || null
    };
  });
  return status;
}

// Get list of connected PC names (unique, not simIds)
function getConnectedPCNames() {
  const connectedPCNames = new Set();
  clients.forEach((clientData) => {
    if (clientData.pcName) {
      connectedPCNames.add(clientData.pcName);
    }
  });
  return Array.from(connectedPCNames);
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
      
      req.on('end', async () => {
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
              // AUTO-UPDATE: Try to auto-update IP in backend if MAC exists
              try {
                const authState = authContext.getAuthState();
                if (authState && authState.token) {
                  console.log(`[PC Auto-Update] Checking if MAC ${mac_address} exists in database...`);
                  
                  const checkResponse = await fetch('http://localhost:5000/api/pcs/check-exists', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${authState.token}`
                    },
                    body: JSON.stringify({
                      ip_address: ip_address,
                      mac_address: mac_address
                    })
                  });
                  
                  if (checkResponse.ok) {
                    const checkResult = await checkResponse.json();
                    
                    if (checkResult.exists) {
                      console.log(`[PC Auto-Update] ✅ PC found in database with MAC ${mac_address}`);
                      const pcName = checkResult.pc_name || checkResult.name || `PC-${mac_address.substring(mac_address.length - 5)}`;
                      
                      if (checkResult.ip_updated) {
                        console.log(`[PC Auto-Update] 🔄 IP auto-updated for MAC ${mac_address}`);
                        // Remove from discovered list since it's been auto-updated
                        discoveredPCs.delete(ip_address);
                        
                        // Send updated discovered PCs list to renderer
                        if (win && !win.isDestroyed()) {
                          win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
                          console.log(`[PC Discovery] Updated discovered PCs list - Total: ${discoveredPCs.size}`);
                        }
                        
                        // UPDATE: Now register the PC in allRegisteredPCs and attempt auto-connection
                        const portNumber = port || 9090;
                        allRegisteredPCs.set(pcName, {
                          simId: pcName,
                          ip: ip_address,
                          port: portNumber
                        });
                        console.log(`[PC Auto-Update] 📋 Registered PC in tracking: ${pcName}`);
                        
                        // Automatically connect to the newly updated PC WITHOUT requiring server restart
                        console.log(`[PC Auto-Update] 🔌 Initiating auto-connection to ${pcName} at ${ip_address}:${portNumber}`);
                        connectToSpecificPC(ip_address, portNumber, pcName);
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                          success: true, 
                          message: 'PC discovery received, IP auto-updated, and connection established',
                          auto_updated: true,
                          pc_name: pcName
                        }));
                        return;
                      } else {
                        console.log(`[PC Auto-Update] ℹ️ PC exists in database with same IP`);
                        // PC exists with same IP - register it and attempt connection
                        const portNumber = port || 9090;
                        allRegisteredPCs.set(pcName, {
                          simId: pcName,
                          ip: ip_address,
                          port: portNumber
                        });
                        
                        // If not already connected, attempt to connect
                        if (!clients.has(pcName)) {
                          console.log(`[PC Auto-Update] 🔌 Attempting connection to ${pcName} at ${ip_address}:${portNumber}`);
                          connectToSpecificPC(ip_address, portNumber, pcName);
                        } else {
                          console.log(`[PC Auto-Update] ✓ ${pcName} is already connected`);
                        }
                        
                        discoveredPCs.delete(ip_address);
                        
                        if (win && !win.isDestroyed()) {
                          win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
                        }
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                          success: true, 
                          message: 'PC already registered and connection attempted',
                          auto_updated: false,
                          pc_name: pcName
                        }));
                        return;
                      }
                    } else {
                      console.log(`[PC Auto-Update] ❌ PC not found in database - will add to discovered list`);
                    }
                  } else {
                    console.log(`[PC Auto-Update] Check failed, will add to discovered list`);
                  }
                } else {
                  console.log(`[PC Auto-Update] No auth token - will add to discovered list`);
                }
              } catch (checkError) {
                console.error(`[PC Auto-Update] Error checking PC:`, checkError.message);
                // Continue with discovery if check fails
              }
              
              // If we reach here, it's a new PC - add to discovered list
              discoveredPCs.set(ip_address, {
                ip: ip_address,
                mac: mac_address,
                hostname: hostname,
                port: port || 9090,
                discovered_at: new Date().toISOString()
              });
              
              console.log(`[PC Discovery] Added NEW PC to unknown list - Total: ${discoveredPCs.size}`);
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
    
    console.log('[Logout] User initiated logout');
    
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
        console.log('[Logout] Auth file deleted');
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
      console.log('[Logout] Closing main window');
      win.close();
    }
    
    // Create a fresh login window with a small delay to ensure main window is closed
    setTimeout(() => {
      console.log('[Logout] Creating login window');
      createLoginWindow();
    }, 500);
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

  // New IPC handler: Connect to a specific PC on demand
  ipcMain.handle("pc:connect-to-pc", async (event, { ip, port, pcName }) => {
    try {
      console.log(`[IPC] Received request to connect to PC: ${pcName} at ${ip}:${port}`);
      
      if (!ip || !port || !pcName) {
        return { success: false, error: 'Missing ip, port, or pcName' };
      }

      // Check if already connected
      if (clients.has(pcName)) {
        log(`PC ${pcName} is already connected`);
        return { success: true, message: 'Already connected', already_connected: true };
      }

      // Update allRegisteredPCs if not already there
      if (!allRegisteredPCs.has(pcName)) {
        allRegisteredPCs.set(pcName, { simId: pcName, ip: ip, port: port });
        log(`[IPC] Registered PC for tracking: ${pcName}`);
      }

      // Attempt connection
      connectToSpecificPC(ip, port, pcName);
      
      log(`[IPC] Connection attempt initiated for ${pcName}`);
      return { success: true, message: 'Connection attempt initiated' };
    } catch (error) {
      console.error('[IPC] Error in pc:connect-to-pc handler:', error);
      return { success: false, error: error.message };
    }
  });

  // New IPC handler: Reconnect all PCs
  ipcMain.handle("pc:reconnect-all", async (event) => {
    try {
      console.log(`[IPC] Received request to reconnect all PCs. Currently tracking: ${allRegisteredPCs.size} PCs`);
      
      let reconnectCount = 0;
      allRegisteredPCs.forEach((pcConfig, pcName) => {
        if (!clients.has(pcName)) {
          console.log(`[IPC] Attempting to reconnect: ${pcName}`);
          connectToSpecificPC(pcConfig.ip, pcConfig.port, pcName);
          reconnectCount++;
        }
      });

      log(`[IPC] Reconnection attempt initiated for ${reconnectCount} disconnected PCs`);
      return { success: true, message: `Reconnection initiated for ${reconnectCount} PCs`, reconnected: reconnectCount };
    } catch (error) {
      console.error('[IPC] Error in pc:reconnect-all handler:', error);
      return { success: false, error: error.message };
    }
  });

  // New IPC handler: Get connection status for all PCs
  ipcMain.handle("pc:get-connection-status", async (event) => {
    try {
      const status = getConnectionStatus();
      console.log('[IPC] Returning connection status for', Object.keys(status).length, 'PCs');
      return { success: true, data: status };
    } catch (error) {
      console.error('[IPC] Error in pc:get-connection-status handler:', error);
      return { success: false, error: error.message };
    }
  });

  // New IPC handler: Clear connection failures for a PC (for manual retry)
  ipcMain.handle("pc:clear-failures", async (event, { pcName }) => {
    try {
      if (pcConnectionStats.has(pcName)) {
        pcConnectionStats.delete(pcName);
        log(`[IPC] Cleared failure count for ${pcName}`);
      }
      return { success: true, message: `Cleared failures for ${pcName}` };
    } catch (error) {
      console.error('[IPC] Error in pc:clear-failures handler:', error);
      return { success: false, error: error.message };
    }
  });

  // New IPC handler: Manually refresh PC list and connect to new PCs
  ipcMain.handle("pc:refresh-list", async (event) => {
    try {
      console.log(`[IPC] Received request to refresh PC list`);
      await refreshPCList();
      return { success: true, message: 'PC list refreshed and new PCs will be connected', totalPCs: allRegisteredPCs.size };
    } catch (error) {
      console.error('[IPC] Error in pc:refresh-list handler:', error);
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

// Refresh PC list and connect to newly added PCs
async function refreshPCList() {
  try {
    const newPCsList = await fetchClientsFromAPI();
    
    if (!newPCsList || newPCsList.length === 0) {
      return;
    }

    let newPCsCount = 0;
    
    newPCsList.forEach(cfg => {
      const pcName = cfg.simId;
      
      // Check if this PC is new (not in our registry)
      if (!allRegisteredPCs.has(pcName)) {
        console.log(`[PC Refresh] 🆕 New PC detected: ${pcName} at ${cfg.ip}:${cfg.port}`);
        
        // Add to registry
        allRegisteredPCs.set(pcName, cfg);
        newPCsCount++;
        
        // Attempt to connect immediately
        console.log(`[PC Refresh] Attempting connection to new PC: ${pcName}`);
        connectToSpecificPC(cfg.ip, cfg.port, pcName);
      } else {
        // Check if IP changed
        const existingPC = allRegisteredPCs.get(pcName);
        if (existingPC.ip !== cfg.ip || existingPC.port !== cfg.port) {
          console.log(`[PC Refresh] 🔄 IP updated for ${pcName}: ${existingPC.ip}:${existingPC.port} → ${cfg.ip}:${cfg.port}`);
          
          // Update the config
          allRegisteredPCs.set(pcName, cfg);
          
          // Close old connection if exists
          const existingClient = clients.get(pcName);
          if (existingClient && existingClient.ws) {
            try {
              existingClient.ws.close();
              clients.delete(pcName);
              console.log(`[PC Refresh] Closed old connection for ${pcName}`);
            } catch (e) {}
          }
          
          // Clear failure stats for fresh reconnect
          pcConnectionStats.delete(pcName);
          
          // Attempt connection to new IP
          console.log(`[PC Refresh] Reconnecting ${pcName} with new IP...`);
          connectToSpecificPC(cfg.ip, cfg.port, pcName);
        }
      }
    });
    
    if (newPCsCount > 0) {
      log(`[PC Refresh] ✅ Detected ${newPCsCount} new PC(s) - attempting connections`);
      
      // Notify UI about refresh
      if (win && !win.isDestroyed()) {
        win.webContents.send('pc-list-refreshed', {
          newPCsFound: newPCsCount,
          totalPCs: allRegisteredPCs.size
        });
      }
    }
  } catch (error) {
    console.error(`[PC Refresh] Error refreshing PC list: ${error.message}`);
  }
}

// Start periodic PC list refresh
function startPCListRefresh() {
  if (pcRefreshInterval) {
    clearInterval(pcRefreshInterval);
  }
  
  // Refresh PC list periodically
  pcRefreshInterval = setInterval(() => {
    refreshPCList();
  }, PC_REFRESH_INTERVAL);
  
  log(`[PC Refresh] Started periodic PC list refresh (every ${PC_REFRESH_INTERVAL}ms)`);
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
          // Check if this PC has failed too many times
          const stats = pcConnectionStats.get(pcName);
          if (stats && stats.failures >= MAX_FAILED_ATTEMPTS) {
            log(`[Heartbeat] ⚠️  Skipping ${pcName} - ${stats.failures} failed attempts. Error: ${stats.lastError}`);
            log(`[Heartbeat] 💡 Tip: Check if IP ${pcConfig.ip} is correct. PC might be on different IP.`);
            return; // Skip this PC
          }
          
          log(`[Heartbeat] Attempting to reconnect ${pcName} at ${pcConfig.ip}:${pcConfig.port}`);
          
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
                  log(`[Heartbeat Reconnect] ✅ Registered: ${msg.simId} (${msg.hostname})`);
                  
                  // Record success
                  recordConnectionSuccess(pcName);
                  
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
                  
                  if (win) win.webContents.send("clients", getConnectedPCNames());
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
                if (win) win.webContents.send("clients", getConnectedPCNames());
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
            recordConnectionFailure(pcName, error);
          });
        }
      });
    }
  } catch (error) {
    log(`Heartbeat error: ${error.message}`);
  }
}

// Connect to a specific PC dynamically (used for auto-discovered/updated PCs)
function connectToSpecificPC(ip, port, pcName) {
  // Check if we're already connected to this PC
  if (clients.has(pcName)) {
    log(`PC ${pcName} is already connected`);
    return;
  }

  const clientUrl = `ws://${ip}:${port}`;
  log(`[Dynamic Connect] Attempting connection to ${pcName} at ${clientUrl}...`);
  
  const ws = new WebSocket(clientUrl);
  
  const setupClientHandlers = () => {
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === "REGISTER") {
          ws.simId = msg.simId;
          clients.set(msg.simId, { ws, apps: [], pcName: pcName });
          clients.set(pcName, { ws, apps: [], pcName: pcName });
          log(`[Dynamic Connect] ✅ Registered: ${msg.simId} (${msg.hostname})`);
          
          // Record success
          recordConnectionSuccess(pcName);
          
          // Remove from discovered list since it's now connected
          if (ip && discoveredPCs.has(ip)) {
            const removed = discoveredPCs.get(ip);
            discoveredPCs.delete(ip);
            log(`[PC Discovery] Removed newly connected PC from unknown list: ${ip} (${removed.mac})`);
            
            // Send updated discovered PCs list to renderer
            if (win && !win.isDestroyed()) {
              win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
              log(`[PC Discovery] Updated list - ${discoveredPCs.size} unknown PCs remaining`);
            }
          }
          
          if (win) win.webContents.send("clients", getConnectedPCNames());
        }

        if (msg.type === "HEARTBEAT_PONG") {
          log(`[Dynamic Connect] Heartbeat response from ${msg.simId}`);
        }

        if (msg.type === "APPS_LIST") {
          const client = clients.get(msg.simId) || clients.get(pcName);
          if (client) {
            client.apps = msg.apps;
            log(`[Dynamic Connect] Received ${msg.apps.length} apps from ${msg.simId}`);
            if (win) win.webContents.send("apps-updated", {
              simId: msg.simId,
              pcName: pcName,
              apps: msg.apps
            });
          }
        }
      } catch (error) {
        log(`[Dynamic Connect] Error parsing message: ${error.message}`);
      }
    });

    ws.on("close", () => {
      if (ws.simId) {
        clients.delete(ws.simId);
        clients.delete(pcName);
        clientConnections.delete(ws.simId);
        log(`[Dynamic Connect] Disconnected: ${ws.simId}`);
        if (win) win.webContents.send("clients", getConnectedPCNames());
      }
    });

    ws.on("error", (error) => {
      log(`[Dynamic Connect] Connection error for ${pcName}: ${error.message}`);
    });
  };
  
  ws.on("open", () => {
    log(`[Dynamic Connect] Connected to ${pcName}, sending SET_NAME...`);
    ws.send(JSON.stringify({
      type: "SET_NAME",
      name: pcName
    }));
    setupClientHandlers();
    clientConnections.set(pcName, ws);
  });
  
  ws.on("error", (error) => {
    log(`[Dynamic Connect] ❌ Failed to connect to ${pcName} at ${clientUrl}: ${error.message}`);
    recordConnectionFailure(pcName, error);
  });
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
            
            if (win) win.webContents.send("clients", getConnectedPCNames());
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
          if (win) win.webContents.send("clients", getConnectedPCNames());
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
  
  // Start periodic PC list refresh to detect newly added PCs
  startPCListRefresh();
}

app.on('window-all-closed', () => {
  // Cleanup heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  // Cleanup PC refresh
  if (pcRefreshInterval) {
    clearInterval(pcRefreshInterval);
    pcRefreshInterval = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  // Cleanup any remaining connections
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  // Cleanup PC refresh
  if (pcRefreshInterval) {
    clearInterval(pcRefreshInterval);
    pcRefreshInterval = null;
  }
  
  clientConnections.forEach(ws => {
    try {
      ws.close();
    } catch (e) {}
  });
  clientConnections.clear();
});

