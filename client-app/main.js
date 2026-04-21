const { app, BrowserWindow, ipcMain, screen, Menu } = require("electron");
const WebSocket = require("ws");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const http = require("http");

let SIM_ID = "SIM-01"; // Will be updated by server
const CLIENT_PORT = 9090; // Port this client listens on
const SERVER_APP_PORT = 3334; // Server app HTTP port for discovery
let LOCAL_IP = null; // Will be set on startup
let BROADCAST_INTERVAL = null; // For periodic IP/MAC broadcasts

let win;
let statusBarWin;
let timerCardWin;
let wss; // WebSocket server instance (client listens)
let serverConnection; // Connection from server
let runningProcesses = new Map(); // appName -> { pid, appPath, timerCardWin }

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  
  // Create status bar overlay window
  statusBarWin = new BrowserWindow({
    width: width,
    height: 60,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  statusBarWin.loadFile("statusbar.html");
  statusBarWin.setAlwaysOnTop(true, 'screen-saver');
  
  // IPC handler for hiding status bar
  ipcMain.on('hide-statusbar', () => {
    if (statusBarWin && !statusBarWin.isDestroyed()) {
      statusBarWin.hide();
    }
  });
  
  ipcMain.on('show-statusbar', () => {
    if (statusBarWin && !statusBarWin.isDestroyed()) {
      statusBarWin.show();
    }
  });
  
  // IPC handler for timer expiry - close the app
  ipcMain.on('timer-expired', (event, appName) => {
    log(`Timer expired for ${appName}, closing application...`);
    closeApplication(appName);
  });
  
  // Create main client application window
  win = new BrowserWindow({
    width: 600,
    height: 600,
    minWidth: 550,
    minHeight: 550,
    y: 100,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Remove the application menu
  Menu.setApplicationMenu(null);

  win.loadFile("index.html");
}

function log(message) {
  if (win) win.webContents.send("log", message);
}

function updateStatus(status) {
  if (win) win.webContents.send("status", status);
  if (statusBarWin) statusBarWin.webContents.send("status", status);
}

// Get the local IP address of the system
function getLocalIPAddress() {
  try {
    const interfaces = os.networkInterfaces();
    
    // Try to find the first non-internal IPv4 address
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      for (const addr of iface) {
        // Find IPv4 addresses that are not internal (loopback)
        if (addr.family === 'IPv4' && !addr.internal) {
          log(`Found local IP address: ${addr.address} on interface: ${name}`);
          return addr.address;
        }
      }
    }
    
    // Fallback: return localhost
    log('Warning: No local IP found, using localhost');
    return '127.0.0.1';
  } catch (error) {
    log(`Error getting local IP address: ${error.message}`);
    return '127.0.0.1';
  }
}

// Broadcast PC information to server app for auto-discovery
function broadcastPCInfo() {
  try {
    const macAddress = getSystemMacAddress();
    const localIP = LOCAL_IP;
    const hostname = os.hostname();

    const payload = JSON.stringify({
      type: 'PC_DISCOVERY',
      ip_address: localIP,
      mac_address: macAddress,
      hostname: hostname,
      port: CLIENT_PORT
    });

    const options = {
      hostname: 'localhost',
      port: SERVER_APP_PORT,
      path: '/api/pc-discovery',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          log(`✓ PC broadcast successful - IP: ${localIP}, MAC: ${macAddress}`);
        } else {
          log(`✗ PC broadcast failed - Status: ${res.statusCode}`);
        }
      });
    });

    req.on('error', (error) => {
      log(`⚠ Broadcast error: ${error.message}`);
    });

    req.setTimeout(3000);
    req.write(payload);
    req.end();
  } catch (error) {
    log(`Error broadcasting PC info: ${error.message}`);
  }
}

