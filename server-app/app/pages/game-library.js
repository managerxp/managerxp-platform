/* ==========================================================================
   CafeXP — Game Library

   The café's selection from ManagerXP's master catalog. A café never authors
   a title's platform configuration (App IDs, launch targets, artwork) — all
   of that is read-only here. What a café DOES decide:

     · which titles it offers                     (add / remove)
     · how a customer gets into each one          (account mode)
     · an optional per-game rate
     · which platform of a game each PC has       (Steam's copy or EA's)
     · its own venue account / licence pool       (café-owned, not catalog)
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var ACCOUNT_MODES = [
    ["CUSTOMER_ACCOUNT", "Customer's own account", "The player signs in with their own Steam/Riot/EA account."],
    ["VENUE_ACCOUNT", "Venue account", "The player uses one of the café's own accounts — no login of their own."],
    ["CUSTOMER_OR_VENUE", "Either", "The player chooses: their own account, or one of the café's."]
  ];
  var MODE_LABEL = {};
  ACCOUNT_MODES.forEach(function (m) { MODE_LABEL[m[0]] = m[1]; });

  var rootEl = null;
  var games = [];
  var loading = false, loadError = null;
  var query = "";
  var searchTimer = null;

  function load() {
    loading = true; loadError = null; render();
    var params = { limit: 500 };
    if (query) params.search = query;
    return Store.libraryGames(params)
      .then(function (body) { games = body.data || []; loading = false; render(); })
      .catch(function (err) { loading = false; games = []; loadError = err.message; render(); });
  }

  /* ==========================================================================
     ADD FROM CATALOG
     ========================================================================== */
  function catalogDialog(onDone) {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="search">' + Icon("search", 15) +
        '<input class="input" id="cgSearch" type="search" placeholder="Search the catalog…" autocomplete="off" data-autofocus></div>' +
      '<div id="cgList" class="col gap-1" style="max-height:50vh;overflow:auto"></div>';

    var listHost = body.querySelector("#cgList");
    var searchIn = body.querySelector("#cgSearch");
    var haveIds = {};
    games.forEach(function (g) { haveIds[g.game_id] = true; });

    function paint(rows) {
      UI.clear(listHost);
      if (!rows.length) { listHost.appendChild(UI.emptyState({ icon: "games", title: "No games found", text: "Try a different search." })); return; }
      rows.forEach(function (g) {
        var already = !!haveIds[g.id];
        var row = UI.el("div", { class: "row gap-3", style: { alignItems: "center", padding: "6px 8px" } });
        row.innerHTML =
          '<div class="sw-icon" style="width:36px;height:36px;border-radius:9px;overflow:hidden;background:var(--bg-inset);flex:0 0 auto;display:flex;align-items:center;justify-content:center">' +
            (g.icon_url ? '<img src="' + UI.esc(Store.API_BASE + g.icon_url) + '" style="width:100%;height:100%;object-fit:cover">' : Icon("games", 18)) +
          "</div>" +
          '<span class="grow"><strong style="font-size:13px">' + UI.esc(g.name) + "</strong>" +
            '<div class="faint" style="font-size:11px">' +
              ((g.platforms || []).length
                ? (g.platforms || []).map(function (p) { return UI.esc(p.platform); }).join(" · ")
                : "no platform configured yet") +
            "</div>" +
          "</span>";
        var btn = UI.el("button", {
          class: already ? "btn btn-ghost btn-sm" : "btn btn-outline btn-sm",
          html: already ? "Added" : (Icon("plus", 13) + '<span class="btn-label">Add</span>')
        });
        btn.disabled = already;
        btn.addEventListener("click", function () {
          btn.disabled = true;
          Store.addGame(g.id)
            .then(function (r) {
              UI.toast.ok("Added", r.data.name);
              haveIds[g.id] = true;
              btn.className = "btn btn-ghost btn-sm"; btn.textContent = "Added";
              load();
            })
            .catch(function (e) { btn.disabled = false; UI.toast.error("Could not add", e.message); });
        });
        row.appendChild(btn);
        listHost.appendChild(row);
      });
    }

    function search() {
      UI.clear(listHost); listHost.appendChild(UI.skeletonRows(4));
      Store.gameCatalog({ search: searchIn.value.trim(), limit: 200 })
        .then(function (r) { paint(r.data || []); })
        .catch(function (e) { UI.clear(listHost); listHost.appendChild(UI.errorState(e.message)); });
    }
    var t = null;
    searchIn.addEventListener("input", function () { clearTimeout(t); t = setTimeout(search, 220); });
    search();

    return UI.modal({
      title: "Add a game",
      description: "Pick from ManagerXP's catalog — every platform's launch configuration is already set up.",
      size: "lg",
      body: body,
      actions: [{ label: "Done", variant: "primary", onClick: function () { if (onDone) onDone(); return true; } }]
    });
  }

  /* ==========================================================================
     PER-GAME CAFÉ SETTINGS — account mode + rate
     ========================================================================== */
  function settingsDialog(game) {
    var platforms = game.platforms || [];
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label">How players get into this game</label>' +
        '<div class="col gap-2" id="amModes"></div></div>';

    var modeHost = body.querySelector("#amModes");
    ACCOUNT_MODES.forEach(function (m) {
      var row = UI.el("label", {
        class: "row gap-3",
        style: { alignItems: "flex-start", padding: "8px 10px", cursor: "pointer", border: "1px solid var(--line)", borderRadius: "10px" }
      });
      row.innerHTML =
        '<input type="radio" name="accountMode" value="' + m[0] + '"' + (game.account_mode === m[0] ? " checked" : "") + ' style="margin-top:3px">' +
        '<span class="grow"><strong style="font-size:13px;display:block">' + UI.esc(m[1]) + "</strong>" +
          '<span class="faint" style="font-size:11px">' + UI.esc(m[2]) + "</span></span>";
      modeHost.appendChild(row);
    });

    /*
     * A café-wide launch path/arguments default per platform, applied to
     * every station that doesn't set its own (see "Games by station" for
     * the per-station one). Useful the moment every PC has the same title
     * installed in the same place — set it once here instead of repeating
     * it on each station.
     */
    if (platforms.length) {
      var launchSection = UI.el("div", { class: "field" });
      launchSection.innerHTML =
        '<label class="field-label">Launch override (applies to every station, unless a station sets its own)</label>' +
        '<div class="col gap-3" id="lpList"></div>';
      var lpList = launchSection.querySelector("#lpList");
      platforms.forEach(function (p) {
        var row = UI.el("div", { class: "col gap-1", style: { padding: "8px 10px", border: "1px solid var(--line)", borderRadius: "10px" } });
        row.innerHTML =
          '<div class="faint" style="font-size:12px;font-weight:700">' + UI.esc(p.platform) + "</div>" +
          '<input class="input mono" data-lp-target="' + p.id + '" style="font-size:12px;height:30px" ' +
            'placeholder="Executable/path — leave blank for ' + UI.esc(p.launch_target || "the catalogue default") + '" ' +
            'value="' + UI.esc(p.cafe_launch_target_override || "") + '">' +
          '<input class="input mono" data-lp-args="' + p.id + '" style="font-size:12px;height:30px" ' +
            'placeholder="Launch arguments — leave blank for ' + UI.esc(p.launch_arguments || "none") + '" ' +
            'value="' + UI.esc(p.cafe_launch_arguments_override || "") + '">';
        lpList.appendChild(row);
      });
      body.appendChild(launchSection);
    }

    return UI.modal({
      title: game.name,
      description: "How this game is offered at your café.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Save", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var mode = (ctx.body.querySelector('input[name="accountMode"]:checked') || {}).value;
            var patch = { account_mode: mode };
            var launchSaves = platforms.map(function (p) {
              var targetEl = ctx.body.querySelector('[data-lp-target="' + p.id + '"]');
              var argsEl = ctx.body.querySelector('[data-lp-args="' + p.id + '"]');
              if (!targetEl) return Promise.resolve();
              return Store.setGamePlatformOverride(p.id, {
                launch_target_override: targetEl.value.trim() || null,
                launch_arguments_override: argsEl.value.trim() || null
              });
            });
            return Promise.all([Store.updateCafeGame(game.cafe_game_id, patch)].concat(launchSaves))
              .then(function () { UI.toast.ok("Saved", game.name); load(); return true; })
              .catch(function (e) { UI.toast.error("Could not save", e.message); return false; });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     VENUE ACCOUNTS / LICENCES — the café's own logins for a platform
     ========================================================================== */
  function accountsDialog(game) {
    var platforms = game.platforms || [];
    if (!platforms.length) {
      UI.toast.warn("No platforms", "ManagerXP has not configured a platform for this game yet.");
      return;
    }

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label" for="vaPlatform">Platform</label>' +
        '<select class="select" id="vaPlatform">' +
          platforms.map(function (p) {
            return '<option value="' + p.id + '">' + UI.esc(p.platform) + "</option>";
          }).join("") +
        "</select>" +
        '<div class="field-hint">Accounts belong to one platform — a Steam licence is not an EA one.</div></div>' +
      '<div id="vaList"></div>' +
      '<div class="row-between" style="align-items:center">' +
        '<div class="faint" style="font-size:11px">Passwords are stored encrypted and are never shown again.</div>' +
        '<button type="button" class="btn btn-outline btn-sm" id="vaAdd">' + Icon("plus", 13) +
          '<span class="btn-label">Add licence</span></button>' +
      "</div>";

    var listHost = body.querySelector("#vaList");
    var platSel = body.querySelector("#vaPlatform");

    /* Live venue-Steam sign-in progress for whichever PC an account is
       currently assigned to — see game-credentials.js's identical block for
       why this is matched by PC name rather than account. */
    var LIVE_LABEL = { CHECKING: "Checking…", AUTHENTICATING: "Signing in…", AUTHENTICATED: "Signed in", FAILED: "Failed" };
    var LIVE_TONE = { CHECKING: "idle", AUTHENTICATING: "accent", AUTHENTICATED: "online", FAILED: "offline" };

    var offAuth = Store.on("steamAuth", function (map) {
      if (!listHost.isConnected) { offAuth(); return; }
      Object.keys(map).forEach(function (pcName) {
        var el = listHost.querySelector('[data-pc="' + CSS.escape(pcName) + '"]');
        if (!el) return;
        var s = map[pcName];
        var label = LIVE_LABEL[s.state];
        el.hidden = !label;
        el.textContent = label || "";
        el.dataset.status = LIVE_TONE[s.state] || "idle";
      });
    });

    function paint(rows) {
      UI.clear(listHost);
      if (!rows.length) {
        listHost.appendChild(UI.emptyState({
          icon: "customers", title: "No venue accounts yet",
          text: "Add the café's own logins for this platform so players can just play."
        }));
        return;
      }
      var table = UI.el("table", { class: "tbl" });
      table.innerHTML = "<thead><tr><th>Name</th><th>Username</th><th>Profile</th><th>Status</th><th></th></tr></thead>";
      var tbody = UI.el("tbody");
      rows.forEach(function (a) {
        var tr = UI.el("tr");
        var tone = a.status === "AVAILABLE" ? "online" : a.status === "IN_USE" ? "accent" : "idle";
        tr.innerHTML =
          "<td><strong>" + UI.esc(a.account_name) + "</strong>" +
            (a.has_password ? "" : '<div class="faint" style="font-size:10px">no password saved</div>') + "</td>" +
          '<td class="faint mono" style="font-size:11px">' + UI.esc(a.username || "—") + "</td>" +
          '<td class="faint" style="font-size:11px">' + UI.esc(a.profile_identifier || "—") + "</td>" +
          '<td><span class="badge" data-status="' + tone + '">' +
            (a.status === "IN_USE" ? "In use" : a.status === "AVAILABLE" ? "Available" : "Disabled") + "</span>" +
            (a.status === "IN_USE" && a.assigned_pc_name
              ? (function () {
                  var live = Store.state.steamAuth[a.assigned_pc_name];
                  var label = live && LIVE_LABEL[live.state];
                  return '<div class="faint" style="font-size:10px;margin-top:2px">' + UI.esc(a.assigned_pc_name) +
                    (a.session_started_at ? " · since " + UI.esc(new Date(a.session_started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) : "") +
                    '<span class="badge" data-pc="' + UI.esc(a.assigned_pc_name) + '" data-status="' + (LIVE_TONE[live && live.state] || "idle") + '"' +
                      (label ? "" : " hidden") + ' style="margin-left:6px;font-size:9px">' +
                      UI.esc(label || "") +
                    "</span></div>";
                })()
              : "") +
            "</td>" +
          '<td class="td-actions"></td>';

        var actions = tr.querySelector(".td-actions");
        if (a.status !== "IN_USE") {
          var toggle = UI.el("button", {
            class: "btn btn-ghost btn-sm",
            html: a.status === "AVAILABLE" ? "Disable" : "Enable"
          });
          toggle.addEventListener("click", function () {
            Store.updateVenueAccount(platSel.value, a.id, {
              status: a.status === "AVAILABLE" ? "DISABLED" : "AVAILABLE"
            }).then(loadAccounts).catch(function (e) { UI.toast.error("Could not save", e.message); });
          });
          var del = UI.el("button", { class: "btn btn-ghost btn-sm", html: Icon("trash", 13) });
          del.addEventListener("click", function () {
            UI.confirm({
              title: "Remove " + a.account_name + "?",
              message: "The café loses this licence from its pool. Nothing on the platform itself is changed.",
              confirmLabel: "Remove", variant: "danger"
            }).then(function (ok) {
              if (!ok) return;
              Store.removeVenueAccount(platSel.value, a.id)
                .then(loadAccounts).catch(function (e) { UI.toast.error("Could not remove", e.message); });
            });
          });
          actions.appendChild(toggle); actions.appendChild(del);
        }
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      var wrap = UI.el("div", { class: "table-wrap" });
      wrap.appendChild(table);
      listHost.appendChild(wrap);
    }

    function loadAccounts() {
      UI.clear(listHost); listHost.appendChild(UI.skeletonRows(3));
      return Store.venueAccounts(platSel.value)
        .then(function (r) { paint(r.data || []); })
        .catch(function (e) { UI.clear(listHost); listHost.appendChild(UI.errorState(e.message)); });
    }

    platSel.addEventListener("change", loadAccounts);
    body.querySelector("#vaAdd").addEventListener("click", function () { addAccountDialog(platSel.value, loadAccounts); });
    loadAccounts();

    return UI.modal({
      title: "Venue accounts — " + game.name,
      description: "The café's own logins, handed out one per session and returned when it ends.",
      size: "lg",
      body: body,
      actions: [{ label: "Close", variant: "ghost" }]
    });
  }

  function addAccountDialog(platformId, onDone) {
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="vaName">Name</label>' +
        '<input class="input" id="vaName" placeholder="Licence 1" data-autofocus></div>' +
      '<div class="field"><label class="field-label" for="vaUser">Username</label>' +
        '<input class="input mono" id="vaUser" placeholder="venue1@example.com" autocomplete="off"></div>' +
      '<div class="field"><label class="field-label" for="vaPass">Password</label>' +
        '<input class="input" id="vaPass" type="password" autocomplete="new-password">' +
        '<div class="field-hint">Encrypted at rest. It cannot be read back — only replaced.</div></div>' +
      '<div class="field"><label class="field-label" for="vaProfile">Game profile</label>' +
        '<input class="input" id="vaProfile" placeholder="e.g. Profile 1">' +
        '<div class="field-hint">For story games: keeps this licence with its own save, so one player\'s progress is never mixed with another\'s.</div></div>';

    return UI.modal({
      title: "Add licence",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Add", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#vaName").value.trim();
            if (!name) { Motion.shake(ctx.body.querySelector("#vaName")); UI.toast.warn("Give the licence a name"); return false; }
            return Store.addVenueAccount(platformId, {
              account_name: name,
              username: ctx.body.querySelector("#vaUser").value.trim() || null,
              password: ctx.body.querySelector("#vaPass").value || null,
              profile_identifier: ctx.body.querySelector("#vaProfile").value.trim() || null
            })
              .then(function () { UI.toast.ok("Added", name); if (onDone) onDone(); return true; })
              .catch(function (e) { UI.toast.error("Could not add", e.message); return false; });
          }
        }
      ]
    });
  }

  function confirmRemove(game, onDone) {
    UI.modal({
      title: "Remove game",
      description: "Remove " + game.name + " from your library? Its per-station availability goes with it.",
      body: UI.el("div", { class: "notice", html: Icon("alert", 16) + "<div>This does not uninstall anything on a PC — it only removes the title from your café's library.</div>", dataset: { status: "warning" } }),
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Remove", variant: "danger", icon: "trash",
          onClick: function () {
            return Store.removeGame(game.cafe_game_id)
              .then(function () { UI.toast.ok("Removed", game.name); if (onDone) onDone(); return true; })
              .catch(function (e) { UI.toast.error("Could not remove", e.message); return false; });
          }
        }
      ]
    });
  }

  function toggleEnabled(game) {
    return Store.setGameEnabled(game.cafe_game_id, !game.enabled)
      .then(function () { load(); })
      .catch(function (e) { UI.toast.error("Could not save", e.message); });
  }

  /* ==========================================================================
     STATION AVAILABILITY — which PLATFORM of each game a PC has installed
     ========================================================================== */
  function stationDialog() {
    var stations = (Store.state.pcs || []).filter(function (p) { return Store.isNetworked(p); });
    if (!stations.length) {
      UI.toast.warn("No stations", "Availability is set on stations that run the client agent.");
      return;
    }

    // Populated by "Scan station" — a shared <datalist> so every override
    // input on the dialog offers the same live results, the same station
    // scan games.js's own "Add software" dialog already uses.
    var scanned = [];

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="row gap-3" style="align-items:flex-end">' +
        '<div class="field grow"><label class="field-label" for="stPc">Station</label>' +
          '<select class="select" id="stPc">' +
            stations.map(function (p) { return '<option value="' + p.pc_id + '">' + UI.esc(p.name) + "</option>"; }).join("") +
          "</select></div>" +
        '<button type="button" class="btn btn-outline btn-sm" id="stScan">' + Icon("radar", 14) +
          '<span class="btn-label">Scan station</span></button>' +
      "</div>" +
      '<div class="row-between"><div class="faint" style="font-size:12px">Tick each version this station actually has installed.</div>' +
        '<div class="row gap-2"><button type="button" class="btn btn-ghost btn-sm" id="stNone">Clear</button></div></div>' +
      '<div id="stList" class="col gap-1" style="max-height:46vh;overflow:auto"></div>' +
      '<datalist id="stScanResults"></datalist>';

    var listHost = body.querySelector("#stList");
    var pcSel = body.querySelector("#stPc");
    var scanBtn = body.querySelector("#stScan");
    var datalist = body.querySelector("#stScanResults");

    function syncScanButton() {
      var pc = stations.filter(function (p) { return String(p.pc_id) === String(pcSel.value); })[0];
      var connected = pc && Store.isConnected(pc.name);
      scanBtn.disabled = !connected;
      scanBtn.dataset.tip = connected ? "" : "The station must be connected to scan it";
    }

    function paint(rows) {
      UI.clear(listHost);
      var withPlatforms = rows.filter(function (g) { return (g.platforms || []).length; });
      if (!withPlatforms.length) {
        listHost.appendChild(UI.emptyState({ icon: "games", title: "No games yet", text: "Add a game to your library first." }));
        return;
      }
      withPlatforms.forEach(function (g) {
        var group = UI.el("div", { class: "col gap-1", style: { padding: "6px 8px" } });
        group.innerHTML = '<div style="font-size:13px;font-weight:700">' + UI.esc(g.name) +
          (g.enabled ? "" : ' <span class="badge">Off</span>') + "</div>";
        (g.platforms || []).forEach(function (p) {
          var wrap = UI.el("div", { class: "col gap-1" });
          var row = UI.el("label", {
            class: "row gap-3",
            style: { alignItems: "center", padding: "4px 0 4px 12px", cursor: "pointer" }
          });
          row.innerHTML =
            '<input type="checkbox" data-pid="' + p.id + '"' + (p.installed ? " checked" : "") + ">" +
            '<span class="grow faint" style="font-size:12px">' + UI.esc(p.platform) +
              (p.platform_game_id ? ' <span class="mono">#' + UI.esc(p.platform_game_id) + "</span>" : "") + "</span>";
          wrap.appendChild(row);

          /*
           * A local path override for this one platform on this one station
           * only — see games.Controller.js's header for why this is the one
           * field a café can set here. Left blank, this platform launches
           * using the café's own default (if it set one, see settingsDialog)
           * or the catalogue's; a path here always wins, protocol included,
           * since the point is "on this PC, just run this."
           */
          var fallbackPath = p.cafe_launch_target_override || p.launch_target || "the catalogue default";
          var overrideRow = UI.el("div", {
            class: "row gap-2",
            style: { padding: "0 0 2px 34px", display: p.installed ? "flex" : "none" }
          });
          overrideRow.innerHTML =
            '<input class="input mono" data-override="' + p.id + '" list="stScanResults" ' +
              'style="flex:1;font-size:12px;height:30px" ' +
              'placeholder="Leave blank to use ' + UI.esc(fallbackPath) + '" ' +
              'value="' + UI.esc(p.launch_target_override || "") + '">';
          wrap.appendChild(overrideRow);

          var argOverrideRow = UI.el("div", {
            class: "row gap-2",
            style: { padding: "0 0 4px 34px", display: p.installed ? "flex" : "none" }
          });
          argOverrideRow.innerHTML =
            '<input class="input mono" data-arg-override="' + p.id + '" ' +
              'style="flex:1;font-size:12px;height:30px" ' +
              'placeholder="Launch arguments — leave blank for ' +
                UI.esc(p.cafe_launch_arguments_override || p.launch_arguments || "none") + '" ' +
              'value="' + UI.esc(p.launch_arguments_override || "") + '">';
          wrap.appendChild(argOverrideRow);

          row.querySelector('input[type="checkbox"]').addEventListener("change", function (e) {
            overrideRow.style.display = e.target.checked ? "flex" : "none";
            argOverrideRow.style.display = e.target.checked ? "flex" : "none";
          });

          group.appendChild(wrap);
        });
        listHost.appendChild(group);
      });
    }

    function loadPc() {
      syncScanButton();
      UI.clear(listHost); listHost.appendChild(UI.skeletonRows(4));
      Store.getPcGames(pcSel.value)
        .then(function (body) { paint(body.data.games || []); })
        .catch(function (e) { UI.clear(listHost); listHost.appendChild(UI.errorState(e.message)); });
    }
    pcSel.addEventListener("change", function () { scanned = []; loadPc(); });
    body.querySelector("#stNone").addEventListener("click", function () {
      UI.$$("#stList input[type=checkbox]", body).forEach(function (c) { c.checked = false; });
      UI.$$("#stList [data-override], #stList [data-arg-override]", body).forEach(function (i) { i.closest(".row").style.display = "none"; });
    });

    scanBtn.addEventListener("click", function () {
      var pc = stations.filter(function (p) { return String(p.pc_id) === String(pcSel.value); })[0];
      if (!pc) return;
      var t = UI.toast({ title: "Scanning " + pc.name, message: "This can take 10–30 seconds the first time.", status: "info", duration: 0 });
      UI.withBusy(scanBtn, function () {
        return Store.scanPcSoftware(pc.name)
          .then(function (result) {
            t.dismiss();
            if (!result || !result.success) {
              UI.toast.error("Scan failed", (result && result.error) || "Unknown error");
              return;
            }
            scanned = result.software || [];
            datalist.innerHTML = scanned
              .filter(function (s) { return s.path && s.path.trim(); })
              .map(function (s) { return '<option value="' + UI.esc(s.path) + '">' + UI.esc(s.name || "") + "</option>"; })
              .join("");
            UI.toast.ok("Found " + scanned.length + " items", datalist.children.length + " with a usable path");
          })
          .catch(function (e) { t.dismiss(); UI.toast.error("Scan failed", e.message); });
      });
    });

    loadPc();

    return UI.modal({
      title: "Games by station",
      description: "Which version of each game this station has — Steam's copy, EA's, or both.",
      size: "lg",
      body: body,
      actions: [
        { label: "Close", variant: "ghost" },
        {
          label: "Save availability", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var ids = UI.$$("#stList input[type=checkbox]:checked", ctx.body).map(function (c) { return Number(c.dataset.pid); });
            var overrides = {};
            UI.$$("#stList [data-override]", ctx.body).forEach(function (i) {
              overrides[Number(i.dataset.override)] = i.value.trim() || null;
            });
            var argOverrides = {};
            UI.$$("#stList [data-arg-override]", ctx.body).forEach(function (i) {
              argOverrides[Number(i.dataset.argOverride)] = i.value.trim() || null;
            });
            return Store.setPcGames(pcSel.value, ids, overrides, argOverrides)
              .then(function (r) { UI.toast.ok("Saved", r.message); load(); return true; })
              .catch(function (e) { UI.toast.error("Could not save", e.message); return false; });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     TABLE
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#gameTable");
    if (!host) return;
    UI.clear(host);

    if (loading && !games.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (loadError) { host.appendChild(UI.errorState(loadError, load)); return; }
    if (!games.length) {
      host.appendChild(UI.emptyState({
        icon: "games",
        title: query ? "No games match" : "No games yet",
        text: query ? "Nothing matches the current search." : "Add a title from ManagerXP's catalog to get started.",
        actions: [{ label: "Add game", icon: "plus", variant: "primary", onClick: function () { catalogDialog(load); } }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Game</th><th>Platforms</th><th>Players use</th>" +
      '<th class="td-num">PCs</th><th>Status</th><th></th></tr></thead>';
    var tbody = UI.el("tbody");

    games.forEach(function (g) {
      var tr = UI.el("tr");
      var platformText = (g.platforms || []).length
        ? (g.platforms || []).map(function (p) { return UI.esc(p.platform); }).join(" · ")
        : '<span class="faint">none configured</span>';

      tr.innerHTML =
        "<td><div class=\"row gap-2\" style=\"align-items:center\">" +
          '<div class="sw-icon" style="width:28px;height:28px;border-radius:7px;overflow:hidden;background:var(--bg-inset);flex:0 0 auto;display:flex;align-items:center;justify-content:center">' +
            (g.icon_url ? '<img src="' + UI.esc(Store.API_BASE + g.icon_url) + '" style="width:100%;height:100%;object-fit:cover">' : Icon("games", 14)) +
          "</div><div><strong>" + UI.esc(g.name) + "</strong>" +
          (g.category ? ' <span class="badge badge-plain">' + UI.esc(g.category) + "</span>" : "") +
          "</div></div></td>" +
        '<td class="faint" style="font-size:12px">' + platformText + "</td>" +
        '<td style="font-size:12px">' + UI.esc(MODE_LABEL[g.account_mode] || g.account_mode) + "</td>" +
        '<td class="td-num">' + (g.pc_count || 0) + "</td>" +
        "<td></td>" +
        '<td class="td-actions"></td>';

      var statusCell = tr.children[4];
      var statusBtn = UI.el("button", {
        class: "btn btn-sm " + (g.enabled ? "btn-outline" : "btn-ghost"),
        html: g.enabled ? '<span class="badge" data-status="online">Enabled</span>' : '<span class="badge">Off</span>'
      });
      statusBtn.addEventListener("click", function () { toggleEnabled(g); });
      statusCell.appendChild(statusBtn);

      var actions = tr.querySelector(".td-actions");
      var settings = UI.el("button", { class: "btn btn-outline btn-sm", html: Icon("settings", 13) });
      settings.title = "How players get into this game";
      settings.addEventListener("click", function () { settingsDialog(g); });
      actions.appendChild(settings);

      /* Only meaningful once the café has said players may use its own
         accounts — offering a licence pool for a bring-your-own-login game
         would be a button that configures nothing. */
      if (g.account_mode === "VENUE_ACCOUNT" || g.account_mode === "CUSTOMER_OR_VENUE") {
        var accounts = UI.el("button", { class: "btn btn-outline btn-sm", html: Icon("customers", 13) });
        accounts.title = "Venue accounts / licences";
        accounts.addEventListener("click", function () { accountsDialog(g); });
        actions.appendChild(accounts);
      }

      var del = UI.el("button", { class: "btn btn-ghost btn-sm", html: Icon("trash", 13) });
      del.addEventListener("click", function () { confirmRemove(g, load); });
      actions.appendChild(del);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages["game-library"] = {
    title: "Game Library",
    subtitle: "Titles you offer, chosen from ManagerXP's catalog",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div><div class=\"page-title\">Game Library</div>" +
            '<div class="page-sub">Pick titles from ManagerXP\'s catalog, say how players get into them, and which stations have them.</div></div>' +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="glStations">' + Icon("devices", 15) + '<span class="btn-label">Games by station</span></button>' +
            '<button class="btn btn-primary" id="glAdd">' + Icon("plus", 15) + '<span class="btn-label">Add game</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="toolbar">' +
          '<div class="search" style="width:320px">' + Icon("search", 15) +
            '<input class="input" id="glSearch" type="search" placeholder="Search game…" autocomplete="off"></div>' +
        "</div>" +
        '<div class="card card-body-flush" id="gameTable"></div>';
      root.appendChild(page);

      var search = page.querySelector("#glSearch");
      search.value = query;
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { query = search.value.trim(); load(); }, 260);
      });

      page.querySelector("#glAdd").addEventListener("click", function () { catalogDialog(load); });
      page.querySelector("#glStations").addEventListener("click", function () { stationDialog(); });

      render();
      load();
    },

    unmount: function () { clearTimeout(searchTimer); rootEl = null; }
  };
})(window);
