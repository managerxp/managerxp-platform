/* ==========================================================================
   CafeXP Console — Self-update

   Mirrors client-app/updater.js's shape (same idle/downloading/staged/
   applying/error state machine, same onChange listener API) but simpler:
   there is no session-gated auto-apply here, because the trigger is always
   an explicit staff click on the Updates page, never a background timer.
   Staff decide the moment; this module just does what it's told.

   Points straight at the backend's own upload directory rather than through
   the local station relay (server-app/main.js's cacheRelease/serveUpdateFile)
   — that relay exists so every station does not separately re-download the
   same installer over the café's own connection. The console downloads once,
   for itself, and already has its own internet access to do it with.

   Everything is a no-op in development: an unpackaged app has nothing to
   update, and electron-updater throws if asked to try. Guarding on
   app.isPackaged keeps `npm start` working exactly as before.
   ========================================================================== */
const { app } = require("electron");

let autoUpdater = null;
try {
  // Optional at runtime: a source checkout may not have it installed yet, and
  // that must not stop the console from starting.
  ({ autoUpdater } = require("electron-updater"));
} catch (err) {
  autoUpdater = null;
}

const state = {
  version: app.getVersion(),
  // idle | downloading | staged | applying | error
  phase: "idle",
  targetVersion: null,
  progress: 0,
  detail: null,
  stagedAt: null,
  lastError: null
};

let listeners = [];
let log = () => {};

const emit = () => {
  const snapshot = { ...state, supported: isSupported() };
  listeners.forEach((fn) => { try { fn(snapshot); } catch (e) { /* keep going */ } });
};

const setPhase = (phase, detail) => {
  state.phase = phase;
  if (detail !== undefined) state.detail = detail;
  log(`[console-update] ${phase}${detail ? " — " + detail : ""}`);
  emit();
};

/** Whether this build can update itself at all. */
const isSupported = () => !!autoUpdater && app.isPackaged;

/* ==========================================================================
   DOWNLOAD

   `feedUrl` is the directory holding latest.yml and the installer — the
   backend's own uploads directory for this component, the same address
   Store.checkUpdate('server', v)'s `download.url` already points into. Not
   read from any local config, so it always reflects what the renderer just
   asked the backend for.
   ========================================================================== */
async function download({ feedUrl, targetVersion } = {}) {
  if (!isSupported()) {
    setPhase("error", "This build cannot update itself (running from source)");
    return { ok: false, message: "Not a packaged build" };
  }
  if (!feedUrl) {
    return { ok: false, message: "No update feed given" };
  }
  if (state.phase === "downloading") {
    return { ok: true, message: "Already downloading", already: true };
  }
  if (state.phase === "staged") {
    return { ok: true, message: "Already staged", already: true };
  }

  state.targetVersion = targetVersion || null;
  state.progress = 0;
  state.lastError = null;
  setPhase("downloading", targetVersion ? `fetching ${targetVersion}` : "fetching update");

  try {
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
    await autoUpdater.downloadUpdate();
    return { ok: true, message: "Update downloaded and staged" };
  } catch (err) {
    state.lastError = err.message;
    setPhase("error", err.message);
    return { ok: false, message: err.message };
  }
}

/* ==========================================================================
   APPLY

   The only destructive step. No session/idle gate here — an operator who
   just clicked "Install update" has already made that call; server.js's
   caller (the Updates page) is where staff are warned about active
   sessions before this is ever reached.
   ========================================================================== */
function apply() {
  if (!isSupported()) return { ok: false, message: "Not a packaged build" };
  if (state.phase !== "staged") {
    return { ok: false, message: "No update is staged yet" };
  }

  setPhase("applying", "restarting to install");

  // Let the phase reach the renderer before the process goes away.
  setTimeout(() => {
    try {
      /* isSilent: no separate installer wizard to click through.
         isForceRunAfter: the console comes back up on its own — the whole
         floor loses its connection for as long as it does not. */
      autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      state.lastError = err.message;
      setPhase("error", `install failed: ${err.message}`);
    }
  }, 1200);

  return { ok: true, message: "Installing now" };
}

/* ==========================================================================
   WIRING
   ========================================================================== */
function init(opts = {}) {
  log = opts.log || (() => {});

  if (!autoUpdater) {
    log("[console-update] electron-updater is not installed; updates are unavailable");
    return api;
  }

  // We drive every step explicitly — an automatic download or install would
  // sidestep the staff decision this whole module exists to respect.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on("download-progress", (p) => {
    state.progress = Math.round(p?.percent || 0);
    state.detail = `${state.progress}%`;
    emit();
  });

  autoUpdater.on("update-downloaded", (info) => {
    state.targetVersion = info?.version || state.targetVersion;
    state.stagedAt = new Date().toISOString();
    state.progress = 100;
    // Staged, not installed — electron-updater has verified the package
    // signature and checksum against latest.yml by this point.
    setPhase("staged", `version ${state.targetVersion} is ready to install`);
  });

  autoUpdater.on("error", (err) => {
    state.lastError = err?.message || String(err);
    setPhase("error", state.lastError);
  });

  log(`[console-update] console ${state.version}, updates ${isSupported() ? "available" : "unavailable (unpackaged)"}`);
  return api;
}

const api = {
  init,
  download,
  apply,
  version: () => state.version,
  snapshot: () => ({ ...state, supported: isSupported() }),
  onChange: (fn) => {
    listeners.push(fn);
    return () => { listeners = listeners.filter((f) => f !== fn); };
  }
};

module.exports = api;
