/* ==========================================================================
   CafeXP Client — Updates

   A station is a kiosk with a paying customer in front of it. That single fact
   decides everything here:

     · nothing is ever applied while a session is running, or a game is open;
     · the download happens while the customer plays, because it costs them
       nothing;
     · the install waits for the station to be genuinely idle;
     · a failure leaves the station running the version it already had.

   This module never decides *whether* to update. The console tells it to, and
   the console only knows because the ManagerXP backend said so. The client is
   the last link in that chain and the least trusted part of it — it cannot
   reach the update server on its own initiative, and it cannot choose a
   version.

   Everything is a no-op in development: an unpackaged app has nothing to
   update, and electron-updater throws if asked to try. Guarding on
   app.isPackaged keeps `npm start` working exactly as before.
   ========================================================================== */
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

let autoUpdater = null;
try {
  // Optional at runtime: a source checkout may not have it installed yet, and
  // that must not stop the client from starting.
  ({ autoUpdater } = require("electron-updater"));
} catch (err) {
  autoUpdater = null;
}

/* ==========================================================================
   STATE
   ========================================================================== */
const state = {
  version: app.getVersion(),
  // idle | checking | available | downloading | staged | applying | error
  phase: "idle",
  targetVersion: null,
  progress: 0,
  detail: null,
  stagedAt: null,
  lastError: null
};

let listeners = [];
let isSessionActive = () => false;      // supplied by main.js
let log = () => {};

const emit = () => {
  const snapshot = { ...state, supported: isSupported() };
  listeners.forEach((fn) => { try { fn(snapshot); } catch (e) { /* keep going */ } });
};

const setPhase = (phase, detail) => {
  state.phase = phase;
  if (detail !== undefined) state.detail = detail;
  log(`[update] ${phase}${detail ? " — " + detail : ""}`);
  emit();
};

/** Whether this build can update itself at all. */
const isSupported = () => !!autoUpdater && app.isPackaged;

/* ==========================================================================
   DOWNLOAD

   `feedUrl` comes from the console, which got it from the backend. It is not
   read from any local config, so a tampered file on the station cannot point
   the updater at someone else's package.
   ========================================================================== */
async function download({ feedUrl, targetVersion }) {
  if (!isSupported()) {
    setPhase("error", "This build cannot update itself (running from source)");
    return { ok: false, message: "Not a packaged build" };
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
    if (feedUrl) autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });

    /*
     * Downloading is safe at any time: it writes to a cache directory and
     * touches nothing the running app or a game depends on. The customer sees
     * no interruption, which is why this step is deliberately not deferred to
     * an idle window.
     */
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

   The only destructive step, and the only one that refuses.
   ========================================================================== */
function apply({ force = false } = {}) {
  if (!isSupported()) return { ok: false, message: "Not a packaged build" };
  if (state.phase !== "staged") {
    return { ok: false, message: "No update is staged yet" };
  }

  /*
   * The rule the whole feature is built around. `force` exists because an
   * operator standing at the machine outside opening hours may legitimately
   * want to override — but it is never set by the automatic path, so a
   * background rollout cannot take a game away from a paying customer.
   */
  if (isSessionActive() && !force) {
    setPhase("staged", "waiting for the session to end");
    return {
      ok: false,
      deferred: true,
      message: "A session is running. The update will be applied when the station is free."
    };
  }

  setPhase("applying", "restarting to install");

  // Let the phase reach the console before the process goes away.
  setTimeout(() => {
    try {
      /* isSilent: no installer UI on a kiosk screen.
         isForceRunAfter: the station must come back up on its own — nobody is
         standing there to launch it, and a dark station is a station that
         cannot take money. */
      autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      state.lastError = err.message;
      setPhase("error", `install failed: ${err.message}`);
    }
  }, 1200);

  return { ok: true, message: "Installing now" };
}

/**
 * Called whenever a session ends.
 *
 * This is what makes "apply when idle" actually happen rather than being a
 * promise nobody keeps: the moment a station goes free, a staged update that
 * was deferred gets its chance.
 */
function onStationIdle() {
  if (state.phase === "staged" && autoApply) {
    log("[update] station is free — applying the staged update");
    apply();
  }
}

let autoApply = false;

/* ==========================================================================
   WIRING
   ========================================================================== */
function init(opts = {}) {
  log = opts.log || (() => {});
  isSessionActive = opts.isSessionActive || (() => false);

  if (!autoUpdater) {
    log("[update] electron-updater is not installed; updates are unavailable");
    return api;
  }

  // We drive every step explicitly, so nothing may happen behind our back —
  // an automatic download or install would sidestep the session check.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on("update-available", (info) => {
    state.targetVersion = info?.version || state.targetVersion;
    setPhase("available", `version ${state.targetVersion} is available`);
  });

  autoUpdater.on("download-progress", (p) => {
    state.progress = Math.round(p?.percent || 0);
    state.detail = `${state.progress}%`;
    emit();
  });

  autoUpdater.on("update-downloaded", (info) => {
    state.targetVersion = info?.version || state.targetVersion;
    state.stagedAt = new Date().toISOString();
    state.progress = 100;
    /* Staged, not installed. electron-updater has verified the package
       signature and checksum against latest.yml by this point — if either
       failed we would be in the error branch instead. */
    setPhase("staged", `version ${state.targetVersion} is ready to install`);
  });

  autoUpdater.on("error", (err) => {
    state.lastError = err?.message || String(err);
    setPhase("error", state.lastError);
  });

  log(`[update] client ${state.version}, updates ${isSupported() ? "available" : "unavailable (unpackaged)"}`);
  return api;
}

const api = {
  init,
  download,
  apply,
  onStationIdle,
  setAutoApply: (on) => { autoApply = !!on; },
  version: () => state.version,
  snapshot: () => ({ ...state, supported: isSupported() }),
  onChange: (fn) => {
    listeners.push(fn);
    return () => { listeners = listeners.filter((f) => f !== fn); };
  }
};

module.exports = api;
