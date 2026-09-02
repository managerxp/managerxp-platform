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

  /* No "account" entry here — the avatar chip in the corner already opens
     the account quick-menu (and from there, the full Account page), so a
     second text tab to the same place would only cost width the labels
     below need to stay readable. */
  var ORDER = ["home", "games", "apps", "packages", "membership", "food", "shop", "rewards"];
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

      // Icon plus a wrapped label: at narrow widths the label is hidden and
      // the icon carries the button, so the nav stops overflowing instead of
      // pushing the window controls off the right edge.
      var btn = UI.el("button", {
        class: "nav-link",
        type: "button",
        // The title survives the label being hidden, and doubles as the
        // accessible name once only the icon is showing.
        title: view.label,
        "aria-label": view.label,
        html: (view.icon ? Icon(view.icon, 17) : "") +
          '<span class="nav-link-label">' + UI.esc(view.label) + "</span>",
        onClick: function () { go(id); }
      });
      buttons[id] = btn;
      nav.appendChild(btn);
    });
  }

  function go(id) {
    var view = Views[id];
    if (!view || current === id) return;

    closeVolumePopover();   // a leftover popover from the previous page reads as a bug

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
      // Never let a stalled animation strand the customer on a blank view:
      // whichever settles first — the exit or a short deadline — triggers the
      // swap, and the token guard keeps it from running twice.
      Promise.race([
        Promise.resolve(Motion.exit(outgoing, { y: -8, duration: 0.14 })),
        new Promise(function (resolve) { setTimeout(resolve, 260); })
      ]).then(swap);
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
    var cafeSession = Session.state.session;

    if (cafeSession) {
      // The café session outranks the launch timer in the nav bar.
      var st = Session.sessionState();
      chip.setAttribute("data-timer", st === "paused" ? "warning" : st);
      chip.setAttribute("data-status",
        st === "critical" ? "expired" : st === "warning" || st === "paused" ? "warning" : "gaming");
      value.textContent = st === "paused" ? "Paused" : Session.clock(Session.sessionClockSeconds());
      value.classList.add("timer-digits");
    } else if (play) {
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

    // Wallet balance, live from the server.
    var Wallet = global.CXWallet;
    var walletValue = document.getElementById("walletChipValue");
    var walletChip = document.getElementById("walletChip");
    if (Wallet.state.error || Wallet.state.balance === null) {
      walletValue.textContent = Wallet.state.loading ? "…" : "—";
      walletChip.setAttribute("data-status", Wallet.state.error ? "warning" : "idle");
    } else {
      walletChip.setAttribute("data-status", "accent");
      Motion.countTo(walletValue, Number(Wallet.state.balance), {
        duration: 0.6,
        format: function (v) { return Wallet.amount(v); }
      });
    }

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
      '<button class="modal-close launch-close" id="launchCancel" aria-label="Cancel launch">' +
        Icon("close", 15) +
      "</button>" +
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

    // A launch that never reports back (a launcher that silently failed to
    // hand off, a game that never actually opens a window) otherwise strands
    // the customer on this screen with no way out until staff intervene.
    launchOverlay.querySelector("#launchCancel").addEventListener("click", function () {
      Session.cancelLaunch(appName);
      hideLaunching();
      paintChips();
      refreshCurrentView();
    });
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

  /* ==========================================================================
     DISCONNECT OVERLAY
     The station losing its link is worth blocking the portal for — but not
     instantly. A short grace period keeps a momentary blip from flashing it,
     and reconnecting dismisses it immediately.
     ========================================================================== */
  var GRACE_MS = 6000;
  var disconnectNode = null;
  var disconnectTimer = null;
  var disconnectSince = null;
  var disconnectElapsedTimer = null;

  function onConnectionLost() {
    if (disconnectTimer || disconnectNode) return;
    disconnectSince = Date.now();
    disconnectTimer = setTimeout(showDisconnected, GRACE_MS);
  }

  function onConnectionRestored() {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
    disconnectSince = null;
    hideDisconnected();
  }

  function showDisconnected() {
    if (disconnectNode) return;
    disconnectNode = UI.el("div", { class: "disconnected" });
    disconnectNode.innerHTML =
      '<div class="disconnected-inner">' +
        '<div class="disconnected-mark">' + Icon("wifiOff", 38) + "</div>" +
        '<div class="disconnected-title">Connection lost</div>' +
        '<div class="disconnected-text">' +
          "This station can't reach the café server. Your session is safe — " +
          "it keeps running on the café's side. Please let a staff member know." +
        "</div>" +
        '<div class="disconnected-meta">' +
          '<span class="spinner"></span>' +
          "<span>Reconnecting…</span>" +
          '<span class="disconnected-elapsed" id="disconnectElapsed">00:00</span>' +
        "</div>" +
      "</div>";
    document.body.appendChild(disconnectNode);
    Motion.animate(disconnectNode, { opacity: [0, 1] }, { duration: 0.26, easing: Motion.EASE.out });
    Motion.enter(disconnectNode.querySelector(".disconnected-inner"), { y: 16, duration: 0.4 });

    var elapsedEl = disconnectNode.querySelector("#disconnectElapsed");
    disconnectElapsedTimer = setInterval(function () {
      if (!disconnectSince || !elapsedEl.isConnected) return;
      elapsedEl.textContent = Session.clock(Math.floor((Date.now() - disconnectSince) / 1000));
    }, 1000);
  }

  function hideDisconnected() {
    clearInterval(disconnectElapsedTimer);
    disconnectElapsedTimer = null;
    if (!disconnectNode) return;
    var node = disconnectNode;
    disconnectNode = null;
    Promise.race([
      Motion.enabled && Motion.lib
        ? Motion.lib.animate(node, { opacity: [1, 0] }, { duration: 0.24 }).finished.catch(function () {})
        : Promise.resolve(),
      new Promise(function (r) { setTimeout(r, 320); })
    ]).then(function () { if (node.parentNode) node.parentNode.removeChild(node); });
  }

  /* ==========================================================================
     POWER WARNING
     Staff have triggered a restart, shutdown or sign-out from the counter.
     Nothing here can stop it — the point is that the person at the station is
     told what is about to happen and roughly how long they have.
     ========================================================================== */
  var powerNode = null;
  var powerTimer = null;

  function showPowerWarning(info) {
    if (!info) return;
    if (powerNode && powerNode.parentNode) powerNode.parentNode.removeChild(powerNode);
    clearInterval(powerTimer);

    var seconds = Number(info.seconds);
    var counting = Number.isFinite(seconds) && seconds > 0;

    powerNode = UI.el("div", { class: "disconnected", dataset: { status: "warning" } });
    powerNode.innerHTML =
      '<div class="disconnected-inner">' +
        '<div class="disconnected-mark">' + Icon("power", 38) + "</div>" +
        '<div class="disconnected-title">' + UI.esc(info.label || "Station action") + "</div>" +
        '<div class="disconnected-text">' +
          "A staff member has asked this station to " +
          UI.esc((info.label || "restart").toLowerCase()) + ". " +
          "Save anything you need to now — please speak to the counter if this is unexpected." +
        "</div>" +
        (counting
          ? '<div class="disconnected-meta">' +
              "<span>In</span>" +
              '<span class="disconnected-elapsed" id="powerCountdown">' + seconds + "s</span>" +
            "</div>"
          : "") +
      "</div>";

    document.body.appendChild(powerNode);
    Motion.animate(powerNode, { opacity: [0, 1] }, { duration: 0.26, easing: Motion.EASE.out });
    Motion.enter(powerNode.querySelector(".disconnected-inner"), { y: 16, duration: 0.4 });

    if (counting) {
      var left = seconds;
      var out = powerNode.querySelector("#powerCountdown");
      powerTimer = setInterval(function () {
        left -= 1;
        if (!out || !out.isConnected || left < 0) { clearInterval(powerTimer); return; }
        out.textContent = left + "s";
      }, 1000);
    }
  }

  function explainChip(title, text) {
    UI.modal({
      title: title,
      body: '<div style="font-size:var(--t-body);line-height:1.65;color:var(--text-2)">' + UI.esc(text) + "</div>",
      actions: [{ label: "Got it", variant: "primary" }]
    });
  }

  /* ==========================================================================
     VOLUME

     A small popover anchored to the volume button — not a modal. A modal's
     scrim covers the whole kiosk screen for a control someone taps for two
     seconds; this behaves like the Windows flyout it's modelled on instead:
     appears under the button, closes on an outside click, Escape, or hitting
     the button again.

     The slider itself is a single row against this station's actual Windows
     volume — the same number the OS's own flyout shows, read and set through
     main.js's volume.ps1 (Core Audio API via COM interop, no module install,
     no native addon).
     ========================================================================== */
  var volumePopover = null;

  function closeVolumePopover() {
    if (!volumePopover) return;
    var p = volumePopover;
    volumePopover = null;
    document.removeEventListener("mousedown", p.onOutside, true);
    document.removeEventListener("keydown", p.onKey, true);
    if (p.node.parentNode) p.node.parentNode.removeChild(p.node);
  }

  function openVolumeMenu() {
    // A second click on the button while it's open should close it, not
    // stack a duplicate popover on top.
    if (volumePopover) { closeVolumePopover(); return; }

    if (!global.api || !global.api.volumeGet) {
      explainChip("Volume", "This station's build does not support volume control yet.");
      return;
    }

    var btn = document.getElementById("volumeBtn");
    var panel = UI.el("div", { class: "volume-popover", role: "dialog", "aria-label": "Volume" });
    panel.innerHTML =
      '<div class="volume-row">' +
        '<button class="volume-mute-btn" id="volMuteBtn" data-tip="Mute" aria-label="Mute or unmute"></button>' +
        '<input type="range" class="volume-slider" id="volSlider" min="0" max="100" step="1" value="0">' +
        '<span class="volume-pct" id="volPct">—</span>' +
      "</div>";
    document.body.appendChild(panel);

    // Hangs below the button, right-edge aligned to it — same corner logic
    // as the Windows flyout relative to its tray icon.
    var btnRect = btn.getBoundingClientRect();
    var panelRect = panel.getBoundingClientRect();
    panel.style.top = (btnRect.bottom + 8) + "px";
    panel.style.left = Math.max(8, Math.min(
      btnRect.right - panelRect.width,
      document.documentElement.clientWidth - panelRect.width - 8
    )) + "px";
    Motion.animate(panel, { opacity: [0, 1] }, { duration: 0.14, easing: Motion.EASE.out });

    var muteBtn = panel.querySelector("#volMuteBtn");
    var slider = panel.querySelector("#volSlider");
    var pct = panel.querySelector("#volPct");

    // The filled portion of the track left of the thumb is a gradient read
    // off this custom property (see portal.css) — Chromium's <input
    // type=range> has no built-in fill, unlike Firefox's ::-moz-range-progress.
    function paintFill(level) { slider.style.setProperty("--_v", level + "%"); }

    function paint(level, muted) {
      slider.value = level;
      paintFill(level);
      pct.textContent = level + "%";
      muteBtn.innerHTML = Icon((muted || level === 0) ? "volumeMute" : "volume", 18);
      muteBtn.setAttribute("data-tip", muted ? "Unmute" : "Mute");
    }

    global.api.volumeGet().then(function (r) {
      if (r && r.success) paint(r.level, r.muted);
      else UI.toast({ title: "Couldn't read the volume", status: "error", duration: 3000 });
    });

    /*
     * Dragging fires "input" continuously, and each OS-level set spawns a
     * PowerShell process — slow enough (regularly >80ms) that a fixed-delay
     * debounce let a fast drag queue up several of these in flight at once.
     * They then resolved out of order, and each one's response used to call
     * paint() and overwrite slider.value — so a stale reply could snap the
     * thumb backwards mid-drag while the user was still moving it. That was
     * the actual lag: not the debounce, but overlapping calls fighting the
     * live drag.
     *
     * Fixed by only ever letting one call run at a time, and always sending
     * whatever the slider is at the moment that call finishes — never a
     * value already superseded by the time it would arrive. The visual fill
     * and percentage already update every tick, straight from the input
     * event; only the real OS call is throttled, and it is never allowed to
     * write slider.value back — the drag position is already correct and
     * doesn't need correcting from a response.
     */
    var pendingLevel = null;
    var setInFlight = false;
    function flushVolume() {
      if (pendingLevel === null || setInFlight) return;
      var level = pendingLevel;
      pendingLevel = null;
      setInFlight = true;
      global.api.volumeSet(level).then(function (r) {
        setInFlight = false;
        if (!r || !r.success) UI.toast({ title: "Couldn't change the volume", status: "error", duration: 3000 });
        else muteBtn.innerHTML = Icon((r.muted || r.level === 0) ? "volumeMute" : "volume", 18);
        flushVolume();   // pick up whatever the user moved to meanwhile
      });
    }
    slider.addEventListener("input", function () {
      var level = Number(slider.value);
      paintFill(level);
      pct.textContent = level + "%";
      pendingLevel = level;
      flushVolume();
    });

    muteBtn.addEventListener("click", function () {
      global.api.volumeMuteToggle().then(function (r) {
        if (r && r.success) paint(r.level, r.muted);
        else UI.toast({ title: "Couldn't change the volume", status: "error", duration: 3000 });
      });
    });

    function onOutside(e) { if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeVolumePopover(); }
    function onKey(e) { if (e.key === "Escape") closeVolumePopover(); }
    // Capture phase, and deferred a tick: the click that opened this popover
    // is still bubbling when this listener attaches, and without the delay
    // it would immediately count as the "outside" click that closes it.
    setTimeout(function () {
      document.addEventListener("mousedown", onOutside, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);

    volumePopover = { node: panel, onOutside: onOutside, onKey: onKey };
  }

  /* ==========================================================================
     ACCOUNT MENU
     A quick-glance card reached from the avatar chip — balance and session at
     a glance, then the three things someone reaches for without wanting the
     full Account page: their wallet, their profile, or the door.
     ========================================================================== */
  function openAccountMenu() {
    var user = Session.state.user;
    var Wallet = global.CXWallet;
    var balanceLine = (Wallet.state.error || Wallet.state.balance === null)
      ? "—" : Wallet.amount(Wallet.state.balance);
    var sessionValue = document.getElementById("sessionChipValue").textContent;

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="row gap-3" style="align-items:center">' +
        '<span class="avatar-orb" style="width:48px;height:48px;font-size:17px">' +
          UI.esc(UI.initials(Session.displayName())) + "</span>" +
        '<div class="grow" style="min-width:0">' +
          '<div style="font-weight:700;font-size:15px">' + UI.esc(Session.displayName()) + "</div>" +
          '<div class="muted truncate" style="font-size:12px">' + UI.esc((user && user.email) || "") + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="row gap-6" style="padding:var(--s-3) 0;border-top:1px solid var(--line-faint);border-bottom:1px solid var(--line-faint)">' +
        '<div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Balance</div>' +
          '<div style="font-size:16px;font-weight:700">' + balanceLine + "</div></div>" +
        '<div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Session</div>' +
          '<div style="font-size:16px;font-weight:700">' + UI.esc(sessionValue) + "</div></div>" +
      "</div>" +
      '<div class="muted mono" style="font-size:11px;text-align:center">' +
        UI.esc(Session.state.pcName || "This station") +
        (global.__cxAppVersion ? " · v" + UI.esc(global.__cxAppVersion) : "") +
      "</div>";

    UI.modal({
      title: "Account",
      body: body,
      actions: [
        { label: "Wallet", variant: "outline", icon: "billing", onClick: function () { go("wallet"); } },
        { label: "My account", variant: "outline", icon: "customers", onClick: function () { go("account"); } },
        {
          label: "Log out", variant: "danger", icon: "logout",
          onClick: function () {
            return UI.confirm({
              title: "Sign out?",
              message: "You'll need to sign in again to see your account and wallet.",
              confirmLabel: "Sign out",
              variant: "danger"
            }).then(function (ok) {
              if (ok) Session.signOut();
              return ok;
            });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     BOOT
     ========================================================================== */
  function boot() {
    host = document.getElementById("viewHost");

    document.getElementById("notifyBtn").innerHTML = Icon("bell", 18);
    document.getElementById("helpBtn").innerHTML = Icon("help", 18);
    document.getElementById("volumeBtn").innerHTML = Icon("volume", 18);
    document.getElementById("walletChipCoin").innerHTML = global.CXCoin(22, { detail: "plain" });

    if (global.api && global.api.getAppVersion) {
      global.api.getAppVersion(function (v) { global.__cxAppVersion = v; });
    }

    Session.init();
    buildNav();
    paintChips();

    Session.on("user", paintChips);
    Session.on("pc", paintChips);

    // Staff triggered a restart, shutdown or sign-out from the counter.
    if (global.api && global.api.onPowerWarning) {
      global.api.onPowerWarning(showPowerWarning);
    }
    Session.on("connection", function (status) {
      paintChips();
      if (status === "CONNECTED") {
        onConnectionRestored();
        UI.toast({ title: "Station reconnected", status: "ok", duration: 2600 });
      } else {
        // The overlay takes over if this lasts; the toast covers a brief blip.
        onConnectionLost();
        UI.toast({
          title: "Lost the café server",
          message: "Trying to reconnect…",
          status: "error",
          duration: 5000
        });
      }
      refreshCurrentView();
    });

    /* ---------- café session ---------- */
    Session.on("session", function (session) {
      paintChips();
      refreshCurrentView();
      if (session) {
        UI.toast({
          title: session.status === "paused" ? "Session paused" : "Your session is running",
          message: session.status === "paused"
            ? "Ask a staff member when you're ready to carry on."
            : (session.remaining_seconds === null
                ? "Open-ended — play as long as you like."
                : Session.clock(session.remaining_seconds) + " on the clock"),
          status: session.status === "paused" ? "warn" : "ok"
        });
      }
    });
    Session.on("session-tick", paintChips);
    Session.on("session-ended", function () {
      paintChips();
      showSessionEnded({ appName: null, session: null });
      refreshCurrentView();
    });

    /* ---------- launch timer ---------- */
    Session.on("play", function (play) {
      hideLaunching();
      paintChips();
      UI.toast({ title: play.appName + " is running", message: Session.clock(play.remaining) + " on the clock", status: "ok" });
      refreshCurrentView();
    });
    Session.on("tick", paintChips);
    Session.on("launching", function (info) { showLaunching(info.appName); });
    /* Confirms the game is actually up. An untimed session never fires "play"
       (no launch timer exists for it), so without this the overlay above
       would never close for anyone on open-ended time. */
    Session.on("launched", function () {
      hideLaunching();
      paintChips();
      refreshCurrentView();
    });
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
    Session.on("overtime", function () {
      UI.toast({ title: "Time's up", message: "Keep playing — staff have been told and will settle the extra time.", status: "error", duration: 9000 });
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
          ". Play continues after that — staff will settle the extra time."
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

    document.getElementById("walletChip").addEventListener("click", function () { go("wallet"); });

    // Keep the chip in step with the wallet, and reload once the token lands.
    global.CXWallet.on(paintChips);
    Session.on("token", function (token) { if (token) global.CXWallet.load(); });
    Session.on("user", function () { global.CXWallet.load(); });

    document.getElementById("notifyBtn").addEventListener("click", function () {
      explainChip(
        "Notifications",
        "Order updates, session reminders and café announcements will appear here once your café enables them."
      );
    });

    document.getElementById("helpBtn").addEventListener("click", function () {
      var here = Session.state.pcName || "your station";
      UI.modal({
        title: "Help",
        body: '<div style="font-size:var(--t-body);line-height:1.65;color:var(--text-2)">' +
          "Need a hand? Call a staff member and they'll come to " + UI.esc(here) +
          " to see what's going on." +
          "</div>",
        actions: [
          { label: "Not now", variant: "ghost" },
          {
            label: "Call staff", variant: "primary", icon: "help",
            onClick: function () {
              if (global.api && global.api.callStaff) global.api.callStaff();
              UI.toast.ok("Staff called", "Someone will be with you at " + here + " shortly.");
            }
          }
        ]
      });
    });

    document.getElementById("volumeBtn").addEventListener("click", openVolumeMenu);

    document.getElementById("accountBtn").addEventListener("click", openAccountMenu);

    // If the portal loads while already offline, start the grace period now
    // rather than waiting for a transition that has already happened.
    if (!Session.isOnline()) onConnectionLost();

    go("home");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
