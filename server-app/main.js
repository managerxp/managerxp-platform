const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const WebSocket = require("ws");
const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");
const dgram = require("dgram");   // Wake-on-LAN magic packets
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { Readable } = require("stream");
const authContext = require("./authContext");

// .env is optional — a fresh checkout or a machine where it was never copied
// still runs on the defaults below, exactly as it did before this existed.
try { process.loadEnvFile(path.join(__dirname, ".env")); } catch (e) { /* no .env on this machine */ }

let win;
let tokenServer; // HTTP token server instance
let clientConnections = new Map(); // simId -> ws connection to client
let handlersRegistered = false;
const clients = new Map(); // simId -> { ws, apps }
/* Which game launchers each station reported having installed. Kept in memory
   only: it is a live fact about a machine, re-sent on every reconnect, and a
   stale answer from a previous run would be worse than none. */
const stationLaunchers = new Map(); // pcName -> { Steam: {installed, path}, ... }
const stationSteamAuth = new Map(); // pcName -> { state, account, at }
let allRegisteredPCs = new Map(); // Track all registered PCs with their config for heartbeat
let discoveredPCs = new Map(); // Track auto-discovered PCs: ip_address -> { ip, mac, hostname, port, discovered_at }
let pcConnectionStats = new Map(); // Track connection failures: pcName -> { failures, lastError, lastAttempt }
let pendingSoftwareRequests = new Map(); // Track pending software requests: simId -> { resolve, reject, timeout }
let heartbeatInterval = null;
let pcRefreshInterval = null; // Periodic PC list refresh
const HEARTBEAT_INTERVAL = 5000; // Send heartbeat every 5 seconds
const RECONNECT_INTERVAL = 10000; // Try to reconnect dead clients every 10 seconds
const PC_REFRESH_INTERVAL = 15000; // Check for new PCs every 15 seconds
const MAX_FAILED_ATTEMPTS = 3; // Mark as failed after 3 attempts

// Create login window
function createLoginWindow() {
  if (!win || win.isDestroyed()) {
    console.log('[Navigation] Creating main window with login page');
    win = new BrowserWindow({
      width: 500,
      height: 600,
      minWidth: 400,
      minHeight: 500,
      frame: false,
      backgroundColor: '#07070b',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      },
      icon: path.join(__dirname, 'Images', 'icon.png')
    });

    // Remove the application menu
    Menu.setApplicationMenu(null);

    // Load the login page
    win.loadFile(path.join(__dirname, "login.html")).catch(err => {
      console.error('[Navigation] Error loading login page:', err);
    });
    
    // Keep the login window's maximise icon in step with the real state.
    const pushLoginMaximizeState = () => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('window:maximized-changed', win.isMaximized());
      }
    };
    win.on('maximize', pushLoginMaximizeState);
    win.on('unmaximize', pushLoginMaximizeState);

    // Show window when content is ready
    win.webContents.once('did-finish-load', () => {
      console.log('[Navigation] Login window content loaded, showing window');
      win.center();
      win.show();
      win.focus();
    });
    
    // Handle window close event
    win.on('closed', () => {
      console.log('[Navigation] Window closed');
      win = null;
      app.quit();
    });
  } else {
    console.log('[Navigation] Window exists, navigating to login page');
    // Relax the console's minimum before shrinking back to the login size.
    win.setMinimumSize(400, 500);
    win.setSize(500, 600);
    win.center();
    
    // Load the login page
    win.loadFile(path.join(__dirname, "login.html")).catch(err => {
      console.error('[Navigation] Error loading login page:', err);
    });
    
    // Show when ready
    win.webContents.once('did-finish-load', () => {
      console.log('[Navigation] Login page loaded');
      win.show();
      win.focus();
    });
  }
}

// Create/Navigate to main home window
function createWindow() {
  if (!win || win.isDestroyed()) {
    console.log('[Navigation] Creating main window with home page');
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1120,
      minHeight: 720,
      frame: false, // custom CafeXP title bar drawn in the topbar
      backgroundColor: '#07070b', // matches the console background, avoids a white flash
      show: false, // Don't show until ready
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      },
      icon: path.join(__dirname, 'Images', 'icon.png')
    });

    // Remove the application menu
    Menu.setApplicationMenu(null);

    // Load the home page
    win.loadFile(path.join(__dirname, "index.html")).catch(err => {
      console.error('[Navigation] Error loading home page:', err);
    });
    
    // Send user info to renderer when window loads
    win.webContents.once('did-finish-load', () => {
      console.log('[Navigation] Home window content loaded, showing window');
      win.center();
      win.show();
      win.focus();
      
      const authState = authContext.getAuthState();
      if (authState.isAuthenticated) {
        console.log('[Navigation] Sending user info to renderer');
        win.webContents.send('user:updated', authState);
        // Send discovered PCs list
        win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
      }
    });
    
    // Keep the custom title bar's maximise icon in step with the real state.
    const pushMaximizeState = () => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('window:maximized-changed', win.isMaximized());
      }
    };
    win.on('maximize', pushMaximizeState);
    win.on('unmaximize', pushMaximizeState);

    // Handle window close event
    win.on('closed', () => {
      console.log('[Navigation] Window closed');
      win = null;
      app.quit();
    });
  } else {
    console.log('[Navigation] Window exists, navigating to home page');
    win.setMinimumSize(1120, 720);
    win.setSize(1440, 900);
    win.center();
    
    // Load the home page
    win.loadFile(path.join(__dirname, "index.html")).catch(err => {
      console.error('[Navigation] Error loading home page:', err);
    });
    
    // When ready, show and send data
    win.webContents.once('did-finish-load', () => {
      console.log('[Navigation] Home page loaded');
      win.show();
      win.focus();
      
      const authState = authContext.getAuthState();
      if (authState.isAuthenticated) {
        console.log('[Navigation] Sending user info to renderer');
        win.webContents.send('user:updated', authState);
        win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
      }
    });
  }
  
  return win;
}

function log(msg) {
  if (win) win.webContents.send("log", msg);
}

/*
 * A station asked for something only the console can do (it holds the session
 * and the staff token). Rather than reach the backend from the main process —
 * which has no token — the request is handed to the renderer, which already
 * signs its API calls, resolves the session for that station and acts.
 *
 * Shared by every station connection handler so the three of them stay in
 * step. Returns true when the message was one of ours, so a caller can skip
 * the rest of its checks.
 */
