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
     LAYOUT
     A café is rarely one undifferentiated room, so the wall can be arranged to
     match it. The choice lives in app_settings, not localStorage, so every
     terminal at the counter shows the same floor.
     ========================================================================== */
  var LAYOUTS = [
    { id: "grid",  label: "Grid",    icon: "grid",  hint: "Even wall of cards — good for one open room." },
    { id: "rows",  label: "Rows",    icon: "panel", hint: "Fixed-width rows, like aisles of machines." },
    { id: "zones", label: "Zones",   icon: "floor", hint: "Grouped by area — VIP, consoles, main hall." },
    { id: "list",  label: "Compact", icon: "list",  hint: "Dense list — the most stations on one screen." }
  ];
  var SIZES = [
    { id: "compact", label: "S" },
    { id: "normal",  label: "M" },
    { id: "large",   label: "L" }
  ];

  var layout = "grid";
  var cardSize = "normal";
  var zones = [];
  var zonesLoaded = false;

  function zoneOf(pc) {
    if (pc.zone_id === null || pc.zone_id === undefined) return null;
    return zones.filter(function (z) { return z.zone_id === pc.zone_id; })[0] || null;
  }

  /** Read the café's saved arrangement; falls back silently to the grid. */
  function loadLayout() {
    return Promise.all([
      Store.getSettings("floor").catch(function () { return []; }),
      Store.listZones().catch(function () { return []; })
    ]).then(function (res) {
      res[0].forEach(function (s) {
        if (s.setting_key === "floor.layout" && LAYOUTS.some(function (l) { return l.id === s.setting_value; })) {
          layout = s.setting_value;
        }
        if (s.setting_key === "floor.card_size" && SIZES.some(function (z) { return z.id === s.setting_value; })) {
          cardSize = s.setting_value;
        }
      });
      zones = res[1];
      zonesLoaded = true;
    });
  }

  function saveLayout(key, value) {
    return Store.setSetting(key, value).catch(function (e) {
      // The floor still rearranges on screen; only the sharing failed.
      UI.toast.warn("Not saved for other terminals", e.message);
    });
  }

  /* ==========================================================================
     STATION CARD
     ========================================================================== */
  /* ==========================================================================
     SELECTION

     Doing the same thing to twenty stations one card at a time is the job this
     page exists to avoid, so the floor supports picking several and acting on
     the set. Selection lives here rather than on the cards, because a repaint
     rebuilds every card and anything held on them would be lost mid-selection.
     ========================================================================== */
  var selected = {};          // pc name -> true
  var selectMode = false;

  function selectedNames() { return Object.keys(selected); }
  function selectedCount() { return selectedNames().length; }

  function toggleSelect(name, on) {
    if (on === undefined) on = !selected[name];
    if (on) selected[name] = true; else delete selected[name];
    paintBulkBar();
    var card = rootEl && rootEl.querySelector('.station[data-pc="' + CSS.escape(name) + '"]');
    if (card) card.classList.toggle("is-picked", !!selected[name]);
  }

  function clearSelection() {
    selected = {};
    if (rootEl) {
      rootEl.querySelectorAll(".station.is-picked").forEach(function (c) {
        c.classList.remove("is-picked");
      });
    }
    paintBulkBar();
  }

  /* Actions offered on a set. `wake` is deliberately first and separate: it is
     the only one that makes an offline station useful, and the only one that
     is not destructive. */
  var BULK_ACTIONS = [
    { action: "wake", label: "Power on", icon: "power", variant: "btn-outline",
      needsOnline: false,
      confirm: "A wake signal is sent to each selected station. Ones already on ignore it." },
    { action: "restart", label: "Restart", icon: "refresh", variant: "btn-warn",
      needsOnline: true,
      confirm: "Each selected station reboots. Anything unsaved on them is lost." },
    { action: "shutdown", label: "Shut down", icon: "power", variant: "btn-danger",
      needsOnline: true,
      confirm: "Each selected station powers off. Someone has to switch them back on, or use Power on." },
    { action: "signout", label: "Sign out", icon: "logout", variant: "btn-warn",
      needsOnline: true,
      confirm: "The Windows user is signed out on each selected station and their applications close." },
    { action: "restart-client", label: "Restart client", icon: "play", variant: "btn-outline",
      needsOnline: true,
      confirm: "Only the CafeXP client restarts. Windows and any game keep running." }
  ];

  function runBulk(spec) {
    var names = selectedNames();
    if (!names.length) return;

    /* A station mid-session is the one thing worth stopping for. Named
       explicitly, because "3 stations are busy" is actionable and "are you
       sure?" is not. */
    var busy = names.filter(function (n) { return !!Store.sessionFor(n); });
    var offline = names.filter(function (n) { return !Store.isConnected(n); });

    var warning = "";
    if (spec.needsOnline && offline.length) {
      warning += "<div class=\"notice\" data-status=\"warning\">" + Icon("alert", 15) +
        "<div><strong>" + offline.length + " offline</strong> — " +
        UI.esc(offline.slice(0, 4).join(", ")) + (offline.length > 4 ? "…" : "") +
        ". These cannot be reached and will be reported as failed.</div></div>";
    }
    if (busy.length) {
      warning += "<div class=\"notice\" data-status=\"offline\">" + Icon("alert", 15) +
        "<div><strong>" + busy.length + " mid-session</strong> — " +
        UI.esc(busy.slice(0, 4).join(", ")) + (busy.length > 4 ? "…" : "") +
        ". A customer is playing on " + (busy.length === 1 ? "this one" : "these") + ".</div></div>";
    }

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      warning +
      "<p>" + UI.esc(spec.confirm) + "</p>" +
      '<div class="bulk-targets">' +
        names.map(function (n) {
          return '<span class="tag" data-tone="' +
            (Store.sessionFor(n) ? "warn" : Store.isConnected(n) ? "ok" : "muted") + '">' +
            UI.esc(n) + "</span>";
        }).join("") +
      "</div>" +
      '<div class="field"><label class="field-label" for="bulkReason">Reason</label>' +
        '<input class="input" id="bulkReason" placeholder="Why this is being done" data-autofocus>' +
        '<div class="field-hint">Recorded against your name for every station in the set.</div></div>' +
      '<div id="bulkProgress" class="faint"></div>';

    UI.modal({
      title: spec.label + " " + names.length + " station" + (names.length === 1 ? "" : "s"),
      description: "Sent one at a time, so a failure on one does not stop the rest.",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: spec.label, variant: spec.action === "shutdown" ? "danger" : "primary",
          icon: spec.icon,
          onClick: function (ctx) {
            var reason = ctx.body.querySelector("#bulkReason").value.trim();
            if (!reason) {
              Motion.shake(ctx.body.querySelector("#bulkReason"));
              UI.toast.warn("A reason is required");
              return false;
            }

            var progress = ctx.body.querySelector("#bulkProgress");
            return Store.stationPowerMany(names, spec.action, reason, 10, function (done, total, last) {
              progress.innerHTML = done + " of " + total + " — " +
                UI.esc(last.pc_name) + (last.ok ? " ok" : " failed: " + UI.esc(last.error || ""));
            }).then(function (results) {
              var good = results.filter(function (r) { return r.ok; }).length;
              var bad = results.length - good;

              if (bad === 0) {
                UI.toast.ok(spec.label + " sent", good + " station" + (good === 1 ? "" : "s"));
              } else {
                /* Partial success is the normal outcome with offline
                   stations, so it is reported as a count rather than as a
                   failure — and the failures are named. */
                UI.toast.warn(good + " of " + results.length + " succeeded",
                  results.filter(function (r) { return !r.ok; })
                    .map(function (r) { return r.pc_name; }).join(", "));
              }
              clearSelection();
              return true;
            });
          }
        }
      ]
    });
  }

  function paintBulkBar() {
    var bar = rootEl && rootEl.querySelector("#floorBulk");
    if (!bar) return;

    var count = selectedCount();
    bar.classList.toggle("hidden", count === 0);
    if (!count) return;

    UI.clear(bar);

    var label = UI.el("div", { class: "bulk-count" });
    label.innerHTML = "<strong>" + count + "</strong> selected";
    bar.appendChild(label);

    BULK_ACTIONS.forEach(function (spec) {
      bar.appendChild(UI.el("button", {
        class: "btn btn-sm " + spec.variant, type: "button",
        html: Icon(spec.icon, 14) + '<span class="btn-label">' + spec.label + "</span>",
        onClick: function () { runBulk(spec); }
      }));
    });

    bar.appendChild(UI.el("button", {
      class: "btn btn-sm btn-ghost", type: "button",
      html: Icon("close", 14) + '<span class="btn-label">Clear</span>',
      onClick: clearSelection
    }));
  }

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

    var session = Store.sessionFor(pc.name);
    var SessionUI = global.CXSessionUI;

    var middle;
    if (session) {
      // A real play session outranks the launch timer as the card's headline.
      middle =
        '<div class="station-headline">' + UI.esc(session.customer_name) +
          (session.is_guest ? ' <span class="badge badge-plain">Guest</span>' : "") + "</div>" +
        '<div class="station-timer" data-session-timer="' + UI.esc(pc.name) + '">' +
          SessionUI.displayTime(session) + "</div>" +
        '<div class="station-subline">' +
          (session.status === "paused" ? "Paused" : SessionUI.timeLabel(session)) +
          " · " + SessionUI.coins(session.running_amount) + " XP" +
        "</div>";
    } else if (run) {
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
    if (session) {
      if (session.status === "paused") {
        quick.appendChild(quickBtn("play", "Resume session", function (e) {
          e.stopPropagation();
          Store.resumeSession(session)
            .then(function () { UI.toast.ok("Resumed", pc.name); })
            .catch(function (err) { UI.toast.error("Could not resume", err.message); });
        }));
      } else {
        quick.appendChild(quickBtn("pause", "Pause session", function (e) {
          e.stopPropagation();
          Store.pauseSession(session)
            .then(function () { UI.toast.ok("Paused", pc.name); })
            .catch(function (err) { UI.toast.error("Could not pause", err.message); });
        }));
      }
      quick.appendChild(quickBtn("stop", "End session", function (e) {
        e.stopPropagation();
        SessionUI.endSessionDialog(session);
      }));
    } else if (canStartSession(pc).ok) {
      quick.appendChild(quickBtn("sessions", "Start a session", function (e) {
        e.stopPropagation();
        SessionUI.startSessionDialog(pc.name);
      }));
    }

    if (status === "inactive") {
      // A deactivated station has no other useful action, so put the way back
      // right on the card rather than only inside the panel.
      quick.appendChild(quickBtn("check", "Reactivate this station", function (e) {
        e.stopPropagation();
        Store.restorePC(pc.pc_id)
          .then(function () {
            UI.toast.ok(pc.name + " is back in service");
            return Promise.all([Store.loadPCs(), Store.refreshPCList()]);
          })
          .catch(function (err) { UI.toast.error("Could not reactivate", err.message); });
      }));
    } else if (!session) {
      // Launch-timer and connection actions only matter when no session owns
      // the station; otherwise the session controls above take the slot.
      if (run) {
        quick.appendChild(quickBtn("stop", "Close application", function (e) {
          e.stopPropagation();
          UI.confirm({
            title: "Close " + run.appName + " on " + pc.name + "?",
            message: "This stops the application on the station.",
            confirmLabel: "Close application", variant: "danger"
          }).then(function (ok) {
            if (ok) Store.closeApp(pc.name).then(function (s) {
              if (s) UI.toast.ok("Application closed", pc.name);
              else UI.toast.error("Could not close the application", "The client may be disconnected.");
            });
          });
        }));
      } else if (status !== "online") {
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
    }
    quick.appendChild(quickBtn("panel", "Open control panel", function (e) {
      e.stopPropagation();
      global.CXStationPanel.open(pc.name);
    }));

    /* The picker. Always present but only visible in select mode, so turning
       selection on does not reflow every card and lose the reader's place. */
    var pick = UI.el("label", { class: "station-pick" });
    pick.innerHTML = '<input type="checkbox" class="check"' +
      (selected[pc.name] ? " checked" : "") + ' aria-label="Select ' + UI.esc(pc.name) + '">';
    pick.addEventListener("click", function (e) { e.stopPropagation(); });
    pick.querySelector("input").addEventListener("change", function (e) {
      toggleSelect(pc.name, e.target.checked);
    });
    card.appendChild(pick);
    if (selected[pc.name]) card.classList.add("is-picked");

    card.addEventListener("click", function () {
      // In select mode the whole card is a checkbox; otherwise it opens the
      // panel as it always has.
      if (selectMode) { toggleSelect(pc.name); return; }
      global.CXStationPanel.open(pc.name);
    });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (selectMode) toggleSelect(pc.name);
        else global.CXStationPanel.open(pc.name);
      }
    });

    return card;
  }

  function canStartSession(pc) {
    return global.CXSessionUI.canStartSession(pc);
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

  /* ==========================================================================
     ZONES — naming the parts of the room, and putting stations in them
     ========================================================================== */
  function zoneForm(existing) {
    var isEdit = !!existing;
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="znName">Zone name</label>' +
        '<input class="input" id="znName" placeholder="VIP Room" value="' +
          UI.esc(existing ? existing.zone_name : "") + '" data-autofocus></div>' +
      '<div class="field"><label class="field-label" for="znDesc">Description</label>' +
        '<input class="input" id="znDesc" placeholder="Booth seating, premium rigs" value="' +
          UI.esc(existing && existing.description ? existing.description : "") + '"></div>' +
      '<div class="field"><label class="field-label">Accent</label>' +
        '<div class="row gap-2 wrap" id="znAccent">' +
          [["accent", "Red"], ["online", "Green"], ["gaming", "Blue"],
           ["warning", "Amber"], ["idle", "Grey"]].map(function (a) {
            return '<button type="button" class="chip" data-accent="' + a[0] + '" data-status="' + a[0] + '"' +
              (((existing && existing.accent) || "accent") === a[0] ? ' aria-pressed="true"' : "") +
              '><span class="legend-swatch"></span>' + a[1] + "</button>";
          }).join("") +
        "</div></div>";

    var accent = (existing && existing.accent) || "accent";
    UI.$$("#znAccent .chip", body).forEach(function (chip) {
      chip.addEventListener("click", function () {
        accent = chip.dataset.accent;
        UI.$$("#znAccent .chip", body).forEach(function (c) {
          c.setAttribute("aria-pressed", String(c === chip));
        });
      });
    });

    return UI.modal({
      title: isEdit ? "Edit zone" : "Add zone",
      description: "Zones only change how the floor is displayed — nothing about pricing or sessions.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isEdit ? "Save zone" : "Add zone", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#znName").value.trim();
            if (!name) {
              Motion.shake(ctx.body.querySelector("#znName"));
              UI.toast.warn("A zone name is required");
              return false;
            }
            var payload = {
              zone_name: name,
              description: ctx.body.querySelector("#znDesc").value.trim() || null,
              accent: accent
            };
            var call = isEdit ? Store.updateZone(existing.zone_id, payload) : Store.createZone(payload);
            return call
              .then(function (r) { UI.toast.ok(r.message, name); return refreshZones(); })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not save", err.message); return false; });
          }
        }
      ]
    });
  }

  function refreshZones() {
    return Store.listZones().then(function (list) {
      zones = list;
      zonesLoaded = true;
      renderGrid();
    });
  }

  /** One dialog to name the zones and drop every station into one. */
  function arrangeDialog() {
    var draft = {};
    Store.state.pcs.forEach(function (pc) { draft[pc.pc_id] = pc.zone_id || null; });

    var body = UI.el("div", { class: "col gap-5" });
    body.innerHTML =
      '<div class="row-between">' +
        "<div><div class='eyebrow'>Zones</div>" +
          '<div class="faint" style="font-size:11px;margin-top:2px">' +
            "Name the parts of your café, then put each station in one." +
          "</div></div>" +
        '<button type="button" class="btn btn-outline btn-sm" id="znAdd"></button>' +
      "</div>" +
      '<div id="znList" class="col gap-2"></div>' +
      '<div><div class="eyebrow" style="margin-bottom:var(--s-3)">Stations</div>' +
        '<div id="znStations" class="col gap-2" style="max-height:300px;overflow:auto"></div></div>';

    var addBtn = body.querySelector("#znAdd");
    addBtn.innerHTML = Icon("plus", 13) + '<span class="btn-label">Add zone</span>';
    addBtn.addEventListener("click", function () { zoneForm(null); paintLater(); });

    // The zone form is a modal of its own; repaint once it has had time to
    // save rather than reaching into its lifecycle.
    function paintLater() { setTimeout(paint, 600); }

    function paint() {
      var znList = body.querySelector("#znList");
      UI.clear(znList);

      if (!zones.length) {
        znList.innerHTML =
          '<div class="notice" data-status="info">' + Icon("info", 16) +
          "<div>No zones yet. Add one — “VIP Room”, “Console Corner”, “Main Hall” — " +
          "and the floor groups itself.</div></div>";
      }

      zones.forEach(function (zone) {
        var row = UI.el("div", { class: "kv row-between", dataset: { status: zone.accent } });
        row.innerHTML =
          '<span class="row gap-3" style="min-width:0">' +
            '<span class="legend-swatch"></span>' +
            "<span style='min-width:0'>" +
              '<span style="display:block;font-size:13px;font-weight:650">' + UI.esc(zone.zone_name) + "</span>" +
              '<span class="faint" style="font-size:11px">' +
                (zone.description ? UI.esc(zone.description) + " · " : "") +
                zone.station_count + " station(s)</span>" +
            "</span>" +
          "</span>";

        var actions = UI.el("span", { class: "row gap-2" });
        var edit = UI.el("button", {
          type: "button", class: "btn btn-outline btn-sm btn-icon",
          html: Icon("edit", 13), "data-tip": "Edit"
        });
        edit.addEventListener("click", function () { zoneForm(zone); paintLater(); });

        var del = UI.el("button", {
          type: "button", class: "btn btn-danger btn-sm btn-icon",
          html: Icon("trash", 13), "data-tip": "Delete zone"
        });
        del.addEventListener("click", function () {
          UI.confirm({
            title: "Delete " + zone.zone_name + "?",
            message: zone.station_count
              ? zone.station_count + " station(s) move back to Unassigned. Nothing else changes."
              : "This cannot be undone.",
            confirmLabel: "Delete", variant: "danger"
          }).then(function (ok) {
            if (!ok) return;
            Store.deleteZone(zone.zone_id)
              .then(function (r) {
                UI.toast.ok(r.message);
                Object.keys(draft).forEach(function (id) {
                  if (draft[id] === zone.zone_id) draft[id] = null;
                });
                return refreshZones();
              })
              .then(paint)
              .catch(function (e) { UI.toast.error("Could not delete", e.message); });
          });
        });

        actions.appendChild(edit);
        actions.appendChild(del);
        row.appendChild(actions);
        znList.appendChild(row);
      });

      var host = body.querySelector("#znStations");
      UI.clear(host);
      Store.state.pcs.forEach(function (pc) {
        var row = UI.el("div", { class: "kv row-between" });
        row.innerHTML =
          '<span class="row gap-3" style="min-width:0">' +
            '<span class="dot" data-status="' + Store.pcStatus(pc) + '"></span>' +
            "<strong style='font-size:13px'>" + UI.esc(pc.name) + "</strong>" +
            '<span class="faint mono" style="font-size:10px">' + UI.esc(pc.ip_address || "") + "</span>" +
          "</span>";

        var select = UI.el("select", { class: "select", style: { width: "190px" } });
        select.innerHTML =
          '<option value="">Unassigned</option>' +
          zones.map(function (z) {
            return '<option value="' + z.zone_id + '"' +
              (draft[pc.pc_id] === z.zone_id ? " selected" : "") + ">" + UI.esc(z.zone_name) + "</option>";
          }).join("");
        select.addEventListener("change", function () {
          draft[pc.pc_id] = select.value ? parseInt(select.value, 10) : null;
        });

        row.appendChild(select);
        host.appendChild(row);
      });
    }

    paint();

    return UI.modal({
      title: "Arrange the floor",
      description: "Zones and which station sits in each.",
      size: "lg",
      body: body,
      actions: [
        { label: "Close", variant: "ghost" },
        {
          label: "Save arrangement", variant: "primary", icon: "check",
          onClick: function () {
            var assignments = Store.state.pcs.map(function (pc, i) {
              return { pc_id: pc.pc_id, zone_id: draft[pc.pc_id], floor_order: i };
            });
            if (!assignments.length) { UI.toast.warn("No stations to arrange"); return false; }
            return Store.assignStations(assignments)
              .then(function (r) {
                UI.toast.ok(r.message);
                // The station records now carry zone_id — reload so the wall
                // regroups from the same data the server has.
                return Promise.all([Store.loadPCs(), refreshZones()]);
              })
              .then(function () {
                if (layout !== "zones") {
                  layout = "zones";
                  saveLayout("floor.layout", "zones");
                  renderPageChrome();
                  renderGrid();
                }
                return true;
              })
              .catch(function (e) { UI.toast.error("Could not save", e.message); return false; });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     GRID
     ========================================================================== */
  /** Cards, grouped by zone, appended to `host`. Returns the nodes made. */
  function appendCards(host, list, showDiscovered) {
    var made = [];
    list.forEach(function (pc) { var c = stationCard(pc); host.appendChild(c); made.push(c); });
    if (showDiscovered) {
      Store.state.discovered.forEach(function (d) { var c = discoveredCard(d); host.appendChild(c); made.push(c); });
    }
    return made;
  }

  function renderZoned(grid, list, showDiscovered) {
    var made = [];
    var buckets = [];

    zones.forEach(function (zone) {
      buckets.push({
        zone: zone,
        pcs: list.filter(function (pc) { return pc.zone_id === zone.zone_id; })
      });
    });
    var loose = list.filter(function (pc) { return !zoneOf(pc); });
    if (loose.length || showDiscovered) {
      buckets.push({ zone: null, pcs: loose });
    }

    buckets.forEach(function (bucket) {
      // An empty named zone still shows — it is a place in the room, and
      // hiding it would look like the zone had been deleted.
      var section = UI.el("div", { class: "floor-zone", dataset: { status: bucket.zone ? bucket.zone.accent : "idle" } });
      section.innerHTML =
        '<div class="floor-zone-head">' +
          '<span class="legend-swatch"></span>' +
          '<span class="floor-zone-name">' +
            UI.esc(bucket.zone ? bucket.zone.zone_name : "Unassigned") + "</span>" +
          '<span class="badge">' + bucket.pcs.length + "</span>" +
          (bucket.zone && bucket.zone.description
            ? '<span class="faint" style="font-size:11px">' + UI.esc(bucket.zone.description) + "</span>"
            : "") +
        "</div>";

      var inner = UI.el("div", { class: "grid grid-stations" });
      if (!bucket.pcs.length && !(bucket.zone === null && showDiscovered)) {
        inner.className = "";
        inner.innerHTML = '<div class="faint" style="font-size:12px;padding:var(--s-3) 0">' +
          "No stations here yet — put some in from <strong>Arrange</strong>.</div>";
      } else {
        made = made.concat(appendCards(inner, bucket.pcs, bucket.zone === null && showDiscovered));
      }
      section.appendChild(inner);
      grid.appendChild(section);
    });

    return made;
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
    grid.setAttribute("data-size", cardSize);

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

    var made;
    if (layout === "zones" && zonesLoaded) {
      grid.className = "floor-zones";
      made = renderZoned(grid, list, showDiscovered);
    } else {
      // Grid, rows and compact are the same cards under different track rules,
      // so the card itself never has to know which layout is in force.
      grid.className = { rows: "floor-rows", list: "floor-compact" }[layout] || "grid grid-stations";
      made = appendCards(grid, list, showDiscovered);
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

    UI.$$("#floorLayout button", rootEl).forEach(function (btn) {
      btn.setAttribute("aria-selected", String(btn.dataset.layout === layout));
    });
    UI.$$("#floorSize button", rootEl).forEach(function (btn) {
      btn.setAttribute("aria-selected", String(btn.dataset.size === cardSize));
    });
  }

  /* Update just the timers each second — re-rendering the whole grid every
     tick would fight the user's hover and scroll. */
  function tickTimers() {
    if (!rootEl) return;

    Object.keys(Store.state.sessions).forEach(function (name) {
      var el = rootEl.querySelector('[data-session-timer="' + CSS.escape(name) + '"]');
      if (!el) return;
      var s = Store.state.sessions[name];
      el.textContent = global.CXSessionUI.displayTime(s);
      var low = s.remaining_seconds !== null && s.remaining_seconds <= 300;
      var critical = s.remaining_seconds !== null && s.remaining_seconds <= 60;
      el.classList.toggle("is-ending", low && !critical);
      el.classList.toggle("is-critical", critical);
    });

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
            '<button class="btn btn-outline" id="btnSelectMode">' + Icon("list", 15) +
              '<span class="btn-label">Select</span></button>' +
            '<button class="btn btn-primary" id="btnAddStation">' + Icon("plus", 15) +
              '<span class="btn-label">Add station</span></button>' +
          "</div>" +
        "</div>" +

        /* Appears only once something is picked, so the floor is not carrying
           an empty toolbar the rest of the time. */
        '<div class="bulk-bar hidden" id="floorBulk"></div>' +

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
          '<div class="segmented" id="floorLayout">' +
            LAYOUTS.map(function (l) {
              return '<button type="button" data-layout="' + l.id + '" data-tip="' + UI.esc(l.hint) + '">' +
                Icon(l.icon, 14) + '<span class="btn-label">' + l.label + "</span></button>";
            }).join("") +
          "</div>" +
          '<div class="segmented" id="floorSize">' +
            SIZES.map(function (s) {
              return '<button type="button" data-size="' + s.id + '" data-tip="' + s.id + ' cards">' +
                s.label + "</button>";
            }).join("") +
          "</div>" +
          '<button class="btn btn-outline" id="btnArrange">' + Icon("settings", 15) +
            '<span class="btn-label">Arrange</span></button>' +
        "</div>" +

        '<div class="legend" style="margin-bottom:var(--s-4)">' +
          '<span class="legend-item" data-status="online"><span class="legend-swatch"></span>Available</span>' +
          '<span class="legend-item" data-status="gaming"><span class="legend-swatch"></span>In use</span>' +
          '<span class="legend-item" data-status="offline"><span class="legend-swatch"></span>Offline</span>' +
          '<span class="legend-item" data-status="maintenance"><span class="legend-swatch"></span>Unregistered</span>' +
        "</div>" +

        '<div id="stationGrid" class="grid grid-stations"></div>';

      root.appendChild(page);

      page.querySelector("#btnAddStation").addEventListener("click", addStationDialog);

      /* Select mode. Toggled rather than always-on: the floor is mostly used
         to glance at one station, and permanent checkboxes on every card make
         that noisier for the common case. */
      var selectBtn = page.querySelector("#btnSelectMode");
      selectBtn.addEventListener("click", function () {
        selectMode = !selectMode;
        page.classList.toggle("is-selecting", selectMode);
        selectBtn.setAttribute("aria-pressed", String(selectMode));
        selectBtn.querySelector(".btn-label").textContent = selectMode ? "Done" : "Select";
        if (!selectMode) clearSelection();
        /* No repaint. The checkboxes are already in the DOM — hidden by CSS —
           so entering select mode is a class change the compositor can
           animate. Rebuilding every card here was the jank: it threw away and
           recreated the whole grid for a purely visual state change. */
      });
      var refreshBtn = page.querySelector("#btnRefreshFloor");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () {
          return Promise.all([Store.loadPCs(), Store.refreshPCList(), Store.syncConnected()])
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

      UI.$$("#floorLayout button", page).forEach(function (btn) {
        btn.addEventListener("click", function () {
          layout = btn.dataset.layout;
          renderPageChrome();
          renderGrid();
          saveLayout("floor.layout", layout);
          // Zones only mean something once some exist — say so instead of
          // showing one empty "Unassigned" group and letting it look broken.
          if (layout === "zones" && !zones.length) {
            UI.toast.info("No zones yet", "Use Arrange to name the parts of your café.");
          }
        });
      });

      UI.$$("#floorSize button", page).forEach(function (btn) {
        btn.addEventListener("click", function () {
          cardSize = btn.dataset.size;
          renderPageChrome();
          renderGrid();
          saveLayout("floor.card_size", cardSize);
        });
      });

      page.querySelector("#btnArrange").addEventListener("click", arrangeDialog);

      offs.push(Store.on("pcs", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("connected", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("discovered", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("running", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("connection-status", renderGrid));
      offs.push(Store.on("tick", tickTimers));
      offs.push(Store.on("sessions", function () { renderPageChrome(); renderGrid(); }));
      offs.push(Store.on("session-tick", tickTimers));

      renderPageChrome();
      renderGrid();

      // The saved arrangement arrives a beat after the wall does; render twice
      // rather than hold the whole page behind a settings call.
      loadLayout().then(function () {
        if (!rootEl) return;
        renderPageChrome();
        renderGrid();
      }).catch(function () {});

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
