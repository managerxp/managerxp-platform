const { app, BrowserWindow, ipcMain, screen } = require("electron");
const WebSocket = require("ws");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");

const SIM_ID = "SIM-01";
const SERVER_URL = "ws://localhost:8080";

let win;
let statusBarWin;
let timerCardWin;
let ws;
let runningProcesses = new Map(); // appName -> { pid, appPath, timerCardWin }

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  
  // Create status bar overlay window
  statusBarWin = new BrowserWindow({
    width: width,
    height: 70,
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
    height: 400,
    y: 100,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("index.html");
}

function log(message) {
  if (win) win.webContents.send("log", message);
}

function updateStatus(status) {
  if (win) win.webContents.send("status", status);
  if (statusBarWin) statusBarWin.webContents.send("status", status);
}

function createTimerCard(appName, timerMinutes) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  const timerCard = new BrowserWindow({
    width: 150,
    height: 100,
    x: width - 170,  // 20px from right edge
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

function connect() {
  log("Connecting to server...");
  ws = new WebSocket(SERVER_URL);

  ws.on("open", async () => {
    log("Connected to VMS");
    updateStatus("CONNECTED");

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
  });

  ws.on("close", () => {
    log("Disconnected. Reconnecting...");
    updateStatus("DISCONNECTED");
    setTimeout(connect, 3000);
  });

  ws.on("error", () => {
    win.webContents.send("status", "DISCONNECTED");
  });

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    
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
      getInstalledApps()
        .then(apps => {
          ws.send(JSON.stringify({
            type: "APPS_LIST",
            simId: SIM_ID,
            apps: apps
          }));
          log("Apps list refreshed and sent");
        })
        .catch(err => {
          log(`Error refreshing apps: ${err.message}`);
        });
    }
    
    if (msg.type === "CLOSE_APP") {
      log(`Closing application: ${msg.appName}`);
      closeApplication(msg.appName);
    }
  });
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
  createWindow();
  connect();
});

/* ---- HEARTBEAT ---- */
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "HEARTBEAT" }));
  }
}, 5000);