function handleStationRequest(msg, ws) {
  const pcName = (ws && ws.simId) || msg.simId || null;
  if (!pcName) return false;

  if (msg.type === "EXTEND_REQUEST") {
    log(`[Extend] ${pcName} requested +${msg.blocks || 1} block`);
    if (win) win.webContents.send("station:extend-request", { pcName, blocks: msg.blocks || 1 });
    return true;
  }
  if (msg.type === "SESSION_OVERTIME") {
    log(`[Overtime] ${pcName} is past its block`);
    if (win) win.webContents.send("station:overtime", { pcName, appName: msg.appName || null });
    return true;
  }
  /* A customer tapped "Call staff" on the Help menu. No session or billing
     state is touched here — this is purely "a person needs a person",
     handed straight to the renderer to toast and flag on the floor. */
  if (msg.type === "CALL_STAFF") {
    log(`[Help] ${pcName} called staff`);
    if (win) win.webContents.send("station:call-staff", { pcName });
    return true;
  }
  /* A logged-in customer opened the "choose a game" screen while idle — send
     what they need to start their own session (the café's games and prices
     for this station), independent of whether one is already running. */
  if (msg.type === "REQUEST_START_OPTIONS") {
    if (win) win.webContents.send("station:start-options-request", { pcName });
    return true;
  }
  /* The customer picked a game and a price and tapped Start. */
  if (msg.type === "START_SESSION_REQUEST") {
    log(`[Self-start] ${pcName} requested a session (price #${msg.gaming_price_id}, customer #${msg.customer_id})`);
    if (win) win.webContents.send("station:start-request", {
      pcName, customer_id: msg.customer_id || null,
      gaming_price_id: msg.gaming_price_id || null,
      game_id: msg.game_id || null,
      game_platform_id: msg.game_platform_id || null,
      game_account_id: msg.game_account_id || null,
      use_venue_account: !!msg.use_venue_account
    });
    return true;
  }
  /*
   * The game this station's session just started for could not actually be
   * launched — no launch configuration, the launcher unreachable, the
   * executable missing. A session with nobody playing it must not run up a
   * bill nobody asked for, so this is handed to the renderer the same way a
   * self-start request is: it holds the session and the token to cancel it.
   */
  if (msg.type === "LAUNCH_FAILED") {
    log(`[Launch] ${pcName} could not start ${msg.appName || "the game"}: ${msg.error || "unknown error"}`);
    if (win) win.webContents.send("station:launch-failed", { pcName, appName: msg.appName || null, error: msg.error || null });
    return true;
  }
  /* A station finished its end-of-session cleanup. */
  if (msg.type === "CLEANUP_DONE") {
    log(`[Cleanup] ${pcName} is clean and ready`);
    if (win) win.webContents.send("station:cleanup-done", { pcName });
    return true;
  }
  /* A station reporting which launchers it has. Sent unprompted on connect and
     again whenever the console asks, so the answer tracks the machine. */
  if (msg.type === "LAUNCHERS") {
    const launchers = msg.launchers || {};
    stationLaunchers.set(pcName, launchers);
    const on = Object.keys(launchers).filter((k) => launchers[k] && launchers[k].installed);
    log(`[Launchers] ${pcName}: ${on.length ? on.join(", ") : "none"}`);
    if (win) win.webContents.send("station:launchers", { pcName, launchers });
    return true;
  }
  /* A station's venue-Steam sign-in, moving through CHECKING ->
     AUTHENTICATING -> AUTHENTICATED/FAILED ahead of a game launch — never
     the credential itself, only the state name and a masked account. */
  if (msg.type === "STEAM_AUTH_STATUS") {
    stationSteamAuth.set(pcName, { state: msg.state, account: msg.account || null, at: Date.now() });
    log(`[Steam] ${pcName}: ${msg.state}${msg.account ? ` (${msg.account})` : ""}`);
    if (win) win.webContents.send("station:steam-auth", { pcName, state: msg.state, account: msg.account || null });
    return true;
  }
  /* A station reporting its own CafeXP Client build, sent unprompted on
     connect. Handed to the renderer rather than pushed to the backend from
     here — the renderer already holds this café's staff token and the pc_id
     each station maps to, and this console has neither. */
  if (msg.type === "CLIENT_VERSION") {
    const version = String(msg.version || "").slice(0, 32);
    log(`[Update] ${pcName} is running client ${version}`);
    if (win) win.webContents.send("station:client-version", { pcName, version });
    return true;
  }
  return false;
}

/*
 * Tell a station's timer card to grow its clock by `minutes`. The renderer
 * calls this after it has extended the session, so the visible countdown
 * matches the block the customer just added.
 */
function pushExtendTimer(pcName, minutes) {
  const client = clients.get(pcName);
  if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
    return { success: false, error: "Station is not connected" };
  }
  client.ws.send(JSON.stringify({ type: "EXTEND_TIMER", minutes: Number(minutes) || 0 }));
  return { success: true };
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

/*
 * Does this station have anything to connect to?
 *
 * A café sells time on two different kinds of thing. Most are PCs running the
 * client agent, which register over a WebSocket and can be locked, launched
 * into and monitored. The rest are *not computers we talk to*: a pool table,
 * a dartboard, a VR rig, a console on a big screen. They are physical assets
 * with a timer against them — the café still runs sessions and bills for
 * them, there is simply nothing on the other end of a socket.
 *
 * Those are registered with no IP address, and having no address is the whole
 * definition. Everything network-shaped keys off this one predicate rather
 * than off a station's category, because "Pool" is a label an owner types and
 * could be anything, while a missing address is a fact.
 */
function isNetworked(pcConfig) {
  return !!(pcConfig && pcConfig.ip && pcConfig.port);
}

// Get connection status for all PCs
function getConnectionStatus() {
  const status = {};
  allRegisteredPCs.forEach((pcConfig, pcName) => {
    const networked = isNetworked(pcConfig);
    const isConnected = clients.has(pcName);
    const stats = pcConnectionStats.get(pcName);
    status[pcName] = {
      name: pcName,
      ip: pcConfig.ip,
      port: pcConfig.port,
      /* An addressless station is never "connected", but it is never offline
         either — a pool table is ready whenever somebody wants to play on it.
         Reporting it as disconnected would light the floor up with faults
         that no amount of troubleshooting could ever clear. */
      networked: networked,
      connected: networked ? isConnected : false,
      available: networked ? isConnected : true,
      failures: networked ? (stats?.failures || 0) : 0,
      lastError: networked ? (stats?.lastError || null) : null,
      lastAttempt: networked ? (stats?.lastAttempt || null) : null
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

/*
 * The backend this console talks to.
 *
 * `Store.API_BASE` is `http://localhost:5000` because the backend runs on the
 * same machine as this console — true in every deployment so far, so nobody
 * had to say it out loud. A station is a different machine, so "localhost"
 * means something different to it: itself, not the backend. It has to be told
 * the console's real address instead, and the console is the one that knows
 * it — SET_NAME already introduces this station to the console; this rides
 * along on the same message rather than inventing a second round trip.
 *
 * Same interface-selection rule as getMacAddress, for the same reason: the
 * first non-internal IPv4 address is the one actually reachable from another
 * machine on the network.
 */
const BACKEND_PORT = Number(process.env.BACKEND_PORT) || 5000;
const BACKEND_LOCAL = `http://localhost:${BACKEND_PORT}`;
const TOKEN_SERVER_PORT = Number(process.env.TOKEN_SERVER_PORT) || 3334;
function getServerLocalIP() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const addr of interfaces[name] || []) {
        if (addr.family === 'IPv4' && !addr.internal) return addr.address;
      }
    }
  } catch (error) {
    console.error('Error getting local IP:', error);
  }
  return '127.0.0.1';
}
function backendBaseUrl() {
  return `http://${getServerLocalIP()}:${BACKEND_PORT}`;
}

