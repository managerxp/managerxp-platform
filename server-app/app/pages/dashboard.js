/* ==========================================================================
   CafeXP — Dashboard
   Owner overview built only from data the platform actually has today:
   station counts, live floor state, licence seats, and runtime activity.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var offs = [];
  var rootEl = null;

  /*
   * Online and Offline are about PCs only.
   *
   * They used to run over every station, so a pool table and a VR rig — which
   * have no client and never will — were counted as "online". The dashboard
   * then reported three clients connected when exactly one machine had ever
   * been reachable, and the number could never be made to agree with the
   * connection log. By-the-hour stations get their own tile instead of being
   * folded into a connection count they can never be part of.
   */
  var KPIS = [
    { id: "total",      label: "Stations",   icon: "floor",   status: "accent",  tip: "Registered in this cafe" },
    { id: "online",     label: "PCs online", icon: "wifi",    status: "online",  tip: "Client connected right now" },
    { id: "running",    label: "In use",     icon: "play",    status: "gaming",  tip: "A session is running on this station" },
    { id: "offline",    label: "PCs offline", icon: "wifiOff", status: "offline", tip: "Registered with an address but no client connection" },
    { id: "hourly",     label: "By the hour", icon: "clock",  status: "idle",    tip: "Tables, consoles and rigs with no client to connect — always ready" },
    { id: "discovered", label: "Unregistered", icon: "radar", status: "warning", tip: "Found on the network, not in the registry" },
    { id: "seats",      label: "Licence seats", icon: "plan", status: "idle",    tip: "Stations used against your plan limit" }
  ];

  function renderKPIs() {
    if (!rootEl) return;
    var c = Store.counts();
    var sub = Store.state.subscription;

    var values = {
      total: c.total,
      online: c.online,
      running: c.running,
      offline: c.offline,
      hourly: c.hourly,
      discovered: c.discovered,
      seats: c.total
    };

    KPIS.forEach(function (k) {
      var valEl = rootEl.querySelector('[data-kpi="' + k.id + '"]');
      if (!valEl) return;
      Motion.countTo(valEl, values[k.id]);

      /* The floor's make-up in one line — "2 PC · 1 PS5 · 1 Pool" — so the
         headline number says how many stations and this says of what. */
      if (k.id === "total") {
        var mix = rootEl.querySelector('[data-kpi-foot="total"]');
        if (mix) {
          mix.textContent = Store.stationTypes().map(function (g) {
            return g.total + " " + g.type;
          }).join(" · ");
        }
      }

      if (k.id === "seats") {
        var foot = rootEl.querySelector('[data-kpi-foot="seats"]');
        if (foot) {
          foot.textContent = sub && sub.max_pcs != null
            ? "of " + sub.max_pcs + " on " + (sub.name || "your plan")
            : "No active plan found";
        }
        var tile = valEl.closest(".stat");
        if (tile && sub && sub.max_pcs != null) {
          var ratio = c.total / Math.max(1, sub.max_pcs);
          tile.setAttribute("data-status", ratio >= 1 ? "offline" : ratio >= 0.85 ? "warning" : "online");
        }
      }
    });
  }

  /* ==========================================================================
     LIVE FLOOR STRIP
     ========================================================================== */
  function floorRow(pc) {
    var status = Store.pcStatus(pc);
    var run = Store.state.running[pc.name];
    var row = UI.el("div", { class: "floor-row", dataset: { status: status, pc: pc.name } });

    var state = run ? UI.esc(run.appName)
      : status === "online" ? "Available"
      : status === "inactive" ? "Deactivated"
      : "Offline";

    row.innerHTML =
      '<div class="floor-row-name"><span class="dot' + (status === "online" || status === "gaming" ? " dot-live" : "") + '"></span>' +
        '<span class="truncate">' + UI.esc(pc.name) + "</span></div>" +
      '<div class="floor-row-state">' + state + "</div>" +
      '<div class="floor-row-time" data-timer="' + UI.esc(pc.name) + '">' + (run ? UI.hms(run.remaining) : "") + "</div>" +
      '<span class="badge">' + UI.esc({ online: "Available", gaming: "In use", offline: "Offline", inactive: "Off" }[status] || status) + "</span>";

    row.addEventListener("click", function () { global.CXStationPanel.open(pc.name); });
    return row;
  }

  function renderStrip() {
    if (!rootEl) return;
    var strip = rootEl.querySelector("#floorStrip");
    if (!strip) return;

    if (Store.state.loading.pcs && !Store.state.pcs.length) {
      UI.clear(strip);
      strip.appendChild(UI.skeletonRows(5));
      return;
    }

    UI.clear(strip);
    if (!Store.state.pcs.length) {
      strip.appendChild(UI.emptyState({
        icon: "floor",
        title: "No stations yet",
        text: "Register your first station to see the floor here.",
        actions: [{ label: "Go to Floor", icon: "floor", variant: "primary", onClick: function () { global.CXRouter.go("floor"); } }]
      }));
      return;
    }

    /*
     * Grouped by what the station is, then sorted within the group.
     *
     * A floor is not one undifferentiated list — an owner reads it as "how
     * are my PCs doing, how are my tables doing". Ungrouped and alphabetical,
     * Pool-1 sorted above PS5-02 above VR-01 and the shape of the floor was
     * invisible. PCs lead because they are usually the bulk of the room and
     * the only ones with a connection that can go wrong.
     */
    var order = { gaming: 0, online: 1, offline: 2, inactive: 3 };
    var groups = Store.stationTypes();
    var rows = [];

    groups.forEach(function (group) {
      var members = Store.state.pcs.filter(function (p) {
        return Store.stationType(p) === group.type;
      }).sort(function (a, b) {
        var d = order[Store.pcStatus(a)] - order[Store.pcStatus(b)];
        return d !== 0 ? d : String(a.name).localeCompare(String(b.name));
      });
      if (!members.length) return;

      var busy = members.filter(function (p) { return Store.pcStatus(p) === "gaming"; }).length;
      var free = members.filter(function (p) { return Store.pcStatus(p) === "online"; }).length;

      /* One line per group saying how many are free, because that is the
         question being asked when somebody walks in. */
      var head = UI.el("div", { class: "floor-group" });
      head.innerHTML =
        '<span class="floor-group-name">' + UI.esc(group.type) + "</span>" +
        '<span class="floor-group-count">' +
          (busy ? busy + " in use · " : "") + free + " of " + members.length + " free" +
        "</span>";
      strip.appendChild(head);

      members.forEach(function (pc) { var r = floorRow(pc); strip.appendChild(r); rows.push(r); });
    });

    Motion.stagger(rows, { step: 0.012, y: 6, maxDelay: 0.18 });
  }

  /* ==========================================================================
     PLAN CARD
     ========================================================================== */
  function renderPlan() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#planCard");
    if (!host) return;

    var sub = Store.state.subscription;
    UI.clear(host);

    if (Store.state.loading.subscription) { host.appendChild(UI.skeletonRows(4)); return; }

    if (!sub) {
      host.appendChild(UI.emptyState({
        icon: "plan",
        title: "No active plan",
        text: Store.state.error.subscription
          ? "Could not reach the licensing service: " + Store.state.error.subscription
          : "No subscription is linked to this cafe.",
        actions: [{ label: "Retry", icon: "refresh", onClick: function () { Store.loadSubscription().catch(function () {}); } }]
      }));
      return;
    }

    var end = new Date(sub.end_date);
    var daysLeft = Math.max(0, Math.ceil((end - new Date()) / 86400000));
    var active = sub.is_active && new Date() <= end;
    var used = Store.counts().total;
    var pct = sub.max_pcs ? Math.min(100, Math.round((used / sub.max_pcs) * 100)) : 0;

    var body = UI.el("div", { class: "card-body col gap-5" });
    body.innerHTML =
      '<div class="row gap-5" style="align-items:center">' +
        '<div class="plan-ring" data-status="' + (pct >= 100 ? "offline" : pct >= 85 ? "warning" : "online") + '" style="--pct:' + pct + '">' +
          '<div class="plan-ring-copy">' +
            '<div class="plan-ring-val">' + used + "</div>" +
            '<div class="plan-ring-lbl">of ' + UI.esc(sub.max_pcs != null ? sub.max_pcs : "—") + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="grow col gap-1">' +
          '<div class="row gap-2" style="align-items:center">' +
            '<span style="font-size:17px;font-weight:650">' + UI.esc(sub.name || "Plan") + "</span>" +
            '<span class="badge" data-status="' + (active ? "online" : "offline") + '">' + (active ? "Active" : "Inactive") + "</span>" +
          "</div>" +
          '<div class="muted" style="font-size:12px">Station seats used</div>' +
          '<div class="row gap-2 wrap" style="margin-top:6px">' +
            (sub.is_freetrial ? '<span class="badge" data-status="warning">Free trial</span>' : "") +
            '<span class="badge badge-plain">' + (sub.is_single_pc_price ? "Single-PC pricing" : "Multi-PC pricing") + "</span>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="col">' +
        '<div class="kv"><span class="kv-key">Renews / expires</span><span class="kv-val">' + UI.esc(UI.fmtDate(sub.end_date)) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Days remaining</span><span class="kv-val num" style="color:' +
          (daysLeft > 14 ? "var(--ok)" : daysLeft > 0 ? "var(--warn)" : "var(--danger)") + '">' + daysLeft + "</span></div>" +
      "</div>";
    host.appendChild(body);
  }

  /* ==========================================================================
     ACTIVITY (live server log tail)
     ========================================================================== */
  function renderActivity() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#activityList");
    if (!host) return;

    var recent = Store.state.logs.slice(-8).reverse();
    UI.clear(host);

    if (!recent.length) {
      host.appendChild(UI.emptyState({
        icon: "logs",
        title: "No activity yet",
        text: "Connection attempts, launches and errors appear here as they happen."
      }));
      return;
    }

    recent.forEach(function (entry) {
      var row = UI.el("div", { class: "kv", style: { padding: "8px 0" } });
      row.innerHTML =
        '<span class="row gap-2 grow" style="min-width:0">' +
          '<span class="dot" data-status="' + ({ error: "offline", warn: "warning", ok: "online", info: "idle" }[entry.level]) + '"></span>' +
          '<span class="truncate" style="font-size:12px">' + UI.esc(entry.text) + "</span>" +
        "</span>" +
        '<span class="faint" style="font-size:11px;white-space:nowrap">' + UI.esc(UI.relTime(entry.time)) + "</span>";
      host.appendChild(row);
    });
  }

  function tickTimers() {
    if (!rootEl) return;
    Object.keys(Store.state.running).forEach(function (name) {
      var el = rootEl.querySelector('#floorStrip [data-timer="' + CSS.escape(name) + '"]');
      if (el) el.textContent = UI.hms(Store.state.running[name].remaining);
    });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.dashboard = {
    title: "Dashboard",
    subtitle: "Cafe overview",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      var user = Store.state.user;

      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">' + (user ? "Welcome back, " + UI.esc((user.name || user.email || "").split(" ")[0]) : "Dashboard") + "</div>" +
            '<div class="page-sub">Here is what your floor looks like right now.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="dashRefresh">' + Icon("refresh", 15) + '<span class="btn-label">Refresh</span></button>' +
            '<button class="btn btn-primary" id="dashFloor">' + Icon("floor", 15) + '<span class="btn-label">Open floor</span></button>' +
          "</div>" +
        "</div>" +

        '<div class="grid grid-kpi" style="margin-bottom:var(--s-5)">' +
          KPIS.map(function (k) {
            return '<div class="stat stat-accent" data-status="' + k.status + '" data-tip="' + UI.esc(k.tip) + '">' +
              '<div class="stat-label">' + Icon(k.icon, 13) + UI.esc(k.label) + "</div>" +
              '<div class="stat-value" data-kpi="' + k.id + '">0</div>' +
              (k.id === "seats" || k.id === "total"
                ? '<div class="stat-foot" data-kpi-foot="' + k.id + '"></div>' : "") +
            "</div>";
          }).join("") +
        "</div>" +

        '<div class="grid grid-split">' +
          '<div class="card">' +
            '<div class="card-head">' +
              "<div><h2>Live floor</h2>" +
              '<div class="faint" style="font-size:12px;margin-top:2px">Click a station to open its controls</div></div>' +
              '<button class="btn btn-ghost btn-sm" id="stripAll">' +
                '<span class="btn-label">View all</span>' + Icon("chevronR", 14) + "</button>" +
            "</div>" +
            '<div class="floor-strip" id="floorStrip"></div>' +
          "</div>" +

          '<div class="col gap-4">' +
            '<div class="card" id="planCard">' +
              '<div class="card-head"><h2>Subscription</h2>' +
                '<button class="btn btn-ghost btn-sm" id="planMore">' + Icon("chevronR", 14) + "</button></div>" +
            "</div>" +
            '<div class="card">' +
              '<div class="card-head"><h2>Recent activity</h2>' +
                '<button class="btn btn-ghost btn-sm" id="logsMore"><span class="btn-label">Server log</span>' + Icon("chevronR", 14) + "</button></div>" +
              '<div class="card-body" id="activityList"></div>' +
            "</div>" +
          "</div>" +
        "</div>";

      root.appendChild(page);

      page.querySelector("#dashFloor").addEventListener("click", function () { global.CXRouter.go("floor"); });
      page.querySelector("#stripAll").addEventListener("click", function () { global.CXRouter.go("floor"); });
      page.querySelector("#logsMore").addEventListener("click", function () { global.CXRouter.go("logs"); });
      page.querySelector("#planMore").addEventListener("click", function () { global.CXRouter.go("plan"); });

      var refreshBtn = page.querySelector("#dashRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () {
          return Promise.all([
            Store.loadPCs().catch(function () {}),
            Store.loadSubscription().catch(function () {})
          ]).then(function () { UI.toast.ok("Dashboard refreshed"); });
        });
      });

      // The plan card is rebuilt wholesale, so re-bind its header button after.
      var planHeadBtn = page.querySelector("#planMore");
      if (planHeadBtn) planHeadBtn.addEventListener("click", function () { global.CXRouter.go("plan"); });

      offs.push(Store.on("pcs", function () { renderKPIs(); renderStrip(); }));
      offs.push(Store.on("connected", function () { renderKPIs(); renderStrip(); }));
      offs.push(Store.on("running", function () { renderKPIs(); renderStrip(); }));
      offs.push(Store.on("discovered", renderKPIs));
      offs.push(Store.on("connection-status", function () { renderKPIs(); renderStrip(); }));
      offs.push(Store.on("subscription", function () { renderKPIs(); renderPlan(); }));
      offs.push(Store.on("subscription:loading", renderPlan));
      offs.push(Store.on("log", renderActivity));
      offs.push(Store.on("tick", tickTimers));

      renderKPIs();
      renderStrip();
      renderPlan();
      renderActivity();
      Motion.stagger(page.querySelectorAll(".stat"), { step: 0.03, y: 12 });

      if (Store.state.user) {
        if (!Store.state.pcs.length) Store.loadPCs().catch(function () {});
        if (!Store.state.subscription) Store.loadSubscription().catch(function () {});
      }
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
    }
  };
})(window);
