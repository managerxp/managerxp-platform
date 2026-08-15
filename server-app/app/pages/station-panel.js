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
     PANEL
     ========================================================================== */
  function open(pcName) {
    var pc = Store.getPC(pcName);
    if (!pc) { UI.toast.warn("Station not found", pcName); return; }

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

      /* --- connection --- */
      var conn = UI.el("div", { class: "card" });
      conn.innerHTML =
        '<div class="card-head"><h3>Connection</h3>' +
          '<span class="badge" data-status="' + (connected ? "online" : "offline") + '">' +
            (connected ? "Connected" : "Not connected") + "</span></div>" +
        '<div class="card-body col gap-1">' +
          '<div class="kv"><span class="kv-key">IP address</span><span class="kv-val mono selectable">' + UI.esc(pc.ip_address || "—") + "</span></div>" +
          '<div class="kv"><span class="kv-key">Port</span><span class="kv-val mono">' + UI.esc(pc.port || "—") + "</span></div>" +
          '<div class="kv"><span class="kv-key">MAC address</span><span class="kv-val mono selectable" style="font-size:11px">' + UI.esc(pc.mac_address || "—") + "</span></div>" +
          '<div class="kv"><span class="kv-key">Station ID</span><span class="kv-val mono">#' + UI.esc(pc.pc_id) + "</span></div>" +
          (cs && cs.failures ?
            '<div class="kv"><span class="kv-key">Failed attempts</span><span class="kv-val num" style="color:var(--danger)">' + UI.esc(cs.failures) + "</span></div>" : "") +
        "</div>";

      if (cs && cs.error && !connected) {
        var err = UI.el("div", { class: "card-body", style: { paddingTop: "0" } });
        err.innerHTML = '<div class="notice" data-status="error">' + Icon("alert", 16) +
          "<div><strong>Last error</strong><br>" + UI.esc(cs.error) + "</div></div>";
        conn.appendChild(err);
      }

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
      wrap.appendChild(conn);

      /* --- software / launch --- */
      var lib = UI.el("div", { class: "card" });
      lib.innerHTML =
        '<div class="card-head"><h3>Software</h3>' +
          '<button class="btn btn-ghost btn-sm" id="btnManageSw">' + Icon("settings", 14) +
          '<span class="btn-label">Manage</span></button></div>' +
        '<div class="card-body col gap-2" id="swList"></div>';
      wrap.appendChild(lib);

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
            text: "Add the applications this station can launch.",
            actions: [{
              label: "Configure software", icon: "plus", variant: "outline",
              onClick: function () {
                panel.close();
                global.CXRouter.go("games");
                if (global.CXPages.games.focusPC) global.CXPages.games.focusPC(pc.name);
              }
            }]
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

      /* --- station record --- */
      var admin = UI.el("div", { class: "card" });
      admin.innerHTML = '<div class="card-head"><h3>Station record</h3></div>';
      var adminBody = UI.el("div", { class: "card-body row gap-2 wrap" });

      var editBtn = UI.el("button", {
        class: "btn btn-outline btn-sm",
        html: Icon("edit", 14) + '<span class="btn-label">Edit details</span>'
      });
      editBtn.addEventListener("click", function () { editStation(pc, renderAll); });

      var deactivateBtn = UI.el("button", {
        class: "btn btn-danger btn-sm",
        html: Icon("power", 14) + '<span class="btn-label">Deactivate</span>',
        "data-tip": "Marks the station inactive in the database. It can be restored later."
      });
      deactivateBtn.addEventListener("click", function () {
        UI.confirm({
          title: "Deactivate " + pc.name + "?",
          message: "The station is marked inactive and stops appearing on the floor. Its record and history are kept.",
          confirmLabel: "Deactivate",
          variant: "danger"
        }).then(function (ok) {
          if (!ok) return;
          Store.deactivatePC(pc.pc_id).then(function () {
            UI.toast.ok(pc.name + " deactivated");
            panel.close();
            Store.loadPCs();
          }).catch(function (e) { UI.toast.error("Could not deactivate", e.message); });
        });
      });

      adminBody.appendChild(editBtn);
      adminBody.appendChild(deactivateBtn);
      admin.appendChild(adminBody);
      wrap.appendChild(admin);

      panel.body.appendChild(wrap);
      Motion.stagger(wrap.children, { step: 0.03, y: 10 });
    }

    function renderAll() {
      pc = Store.getPC(pcName) || pc;
      renderHead();
      renderBody();
    }

    /* ---------- live updates ---------- */
    offs.push(Store.on("connected", renderAll));
    offs.push(Store.on("connection-status", function (s) { if (s.pcName === pcName) renderAll(); }));
    offs.push(Store.on("pcs", renderAll));
    offs.push(Store.on("tick", function () {
      var run = Store.state.running[pcName];
      var t = document.getElementById("panelTimer");
      if (!run || !t) return;
      t.textContent = UI.hms(run.remaining);
      t.classList.toggle("is-warn", run.remaining <= 300 && run.remaining > 60);
      t.classList.toggle("is-danger", run.remaining <= 60);
    }));
    offs.push(Store.on("running", renderAll));

    renderAll();
    return panel;
  }

  /* ==========================================================================
     EDIT STATION  (PUT /api/pcs/:id — existing route)
     ========================================================================== */
  function editStation(pc, onSaved) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field">' +
        '<label class="field-label field-req" for="edName">Station name</label>' +
        '<input class="input" id="edName" value="' + UI.esc(pc.name) + '" data-autofocus>' +
      "</div>" +
      '<div class="field">' +
        '<label class="field-label field-req" for="edIp">IP address</label>' +
        '<input class="input mono" id="edIp" value="' + UI.esc(pc.ip_address || "") + '">' +
      "</div>" +
      '<div class="notice" data-status="info">' + Icon("info", 16) +
        "<div>Port is set when the station is registered and cannot be changed here.</div></div>";

    UI.modal({
      title: "Edit station",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Save changes", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#edName").value.trim();
            var ip = ctx.body.querySelector("#edIp").value.trim();
            if (!name || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
              Motion.shake(ctx.node);
              UI.toast.warn("Check the details", "A name and a valid IPv4 address are required.");
              return false;
            }
            return Store.updatePC(pc.pc_id, { name: name, ip_address: ip })
              .then(function () {
                UI.toast.ok("Station updated", name);
                return Store.loadPCs();
              })
              .then(function () { if (onSaved) onSaved(); return true; })
              .catch(function (e) { UI.toast.error("Update failed", e.message); return false; });
          }
        }
      ]
    });
  }

  global.CXStationPanel = { open: open, launchDialog: launchDialog, editStation: editStation };
})(window);