/* ==========================================================================
   UPDATE RELAY

   Every station's client-app self-updates via electron-updater's generic
   provider, which fetches "<feedUrl>/latest.yml" then whatever installer
   that manifest names, both from the same directory. Pointing that feedUrl
   at ManagerXP's own backend would work — but it means every station at a
   café separately downloads the same 100+ MB installer over the café's own
   internet connection. Instead, this console downloads it ONCE (over ITS
   internet connection), caches it, and serves it back out to every station
   from the token server already running for discovery — stations only ever
   reach ManagerXP through this console, never directly, for an update.
   ========================================================================== */
const UPDATE_CACHE_DIR = path.join(app.getPath('userData'), 'update-cache');

function localUpdateFeedUrl(component) {
  return `http://${getServerLocalIP()}:${TOKEN_SERVER_PORT}/updates/${component}`;
}

async function downloadToFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destPath));
}

function sha512OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/*
 * Make sure this component's latest release is cached locally, downloading
 * it only if what's cached doesn't already match this exact download_url +
 * checksum — repeat calls for the same version this console already fetched
 * cost nothing.
 */
async function cacheRelease({ component, download_url, sha512 }) {
  const comp = component === 'server' ? 'server' : 'client';
  if (!download_url) throw new Error('No download URL given');

  const dir = path.join(UPDATE_CACHE_DIR, comp);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = decodeURIComponent(download_url.split('/').pop() || '');
  if (!fileName) throw new Error('Could not read a filename from the download URL');
  const filePath = path.join(dir, fileName);
  const markerPath = path.join(dir, '.source.json');

  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch (e) { /* nothing cached yet */ }
  if (marker && marker.download_url === download_url && marker.sha512 === sha512 && fs.existsSync(filePath)) {
    return { feedUrl: localUpdateFeedUrl(comp) };
  }

  // Best-effort: not every component necessarily has a manifest (server-app
  // has no auto-update config at all, so it never uploads one), and a
  // station's updater only asks for it after this call succeeds anyway.
  const feedRemote = download_url.slice(0, download_url.lastIndexOf('/'));
  await downloadToFile(`${feedRemote}/latest.yml`, path.join(dir, 'latest.yml')).catch((e) => {
    console.warn('[updates] no manifest to relay for', comp, '—', e.message);
  });

  await downloadToFile(download_url, filePath);

  if (sha512) {
    const actual = await sha512OfFile(filePath);
    if (actual.toLowerCase() !== String(sha512).toLowerCase()) {
      fs.unlinkSync(filePath);
      throw new Error('Downloaded installer failed checksum verification');
    }
  }

  fs.writeFileSync(markerPath, JSON.stringify({ download_url, sha512, file_name: fileName }));
  return { feedUrl: localUpdateFeedUrl(comp) };
}

/* GET /updates/:component/:file — the local half of the relay above. Path
   pieces come straight from the URL, so both are checked against a strict
   allowlist/pattern before ever touching the filesystem — this is the one
   route on this server that hands back a file, and it must never be made
   to hand back something outside UPDATE_CACHE_DIR. */
function serveUpdateFile(req, res) {
  const parts = decodeURIComponent(req.url.split('?')[0]).split('/').filter(Boolean);
  const [, component, fileName] = parts; // parts[0] is "updates"
  if (!['client', 'server'].includes(component) || !fileName || /[\\/]|\.\./.test(fileName)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, message: 'Invalid update path' }));
  }
  const filePath = path.join(UPDATE_CACHE_DIR, component, fileName);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Not cached on this console yet' }));
    }
    res.writeHead(200, {
      'Content-Type': fileName.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
      'Content-Length': stat.size
    });
    fs.createReadStream(filePath).pipe(res);
  });
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
                  
                  const checkResponse = await fetch(`${BACKEND_LOCAL}/api/pcs/check-exists`, {
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
                      // /api/pcs/check-exists returns the station under `data`.
                      // Reading the name off the top level always missed, so
                      // every discovered station was renamed to an invented
                      // PC-xx:xx and no longer matched its own record — which
                      // is why its telemetry and sessions never attached.
                      const pcName =
                        (checkResult.data && (checkResult.data.name || checkResult.data.pc_name)) ||
                        checkResult.pc_name ||
                        checkResult.name ||
                        `PC-${mac_address.substring(mac_address.length - 5)}`;
                      
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
    } else if (req.method === 'GET' && req.url.startsWith('/updates/')) {
      serveUpdateFile(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Not found' }));
    }
  });

  tokenServer = server;
  server.listen(TOKEN_SERVER_PORT, () => {
    console.log(`Token receiver server listening on port ${TOKEN_SERVER_PORT} with CORS enabled`);
  });
}

