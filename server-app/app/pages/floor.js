/* ==========================================================================
   CafeXP — Floor
   The station wall. Every card reflects live connection state, and clicking
   one opens the station control panel.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var filter = "all";
  var query = "";
  var offs = [];
  var rootEl = null;

  var FILTERS = [
    { id: "all",      label: "All stations" },
    { id: "online",   label: "Available" },
    { id: "gaming",   label: "In use" },
    { id: "offline",  label: "Offline" },
    { id: "inactive", label: "Deactivated" }
  ];

  var STATUS_TEXT = { online: "Available", gaming: "In use", offline: "Offline", inactive: "Deactivated" };

  /* ==========================================================================
     STATION CARD
     ========================================================================== */
  function stationCard(pc) {
    var status = Store.pcStatus(pc);
    var run = Store.state.running[pc.name];
    var cs = Store.state.connectionStatus[pc.name];

    var card = UI.el("div", {
      class: "station",
      dataset: { status: status, pc: pc.name },
      tabindex: "0",
      role: "button",
      "aria-label": pc.name + " — " + (STATUS_TEXT[status] || status)
    });

    var middle;
    if (run) {
      middle =
        '<div class="station-headline">' + UI.esc(run.appName) + "</div>" +
        '<div class="station-timer" data-timer="' + UI.esc(pc.name) + '">' + UI.hms(run.remaining) + "</div>" +
        '<div class="station-subline">' + (run.paused ? "Paused" : "of " + UI.hms(run.totalSeconds)) + "</div>";
    } else if (status === "online") {
      middle = '<div class="station-headline" style="color:var(--ok)">Ready</div>' +
               '<div class="station-subline">Client connected · waiting</div>';
    } else if (status === "inactive") {
      middle = '<div class="station-idle">Deactivated in the station registry</div>';
    } else {
      middle = '<div class="station-idle">' +
        (cs && cs.failures ? "No response after " + cs.failures + " attempt" + (cs.failures > 1 ? "s" : "") : "Client not connected") +
        "</div>";
    }

    card.innerHTML =
      '<div class="station-top">' +
        "<div style='min-width:0'>" +
          '<div class="station-name">' + UI.esc(pc.name) + "</div>" +
          '<div class="station-meta">' + UI.esc(pc.ip_address || "no address") + "</div>" +
        "</div>" +
        '<span class="dot' + (status === "online" || status === "gaming" ? " dot-live" : "") + '"></span>' +
      "</div>" +
      '<div class="station-mid">' + middle + "</div>" +
      '<div class="station-foot">' +
        '<div class="station-tags">' +
          '<span class="badge">' + UI.esc(STATUS_TEXT[status] || status) + "</span>" +
        "</div>" +
        '<div class="station-quick"></div>' +
      "</div>";

    /* quick actions on hover */
    var quick = card.querySelector(".station-quick");
    if (run) {
      quick.appendChild(quickBtn("stop", "End session", function (e) {
        e.stopPropagation();
        UI.confirm({
          title: "End session on " + pc.name + "?",
          message: "This closes " + run.appName + " on the station.",
          confirmLabel: "End session", variant: "danger"
        }).then(function (ok) {
          if (ok) Store.closeApp(pc.name).then(function (s) {
            if (s) UI.toast.ok("Session ended", pc.name);
            else UI.toast.error("Could not close the application", "The client may be disconnected.");
          });
        });
      }));
    } else if (status === "online") {
      quick.appendChild(quickBtn("play", "Launch software", function (e) {
        e.stopPropagation();
        global.CXStationPanel.open(pc.name);
      }));
    } else {
      quick.appendChild(quickBtn("link", "Connect", function (e) {
        e.stopPropagation();
        Store.clearFailures(pc.name)
          .then(function () { return Store.connectToPC(pc.ip_address, pc.port, pc.name); })
          .then(function (r) {
            if (r && r.success) UI.toast.ok("Connecting to " + pc.name);
            else UI.toast.error("Connection failed", (r && r.error) || "");
          })
          .catch(function (err) { UI.toast.error("Connection failed", err.message); });
      }));
    }
    quick.appendChild(quickBtn("panel", "Open control panel", function (e) {
      e.stopPropagation();
      global.CXStationPanel.open(pc.name);
    }));

    card.addEventListener("click", function () { global.CXStationPanel.open(pc.name); });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); global.CXStationPanel.open(pc.name); }
    });

    return card;
  }

  function quickBtn(icon, tip, onClick) {
    return UI.el("button", {
      class: "btn btn-outline btn-icon btn-sm",
      html: Icon(icon, 13),
      "data-tip": tip,
      "aria-label": tip,
      onClick: onClick
    });
  }

  /* ==========================================================================
     DISCOVERED (unregistered) CARD
     ========================================================================== */
  function discoveredCard(dpc) {
    var card = UI.el("div", { class: "station is-discovered", dataset: { status: "maintenance" }, tabindex: "0" });
    card.innerHTML =
      '<div class="station-top">' +
        "<div style='min-width:0'>" +
          '<div class="station-name">Unregistered</div>' +
          '<div class="station-meta">' + UI.esc(dpc.ip) + "</div>" +
        "</div>" +
        '<span class="dot"></span>' +
      "</div>" +
      '<div class="station-mid">' +
        '<div class="station-headline">' + UI.esc(dpc.hostname || "Unknown host") + "</div>" +
        '<div class="station-subline mono" style="font-size:11px">' + UI.esc(dpc.mac || "") + "</div>" +
      "</div>" +
      '<div class="station-foot">' +
        '<span class="badge">Needs registering</span>' +
      "</div>";

    var btn = UI.el("button", {
      class: "btn btn-accent-soft btn-sm",
      html: Icon("plus", 13) + '<span class="btn-label">Register</span>'
    });
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      global.CXPages.discovery.registerDialog(dpc);
    });
    card.querySelector(".station-foot").appendChild(btn);
    card.addEventListener("click", function () { global.CXPages.discovery.registerDialog(dpc); });
    return card;
  }

  /* ==========================================================================
     ADD STATION MANUALLY
     Ports the previous "Add PC" flow verbatim: verify reachability, resolve a
     MAC address (client → server fallback), then POST /api/pcs.
     ========================================================================== */
  function addStationDialog() {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field">' +
        '<label class="field-label field-req" for="addName">Station name</label>' +
        '<input class="input" id="addName" placeholder="PC-01" data-autofocus>' +
      "</div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field">' +
          '<label class="field-label field-req" for="addIp">IP address</label>' +
          '<input class="input mono" id="addIp" placeholder="192.168.1.20">' +
        "</div>" +
        '<div class="field">' +
          '<label class="field-label field-req" for="addPort">Port</label>' +
          '<input class="input mono" id="addPort" value="9090">' +
        "</div>" +
      "</div>" +
      '<div class="row gap-3">' +
        '<button class="btn btn-outline btn-sm" id="btnVerify">' + Icon("wifi", 14) +
          '<span class="btn-label">Verify client</span></button>' +
        '<span class="grow" id="verifyMsg" style="font-size:12px;color:var(--text-3)">Check the client responds before saving.</span>' +
      "</div>";

    var verified = false;

    var dialog = UI.modal({
      title: "Add station",
      description: "Register a station that is already running the CafeXP client.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Save station", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#addName").value.trim();
            var ip = ctx.body.querySelector("#addIp").value.trim();
            var port = ctx.body.querySelector("#addPort").value.trim();

            if (!name || !ip || !port) {
              Motion.shake(ctx.node);
              UI.toast.warn("Missing details", "Name, IP address and port are all required.");
              return false;
            }
            if (!verified) {
              Motion.shake(ctx.body.querySelector("#btnVerify"));
              UI.toast.warn("Verify the client first", "Confirm the station responds before saving it.");
              return false;
            }

            return resolveMac(ip, port, name)
              .then(function (mac) {
                return Store.createPC({
                  simId: name,
                  ip_address: ip,
                  port: port,
                  name: name,
                  cafe_id: (Store.state.user && Store.state.user.cafe_id) || 1,
                  branch_id: 1,
                  mac_address: mac,
                  is_active: true
                });
              })
              .then(function () {
                UI.toast.ok("Station saved", name);
                return Store.loadPCs();
              })
              .then(function () { return true; })
              .catch(function (e) {
                UI.toast.error("Could not save the station", e.message);
                return false;
              });
          }
        }
      ]
    });

    var verifyBtn = body.querySelector("#btnVerify");
    var msg = body.querySelector("#verifyMsg");
    verifyBtn.addEventListener("click", function () {
      var ip = body.querySelector("#addIp").value.trim();
      var port = parseInt(body.querySelector("#addPort").value, 10) || 9090;

      if (!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
        msg.textContent = "That is not a valid IPv4 address.";
        msg.style.color = "var(--danger)";
        Motion.shake(body.querySelector("#addIp"));
        return;
      }
      msg.textContent = "Checking…";
      msg.style.color = "var(--text-3)";

      UI.withBusy(verifyBtn, function () {
        return probeClient(ip, port).then(function (result) {
          verified = true;                       // same as before: a valid IP is accepted either way
          msg.textContent = result.reachable
            ? "Client responded — ready to save."
            : "No response, but the address is valid. You can still save it.";
          msg.style.color = result.reachable ? "var(--ok)" : "var(--warn)";
        });
      });
    });

    return dialog;
  }

  /** Reachability probe — same three methods, same order, as the old form. */
  function probeClient(ip, port) {
    if (ip === "127.0.0.1" || ip === "localhost") return Promise.resolve({ reachable: true });

    function tryFetch(url, method) {
      var controller = new AbortController();
      var timeout = setTimeout(function () { controller.abort(); }, 2000);
      return fetch(url, { method: method, signal: controller.signal })
        .then(function (res) { clearTimeout(timeout); return res.status >= 200 && res.status < 500; })
        .catch(function () { clearTimeout(timeout); return false; });
    }

    return tryFetch("http://" + ip + ":" + port + "/", "HEAD")
      .then(function (ok) { return ok || tryFetch("http://" + ip + ":" + port + "/health", "GET"); })
      .then(function (ok) { return ok || Store.checkConnection(ip, port).catch(function () { return false; }); })
      .then(function (ok) { return { reachable: !!ok }; });
  }

  /** MAC resolution — ask the client over WS, fall back to this machine's MAC. */
  function resolveMac(ip, port, name) {
    return new Promise(function (resolve) {
      var settled = false;
      var fallback = "mac-" + name;
      var ws;
      var timeout = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { if (ws) ws.close(); } catch (e) {}
        serverMac().then(resolve);
      }, 3000);

      try {
        ws = new WebSocket("ws://" + ip + ":" + port);
        ws.onopen = function () { ws.send(JSON.stringify({ type: "GET_MAC_ADDRESS" })); };
        ws.onmessage = function (event) {
          try {
            var msg = JSON.parse(event.data);
            if (msg.type === "MAC_ADDRESS" && msg.macAddress && !settled) {
              settled = true;
              clearTimeout(timeout);
              ws.close();
              resolve(msg.macAddress);
            }
          } catch (e) { /* ignore non-JSON frames */ }
        };
        ws.onerror = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          serverMac().then(resolve);
        };
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timeout); serverMac().then(resolve); }
      }

      function serverMac() {
        return Store.getMacAddress()
          .then(function (r) { return (r && r.success && r.macAddress) ? r.macAddress : fallback; })
          .catch(function () { return fallback; });
      }
    });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  function visiblePCs() {
    var q = query.trim().toLowerCase();
    return Store.state.pcs.filter(function (pc) {
      var status = Store.pcStatus(pc);
      if (filter !== "all" && status !== filter) return false;
      if (!q) return true;
      return (pc.name || "").toLowerCase().indexOf(q) !== -1 ||
             (pc.ip_address || "").toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderGrid() {
    if (!rootEl) return;
    var grid = rootEl.querySelector("#stationGrid");
    if (!grid) return;

    if (Store.state.loading.pcs && !Store.state.pcs.length) {
      UI.clear(grid);
      grid.appendChild(UI.skeletonCards(8, "172px"));
      return;
    }

    var list = visiblePCs();
    var showDiscovered = (filter === "all") && Store.state.discovered.length;

    UI.clear(grid);

    if (!list.length && !showDiscovered) {
      grid.className = "";
      grid.appendChild(Store.state.pcs.length
        ? UI.emptyState({
            icon: "search",
            title: "No stations match",
            text: "Nothing matches the current filter and search.",
            actions: [{ label: "Clear filters", icon: "close", onClick: function () {
              filter = "all"; query = ""; renderPageChrome(); renderGrid();
            } }]
          })
        : UI.emptyState({
            icon: "floor",
            status: "accent",
            title: "No stations registered",
            text: "Add a station manually, or let discovery find the clients already running on your network.",
            actions: [
              { label: "Add station", icon: "plus", variant: "primary", onClick: addStationDialog },
              { label: "Open discovery", icon: "radar", onClick: function () { global.CXRouter.go("discovery"); } }
            ]
          }));
      return;
    }

    grid.className = "grid grid-stations";
    var made = [];
    list.forEach(function (pc) { var c = stationCard(pc); grid.appendChild(c); made.push(c); });
    if (showDiscovered) {
      Store.state.discovered.forEach(function (d) { var c = discoveredCard(d); grid.appendChild(c); made.push(c); });
    }
    Motion.stagger(made, { step: 0.016, y: 10, maxDelay: 0.22 });
  }

  function renderPageChrome() {
    if (!rootEl) return;
    var counts = Store.counts();
    var chips = rootEl.querySelectorAll("#floorFilters .chip");
    Array.prototype.forEach.call(chips, function (chip) {
      chip.setAttribute("aria-pressed", String(chip.dataset.filter === filter));
      var countEl = chip.querySelector(".chip-count");
      if (!countEl) return;
      var map = { all: counts.total, online: counts.online - counts.running, gaming: counts.running, offline: counts.offline, inactive: counts.inactive };
      countEl.textContent = map[chip.dataset.filter] || 0;
    });
    var search = rootEl.querySelector("#floorSearch");
    if (search && search.value !== query) search.value = query;
  }

  /* Update just the timers each second — re-rendering the whole grid every
     tick would fight the user's hover and scroll. */
  function tickTimers() {
    if (!rootEl) return;
    Object.keys(Store.state.running).forEach(function (name) {
      var el = rootEl.querySelector('[data-timer="' + CSS.escape(name) + '"]');
      if (!el) return;
      var run = Store.state.running[name];
      el.textContent = UI.hms(run.remaining);
      el.classList.toggle("is-ending", run.remaining <= 300 && run.remaining > 60);
      el.classList.toggle("is-critical", run.remaining <= 60);
    });
  }

  global.CXPages.floor = {
    title: "Floor",
    subtitle: "Live station status",

    mount: function (root, ctx) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });

      var counts = Store.counts();
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Floor</div>' +
            '<div class="page-sub">Every registered station and what it is doing right now.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="btnRefreshFloor">' + Icon("refresh", 15) +
              '<span class="btn-label">Refresh</span></button>' +
            '<button class="btn btn-primary" id="btnAddStation">' + Icon("plus", 15) +
              '<span class="btn-label">Add station</span></button>' +
          "</div>" +
        "</div>" +

        '<div class="toolbar">' +
          '<div class="search">' + Icon("search", 15) +
            '<input class="input" id="floorSearch" type="search" placeholder="Search by name or IP…" autocomplete="off">' +
          "</div>" +
          '<div class="row gap-2 wrap" id="floorFilters">' +
            FILTERS.map(function (f) {
              return '<button class="chip" data-filter="' + f.id + '" data-status="' +
                ({ online: "online", gaming: "gaming", offline: "offline", inactive: "idle", all: "accent" }[f.id]) + '">' +
                UI.esc(f.label) + '<span class="chip-count">0</span></button>';
            }).join("") +
          "</div>" +
          '<div class="grow"></div>' +
          '<div class="legend">' +
            '<span class="legend-item" data-status="online"><span class="legend-swatch"></span>Available</span>' +
            '<span class="legend-item" data-status="gaming"><span class="legend-swatch"></span>In use</span>' +
            '<span class="legend-item" data-status="offline"><span class="legend-swatch"></span>Offline</span>' +
            '<span class="legend-item" data-status="maintenance"><span class="legend-swatch"></span>Unregistered</span>' +
          "</div>" +
        "</div>" +

        '<div id="stationGrid" class="grid grid-stations"></div>';

      root.appendChild(page);

      page.querySelector("#btnAddStation").addEventListener("click", addStationDialog);
      var refreshBtn = page.querySelector("#btnRefreshFloor");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () {
          return Promise.all([Store.loadPCs(), Store.refreshPCList()])
            .then(function () { UI.toast.ok("Floor refreshed"); })
            .catch(function (e) { UI.toast.error("Refresh failed", e.message); });
        });
      });

      var search = page.querySelector("#floorSearch");
      search.addEventListener("input", function () { query = search.value; renderGrid(); });

      Array.prototype.forEach.call(page.querySelectorAll("#floorFilters .chip"), function (chip) {
        chip.addEventListener("click", function () {
          filter = chip.dataset.filter;
          renderPageChrome();
          renderGrid();
        });
      });

      offs.push(Store.on("pcs", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("connected", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("discovered", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("running", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("connection-status", renderGrid));
      offs.push(Store.on("tick", tickTimers));

      renderPageChrome();
      renderGrid();

      if (!Store.state.pcs.length && Store.state.user) Store.loadPCs().catch(function () {});
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    },

    addStationDialog: addStationDialog
  };
})(window);
