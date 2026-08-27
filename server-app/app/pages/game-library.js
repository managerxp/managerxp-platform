/* ==========================================================================
   CafeXP — Game Library
   The café's catalogue of game titles and how to launch each one, over
   /api/games. Separate from the "Games" page, which lists the executables on a
   single station; this is the library those installs are chosen from, plus the
   per-station "which titles are available here" map.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var LAUNCHERS = ["Steam", "Riot", "EA", "Epic", "Ubisoft", "Battle.net", "Rockstar", "Custom"];
  var LAUNCH_TYPE_BY = {
    Steam: "Steam App", Riot: "Riot Client", EA: "EA App", Epic: "Epic Games",
    Ubisoft: "Ubisoft Connect", "Battle.net": "Battle.net", Rockstar: "Rockstar", Custom: "Executable"
  };

  var rootEl = null;
  var games = [];
  var loading = false, loadError = null;
  var query = "", launcherFilter = "";
  var searchTimer = null;

  function load() {
    loading = true; loadError = null; render();
    var params = { limit: 500 };
    if (query) params.search = query;
    if (launcherFilter) params.launcher = launcherFilter;
    return Store.libraryGames(params)
      .then(function (body) { games = body.data || []; loading = false; render(); })
      .catch(function (err) { loading = false; games = []; loadError = err.message; render(); });
  }

  /* ==========================================================================
     ADD / EDIT
     ========================================================================== */
  function gameDialog(game, onDone) {
    var editing = !!game;
    game = game || { launcher: "Steam", auto_launch: true, enabled: true };

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="gName">Game name</label>' +
          '<input class="input" id="gName" placeholder="Counter-Strike 2" data-autofocus value="' + UI.esc(game.name || "") + '"></div>' +
        '<div class="field"><label class="field-label" for="gCategory">Category</label>' +
          '<input class="input" id="gCategory" placeholder="FPS" value="' + UI.esc(game.category || "") + '"></div>' +
      "</div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="gPublisher">Publisher</label>' +
          '<input class="input" id="gPublisher" placeholder="Valve" value="' + UI.esc(game.publisher || "") + '"></div>' +
        '<div class="field"><label class="field-label" for="gLauncher">Launcher</label>' +
          '<select class="select" id="gLauncher">' +
            LAUNCHERS.map(function (l) {
              return '<option value="' + l + '"' + (game.launcher === l ? " selected" : "") + ">" + l + "</option>";
            }).join("") +
          "</select></div>" +
      "</div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="gLaunchType">Launch type</label>' +
          '<input class="input" id="gLaunchType" placeholder="Steam App" value="' + UI.esc(game.launch_type || "") + '"></div>' +
        '<div class="field"><label class="field-label" for="gAppId">App ID</label>' +
          '<input class="input mono" id="gAppId" placeholder="730" value="' + UI.esc(game.app_id || "") + '">' +
          '<div class="field-hint">Steam appid, Epic id, etc. — what the launcher starts.</div></div>' +
      "</div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="gExe">Executable</label>' +
          '<input class="input mono" id="gExe" placeholder="cs2.exe" value="' + UI.esc(game.executable || "") + '"></div>' +
        '<div class="field"><label class="field-label" for="gProcess">Process name</label>' +
          '<input class="input mono" id="gProcess" placeholder="cs2.exe" value="' + UI.esc(game.process_name || "") + '">' +
          '<div class="field-hint">Watched to know when the game has closed.</div></div>' +
      "</div>" +
      '<div class="field"><label class="field-label" for="gArgs">Launch arguments</label>' +
        '<input class="input mono" id="gArgs" placeholder="Optional — e.g. -fullscreen -novid" value="' + UI.esc(game.launch_args || "") + '"></div>' +
      '<div class="row gap-4">' +
        '<label class="row gap-2" style="align-items:center;cursor:pointer">' +
          '<input type="checkbox" id="gAuto"' + (game.auto_launch !== false ? " checked" : "") + '> Auto-launch the game</label>' +
        '<label class="row gap-2" style="align-items:center;cursor:pointer">' +
          '<input type="checkbox" id="gEnabled"' + (game.enabled !== false ? " checked" : "") + '> Enabled</label>' +
      "</div>";

    /* Picking a launcher fills in a launch type if the field is still empty, so
       the common case is one click rather than remembering the exact wording. */
    var launcherSel = body.querySelector("#gLauncher");
    var launchTypeIn = body.querySelector("#gLaunchType");
    launcherSel.addEventListener("change", function () {
      if (!launchTypeIn.value.trim()) launchTypeIn.value = LAUNCH_TYPE_BY[launcherSel.value] || "";
    });

    return UI.modal({
      title: editing ? "Edit game" : "Add game",
      description: editing ? game.name : "Add a title to the library and say how to launch it.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: editing ? "Save" : "Add game", variant: "primary", icon: editing ? "check" : "plus",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#gName").value.trim();
            if (!name) { Motion.shake(ctx.body.querySelector("#gName")); UI.toast.warn("A game name is required"); return false; }
            var payload = {
              name: name,
              category: ctx.body.querySelector("#gCategory").value.trim() || null,
              publisher: ctx.body.querySelector("#gPublisher").value.trim() || null,
              launcher: ctx.body.querySelector("#gLauncher").value,
              launch_type: ctx.body.querySelector("#gLaunchType").value.trim() || null,
              app_id: ctx.body.querySelector("#gAppId").value.trim() || null,
              executable: ctx.body.querySelector("#gExe").value.trim() || null,
              process_name: ctx.body.querySelector("#gProcess").value.trim() || null,
              launch_args: ctx.body.querySelector("#gArgs").value.trim() || null,
              auto_launch: ctx.body.querySelector("#gAuto").checked,
              enabled: ctx.body.querySelector("#gEnabled").checked
            };
            var call = editing ? Store.updateGame(game.game_id, payload) : Store.createGame(payload);
            return call
              .then(function (r) {
                UI.toast.ok(editing ? "Game saved" : "Game added", r.data.name + " · " + r.data.launcher);
                if (onDone) onDone();
                return true;
              })
              .catch(function (e) { UI.toast.error(editing ? "Could not save" : "Could not add", e.message); return false; });
          }
        }
      ]
    });
  }

  function confirmDelete(game, onDone) {
    UI.modal({
      title: "Remove game",
      description: "Remove " + game.name + " from the library? Its per-station availability goes with it.",
      body: UI.el("div", { class: "notice", html: Icon("alert", 16) + "<div>This does not uninstall anything on a PC — it only removes the title from CafeXP's library.</div>", dataset: { status: "warning" } }),
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Remove", variant: "danger", icon: "trash",
          onClick: function () {
            return Store.deleteGame(game.game_id)
              .then(function () { UI.toast.ok("Removed", game.name); if (onDone) onDone(); return true; })
              .catch(function (e) { UI.toast.error("Could not remove", e.message); return false; });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     STATION AVAILABILITY — which titles are installed on a given PC
     ========================================================================== */
  function stationDialog() {
    var stations = (Store.state.pcs || []).filter(function (p) { return Store.isNetworked(p); });
    if (!stations.length) {
      UI.toast.warn("No stations", "Availability is set on stations that run the client agent.");
      return;
    }

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label" for="stPc">Station</label>' +
        '<select class="select" id="stPc">' +
          stations.map(function (p) { return '<option value="' + p.pc_id + '">' + UI.esc(p.name) + "</option>"; }).join("") +
        "</select></div>" +
      '<div class="row-between"><div class="faint" style="font-size:12px">Tick the games installed on this station.</div>' +
        '<div class="row gap-2"><button type="button" class="btn btn-ghost btn-sm" id="stAll">All</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="stNone">None</button></div></div>' +
      '<div id="stList" class="col gap-1" style="max-height:46vh;overflow:auto"></div>';

    var listHost = body.querySelector("#stList");
    var pcSel = body.querySelector("#stPc");

    function paint(rows) {
      UI.clear(listHost);
      rows.forEach(function (g) {
        var row = UI.el("label", { class: "row gap-3", style: { alignItems: "center", padding: "6px 8px", cursor: "pointer" } });
        row.innerHTML =
          '<input type="checkbox" data-gid="' + g.game_id + '"' + (g.installed ? " checked" : "") + '>' +
          '<span class="grow"><strong style="font-size:13px">' + UI.esc(g.name) + "</strong> " +
            '<span class="badge badge-plain">' + UI.esc(g.launcher) + "</span></span>";
        listHost.appendChild(row);
      });
    }

    function loadPc() {
      UI.clear(listHost); listHost.appendChild(UI.skeletonRows(4));
      Store.getPcGames(pcSel.value)
        .then(function (body) { paint(body.data.games || []); })
        .catch(function (e) { UI.clear(listHost); listHost.appendChild(UI.errorState(e.message)); });
    }
    pcSel.addEventListener("change", loadPc);
    body.querySelector("#stAll").addEventListener("click", function () {
      UI.$$("#stList input[type=checkbox]", body).forEach(function (c) { c.checked = true; });
    });
    body.querySelector("#stNone").addEventListener("click", function () {
      UI.$$("#stList input[type=checkbox]", body).forEach(function (c) { c.checked = false; });
    });
    loadPc();

    return UI.modal({
      title: "Games by station",
      description: "Choose which library titles are installed on each station.",
      size: "lg",
      body: body,
      actions: [
        { label: "Close", variant: "ghost" },
        {
          label: "Save availability", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var ids = UI.$$("#stList input[type=checkbox]:checked", ctx.body).map(function (c) { return Number(c.dataset.gid); });
            return Store.setPcGames(pcSel.value, ids)
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
        title: query || launcherFilter ? "No games match" : "No games yet",
        text: query || launcherFilter ? "Nothing matches the current filter." : "Add your first title to the library.",
        actions: [{ label: "Add game", icon: "plus", variant: "primary", onClick: function () { gameDialog(null, load); } }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Game</th><th>Launcher</th><th>Launch</th>" +
      '<th class="td-num">PCs</th><th>Status</th><th></th></tr></thead>';
    var tbody = UI.el("tbody");

    games.forEach(function (g) {
      var tr = UI.el("tr");
      var launchBits = [g.launch_type, g.app_id ? "#" + g.app_id : null, g.executable].filter(Boolean).join(" · ") || "—";
      tr.innerHTML =
        "<td><div><strong>" + UI.esc(g.name) + "</strong>" +
          (g.category ? ' <span class="badge badge-plain">' + UI.esc(g.category) + "</span>" : "") +
          (g.publisher ? '<div class="faint" style="font-size:11px">' + UI.esc(g.publisher) + "</div>" : "") +
          "</div></td>" +
        '<td><span class="badge" data-status="accent">' + UI.esc(g.launcher) + "</span></td>" +
        '<td class="faint mono" style="font-size:11px">' + UI.esc(launchBits) + "</td>" +
        '<td class="td-num">' + (g.pc_count || 0) + "</td>" +
        "<td>" + (g.enabled
          ? '<span class="badge" data-status="online">Enabled</span>'
          : '<span class="badge">Off</span>') + "</td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");
      var edit = UI.el("button", { class: "btn btn-outline btn-sm", html: Icon("edit", 13) });
      edit.addEventListener("click", function () { gameDialog(g, load); });
      var del = UI.el("button", { class: "btn btn-ghost btn-sm", html: Icon("trash", 13) });
      del.addEventListener("click", function () { confirmDelete(g, load); });
      actions.appendChild(edit); actions.appendChild(del);
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
    subtitle: "Titles you offer and how to launch them",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div><div class=\"page-title\">Game Library</div>" +
            '<div class="page-sub">Every game your PCs can run, and how each one launches.</div></div>' +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="glStations">' + Icon("devices", 15) + '<span class="btn-label">Games by station</span></button>' +
            '<button class="btn btn-primary" id="glAdd">' + Icon("plus", 15) + '<span class="btn-label">Add game</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="toolbar">' +
          '<div class="search" style="width:320px">' + Icon("search", 15) +
            '<input class="input" id="glSearch" type="search" placeholder="Search game or publisher…" autocomplete="off"></div>' +
          '<div class="row gap-2" id="glLaunchers"></div>' +
        "</div>" +
        '<div class="card card-body-flush" id="gameTable"></div>';
      root.appendChild(page);

      /* Launcher filter chips: All, then one per launcher. */
      var chipRow = page.querySelector("#glLaunchers");
      [["", "All"]].concat(LAUNCHERS.map(function (l) { return [l, l]; })).forEach(function (pair) {
        var chip = UI.el("button", {
          class: "chip", html: pair[1],
          dataset: { launcher: pair[0] }
        });
        if (pair[0] === launcherFilter) { chip.setAttribute("aria-pressed", "true"); chip.setAttribute("data-status", "accent"); }
        chip.addEventListener("click", function () {
          launcherFilter = pair[0];
          UI.$$("#glLaunchers .chip", page).forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
            if (c === chip) c.setAttribute("data-status", "accent"); else c.removeAttribute("data-status");
          });
          load();
        });
        chipRow.appendChild(chip);
      });

      var search = page.querySelector("#glSearch");
      search.value = query;
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { query = search.value.trim(); load(); }, 260);
      });

      page.querySelector("#glAdd").addEventListener("click", function () { gameDialog(null, load); });
      page.querySelector("#glStations").addEventListener("click", function () { stationDialog(); });

      render();
      load();
    },

    unmount: function () { clearTimeout(searchTimer); rootEl = null; }
  };
})(window);
