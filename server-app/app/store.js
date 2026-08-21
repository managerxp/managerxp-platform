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
    running: {},                // pcName -> { appName, appPath, remaining, totalSeconds } (launch timer)
    sessions: {},               // pcName -> live session from /api/sessions
    me: null,                   // signed-in principal from /api/staff/me
    permissions: null,          // permission keys, or null for full access
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
     ENTITLEMENTS

     What this café's subscription includes, as decided by ManagerXP. The
     answer is never computed here — the backend resolves package, overrides
     and add-ons in one place, and this asks it. A second implementation would
     mean the console could show a module the server then refuses.

     The last answer is cached in localStorage so a start-up with no network
     uses what was true yesterday rather than nothing. Section 50's offline
     grace is the same idea applied to the whole application.
     ========================================================================== */
  var ENT_CACHE_KEY = "cx.entitlements";

  function cachedEntitlements() {
    try { return JSON.parse(localStorage.getItem(ENT_CACHE_KEY) || "null"); }
    catch (e) { return null; }
  }

  function getEntitlements() {
    return request("/api/entitlements/me")
      .then(function (body) {
        var data = body && body.data;
        if (data && data.resolved) {
          localStorage.setItem(ENT_CACHE_KEY, JSON.stringify(
            { data: data, cached_at: Date.now() }
          ));
        }
        return data;
      })
      .catch(function (err) {
        /* Offline, or the backend is down. Fall back to the last known answer
           while it is still inside the grace window; a café mid-service must
           not lose half its console because a network cable moved. */
        var cached = cachedEntitlements();
        if (!cached) throw err;

        var graceMs = (cached.data.offline_grace_hours || 72) * 3600 * 1000;
        if (Date.now() - cached.cached_at > graceMs) throw err;

        return cached.data;
      });
  }

  /* ==========================================================================
     DERIVED VIEWS
     ========================================================================== */
  /** Status of a registered PC, derived from live WS connection + failures. */
  function pcStatus(pc) {
    var name = pc.name;
    // Deactivated is an administrative decision, so it outranks whatever the
    // network is doing. It used to be checked last, which meant a station
    // taken out of service still read "Available" while it happened to be
    // connected — even though no session could be started on it.
    if (pc.is_active === false) return "inactive";

    var session = state.sessions[name];
    if (session) return session.status === "paused" ? "maintenance" : "gaming";
    if (state.running[name]) return "gaming";
    if (state.connected.indexOf(name) !== -1) return "online";
    var cs = state.connectionStatus[name];
    if (cs && cs.status === "failed") return "offline";
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

  /** Bring a deactivated station back into service. */
  function restorePC(pcId) {
    return request("/api/pcs/" + pcId + "/restore", { method: "PATCH" });
  }

  /** Remove the record entirely. Refused if the station has sessions. */
  function deletePC(pcId) {
    return request("/api/pcs/" + pcId + "?permanent=true", { method: "DELETE" });
  }

  function getMacAddress() { return bridge("getMacAddress"); }

  /* ==========================================================================
     CAFEXP AI
     The backend does the analysis; this only carries the question and renders
     what comes back. No figure is computed on this side.
     ========================================================================== */
  function aiAsk(question, conversationId) {
    return request("/api/ai/ask", {
      method: "POST",
      body: JSON.stringify({ question: question, conversation_id: conversationId })
    }).then(function (r) { return r.data; });
  }
  function aiSuggestions() {
    return request("/api/ai/suggestions").then(function (r) { return r.data || []; });
  }
  function aiHealth() {
    return request("/api/ai/health").then(function (r) { return r.data; });
  }

  /* ==========================================================================
     PAYMENT GATEWAYS

     Note what is absent: there is no method to read a stored secret back. The
     API does not return one, so the console cannot display one, so a shoulder
     surfer cannot read one off the counter screen. Saving with a blank secret
     field leaves the stored value alone.
     ========================================================================== */
  function listGateways() {
    return request("/api/payments/gateways").then(function (r) { return r.data; });
  }
  function saveGateway(provider, payload) {
    return request("/api/payments/gateways/" + encodeURIComponent(provider), {
      method: "PUT",
      body: JSON.stringify(payload)
    }).then(function (r) { return r.data; });
  }
  function testGateway(provider) {
    return request("/api/payments/gateways/" + encodeURIComponent(provider) + "/test", {
      method: "POST"
    });
  }
  function deleteGateway(provider) {
    return request("/api/payments/gateways/" + encodeURIComponent(provider), { method: "DELETE" });
  }
  function listTopups(limit) {
    return request("/api/payments/topups?limit=" + (limit || 100))
      .then(function (r) { return r.data; });
  }

  /* Cash top-ups awaiting a person. Approving one credits a wallet, so these
     sit behind payments.topup.approve rather than the gateway permissions. */
  function pendingTopups() {
    return request("/api/payments/topups/pending").then(function (r) { return r.data || []; });
  }
  function approveTopup(topupId) {
    return request("/api/payments/topups/" + topupId + "/approve", { method: "POST" });
  }
  function rejectTopup(topupId, reason) {
    return request("/api/payments/topups/" + topupId + "/reject", {
      method: "POST",
      body: JSON.stringify({ reason: reason })
    });
  }

  /* ==========================================================================
     AUDIT & REPORTS
     ========================================================================== */
  function listAudit(opts) {
    opts = opts || {};
    var query = [];
    Object.keys(opts).forEach(function (key) {
      if (opts[key] !== null && opts[key] !== undefined && opts[key] !== "") {
        query.push(key + "=" + encodeURIComponent(opts[key]));
      }
    });
    return request("/api/audit" + (query.length ? "?" + query.join("&") : ""));
  }
  function auditFacets() {
    return request("/api/audit/facets").then(function (d) { return d.data; });
  }

  function reportQuery(path, opts) {
    opts = opts || {};
    var query = [];
    Object.keys(opts).forEach(function (key) {
      if (opts[key]) query.push(key + "=" + encodeURIComponent(opts[key]));
    });
    return request("/api/reports/" + path + (query.length ? "?" + query.join("&") : ""));
  }

  /* ==========================================================================
     STATION POWER
     The backend authorises and records; the bridge delivers. Kept in that
     order so the trail can never be missing an action that actually ran.
     ========================================================================== */
  function stationPower(pcName, action, reason, delaySeconds) {
    return request("/api/stations/power", {
      method: "POST",
      body: JSON.stringify({ pc_name: pcName, action: action, reason: reason || null })
    }).then(function (authorised) {
      /* Powering on cannot travel over the client's socket — the station is
         off. It goes out as a Wake-on-LAN broadcast from this machine, which
         is the only one on the café's own network. */
      if (action === "wake") {
        var pc = getPC(pcName);
        return bridge("stationWake", pcName, pc && pc.mac_address).then(function (sent) {
          if (!sent || !sent.success) {
            throw new Error((sent && sent.error) || "Could not send the wake packet");
          }
          return authorised;
        });
      }

      return bridge("stationPower", pcName, action, delaySeconds).then(function (sent) {
        if (!sent || !sent.success) {
          throw new Error((sent && sent.error) || "Could not reach the station");
        }
        return authorised;
      });
    });
  }

  /**
   * Run one action across several stations.
   *
   * Sequential rather than parallel, on purpose. Twenty stations rebooting at
   * the same instant is a power spike and a DHCP stampede; more practically,
   * every one of them authorises against the backend first, and firing twenty
   * of those at once is how you get rate-limited mid-way and cannot tell which
   * half went through.
   *
   * Never rejects. One unreachable station must not abandon the other
   * nineteen, so every result — good or bad — comes back in the list and the
   * caller reports the whole picture.
   */
  function stationPowerMany(pcNames, action, reason, delaySeconds, onProgress) {
    var results = [];
    var queue = (pcNames || []).slice();

    function next() {
      if (!queue.length) return Promise.resolve(results);
      var name = queue.shift();

      return stationPower(name, action, reason, delaySeconds)
        .then(function () { results.push({ pc_name: name, ok: true }); })
        .catch(function (err) { results.push({ pc_name: name, ok: false, error: err.message }); })
        .then(function () {
          if (onProgress) {
            try { onProgress(results.length, (pcNames || []).length, results[results.length - 1]); }
            catch (e) { /* a progress callback must not stop the run */ }
          }
          return next();
        });
    }

    return next();
  }

  /* ==========================================================================
     TELEMETRY
     Live readings come from the main process, which holds what the stations
     have just pushed; history comes from the backend, which persisted them.
     ========================================================================== */
  function telemetryLatest() {
    return request("/api/telemetry/latest");
  }
  function telemetryHistory(pcName, minutes, points) {
    return request("/api/telemetry/history/" + encodeURIComponent(pcName) +
      "?minutes=" + (minutes || 60) + "&points=" + (points || 120))
      .then(function (d) { return d; });
  }
  function telemetryAlerts() {
    return request("/api/telemetry/alerts").then(function (d) { return d.data || []; });
  }
  function clearTelemetry(pcName) {
    return request("/api/telemetry/" + encodeURIComponent(pcName), { method: "DELETE" });
  }

  /** What the stations reported to this console since it started. */
  function liveTelemetry() {
    return bridge("getLatestTelemetry").then(function (r) {
      return (r && r.data) || [];
    });
  }
  function requestTelemetry(pcName) {
    return bridge("requestTelemetry", pcName);
  }
  function setTelemetryInterval(seconds) {
    return bridge("setTelemetryInterval", seconds);
  }

  /* ==========================================================================
     FLOOR ZONES & LAYOUT
     Presentation only — a zone never affects pricing, sessions or billing.
     ========================================================================== */
  function listZones() {
    return request("/api/floor-zones").then(function (d) { return d.data || []; });
  }
  function createZone(body) {
    return request("/api/floor-zones", { method: "POST", body: JSON.stringify(body) });
  }
  function updateZone(zoneId, body) {
    return request("/api/floor-zones/" + zoneId, { method: "PUT", body: JSON.stringify(body) });
  }
  function deleteZone(zoneId) {
    return request("/api/floor-zones/" + zoneId, { method: "DELETE" });
  }
  function assignStations(assignments) {
    return request("/api/floor-zones/assign", {
      method: "PUT", body: JSON.stringify({ assignments: assignments })
    });
  }

  /** Café-wide preferences, so every terminal sees the same floor. */
  function getSettings(category) {
    return request("/api/settings" + (category ? "?category=" + encodeURIComponent(category) : ""))
      .then(function (d) { return d.data || []; });
  }
  function setSetting(key, value) {
    return request("/api/settings/" + encodeURIComponent(key), {
      method: "PUT", body: JSON.stringify({ value: String(value) })
    });
  }

  /* ==========================================================================
     CUSTOMERS & WALLET  (staff endpoints — the admin token carries `role`)
     ========================================================================== */
  function getCustomers(opts) {
    opts = opts || {};
    var query = [];
    if (opts.search) query.push("search=" + encodeURIComponent(opts.search));
    query.push("limit=" + (opts.limit || 100));
    if (opts.offset) query.push("offset=" + opts.offset);
    return request("/api/customers?" + query.join("&"));
  }

  function getCustomer(customerId) {
    return request("/api/customers/" + customerId).then(function (d) { return d.data; });
  }

  function createCustomer(body) {
    return request("/api/customers", { method: "POST", body: JSON.stringify(body) });
  }

  function getCustomerWallet(customerId) {
    return request("/api/wallet/customer/" + customerId).then(function (d) { return d.data; });
  }

  function getCustomerWalletTransactions(customerId, limit) {
    return request("/api/wallet/customer/" + customerId + "/transactions?limit=" + (limit || 25));
  }

  function creditWallet(customerId, payload) {
    return request("/api/wallet/customer/" + customerId + "/credit", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  function debitWallet(customerId, payload) {
    return request("/api/wallet/customer/" + customerId + "/debit", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  /* ==========================================================================
     SESSIONS
     The backend owns sessions; the store keeps a live copy keyed by station so
     every page shows the same countdown.
     ========================================================================== */
  var sessionTicker = null;

  function loadSessions() {
    return request("/api/sessions?status=active,paused&limit=200")
      .then(function (body) {
        state.sessions = {};
        (body.data || []).forEach(function (s) {
          if (s.pc_name) state.sessions[s.pc_name] = s;
        });
        startSessionTicker();
        emit("sessions", state.sessions);
        return state.sessions;
      })
      .catch(function (err) {
        console.error("[store] session load failed", err);
        emit("sessions", state.sessions);
        throw err;
      });
  }

  function sessionFor(pcName) { return state.sessions[pcName] || null; }

  /**
   * Keep the admin's picture in step with the backend even when another
   * terminal starts or ends a session, and re-push state to stations so a
   * client that restarts mid-session gets its countdown back.
   */
  var reconcileTimer = null;
  function reconcileOnce() {
    if (!state.user) return Promise.resolve();
    return loadSessions().then(function (sessions) {
      // Push to every registered station rather than only those the renderer
      // believes are connected — the main process drops it harmlessly if the
      // station is offline, and this survives a missed "clients" event.
      state.pcs.forEach(function (pc) {
        pushSessionToStation(pc.name, sessions[pc.name] || null);
      });
    }).catch(function (err) {
      // Never let one failure stop the loop — the next tick tries again.
      console.warn("[store] session reconcile failed", err.message);
    });
  }

  function startSessionReconcile() {
    if (reconcileTimer) return;
    reconcileTimer = setInterval(reconcileOnce, 15000);
  }

  /** Local countdown between refreshes; the server stays authoritative. */
  function startSessionTicker() {
    if (sessionTicker) return;
    sessionTicker = setInterval(function () {
      var names = Object.keys(state.sessions);
      if (!names.length) { clearInterval(sessionTicker); sessionTicker = null; return; }
      names.forEach(function (name) {
        var s = state.sessions[name];
        if (s.status !== "active") return;
        s.elapsed_seconds += 1;
        if (s.remaining_seconds !== null) s.remaining_seconds = Math.max(0, s.remaining_seconds - 1);
        s.running_amount = Number((s.rate_per_hour * (s.elapsed_seconds / 3600)).toFixed(2));
      });
      emit("session-tick", state.sessions);
    }, 1000);
  }

  /** Mirror a session onto its station so the customer portal can show it. */
  function pushSessionToStation(pcName, session) {
    if (!api.pushSessionState) return Promise.resolve();
    return api.pushSessionState(pcName, session).catch(function (e) {
      console.warn("[store] session push failed", e);
    });
  }

  function afterSessionChange(session, pcNameOverride) {
    var pcName = pcNameOverride || (session && session.pc_name);
    if (session && session.status !== "ended") state.sessions[pcName] = session;
    else if (pcName) delete state.sessions[pcName];

    startSessionTicker();
    emit("sessions", state.sessions);
    emit("pcs", state.pcs);
    return pushSessionToStation(pcName, session && session.status !== "ended" ? session : null)
      .then(function () { return session; });
  }

  function startSession(payload) {
    return request("/api/sessions", { method: "POST", body: JSON.stringify(payload) })
      .then(function (r) { return afterSessionChange(r.data); });
  }

  function sessionAction(sessionId, action, body) {
    return request("/api/sessions/" + sessionId + "/" + action, {
      method: "POST",
      body: JSON.stringify(body || {})
    }).then(function (r) { return r; });
  }

  function pauseSession(session) {
    return sessionAction(session.session_id, "pause").then(function (r) {
      return afterSessionChange(r.data);
    });
  }
  function resumeSession(session) {
    return sessionAction(session.session_id, "resume").then(function (r) {
      return afterSessionChange(r.data);
    });
  }
  function extendSession(session, minutes) {
    return sessionAction(session.session_id, "extend", { minutes: minutes }).then(function (r) {
      return afterSessionChange(r.data);
    });
  }
  function transferSession(session, pcId) {
    var from = session.pc_name;
    return sessionAction(session.session_id, "transfer", { pc_id: pcId }).then(function (r) {
      delete state.sessions[from];
      return pushSessionToStation(from, null).then(function () {
        return afterSessionChange(r.data);
      });
    });
  }
  function endSession(session, opts) {
    return sessionAction(session.session_id, "end", opts || {}).then(function (r) {
      return afterSessionChange(r.data, session.pc_name).then(function () { return r; });
    });
  }

  function listSessions(query) {
    var parts = [];
    Object.keys(query || {}).forEach(function (k) {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") {
        parts.push(k + "=" + encodeURIComponent(query[k]));
      }
    });
    return request("/api/sessions?" + parts.join("&"));
  }

  function sessionDefaults() {
    return request("/api/sessions/defaults").then(function (r) { return r.data; });
  }

  /* ==========================================================================
     MASTER DATA — sessions and gaming prices
     ========================================================================== */
  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== "") parts.push(k + "=" + encodeURIComponent(v));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  // Staff, roles and permissions
  function whoAmI() { return request("/api/staff/me").then(function (r) { return r.data; }); }
  function listStaff(params) { return request("/api/staff" + qs(params)); }
  function createStaff(body) {
    return request("/api/staff", { method: "POST", body: JSON.stringify(body) });
  }
  function updateStaff(id, body) {
    return request("/api/staff/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function setStaffStatus(id, status) {
    return request("/api/staff/" + id + "/status", {
      method: "PATCH", body: JSON.stringify({ status: status })
    });
  }
  function listRoles() { return request("/api/staff/roles").then(function (r) { return r.data; }); }
  function listPermissions() { return request("/api/staff/permissions"); }
  function createRole(body) {
    return request("/api/staff/roles", { method: "POST", body: JSON.stringify(body) });
  }
  function createPermission(body) {
    return request("/api/staff/permissions", { method: "POST", body: JSON.stringify(body) });
  }
  function deletePermission(key) {
    return request("/api/staff/permissions/" + encodeURIComponent(key), { method: "DELETE" });
  }
  function setRolePermissions(roleId, permissions) {
    return request("/api/staff/roles/" + roleId + "/permissions", {
      method: "PUT", body: JSON.stringify({ permissions: permissions })
    });
  }
  function deleteRole(roleId) {
    return request("/api/staff/roles/" + roleId, { method: "DELETE" });
  }

  /** What the signed-in principal may do. Loaded once at boot. */
  function loadPermissions() {
    return whoAmI()
      .then(function (me) {
        state.me = me;
        state.permissions = me.permissions || [];
        emit("permissions", state.permissions);
        return me;
      })
      .catch(function (err) {
        console.warn("[store] could not resolve permissions", err.message);
        // Without an answer, assume full access rather than locking the owner
        // out of their own console; the server still enforces the truth.
        state.permissions = null;
        emit("permissions", null);
      });
  }

  function can(permissionKey) {
    if (!state.permissions) return true;   // unknown, or owner
    return state.permissions.indexOf(permissionKey) !== -1;
  }

  // Products, categories, stock
  function listProducts(params) { return request("/api/products" + qs(params)); }
  function createProduct(body) {
    return request("/api/products", { method: "POST", body: JSON.stringify(body) });
  }
  function updateProduct(id, body) {
    return request("/api/products/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function setProductAvailability(id, available) {
    return request("/api/products/" + id + "/availability", {
      method: "PATCH", body: JSON.stringify({ is_available: available })
    });
  }
  function deleteProduct(id) { return request("/api/products/" + id, { method: "DELETE" }); }
  function adjustStock(id, body) {
    return request("/api/products/" + id + "/stock", { method: "POST", body: JSON.stringify(body) });
  }
  function stockMovements(id) {
    return request("/api/products/" + id + "/movements").then(function (r) { return r.data; });
  }
  function inventorySummary() {
    return request("/api/products/inventory/summary").then(function (r) { return r.data; });
  }
  function listProductCategories(params) { return request("/api/products/categories" + qs(params)); }
  function createProductCategory(body) {
    return request("/api/products/categories", { method: "POST", body: JSON.stringify(body) });
  }
  function updateProductCategory(id, body) {
    return request("/api/products/categories/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function deleteProductCategory(id) {
    return request("/api/products/categories/" + id, { method: "DELETE" });
  }

  // Orders
  function listOrders(params) { return request("/api/orders" + qs(params)); }
  function setOrderStatus(id, status) {
    return request("/api/orders/" + id + "/status", {
      method: "PATCH", body: JSON.stringify({ status: status })
    });
  }

  // Packages
  function listPackages(params) { return request("/api/packages" + qs(params)); }
  function createPackage(body) {
    return request("/api/packages", { method: "POST", body: JSON.stringify(body) });
  }
  function updatePackage(id, body) {
    return request("/api/packages/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function setPackageStatus(id, status) {
    return request("/api/packages/" + id + "/status", {
      method: "PATCH", body: JSON.stringify({ status: status })
    });
  }
  function deletePackage(id) { return request("/api/packages/" + id, { method: "DELETE" }); }
  function purchasePackage(id, body) {
    return request("/api/packages/" + id + "/purchase", { method: "POST", body: JSON.stringify(body) });
  }
  function customerPackages(customerId) {
    return request("/api/packages/customer/" + customerId).then(function (r) { return r.data; });
  }

  // Memberships
  function listPlans(params) { return request("/api/memberships/plans" + qs(params)); }
  function createPlan(body) {
    return request("/api/memberships/plans", { method: "POST", body: JSON.stringify(body) });
  }
  function updatePlan(id, body) {
    return request("/api/memberships/plans/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function setPlanStatus(id, status) {
    return request("/api/memberships/plans/" + id + "/status", {
      method: "PATCH", body: JSON.stringify({ status: status })
    });
  }
  function subscribeCustomer(planId, body) {
    return request("/api/memberships/plans/" + planId + "/subscribe", {
      method: "POST", body: JSON.stringify(body)
    });
  }
  function listMemberships(params) { return request("/api/memberships" + qs(params)); }
  function customerMembership(customerId) {
    return request("/api/memberships/customer/" + customerId).then(function (r) { return r.data; });
  }
  function cancelMembership(id) {
    return request("/api/memberships/" + id + "/cancel", { method: "POST" });
  }

  // Billing
  function listBills(params) { return request("/api/bills" + qs(params)); }
  function getBill(id) { return request("/api/bills/" + id).then(function (r) { return r.data; }); }
  function addBillItem(id, item) {
    return request("/api/bills/" + id + "/items", { method: "POST", body: JSON.stringify(item) });
  }
  function removeBillItem(id, itemId) {
    return request("/api/bills/" + id + "/items/" + itemId, { method: "DELETE" });
  }
  function adjustBill(id, body) {
    return request("/api/bills/" + id + "/discount", { method: "PATCH", body: JSON.stringify(body) });
  }
  function payBill(id, body) {
    return request("/api/bills/" + id + "/payments", { method: "POST", body: JSON.stringify(body) });
  }
  function voidBill(id, reason) {
    return request("/api/bills/" + id + "/void", { method: "POST", body: JSON.stringify({ reason: reason }) });
  }
  function createBill(body) {
    return request("/api/bills", { method: "POST", body: JSON.stringify(body) });
  }
  /** Return money against a paid bill. A reason is required by the server. */
  /* What can still be refunded on a bill, line by line. Computed by the
     server from the bill's own stored prices — the till never works out a
     refundable quantity itself. */
  function getRefundable(billId) {
    return request("/api/bills/" + billId + "/refundable").then(function (r) { return r.data; });
  }
  function listBillRefunds(billId) {
    return request("/api/bills/" + billId + "/refunds").then(function (r) { return r.data || []; });
  }

  function refundBill(id, body) {
    return request("/api/bills/" + id + "/refund", {
      method: "POST", body: JSON.stringify(body)
    });
  }
  /** Move a guest bill onto a registered customer. */
  function claimBill(id, customerId) {
    return request("/api/bills/" + id + "/customer", {
      method: "PATCH", body: JSON.stringify({ customer_id: customerId })
    });
  }
  function applyBillCode(id, code) {
    return request("/api/bills/" + id + "/discount-code", {
      method: "POST", body: JSON.stringify({ code: code })
    });
  }
  function removeBillCode(id) {
    return request("/api/bills/" + id + "/discount-code", { method: "DELETE" });
  }

  /* ==========================================================================
     DISCOUNT CODES
     ========================================================================== */
  function listDiscounts(params) {
    return request("/api/discounts" + qs(params)).then(function (r) { return r.data || []; });
  }
  function createDiscount(body) {
    return request("/api/discounts", { method: "POST", body: JSON.stringify(body) });
  }
  function setDiscountStatus(id, status) {
    return request("/api/discounts/" + id + "/status", {
      method: "PATCH", body: JSON.stringify({ status: status })
    });
  }
  function deleteDiscount(id) {
    return request("/api/discounts/" + id, { method: "DELETE" });
  }
  function discountRedemptions(id) {
    return request("/api/discounts/" + id + "/redemptions").then(function (r) { return r.data || []; });
  }
  /** Check a code before it is committed to a bill. Never throws on refusal. */
  function validateDiscount(code, customerId, subtotal) {
    return request("/api/discounts/validate", {
      method: "POST",
      body: JSON.stringify({ code: code, customer_id: customerId, subtotal: subtotal })
    }).catch(function (e) { return { success: false, message: e.message }; });
  }

  // Session Master
  function listSessionMaster(params) { return request("/api/session-master" + qs(params)); }
  function createSessionMaster(body) {
    return request("/api/session-master", { method: "POST", body: JSON.stringify(body) });
  }
  function updateSessionMaster(id, body) {
    return request("/api/session-master/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function setSessionMasterStatus(id, status) {
    return request("/api/session-master/" + id + "/status", {
      method: "PATCH", body: JSON.stringify({ status: status })
    });
  }
  function deleteSessionMaster(id, force) {
    return request("/api/session-master/" + id + (force ? "?force=true" : ""), { method: "DELETE" });
  }

  // Games come from the software catalogue.
  function listGames(params) {
    return request("/api/software-master" + qs(Object.assign({ limit: 200 }, params || {})));
  }

  // Gaming Price Master
  function listGamingPrices(params) { return request("/api/gaming-prices" + qs(params)); }
  function createGamingPrice(body) {
    return request("/api/gaming-prices", { method: "POST", body: JSON.stringify(body) });
  }
  function updateGamingPrice(id, body) {
    return request("/api/gaming-prices/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function setGamingPriceStatus(id, status) {
    return request("/api/gaming-prices/" + id + "/status", {
      method: "PATCH", body: JSON.stringify({ status: status })
    });
  }
  function deleteGamingPrice(id) {
    return request("/api/gaming-prices/" + id, { method: "DELETE" });
  }
  function lookupGamingPrice(softwareId, sessionMasterId) {
    return request("/api/gaming-prices/lookup" + qs({
      software_id: softwareId, session_master_id: sessionMasterId
    }));
  }

  /* ==========================================================================
     CONNECTION CONTROL
     ========================================================================== */
  function connectToPC(ip, port, pcName) { return bridge("connectToPC", ip, port, pcName); }
  function reconnectAll() { return bridge("reconnectAllPCs"); }
  function getConnectionStatus() { return bridge("getConnectionStatus"); }

  /**
   * Adopt a connected-station list, emitting the transitions the UI animates
   * and notifies on. Shared by the pushed event and the pull below, so both
   * routes behave identically.
   */
  function applyConnected(list) {
    var next = list || [];
    var before = state.connected.slice();

    // Nothing changed — stay quiet rather than emit on every poll.
    if (next.length === before.length &&
        next.every(function (n) { return before.indexOf(n) !== -1; })) {
      return;
    }

    state.connected = next;

    state.connected.forEach(function (n) {
      if (before.indexOf(n) === -1) {
        emit("pc:online", n);
        // A station that just (re)connected needs its session pushed again,
        // otherwise a client restart would lose the customer's countdown.
        pushSessionToStation(n, state.sessions[n] || null);
      }
    });
    before.forEach(function (n) {
      if (state.connected.indexOf(n) === -1) emit("pc:offline", n);
    });
    emit("connected", state.connected);
  }

  /** Pull the live list from the main process. */
  function syncConnected() {
    return bridge("getConnectedPCs")
      .then(function (r) { if (r && r.success) applyConnected(r.data); })
      .catch(function () {});
  }
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
        loadSessions().catch(function () {});
        loadPermissions();
      });
    }

    if (api.onClients) api.onClients(applyConnected);

    // The "clients" event only fires when a station registers or drops. The
    // main process connects during startup, before this window has loaded, so
    // that single event is missed and every station reads offline while its
    // socket is alive. Ask for the current list rather than wait for the next
    // reconnect, and keep asking on a slow beat so the two can never drift.
    syncConnected();
    setInterval(syncConnected, 10000);

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

    startSessionReconcile();

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

    // what ManagerXP says this café's subscription includes
    getEntitlements: getEntitlements,

    // derived
    pcStatus: pcStatus,
    counts: counts,
    getPC: getPC,
    isConnected: isConnected,

    // staff & access control
    whoAmI: whoAmI,
    loadPermissions: loadPermissions,
    can: can,
    listStaff: listStaff,
    createStaff: createStaff,
    updateStaff: updateStaff,
    setStaffStatus: setStaffStatus,
    listRoles: listRoles,
    listPermissions: listPermissions,
    createRole: createRole,
    createPermission: createPermission,
    deletePermission: deletePermission,
    setRolePermissions: setRolePermissions,
    deleteRole: deleteRole,

    // products, stock & orders
    listProducts: listProducts,
    createProduct: createProduct,
    updateProduct: updateProduct,
    setProductAvailability: setProductAvailability,
    deleteProduct: deleteProduct,
    adjustStock: adjustStock,
    stockMovements: stockMovements,
    inventorySummary: inventorySummary,
    listProductCategories: listProductCategories,
    createProductCategory: createProductCategory,
    updateProductCategory: updateProductCategory,
    deleteProductCategory: deleteProductCategory,
    listOrders: listOrders,
    setOrderStatus: setOrderStatus,

    // packages & memberships
    listPackages: listPackages,
    createPackage: createPackage,
    updatePackage: updatePackage,
    setPackageStatus: setPackageStatus,
    deletePackage: deletePackage,
    purchasePackage: purchasePackage,
    customerPackages: customerPackages,
    listPlans: listPlans,
    createPlan: createPlan,
    updatePlan: updatePlan,
    setPlanStatus: setPlanStatus,
    subscribeCustomer: subscribeCustomer,
    listMemberships: listMemberships,
    customerMembership: customerMembership,
    cancelMembership: cancelMembership,

    // billing
    listBills: listBills,
    getBill: getBill,
    addBillItem: addBillItem,
    removeBillItem: removeBillItem,
    adjustBill: adjustBill,
    payBill: payBill,
    voidBill: voidBill,
    createBill: createBill,
    refundBill: refundBill,
    getRefundable: getRefundable,
    listBillRefunds: listBillRefunds,
    claimBill: claimBill,
    applyBillCode: applyBillCode,
    removeBillCode: removeBillCode,

    // discount codes
    listDiscounts: listDiscounts,
    createDiscount: createDiscount,
    setDiscountStatus: setDiscountStatus,
    deleteDiscount: deleteDiscount,
    discountRedemptions: discountRedemptions,
    validateDiscount: validateDiscount,

    // master data
    listSessionMaster: listSessionMaster,
    createSessionMaster: createSessionMaster,
    updateSessionMaster: updateSessionMaster,
    setSessionMasterStatus: setSessionMasterStatus,
    deleteSessionMaster: deleteSessionMaster,
    listGames: listGames,
    listGamingPrices: listGamingPrices,
    createGamingPrice: createGamingPrice,
    updateGamingPrice: updateGamingPrice,
    setGamingPriceStatus: setGamingPriceStatus,
    deleteGamingPrice: deleteGamingPrice,
    lookupGamingPrice: lookupGamingPrice,

    // sessions
    loadSessions: loadSessions,
    listSessions: listSessions,
    sessionFor: sessionFor,
    sessionDefaults: sessionDefaults,
    startSession: startSession,
    pauseSession: pauseSession,
    resumeSession: resumeSession,
    extendSession: extendSession,
    transferSession: transferSession,
    endSession: endSession,
    pushSessionToStation: pushSessionToStation,

    // CafeXP AI
    aiAsk: aiAsk,
    aiSuggestions: aiSuggestions,
    aiHealth: aiHealth,

    listGateways: listGateways,
    saveGateway: saveGateway,
    testGateway: testGateway,
    deleteGateway: deleteGateway,
    listTopups: listTopups,
    pendingTopups: pendingTopups,
    approveTopup: approveTopup,
    rejectTopup: rejectTopup,

    // audit, reports & station power
    listAudit: listAudit,
    auditFacets: auditFacets,
    report: reportQuery,
    stationPower: stationPower,
    stationPowerMany: stationPowerMany,

    // telemetry
    telemetryLatest: telemetryLatest,
    telemetryHistory: telemetryHistory,
    telemetryAlerts: telemetryAlerts,
    clearTelemetry: clearTelemetry,
    liveTelemetry: liveTelemetry,
    requestTelemetry: requestTelemetry,
    setTelemetryInterval: setTelemetryInterval,

    // floor zones & layout
    listZones: listZones,
    createZone: createZone,
    updateZone: updateZone,
    deleteZone: deleteZone,
    assignStations: assignStations,
    getSettings: getSettings,
    setSetting: setSetting,

    // customers & wallet
    getCustomers: getCustomers,
    getCustomer: getCustomer,
    createCustomer: createCustomer,
    getCustomerWallet: getCustomerWallet,
    getCustomerWalletTransactions: getCustomerWalletTransactions,
    creditWallet: creditWallet,
    debitWallet: debitWallet,

    // pc registry
    createPC: createPC,
    registerDiscoveredPC: registerDiscoveredPC,
    updatePC: updatePC,
    deactivatePC: deactivatePC,
    restorePC: restorePC,
    deletePC: deletePC,
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
    syncConnected: syncConnected,
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
