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
let cachedApps = null; // Cache for installed apps
let lastAppsCacheTime = 0;
const APPS_CACHE_DURATION = 5000; // Cache for 5 seconds to avoid duplicate PowerShell calls
let userToken = null; // Store user authentication token
let userInfo = null; // Store authenticated user profile
let currentPage = 'welcome'; // Track current page
let currentStatus = 'DISCONNECTED'; // Track current connection status

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

  // IPC handler for page navigation
  ipcMain.on('navigate', (event, page) => {
    navigateToPage(page);
  });

  // IPC handler for storing authentication token
  ipcMain.on('store-token', (event, token) => {
    userToken = token;
    log(`User token stored`);
  });

  // IPC handler for storing authenticated user details
  ipcMain.on('store-user-info', (event, user) => {
    userInfo = user;
    log(`User info stored`);
  });

  // IPC handler for retrieving authentication token
  ipcMain.handle('get-token', async (event) => {
    return userToken;
  });

  // IPC handler for retrieving authenticated user details
  ipcMain.handle('get-user-info', async (event) => {
    return userInfo;
  });

  // IPC handler for getting PC name
  ipcMain.handle('get-pc-name', async (event) => {
    return SIM_ID;
  });

  // IPC handler for getting current connection status
  ipcMain.handle('get-status', async (event) => {
    return currentStatus;
  });
  
  // Create main client application window.
  // The customer portal is a full-screen experience — no title bar, no chrome.
  win = new BrowserWindow({
    fullscreen: true,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#050509', // matches the portal background, avoids a white flash
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // F11 toggles full screen so staff and testers are never trapped.
  // This is presentation only — it adds no kiosk lockdown of its own.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  // Remove the application menu
  Menu.setApplicationMenu(null);

  // Closing the portal shuts the client down, rather than leaving a headless
  // process holding the WebSocket port and broadcasting to nobody.
  win.on('closed', () => {
    win = null;
    app.quit();
  });

  currentPage = 'status';
  win.loadFile("index.html");
}

function navigateToPage(page) {
  if (!win || win.isDestroyed()) return;
  
  const pages = {
    'welcome': 'welcome.html',
    'login': 'login.html',
    'register': 'register.html',
    'userdashboard': 'userdashboard.html',
    'dashboard': 'index.html',
    'status': 'index.html'
  };

  const pageFile = pages[page] || 'welcome.html';
  currentPage = page;
  log(`Navigating to ${page} (${pageFile})`);
  
  win.loadFile(pageFile);
}

// A closed BrowserWindow is not null, it is destroyed — touching webContents
// on it throws. Every send goes through these guards.
function alive(target) {
  return !!target && !target.isDestroyed();
}

function sendToWindow(target, channel, payload) {
  if (!alive(target)) return;
  try {
    target.webContents.send(channel, payload);
  } catch (err) {
    // The window can be torn down between the check and the send.
    console.warn(`[send] ${channel} dropped: ${err.message}`);
  }
}

function log(message) {
  sendToWindow(win, "log", message);
}

function updateStatus(status) {
  currentStatus = status; // Update current status

  sendToWindow(win, "status", status);
  sendToWindow(statusBarWin, "status", status);
  
  // Navigate to welcome page when connected
  if (status === "CONNECTED" && currentPage === 'status') {
    setTimeout(() => {
      navigateToPage('welcome');
    }, 500);
  }
  
  // Navigate back to the home/logs page when disconnected
  if (status === "DISCONNECTED" && currentPage !== 'status') {
    setTimeout(() => {
      log("PC disconnected, navigating back to home page");
      navigateToPage('status');
    }, 500);
  }
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

  // Mirror the same event to the customer portal so it can show the countdown
  // in its navigation bar. Display only — the timer card remains the window
  // that reports expiry back to the main process.
  sendToWindow(win, "start-timer", { appName: appName, minutes: timerMinutes });

  return timerCard;
}

function getInstalledApps() {
  return new Promise((resolve, reject) => {
    // Return cached apps if still fresh
    const now = Date.now();
    if (cachedApps && (now - lastAppsCacheTime) < APPS_CACHE_DURATION) {
      log(`✅ Using cached apps (${cachedApps.length} items)`);
      resolve(cachedApps);
      return;
    }

    const scriptPath = path.join(__dirname, "get_apps.ps1");
    const outputDir = path.join(__dirname, "output");
    const outputFile = path.join(outputDir, "apps.json");

    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = 1;

    const executeScript = () => {
      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${scriptPath}"`,
        { cwd: __dirname, timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
        (err) => {
          const duration = Date.now() - startTime;
          
          if (err) {
            log(`❌ PowerShell error (${duration}ms): ${err.message}`);
            if (retryCount < maxRetries) {
              retryCount++;
              log(`🔄 Retrying PowerShell execution (attempt ${retryCount}/${maxRetries})...`);
              setTimeout(executeScript, 500); // Retry after 500ms
            } else {
              reject(err);
            }
            return;
          }
          
          // Add delay to ensure file is fully written
          setTimeout(() => {
            try {
              if (!fs.existsSync(outputFile)) {
                reject(new Error('Output file not created by PowerShell script'));
                return;
              }
              
              const fileStats = fs.statSync(outputFile);
              log(`📄 Output file size: ${fileStats.size} bytes`);
              
              const data = fs.readFileSync(outputFile, "utf8");
              const apps = JSON.parse(data);
              
              // Cache the result
              cachedApps = apps;
              lastAppsCacheTime = Date.now();
              
              log(`✅ Parsed ${apps.length} apps (${duration}ms)`);
              resolve(apps);
            } catch (parseErr) {
              log(`❌ Parse error (${duration}ms): ${parseErr.message}`);
              reject(parseErr);
            }
          }, 500); // Wait 500ms for file to be fully written
        }
      );
    };

    executeScript();
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
        sendToWindow(win, "pc-name", SIM_ID);
        sendToWindow(statusBarWin, "pc-name", SIM_ID);
        
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
          // Tell the portal a launch started so it can show its transition.
          // Purely a UI notification; the launch itself is unchanged.
          sendToWindow(win, "app-launching", { appName: msg.appName });

          const child = exec(`"${msg.appPath}"`, (err) => {
            if (err) {
              log(`Error launching app: ${err.message}`);
              sendToWindow(win, "app-launch-failed", { appName: msg.appName, error: err.message });
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
          // Force fresh fetch for refresh
          cachedApps = null;
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
      
      if (msg.type === "GET_SOFTWARE_LIST") {
        log("Fetching software list...");
        try {
          const startTime = Date.now();
          // Force fresh fetch, bypass cache for software list requests
          cachedApps = null;
          const apps = await getInstalledApps();
          const duration = Date.now() - startTime;
          log(`Fetched ${apps.length} apps in ${duration}ms`);
          
          const software = apps.map(app => ({
            name: app.name,
            version: app.version,
            path: app.launch
          }));
          
          const message = {
            type: "SOFTWARE_LIST",
            simId: SIM_ID,
            software: software,
            count: software.length
          };
          
          ws.send(JSON.stringify(message));
          log(`✅ Software list sent: ${software.length} items`);
        } catch (err) {
          log(`❌ Error fetching software: ${err.message}`);
          ws.send(JSON.stringify({
            type: "SOFTWARE_LIST",
            simId: SIM_ID,
            software: [],
            error: err.message
          }));
        }
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

    // Let the portal show its session-ended screen. Notification only.
    sendToWindow(win, "app-closed", { appName: appName });

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

// Stop the discovery broadcast on the way out so it cannot fire against
// windows that are already gone.
app.on('before-quit', () => {
  if (BROADCAST_INTERVAL) {
    clearInterval(BROADCAST_INTERVAL);
    BROADCAST_INTERVAL = null;
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

/* ---- HEARTBEAT ---- */
setInterval(() => {
  if (serverConnection && serverConnection.readyState === WebSocket.OPEN) {
    serverConnection.send(JSON.stringify({ type: "HEARTBEAT" }));
  }
}, 5000);
