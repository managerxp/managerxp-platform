const { app, BrowserWindow, ipcMain } = require("electron");
const WebSocket = require("ws");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");

const SIM_ID = "SIM-01";
const SERVER_URL = "ws://localhost:8080";

let win;
let ws;
let runningProcesses = new Map(); // appName -> { pid, appPath }

function createWindow() {
  win = new BrowserWindow({
    width: 600,
    height: 400,
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
    win.webContents.send("status", "CONNECTED");

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
    win.webContents.send("status", "DISCONNECTED");
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
        
        // Store the process info
        if (child.pid) {
          runningProcesses.set(msg.appName, {
            pid: child.pid,
            appPath: msg.appPath
          });
          log(`Tracking process PID: ${child.pid}`);
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
    // Try to close by PID and also kill child processes
    const pid = processInfo.pid;
    const command = `powershell -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | ForEach-Object { $processName = $_.ProcessName; $_.Kill(); Write-Output \\"Killed process: $processName (PID: ${pid})\\" }; Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`;
    
    exec(command, (err, stdout, stderr) => {
      if (err) {
        log(`Process ${pid} may have already exited`);
        // Try alternative method - close by executable name
        closeByExecutableName(processInfo.appPath, appName);
      } else {
        log(`Successfully closed: ${appName} (PID: ${pid})`);
        runningProcesses.delete(appName);
      }
    });
  } else {
    // No tracked PID, try to close by executable name
    log(`No tracked PID for ${appName}, trying by executable name...`);
    closeByExecutableName(null, appName);
  }
}

function closeByExecutableName(appPath, appName) {
  let exeName = appName.split(' ')[0];
  
  // If we have the path, extract the actual executable name
  if (appPath) {
    const pathParts = appPath.split(/[\\/]/);
    const executable = pathParts[pathParts.length - 1];
    exeName = executable.replace('.exe', '');
  }
  
  // Try multiple methods to close the application
  const command = `powershell -Command "
    $found = $false;
    Get-Process -Name '${exeName}' -ErrorAction SilentlyContinue | ForEach-Object { 
      $_.Kill(); 
      Write-Output \\"Killed: ${exeName}\\";
      $found = $true;
    };
    if (-not $found) {
      Get-Process | Where-Object { $_.ProcessName -like '*${exeName}*' } | ForEach-Object {
        $_.Kill();
        Write-Output \\"Killed: $($_.ProcessName)\\";
        $found = $true;
      };
    };
    if (-not $found) {
      Write-Output \\"No process found matching: ${exeName}\\";
    }
  "`;
  
  exec(command, (err, stdout, stderr) => {
    if (stdout) {
      log(stdout.trim());
    }
    if (err && !stdout.includes('Killed')) {
      log(`Could not find process for: ${appName}`);
    }
    runningProcesses.delete(appName);
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
