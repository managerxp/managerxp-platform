/* ==========================================================================
   CafeXP — Data store
   The single place the Admin UI talks to the outside world.

   IMPORTANT: this file changes no contracts. Every IPC channel, endpoint,
   payload shape and header below is exactly what the previous renderer used.
   Pages read from CXStore.state and subscribe to CXStore.on(...).
   ========================================================================== */
(function (global) {
  "use strict";

  var api = global.api || {};                    // preload bridge
  // preload.js resolves this synchronously from main.js's BACKEND_PORT
  // (.env, default 5000) before this script runs; the literal is only what
  // a bridge-less context (a stray browser tab) falls back to.
  var API_BASE = api.backendLocal || "http://localhost:5000";

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
    helpRequests: {},           // pcName -> { at } — customer tapped Call staff, cleared once staff open that station
    launchers: {},              // pcName -> { Steam: {installed, path}, ... } reported by the station
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
    /* A FormData body sets its own multipart boundary in the Content-Type
       header; forcing "application/json" on top of it, as authHeaders always
       used to, leaves the server unable to parse either. */
    var isFormData = options && options.body && typeof FormData !== "undefined" && options.body instanceof FormData;
    var headers = isFormData
      ? { "Authorization": "Bearer " + token() }
      : authHeaders();
    return fetch(API_BASE + path, Object.assign({ headers: headers }, options || {}))
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

  /* Every add-on ManagerXP currently sells — what the "not included in your
     plan" screens name a price from. Cached for the session; the catalogue
     changes rarely enough that re-fetching on every locked page would be
     wasted network for no real freshness gain. */
  var addonCatalogCache = null;
  function listAddonCatalog() {
    if (addonCatalogCache) return Promise.resolve(addonCatalogCache);
    return request("/api/subscriptions/addons/catalog").then(function (body) {
      addonCatalogCache = body.data || [];
      return addonCatalogCache;
    });
  }

  /* ==========================================================================
     SOFTWARE UPDATES

     Visibility only, for now: what ManagerXP has published, and whether this
     console (or any of its stations) is behind it. Nothing here downloads or
     installs anything — see update-schedule.js for the policy that will decide
     *when* an apply step is allowed to run, once there is one.
     ========================================================================== */
  /** Ask the backend whether a newer build exists for this component. */
  function checkUpdate(component, currentVersion) {
    var qs = "?component=" + encodeURIComponent(component) +
      "&current_version=" + encodeURIComponent(currentVersion || "0.0.0");
    return request("/api/updates/mine" + qs).then(function (d) { return d.data; });
  }

  /** Tell the backend which client build a station just reported. */
  function reportStationVersion(pcId, version) {
    return request("/api/pcs/" + pcId + "/client-version", {
      method: "POST",
      body: JSON.stringify({ version: version })
    });
  }

  /* ==========================================================================
     DERIVED VIEWS
     ========================================================================== */
  /** Status of a registered PC, derived from live WS connection + failures. */
  /*
   * Whether the console talks to this station over the network.
   *
   * A gaming PC runs the CafeXP client and has an address. A pool table, a
   * dartboard or a console without the client has none — and never will. The
   * distinction matters because "not connected" means something has gone
   * wrong for the first and nothing at all for the second.
   */
  function isNetworked(pc) { return !!(pc && pc.ip_address); }

  function pcStatus(pc) {
    var name = pc.name;
    // Deactivated is an administrative decision, so it outranks whatever the
    // network is doing. It used to be checked last, which meant a station
    // taken out of service still read "Available" while it happened to be
    // connected — even though no session could be started on it.
    if (pc.is_active === false || pc.status === "INACTIVE") return "inactive";
    if (pc.status === "MAINTENANCE") return "maintenance";

    var session = state.sessions[name];
    if (session) return session.status === "paused" ? "maintenance" : "gaming";
    if (state.running[name]) return "gaming";
    if (state.connected.indexOf(name) !== -1) return "online";

    /* A station with no address is available, not offline.
       Reporting a pool table as offline was not a cosmetic slip: it greyed the
       card out, it counted against the offline tally, and canStartSession
       refused to open on it — so a café could register its pool tables and
       then find it could not sell a single game on them. */
    if (!isNetworked(pc)) return "online";

    var cs = state.connectionStatus[name];
    if (cs && cs.status === "failed") return "offline";
    return "offline";
  }

  /*
   * What kind of thing a station is, for grouping and counting.
   *
   * The café's own category when it has one. Otherwise it comes down to
   * whether we can talk to it: something with a network address is a PC
   * running the client, and something without is sold by the hour.
   */
  function stationType(pc) {
    var category = pc && pc.category ? String(pc.category).trim() : "";
    if (category) return category;
    return isNetworked(pc) ? "PC" : "Other";
  }

  /*
   * Station types present on the floor, in display order.
   *
   * PCs first — they are usually the bulk of a floor and the only ones with
   * a connection to worry about — then everything else alphabetically. The
   * order is derived rather than hardcoded because categories are free text:
   * a café that sells darts and karaoke gets those grouped sensibly without
   * anybody adding them to a list in the code.
   */
  function stationTypes() {
    var seen = {};
    state.pcs.forEach(function (pc) {
      var t = stationType(pc);
      if (!seen[t]) seen[t] = { type: t, networked: isNetworked(pc), total: 0 };
      seen[t].total++;
      // A group counts as networked if any station in it has an address.
      if (isNetworked(pc)) seen[t].networked = true;
    });
    return Object.keys(seen).sort(function (a, b) {
      var an = seen[a].networked ? 0 : 1;
      var bn = seen[b].networked ? 0 : 1;
      if (an !== bn) return an - bn;
      return a.localeCompare(b);
    }).map(function (k) { return seen[k]; });
  }

  function counts() {
    var c = {
      total: state.pcs.length, online: 0, offline: 0, running: 0, inactive: 0,
      discovered: state.discovered.length, failing: 0,
      /* Kept apart from online/offline on purpose. A pool table is neither
         connected nor disconnected — counting it as "online" made the
         dashboard claim three clients were connected when only one machine
         had ever been reachable. */
      managed: 0, hourly: 0,
      byType: {}
    };
    state.pcs.forEach(function (pc) {
      var s = pcStatus(pc);
      var networked = isNetworked(pc);
      if (networked) c.managed++; else c.hourly++;

      var t = stationType(pc);
      var bucket = c.byType[t] || (c.byType[t] = { total: 0, running: 0, free: 0, offline: 0, networked: networked });
      bucket.total++;
      if (networked) bucket.networked = true;

      if (s === "gaming") { c.running++; bucket.running++; if (networked) c.online++; }
      else if (s === "online") { if (networked) c.online++; bucket.free++; }
      else if (s === "inactive") { c.inactive++; }
      else { c.offline++; bucket.offline++; }

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

  // Expenses — what the café spends, compared against reports of what it takes in.
  function listExpenses(opts) {
    opts = opts || {};
    var query = [];
    Object.keys(opts).forEach(function (key) {
      if (opts[key] !== undefined && opts[key] !== null && opts[key] !== "") {
        query.push(key + "=" + encodeURIComponent(opts[key]));
      }
    });
    return request("/api/expenses" + (query.length ? "?" + query.join("&") : ""));
  }
  function expenseCategories() {
    return request("/api/expenses/categories").then(function (r) { return r.data; });
  }
  function expenseSummary(opts) {
    opts = opts || {};
    var query = [];
    Object.keys(opts).forEach(function (key) {
      if (opts[key]) query.push(key + "=" + encodeURIComponent(opts[key]));
    });
    return request("/api/expenses/summary" + (query.length ? "?" + query.join("&") : ""))
      .then(function (r) { return r.data; });
  }
  function createExpense(body) {
    return request("/api/expenses", { method: "POST", body: JSON.stringify(body) });
  }
  function updateExpense(id, body) {
    return request("/api/expenses/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function voidExpense(id, reason) {
    return request("/api/expenses/" + id + "/void", {
      method: "POST", body: JSON.stringify({ reason: reason || null })
    });
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

  /* Promote a customer to a regular, or return them to normal. Separate from
     the create/update calls because it grants a discount and the right to owe
     the café money, and is audited as its own decision. */
  function setCustomerTier(id, body) {
    return request("/api/customers/" + id + "/tier", {
      method: "PATCH", body: JSON.stringify(body)
    });
  }
  /* What they owe and how much of their limit is left — read before the till
     offers to put a ticket on their tab. */
  function getCustomerCredit(id) {
    return request("/api/customers/" + id + "/credit").then(function (r) { return r.data; });
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

  /** A staff member has opened this station — the call for help has been seen. */
  function clearHelpRequest(pcName) {
    if (!pcName || !state.helpRequests[pcName]) return;
    delete state.helpRequests[pcName];
    emit("help-requests", state.helpRequests);
  }

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

  /*
   * Time-is-nearly-up warnings.
   *
   * Staff are not watching the wall — they are at the counter, or in the back.
   * A card quietly turning amber is no use to somebody looking the other way,
   * so a session crossing its warning threshold raises a toast that names the
   * station and offers to extend it there and then.
   *
   * Warned sessions are remembered so the alert fires once, not once a second.
   * The record is keyed by session id rather than station, so the next
   * customer on the same machine gets their own warning.
   */
  var warned = {};
  var sessionSettings = {};

  function forgetWarning(sessionId) { delete warned[sessionId]; }

  function checkExpiryWarning(s, pcName) {
    if (s.remaining_seconds === null || s.remaining_seconds === undefined) return;
    var at = Number(sessionSettings.warn_minutes) || 5;
    var threshold = at * 60;
    if (s.remaining_seconds > threshold || s.remaining_seconds <= 0) return;
    if (warned[s.session_id]) return;
    warned[s.session_id] = true;
    emit("session-expiring", { session: s, pc_name: pcName, remaining: s.remaining_seconds });
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
        /* A FLAT (unlimited) and a BLOCK (fixed-length) session both cost a
           fixed amount — ticking either up by the hour would show a number
           climbing towards something nobody will be asked to pay. Only a
           legacy HOUR session meters against elapsed time. The membership
           discount, if any, is already baked into flat_amount by the server. */
        var mult = 1 - (Number(s.membership_discount_percent) || 0) / 100;
        s.running_amount = (s.pricing_unit === "FLAT" || s.pricing_unit === "BLOCK")
          ? Number(s.flat_amount || 0) * mult
          : Number((s.rate_per_hour * (s.elapsed_seconds / 3600) * mult).toFixed(2));
        checkExpiryWarning(s, name);
      });
      emit("session-tick", state.sessions);
    }, 1000);
  }

  /* A toast from the store layer. Views own the toast component, so this just
     reaches for it when it exists and stays silent (a console line only) if the
     UI has not loaded — the store must never throw for want of a toast. */
  function UIToast(kind, title, message) {
    var t = global.CXUI && global.CXUI.toast;
    if (t && typeof t[kind] === "function") t[kind](title, message);
    else console.log("[store] " + kind + ": " + title + " — " + (message || ""));
  }

  /** Mirror a session onto its station so the customer portal can show it. */
  function pushSessionToStation(pcName, session) {
    if (!api.pushSessionState) return Promise.resolve();
    return api.pushSessionState(pcName, session).catch(function (e) {
      console.warn("[store] session push failed", e);
    });
  }

  /*
   * End-of-session cleanup.
   *
   * Read fresh from settings each time rather than cached, so a café that
   * switches "sign out of Steam" on sees it apply to the very next session
   * that ends, without restarting a console or touching a station.
   *
   * Best-effort by design: a station that is offline simply is not cleaned —
   * it re-reports on connect and staff can see its state. Never allowed to
   * reject, because ending a session must not fail on housekeeping.
   */
  function cleanupStation(pcName, pcId) {
    if (!api.cleanupStation || !pcName) return Promise.resolve();
    return getSettings("client")
      .then(function (rows) {
        var row = (rows || []).filter(function (r) { return r.setting_key === "session.cleanup"; })[0];
        var cfg = {};
        if (row && row.setting_value) {
          try { cfg = JSON.parse(row.setting_value); } catch (e) { cfg = {}; }
        }
        /* Nothing switched on at all still clears the station's own display —
           the customer's name must not linger on an idle machine. */
        if (!cfg || typeof cfg !== "object") cfg = {};
        /* The process names of what was available here, so the agent can stop a
           game whose window title differs from its executable. */
        return (pcId ? getPcGames(pcId).catch(function () { return { data: { games: [] } }; })
                     : Promise.resolve({ data: { games: [] } }))
          .then(function (body) {
            var games = (body.data.games || []).map(function (g) {
              return { name: g.name, process_name: g.process_name };
            });
            return api.cleanupStation(pcName, cfg, games);
          });
      })
      .catch(function (e) { console.warn("[store] cleanup failed", e); });
  }

  /* Send a station the games its customer may pick — this PC's installed and
     enabled titles only. Called when a session starts (the menu appears) and
     cleared when it ends (the menu goes with the session). Best-effort: a
     station with no games or no connection simply shows nothing. */
  function pushGamesToStation(pcName, pcId) {
    if (!api.pushGames) return Promise.resolve();
    if (!pcId) return api.pushGames(pcName, []).catch(function () {});
    return getPcGames(pcId)
      .then(function (body) {
        /* One entry per (game, platform installed here) — the same game on
           both Steam and EA is two launchable things on this station, and
           the station has to know which one it is starting. */
        var list = [];
        (body.data.games || []).forEach(function (g) {
          if (!g.enabled) return;
          (g.platforms || []).forEach(function (p) {
            if (!p.installed) return;
            list.push({
              cafe_game_id: g.cafe_game_id,
              game_id: g.game_id,
              game_platform_id: p.id,
              name: g.name,
              category: g.category,
              icon_url: g.icon_url,
              account_mode: g.account_mode,
              platform: p.platform,
              platform_game_id: p.platform_game_id,
              launch_method: p.launch_method,
              launch_target: p.launch_target,
              process_name: p.process_name,
              launch_arguments: p.launch_arguments
            });
          });
        });
        return api.pushGames(pcName, list);
      })
      .catch(function (e) { console.warn("[store] games push failed", e); });
  }

  /* Ended and cancelled both free the station. Testing only for "ended" would
     leave a cancelled session sitting on the floor holding a machine that is
     actually free. */
  function stillRunning(session) {
    return !!session && session.status !== "ended" && session.status !== "cancelled";
  }

  function afterSessionChange(session, pcNameOverride) {
    var pcName = pcNameOverride || (session && session.pc_name);
    if (stillRunning(session)) state.sessions[pcName] = session;
    else if (pcName) delete state.sessions[pcName];

    if (session && !stillRunning(session)) forgetWarning(session.session_id);

    startSessionTicker();
    emit("sessions", state.sessions);
    emit("pcs", state.pcs);
    /* The customer's game menu follows the session: sent when one is running,
       cleared when it is not. Fired alongside the session-state push. */
    var running = stillRunning(session);
    pushGamesToStation(pcName, running && session ? session.pc_id : null);

    /* A session that has just ended leaves a machine holding the last
       customer's game accounts. Clean it before the next person sits down. */
    if (session && !running && pcName) cleanupStation(pcName, session.pc_id);
    return pushSessionToStation(pcName, stillRunning(session) ? session : null)
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
  /*
   * Extend a fixed-price session by whole blocks. Used by the player-driven
   * Extend at the station: the block is added to the bill (settled at the end,
   * never a wallet debit here), the station's timer card is grown to match, and
   * the floor is updated. `blocks` defaults to one.
   */
  function extendSessionBlocks(session, blocks) {
    var n = blocks || 1;
    var unitMin = Number(session.block_unit_minutes) || 0;
    return sessionAction(session.session_id, "extend", { blocks: n }).then(function (r) {
      var pcName = session.pc_name;
      if (pcName && unitMin > 0 && api.pushExtendTimer) {
        api.pushExtendTimer(pcName, unitMin * n).catch(function (e) {
          console.warn("[store] extend-timer push failed", e);
        });
      }
      return afterSessionChange(r.data, pcName);
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

  /* Started by mistake: releases the station and charges nothing. The record
     survives — cancelling is not the same as it never having happened. */
  function cancelSession(session, opts) {
    return sessionAction(session.session_id, "cancel", opts || {}).then(function (r) {
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

  /* Cached on the way past so the ticker can read warn_minutes without a
     request every second. The café's own setting, not a constant here. */
  function sessionDefaults() {
    return request("/api/sessions/defaults").then(function (r) {
      sessionSettings = r.data || {};
      return r.data;
    });
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
  /* Standalone from any product id — a new product doesn't have one yet.
     Upload the file first, get a URL back, include it in the create/update
     payload like any other field. */
  function uploadProductImage(file) {
    var body = new FormData();
    body.append("image", file);
    return request("/api/products/upload-image", { method: "POST", body: body })
      .then(function (r) { return r.data.image_url; });
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

  /* The kinds of play the catalogue holds — "PC", "PS5", "Pool", "Darts".
     Derived from the games themselves, so it is never out of step with them. */
  function listSoftwareCategories() {
    return request("/api/software-master/categories");
  }

  /* Activities the café sells time on that ManagerXP never published — a pool
     table, a dartboard, a racing rig. The café owns these outright. */
  function createHouseActivity(body) {
    return request("/api/software-master/house", {
      method: "POST", body: JSON.stringify(body)
    });
  }
  function updateHouseActivity(id, body) {
    return request("/api/software-master/house/" + id, {
      method: "PUT", body: JSON.stringify(body)
    });
  }
  function deleteHouseActivity(id) {
    return request("/api/software-master/house/" + id, { method: "DELETE" });
  }

  /* Works on published titles too: which tab a game sits under on this café's
     till is the café's business, not the catalogue's. */
  function setSoftwareCategory(id, category) {
    return request("/api/software-master/" + id + "/category", {
      method: "PATCH", body: JSON.stringify({ category: category })
    });
  }

  // Gaming Price Master
  /* ---- Launchers a station has installed ---- */
  var LAUNCHER_ORDER = ["Steam", "Riot", "EA", "Epic", "Ubisoft", "Battle.net", "Rockstar"];

  /** [{ name, installed, path }] for a station, in a stable display order.
      Returns null when the station has never reported — which is different
      from "reported, and has none". */
  function launchersFor(pcName) {
    var map = state.launchers[pcName];
    if (!map) return null;
    return LAUNCHER_ORDER.map(function (name) {
      var entry = map[name] || {};
      return { name: name, installed: !!entry.installed, path: entry.path || null };
    });
  }

  /** Ask a station to detect its launchers again. */
  function refreshLaunchers(pcName) {
    if (!api.refreshStationLaunchers) return Promise.resolve({ success: false });
    return api.refreshStationLaunchers(pcName);
  }

  /* ---- Game Library (café selections from ManagerXP's master catalog) ----
     Named `libraryGames`, not `listGames` — that name is already taken above
     by the software-master catalogue (station types). Two different things
     called "games" in one café: the station types you sell time on, and the
     titles a PC can launch. This is the latter.

     There is deliberately no createGame/updateGame/uploadGameIcon here — a
     café never authors a title's App ID, executable or artwork. It only
     browses ManagerXP's catalog and picks from it. */
  function gameCatalog(params) { return request("/api/games/catalog" + qs(params)); }
  function libraryGames(params) { return request("/api/games" + qs(params)); }
  function addGame(gameId) {
    return request("/api/games", { method: "POST", body: JSON.stringify({ game_id: gameId }) });
  }
  /* enabled / account_mode / price_per_hour — the whole of what a café may
     decide about a title it has taken from the catalog. */
  function updateCafeGame(cafeGameId, patch) {
    return request("/api/games/" + cafeGameId, { method: "PATCH", body: JSON.stringify(patch) });
  }
  function setGameEnabled(cafeGameId, enabled) {
    return updateCafeGame(cafeGameId, { enabled: enabled });
  }
  function removeGame(cafeGameId) {
    return request("/api/games/" + cafeGameId, { method: "DELETE" });
  }

  /* The venue account pool for one platform of one game — the café's own
     logins/licences, so a customer can play without an account of their own. */
  function venueAccounts(platformId) {
    return request("/api/games/platforms/" + platformId + "/accounts");
  }
  function addVenueAccount(platformId, body) {
    return request("/api/games/platforms/" + platformId + "/accounts",
      { method: "POST", body: JSON.stringify(body) });
  }
  function updateVenueAccount(platformId, accountId, patch) {
    return request("/api/games/platforms/" + platformId + "/accounts/" + accountId,
      { method: "PATCH", body: JSON.stringify(patch) });
  }
  function removeVenueAccount(platformId, accountId) {
    return request("/api/games/platforms/" + platformId + "/accounts/" + accountId, { method: "DELETE" });
  }

  function getPcGames(pcId) { return request("/api/games/pc/" + pcId); }
  /* Per PLATFORM now, not per game: a station installs Steam's F1 25 or EA's,
     and which one it has is exactly what the launcher needs to know. */
  function setPcGames(pcId, gamePlatformIds) {
    return request("/api/games/pc/" + pcId, { method: "PUT", body: JSON.stringify({ game_platform_ids: gamePlatformIds }) });
  }

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

  // Time-based pricing — peak, off-peak, weekend and happy hours.
  function listPricingRules() { return request("/api/pricing-rules"); }
  function createPricingRule(body) {
    return request("/api/pricing-rules", { method: "POST", body: JSON.stringify(body) });
  }
  function updatePricingRule(id, body) {
    return request("/api/pricing-rules/" + id, { method: "PUT", body: JSON.stringify(body) });
  }
  function deletePricingRule(id) {
    return request("/api/pricing-rules/" + id, { method: "DELETE" });
  }
  /* What every catalogue price costs at a given moment. `at` is optional and
     lets the rate card show any hour of the week, not only right now. */
  function previewRates(at) {
    return request("/api/pricing-rules/preview" + qs(at ? { at: at } : null))
      .then(function (r) { return r.data; });
  }

  /* ==========================================================================
     RESERVATIONS — booking a station ahead of time
     ========================================================================== */
  function listReservations(params) { return request("/api/reservations" + qs(params)); }
  /* This café's own opening/closing time, so the booking calendar can scope
     its grid to when the place is actually open. */
  function getReservationHours() {
    return request("/api/reservations/hours").then(function (r) { return r.data; });
  }
  function checkReservationAvailability(params) {
    return request("/api/reservations/availability" + qs(params)).then(function (r) { return r.data; });
  }
  function createReservation(body) {
    return request("/api/reservations", { method: "POST", body: JSON.stringify(body) });
  }
  function cancelReservation(id, reason) {
    return request("/api/reservations/" + id + "/cancel", {
      method: "POST", body: JSON.stringify(reason ? { reason: reason } : {})
    });
  }
  function checkInReservation(id) {
    return request("/api/reservations/" + id + "/check-in", { method: "POST", body: "{}" });
  }
  function markReservationNoShow(id) {
    return request("/api/reservations/" + id + "/no-show", { method: "POST", body: "{}" });
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

    /*
     * A customer asked to add coins with cash at their station.
     *
     * The Billing Desk's own "Coin requests" tab already lists these, but
     * only while a staff member happens to have that tab open — its polling
     * stops the moment they switch away (see billing-desk.js's own header on
     * why). Whoever is at the till needs to know the moment one comes in, not
     * the next time they think to check, so this runs for the app's whole
     * lifetime. Emits "topup:new" once per request the moment it first
     * appears — never re-announcing one already seen — and "topup-requests"
     * with the full list on every check, for the topbar bell's running count.
     * main.js turns both into the actual toast and badge.
     */
    var knownTopupIds = null;   // null until the first successful check
    function checkNewTopups() {
      if (!can("payments.topup.view")) return;
      pendingTopups()
        .then(function (list) {
          var ids = (list || []).map(function (r) { return r.topup_id; });
          if (knownTopupIds) {
            (list || []).forEach(function (r) {
              if (knownTopupIds.indexOf(r.topup_id) === -1) emit("topup:new", r);
            });
          }
          knownTopupIds = ids;
          emit("topup-requests", list || []);
        })
        .catch(function () { /* next tick tries again; a miss here is not fatal */ });
    }
    checkNewTopups();
    setInterval(checkNewTopups, 15000);

    /*
     * A customer placed a food/drink order at their station.
     *
     * Same gap, same fix as coin requests just above: the F&B page's own
     * "Order queue" tab already polls, but only while someone has that page
     * open, and its count there is every order still in the pipeline, not
     * specifically the ones nobody has looked at yet. This polls for PLACED
     * — the moment before anyone has even acknowledged it — for the app's
     * whole lifetime, and emits the same two-event shape ("order:new" once
     * per order, "orders-pending" with the full list) so main.js can handle
     * both this and coin requests through one bell.
     */
    var knownOrderIds = null;
    function checkNewOrders() {
      listOrders({ status: "PLACED" })
        .then(function (r) {
          var list = r.data || [];
          var ids = list.map(function (o) { return o.order_id; });
          if (knownOrderIds) {
            list.forEach(function (o) {
              if (knownOrderIds.indexOf(o.order_id) === -1) emit("order:new", o);
            });
          }
          knownOrderIds = ids;
          emit("orders-pending", list);
        })
        .catch(function () { /* next tick tries again */ });
    }
    checkNewOrders();
    setInterval(checkNewOrders, 15000);

    /*
     * New bookings — from the café's own public booking link as much as from
     * a staff member typing one in here, since either way nobody has seen it
     * yet. Looks ahead a week rather than just today, so a booking made for
     * next weekend still surfaces the moment it lands instead of waiting
     * until its own day arrives.
     */
    var knownReservationIds = null;
    function checkNewReservations() {
      var from = new Date();
      var to = new Date(from.getTime() + 7 * 24 * 60 * 60000);
      listReservations({ status: "CONFIRMED", from: from.toISOString(), to: to.toISOString() })
        .then(function (r) {
          var list = r.data || [];
          var ids = list.map(function (x) { return x.reservation_id; });
          if (knownReservationIds) {
            list.forEach(function (x) {
              if (knownReservationIds.indexOf(x.reservation_id) === -1) emit("reservation:new", x);
            });
          }
          knownReservationIds = ids;
          emit("reservations-pending", list);
        })
        .catch(function () { /* next tick tries again */ });
    }
    checkNewReservations();
    setInterval(checkNewReservations, 15000);

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

    /* Which launchers each station has. Seeded from whatever the main process
       already collected (stations connect before this renderer mounts), then
       kept live as stations report in. */
    if (api.getStationLaunchers) {
      api.getStationLaunchers().then(function (r) {
        (r && r.data ? r.data : []).forEach(function (row) {
          state.launchers[row.pcName] = row.launchers;
        });
        emit("launchers", state.launchers);
      }).catch(function () {});
    }
    if (api.onStationLaunchers) {
      api.onStationLaunchers(function (d) {
        if (!d || !d.pcName) return;
        state.launchers[d.pcName] = d.launchers || {};
        emit("launchers", state.launchers);
      });
    }

    /* A station reported its own CafeXP Client build. Relayed to the backend
       from here rather than from main.js, which holds neither this café's
       staff token nor the pc_id a station name maps to. */
    if (api.onStationClientVersion) {
      api.onStationClientVersion(function (d) {
        var pc = d && d.pcName && getPC(d.pcName);
        if (!pc || !d.version) return;
        reportStationVersion(pc.pc_id, d.version)
          .then(function () {
            pc.client_version = d.version;
            pc.client_version_seen_at = new Date().toISOString();
            emit("pcs", state.pcs);
          })
          .catch(function () { /* advisory only — a missed report costs nothing but a stale row */ });
      });
    }

    startSessionReconcile();

    /* A player tapped Extend at their station. Find the session on that station
       and add a block to it — the same fixed-price extend staff have, but
       driven from the customer's end. */
    if (api.onStationExtendRequest) {
      api.onStationExtendRequest(function (data) {
        var pcName = data && data.pcName;
        var session = pcName && state.sessions[pcName];
        if (!session) {
          emit("station-extend-failed", { pcName: pcName, reason: "no active session" });
          return;
        }
        if (!session.can_extend) {
          UIToast("warn", "Cannot extend", (session.customer_name || "That station") +
            " is not on a fixed-price block.");
          return;
        }
        extendSessionBlocks(session, (data && data.blocks) || 1)
          .then(function () {
            UIToast("ok", "Extended at the station",
              (session.customer_name || "Player") + " added a block to their session.");
          })
          .catch(function (e) {
            UIToast("error", "Extend failed", e.message || "Could not extend the session.");
          });
      });
    }

    /* A station's block ran out and the game was left running (never cut off).
       Surface it so staff can settle or extend; the low-balance state rides on
       the session object the floor already renders. */
    if (api.onStationOvertime) {
      api.onStationOvertime(function (data) {
        var pcName = data && data.pcName;
        var session = pcName && state.sessions[pcName];
        var who = (session && session.customer_name) || pcName || "A station";
        var lowBal = session && session.low_balance;
        UIToast(lowBal ? "warn" : "info",
          lowBal ? "Time up · low balance" : "Session over its time",
          who + (lowBal
            ? " has run out of time and cannot cover the bill — ask them to top up."
            : " is past its block. Extend or end when they finish."));
        emit("station-overtime", { pcName: pcName, session: session || null, low_balance: !!lowBal });
      });
    }

    /*
     * A customer tapped "Call staff" on the Help menu at their station. There
     * may or may not be a session running — a station stuck before one even
     * starts still needs a person, so this never depends on state.sessions.
     *
     * Emits only, same division of labour as topup/order/reservation above:
     * this layer tracks what's outstanding, main.js decides how loudly to
     * say so (bell badge, toast, beep) and notifications.js lists it.
     */
    if (api.onStationCallStaff) {
      api.onStationCallStaff(function (data) {
        var pcName = data && data.pcName;
        if (!pcName) return;
        var session = state.sessions[pcName];
        var who = (session && session.customer_name) || pcName;
        state.helpRequests[pcName] = { at: Date.now(), who: who };
        emit("help-requests", state.helpRequests);
        emit("help-request:new", { pcName: pcName, who: who });
      });
    }

    /*
     * The game a self-started session was for never actually launched. The
     * customer never played a second of it, so the session is cancelled —
     * same as staff cancelling by hand, charges nothing — rather than left
     * running up a bill against an empty station.
     */
    if (api.onStationLaunchFailed) {
      api.onStationLaunchFailed(function (data) {
        var pcName = data && data.pcName;
        var session = pcName && state.sessions[pcName];
        if (!session) return;    // already ended some other way; nothing to undo
        var who = session.customer_name || pcName || "The station";
        cancelSession(session, { reason: "launch_failed" })
          .then(function () {
            UIToast("warn", "Session cancelled — game did not start",
              who + "'s game (" + (data.appName || "the game") + ") could not be launched. Nothing was charged.");
          })
          .catch(function (e) {
            UIToast("error", "Could not cancel the session", e.message || "");
          });
      });
    }

    /*
     * A logged-in customer opened the game picker while idle. Unlike
     * GAMES_LIST (only sent once a session exists), this answers "what could
     * I play and what would it cost" so they can choose before anything has
     * started — the station's own installed+enabled titles, and this café's
     * prices for the station's type.
     */
    if (api.onStationStartOptionsRequest) {
      api.onStationStartOptionsRequest(function (data) {
        var pcName = data && data.pcName;
        var pc = pcName && getPC(pcName);
        if (!pc) return;
        Promise.all([
          getPcGames(pc.pc_id).catch(function () { return { data: { games: [] } }; }),
          /* The current, peak/happy-hour-adjusted rate — not the flat catalogue
             price. A customer choosing at 7pm during a peak window must see
             the same number they are about to be charged, not the base rate
             a pricing rule is quietly about to mark up. */
          previewRates().catch(function () { return []; })
        ]).then(function (results) {
          /* Flattened to one entry per (game, platform installed here) — the
             same shape pushGamesToStation sends, so the customer's picker and
             the launcher read the same fields either way. */
          var games = [];
          (results[0].data.games || []).forEach(function (g) {
            if (!g.enabled) return;
            (g.platforms || []).forEach(function (p) {
              if (!p.installed) return;
              games.push({
                cafe_game_id: g.cafe_game_id, game_id: g.game_id, game_platform_id: p.id,
                name: g.name, category: g.category, icon_url: g.icon_url,
                account_mode: g.account_mode, platform: p.platform,
                platform_game_id: p.platform_game_id, launch_method: p.launch_method,
                launch_target: p.launch_target, process_name: p.process_name,
                launch_arguments: p.launch_arguments
              });
            });
          });
          var prices = (results[1] || []).filter(function (p) {
            return !pc.category || !p.category || p.category === pc.category;
          }).map(function (p) {
            return {
              price_id: p.gaming_price_id, session_name: p.session_name,
              duration_minutes: p.duration_minutes, is_unlimited: p.is_unlimited,
              price: p.current_price
            };
          });
          if (api.pushStartOptions) api.pushStartOptions(pcName, games, prices);
        });
      });
    }

    /* The customer picked a game and a price and tapped Start. Runs with the
       console's own staff-equivalent authority — the same reason the extend
       flow above works this way, since the station itself holds no token at
       all. `require_prepaid` is what makes this safe to run unattended: the
       backend refuses unless the wallet already covers the price. */
    if (api.onStationStartRequest) {
      api.onStationStartRequest(function (data) {
        var pcName = data && data.pcName;
        var pc = pcName && getPC(pcName);
        var fail = function (message) { if (api.pushStartFailed) api.pushStartFailed(pcName, message); };
        if (!pc) return fail("Station not recognised");
        if (state.sessions[pcName]) return fail("A session is already running here");
        if (!data.gaming_price_id) return fail("Choose a duration to start");

        startSession({
          pc_id: pc.pc_id,
          customer_id: data.customer_id,
          gaming_price_id: data.gaming_price_id,
          /* The chosen title, and specifically which platform of it — the
             backend reserves a venue account against exactly this platform
             when the game's account mode calls for one. */
          game_id: data.game_id || null,
          game_platform_id: data.game_platform_id || null,
          game_account_id: data.game_account_id || null,
          use_venue_account: !!data.use_venue_account,
          require_prepaid: true
        }).catch(function (e) { fail(e.message || "Could not start the session"); });
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

    // what ManagerXP says this café's subscription includes
    getEntitlements: getEntitlements,
    listAddonCatalog: listAddonCatalog,

    // software updates — visibility only
    checkUpdate: checkUpdate,
    reportStationVersion: reportStationVersion,

    // derived
    pcStatus: pcStatus,
    counts: counts,
    stationType: stationType,
    stationTypes: stationTypes,
    getPC: getPC,
    isConnected: isConnected,
    isNetworked: isNetworked,

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
    uploadProductImage: uploadProductImage,
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
    listSoftwareCategories: listSoftwareCategories,
    createHouseActivity: createHouseActivity,
    updateHouseActivity: updateHouseActivity,
    deleteHouseActivity: deleteHouseActivity,
    setSoftwareCategory: setSoftwareCategory,
    launchersFor: launchersFor,
    refreshLaunchers: refreshLaunchers,
    gameCatalog: gameCatalog,
    libraryGames: libraryGames,
    addGame: addGame,
    setGameEnabled: setGameEnabled,
    updateCafeGame: updateCafeGame,
    removeGame: removeGame,
    venueAccounts: venueAccounts,
    addVenueAccount: addVenueAccount,
    updateVenueAccount: updateVenueAccount,
    removeVenueAccount: removeVenueAccount,
    getPcGames: getPcGames,
    setPcGames: setPcGames,
    listGamingPrices: listGamingPrices,
    createGamingPrice: createGamingPrice,
    updateGamingPrice: updateGamingPrice,
    setGamingPriceStatus: setGamingPriceStatus,
    deleteGamingPrice: deleteGamingPrice,
    lookupGamingPrice: lookupGamingPrice,

    listPricingRules: listPricingRules,
    createPricingRule: createPricingRule,
    updatePricingRule: updatePricingRule,
    deletePricingRule: deletePricingRule,
    previewRates: previewRates,
    listReservations: listReservations,
    getReservationHours: getReservationHours,
    checkReservationAvailability: checkReservationAvailability,
    createReservation: createReservation,
    cancelReservation: cancelReservation,
    checkInReservation: checkInReservation,
    markReservationNoShow: markReservationNoShow,

    // sessions
    loadSessions: loadSessions,
    listSessions: listSessions,
    sessionFor: sessionFor,
    clearHelpRequest: clearHelpRequest,
    sessionDefaults: sessionDefaults,
    startSession: startSession,
    pauseSession: pauseSession,
    resumeSession: resumeSession,
    extendSession: extendSession,
    extendSessionBlocks: extendSessionBlocks,
    transferSession: transferSession,
    endSession: endSession,
    cancelSession: cancelSession,
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
    listExpenses: listExpenses,
    expenseCategories: expenseCategories,
    expenseSummary: expenseSummary,
    createExpense: createExpense,
    updateExpense: updateExpense,
    voidExpense: voidExpense,
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
    setCustomerTier: setCustomerTier,
    getCustomerCredit: getCustomerCredit,
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
