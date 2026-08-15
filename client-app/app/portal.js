/* ==========================================================================
   CafeXP Client — Portal shell
   Owns the top navigation, the nav chips and the animated view swap.
   In-portal navigation is client-side; the main process still owns page
   navigation (welcome / login / register / userdashboard) exactly as before.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Icon = global.CXIcon, Motion = global.CXMotion,
      Session = global.CXSession, Views = global.CXViews;

  var ORDER = ["home", "games", "food", "shop", "rewards", "account"];
  var current = null;
  var navToken = 0;
  var host = null;
  var buttons = {};

  /* ==========================================================================
     NAVIGATION
     ========================================================================== */
  function buildNav() {
    var nav = document.getElementById("navLinks");
    ORDER.forEach(function (id) {
      var view = Views[id];
      if (!view) return;
      var btn = UI.el("button", {
        class: "nav-link",
        type: "button",
        text: view.label,
        onClick: function () { go(id); }
      });
      buttons[id] = btn;
      nav.appendChild(btn);
    });
  }

  function go(id) {
    var view = Views[id];
    if (!view || current === id) return;

    var previous = current;
    current = id;
    var token = ++navToken;

    Object.keys(buttons).forEach(function (key) {
      if (key === id) buttons[key].setAttribute("aria-current", "page");
      else buttons[key].removeAttribute("aria-current");
    });

    var outgoing = host.firstElementChild;
    var incoming = UI.el("div");

    function swap() {
      if (token !== navToken) return;
      UI.clear(host);
      host.appendChild(incoming);
      try {
        view.mount(incoming, { go: go });
      } catch (e) {
        console.error("[portal] view failed: " + id, e);
        incoming.appendChild(UI.errorState("This page didn't load: " + e.message));
      }
      document.getElementById("portalScroll").scrollTop = 0;
    }

    if (outgoing && Motion.enabled) {
      Promise.resolve(Motion.exit(outgoing, { y: -8, duration: 0.14 })).then(swap);
    } else {
      swap();
    }
  }

  /** Re-mount the active view after state it renders from has changed. */
  function refreshCurrentView() {
    var id = current;
    if (!id) return;
    current = null;
    go(id);
  }

  /* ==========================================================================
     NAV CHIPS
     ========================================================================== */
  function paintChips() {
    var online = Session.isOnline();
    var play = Session.state.play;

    var chip = document.getElementById("sessionChip");
    var value = document.getElementById("sessionChipValue");

    if (play) {
      // Live countdown, mirrored from the launch timer.
      var timerState = Session.timerState();
      chip.setAttribute("data-timer", timerState);
      chip.setAttribute("data-status",
        timerState === "critical" ? "expired" : timerState === "warning" ? "warning" : "gaming");
      value.textContent = Session.clock(play.remaining);
      value.classList.add("timer-digits");
    } else {
      chip.removeAttribute("data-timer");
      chip.setAttribute("data-status", online ? "online" : "expired");
      value.classList.remove("timer-digits");
      value.textContent = online ? (Session.state.pcName || "Ready") : "Offline";
    }

    // Wallet has no backend; the chip stays neutral and explains on click.
    document.getElementById("walletChipValue").textContent = "—";

    var orb = document.getElementById("avatarOrb");
    var name = document.getElementById("avatarName");
    orb.textContent = UI.initials(Session.displayName());
    name.textContent = Session.firstName();
  }

  /* ==========================================================================
     PLAY SESSION OVERLAYS
     ========================================================================== */
  var launchOverlay = null;

  function showLaunching(appName) {
    if (launchOverlay) return;
    launchOverlay = UI.el("div", { class: "launch" });
    launchOverlay.innerHTML =
      '<div class="launch-inner">' +
        '<div class="launch-art"></div>' +
        '<div class="launch-title">Launching ' + UI.esc(appName) + "</div>" +
        '<div class="launch-note">Getting your game ready…</div>' +
        '<div class="launch-bar"><div class="launch-bar-fill" id="launchFill"></div></div>' +
      "</div>";
    document.body.appendChild(launchOverlay);
    Motion.animate(launchOverlay, { opacity: [0, 1] }, { duration: 0.2, easing: Motion.EASE.out });

    // An indeterminate sweep — the launcher reports start and failure, not
    // progress, so the bar must not pretend to measure anything.
    var fill = launchOverlay.querySelector("#launchFill");
    if (Motion.enabled && Motion.lib) {
      Motion.lib.animate(fill,
        { transform: ["translateX(-110%)", "translateX(370%)"] },
        { duration: 1.1, easing: "ease-in-out", repeat: Infinity });
    }
  }

  function hideLaunching() {
    if (!launchOverlay) return;
    var node = launchOverlay;
    launchOverlay = null;
    Promise.resolve(
      Motion.enabled && Motion.lib
        ? Motion.lib.animate(node, { opacity: [1, 0] }, { duration: 0.24 }).finished.catch(function () {})
        : null
    ).then(function () { if (node.parentNode) node.parentNode.removeChild(node); });
  }

  function showSessionEnded(info) {
    var played = info && info.session
      ? Session.clock(info.session.totalSeconds - info.session.remaining)
      : null;

    var node = UI.el("div", { class: "ended" });
    node.innerHTML =
      '<div class="ended-inner">' +
        '<div class="ended-mark">' + Icon("check", 34) + "</div>" +
        '<div class="ended-title">Session ended</div>' +
        '<div class="ended-text">Thanks for playing at CafeXP' +
          (info && info.appName ? ". " + UI.esc(info.appName) + " has been closed." : ".") +
        "</div>" +
        (played
          ? '<div class="ended-stats">' +
              '<div><div class="ended-stat-value mono">' + played + "</div>" +
              '<div class="ended-stat-label">Time played</div></div>' +
              '<div><div class="ended-stat-value mono">' + UI.esc(Session.state.pcName || "—") + "</div>" +
              '<div class="ended-stat-label">Station</div></div>' +
            "</div>"
          : "") +
        '<div style="margin-top:var(--s-10)">' +
          '<button class="btn btn-primary btn-hero" id="endedHome">Return home</button>' +
        "</div>" +
      "</div>";

    document.body.appendChild(node);
    Motion.animate(node, { opacity: [0, 1] }, { duration: 0.26, easing: Motion.EASE.out });
    Motion.enter(node.querySelector(".ended-inner"), { y: 18, duration: 0.4 });

    node.querySelector("#endedHome").addEventListener("click", function () {
      Promise.resolve(
        Motion.enabled && Motion.lib
          ? Motion.lib.animate(node, { opacity: [1, 0] }, { duration: 0.22 }).finished.catch(function () {})
          : null
      ).then(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        go("home");
      });
    });
  }

  function explainChip(title, text) {
    UI.modal({
      title: title,
      body: '<div style="font-size:var(--t-body);line-height:1.65;color:var(--text-2)">' + UI.esc(text) + "</div>",
      actions: [{ label: "Got it", variant: "primary" }]
    });
  }

  /* ==========================================================================
     BOOT
     ========================================================================== */
  function boot() {
    host = document.getElementById("viewHost");

    document.getElementById("notifyBtn").innerHTML = Icon("bell", 18);

    Session.init();
    buildNav();
    paintChips();

    Session.on("user", paintChips);
    Session.on("pc", paintChips);
    Session.on("connection", function (status) {
      paintChips();
      if (status === "CONNECTED") {
        UI.toast({ title: "Station reconnected", status: "ok", duration: 2600 });
      } else {
        UI.toast({
          title: "Lost the café server",
          message: "Your station can't reach CafeXP. Please let a staff member know.",
          status: "error",
          duration: 0
        });
      }
      refreshCurrentView();
    });

    /* ---------- play session ---------- */
    Session.on("play", function (play) {
      hideLaunching();
      paintChips();
      UI.toast({ title: play.appName + " is running", message: Session.clock(play.remaining) + " on the clock", status: "ok" });
      refreshCurrentView();
    });
    Session.on("tick", paintChips);
    Session.on("launching", function (info) { showLaunching(info.appName); });
    Session.on("launch-failed", function (info) {
      hideLaunching();
      UI.toast({
        title: "That game didn't start",
        message: "Please ask a staff member for help.",
        status: "error"
      });
      console.error("[launch] failed", info);
    });
    Session.on("warning", function (play) {
      UI.toast({ title: "15 minutes left", message: "Your session on " + (Session.state.pcName || "this station") + " is ending soon.", status: "warn", duration: 7000 });
    });
    Session.on("critical", function () {
      UI.toast({ title: "5 minutes left", message: "Time to wrap up — save your progress.", status: "error", duration: 9000 });
    });
    Session.on("play-ended", function (info) {
      hideLaunching();
      paintChips();
      showSessionEnded(info);
      refreshCurrentView();
    });

    document.getElementById("sessionChip").addEventListener("click", function () {
      var play = Session.state.play;
      if (play) {
        explainChip(
          play.appName,
          Session.clock(play.remaining) + " left of your " + Session.clock(play.totalSeconds) +
          " session on " + (Session.state.pcName || "this station") +
          ". The game closes automatically when the time runs out."
        );
        return;
      }
      explainChip(
        "Your session",
        Session.isOnline()
          ? "This station is connected to the café server. When staff start a session for you, the countdown appears here and on the floating timer card."
          : "This station has lost its connection to the café server, so session details aren't available. Please let a staff member know."
      );
    });

    document.getElementById("walletChip").addEventListener("click", function () {
      explainChip(
        "Wallet",
        "Your café hasn't switched on wallet balances yet. Once it does, your balance, top-ups and spending will show here."
      );
    });

    document.getElementById("notifyBtn").addEventListener("click", function () {
      explainChip(
        "Notifications",
        "Order updates, session reminders and café announcements will appear here once your café enables them."
      );
    });

    document.getElementById("accountBtn").addEventListener("click", function () { go("account"); });

    go("home");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
