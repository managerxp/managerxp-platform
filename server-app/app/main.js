/* ==========================================================================
   CafeXP — Bootstrap
   Wires the shell (clock, live pill, user menu, global actions) and starts
   the router. All data flows through CXStore.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Router = global.CXRouter,
      Icon = global.CXIcon, Motion = global.CXMotion;

  /* ---------- Clock ---------- */
  function startClock() {
    var elClock = document.getElementById("clock");
    function tick() {
      elClock.textContent = new Date().toLocaleTimeString([], { hour12: false });
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------- Live station pill in the topbar ---------- */
  function refreshPill() {
    var c = Store.counts();
    var online = document.getElementById("pillOnline");
    var total = document.getElementById("pillTotal");
    Motion.countTo(online, c.online);
    Motion.countTo(total, c.total);

    var pill = document.getElementById("floorPill");
    var dot = pill.querySelector(".dot");
    var state = c.total === 0 ? "idle" : (c.online === 0 ? "offline" : (c.online < c.total ? "warning" : "online"));
    dot.setAttribute("data-status", state);
    dot.classList.toggle("dot-live", c.online > 0);

    Router.setBadge("discovery", c.discovered, "accent");
    Router.setBadge("devices", c.failing, "muted");
  }

  /* ---------- User chip / account menu ---------- */
  function renderUser() {
    var user = Store.state.user;
    document.getElementById("userAvatar").textContent = user ? UI.initials(user.name || user.email) : "?";
    document.getElementById("userName").textContent = user ? (user.name || user.email || "User") : "Not signed in";
    document.getElementById("userMail").textContent = user ? (user.email || "—") : "Sign in to load your cafe";
  }

  /* ==========================================================================
     Software updates — a topbar indicator, deliberately separate from the
     notification bell. A pending coin request or order is this café's own
     business; an available CafeXP build is ManagerXP's, and the two should
     never compete for the same badge.

     Visibility only for now: this reports what is available, not whether it
     is safe to apply — update-schedule.js already carries that policy for
     when an apply step exists to gate.
     ========================================================================== */
  function localVersionSort(v) {
    var parts = String(v || "0.0.0").replace(/^v/i, "").split(".");
    var major = parseInt(parts[0], 10) || 0;
    var minor = parseInt(parts[1], 10) || 0;
    var patch = parseInt(String(parts[2] || "0").split("-")[0], 10) || 0;
    return major * 1000000 + minor * 1000 + patch;
  }

  var updateInfo = { server: null, client: null };

  function paintUpdateButton() {
    var btn = document.getElementById("updateAvailableBtn");
    if (!btn) return;
    var serverUp = updateInfo.server && updateInfo.server.update_available;
    var clientUp = updateInfo.client && updateInfo.client.update_available;
    btn.classList.toggle("hidden", !serverUp && !clientUp);
    btn.setAttribute("data-tip",
      serverUp && clientUp ? "Console and station updates are available — see Settings"
      : serverUp ? "A new console version is available — see Settings"
      : clientUp ? "A newer client version is available for your stations — see Settings"
      : "");
  }

  /** Ask the backend what ManagerXP has published, for this console and for
      whichever connected station is furthest behind. */
  function checkForSoftwareUpdate() {
    var getVersion = (global.api && global.api.getAppVersion)
      ? global.api.getAppVersion() : Promise.resolve("0.0.0");

    getVersion.then(function (v) {
      return Store.checkUpdate("server", v || "0.0.0");
    }).then(function (data) {
      updateInfo.server = data;
      paintUpdateButton();
    }).catch(function () { /* offline or not entitled — leave the last known state */ });

    var reported = (Store.state.pcs || [])
      .map(function (p) { return p.client_version; })
      .filter(Boolean);
    if (!reported.length) return;
    var oldest = reported.sort(function (a, b) { return localVersionSort(a) - localVersionSort(b); })[0];

    Store.checkUpdate("client", oldest)
      .then(function (data) { updateInfo.client = data; paintUpdateButton(); })
      .catch(function () {});
  }

  /*
   * A short chime for anything the bell announces — a coin request, a new
   * order, a new booking. Web Audio rather than an asset file, so there is
   * nothing to bundle or fail to load; the same trick the station's timer
   * card already uses for its own beeps.
   */
  var notifyAudioCtx = null;
  function notifyBeep() {
    try {
      if (!notifyAudioCtx) notifyAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (notifyAudioCtx.state === "suspended") notifyAudioCtx.resume();
      var osc = notifyAudioCtx.createOscillator();
      var gain = notifyAudioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(notifyAudioCtx.destination);
      var now = notifyAudioCtx.currentTime;
      osc.start(now);
      // A second, slightly higher note — reads as "ding-ding", not a single flat beep.
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1046, now + 0.13);
      gain.gain.setValueAtTime(gain.gain.value, now + 0.22);
      gain.gain.linearRampToValueAtTime(0, now + 0.26);
      osc.stop(now + 0.26);
    } catch (e) {
      /* No audio device, or a policy blocking autoplay before any user
         gesture. The toast and badge still carry the message either way. */
    }
  }

  /* The bell and every toast's "Open" land on the same dedicated
     Notifications page, not inside Billing/F&B's own tabs — staff see coin
     requests, new orders and new bookings together in one place. */
  var pendingCoinCount = 0;
  var pendingOrderCount = 0;
  var pendingReservationCount = 0;
  function openNotifications() {
    Router.go("notifications");
  }

  function openAccountMenu() {
    var user = Store.state.user;
    if (!user) { Store.login(); return; }

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="row gap-3">' +
        '<span class="avatar" style="width:44px;height:44px;font-size:15px">' + UI.esc(UI.initials(user.name || user.email)) + "</span>" +
        '<div class="grow" style="min-width:0">' +
          '<div style="font-weight:650;font-size:15px">' + UI.esc(user.name || "User") + "</div>" +
          '<div class="muted" style="font-size:12px">' + UI.esc(user.email || "") + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="col">' +
        '<div class="kv"><span class="kv-key">Cafe ID</span><span class="kv-val mono">' + UI.esc(user.cafe_id != null ? user.cafe_id : "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Stations registered</span><span class="kv-val num">' + Store.counts().total + "</span></div>" +
        '<div class="kv"><span class="kv-key">Backend</span><span class="kv-val mono">' + UI.esc(Store.API_BASE) + "</span></div>" +
      "</div>";

    UI.modal({
      title: "Account",
      body: body,
      actions: [
        { label: "Close", variant: "ghost" },
        {
          label: "Sign out", variant: "danger", icon: "logout",
          onClick: function () {
            return UI.confirm({
              title: "Sign out?",
              message: "You will need to sign in again to manage this cafe.",
              confirmLabel: "Sign out",
              variant: "danger"
            }).then(function (ok) {
              if (ok) Store.logout();
              return ok;
            });
          }
        }
      ]
    });
  }

  /* ---------- Global actions ---------- */
  function reconnectAll(btn) {
    return UI.withBusy(btn, function () {
      return Store.reconnectAll().then(function (result) {
        if (result && result.success) {
          UI.toast.ok("Reconnecting stations", result.reconnected + " station(s) queued");
        } else {
          UI.toast.error("Reconnect failed", (result && result.error) || "Unknown error");
        }
      }).catch(function (e) { UI.toast.error("Reconnect failed", e.message); });
    });
  }

  /* ---------- Window controls (the OS frame is disabled) ---------- */
  var MAXIMISE_GLYPH = '<rect x="2.5" y="2.5" width="7" height="7" rx="1"/>';
  var RESTORE_GLYPH =
    '<rect x="2" y="4" width="6" height="6" rx="1"/>' +
    '<path d="M4.4 4V2.6A.6.6 0 0 1 5 2h4.4a.6.6 0 0 1 .6.6V7a.6.6 0 0 1-.6.6H8.6"/>';

  function setMaximizedGlyph(isMaximized) {
    var btn = document.getElementById("winMax");
    if (!btn) return;
    btn.querySelector("svg").innerHTML = isMaximized ? RESTORE_GLYPH : MAXIMISE_GLYPH;
    btn.setAttribute("aria-label", isMaximized ? "Restore" : "Maximise");
    btn.setAttribute("title", isMaximized ? "Restore" : "Maximise");
  }

  function wireWindowControls() {
    var api = global.api || {};
    var min = document.getElementById("winMin");
    var max = document.getElementById("winMax");
    var close = document.getElementById("winClose");
    if (!min || !max || !close) return;

    // Without the bridge these would be dead controls in the title bar.
    if (!api.windowMinimize) {
      document.getElementById("winControls").classList.add("hidden");
      return;
    }

    min.addEventListener("click", function () { api.windowMinimize(); });
    max.addEventListener("click", function () { api.windowToggleMaximize(); });
    close.addEventListener("click", function () { api.windowClose(); });

    // Double-clicking the bar toggles maximise, as a native title bar does.
    var topbar = document.querySelector(".topbar");
    if (topbar) {
      topbar.addEventListener("dblclick", function (e) {
        if (e.target.closest("button, input, select, .status-pill")) return;
        api.windowToggleMaximize();
      });
    }

    if (api.onWindowMaximizedChanged) api.onWindowMaximizedChanged(setMaximizedGlyph);
    if (api.windowIsMaximized) api.windowIsMaximized().then(setMaximizedGlyph).catch(function () {});
  }

  /* ---------- Boot ---------- */
  function boot() {
    wireWindowControls();
    // Icons that live in static markup
    document.getElementById("sidebarToggle").innerHTML = Icon("chevronL", 16);
    var reconnectBtn = document.getElementById("reconnectAllBtn");
    reconnectBtn.innerHTML = Icon("refresh", 16);
    // The bell already carries a badge span in static markup; prepend the
    // icon rather than overwrite it with innerHTML.
    var bellBtn = document.getElementById("notifyBell");
    if (bellBtn) bellBtn.insertAdjacentHTML("afterbegin", Icon("bell", 16));
    var updateBtn = document.getElementById("updateAvailableBtn");
    if (updateBtn) updateBtn.insertAdjacentHTML("afterbegin", Icon("refresh", 14));

    document.getElementById("sidebarToggle").addEventListener("click", Router.toggleSidebar);
    document.getElementById("userChip").addEventListener("click", openAccountMenu);
    reconnectBtn.addEventListener("click", function () { reconnectAll(reconnectBtn); });
    if (bellBtn) bellBtn.addEventListener("click", openNotifications);
    if (updateBtn) updateBtn.addEventListener("click", function () { Router.go("updates"); });

    Store.init();
    startClock();

    Router.init({
      host: document.getElementById("viewHost"),
      sidebarNav: document.getElementById("sidebarNav"),
      start: "dashboard"
    });

    // Shell reacts to store changes
    Store.on("pcs", refreshPill);
    Store.on("connected", refreshPill);
    Store.on("discovered", refreshPill);
    Store.on("connection-status", refreshPill);
    Store.on("running", refreshPill);
    Store.on("user", function () { renderUser(); refreshPill(); });

    // Notifications for state changes worth interrupting for
    Store.on("pc:online", function (name) {
      UI.toast({ title: name + " is online", status: "ok", duration: 2600 });
    });
    Store.on("pc:offline", function (name) {
      UI.toast({ title: name + " went offline", message: "The client stopped responding.", status: "warn" });
    });
    Store.on("discovered:new", function (list) {
      UI.toast({
        title: "Unregistered station found",
        message: list.length + " station(s) on the network are not registered yet.",
        status: "accent"
      });
    });
    Store.on("timer:expired", function (name) {
      UI.toast({ title: "Time expired on " + name, message: "The application was closed.", status: "warn" });
    });

    /* The topbar bell's running count — combined across every kind of thing
       it announces, every check and not just new arrivals, so it also drops
       when a request is settled from its own page while the bell isn't the
       thing being looked at. One bell, one number, whatever is behind it. */
    function paintBellBadge() {
      var badge = document.getElementById("notifyBellBadge");
      if (!badge) return;
      var n = pendingCoinCount + pendingOrderCount + pendingReservationCount;
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.classList.toggle("hidden", !n);
    }
    Store.on("topup-requests", function (list) {
      pendingCoinCount = (list || []).length;
      paintBellBadge();
    });
    Store.on("orders-pending", function (list) {
      pendingOrderCount = (list || []).length;
      paintBellBadge();
    });
    Store.on("reservations-pending", function (list) {
      pendingReservationCount = (list || []).length;
      paintBellBadge();
    });

    /* One customer, one cash request, one popup — clicking it goes to the
       Notifications page rather than making staff go find it themselves. */
    Store.on("topup:new", function (r) {
      notifyBeep();
      UI.toast({
        title: "Coins requested",
        message: (r.customer_name || "A customer") + " wants to add " +
          Number(r.coins || 0).toFixed(0) + " XP for ₹" + Number(r.amount || 0).toFixed(0) + " cash.",
        status: "accent",
        duration: 12000,
        action: { label: "Open", onClick: openNotifications }
      });
    });

    /* Same idea for a fresh food/drink order — placed and not yet even
       acknowledged. */
    Store.on("order:new", function (o) {
      notifyBeep();
      UI.toast({
        title: "New order — " + (o.order_number || ("#" + o.order_id)),
        message: (o.customer_name || "A customer") + (o.pc_name ? " at " + o.pc_name : "") +
          " ordered ₹" + Number(o.total || 0).toFixed(0) + " worth of food & drink.",
        status: "accent",
        duration: 12000,
        action: { label: "Open", onClick: openNotifications }
      });
    });

    /* Same idea again for a new booking — from the café's own public
       booking link as much as from a staff member typing one in here. */
    Store.on("reservation:new", function (r) {
      notifyBeep();
      UI.toast({
        title: "New booking",
        message: (r.customer_name || "A guest") + " booked " +
          (r.pc_name || (r.category ? "any " + r.category : "a station")) + " for " +
          new Date(r.start_time).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) + ".",
        status: "accent",
        duration: 12000,
        action: { label: "Open", onClick: openNotifications }
      });
    });

    /*
     * Time nearly up.
     *
     * Raised here rather than on the Floor because staff are usually somewhere
     * else — at the till, in the back — and a card turning amber on a screen
     * nobody is looking at warns no one. The toast names the station and
     * offers to extend it without navigating anywhere.
     */
    Store.on("session-expiring", function (info) {
      var mins = Math.max(1, Math.round(info.remaining / 60));
      UI.toast({
        title: info.pc_name + " — " + mins + " min left",
        message: (info.session.customer_name || "Guest") + "'s time is nearly up.",
        status: "warn",
        // Longer than a routine notice: this one is asking for a decision.
        duration: 15000,
        action: {
          label: "Extend",
          onClick: function () {
            if (global.CXSessionUI && global.CXSessionUI.extendDialog) {
              global.CXSessionUI.extendDialog(info.session);
            } else {
              global.CXRouter.go("sessions");
            }
          }
        }
      });
    });

    checkForSoftwareUpdate();
    setInterval(checkForSoftwareUpdate, 30 * 60 * 1000);

    renderUser();
    refreshPill();

    // If the main process pushed auth before this window finished loading,
    // the user:updated event was missed — pull the session directly.
    if (global.api && global.api.getUser) {
      Promise.all([
        global.api.getUser(),
        global.api.getToken ? global.api.getToken() : Promise.resolve(null)
      ]).then(function (res) {
        var user = res[0], tok = res[1];
        if (!user || Store.state.user) return;
        if (tok) {
          localStorage.setItem("token", tok);
          localStorage.setItem("cafeId", user.cafe_id || "");
        }
        Store.state.user = user;
        Store.emit("user", user);
        Store.loadPCs().catch(function () {});
        Store.loadSubscription().catch(function () {});
        Store.loadSessions().catch(function () {});
        Store.loadPermissions();
      }).catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