// Get the MAC address of the system
function getSystemMacAddress() {
  try {
    const interfaces = os.networkInterfaces();
    
    // Try to find the first non-internal, active interface with a MAC address
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      
      // Skip loopback and internal interfaces
      if (iface[0]?.family === 'IPv4' && !iface[0]?.internal) {
        const macAddress = iface[0]?.mac;
        if (macAddress && macAddress !== '00:00:00:00:00:00') {
          log(`Found MAC address: ${macAddress} on interface: ${name}`);
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
          log(`Found fallback MAC address: ${macAddress} on interface: ${name}`);
          return macAddress;
        }
      }
    }
    
    log('Warning: No valid MAC address found, using default');
    return 'unknown';
  } catch (error) {
    log(`Error getting MAC address: ${error.message}`);
    return 'error';
  }
}

function createTimerCard(appName, timerMinutes) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  const timerCard = new BrowserWindow({
    width: 190,
    height: 130,
    x: width - 210,  // 20px from right edge
    y: 20,           // 20px from top
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  timerCard.loadFile("timercard.html");
  timerCard.setAlwaysOnTop(true, 'floating');
  
  // Send timer data once window is ready
  timerCard.webContents.once('did-finish-load', () => {
    timerCard.webContents.send("start-timer", {
      appName: appName,
      minutes: timerMinutes
    });
  });

  return timerCard;
}

function getInstalledApps() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, "get_apps.ps1");
    const outputDir = path.join(__dirname, "output");
    const outputFile = path.join(outputDir, "apps.json");

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { cwd: __dirname },
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        try {
          const data = fs.readFileSync(outputFile, "utf8");
          const apps = JSON.parse(data);
          resolve(apps);
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    );
  });
}

function listen() {
  log("Starting WebSocket server on port " + CLIENT_PORT + "...");
  
  wss = new WebSocket.Server({ port: CLIENT_PORT, host: '0.0.0.0' });
  
  wss.on("connection", async (ws) => {
    serverConnection = ws;
    log("Connected to VMS Server");
    updateStatus("CONNECTED");

    // Listen for server to send the PC name
    ws.on("message", async (raw) => {
      const msg = JSON.parse(raw);
      
      // Handle SET_NAME message from server
      if (msg.type === "SET_NAME") {
        SIM_ID = msg.name;
        log(`PC name set to: ${SIM_ID}`);
        
        // Send PC name to renderer
        if (win) win.webContents.send("pc-name", SIM_ID);
        if (statusBarWin) statusBarWin.webContents.send("pc-name", SIM_ID);
        
        // Register this client with the server using the provided name
        ws.send(JSON.stringify({
          type: "REGISTER",
          simId: SIM_ID,
          hostname: os.hostname()
        }));
        
        // Fetch and send installed apps to server
        try {
          log("Fetching installed applications...");
          const apps = await getInstalledApps();
          log(`Found ${apps.length} applications`);
          
          ws.send(JSON.stringify({
            type: "APPS_LIST",
            simId: SIM_ID,
            apps: apps
          }));
          
          log("Apps list sent to server");
        } catch (err) {
          log(`Error fetching apps: ${err.message}`);
        }
        
        return; // Don't process this as a command message
      }

      // Handle other messages
      
      if (msg.type === "COMMAND") {
        log(`Command received: ${msg.command}`);
      }
      
      
      if (msg.type === "LAUNCH_APP") {
        log(`Launching: ${msg.appName}`);
        if (msg.appPath) {
          const child = exec(`"${msg.appPath}"`, (err) => {
            if (err) {
              log(`Error launching app: ${err.message}`);
            } else {
              log(`Successfully launched: ${msg.appName}`);
            }
          });
          
          // Store the process info with timer card if timer is set
          if (child.pid) {
            const processInfo = {
              pid: child.pid,
              appPath: msg.appPath,
              timerCardWin: null
            };
            
            // Create timer card if timer is set
            if (msg.timerMinutes && msg.timerMinutes > 0) {
              processInfo.timerCardWin = createTimerCard(msg.appName, msg.timerMinutes);
            }
            
            runningProcesses.set(msg.appName, processInfo);
            log(`Tracking process PID: ${child.pid}${msg.timerMinutes ? ` with ${msg.timerMinutes} min timer` : ''}`);
          }
        }
      }
      
      if (msg.type === "REFRESH_APPS") {
        log("Refreshing apps list...");
        try {
          const apps = await getInstalledApps();
          ws.send(JSON.stringify({
            type: "APPS_LIST",
            simId: SIM_ID,
            apps: apps
          }));
          log("Apps list refreshed and sent");
        } catch (err) {
          log(`Error refreshing apps: ${err.message}`);
        }
      }
      
      if (msg.type === "CLOSE_APP") {
        log(`Closing application: ${msg.appName}`);
        closeApplication(msg.appName);
      }
      
      if (msg.type === "GET_MAC_ADDRESS") {
        const macAddress = getSystemMacAddress();
        log(`Sending MAC address: ${macAddress}`);
        ws.send(JSON.stringify({
          type: "MAC_ADDRESS",
          macAddress: macAddress
        }));
      }
    });

    ws.on("close", () => {
      log("Disconnected from server. Waiting for reconnection...");
      updateStatus("DISCONNECTED");
      serverConnection = null;
    });

    ws.on("error", (err) => {
      log(`WebSocket error: ${err.message}`);
      updateStatus("DISCONNECTED");
    });
  });

  wss.on("error", (err) => {
    log(`Server error: ${err.message}`);
  });

  log(`WebSocket server listening on ws://0.0.0.0:${CLIENT_PORT}`);
}

