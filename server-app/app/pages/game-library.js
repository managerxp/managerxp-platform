/* ==========================================================================
   CafeXP — Game Library
   The café's selection from ManagerXP's master Game Catalog, over /api/games.
   A café never authors a title's App ID, executable or artwork — all of that
   lives in ManagerXP's catalog and is read-only here. A café can only browse
   the catalog, add or remove a title from its own library, switch one on or
   off, and say which of its PCs has it installed.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

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
     ADD FROM CATALOG — browse ManagerXP's titles and pick one
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
        var already = !!haveIds[g.game_id];
        var row = UI.el("div", { class: "row gap-3", style: { alignItems: "center", padding: "6px 8px" } });
        row.innerHTML =
          '<div class="sw-icon" style="width:36px;height:36px;border-radius:9px;overflow:hidden;background:var(--bg-inset);flex:0 0 auto;display:flex;align-items:center;justify-content:center">' +
            (g.logo_url ? '<img src="' + UI.esc(Store.API_BASE + g.logo_url) + '" style="width:100%;height:100%;object-fit:cover">' : Icon("games", 18)) +
          "</div>" +
          '<span class="grow"><strong style="font-size:13px">' + UI.esc(g.name) + "</strong> " +
            '<span class="badge badge-plain">' + UI.esc(g.launcher) + "</span>" +
            (g.publisher ? '<div class="faint" style="font-size:11px">' + UI.esc(g.publisher) + "</div>" : "") +
          "</span>";
        var btn = UI.el("button", {
          class: already ? "btn btn-ghost btn-sm" : "btn btn-outline btn-sm",
          html: already ? "Added" : (Icon("plus", 13) + '<span class="btn-label">Add</span>')
        });
        btn.disabled = already;
        btn.addEventListener("click", function () {
          btn.disabled = true;
          Store.addGame(g.game_id)
            .then(function (r) {
              UI.toast.ok("Added", r.data.name);
              haveIds[g.game_id] = true;
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
      description: "Pick from ManagerXP's game catalog — its launcher, App ID and executable are already configured.",
      size: "lg",
      body: body,
      actions: [{ label: "Done", variant: "primary", onClick: function () { if (onDone) onDone(); return true; } }]
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
      if (!rows.length) { listHost.appendChild(UI.emptyState({ icon: "games", title: "No games yet", text: "Add a game to your library first." })); return; }
      rows.forEach(function (g) {
        var row = UI.el("label", { class: "row gap-3", style: { alignItems: "center", padding: "6px 8px", cursor: "pointer" } });
        row.innerHTML =
          '<input type="checkbox" data-cgid="' + g.cafe_game_id + '"' + (g.installed ? " checked" : "") + '>' +
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
            var ids = UI.$$("#stList input[type=checkbox]:checked", ctx.body).map(function (c) { return Number(c.dataset.cgid); });
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
        title: query ? "No games match" : "No games yet",
        text: query ? "Nothing matches the current search." : "Add a title from ManagerXP's catalog to get started.",
        actions: [{ label: "Add game", icon: "plus", variant: "primary", onClick: function () { catalogDialog(load); } }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Game</th><th>Launcher</th>" +
      '<th class="td-num">PCs</th><th>Status</th><th></th></tr></thead>';
    var tbody = UI.el("tbody");

    games.forEach(function (g) {
      var tr = UI.el("tr");
      tr.innerHTML =
        "<td><div class=\"row gap-2\" style=\"align-items:center\">" +
          '<div class="sw-icon" style="width:28px;height:28px;border-radius:7px;overflow:hidden;background:var(--bg-inset);flex:0 0 auto;display:flex;align-items:center;justify-content:center">' +
            (g.logo_url ? '<img src="' + UI.esc(Store.API_BASE + g.logo_url) + '" style="width:100%;height:100%;object-fit:cover">' : Icon("games", 14)) +
          "</div><div><strong>" + UI.esc(g.name) + "</strong>" +
          (g.category ? ' <span class="badge badge-plain">' + UI.esc(g.category) + "</span>" : "") +
          (g.publisher ? '<div class="faint" style="font-size:11px">' + UI.esc(g.publisher) + "</div>" : "") +
          "</div></div></td>" +
        '<td><span class="badge" data-status="accent">' + UI.esc(g.launcher) + "</span></td>" +
        '<td class="td-num">' + (g.pc_count || 0) + "</td>" +
        "<td></td>" +
        '<td class="td-actions"></td>';

      var statusCell = tr.children[3];
      var statusBtn = UI.el("button", {
        class: "btn btn-sm " + (g.enabled ? "btn-outline" : "btn-ghost"),
        html: g.enabled ? '<span class="badge" data-status="online">Enabled</span>' : '<span class="badge">Off</span>'
      });
      statusBtn.addEventListener("click", function () { toggleEnabled(g); });
      statusCell.appendChild(statusBtn);

      var actions = tr.querySelector(".td-actions");
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
            '<div class="page-sub">Pick titles from ManagerXP\'s catalog and say which stations have them.</div></div>' +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="glStations">' + Icon("devices", 15) + '<span class="btn-label">Games by station</span></button>' +
            '<button class="btn btn-primary" id="glAdd">' + Icon("plus", 15) + '<span class="btn-label">Add game</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="toolbar">' +
          '<div class="search" style="width:320px">' + Icon("search", 15) +
            '<input class="input" id="glSearch" type="search" placeholder="Search game or publisher…" autocomplete="off"></div>' +
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
