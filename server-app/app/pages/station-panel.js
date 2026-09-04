/* ==========================================================================
   CafeXP — Station control panel (drawer)
   Opened from the Floor page, the Devices table and the dashboard strip.
   Every action here calls the same IPC/REST the previous UI called.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;

  var PRESETS = [15, 30, 60, 120];

  function statusLabel(s) {
    return { online: "Available", gaming: "In use", offline: "Offline", inactive: "Deactivated" }[s] || s;
  }

  /* ==========================================================================
     LAUNCH DIALOG — pick duration, then launch
     ========================================================================== */
  function launchDialog(pcName, app) {
    var body = UI.el("div", { class: "col gap-5" });
    body.innerHTML =
      '<div class="sw-row" style="background:var(--bg-inset)">' +
        '<div class="sw-icon">' + (app.icon
            ? '<img src="' + UI.esc(app.icon.indexOf("/") === 0 ? Store.API_BASE + app.icon : app.icon) + '" alt="">'
            : UI.esc((app.name || "?").charAt(0).toUpperCase())) + "</div>" +
        '<div class="grow" style="min-width:0">' +
          '<div class="sw-name">' + UI.esc(app.name) + "</div>" +
          '<div class="sw-path">' + UI.esc(app.launch || app.path || "") + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="field">' +
        '<label class="field-label">Session length</label>' +
        '<div class="preset-row" id="presetRow">' +
          PRESETS.map(function (m) {
            return '<button type="button" class="chip" data-min="' + m + '">' +
              (m >= 60 ? (m / 60) + " hour" + (m > 60 ? "s" : "") : m + " min") + "</button>";
          }).join("") +
        "</div>" +
      "</div>" +
      '<div class="field">' +
        '<label class="field-label" for="launchMinutes">Minutes</label>' +
        '<input class="input" id="launchMinutes" type="number" min="1" max="1440" value="60" data-autofocus>' +
        '<div class="field-hint">The application is closed automatically when the time runs out.</div>' +
      "</div>";

    var dialog = UI.modal({
      title: "Start on " + pcName,
      description: "Launches the application on the station and starts the countdown.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Launch", variant: "primary", icon: "play",
          onClick: function (ctx) {
            var minutes = parseInt(ctx.body.querySelector("#launchMinutes").value, 10);
            if (!minutes || minutes < 1) {
              Motion.shake(ctx.body.querySelector("#launchMinutes"));
              return false;
            }
            return Store.launchApp(pcName, app, minutes)
              .then(function () {
                UI.toast.ok(app.name + " launched", pcName + " · " + minutes + " min");
                return true;
              })
              .catch(function (e) {
                UI.toast.error("Launch failed", e.message);
                return false;
              });
          }
        }
      ]
    });

    var input = body.querySelector("#launchMinutes");
    var chips = UI.$$("#presetRow .chip", body);
    function syncChips() {
      var v = parseInt(input.value, 10);
      chips.forEach(function (c) { c.setAttribute("aria-pressed", String(parseInt(c.dataset.min, 10) === v)); });
    }
    chips.forEach(function (c) {
      c.addEventListener("click", function () { input.value = c.dataset.min; syncChips(); });
    });
    input.addEventListener("input", syncChips);
    syncChips();

    return dialog;
  }

  /* ==========================================================================
     REMOTE POWER
     The command runs on the station. The backend authorises it and writes the
     audit entry first, so an action can never happen without a record.
     ========================================================================== */
  var POWER_ACTIONS = [
    {
      /* The only action that reaches a station which is OFF. It cannot go
         through the client — there isn't one running — so it leaves as a
         Wake-on-LAN broadcast from this console. Needs the station's MAC,
         which is why it is disabled when we don't have one. */
      action: "wake", label: "Power on", icon: "power", variant: "btn-outline",
      tip: "Sends a wake signal over the network",
      confirm: "A wake signal is sent. The station needs Wake-on-LAN enabled in its BIOS.",
      offlineOnly: true
    },
    {
      action: "restart", label: "Restart", icon: "refresh", variant: "btn-warn",
      tip: "Reboots the station's Windows",
      confirm: "The station reboots. Anything unsaved on it is lost."
    },
    {
      action: "shutdown", label: "Shut down", icon: "power", variant: "btn-danger",
      tip: "Powers the station off",
      confirm: "The station powers off. Someone has to switch it back on by hand."
    },
    {
      action: "lock", label: "Lock", icon: "unlink", variant: "btn-outline",
      tip: "Locks the Windows session — nothing is closed",
      confirm: "The screen locks. Nothing is closed and no time is lost."
    },
    {
      action: "signout", label: "Sign out", icon: "logout", variant: "btn-warn",
      tip: "Signs the Windows user out, closing their applications",
      confirm: "The Windows user is signed out and their applications close."
    },
    {
      action: "restart-client", label: "Restart client", icon: "play", variant: "btn-outline",
      tip: "Restarts the CafeXP client app only — Windows keeps running",
      confirm: "Only the CafeXP client restarts. Windows and any game keep running."
    },
    /*
     * The customer cannot minimise the kiosk; the café can. These are how
     * staff reach a station's Windows desktop — to install a game, to fix a
     * driver — without walking over to it, and how they seal it again after.
     */
    {
      action: "minimize-client", label: "Minimise client", icon: "unlink", variant: "btn-outline",
      tip: "Moves the kiosk aside so the Windows desktop is reachable",
      confirm: "The client is minimised and the station's desktop becomes reachable. " +
        "Nothing about the session or the bill changes. Use Restore client to seal it again."
    },
    {
      action: "restore-client", label: "Restore client", icon: "power", variant: "btn-outline",
      tip: "Brings the kiosk back to full screen and seals it",
      confirm: "The client returns to full screen and the station is locked back down."
    }
  ];

  var DELAYS = [0, 10, 30, 60];

  function powerDialog(pc, spec, onDone) {
    /* Restarting our own app takes effect at once; a Windows action gets a
       grace period so the person at the station sees the warning first.
       Moving the kiosk window is instant too — there is nothing to warn
       about when no session, application or bill is touched. */
    var instant = ["restart-client", "lock", "minimize-client", "restore-client"]
      .indexOf(spec.action) !== -1;
    var delay = instant ? 0 : 10;

    var session = Store.state.sessions[pc.name];

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="notice" data-status="' +
        (spec.action === "shutdown" ? "offline" : "warning") + '">' + Icon("alert", 16) +
        "<div>" + UI.esc(spec.confirm) + "</div></div>" +

      (session
        ? '<div class="notice" data-status="warning">' + Icon("sessions", 16) +
          "<div><strong>" + UI.esc(session.customer_name || "A guest") + "</strong> is on this " +
          "station right now. The session keeps running on the café's side — " +
          "only the machine is affected.</div></div>"
        : "") +

      (instant
        ? ""
        : '<div class="field"><label class="field-label">Warn the station for</label>' +
          '<div class="row gap-2 wrap" id="powerDelay">' +
            DELAYS.map(function (d) {
              return '<button type="button" class="chip" data-delay="' + d + '"' +
                (d === delay ? ' aria-pressed="true"' : "") + ">" +
                (d === 0 ? "No warning" : d + "s") + "</button>";
            }).join("") +
          "</div>" +
          '<div class="field-hint">An on-screen notice appears on the station and counts down.</div></div>') +

      '<div class="field"><label class="field-label" for="powerReason">Reason</label>' +
        '<input class="input" id="powerReason" placeholder="Why this is being done" data-autofocus>' +
        '<div class="field-hint">Recorded in the audit trail against your name.</div></div>';

    if (!instant) {
      UI.$$("#powerDelay .chip", body).forEach(function (chip) {
        chip.addEventListener("click", function () {
          delay = parseInt(chip.dataset.delay, 10);
          UI.$$("#powerDelay .chip", body).forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
          });
        });
      });
    }

    return UI.modal({
      title: spec.label + " " + pc.name + "?",
      description: "This runs on the station itself.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: spec.label, variant: "danger", icon: spec.icon,
          onClick: function (ctx) {
            var reason = ctx.body.querySelector("#powerReason").value.trim();
            return Store.stationPower(pc.name, spec.action, reason, delay)
              .then(function (result) {
                UI.toast.ok(spec.label + " sent to " + pc.name,
                  delay ? "The station is warned for " + delay + "s first." : null);
                if (result.data && result.data.active_session) {
                  UI.toast.warn("A session was running",
                    result.data.active_session.playing + " is still billed — the session did not end.");
                }
                if (onDone) onDone();
                return true;
              })
              .catch(function (err) {
                UI.toast.error("Could not " + spec.label.toLowerCase(), err.message);
                return false;
              });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     CUSTOM LAUNCH — anything on the station's disk, without adding it first
     ========================================================================== */
  function customLaunchDialog(pcName) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="clPath">Path on the station</label>' +
        '<input class="input mono" id="clPath" spellcheck="false" data-autofocus ' +
          'placeholder="C:\\Program Files\\Game\\game.exe"></div>' +
      '<div class="field"><label class="field-label" for="clName">Show it as</label>' +
        '<input class="input" id="clName" placeholder="Taken from the file name">' +
        '<div class="field-hint">Only affects what staff and the customer see on screen.</div></div>' +
      '<div class="notice" data-status="warning">' + Icon("alert", 16) +
        "<div>The path is resolved on <strong>" + UI.esc(pcName) + "</strong>, not here. " +
        "A one-off launch is not saved to the station's software list — add it under " +
        "<strong>Games</strong> if you will use it again.</div></div>";

    return UI.modal({
      title: "Custom launch",
      description: "Run something that is not in this station's list.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Continue", variant: "primary", icon: "chevronR",
          onClick: function (ctx) {
            var path = ctx.body.querySelector("#clPath").value.trim();
            if (!path) {
              Motion.shake(ctx.body.querySelector("#clPath"));
              UI.toast.warn("Give the full path to the executable");
              return false;
            }
            var typed = ctx.body.querySelector("#clName").value.trim();
            // "…\\Steam\\steam.exe" -> "steam"
            var fallback = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") || "Application";
            // Hand straight to the normal launch flow so duration, the
            // countdown and auto-close all behave identically.
            launchDialog(pcName, { name: typed || fallback, launch: path, custom: true });
            return true;
          }
        }
      ]
    });
  }

  /* ==========================================================================
     PANEL
     ========================================================================== */
  function open(pcName) {
    var pc = Store.getPC(pcName);
    if (!pc) { UI.toast.warn("Station not found", pcName); return; }

    // Opening this station's own panel is staff actually looking at it —
    // the call for help has done its job.
    Store.clearHelpRequest(pcName);

    var panel = UI.drawer({ head: "", body: "", onClose: function () { unsubscribe(); } });
    var offs = [];
    function unsubscribe() { offs.forEach(function (f) { f(); }); offs = []; }

    /* ---------- head ---------- */
    function renderHead() {
      var status = Store.pcStatus(pc);
      panel.head.innerHTML =
        '<div class="row-between gap-3">' +
          "<div style='min-width:0'>" +
            '<div class="row gap-3" style="align-items:center">' +
              '<span class="page-title" style="font-size:22px">' + UI.esc(pc.name) + "</span>" +
              '<span class="badge badge-lg" data-status="' + status + '">' +
                '<span class="dot' + (status === "gaming" || status === "online" ? " dot-live" : "") + '"></span>' +
                UI.esc(statusLabel(status)) +
              "</span>" +
            "</div>" +
            '<div class="mono faint" style="font-size:12px;margin-top:4px">' +
              UI.esc(pc.ip_address || "no address") + ":" + UI.esc(pc.port || "—") +
            "</div>" +
          "</div>" +
          '<button class="modal-close" id="panelClose" aria-label="Close">' + Icon("close", 15) + "</button>" +
        "</div>";
      panel.head.querySelector("#panelClose").addEventListener("click", function () { panel.close(); });
    }

    /* ---------- body ---------- */
    function renderBody() {
      var status = Store.pcStatus(pc);
      var connected = Store.isConnected(pc.name);
      var run = Store.state.running[pc.name];
      var cs = Store.state.connectionStatus[pc.name];

      UI.clear(panel.body);
      var wrap = UI.el("div", { class: "col gap-5" });

      /* --- play session --- */
      var session = Store.sessionFor(pc.name);
      var SessionUI = global.CXSessionUI;

      if (session) {
        var paused = session.status === "paused";
        var card = UI.el("div", {
          class: "card card-pad",
          dataset: { status: paused ? "paused" : "gaming" },
          style: { background: "linear-gradient(180deg, var(--st-soft), var(--bg-raised))" }
        });
        card.innerHTML =
          '<div class="row-between" style="align-items:flex-start">' +
            "<div>" +
              '<div class="eyebrow">' + (paused ? "Paused session" : "In session") + "</div>" +
              '<div style="font-size:19px;font-weight:700;margin-top:4px">' +
                UI.esc(session.customer_name) +
                (session.is_guest ? ' <span class="badge badge-plain">Guest</span>' : "") + "</div>" +
            "</div>" +
            '<span class="badge badge-lg" data-status="' + (paused ? "paused" : "gaming") + '">' +
              UI.esc(session.status) + "</span>" +
          "</div>" +
          '<div class="timer-big" id="sessionTimer" style="margin:18px 0 4px">' +
            SessionUI.displayTime(session) + "</div>" +
          '<div class="muted" style="text-align:center;font-size:12px">' +
            SessionUI.timeLabel(session) + " · " +
            '<span id="sessionAmount">' + SessionUI.coins(session.running_amount) + "</span> XP so far" +
            " · " + SessionUI.coins(session.rate_per_hour) + " XP/hr" +
          "</div>" +
          /* Food and drink first: it is what staff reach for most while a
             session is running, and it was previously only on the sessions
             list — a page away from where anyone was actually standing. */
          '<div class="row gap-2 wrap" style="margin-top:18px">' +
            '<button class="btn btn-primary grow" id="btnSessItems">' + Icon("fnb", 15) +
              '<span class="btn-label">Add food &amp; drink</span></button>' +
          "</div>" +
          '<div class="row gap-2 wrap" style="margin-top:8px">' +
            '<button class="btn ' + (paused ? "btn-ok" : "btn-outline") + ' grow" id="btnSessPause">' +
              Icon(paused ? "play" : "pause", 15) +
              '<span class="btn-label">' + (paused ? "Resume" : "Pause") + "</span></button>" +
            '<button class="btn btn-outline grow" id="btnSessExtend">' + Icon("plus", 15) +
              '<span class="btn-label">Extend</span></button>' +
            '<button class="btn btn-outline grow" id="btnSessTransfer">' + Icon("link", 15) +
              '<span class="btn-label">Transfer</span></button>' +
            '<button class="btn btn-danger grow" id="btnSessEnd">' + Icon("stop", 15) +
              '<span class="btn-label">End</span></button>' +
          "</div>";
        wrap.appendChild(card);

        card.querySelector("#btnSessItems").addEventListener("click", function () {
          /* Opens the till with this customer and session already attached, so
             what they eat settles on the same bill as what they played. */
          panel.close();
          global.CXOpenTillForSession(session);
        });
        card.querySelector("#btnSessPause").addEventListener("click", function () {
          var call = paused ? Store.resumeSession(session) : Store.pauseSession(session);
          call.then(function () { renderAll(); })
            .catch(function (e) { UI.toast.error("Could not update the session", e.message); });
        });
        card.querySelector("#btnSessExtend").addEventListener("click", function () {
          SessionUI.extendDialog(session, renderAll);
        });
        card.querySelector("#btnSessTransfer").addEventListener("click", function () {
          SessionUI.transferDialog(session, function () { panel.close(); });
        });
        card.querySelector("#btnSessEnd").addEventListener("click", function () {
          SessionUI.endSessionDialog(session, renderAll);
        });
      } else {
        // A session can only start on a station that is connected, active and
        // free — otherwise the customer sits at a machine that never hears
        // about their session.
        var eligible = SessionUI.canStartSession(pc);

        var startCard = UI.el("div", { class: "card card-pad col gap-3" });
        startCard.innerHTML =
          '<div class="eyebrow">No session</div>' +
          '<div class="muted" style="font-size:13px;line-height:1.55">' +
            (eligible.ok
              ? "Put a customer or a guest on this station and start their clock."
              : UI.esc(eligible.reason) + ", so a session can't be started here yet.") +
          "</div>";

        var startBtn = UI.el("button", {
          class: "btn btn-primary btn-block",
          html: Icon("sessions", 16) + '<span class="btn-label">Start a session</span>',
          disabled: !eligible.ok
        });
        if (!eligible.ok) startBtn.setAttribute("data-tip", eligible.reason);
        startBtn.addEventListener("click", function () {
          SessionUI.startSessionDialog(pc.name, renderAll);
        });
        startCard.appendChild(startBtn);

        if (!eligible.ok && !connected) {
          var hint = UI.el("div", { class: "notice", dataset: { status: "warning" } });
          hint.innerHTML = Icon("alert", 16) +
            "<div>Connect the station first — use <strong>Connect</strong> below.</div>";
          startCard.appendChild(hint);
        }
        wrap.appendChild(startCard);
      }

      /* --- running application --- */
      if (run) {
        var live = UI.el("div", { class: "card card-pad", dataset: { status: "gaming" },
          style: { background: "linear-gradient(180deg, var(--info-soft), var(--bg-raised))" } });
        live.innerHTML =
          '<div class="eyebrow">Now running</div>' +
          '<div style="font-size:17px;font-weight:650;margin-top:6px">' + UI.esc(run.appName) + "</div>" +
          '<div class="timer-big" id="panelTimer" style="margin:16px 0 4px">' + UI.hms(run.remaining) + "</div>" +
          '<div class="muted" style="text-align:center;font-size:12px">' +
            (run.paused ? "Paused" : "of " + UI.hms(run.totalSeconds) + " remaining") + "</div>" +
          '<div class="row gap-2" style="margin-top:16px">' +
            '<button class="btn ' + (run.paused ? "btn-ok" : "btn-outline") + ' grow" id="btnPause">' +
              Icon(run.paused ? "play" : "pause", 15) +
              '<span class="btn-label">' + (run.paused ? "Resume" : "Pause") + "</span></button>" +
            '<button class="btn btn-outline grow" id="btnAddTime">' + Icon("plus", 15) +
              '<span class="btn-label">15 min</span></button>' +
            '<button class="btn btn-danger grow" id="btnStop">' + Icon("stop", 15) +
              '<span class="btn-label">End</span></button>' +
          "</div>";
        wrap.appendChild(live);

        live.querySelector("#btnPause").addEventListener("click", function () {
          Store.pauseTimer(pc.name, !run.paused);
          renderBody();
        });
        live.querySelector("#btnAddTime").addEventListener("click", function () {
          Store.addTime(pc.name, 15);
          UI.toast.ok("15 minutes added", pc.name);
        });
        live.querySelector("#btnStop").addEventListener("click", function () {
          UI.confirm({
            title: "End session on " + pc.name + "?",
            message: "This closes " + run.appName + " on the station.",
            confirmLabel: "End session",
            variant: "danger"
          }).then(function (ok) {
            if (!ok) return;
            Store.closeApp(pc.name).then(function (success) {
              if (success) UI.toast.ok("Session ended", pc.name);
              else UI.toast.error("Could not close the application", "The client may be disconnected.");
              renderBody();
            });
          });
        });
      }

      /*
       * A station with no address is not a computer this console talks to —
       * a pool table, a console on a big screen, a VR rig. It still has a
       * panel, because it still runs sessions and takes money; it just has no
       * connection to report and no software to launch.
       */
      var networked = Store.isNetworked(pc);

      /* --- connection --- */
      var conn = UI.el("div", { class: "card" });
      conn.innerHTML =
        '<div class="card-head"><h3>' + (networked ? "Connection" : "Station") + "</h3>" +
          '<span class="badge" data-status="' +
            (networked ? (connected ? "online" : "offline") : "online") + '">' +
            (networked ? (connected ? "Connected" : "Not connected") : "Ready") + "</span></div>" +
        '<div class="card-body col gap-1">' +
          (networked
            ? '<div class="kv"><span class="kv-key">IP address</span><span class="kv-val mono selectable">' + UI.esc(pc.ip_address || "—") + "</span></div>" +
              '<div class="kv"><span class="kv-key">Port</span><span class="kv-val mono">' + UI.esc(pc.port || "—") + "</span></div>" +
              '<div class="kv"><span class="kv-key">MAC address</span><span class="kv-val mono selectable" style="font-size:11px">' + UI.esc(pc.mac_address || "—") + "</span></div>"
            : '<div class="kv"><span class="kv-key">Type</span><span class="kv-val">Sold by the hour — no client to connect to</span></div>') +
          '<div class="kv"><span class="kv-key">Station ID</span><span class="kv-val mono">#' + UI.esc(pc.pc_id) + "</span></div>" +
          (networked && cs && cs.failures ?
            '<div class="kv"><span class="kv-key">Failed attempts</span><span class="kv-val num" style="color:var(--danger)">' + UI.esc(cs.failures) + "</span></div>" : "") +
        "</div>";

      if (networked && cs && cs.error && !connected) {
        var err = UI.el("div", { class: "card-body", style: { paddingTop: "0" } });
        err.innerHTML = '<div class="notice" data-status="error">' + Icon("alert", 16) +
          "<div><strong>Last error</strong><br>" + UI.esc(cs.error) + "</div></div>";
        conn.appendChild(err);
      }

      // Nothing to connect to, so no Connect button to offer.
      if (networked) {
        var connFoot = UI.el("div", { class: "card-foot row gap-2" });
        var retryBtn = UI.el("button", {
          class: "btn btn-outline btn-sm grow",
          html: Icon("link", 14) + '<span class="btn-label">' + (connected ? "Reconnect" : "Connect") + "</span>"
        });
        retryBtn.addEventListener("click", function () {
          UI.withBusy(retryBtn, function () {
            return Store.clearFailures(pc.name)
              .then(function () { return Store.connectToPC(pc.ip_address, pc.port, pc.name); })
              .then(function (result) {
                if (result && result.success) UI.toast.ok("Connecting to " + pc.name, result.message || "");
                else UI.toast.error("Connection failed", (result && result.error) || "Unknown error");
              })
              .catch(function (e) { UI.toast.error("Connection failed", e.message); });
          });
        });
        connFoot.appendChild(retryBtn);
        conn.appendChild(connFoot);
      }
      wrap.appendChild(conn);

      /*
       * Software and remote power are both agent-only, so they are skipped
       * for a station with no address: nothing to store a path against,
       * nothing to launch it with, and no machine to shut down.
       *
       * Scoped to these two sections rather than returning early, because
       * everything below them — editing the station's details, deleting the
       * record — applies just as much to a pool table as to a PC.
       */
      if (networked) {

      /* --- game launchers this machine has --- */
      var launchers = UI.el("div", { class: "card" });
      launchers.innerHTML =
        '<div class="card-head"><h3>Game launchers</h3>' +
          '<button class="btn btn-ghost btn-sm" id="btnRescanLaunchers">' + Icon("refresh", 14) +
          '<span class="btn-label">Re-scan</span></button></div>' +
        '<div class="card-body" id="launcherList"></div>';
      wrap.appendChild(launchers);

      function paintLaunchers() {
        var host = launchers.querySelector("#launcherList");
        if (!host) return;
        UI.clear(host);
        var rows = Store.launchersFor(pc.name);
        if (!rows) {
          host.innerHTML = '<div class="faint" style="font-size:12px">' +
            (connected
              ? "Waiting for this station to report its launchers…"
              : "The station reports its launchers when it connects.") + "</div>";
          return;
        }
        var row = UI.el("div", { class: "row gap-2 wrap" });
        rows.forEach(function (l) {
          var chip = UI.el("span", {
            class: "badge",
            title: l.path || (l.installed ? "" : "Not found on this machine")
          });
          if (l.installed) chip.setAttribute("data-status", "online");
          chip.innerHTML = UI.esc(l.name) + " " + (l.installed ? "✓" : "—");
          row.appendChild(chip);
        });
        host.appendChild(row);
      }
      /* Painted on each render; the live subscription is registered once at
         mount (below, beside the other Store listeners) rather than here,
         because renderBody runs again on every station change and would
         otherwise stack a listener per repaint. */
      paintLaunchers();

      var rescanBtn = launchers.querySelector("#btnRescanLaunchers");
      rescanBtn.disabled = !connected;
      if (!connected) rescanBtn.setAttribute("data-tip", "Station is not connected");
      rescanBtn.addEventListener("click", function () {
        UI.withBusy(rescanBtn, function () {
          return Store.refreshLaunchers(pc.name).then(function (r) {
            if (r && r.success) UI.toast.ok("Re-scanning", pc.name + " is checking its launchers.");
            else UI.toast.warn("Could not re-scan", (r && r.error) || "Station is not connected");
          });
        });
      });

      /* --- software / launch --- */
      var lib = UI.el("div", { class: "card" });
      lib.innerHTML =
        '<div class="card-head"><h3>Software</h3><div class="row gap-2">' +
          '<button class="btn btn-outline btn-sm" id="btnCustomLaunch">' + Icon("play", 14) +
          '<span class="btn-label">Custom launch</span></button>' +
          '<button class="btn btn-ghost btn-sm" id="btnManageSw">' + Icon("settings", 14) +
          '<span class="btn-label">Manage</span></button></div></div>' +
        '<div class="card-body col gap-2" id="swList"></div>';
      wrap.appendChild(lib);

      var customBtn = lib.querySelector("#btnCustomLaunch");
      customBtn.disabled = !connected || !!run;
      if (!connected) customBtn.setAttribute("data-tip", "Station is not connected");
      else if (run) customBtn.setAttribute("data-tip", "Another application is already running");
      customBtn.addEventListener("click", function () { customLaunchDialog(pc.name); });

      lib.querySelector("#btnManageSw").addEventListener("click", function () {
        panel.close();
        global.CXRouter.go("games");
        if (global.CXPages.games.focusPC) global.CXPages.games.focusPC(pc.name);
      });

      var swList = lib.querySelector("#swList");
      swList.appendChild(UI.skeletonRows(3));

      Store.getPcSoftwareViaIPC(pc.pc_id).then(function (response) {
        UI.clear(swList);
        if (!response || !response.success || !Array.isArray(response.data) || !response.data.length) {
          swList.appendChild(UI.emptyState({
            icon: "games",
            title: "No software configured",
            text: "Add the applications this station can launch, or run one directly by path.",
            actions: [
              {
                label: "Configure software", icon: "plus", variant: "outline",
                onClick: function () {
                  panel.close();
                  global.CXRouter.go("games");
                  if (global.CXPages.games.focusPC) global.CXPages.games.focusPC(pc.name);
                }
              },
              { label: "Custom launch", icon: "play", onClick: function () { customLaunchDialog(pc.name); } }
            ]
          }));
          return;
        }

        // Same shape the previous renderer produced from the API rows.
        var apps = response.data.map(function (s) {
          return {
            name: s.software_name,
            launch: s.software_path,
            icon: s.software_icon,
            video: s.software_video,
            isActive: s.is_active
          };
        });

        apps.forEach(function (app) {
          var row = UI.el("div", { class: "sw-row" });
          row.innerHTML =
            '<div class="sw-icon">' + (app.icon
              ? '<img src="' + UI.esc(app.icon.indexOf("/") === 0 ? Store.API_BASE + app.icon : app.icon) + '" alt="">'
              : UI.esc(app.name.charAt(0).toUpperCase())) + "</div>" +
            '<div class="grow" style="min-width:0">' +
              '<div class="sw-name">' + UI.esc(app.name) + "</div>" +
              '<div class="sw-path">' + UI.esc(app.launch || "No path set") + "</div>" +
            "</div>";
          var btn = UI.el("button", {
            class: "btn btn-primary btn-sm",
            html: Icon("play", 14) + '<span class="btn-label">Launch</span>',
            disabled: !app.launch || !connected || !!run
          });
          if (!connected) btn.setAttribute("data-tip", "Station is not connected");
          else if (run) btn.setAttribute("data-tip", "Another application is already running");
          btn.addEventListener("click", function () { launchDialog(pc.name, app); });
          row.appendChild(btn);
          swList.appendChild(row);
        });
        Motion.stagger(swList.children, { step: 0.02, y: 6 });
      }).catch(function (e) {
        UI.clear(swList);
        swList.appendChild(UI.errorState(e.message));
      });

      /* --- remote power --- */
      var power = UI.el("div", { class: "card" });
      power.innerHTML =
        '<div class="card-head"><h3>Power</h3>' +
          '<span class="faint" style="font-size:11px">Runs on the station, not here</span></div>';
      var powerBody = UI.el("div", { class: "card-body col gap-3" });

      if (!connected) {
        powerBody.appendChild(UI.el("div", {
          class: "notice", dataset: { status: "idle" },
          html: Icon("info", 16) +
            "<div>These need a live connection to " + UI.esc(pc.name) + ". It is not connected.</div>"
        }));
      }

      var powerRow = UI.el("div", { class: "row gap-2 wrap" });
      POWER_ACTIONS.forEach(function (spec) {
        /*
         * Power on inverts every other action's requirement. The rest need a
         * live client to receive the command; this one is FOR a station that
         * has none, so gating it on `connected` would grey it out at exactly
         * the moment it is wanted. It needs a MAC instead, since a wake packet
         * is addressed to the network card rather than to an IP.
         */
        var isWake = spec.action === "wake";
        var hasMac = !!(pc && pc.mac_address);

        var disabled = isWake ? (connected || !hasMac) : !connected;
        var tip = spec.tip;
        if (isWake && connected) tip = "This station is already on";
        else if (isWake && !hasMac) tip = "No MAC address on record — re-register this station to capture one";

        var btn = UI.el("button", {
          class: "btn btn-sm " + (spec.variant || "btn-outline"),
          html: Icon(spec.icon, 14) + '<span class="btn-label">' + spec.label + "</span>",
          disabled: disabled,
          "data-tip": tip
        });
        btn.addEventListener("click", function () { powerDialog(pc, spec, renderAll); });
        powerRow.appendChild(btn);
      });
      powerBody.appendChild(powerRow);
      power.appendChild(powerBody);
      wrap.appendChild(power);

      } // end of the agent-only sections

      /* --- station record — every station has one, PC or pool table --- */
      var admin = UI.el("div", { class: "card" });
      admin.innerHTML = '<div class="card-head"><h3>Station record</h3></div>';
      var adminBody = UI.el("div", { class: "card-body row gap-2 wrap" });

      var editBtn = UI.el("button", {
        class: "btn btn-outline btn-sm",
        html: Icon("edit", 14) + '<span class="btn-label">Edit details</span>'
      });
      editBtn.addEventListener("click", function () { editStation(pc, renderAll); });

      adminBody.appendChild(editBtn);

      /*
       * Delete used to live only inside the deactivated branch, so removing a
       * station meant deactivating it first and coming back — and most people
       * never found it. It is offered directly now. The safety is not the
       * hiding: the backend refuses to delete a station that has ever run a
       * session, so trading history cannot be erased by a click here.
       */
      function makeDeleteButton() {
        var btn = UI.el("button", {
          class: "btn btn-danger btn-sm",
          html: Icon("trash", 14) + '<span class="btn-label">Delete permanently</span>',
          "data-tip": "Removes the record. Refused if the station has any sessions."
        });
        btn.addEventListener("click", function () {
          UI.confirm({
            title: "Delete " + pc.name + " for good?",
            message: "The station record is removed and its telemetry history is cleared. " +
              "This cannot be undone. If it has ever run a session, the delete is refused " +
              "so the trading history stays intact — deactivate it instead.",
            confirmLabel: "Delete permanently",
            variant: "danger"
          }).then(function (ok) {
            if (!ok) return;
            Store.deletePC(pc.pc_id)
              .then(function () {
                UI.toast.ok(pc.name + " deleted");
                panel.close();
                return Store.loadPCs();
              })
              .catch(function (e) { UI.toast.error("Could not delete", e.message); });
          });
        });
        return btn;
      }

      // Deactivating used to be a one-way trip — there was no control to undo
      // it, so a station taken out of service could never be put back.
      if (pc.is_active === false) {
        var restoreBtn = UI.el("button", {
          class: "btn btn-ok btn-sm",
          html: Icon("check", 14) + '<span class="btn-label">Reactivate</span>',
          "data-tip": "Puts the station back into service"
        });
        restoreBtn.addEventListener("click", function () {
          UI.withBusy(restoreBtn, function () {
            return Store.restorePC(pc.pc_id)
              .then(function () {
                UI.toast.ok(pc.name + " is back in service");
                return Promise.all([Store.loadPCs(), Store.refreshPCList()]);
              })
              .then(function () { renderAll(); })
              .catch(function (e) { UI.toast.error("Could not reactivate", e.message); });
          });
        });
        adminBody.appendChild(restoreBtn);

        adminBody.appendChild(makeDeleteButton());
      } else {
        var deactivateBtn = UI.el("button", {
          class: "btn btn-danger btn-sm",
          html: Icon("power", 14) + '<span class="btn-label">Deactivate</span>',
          "data-tip": "Marks the station inactive. Reactivate from this panel later."
        });
        deactivateBtn.addEventListener("click", function () {
          UI.confirm({
            title: "Deactivate " + pc.name + "?",
            message: "The station is marked inactive and no new sessions can start on it. " +
              "Its record and history are kept, and you can reactivate it from this panel.",
            confirmLabel: "Deactivate",
            variant: "danger"
          }).then(function (ok) {
            if (!ok) return;
            Store.deactivatePC(pc.pc_id).then(function () {
              UI.toast.ok(pc.name + " deactivated", "Reactivate it from this panel when needed.");
              return Store.loadPCs();
            }).then(function () { renderAll(); })
              .catch(function (e) { UI.toast.error("Could not deactivate", e.message); });
          });
        });
        adminBody.appendChild(deactivateBtn);

        /* Also offered on a live station. Deactivate is the reversible choice
           and is listed first; delete is here so it does not require finding
           it in another state. */
        adminBody.appendChild(makeDeleteButton());
      }

      admin.appendChild(adminBody);
      wrap.appendChild(admin);

      panel.body.appendChild(wrap);
      Motion.stagger(wrap.children, { step: 0.03, y: 10 });
    }

    function renderAll() {
      pc = Store.getPC(pcName) || pc;
      renderHead();
      // renderBody rebuilds the whole panel body from scratch — restore
      // where the reader was scrolled to, or an update mid-scroll (Extend
      // finishing, another station's session changing) yanks them back to
      // the top of the panel.
      var scrollTop = panel.body.scrollTop;
      renderBody();
      panel.body.scrollTop = scrollTop;
    }

    /* ---------- live updates ---------- */
    offs.push(Store.on("connected", renderAll));
    offs.push(Store.on("connection-status", function (s) { if (s.pcName === pcName) renderAll(); }));
    offs.push(Store.on("pcs", renderAll));
    /* A station reported its launchers — repaint so the ticks appear without
       the panel being reopened. Registered once here, not inside renderBody. */
    offs.push(Store.on("launchers", function () { renderAll(); }));
    offs.push(Store.on("tick", function () {
      var run = Store.state.running[pcName];
      var t = document.getElementById("panelTimer");
      if (!run || !t) return;
      t.textContent = UI.hms(run.remaining);
      t.classList.toggle("is-warn", run.remaining <= 300 && run.remaining > 60);
      t.classList.toggle("is-danger", run.remaining <= 60);
    }));
    /*
     * "running" and "sessions" are broadcast for the whole café — every
     * station's launch/session state lives in one shared object, and the
     * event fires whenever ANY of them changes, not just this panel's own
     * pcName. Re-rendering unconditionally meant this panel rebuilt itself
     * — losing scroll position and flickering the buttons under the
     * pointer — every time a completely different station started, paused
     * or ended a session, and again right after this panel's own buttons
     * did the same thing (which fires the identical broadcast).
     *
     * Both dictionaries are only ever updated by replacing the entry for
     * the station that actually changed (see afterSessionChange /
     * pauseSession's optimistic update), so a reference check tells "my
     * station moved" apart from "someone else's did" without needing the
     * event to carry a pcName itself.
     */
    var lastRun = Store.state.running[pcName];
    var lastSession = Store.sessionFor(pcName);
    offs.push(Store.on("running", function () {
      var run = Store.state.running[pcName];
      if (run === lastRun) return;
      lastRun = run;
      renderAll();
    }));
    offs.push(Store.on("sessions", function () {
      var session = Store.sessionFor(pcName);
      if (session === lastSession) return;
      lastSession = session;
      renderAll();
    }));
    offs.push(Store.on("session-tick", function () {
      var s = Store.sessionFor(pcName);
      var t = document.getElementById("sessionTimer");
      var a = document.getElementById("sessionAmount");
      if (!s || !t) return;
      t.textContent = global.CXSessionUI.displayTime(s);
      t.classList.toggle("is-warn", s.remaining_seconds !== null && s.remaining_seconds <= 300 && s.remaining_seconds > 60);
      t.classList.toggle("is-danger", s.remaining_seconds !== null && s.remaining_seconds <= 60);
      if (a) a.textContent = global.CXSessionUI.coins(s.running_amount);
    }));

    renderAll();
    return panel;
  }

  /* ==========================================================================
     EDIT STATION  (PUT /api/pcs/:id — existing route)
     ========================================================================== */
  function editStation(pc, onSaved) {
    /* A networked station is one that has an address. A pool table has none,
       and demanding an IPv4 for it — as this dialog used to — made every
       non-networked station uneditable. */
    var networked = !!pc.ip_address;

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field">' +
        '<label class="field-label field-req" for="edName">Station name</label>' +
        '<input class="input" id="edName" value="' + UI.esc(pc.name) + '" data-autofocus>' +
      "</div>" +
      '<div class="field">' +
        '<label class="field-label field-req" for="edCategory">Station type</label>' +
        '<select class="input" id="edCategory"><option value="">— Select type —</option></select>' +
      "</div>" +
      '<div class="field hidden" id="edCustomWrap">' +
        '<label class="field-label" for="edCustomType">New type</label>' +
        '<input class="input" id="edCustomType" placeholder="Bowling">' +
      "</div>" +
      (networked
        ? '<div class="field">' +
            '<label class="field-label field-req" for="edIp">IP address</label>' +
            '<input class="input mono" id="edIp" value="' + UI.esc(pc.ip_address) + '">' +
          "</div>"
        : "") +
      '<div class="notice" data-status="info">' + Icon("info", 16) +
        "<div>The type decides which prices this station is offered — a PC is " +
        "only ever shown PC prices." +
        (networked ? " Port is set when the station is registered and cannot be changed here." : "") +
        "</div></div>";

    var typeSelect = body.querySelector("#edCategory");
    var customWrap = body.querySelector("#edCustomWrap");
    var customInput = body.querySelector("#edCustomType");

    /* The same list the "Add station" dialog offers, from the same helper —
       the two must not disagree about what this café's types are. */
    function paintTypes(types) {
      var known = types.slice();
      if (pc.category && known.indexOf(pc.category) === -1) known.push(pc.category);
      typeSelect.innerHTML =
        '<option value="">— Select type —</option>' +
        known.sort().map(function (c) {
          return '<option value="' + UI.esc(c) + '"' +
            (c === pc.category ? " selected" : "") + ">" + UI.esc(c) + "</option>";
        }).join("") +
        '<option value="__other">Other…</option>';
    }
    paintTypes(pc.category ? [pc.category] : []);
    global.CXRates.stationTypes().then(paintTypes);

    typeSelect.addEventListener("change", function () {
      var other = typeSelect.value === "__other";
      customWrap.classList.toggle("hidden", !other);
      if (other) customInput.focus();
    });

    UI.modal({
      title: "Edit station",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Save changes", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#edName").value.trim();
            var ipField = ctx.body.querySelector("#edIp");
            var ip = ipField ? ipField.value.trim() : null;
            var type = typeSelect.value === "__other"
              ? customInput.value.trim()
              : typeSelect.value;

            if (!name) {
              Motion.shake(ctx.body.querySelector("#edName"));
              UI.toast.warn("Name the station");
              return false;
            }
            if (!type) {
              Motion.shake(typeSelect.value === "__other" ? customInput : typeSelect);
              UI.toast.warn("Choose a type", "PS5, Pool, PC — it decides the station's prices.");
              return false;
            }
            if (ipField && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
              Motion.shake(ipField);
              UI.toast.warn("Check the address", "A networked station needs a valid IPv4 address.");
              return false;
            }

            var payload = { name: name, category: type };
            if (ipField) payload.ip_address = ip;

            return Store.updatePC(pc.pc_id, payload)
              .then(function () {
                UI.toast.ok("Station updated", name + " · " + type);
                return Store.loadPCs();
              })
              .then(function () { if (onSaved) onSaved(); return true; })
              /* The server refuses with 409 when the plan's cap for that type
                 is full — that message already says which, so surface it. */
              .catch(function (e) { UI.toast.error("Update failed", e.message); return false; });
          }
        }
      ]
    });
  }

  global.CXStationPanel = {
    open: open,
    launchDialog: launchDialog,
    customLaunchDialog: customLaunchDialog,
    editStation: editStation
  };
})(window);
