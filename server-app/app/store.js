/* ==========================================================================
   CafeXP — Data store
   The single place the Admin UI talks to the outside world.

   IMPORTANT: this file changes no contracts. Every IPC channel, endpoint,
   payload shape and header below is exactly what the previous renderer used.
   Pages read from CXStore.state and subscribe to CXStore.on(...).
   ========================================================================== */
(function (global) {
  "use strict";

  var API_BASE = "http://localhost:5000";       // unchanged: backend origin
  var api = global.api || {};                    // preload bridge

  /** Call an IPC bridge method, failing softly if the bridge is unavailable. */
  function bridge(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (typeof api[name] !== "function") {
      var msg = "The desktop bridge method '" + name + "' is unavailable.";
      console.warn("[store] " + msg);
      return Promise.resolve({ success: false, error: msg });
    }
    return Promise.resolve(api[name].apply(api, args));
  }

  /* ==========================================================================
     STATE
     ========================================================================== */
  var state = {
    user: null,                 // { name, email, cafe_id, ... }
    pcs: [],                    // rows from /api/pcs/cafe/:cafeId
    pcsByName: {},              // name -> pc row
    connected: [],              // pc names currently connected over WS
    discovered: [],             // { ip, mac, hostname, port } not yet registered
    connectionStatus: {},       // pcName -> { status, failures, error }
    apps: {},                   // pcName|simId -> [app]
    logs: [],                   // { time, text, level }
    subscription: null,         // row from /api/subscriptions/cafe/:id
    running: {},                // pcName -> { appName, appPath, endsAt, paused, remaining, totalSeconds }
    loading: { pcs: false, subscription: false },
    error: { pcs: null, subscription: null }
  };

  var MAX_LOGS = 800;

  /* ==========================================================================
     EVENT BUS
     ========================================================================== */
  var listeners = {};
  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return function off() { listeners[evt] = listeners[evt].filter(function (f) { return f !== fn; }); };
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error("[store] listener error on " + evt, e); }
    });
    if (evt !== "*") emit("*", { type: evt, payload: payload });
  }

  /* ==========================================================================
     AUTH / TOKEN  (same storage keys as before)
     ========================================================================== */
  function token() { return localStorage.getItem("token") || ""; }
  function cafeId() { return state.user && state.user.cafe_id != null ? state.user.cafe_id : localStorage.getItem("cafeId"); }

  function authHeaders(extra) {
    return Object.assign({
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token()
    }, extra || {});
  }

  function request(path, options) {
    return fetch(API_BASE + path, Object.assign({ headers: authHeaders() }, options || {}))
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) {
            var msg = body && (body.message || body.error) ? (body.message || body.error) : "HTTP " + res.status;
            var err = new Error(msg);
            err.status = res.status;
            throw err;
          }
          return body;
        });
      });
  }

  /* ==========================================================================
     DERIVED VIEWS
     ========================================================================== */
  /** Status of a registered PC, derived from live WS connection + failures. */
  function pcStatus(pc) {
    var name = pc.name;
    if (state.running[name]) return "gaming";
    if (state.connected.indexOf(name) !== -1) return "online";
    var cs = state.connectionStatus[name];
    if (cs && cs.status === "failed") return "offline";
    if (pc.is_active === false) return "inactive";
    return "offline";
  }

  function counts() {
    var c = { total: state.pcs.length, online: 0, offline: 0, running: 0, inactive: 0, discovered: state.discovered.length, failing: 0 };
    state.pcs.forEach(function (pc) {
      var s = pcStatus(pc);
      if (s === "gaming") { c.running++; c.online++; }
      else if (s === "online") c.online++;
      else if (s === "inactive") c.inactive++;
      else c.offline++;
      var cs = state.connectionStatus[pc.name];
      if (cs && cs.failures > 0 && state.connected.indexOf(pc.name) === -1) c.failing++;
    });
    return c;
  }

  function getPC(name) { return state.pcsByName[name] || null; }

  function isConnected(name) { return state.connected.indexOf(name) !== -1; }

  /* ==========================================================================
     LOADERS
     ========================================================================== */
  function loadPCs() {
    state.loading.pcs = true;
    state.error.pcs = null;
    emit("pcs:loading");

    return Promise.resolve(api.getCafePCs ? api.getCafePCs() : { success: false, data: [], error: "IPC unavailable" })
      .then(function (result) {
        if (result && result.success && Array.isArray(result.data)) {
          state.pcs = result.data;
          state.pcsByName = {};
          result.data.forEach(function (pc) { state.pcsByName[pc.name] = pc; });
        } else {
          state.pcs = [];
          state.pcsByName = {};
          state.error.pcs = (result && result.error) || null;
        }
        state.loading.pcs = false;
        emit("pcs", state.pcs);
        return state.pcs;
      })
      .catch(function (err) {
        state.loading.pcs = false;
        state.error.pcs = err.message;
        emit("pcs", state.pcs);
        throw err;
      });
  }

  function loadSubscription() {
    var id = cafeId();
    if (!id) return Promise.resolve(null);
    state.loading.subscription = true;
    emit("subscription:loading");
    return request("/api/subscriptions/cafe/" + id)
      .then(function (result) {
        state.subscription = (result && result.success && result.data && result.data.length) ? result.data[0] : null;
        state.loading.subscription = false;
        state.error.subscription = null;
        emit("subscription", state.subscription);
        return state.subscription;
      })
      .catch(function (err) {
        state.loading.subscription = false;
        state.error.subscription = err.message;
        emit("subscription", null);
        throw err;
      });
  }

  /* ==========================================================================
     PC SOFTWARE  (identical endpoints to the previous renderer)
     ========================================================================== */
  function getPcSoftware(pcId) {
    return request("/api/pc-software/pc/" + pcId).then(function (d) { return d.data || []; });
  }

  function addPcSoftware(payload) {
    return request("/api/pc-software", { method: "POST", body: JSON.stringify(payload) });
  }

  function deletePcSoftware(softwareId) {
    return request("/api/pc-software/" + softwareId, { method: "DELETE" });
  }

  function getSoftwareMaster() {
    return request("/api/software-master?limit=100").then(function (d) { return d.data || []; });
  }

  /** Software list read through the main process (same IPC as before). */
  function getPcSoftwareViaIPC(pcId) {
    return bridge("getPcSoftwareFromAPI", pcId);
  }

  /** Live scan of installed software on a connected client. */
  function scanPcSoftware(pcName) {
    return bridge("fetchPcSoftware", pcName);
  }

  /* ==========================================================================
     PC REGISTRY
     ========================================================================== */
  function createPC(payload) {
    return request("/api/pcs", { method: "POST", body: JSON.stringify(payload) });
  }

  function registerDiscoveredPC(payload) {
    return request("/api/pcs/register-discovered", { method: "POST", body: JSON.stringify(payload) });
  }

  function updatePC(pcId, payload) {
    return request("/api/pcs/" + pcId, { method: "PUT", body: JSON.stringify(payload) });
  }

  /** Soft delete — backend sets is_active = false unless ?permanent=true. */
  function deactivatePC(pcId) {
    return request("/api/pcs/" + pcId, { method: "DELETE" });
  }

  function getMacAddress() { return bridge("getMacAddress"); }

  /* ==========================================================================
     CONNECTION CONTROL
     ========================================================================== */
  function connectToPC(ip, port, pcName) { return bridge("connectToPC", ip, port, pcName); }
  function reconnectAll() { return bridge("reconnectAllPCs"); }
  function getConnectionStatus() { return bridge("getConnectionStatus"); }
  function clearFailures(pcName) { return bridge("clearPCFailures", pcName); }
  function refreshPCList() { return bridge("refreshPCList"); }
  function checkConnection(ip, port) {
    return api.checkConnection ? Promise.resolve(api.checkConnection(ip, port)) : Promise.resolve(false);
  }

  /* ==========================================================================
     APP LAUNCH / TIMER
     Timer bookkeeping lives here so every page shows the same countdown.
     The launch/close calls themselves are untouched.
     ========================================================================== */
  var tickTimer = null;

  function launchApp(pcName, app, minutes) {
    return bridge("launchApp", {
      simId: pcName,
      appName: app.name,
      appPath: app.launch || app.path,
      timerMinutes: minutes
    }).then(function (result) {
      state.running[pcName] = {
        appName: app.name,
        appPath: app.launch || app.path,
        totalSeconds: minutes * 60,
        remaining: minutes * 60,
        paused: false,
        startedAt: Date.now()
      };
      startTicking();
      emit("running", state.running);
      emit("pcs", state.pcs);
      return result;
    });
  }

  function closeApp(pcName) {
    var run = state.running[pcName];
    if (!run) return Promise.resolve(false);
    return bridge("closeApp", {
      simId: pcName,
      appName: run.appName,
      appPath: run.appPath
    }).then(function (ok) {
      delete state.running[pcName];
      emit("running", state.running);
      emit("pcs", state.pcs);
      return ok;
    });
  }

  function pauseTimer(pcName, paused) {
    var run = state.running[pcName];
    if (!run) return;
    run.paused = !!paused;
    emit("running", state.running);
  }

  function addTime(pcName, minutes) {
    var run = state.running[pcName];
    if (!run) return;
    run.remaining += minutes * 60;
    run.totalSeconds += minutes * 60;
    emit("running", state.running);
  }

  function startTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(function () {
      var names = Object.keys(state.running);
      if (!names.length) { clearInterval(tickTimer); tickTimer = null; return; }
      var changed = false;
      names.forEach(function (name) {
        var run = state.running[name];
        if (run.paused) return;
        run.remaining = Math.max(0, run.remaining - 1);
        changed = true;
        if (run.remaining === 0) {
          // Same behaviour as before: time up closes the application.
          closeApp(name);
          emit("timer:expired", name);
        }
      });
      if (changed) emit("tick", state.running);
    }, 1000);
  }

  function refreshApps(pcName) { return bridge("refreshApps", pcName); }

  /* ==========================================================================
     LOGS
     ========================================================================== */
  function levelOf(msg) {
    var m = String(msg).toLowerCase();
    if (/(error|failed|fail|refused|denied|exception|✗|❌)/.test(m)) return "error";
    if (/(warn|timeout|retry|disconnect|unreachable|⚠)/.test(m)) return "warn";
    if (/(connected|success|registered|launched|✓|✅)/.test(m)) return "ok";
    return "info";
  }

  function pushLog(text) {
    var entry = { time: new Date(), text: String(text), level: levelOf(text) };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
    emit("log", entry);
  }

  /* ==========================================================================
     WIRE UP MAIN-PROCESS EVENTS  (same channels as before)
     ========================================================================== */
  function init() {
    if (api.onUserUpdated) {
      api.onUserUpdated(function (data) {
        if (!data || !data.user) return;
        state.user = data.user;
        if (data.token) {
          localStorage.setItem("token", data.token);
          localStorage.setItem("cafeId", data.user.cafe_id || "");
        }
        emit("user", state.user);
        loadPCs().catch(function () {});
        loadSubscription().catch(function () {});
      });
    }

    if (api.onClients) {
      api.onClients(function (list) {
        var before = state.connected.slice();
        state.connected = list || [];
        // Surface transitions so the UI can animate/notify precisely.
        state.connected.forEach(function (n) {
          if (before.indexOf(n) === -1) emit("pc:online", n);
        });
        before.forEach(function (n) {
          if (state.connected.indexOf(n) === -1) emit("pc:offline", n);
        });
        emit("connected", state.connected);
      });
    }

    if (api.onDiscoveredPCs) {
      api.onDiscoveredPCs(function (list) {
        var prev = state.discovered.length;
        state.discovered = list || [];
        emit("discovered", state.discovered);
        if (state.discovered.length > prev) emit("discovered:new", state.discovered);
      });
    }

    if (api.onPCConnectionStatus) {
      api.onPCConnectionStatus(function (status) {
        if (!status || !status.pcName) return;
        state.connectionStatus[status.pcName] = {
          status: status.status,
          failures: status.failures,
          error: status.error
        };
        emit("connection-status", status);
      });
    }

    if (api.onPCListRefreshed) {
      api.onPCListRefreshed(function (data) { emit("pc-list-refreshed", data); });
    }

    if (api.onAppsUpdated) {
      api.onAppsUpdated(function (data) {
        if (!data) return;
        if (data.simId) state.apps[data.simId] = data.apps;
        if (data.pcName) state.apps[data.pcName] = data.apps;
        emit("apps", data);
      });
    }

    if (api.onLog) api.onLog(pushLog);

    // Same event bridge the old renderer listened on.
    window.addEventListener("discovered-pcs-update", function (event) {
      state.discovered = event.detail || [];
      emit("discovered", state.discovered);
    });
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("cafeId");
    localStorage.removeItem("authToken");
    state.user = null;
    state.pcs = [];
    state.pcsByName = {};
    state.apps = {};
    state.running = {};
    state.subscription = null;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    emit("user", null);
    bridge("logout");
  }

  function login() { bridge("login"); }

  global.CXStore = {
    state: state,
    on: on,
    emit: emit,
    init: init,
    API_BASE: API_BASE,

    // auth
    login: login,
    logout: logout,
    token: token,
    cafeId: cafeId,

    // loaders
    loadPCs: loadPCs,
    loadSubscription: loadSubscription,

    // derived
    pcStatus: pcStatus,
    counts: counts,
    getPC: getPC,
    isConnected: isConnected,

    // pc registry
    createPC: createPC,
    registerDiscoveredPC: registerDiscoveredPC,
    updatePC: updatePC,
    deactivatePC: deactivatePC,
    getMacAddress: getMacAddress,

    // software
    getPcSoftware: getPcSoftware,
    getPcSoftwareViaIPC: getPcSoftwareViaIPC,
    addPcSoftware: addPcSoftware,
    deletePcSoftware: deletePcSoftware,
    getSoftwareMaster: getSoftwareMaster,
    scanPcSoftware: scanPcSoftware,

    // connections
    connectToPC: connectToPC,
    reconnectAll: reconnectAll,
    getConnectionStatus: getConnectionStatus,
    clearFailures: clearFailures,
    refreshPCList: refreshPCList,
    checkConnection: checkConnection,

    // launch / timer
    launchApp: launchApp,
    closeApp: closeApp,
    pauseTimer: pauseTimer,
    addTime: addTime,
    refreshApps: refreshApps,

    // logs
    pushLog: pushLog
  };
})(window);