function closeApplication(appName) {
  const processInfo = runningProcesses.get(appName);
  
  if (processInfo) {
    log(`Closing tracked application: ${appName}`);
    
    // Close timer card if exists
    if (processInfo.timerCardWin && !processInfo.timerCardWin.isDestroyed()) {
      processInfo.timerCardWin.close();
      log(`Timer card closed for: ${appName}`);
    }
    
    // Remove from tracking first to avoid duplicate close attempts
    runningProcesses.delete(appName);
    
    // Close the actual application
    closeByExecutableName(processInfo.appPath, appName);
  } else {
    log(`No tracked process info for ${appName}, attempting close by name...`);
    closeByExecutableName(null, appName);
  }
}

function closeByExecutableName(appPath, appName) {
  let exeName = appName;
  
  // If we have the path, extract the actual executable name
  if (appPath) {
    const pathParts = appPath.split(/[\\/]/);
    const executable = pathParts[pathParts.length - 1];
    exeName = executable.replace(/\.exe$/i, '');
    log(`Extracted executable name from path: ${exeName}`);
  } else {
    // Try to extract from app name (take first word)
    exeName = appName.split(' ')[0];
    log(`Using app name for close: ${exeName}`);
  }
  
  // Use taskkill for reliable closing
  const command = `taskkill /F /IM "${exeName}.exe" /T`;
  
  exec(command, (err, stdout, stderr) => {
    if (err) {
      // taskkill couldn't find the process or failed
      if (stderr && stderr.includes('not found')) {
        log(`No running process found for: ${exeName}`);
      } else {
        log(`Taskkill failed for ${exeName}, trying PowerShell...`);
        
        // Fallback to PowerShell
        const psCommand = `powershell -Command "Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue | Stop-Process -Force; if ($?) { Write-Output 'Success' } else { Write-Output 'Not found' }"`;
        
        exec(psCommand, (psErr, psStdout, psStderr) => {
          if (psStdout && psStdout.includes('Success')) {
            log(`Successfully closed ${appName} via PowerShell`);
          } else {
            log(`Could not close ${appName}: Process not found`);
          }
        });
      }
    } else {
      // Success - taskkill worked
      const match = stdout.match(/SUCCESS/i);
      if (match) {
        log(`Successfully closed ${appName} (taskkill)`);
      }
    }
  });
}

app.whenReady().then(() => {
  // Get local IP on startup
  LOCAL_IP = getLocalIPAddress();
  
  createWindow();
  listen();
  
  // Start broadcasting PC info every 10 seconds
  BROADCAST_INTERVAL = setInterval(() => {
    broadcastPCInfo();
  }, 10000);
  
  // Initial broadcast immediately
  broadcastPCInfo();
});

/* ---- HEARTBEAT ---- */
setInterval(() => {
  if (serverConnection && serverConnection.readyState === WebSocket.OPEN) {
    serverConnection.send(JSON.stringify({ type: "HEARTBEAT" }));
  }
}, 5000);