// Handle login from web app
function handleWebAppLogin(token, user) {
  console.log('\n========== WEB APP LOGIN HANDLER ==========');
  
  // Validate token and user data
  if (!token || typeof token !== 'string' || token.trim() === '') {
    console.error('Invalid token received');
    return false;
  }
  
  if (!user || typeof user !== 'object') {
    console.error('Invalid user data received');
    return false;
  }
  
  console.log('[WebAppLogin] User:', user.email || user.name);
  console.log('[WebAppLogin] Token length:', token.length);
  
  // Store in auth context
  authContext.setAuth(user, token);
  console.log('[WebAppLogin] Auth context set');
  
  const fs = require('fs');
  const authFile = path.join(app.getPath('userData'), 'auth.json');
  
  // Save to file as backup
  try {
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    fs.writeFileSync(authFile, JSON.stringify({ user, token }));
    console.log('[WebAppLogin] Auth saved to file for user:', user.email || user.name);
  } catch (error) {
    console.error('[WebAppLogin] Error saving auth:', error);
  }
  
  // Navigate to home page with single window model
  console.log('[WebAppLogin] Window exists:', !!(win && !win.isDestroyed()));
  
  if (!win || win.isDestroyed()) {
    console.log('[WebAppLogin] No valid window, creating new window');
    createWindow();
    connectToClients().catch(err => console.error('[WebAppLogin] Error connecting to clients:', err));
  } else {
    console.log('[WebAppLogin] Window exists, navigating to home page');
    console.log('[WebAppLogin] Resizing to 950x700');
    win.setSize(950, 700);
    win.center();
    win.show();
    
    console.log('[WebAppLogin] Loading index.html...');
    win.loadFile(path.join(__dirname, "index.html"))
      .then(() => console.log('[WebAppLogin] loadFile promise resolved'))
      .catch(err => console.error('[WebAppLogin] loadFile error:', err));
    
    // When home page loads, send user info
    win.webContents.once('did-finish-load', () => {
      console.log('========== WEB APP HOME PAGE LOADED ==========');
      console.log('[WebAppLogin] Focusing window');
      win.focus();
      
      const authState = authContext.getAuthState();
      console.log('[WebAppLogin] Sending user:updated and discovered-pcs events');
      win.webContents.send('user:updated', authState);
      win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
      console.log('========== WEB APP LOGIN COMPLETE ==========\n');
    });
    
    connectToClients().catch(err => console.error('[WebAppLogin] Error connecting to clients:', err));
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

/* ==========================================================================
   TELEMETRY RELAY
   Stations sample their own hardware and push it here. This process keeps the
   newest reading per station for the live view, and flushes the accumulated
   samples to the backend in batches so a brief outage costs a gap in the
   history rather than a station's worth of metrics.
   ========================================================================== */
const latestTelemetry = new Map();   // pcName -> sample
const telemetryQueue = [];           // samples waiting to be persisted
const heartbeatSentAt = new Map();   // pcName -> ms, for round-trip latency
const pingLatency = new Map();       // pcName -> ms
let telemetryFlushInterval = null;

const TELEMETRY_FLUSH_MS = 20000;
const TELEMETRY_QUEUE_MAX = 500;

function recordTelemetry(pcName, sample) {
  if (!pcName || !sample) return;

  // Latency is measured here, not on the station: only this side knows when
  // the ping left and when the pong came back.
  const enriched = {
    ...sample,
    pc_name: pcName,
    latency_ms: pingLatency.has(pcName) ? pingLatency.get(pcName) : null
  };

  latestTelemetry.set(pcName, enriched);
  telemetryQueue.push(enriched);

  // Drop the oldest rather than grow without bound if the backend is down.
  while (telemetryQueue.length > TELEMETRY_QUEUE_MAX) telemetryQueue.shift();

  if (win && !win.isDestroyed()) {
    win.webContents.send("telemetry-updated", { pcName, sample: enriched });
  }
}

async function flushTelemetry() {
  if (!telemetryQueue.length) return;

  const token = authContext.getToken();
  if (!token) return;   // Not signed in yet; keep the samples for later.

  const batch = telemetryQueue.splice(0, TELEMETRY_QUEUE_MAX);
  try {
    const response = await fetch(`${BACKEND_LOCAL}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ samples: batch })
    });

    if (!response.ok) {
      // Put them back — a 500 or a restart should not lose the history.
      telemetryQueue.unshift(...batch);
      log(`[Telemetry] Flush failed: HTTP ${response.status}`);
      return;
    }

    const result = await response.json();
    if (result.unregistered_stations && result.unregistered_stations.length) {
      log(`[Telemetry] Samples from unregistered station(s): ${result.unregistered_stations.join(", ")}`);
    }
  } catch (error) {
    telemetryQueue.unshift(...batch);
    log(`[Telemetry] Flush error: ${error.message}`);
  }
}

function startTelemetryFlush() {
  if (telemetryFlushInterval) return;
  telemetryFlushInterval = setInterval(flushTelemetry, TELEMETRY_FLUSH_MS);
  log(`[Telemetry] Persisting samples every ${TELEMETRY_FLUSH_MS / 1000}s`);
}

/**
 * Round-trip time for the last heartbeat. Measured here because only this
 * side knows when the ping left; the station has no clock we can trust
 * against ours.
 */
function noteHeartbeatPong(pcName) {
  const sentAt = heartbeatSentAt.get(pcName);
  if (!sentAt) return;
  heartbeatSentAt.delete(pcName);
  const rtt = Date.now() - sentAt;
  // A pong that arrives after several heartbeats is a stale match, not a
  // measurement — discard it rather than report a wild number.
  if (rtt >= 0 && rtt < HEARTBEAT_INTERVAL) pingLatency.set(pcName, rtt);
}

/** Ask a station for a sample now, rather than waiting for its next tick. */
function requestTelemetry(pcName) {
  const client = clients.get(pcName);
  if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) return false;
  client.ws.send(JSON.stringify({ type: "GET_TELEMETRY" }));
  return true;
}

// Register all IPC handlers (call only once)
function registerIPCHandlers() {
  if (handlersRegistered) return;

  /* Synchronous on purpose: the renderer's Store needs this before its first
     API call, which can happen before any async IPC round trip would have
     resolved. preload.js reads it once, at script-evaluation time, and hands
     the renderer a plain string — not a promise it would have to thread
     through every caller of Store.request(). */
  ipcMain.on("system:get-backend-local-sync", (event) => {
    event.returnValue = BACKEND_LOCAL;
  });

  /** The live wall reads from this process; history comes from the backend. */
  ipcMain.handle("telemetry:get-latest", async () => ({
    success: true,
    data: Array.from(latestTelemetry.entries()).map(([pcName, sample]) => ({ pcName, sample }))
  }));

  ipcMain.handle("telemetry:request", async (_, { pcName }) => ({
    success: requestTelemetry(pcName)
  }));

  /*
   * Send a power action to a station.
   *
   * The renderer authorises with the backend first — that is where the
   * permission check and the audit entry happen — and only calls this once it
   * has a yes. This handler is purely the delivery mechanism.
   */
  ipcMain.handle("station:power", async (_, { pcName, action, delaySeconds }) => {
    const client = clients.get(pcName);
    if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Station is not connected" };
    }
    client.ws.send(JSON.stringify({
      type: "POWER",
      action: action,
      delaySeconds: delaySeconds === undefined ? 10 : delaySeconds
    }));
    log(`[Power] Sent ${action} to ${pcName}`);
    return { success: true };
  });

  /*
   * Wake-on-LAN.
   *
   * Every other power action is a message to the running client. Powering a
   * station ON cannot be — the machine is off, so there is nothing listening.
   * The only thing that reaches it is a magic packet on the local network,
   * which is why this lives in the console and not in the cloud backend: the
   * console is the one component sitting on the café's own LAN.
   *
   * The packet is six 0xFF bytes followed by the target MAC repeated sixteen
   * times. It is broadcast, so it needs no IP for a machine that has none yet.
   */
  ipcMain.handle("station:wake", async (_, { pcName, macAddress }) => {
    const mac = String(macAddress || "").replace(/[^a-fA-F0-9]/g, "");
    if (mac.length !== 12) {
      return { success: false, error: "This station has no usable MAC address on record" };
    }

    const macBytes = Buffer.from(mac, "hex");
    const packet = Buffer.alloc(102);
    packet.fill(0xff, 0, 6);
    for (let i = 0; i < 16; i += 1) macBytes.copy(packet, 6 + i * 6);

    return new Promise((resolve) => {
      const socket = dgram.createSocket("udp4");

      socket.once("error", (err) => {
        socket.close();
        resolve({ success: false, error: err.message });
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        /*
         * Ports 9 and 7 are both used by WoL implementations and NICs differ
         * on which they listen to, so both are sent — an unheard packet costs
         * nothing, a station that fails to wake costs a seat.
         */
        let pending = 2;
        const done = () => { if (--pending === 0) { socket.close(); resolve({ success: true }); } };

        socket.send(packet, 0, packet.length, 9, "255.255.255.255", done);
        socket.send(packet, 0, packet.length, 7, "255.255.255.255", done);
      });

      // A broadcast is fire-and-forget: nothing acknowledges it, so a station
      // that never wakes must not leave the console waiting.
      setTimeout(() => { try { socket.close(); } catch (e) { /* already closed */ } resolve({ success: true }); }, 2500);
    }).then((result) => {
      log(`[Power] Wake packet ${result.success ? "sent to" : "failed for"} ${pcName}`);
      return result;
    });
  });

  /** Push a new sample rate to every connected station. */
  ipcMain.handle("telemetry:set-interval", async (_, { seconds }) => {
    let sent = 0;
    clients.forEach((client, key) => {
      if (client && client.ws && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: "TELEMETRY_CONFIG", sample_seconds: seconds }));
        sent += 1;
      }
    });
    log(`[Telemetry] Sample interval set to ${seconds}s on ${sent} connection(s)`);
    return { success: true, stations: sent };
  });

  /**
   * Push the current session state to a station so its portal can show the
   * customer's name and countdown. Display only — the backend remains the
   * source of truth and the station never talks back about sessions.
   */
  ipcMain.handle("session:push-state", async (_, { pcName, session }) => {
    /* A station with no address has no portal to show anything on — the
       session is tracked entirely on the counter's screen. Not an error and
       not worth logging every tick: there was never a display to push to. */
    const registered = allRegisteredPCs.get(pcName);
    if (registered && !isNetworked(registered)) {
      return { success: true, displayed: false };
    }

    const client = clients.get(pcName);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      console.log(`[Session] Push skipped, ${pcName} not connected`);
      return { success: false, error: "Station is not connected" };
    }
    client.ws.send(JSON.stringify({ type: "SESSION_STATE", session: session || null }));
    const summary = session ? `${session.status} for ${session.customer_name}` : "cleared";
    log(`Sent session state to ${pcName}: ${summary}`);
    console.log(`[Session] Pushed to ${pcName}: ${summary}`);
    return { success: true };
  });

  /* After the renderer extends a station's session it calls this, so the
     station's floating timer card grows its clock to match. */
  ipcMain.handle("session:push-extend-timer", async (_, { pcName, minutes }) => {
    return pushExtendTimer(pcName, minutes);
  });

  /* checkForSoftwareUpdate() found a station running an older client build
     than what ManagerXP has published — tell it directly, the same way a
     session push reaches one specific station. */
  ipcMain.handle("update:push-available", async (_, { pcName, payload }) => {
    const client = clients.get(pcName);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Station is not connected" };
    }
    client.ws.send(JSON.stringify({ type: "UPDATE_AVAILABLE", ...payload }));
    log(`Sent update notice to ${pcName}: v${payload.version}`);
    return { success: true };
  });

  /* The games a station may offer its customer. The renderer resolves the list
     (only this PC's installed, enabled titles) and hands it here to send down
     the station's connection, the same channel session state travels on. An
     empty list clears the customer's game menu — used when a session ends. */
  /* What launchers each station has. Returns everything known when no station
     is named, so the floor can badge them all from one call. */
  ipcMain.handle("station:get-launchers", async (_, { pcName } = {}) => {
    if (pcName) return { success: true, data: stationLaunchers.get(pcName) || null };
    return {
      success: true,
      data: Array.from(stationLaunchers.entries()).map(([name, launchers]) => ({ pcName: name, launchers }))
    };
  });

  /* A station's most recent Steam sign-in state, for a console opened after
     the fact rather than one watching live. Cleared naturally by the next
     launch attempt overwriting it — nothing here ever needs expiring. */
  ipcMain.handle("station:get-steam-auth", async (_, { pcName } = {}) => {
    if (pcName) return { success: true, data: stationSteamAuth.get(pcName) || null };
    return {
      success: true,
      data: Array.from(stationSteamAuth.entries()).map(([name, s]) => ({ pcName: name, ...s }))
    };
  });

  /* The renderer's half of the update relay above: make sure this
     component's latest build is cached here before it hands a station a
     feed URL, and hand back that URL (this console's own address, not
     ManagerXP's) once it's ready. */
  ipcMain.handle("updates:cache-release", async (_, payload) => {
    try {
      const result = await cacheRelease(payload || {});
      return { success: true, data: result };
    } catch (err) {
      console.error("[updates] cache-release failed:", err.message);
      return { success: false, message: err.message };
    }
  });

  /* Ask a station to look again — used after staff install a launcher on it. */
  ipcMain.handle("station:refresh-launchers", async (_, { pcName }) => {
    const client = clients.get(pcName);
    if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Station is not connected" };
    }
    client.ws.send(JSON.stringify({ type: "GET_LAUNCHERS" }));
    return { success: true };
  });

  /* Tell a station to clean itself up after a session — close the game, sign
     the configured launchers out, free the machine. The config travels with
     the command so the café's current policy always wins. */
  ipcMain.handle("session:cleanup", async (_, { pcName, config, games }) => {
    const client = clients.get(pcName);
    if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Station is not connected" };
    }
    client.ws.send(JSON.stringify({ type: "SESSION_CLEANUP", config: config || {}, games: games || [] }));
    const outs = Object.keys((config && config.signout) || {}).filter((k) => config.signout[k]);
    log(`Cleanup sent to ${pcName}${outs.length ? " — signing out " + outs.join(", ") : ""}`);
    return { success: true };
  });

  ipcMain.handle("session:push-games", async (_, { pcName, games }) => {
    const client = clients.get(pcName);
    if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Station is not connected" };
    }
    client.ws.send(JSON.stringify({ type: "GAMES_LIST", games: games || [] }));
    log(`Sent ${(games || []).length} games to ${pcName}`);
    return { success: true };
  });

  /* What a customer can self-start with — this café's games and prices for
     the requesting station — sent whether or not a session is already
     running there, unlike GAMES_LIST which only carries a title once one is. */
  ipcMain.handle("session:push-start-options", async (_, { pcName, games, prices }) => {
    const client = clients.get(pcName);
    if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Station is not connected" };
    }
    client.ws.send(JSON.stringify({ type: "START_OPTIONS", games: games || [], prices: prices || [] }));
    log(`Sent start options to ${pcName}: ${(games || []).length} games, ${(prices || []).length} prices`);
    return { success: true };
  });

  /* The self-start the customer asked for could not begin — station or
     wallet issue, station or price no longer valid. Told to the station
     itself since nobody at the counter is watching this one start. */
  ipcMain.handle("session:push-start-failed", async (_, { pcName, message }) => {
    const client = clients.get(pcName);
    if (!client || !client.ws || client.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Station is not connected" };
    }
    client.ws.send(JSON.stringify({ type: "START_SESSION_FAILED", message: message || "Could not start the session" }));
    return { success: true };
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

  // Handle fetch software list request from UI
  ipcMain.handle("fetch-pc-software", async (_, simId) => {
    const client = clients.get(simId);
    
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: `PC ${simId} is not connected`, software: [] };
    }
    
    return new Promise((resolve) => {
      // Set a timeout for the request (30 seconds for large software lists)
      const timeout = setTimeout(() => {
        pendingSoftwareRequests.delete(simId);
        resolve({ success: false, error: 'Request timeout - PC took too long to respond. Check PC connection.', software: [] });
        log(`Software request timeout for ${simId}`);
      }, 30000);
      
      // Store the resolve and timeout for later
      pendingSoftwareRequests.set(simId, { resolve, timeout });
      
      // Send the request
      client.ws.send(JSON.stringify({
        type: "GET_SOFTWARE_LIST"
      }));
      
      log(`Sent software list request to ${simId} (30 second timeout)`);
    });
  });

  // Handle fetch PC software from API (new approach)
  ipcMain.handle("get-pc-software-from-api", async (_, pcId) => {
    try {
      const token = authContext.getToken();
      
      if (!token) {
        return { success: false, error: 'Not authenticated', data: [] };
      }

      const response = await fetch(`${BACKEND_LOCAL}/api/pc-software/pc/${pcId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`PC software fetch failed: ${response.status} ${errorText}`);
        return { success: false, error: `HTTP ${response.status}`, data: [] };
      }

      const result = await response.json();
      log(`Fetched software for PC ${pcId}: ${result.count || 0} software items`);
      return result;
    } catch (error) {
      console.error("Error fetching PC software from API:", error.message);
      return { success: false, error: error.message, data: [] };
    }
  });

  // Authentication IPC handlers
  ipcMain.on("auth:set-auth", (event, { user, token }) => {
    console.log('\n========== AUTH:SET-AUTH RECEIVED ==========');
    console.log('[Auth] User:', user.email || user.name);
    console.log('[Auth] Token provided:', !!token);
    console.log('[Auth] Token length:', token ? token.length : 0);
    console.log('[Auth] Window exists:', !!(win && !win.isDestroyed()));
    
    // Set auth in context
    authContext.setAuth(user, token);
    console.log('[Auth] Auth context set');
    
    const fs = require('fs');
    const authFile = path.join(app.getPath('userData'), 'auth.json');
    
    // Save to file as backup
    try {
      fs.mkdirSync(path.dirname(authFile), { recursive: true });
      fs.writeFileSync(authFile, JSON.stringify({ user, token }));
      console.log('[Auth] Auth saved to file');
    } catch (error) {
      console.error('[Auth] Failed to save auth:', error);
    }
    
    console.log('[Auth] Starting navigation logic...');
    
    // Navigate to home page
    if (win && !win.isDestroyed()) {
      console.log('[Auth] Window is valid, starting navigation');
      console.log('[Auth] Current window state - visible:', win.isVisible());
      console.log('[Auth] Resizing window to 950x700');
      win.setSize(950, 700);
      win.center();
      win.show();
      
      console.log('[Auth] Loading index.html...');
      win.loadFile(path.join(__dirname, "index.html"))
        .then(() => {
          console.log('[Auth] loadFile promise resolved');
          console.log('[Auth] Window still valid after load:', !!(win && !win.isDestroyed()));
        })
        .catch(err => console.error('[Auth] loadFile error:', err));
      
      // When content is ready, display it
      win.webContents.once('did-finish-load', () => {
        console.log('========== HOME PAGE LOADED ==========');
        console.log('[Auth] did-finish-load event fired');
        console.log('[Auth] Window still valid:', !!(win && !win.isDestroyed()));
        
        if (win && !win.isDestroyed()) {
          console.log('[Auth] Focusing window');
          win.focus();
          
          const authState = authContext.getAuthState();
          console.log('[Auth] Auth state - authenticated:', authState.isAuthenticated);
          
          if (authState.isAuthenticated) {
            console.log('[Auth] Sending user:updated and discovered-pcs events');
            win.webContents.send('user:updated', authState);
            win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
          }
        }
        console.log('========== NAVIGATION COMPLETE ==========\n');
      });
      
      // Connect to clients
      connectToClients().catch(err => console.error('[Auth] Error connecting to clients:', err));
    } else {
      console.log('[Auth] Window invalid, creating new window');
      createWindow();
      connectToClients().catch(err => console.error('[Auth] Error connecting to clients:', err));
    }
  });

  ipcMain.on("auth:login-success", (event, user) => {
    console.log('\n========== AUTH:LOGIN-SUCCESS RECEIVED ==========');
    console.log('[Login-Success] User:', user.email || user.name);
    
    const fs = require('fs');
    const authFile = path.join(app.getPath('userData'), 'auth.json');
    
    // Get token and set auth
    const token = authContext.getToken();
    console.log('[Login-Success] Token available:', !!token);
    console.log('[Login-Success] Token length:', token ? token.length : 0);
    
    authContext.setAuth(user, token);
    console.log('[Login-Success] Auth context set');
    
    // Save to file
    try {
      fs.mkdirSync(path.dirname(authFile), { recursive: true });
      fs.writeFileSync(authFile, JSON.stringify({ user, token: token }));
      console.log('[Login-Success] Auth saved to file');
    } catch (error) {
      console.error('[Login-Success] Failed to save auth:', error);
    }
    
    console.log('[Login-Success] Starting navigation logic...');
    console.log('[Login-Success] Window exists:', !!(win && !win.isDestroyed()));
    
    // Navigate to home page
    if (win && !win.isDestroyed()) {
      console.log('[Login-Success] Window is valid, starting navigation');
      console.log('[Login-Success] Current window state - visible:', win.isVisible());
      console.log('[Login-Success] Resizing window to 950x700');
      win.setSize(950, 700);
      win.center();
      win.show();
      
      console.log('[Login-Success] Loading index.html...');
      win.loadFile(path.join(__dirname, "index.html"))
        .then(() => {
          console.log('[Login-Success] loadFile promise resolved');
          console.log('[Login-Success] Window still valid after load:', !!(win && !win.isDestroyed()));
        })
        .catch(err => console.error('[Login-Success] loadFile error:', err));
      
      // When content is ready, display it
      win.webContents.once('did-finish-load', () => {
        console.log('========== HOME PAGE LOADED ==========');
        console.log('[Login-Success] did-finish-load event fired');
        console.log('[Login-Success] Window still valid:', !!(win && !win.isDestroyed()));
        
        if (win && !win.isDestroyed()) {
          console.log('[Login-Success] Focusing window');
          win.focus();
          
          const authState = authContext.getAuthState();
          console.log('[Login-Success] Auth state - authenticated:', authState.isAuthenticated);
          
          if (authState.isAuthenticated) {
            console.log('[Login-Success] Sending user:updated and discovered-pcs events');
            win.webContents.send('user:updated', authState);
            win.webContents.send('discovered-pcs', Array.from(discoveredPCs.values()));
          }
        }
        console.log('========== NAVIGATION COMPLETE ==========\n');
      });
      
      // Connect to clients
      connectToClients().catch(err => console.error('[Login-Success] Error connecting to clients:', err));
    } else {
      console.log('[Login-Success] Window invalid, creating new window');
      createWindow();
      connectToClients().catch(err => console.error('[Login-Success] Error connecting to clients:', err));
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
        console.log('[Logout] WebSocket client connections closed');
      } catch (error) {
        console.error('[Logout] Error closing WebSocket connections:', error);
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
      console.error('[Logout] Error deleting auth file:', error);
    }
    
    // Navigate to login page instead of closing windows
    if (win && !win.isDestroyed()) {
      console.log('[Logout] Navigating to login page');
      win.setSize(500, 600); // Resize to login window size
      win.loadFile(path.join(__dirname, "login.html"));
      win.webContents.once('did-finish-load', () => {
        console.log('[Logout] Login page loaded');
        win.show();
        win.focus();
      });
    } else {
      console.log('[Logout] Window not available, creating login window');
      createLoginWindow();
    }
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
      
      /* These are two different failures and were reported as one. Without a
         token the console is signed out; with a token but no café it is signed
         in as somebody who belongs to no café — and the fix for that is to
         choose one, not to sign in again. */
      if (!token) {
        console.log("No token for PC fetch — signed out");
        return { success: false, data: [], error: "Not authenticated" };
      }
      if (!cafeId) {
        console.log("No cafe id for PC fetch — principal has no cafe and none chosen");
        return { success: false, data: [], error: "NO_CAFE" };
      }

      const response = await fetch(`${BACKEND_LOCAL}/api/pcs/cafe/${cafeId}`, {
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

  // ---- Custom window controls (the frame is drawn by the renderer) ----
  ipcMain.on("window:minimize", () => {
    if (win && !win.isDestroyed()) win.minimize();
  });

  ipcMain.on("window:toggle-maximize", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on("window:close", () => {
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle("window:is-maximized", () => {
    return !!win && !win.isDestroyed() && win.isMaximized();
  });

  ipcMain.on("auth:open-web-app", (event) => {
    shell.openExternal('http://localhost:5173/cafexp-login');
  });

  ipcMain.on("auth:open-web-app-signup", (event) => {
    shell.openExternal('http://localhost:5173/signup');
  });

  // This console's own build, read from package.json via Electron.
  ipcMain.handle("system:get-app-version", async () => app.getVersion());

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
      let skipped = 0;
      allRegisteredPCs.forEach((pcConfig, pcName) => {
        // Addressless stations are not disconnected, so "reconnect all" has
        // no work to do for them.
        if (!isNetworked(pcConfig)) { skipped++; return; }
        if (!clients.has(pcName)) {
          console.log(`[IPC] Attempting to reconnect: ${pcName}`);
          connectToSpecificPC(pcConfig.ip, pcConfig.port, pcName);
          reconnectCount++;
        }
      });

      log(`[IPC] Reconnection attempt initiated for ${reconnectCount} disconnected PCs` +
        (skipped ? ` (${skipped} station(s) have no address and were left alone)` : ''));
      return { success: true, message: `Reconnection initiated for ${reconnectCount} PCs`, reconnected: reconnectCount };
    } catch (error) {
      console.error('[IPC] Error in pc:reconnect-all handler:', error);
      return { success: false, error: error.message };
    }
  });

  // New IPC handler: Get connection status for all PCs
  /*
   * Which stations are connected right now.
   *
   * The "clients" event is only pushed when a station registers or drops. The
   * main process connects to stations during startup — before the window has
   * finished loading — so a renderer that starts up afterwards misses that
   * event entirely and shows every station as offline while the sockets are
   * perfectly alive. This lets it ask instead of waiting.
   */
  ipcMain.handle("pc:get-connected", async () => ({
    success: true,
    data: getConnectedPCNames()
  }));

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
/*
 * The café's staff-unlock PIN, pushed down to each station as it registers.
 *
 * The PIN gates the Ctrl+Alt+Shift+Q escape hatch on a client kiosk. It has
 * to live on the station rather than be checked here, because the whole point
 * of that hatch is the case where this console cannot be reached — a station
 * that had to phone home to verify a PIN would be locked exactly when it
 * matters. So it is sent once on connect and the client caches it.
 *
 * Only this console can read it: the settings endpoint is staff-authenticated
 * and the client has no staff credentials of its own.
 */
let cachedUnlockPin = null;

async function fetchStaffUnlockPin() {
  try {
    const token = authContext.getToken();
    if (!token) return null;
    const res = await fetch(`${BACKEND_LOCAL}/api/settings?category=client`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const body = await res.json();
    const row = (body.data || []).find((s) => s.setting_key === 'client.staff_unlock_pin');
    cachedUnlockPin = row ? String(row.setting_value || '') : '';
    return cachedUnlockPin;
  } catch (error) {
    log(`Could not read the staff unlock PIN: ${error.message}`);
    return null;
  }
}

/** Send a freshly registered station the settings it needs to hold locally. */
async function pushStationConfig(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const pin = cachedUnlockPin !== null ? cachedUnlockPin : await fetchStaffUnlockPin();
  if (pin === null) return;
  try {
    ws.send(JSON.stringify({ type: 'STATION_CONFIG', staffUnlockPin: pin }));
  } catch (error) {
    log(`Could not send station config: ${error.message}`);
  }
}

async function fetchClientsFromAPI() {
  try {
    const cafeId = authContext.getCafeId();
    const token = authContext.getToken();
    
    if (!cafeId || !token) {
      log("Not authenticated - cannot fetch PCs from API");
      return [];
    }

    const response = await fetch(`${BACKEND_LOCAL}/api/pcs/cafe/${cafeId}`, {
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
        // Still registered and still billable — just never dialled.
        if (!isNetworked(cfg)) {
          console.log(`[PC Refresh] 🎱 New station without an address: ${pcName} — registered, no connection attempted`);
          allRegisteredPCs.set(pcName, cfg);
          return;
        }

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

        /* An address being removed is a station being converted to something
           we do not talk to. Drop any live socket and stop there — do not
           then try to dial the address that is no longer set. */
        if (!isNetworked(cfg)) {
          if (isNetworked(existingPC)) {
            console.log(`[PC Refresh] ${pcName} no longer has an address — releasing its connection`);
            const existingClient = clients.get(pcName);
            if (existingClient && existingClient.ws) {
              try { existingClient.ws.close(); } catch (e) {}
            }
            clients.delete(pcName);
            pcConnectionStats.delete(pcName);
          }
          allRegisteredPCs.set(pcName, cfg);
          return;
        }

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
          heartbeatSentAt.set(simId, Date.now());
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
        /* Nothing to reconnect to. A pool table will never appear in the
           connected list, so without this it would be retried every five
           seconds forever and its failure count would climb without limit —
           a permanent red mark against a station that is working perfectly. */
        if (!isNetworked(pcConfig)) return;

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

                // Station-initiated requests (extend, overtime) are handed to
                // the renderer to act on with its staff token.
                if (handleStationRequest(msg, ws)) return;

                if (msg.type === "REGISTER") {
                  ws.simId = msg.simId;
                  clients.set(msg.simId, { ws, apps: [], pcName: pcName });
                  clients.set(pcName, { ws, apps: [], pcName: pcName });
                  // Hand it the settings it must hold locally (the staff unlock PIN).
                  pushStationConfig(ws);
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
                  noteHeartbeatPong(msg.simId || pcName);
                }

                if (msg.type === "TELEMETRY") {
                  recordTelemetry(msg.simId || pcName, msg.sample);
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

                if (msg.type === "SOFTWARE_LIST") {
                  const simId = msg.simId;
                  const request = pendingSoftwareRequests.get(simId);
                  if (request) {
                    clearTimeout(request.timeout);
                    pendingSoftwareRequests.delete(simId);
                    request.resolve({ success: true, software: msg.software || [] });
                    log(`Software list received from ${simId}: ${(msg.software || []).length} items`);
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
              name: pcName,
              apiBase: backendBaseUrl()
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
  /* The single place every connection attempt funnels through, so the guard
     lives here too rather than only at each call site. `new WebSocket` throws
     on a malformed URL *before* any handler is attached, so an unguarded call
     is not a failed connection — it is an exception that takes down whatever
     loop was making it. */
  if (!isNetworked({ ip, port })) {
    log(`[Dynamic Connect] ${pcName} has no network address — nothing to connect to`);
    return;
  }

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

        // Station-initiated requests (extend, overtime) go to the renderer.
        if (handleStationRequest(msg, ws)) return;

        if (msg.type === "REGISTER") {
          ws.simId = msg.simId;
          clients.set(msg.simId, { ws, apps: [], pcName: pcName });
          clients.set(pcName, { ws, apps: [], pcName: pcName });
          // Hand it the settings it must hold locally (the staff unlock PIN).
          pushStationConfig(ws);
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
          noteHeartbeatPong(msg.simId || pcName);
        }

        if (msg.type === "TELEMETRY") {
          recordTelemetry(msg.simId || pcName, msg.sample);
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

        if (msg.type === "SOFTWARE_LIST") {
          const simId = msg.simId;
          const request = pendingSoftwareRequests.get(simId);
          if (request) {
            clearTimeout(request.timeout);
            pendingSoftwareRequests.delete(simId);
            request.resolve({ success: true, software: msg.software || [] });
            log(`[Dynamic Connect] Software list received from ${simId}: ${(msg.software || []).length} items`);
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
      name: pcName,
      apiBase: backendBaseUrl()
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

  /* Only the stations that actually have an address.
   *
   * This used to run over every registered station, so a pool table or a VR
   * rig — deliberately registered without an IP — produced `ws://null:null`,
   * which throws before any error handler is attached and took the whole
   * connect sweep down with it. The stations after it in the list never got
   * connected at all. */
  const networked = clients_list.filter(isNetworked);
  const offline = clients_list.length - networked.length;
  if (offline > 0) {
    log(`${offline} station(s) have no network address — nothing to connect to, which is expected for pool tables, VR rigs and consoles`);
  }

  networked.forEach(clientConfig => {
    const { simId, ip, port } = clientConfig;
    const clientUrl = `ws://${ip}:${port}`;

    log(`Connecting to client ${simId} at ${clientUrl}...`);

    const ws = new WebSocket(clientUrl);
    
    const setupClientHandlers = () => {
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw);

          // Station-initiated requests (extend, overtime) go to the renderer.
          if (handleStationRequest(msg, ws)) return;

          if (msg.type === "REGISTER") {
            ws.simId = msg.simId;
            // Store with both the registered simId and the PC name as keys
            clients.set(msg.simId, { ws, apps: [], pcName: simId });
            clients.set(simId, { ws, apps: [], pcName: simId });
            // Hand it the settings it must hold locally (the staff unlock PIN).
            pushStationConfig(ws); // Also store by PC name for lookup
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
            noteHeartbeatPong(msg.simId || simId);
          }

          if (msg.type === "TELEMETRY") {
            recordTelemetry(msg.simId || simId, msg.sample);
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

          if (msg.type === "SOFTWARE_LIST") {
            const pcSimId = msg.simId;
            const request = pendingSoftwareRequests.get(pcSimId);
            if (request) {
              clearTimeout(request.timeout);
              pendingSoftwareRequests.delete(pcSimId);
              request.resolve({ success: true, software: msg.software || [] });
              log(`Software list received from ${pcSimId}: ${(msg.software || []).length} items`);
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
        name: simId,
        apiBase: backendBaseUrl()
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

  // Persist whatever the stations have reported since the last flush
  startTelemetryFlush();
}

app.on('window-all-closed', () => {
  console.log('[App] All windows closed');
  
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

  // One last flush, so the closing minutes of the shift are not lost
  if (telemetryFlushInterval) {
    clearInterval(telemetryFlushInterval);
    telemetryFlushInterval = null;
  }
  flushTelemetry().catch(() => {});

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
