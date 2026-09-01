/* ==========================================================================
   CafeXP — Game Credentials
   How players get into each game (their own account, the café's, or a
   choice), and the café's own venue accounts/licences that back that choice.
   Pulled into its own page rather than left inside each game's settings in
   the Game Library — a café that wants "Just Play" working for a title needs
   to find this in one place, not discover a hidden gear icon first.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var ACCOUNT_MODES = [
    ["CUSTOMER_ACCOUNT", "Customer's own account"],
    ["VENUE_ACCOUNT", "Venue account"],
    ["CUSTOMER_OR_VENUE", "Either"]
  ];

  var rootEl = null, bodyEl = null;
  var games = [], loading = true, loadError = null;

  function load() {
    loading = true; loadError = null; render();
    return Store.libraryGames({ limit: 500 })
      .then(function (body) { games = body.data || []; loading = false; render(); })
      .catch(function (err) { loading = false; games = []; loadError = err.message; render(); });
  }

  /* One row per (game, platform) — accounts belong to a platform, and a game
     with two platforms installed needs its own answer for each. */
  function rows() {
    var out = [];
    games.forEach(function (g) {
      (g.platforms || []).forEach(function (p) {
        out.push({ game: g, platform: p });
      });
    });
    return out;
  }

  /* ==========================================================================
     VENUE ACCOUNTS — the café's own logins for one platform
     ========================================================================== */
  function accountsDialog(game, platform) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div id="vaList"></div>' +
      '<div class="row-between" style="align-items:center">' +
        '<div class="faint" style="font-size:11px">Passwords are stored encrypted and are never shown again.</div>' +
        '<button type="button" class="btn btn-outline btn-sm" id="vaAdd">' + Icon("plus", 13) +
          '<span class="btn-label">Add licence</span></button>' +
      "</div>";

    var listHost = body.querySelector("#vaList");

    function paint(list) {
      UI.clear(listHost);
      if (!list.length) {
        listHost.appendChild(UI.emptyState({
          icon: "customers", title: "No venue accounts yet",
          text: "Add the café's own logins for this platform so players can just play."
        }));
        return;
      }
      var table = UI.el("table", { class: "tbl" });
      table.innerHTML = "<thead><tr><th>Name</th><th>Username</th><th>Profile</th><th>Status</th><th></th></tr></thead>";
      var tbody = UI.el("tbody");
      list.forEach(function (a) {
        var tr = UI.el("tr");
        var tone = a.status === "AVAILABLE" ? "online" : a.status === "IN_USE" ? "accent" : "idle";
        tr.innerHTML =
          "<td><strong>" + UI.esc(a.account_name) + "</strong>" +
            (a.has_password ? "" : '<div class="faint" style="font-size:10px">no password saved</div>') + "</td>" +
          '<td class="faint mono" style="font-size:11px">' + UI.esc(a.username || "—") + "</td>" +
          '<td class="faint" style="font-size:11px">' + UI.esc(a.profile_identifier || "—") + "</td>" +
          '<td><span class="badge" data-status="' + tone + '">' +
            (a.status === "IN_USE" ? "In use" : a.status === "AVAILABLE" ? "Available" : "Disabled") + "</span></td>" +
          '<td class="td-actions"></td>';

        var actions = tr.querySelector(".td-actions");
        if (a.status !== "IN_USE") {
          var toggle = UI.el("button", {
            class: "btn btn-ghost btn-sm",
            html: a.status === "AVAILABLE" ? "Disable" : "Enable"
          });
          toggle.addEventListener("click", function () {
            Store.updateVenueAccount(platform.id, a.id, {
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
              Store.removeVenueAccount(platform.id, a.id)
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
      return Store.venueAccounts(platform.id)
        .then(function (r) { paint(r.data || []); })
        .catch(function (e) { UI.clear(listHost); listHost.appendChild(UI.errorState(e.message)); });
    }

    body.querySelector("#vaAdd").addEventListener("click", function () { addAccountDialog(platform, loadAccounts); });
    loadAccounts();

    return UI.modal({
      title: "Venue accounts — " + game.name + " (" + platform.platform + ")",
      description: "The café's own logins, handed out one per session and returned when it ends.",
      size: "lg",
      body: body,
      actions: [{ label: "Close", variant: "ghost" }]
    });
  }

  function addAccountDialog(platform, onDone) {
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
            return Store.addVenueAccount(platform.id, {
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

  /* ==========================================================================
     PAGE
     ========================================================================== */
  function setMode(game, platform, mode, selectEl) {
    var previous = selectEl.dataset.current;
    selectEl.disabled = true;
    Store.updateCafeGame(game.cafe_game_id, { account_mode: mode })
      .then(function () {
        selectEl.dataset.current = mode;
        game.account_mode = mode;
        UI.toast.ok("Saved", game.name + " — " + platform.platform);
      })
      .catch(function (e) {
        selectEl.value = previous;
        UI.toast.error("Could not save", e.message);
      })
      .then(function () { selectEl.disabled = false; });
  }

  function render() {
    if (!bodyEl) return;
    UI.clear(bodyEl);

    if (loading) { bodyEl.appendChild(UI.skeletonRows(5)); return; }
    if (loadError) { bodyEl.appendChild(UI.errorState(loadError, load)); return; }

    var list = rows();
    if (!list.length) {
      bodyEl.appendChild(UI.emptyState({
        icon: "games", title: "No games with a platform yet",
        text: "Add a game to your library and give it a platform before setting up how players log in."
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML = "<thead><tr><th>Game</th><th>Platform</th><th>How players get in</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    list.forEach(function (row) {
      var g = row.game, p = row.platform;
      var tr = UI.el("tr");
      tr.innerHTML =
        "<td><div class=\"row gap-2\" style=\"align-items:center\">" +
          '<div class="sw-icon" style="width:28px;height:28px;border-radius:7px;overflow:hidden;background:var(--bg-inset);flex:0 0 auto;display:flex;align-items:center;justify-content:center">' +
            (g.icon_url ? '<img src="' + UI.esc(Store.API_BASE + g.icon_url) + '" style="width:100%;height:100%;object-fit:cover">' : Icon("games", 14)) +
          "</div><strong>" + UI.esc(g.name) + "</strong></div></td>" +
        '<td class="faint" style="font-size:12px">' + UI.esc(p.platform) + "</td>" +
        '<td></td>' +
        '<td class="td-actions"></td>';

      var modeCell = tr.children[2];
      var select = UI.el("select", { class: "select", style: { fontSize: "12px", padding: "4px 8px" } });
      select.dataset.current = g.account_mode;
      ACCOUNT_MODES.forEach(function (m) {
        var opt = UI.el("option", { text: m[1] });
        opt.value = m[0];
        if (g.account_mode === m[0]) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", function () { setMode(g, p, select.value, select); });
      modeCell.appendChild(select);

      var actions = tr.querySelector(".td-actions");
      var accounts = UI.el("button", {
        class: "btn btn-outline btn-sm",
        html: Icon("customers", 13) + '<span class="btn-label">Accounts</span>'
      });
      accounts.addEventListener("click", function () { accountsDialog(g, p); });
      actions.appendChild(accounts);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    bodyEl.appendChild(wrap);
    Motion.enter(wrap, { y: 8, duration: 0.2 });
  }

  global.CXPages.credentials = {
    title: "Game Credentials",
    subtitle: "How players get into each game, and the café's own logins",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Game Credentials</div>' +
            '<div class="page-sub">Own account, venue account, or either — and the café\'s licence pool behind it</div>' +
          "</div>" +
        "</div>" +
        '<div id="credBody"></div>';
      root.appendChild(page);
      bodyEl = page.querySelector("#credBody");
      load();
    },

    unmount: function () {
      rootEl = null; bodyEl = null;
    }
  };
})(window);
