/* ==========================================================================
   CafeXP — Settings
   Organised into the sections from the admin spec. Only settings that map to
   something real are editable; the rest state plainly where they will live.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var offs = [];
  var rootEl = null;
  var tab = "business";

  var TABS = [
    { id: "business", label: "Business" },
    { id: "stations", label: "Stations" },
    { id: "gaming",   label: "Gaming" },
    { id: "system",   label: "System" }
  ];

  /* ==========================================================================
     BUSINESS
     ========================================================================== */
  function businessPane() {
    var user = Store.state.user || {};
    var pane = UI.el("div", { class: "grid grid-split" });

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Cafe</h2>' +
        '<span class="badge badge-plain">Read only</span></div>' +
      '<div class="card-body col">' +
        '<div class="kv"><span class="kv-key">Account name</span><span class="kv-val">' + UI.esc(user.name || "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Email</span><span class="kv-val">' + UI.esc(user.email || "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Cafe ID</span><span class="kv-val mono">' + UI.esc(user.cafe_id != null ? user.cafe_id : "—") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Branch</span><span class="kv-val mono">1</span></div>' +
      "</div>" +
      '<div class="card-foot faint" style="font-size:12px">' +
        "Cafe details are managed in the CafeXP web account, not in this desktop console." +
      "</div>";

    var missing = UI.el("div", { class: "card" });
    missing.innerHTML =
      '<div class="card-head"><h2>Invoicing &amp; tax</h2>' +
        '<span class="badge" data-status="warning">Not built yet</span></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="faint" style="font-size:13px;line-height:1.6">Invoice numbering, tax rates and receipt footers belong here. They need the billing system, which does not exist yet.</div>' +
        '<div class="notice" data-status="info">' + Icon("info", 16) +
          "<div>See the <strong>Billing</strong> section for what is required.</div></div>" +
      "</div>";

    /* ---- coin bonus on top-up ----
       "Pay 1000, get 1100" — a fixed payout for specific top-up amounts,
       shown to the customer as a quick-pick on the top-up screen (client and
       counter both), rather than a flat rate applied invisibly. An amount
       with no tier here just uses the standard coin rate as always. */
    var bonusCard = UI.el("div", { class: "card" });
    bonusCard.innerHTML =
      '<div class="card-head"><h2>Coin bonus on top-up</h2></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="faint" style="font-size:13px;line-height:1.6">Reward bigger top-ups — e.g. pay ' +
          '₹1,000, get 1,100 XP. Shown to customers as a highlighted quick-pick on the top-up screen, ' +
          'in the client app and at the counter alike.</div>' +
        '<div class="col gap-2" id="bonusRows"></div>' +
        '<div class="row gap-2">' +
          '<button class="btn btn-outline btn-sm" type="button" id="bonusAdd">' + Icon("plus", 14) +
            '<span class="btn-label">Add a tier</span></button>' +
          '<button class="btn btn-primary btn-sm" type="button" id="bonusSave">' + Icon("check", 14) +
            '<span class="btn-label">Save</span></button>' +
        "</div>" +
      "</div>";

    pane.appendChild(card);
    pane.appendChild(missing);
    pane.appendChild(bonusCard);

    setTimeout(function () {
      var rowsHost = bonusCard.querySelector("#bonusRows");
      var addBtn = bonusCard.querySelector("#bonusAdd");
      var saveBtn = bonusCard.querySelector("#bonusSave");
      var tiers = [];

      function renderRows() {
        UI.clear(rowsHost);
        if (!tiers.length) {
          rowsHost.appendChild(UI.el("div", {
            class: "faint", style: "font-size:12px", text: "No bonus tiers — every top-up uses the standard coin rate."
          }));
          return;
        }
        tiers.forEach(function (t, i) {
          var row = UI.el("div", { class: "row gap-2", style: "align-items:center" });
          row.innerHTML =
            '<span class="faint" style="font-size:12px">Pay ₹</span>' +
            '<input class="input" type="number" min="1" step="1" style="max-width:110px" data-pay value="' +
              UI.esc(t.pay_amount) + '">' +
            '<span class="faint" style="font-size:12px">get</span>' +
            '<input class="input" type="number" min="1" step="1" style="max-width:110px" data-credit value="' +
              UI.esc(t.credit_amount) + '">' +
            '<span class="faint" style="font-size:12px">XP</span>';
          var remove = UI.el("button", {
            class: "btn btn-ghost btn-sm btn-icon", type: "button", html: Icon("close", 13), "data-tip": "Remove"
          });
          remove.addEventListener("click", function () { tiers.splice(i, 1); renderRows(); });
          row.appendChild(remove);
          row.querySelector("[data-pay]").addEventListener("input", function (e) {
            t.pay_amount = e.target.value;
          });
          row.querySelector("[data-credit]").addEventListener("input", function (e) {
            t.credit_amount = e.target.value;
          });
          rowsHost.appendChild(row);
        });
      }

      Store.getSettings("wallet").then(function (rows) {
        var row = (rows || []).filter(function (r) { return r.setting_key === "topup.bonus_tiers"; })[0];
        try {
          tiers = row && row.setting_value ? JSON.parse(row.setting_value) : [];
        } catch (e) { tiers = []; }
        if (!Array.isArray(tiers)) tiers = [];
        if (document.body.contains(rowsHost)) renderRows();
      }).catch(function () { renderRows(); });

      addBtn.addEventListener("click", function () {
        tiers.push({ pay_amount: "", credit_amount: "" });
        renderRows();
      });

      saveBtn.addEventListener("click", function () {
        var clean = tiers
          .map(function (t) { return { pay_amount: Number(t.pay_amount), credit_amount: Number(t.credit_amount) }; })
          .filter(function (t) { return Number.isFinite(t.pay_amount) && t.pay_amount > 0 &&
            Number.isFinite(t.credit_amount) && t.credit_amount > 0; });

        if (clean.some(function (t) { return t.credit_amount <= t.pay_amount; })) {
          UI.toast.warn("Not a bonus", "Each tier's coins should be more than what's paid, or it isn't a bonus.");
          return;
        }

        UI.withBusy(saveBtn, function () {
          return Store.setSetting("topup.bonus_tiers", JSON.stringify(clean))
            .then(function () {
              tiers = clean;
              renderRows();
              UI.toast.ok("Coin bonus saved", clean.length ? clean.length + " tier(s) active" : "No tiers — standard rate applies to every top-up");
            })
            .catch(function (e) { UI.toast.error("Could not save", e.message); });
        });
      });
    }, 0);

    return pane;
  }

  /* ==========================================================================
     STATIONS
     ========================================================================== */
  function stationsPane() {
    var pane = UI.el("div", { class: "col gap-4" });

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Station registry</h2>' +
        '<button class="btn btn-primary btn-sm" id="setAddStation">' + Icon("plus", 14) +
        '<span class="btn-label">Add station</span></button></div>';

    var body = UI.el("div", { class: "card-body-flush" });
    if (!Store.state.pcs.length) {
      body.appendChild(UI.emptyState({
        icon: "floor", title: "No stations registered",
        text: "Add a station manually or register one from Discovery."
      }));
    } else {
      var wrap = UI.el("div", { class: "table-wrap" });
      var table = UI.el("table", { class: "tbl" });
      table.innerHTML = "<thead><tr><th>Name</th><th>IP address</th><th>Port</th><th>State</th><th></th></tr></thead>";
      var tbody = UI.el("tbody");

      Store.state.pcs.forEach(function (pc) {
        var tr = UI.el("tr");
        tr.innerHTML =
          "<td><strong>" + UI.esc(pc.name) + "</strong></td>" +
          '<td class="mono faint" style="font-size:12px">' + UI.esc(pc.ip_address || "—") + "</td>" +
          '<td class="mono faint" style="font-size:12px">' + UI.esc(pc.port || "—") + "</td>" +
          '<td><span class="badge" data-status="' + (pc.is_active === false ? "idle" : "online") + '">' +
            (pc.is_active === false ? "Inactive" : "Active") + "</span></td>" +
          '<td class="td-actions"></td>';

        var edit = UI.el("button", { class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit station" });
        edit.addEventListener("click", function () {
          global.CXStationPanel.editStation(pc, function () { render(); });
        });
        tr.querySelector(".td-actions").appendChild(edit);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
    }
    card.appendChild(body);
    pane.appendChild(card);

    var zones = UI.el("div", { class: "card" });
    zones.innerHTML =
      '<div class="card-head"><h2>Zones</h2><span class="badge" data-status="warning">Not built yet</span></div>' +
      '<div class="card-body faint" style="font-size:13px;line-height:1.6">' +
        "Main floor, VIP and other groupings need a zone column on the stations table. Every station currently belongs to one flat floor." +
      "</div>";
    pane.appendChild(zones);

    setTimeout(function () {
      var addBtn = pane.querySelector("#setAddStation");
      if (addBtn) addBtn.addEventListener("click", function () { global.CXPages.floor.addStationDialog(); });
    }, 0);

    return pane;
  }

  /* ==========================================================================
     GAMING
     ========================================================================== */
  function gamingPane() {
    var pane = UI.el("div", { class: "grid grid-split" });

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Software catalogue</h2></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="faint" style="font-size:13px;line-height:1.6">' +
          "Applications are configured per station: which executables exist and where they live on that machine." +
        "</div>" +
        '<div class="col" id="swSummary"></div>' +
      "</div>" +
      '<div class="card-foot"><button class="btn btn-outline btn-sm" id="goGames">' + Icon("games", 14) +
        '<span class="btn-label">Open games &amp; software</span></button></div>';

    var launcher = UI.el("div", { class: "card" });
    launcher.innerHTML =
      '<div class="card-head"><h2>Launcher</h2><span class="badge badge-plain">Client-side</span></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="faint" style="font-size:13px;line-height:1.6">' +
          "Launching is handled by the client agent on each station over the existing WebSocket connection. The admin sends the executable path and a duration; the client starts the process and closes it when time runs out." +
        "</div>" +
        '<div class="notice" data-status="info">' + Icon("info", 16) +
          "<div>Kiosk lock, unlock and remote restart are not implemented in the client yet, so those controls are not offered here.</div></div>" +
      "</div>";

    pane.appendChild(card);
    pane.appendChild(launcher);

    setTimeout(function () {
      var goBtn = pane.querySelector("#goGames");
      if (goBtn) goBtn.addEventListener("click", function () { global.CXRouter.go("games"); });

      var summary = pane.querySelector("#swSummary");
      if (!summary) return;
      summary.innerHTML = '<div class="kv"><span class="kv-key">Stations</span><span class="kv-val num">' +
        Store.state.pcs.length + "</span></div>";
      Store.getSoftwareMaster()
        .then(function (list) {
          summary.innerHTML += '<div class="kv"><span class="kv-key">Catalogue entries</span><span class="kv-val num">' +
            list.length + "</span></div>";
        })
        .catch(function () {
          summary.innerHTML += '<div class="kv"><span class="kv-key">Catalogue</span><span class="kv-val faint">Unavailable</span></div>';
        });
    }, 0);

    return pane;
  }

  /* ==========================================================================
     SYSTEM
     ========================================================================== */
  function systemPane() {
    var pane = UI.el("div", { class: "grid grid-split" });

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Connection</h2></div>' +
      '<div class="card-body col">' +
        '<div class="kv"><span class="kv-key">Backend API</span><span class="kv-val mono selectable" style="font-size:12px">' + UI.esc(Store.API_BASE) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Signed in</span><span class="kv-val">' + (Store.state.user ? "Yes" : "No") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Stations connected</span><span class="kv-val num">' + Store.counts().online + "</span></div>" +
        '<div class="kv"><span class="kv-key">Log lines this session</span><span class="kv-val num">' + Store.state.logs.length + "</span></div>" +
      "</div>";

    var prefs = UI.el("div", { class: "card" });
    prefs.innerHTML =
      '<div class="card-head"><h2>Console</h2></div>' +
      '<div class="card-body col gap-4">' +
        '<label class="switch row-between" style="width:100%">' +
          "<span><span style='font-size:13px;font-weight:550'>Start with the sidebar collapsed</span>" +
          "<span class='faint' style='display:block;font-size:11px'>Also toggled with Ctrl+B</span></span>" +
          '<span class="row gap-2"><input type="checkbox" id="prefCollapsed"><span class="switch-track"></span></span>' +
        "</label>" +
        '<div class="kv"><span class="kv-key">Motion</span><span class="kv-val">' +
          (Motion.enabled ? "Enabled" : "Reduced (system setting)") + "</span></div>" +
      "</div>" +
      '<div class="card-foot"><button class="btn btn-danger btn-sm" id="btnSignOut">' + Icon("logout", 14) +
        '<span class="btn-label">Sign out</span></button></div>';

    /*
     * The PIN that unlocks a station kiosk from its own keyboard.
     *
     * A client runs sealed: the customer sitting at it cannot minimise it,
     * leave full screen or close it. Staff normally reach a station's desktop
     * from here — the station panel's Minimise client — which needs no PIN
     * because it is already an authenticated action by a named operator.
     *
     * This covers the case that cannot: the café's network or this console is
     * down and somebody is standing at the machine. Blank means the hatch is
     * refused outright rather than left open.
     */
    var kiosk = UI.el("div", { class: "card" });
    kiosk.innerHTML =
      '<div class="card-head"><h2>Station unlock PIN</h2></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="field">' +
          '<label class="field-label" for="setUnlockPin">Four-digit PIN</label>' +
          '<div class="row gap-2" style="align-items:center">' +
            '<input class="input mono" id="setUnlockPin" inputmode="numeric" maxlength="4" ' +
              'placeholder="Not set" style="max-width:140px;letter-spacing:6px;font-size:18px">' +
            '<button class="btn btn-primary btn-sm" type="button" id="setUnlockPinSave">Save</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" id="setUnlockPinClear">Clear</button>' +
          "</div>" +
          '<div class="field-hint">Typed at a station after <strong>Ctrl+Alt+Shift+Q</strong> to ' +
            'unlock its kiosk. Clearing it refuses that shortcut entirely — staff use ' +
            '<strong>Minimise client</strong> on the station panel instead.</div>' +
        "</div>" +
        '<div class="notice" data-status="warning">' + Icon("alert", 15) +
          "<div>Anyone who knows this can reach the Windows desktop on any station. " +
          "Treat it like a key to the shop, and change it when staff leave.</div></div>" +
      "</div>";

    /* ---- start-of-session buffer ----
       Free minutes at the start of every session for the game or launcher to
       load. The countdown holds at its starting value and nothing is billed
       until this elapses — a session ended inside it costs nothing at all.
       Per café; five minutes if never set. */
    var buffer = UI.el("div", { class: "card" });
    buffer.innerHTML =
      '<div class="card-head"><h2>Before a session starts</h2></div>' +
      '<div class="card-body col gap-3">' +
        '<div class="field">' +
          '<label class="field-label" for="setGraceMinutes">Buffer time (minutes)</label>' +
          '<div class="row gap-2" style="align-items:center">' +
            '<input class="input" id="setGraceMinutes" type="number" min="0" max="30" step="1" ' +
              'style="max-width:100px">' +
            '<button class="btn btn-primary btn-sm" type="button" id="setGraceSave">Save</button>' +
          "</div>" +
          '<div class="field-hint">If a game takes time to load, the timer holds at its starting ' +
            'value for this long before it starts counting and billing the customer. Set to 0 to bill ' +
            'from the moment a session starts.</div>' +
        "</div>" +
      "</div>";

    /* ---- end-of-session cleanup ----
       What a station does the moment a session ends. The launcher sign-outs
       are the reason this exists: without them the next customer sits down at
       a machine still signed into the last one's Steam. */
    var LAUNCHER_NAMES = ["Steam", "Riot", "EA", "Epic", "Ubisoft", "Battle.net", "Rockstar"];
    var cleanup = UI.el("div", { class: "card" });
    cleanup.innerHTML =
      '<div class="card-head"><h2>After a session ends</h2>' +
        '<span class="badge badge-plain">Client-side</span></div>' +
      '<div class="card-body col gap-4">' +
        '<div class="faint" style="font-size:12px">Runs on the station the moment a session finishes.</div>' +
        '<div class="col gap-2">' +
          '<label class="row gap-2" style="align-items:center;cursor:pointer">' +
            '<input type="checkbox" id="clClose"> Close the game</label>' +
          '<label class="row gap-2" style="align-items:center;cursor:pointer">' +
            '<input type="checkbox" id="clLauncher"> Close the launchers</label>' +
          '<label class="row gap-2" style="align-items:center;cursor:pointer">' +
            '<input type="checkbox" id="clSession"> Clear the CafeXP session on the station</label>' +
          /* Not a choice: the floor derives a station's state from its open
             session, so ending one frees the machine immediately. Shown ticked
             and disabled rather than omitted, because staff look for it. */
          '<label class="row gap-2" style="align-items:center">' +
            '<input type="checkbox" id="clAvailable" checked disabled> ' +
            '<span>Return the PC to Available <span class="faint">— always, as soon as the session ends</span></span></label>' +
        "</div>" +
        '<div class="notice" data-status="warning">' + Icon("alert", 16) +
          "<div><strong>Sign out of launchers</strong> — the next customer must never reach the last one's " +
          "gaming accounts. Turning one on clears that launcher's saved login on the station after every " +
          "session, so customers sign in each time.</div></div>" +
        '<div class="row gap-2 wrap" id="clSignout">' +
          LAUNCHER_NAMES.map(function (n) {
            return '<label class="row gap-2" style="align-items:center;cursor:pointer;padding:4px 8px">' +
              '<input type="checkbox" data-launcher="' + n + '"> ' + n + "</label>";
          }).join("") +
        "</div>" +
        '<div class="row gap-2"><button class="btn btn-primary btn-sm" id="clSave">' +
          Icon("check", 14) + '<span class="btn-label">Save cleanup settings</span></button></div>' +
      "</div>";

    pane.appendChild(card);
    pane.appendChild(prefs);
    pane.appendChild(buffer);
    pane.appendChild(cleanup);
    pane.appendChild(kiosk);

    setTimeout(function () {
      var graceInput = buffer.querySelector("#setGraceMinutes");
      var graceSave = buffer.querySelector("#setGraceSave");
      if (!graceInput) return;

      Store.getSettings("session").then(function (rows) {
        var row = (rows || []).filter(function (r) { return r.setting_key === "session.grace_minutes"; })[0];
        if (document.body.contains(graceInput)) {
          graceInput.value = row && row.setting_value !== null ? row.setting_value : "5";
        }
      }).catch(function () {});

      graceSave.addEventListener("click", function () {
        var minutes = Number(graceInput.value);
        if (!Number.isFinite(minutes) || minutes < 0) {
          Motion.shake(graceInput);
          UI.toast.warn("Enter zero or more minutes");
          return;
        }
        UI.withBusy(graceSave, function () {
          return Store.setSetting("session.grace_minutes", minutes)
            .then(function () {
              UI.toast.ok("Buffer time saved",
                minutes > 0 ? "New sessions get " + minutes + " free minute" + (minutes === 1 ? "" : "s") + " to load."
                            : "New sessions bill from the moment they start.");
            })
            .catch(function (e) { UI.toast.error("Could not save", e.message); });
        });
      });
    }, 0);

    setTimeout(function () {
      var saveBtn = cleanup.querySelector("#clSave");
      if (!saveBtn) return;

      function readConfig() {
        var signout = {};
        UI.$$("#clSignout input[type=checkbox]", cleanup).forEach(function (c) {
          if (c.checked) signout[c.dataset.launcher] = true;
        });
        return {
          close_game: cleanup.querySelector("#clClose").checked,
          close_launcher: cleanup.querySelector("#clLauncher").checked,
          clear_session: cleanup.querySelector("#clSession").checked,
          return_available: true,   // derived by the floor; kept for the record
          signout: signout
        };
      }

      Store.getSettings("client").then(function (rows) {
        var row = (rows || []).filter(function (r) { return r.setting_key === "session.cleanup"; })[0];
        var cfg = {};
        if (row && row.setting_value) { try { cfg = JSON.parse(row.setting_value); } catch (e) { cfg = {}; } }
        if (!document.body.contains(cleanup)) return;
        cleanup.querySelector("#clClose").checked = cfg.close_game !== false;
        cleanup.querySelector("#clLauncher").checked = !!cfg.close_launcher;
        cleanup.querySelector("#clSession").checked = cfg.clear_session !== false;
        // clAvailable is fixed on — nothing to restore.
        var signout = cfg.signout || {};
        UI.$$("#clSignout input[type=checkbox]", cleanup).forEach(function (c) {
          c.checked = !!signout[c.dataset.launcher];
        });
      }).catch(function () {});

      saveBtn.addEventListener("click", function () {
        var cfg = readConfig();
        var outs = Object.keys(cfg.signout);
        UI.withBusy(saveBtn, function () {
          return Store.setSetting("session.cleanup", JSON.stringify(cfg))
            .then(function () {
              UI.toast.ok("Cleanup settings saved",
                outs.length ? "Signing out of " + outs.join(", ") + " after each session."
                            : "No launcher sign-outs configured.");
            })
            .catch(function (e) { UI.toast.error("Could not save", e.message); });
        });
      });
    }, 0);

    setTimeout(function () {
      var pinInput = pane.querySelector("#setUnlockPin");
      if (pinInput) {
        Store.getSettings("client").then(function (rows) {
          var row = (rows || []).filter(function (r) {
            return r.setting_key === "client.staff_unlock_pin";
          })[0];
          if (row && document.body.contains(pinInput)) pinInput.value = row.setting_value || "";
        }).catch(function () {});

        pinInput.addEventListener("input", function () {
          pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
        });

        /*
         * Saved on a button, not on blur.
         *
         * Blur fires when someone tabs away or clicks elsewhere mid-thought,
         * which for this field means a half-considered PIN going out to every
         * station without anybody deciding to send it. An explicit Save also
         * gives the confirmation a security setting deserves.
         */
        function savePin(value, verb) {
          var btn = pane.querySelector("#setUnlockPinSave");
          return UI.withBusy(btn, function () {
            return Store.setSetting("client.staff_unlock_pin", value)
              .then(function () {
                UI.toast.ok(value ? "Station unlock PIN saved" : "Station unlock PIN cleared",
                  value ? "Stations pick it up as they reconnect."
                        : "Ctrl+Alt+Shift+Q is now refused at every station.");
              })
              .catch(function (e) { UI.toast.error("Could not " + verb + " the PIN", e.message); });
          });
        }

        pane.querySelector("#setUnlockPinSave").addEventListener("click", function () {
          var value = pinInput.value;
          if (value.length !== 4) {
            Motion.shake(pinInput);
            UI.toast.warn("A PIN must be four digits", "Use Clear to remove it instead.");
            return;
          }
          savePin(value, "save");
        });

        pane.querySelector("#setUnlockPinClear").addEventListener("click", function () {
          if (!pinInput.value) { UI.toast.info("No PIN is set"); return; }
          UI.confirm({
            title: "Clear the station unlock PIN?",
            message: "Ctrl+Alt+Shift+Q will be refused at every station. Staff will only be " +
              "able to reach a station's desktop through Minimise client on the station panel, " +
              "which needs this console to be reachable.",
            confirmLabel: "Clear it", variant: "danger"
          }).then(function (ok) {
            if (!ok) return;
            pinInput.value = "";
            savePin("", "clear");
          });
        });
      }

      var toggle = pane.querySelector("#prefCollapsed");
      if (toggle) {
        toggle.checked = localStorage.getItem("cx.sidebar.collapsed") === "1";
        toggle.addEventListener("change", function () {
          var isCollapsed = document.getElementById("app").classList.contains("sidebar-collapsed");
          if (toggle.checked !== isCollapsed) global.CXRouter.toggleSidebar();
          else localStorage.setItem("cx.sidebar.collapsed", toggle.checked ? "1" : "0");
        });
      }
      var out = pane.querySelector("#btnSignOut");
      if (out) out.addEventListener("click", function () {
        UI.confirm({
          title: "Sign out?",
          message: "You will need to sign in again to manage this cafe.",
          confirmLabel: "Sign out", variant: "danger"
        }).then(function (ok) { if (ok) Store.logout(); });
      });
    }, 0);

    return pane;
  }

  var PANES = {
    business: businessPane, stations: stationsPane, gaming: gamingPane,
    system: systemPane
  };

  /*
   * What the visible pane is drawn from.
   *
   * render() rebuilt the whole pane and re-ran its entrance animation on
   * every `pcs` and `user` event — and those fire whenever a session starts
   * or ends or an application is launched anywhere on the floor. Two
   * consequences, one cosmetic and one not: the page flickered, and any form
   * being filled in was thrown away and rebuilt mid-keystroke.
   *
   * The panes genuinely do read live station data, so the subscriptions stay
   * — they are just no longer allowed to redraw when nothing they show has
   * changed.
   */
  var lastPaneSig = "";

  function paneSignature() {
    return [
      tab,
      (Store.state.pcs || []).map(function (p) {
        return [p.pc_id, p.name, p.ip_address || "", p.category || "", Store.pcStatus(p), p.client_version || ""].join(":");
      }).join(";"),
      Store.state.user ? [Store.state.user.id || "", Store.state.user.email || ""].join(":") : ""
    ].join("|");
  }

  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#settingsPane");
    if (!host) return;

    /*
     * Never rebuild a pane the operator is working in. The signature is
     * deliberately not stamped here, so the pending change is simply applied
     * the next time round — once they have moved on — rather than lost.
     */
    if (host.childElementCount && host.contains(document.activeElement)) return;

    var sig = paneSignature();
    if (sig === lastPaneSig && host.childElementCount) return;
    lastPaneSig = sig;

    UI.clear(host);
    var pane = PANES[tab]();
    host.appendChild(pane);
    Motion.enter(pane, { y: 8 });
  }

  global.CXPages.settings = {
    title: "Settings",
    subtitle: "Console and cafe configuration",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Settings</div>' +
            '<div class="page-sub">Configuration for this cafe and this console.</div>' +
          "</div>" +
        "</div>" +
        '<div class="tabs" id="settingsTabs" style="margin-bottom:var(--s-5)">' +
          TABS.map(function (t) {
            return '<button data-tab="' + t.id + '" aria-selected="' + (t.id === tab) + '">' + UI.esc(t.label) + "</button>";
          }).join("") +
        "</div>" +
        '<div id="settingsPane"></div>';
      root.appendChild(page);

      Array.prototype.forEach.call(page.querySelectorAll("#settingsTabs button"), function (btn) {
        btn.addEventListener("click", function () {
          tab = btn.dataset.tab;
          Array.prototype.forEach.call(page.querySelectorAll("#settingsTabs button"), function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          render();
        });
      });

      offs.push(Store.on("pcs", render));
      offs.push(Store.on("user", render));
      lastPaneSig = "";
      render();
    },

    unmount: function () {
      offs.forEach(function (f) { f(); });
      offs = [];
      rootEl = null;
      // The pane goes with the page, so the next mount must draw rather than
      // recognise its own signature and skip.
      lastPaneSig = "";
    }
  };
})(window);
