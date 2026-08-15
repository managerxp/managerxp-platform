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

  /* ---------- Boot ---------- */
  function boot() {
    // Icons that live in static markup
    document.getElementById("sidebarToggle").innerHTML = Icon("chevronL", 16);
    var reconnectBtn = document.getElementById("reconnectAllBtn");
    reconnectBtn.innerHTML = Icon("refresh", 16);

    document.getElementById("sidebarToggle").addEventListener("click", Router.toggleSidebar);
    document.getElementById("userChip").addEventListener("click", openAccountMenu);
    reconnectBtn.addEventListener("click", function () { reconnectAll(reconnectBtn); });

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
      }).catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
