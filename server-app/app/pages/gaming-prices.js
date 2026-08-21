/* ==========================================================================
   CafeXP Admin — Gaming Price Master
   One price per game + session pair. The screen shows names and durations by
   joining the masters; only software_id, session_master_id and price are sent.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var rows = [];
  var games = [];
  var sessions = [];
  var loading = false;
  var loadError = null;
  var query = "";
  var statusFilter = "";
  var gameFilter = "";
  var searchTimer = null;

  function money(value, currency) {
    var n = Number(value || 0);
    var whole = Math.round(n * 100) % 100 === 0;
    var num;
    try {
      num = new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2
      }).format(n);
    } catch (e) { num = whole ? String(Math.round(n)) : n.toFixed(2); }
    return (currency === "INR" || !currency ? "₹" : currency + " ") + num;
  }

  function durationText(row) {
    if (row.duration_minutes === null || row.duration_minutes === undefined) return "Unlimited";
    return row.duration_minutes + " min";
  }

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function loadMasters() {
    return Promise.all([
      Store.listGames({ limit: 200 }),
      Store.listSessionMaster({ status: "ACTIVE", limit: 200 })
    ]).then(function (res) {
      // Only active records can be priced, so filter here as well as server-side.
      games = (res[0].data || []).filter(function (g) { return g.is_active !== false; });
      sessions = res[1].data || [];
    });
  }

  function load() {
    loading = true;
    loadError = null;
    render();
    return Promise.all([
      loadMasters(),
      Store.listGamingPrices({
        search: query, status: statusFilter, software_id: gameFilter, limit: 200
      })
    ])
      .then(function (res) { rows = res[1].data || []; loading = false; render(); })
      .catch(function (err) { loading = false; loadError = err.message; rows = []; render(); });
  }

  /* ==========================================================================
     ADD / EDIT
     ========================================================================== */
  function priceForm(existing) {
    var isEdit = !!existing;

    if (!games.length) {
      UI.toast.warn("No games available", "Add a game to the catalogue first.");
      return;
    }
    if (!sessions.length) {
      UI.toast.warn("No active sessions", "Create a session in Session Master first.");
      return;
    }

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field">' +
        '<label class="field-label field-req" for="gpGame">Game</label>' +
        '<select class="select" id="gpGame">' +
          '<option value="">— Select game —</option>' +
          games.map(function (g) {
            return '<option value="' + g.software_id + '"' +
              (existing && existing.software_id === g.software_id ? " selected" : "") + ">" +
              UI.esc(g.software_name) + "</option>";
          }).join("") +
        "</select>" +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label field-req" for="gpSession">Session</label>' +
        '<select class="select" id="gpSession">' +
          '<option value="">— Select session —</option>' +
          sessions.map(function (s) {
            return '<option value="' + s.id + '"' +
              (existing && existing.session_master_id === s.id ? " selected" : "") + ">" +
              UI.esc(s.session_name) + "</option>";
          }).join("") +
        "</select>" +
      "</div>" +

      // Read-only: the duration always comes from Session Master.
      '<div class="field">' +
        '<label class="field-label">Duration</label>' +
        '<input class="input" id="gpDuration" value="—" disabled>' +
        '<div class="field-hint">Taken from Session Master — not stored with the price.</div>' +
      "</div>" +

      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field">' +
          '<label class="field-label field-req" for="gpPrice">Price</label>' +
          '<input class="input" id="gpPrice" type="number" min="0" step="0.01" placeholder="80" ' +
            'value="' + UI.esc(existing ? existing.price : "") + '">' +
        "</div>" +
        '<div class="field">' +
          '<label class="field-label" for="gpCurrency">Currency</label>' +
          '<input class="input" id="gpCurrency" value="' + UI.esc(existing ? existing.currency : "INR") + '" maxlength="8">' +
        "</div>" +
      "</div>" +

      '<div class="notice" data-status="idle" id="gpPreview"></div>' +

      '<label class="switch">' +
        '<input type="checkbox" id="gpStatus"' +
          (!existing || existing.status === "ACTIVE" ? " checked" : "") + '>' +
        '<span class="switch-track"></span>' +
        '<span style="font-size:13px">Active — available when starting a session</span>' +
      "</label>";

    var dialog = UI.modal({
      title: isEdit ? "Edit price" : "Add price",
      description: isEdit
        ? existing.software_name + " · " + existing.session_name
        : "Set what a game costs for a given session length.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isEdit ? "Save changes" : "Save price",
          variant: "primary",
          icon: "check",
          onClick: function (ctx) {
            var softwareId = parseInt(ctx.body.querySelector("#gpGame").value, 10);
            var sessionId = parseInt(ctx.body.querySelector("#gpSession").value, 10);
            var priceRaw = ctx.body.querySelector("#gpPrice").value;

            if (!softwareId) {
              Motion.shake(ctx.body.querySelector("#gpGame"));
              UI.toast.warn("Choose a game");
              return false;
            }
            if (!sessionId) {
              Motion.shake(ctx.body.querySelector("#gpSession"));
              UI.toast.warn("Choose a session");
              return false;
            }
            if (priceRaw === "" || Number(priceRaw) < 0 || !Number.isFinite(Number(priceRaw))) {
              Motion.shake(ctx.body.querySelector("#gpPrice"));
              UI.toast.warn("Enter a price of zero or more");
              return false;
            }

            var payload = {
              software_id: softwareId,
              session_master_id: sessionId,
              price: Number(priceRaw),
              currency: (ctx.body.querySelector("#gpCurrency").value || "INR").trim().toUpperCase(),
              status: ctx.body.querySelector("#gpStatus").checked ? "ACTIVE" : "INACTIVE"
            };

            var call = isEdit
              ? Store.updateGamingPrice(existing.id, payload)
              : Store.createGamingPrice(payload);

            return call
              .then(function (r) {
                UI.toast.ok(isEdit ? "Price updated" : "Price saved",
                  r.data.software_name + " · " + r.data.session_name + " · " + money(r.data.price, r.data.currency));
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) {
                UI.toast.error("Could not save the price", err.message);
                return false;
              });
          }
        }
      ]
    });

    /* Duration mirrors the chosen session; a live check warns about duplicates
       before the server has to reject them. */
    var gameSelect = body.querySelector("#gpGame");
    var sessionSelect = body.querySelector("#gpSession");
    var durationInput = body.querySelector("#gpDuration");
    var priceInput = body.querySelector("#gpPrice");
    var preview = body.querySelector("#gpPreview");

    function selectedSession() {
      var id = parseInt(sessionSelect.value, 10);
      return sessions.filter(function (s) { return s.id === id; })[0] || null;
    }

    function refresh() {
      var session = selectedSession();
      durationInput.value = !session ? "—"
        : session.duration_minutes === null ? "Unlimited"
        : session.duration_minutes + " minutes";

      var softwareId = parseInt(gameSelect.value, 10);
      if (!softwareId || !session) {
        preview.setAttribute("data-status", "idle");
        preview.innerHTML = Icon("info", 16) + "<div>Pick a game and a session.</div>";
        return;
      }

      // Warn early if this pair is already priced by someone else.
      var clash = rows.filter(function (r) {
        return r.software_id === softwareId && r.session_master_id === session.id &&
               (!existing || r.id !== existing.id);
      })[0];

      if (clash) {
        preview.setAttribute("data-status", "offline");
        preview.innerHTML = Icon("alert", 16) +
          "<div>This pair already has a price of <strong>" + money(clash.price, clash.currency) +
          "</strong>. Edit that record instead — each game and session pair can only be priced once.</div>";
        return;
      }

      var game = games.filter(function (g) { return g.software_id === softwareId; })[0];
      var price = Number(priceInput.value);
      preview.setAttribute("data-status", "accent");
      preview.innerHTML = Icon("check", 16) +
        "<div><strong>" + UI.esc(game ? game.software_name : "") + "</strong> → " +
        UI.esc(session.session_name) + " → " +
        (session.duration_minutes === null ? "unlimited" : session.duration_minutes + " min") +
        (Number.isFinite(price) && priceInput.value !== "" ? " → <strong>" + money(price) + "</strong>" : "") +
        "</div>";
    }

    gameSelect.addEventListener("change", refresh);
    sessionSelect.addEventListener("change", refresh);
    priceInput.addEventListener("input", refresh);
    refresh();

    return dialog;
  }

  /* ==========================================================================
     TABLE
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#gpTable");
    if (!host) return;
    UI.clear(host);

    var gameSelect = rootEl.querySelector("#gpGameFilter");
    if (gameSelect && gameSelect.options.length <= 1 && games.length) {
      games.forEach(function (g) {
        var opt = document.createElement("option");
        opt.value = g.software_id;
        opt.textContent = g.software_name;
        gameSelect.appendChild(opt);
      });
      gameSelect.value = gameFilter;
    }

    if (loading && !rows.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (loadError) { host.appendChild(UI.errorState(loadError, load)); return; }

    if (!rows.length) {
      host.appendChild(UI.emptyState({
        icon: "billing",
        title: query || statusFilter || gameFilter ? "No prices match" : "No prices configured",
        text: query || statusFilter || gameFilter
          ? "Nothing matches the current search and filters."
          : "Set what each game costs for each session length.",
        actions: [{
          label: query || statusFilter || gameFilter ? "Clear filters" : "Add price",
          icon: query || statusFilter || gameFilter ? "close" : "plus",
          variant: "primary",
          onClick: function () {
            if (query || statusFilter || gameFilter) {
              query = ""; statusFilter = ""; gameFilter = "";
              rootEl.querySelector("#gpSearch").value = "";
              if (gameSelect) gameSelect.value = "";
              syncFilters();
              load();
            } else priceForm(null);
          }
        }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>ID</th><th>Game</th><th>Session</th>" +
      "<th class='td-num'>Duration</th><th class='td-num'>Price</th>" +
      "<th>Status</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    rows.forEach(function (row) {
      var active = row.status === "ACTIVE";
      var tr = UI.el("tr", { dataset: { status: active ? "online" : "idle" } });
      tr.innerHTML =
        '<td class="mono faint">#' + row.price_id + "</td>" +
        "<td><strong>" + UI.esc(row.software_name) + "</strong></td>" +
        "<td>" + UI.esc(row.session_name) +
          (row.is_unlimited ? ' <span class="badge badge-plain">Unlimited</span>' : "") + "</td>" +
        '<td class="td-num mono">' + UI.esc(durationText(row)) + "</td>" +
        '<td class="td-num" style="font-weight:700">' + UI.esc(money(row.price, row.currency)) + "</td>" +
        '<td><span class="badge" data-status="' + (active ? "online" : "idle") + '">' +
          (active ? "Active" : "Inactive") + "</span></td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");

      var editBtn = UI.el("button", {
        class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit"
      });
      editBtn.addEventListener("click", function () { priceForm(row); });

      var toggleBtn = UI.el("button", {
        class: "btn btn-sm btn-icon " + (active ? "btn-warn" : "btn-ok"),
        html: Icon(active ? "pause" : "check", 13),
        "data-tip": active ? "Deactivate" : "Activate"
      });
      toggleBtn.addEventListener("click", function () {
        Store.setGamingPriceStatus(row.id, active ? "INACTIVE" : "ACTIVE")
          .then(function (r) { UI.toast.ok(r.message); return load(); })
          .catch(function (err) { UI.toast.error("Could not update status", err.message); });
      });

      var delBtn = UI.el("button", {
        class: "btn btn-danger btn-sm btn-icon", html: Icon("trash", 13), "data-tip": "Delete"
      });
      delBtn.addEventListener("click", function () {
        UI.confirm({
          title: "Delete this price?",
          message: row.software_name + " · " + row.session_name + " · " + money(row.price, row.currency) +
            ". The game and session themselves are not affected.",
          confirmLabel: "Delete",
          variant: "danger"
        }).then(function (ok) {
          if (!ok) return;
          Store.deleteGamingPrice(row.id)
            .then(function () { UI.toast.ok("Price deleted"); return load(); })
            .catch(function (err) { UI.toast.error("Could not delete", err.message); });
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(toggleBtn);
      actions.appendChild(delBtn);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function syncFilters() {
    if (!rootEl) return;
    UI.$$("#gpFilters .chip", rootEl).forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.dataset.status === statusFilter));
    });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages["gaming-prices"] = {
    title: "Gaming Price Master",
    subtitle: "What each game costs per session",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Gaming Price Master</div>' +
            '<div class="page-sub">Game → Session → Duration → Price. Names and durations come from the masters.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="gpRefresh">' + Icon("refresh", 15) +
              '<span class="btn-label">Refresh</span></button>' +
            '<button class="btn btn-primary" id="gpAdd">' + Icon("plus", 15) +
              '<span class="btn-label">Add price</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="toolbar">' +
          '<div class="search" style="width:280px">' + Icon("search", 15) +
            '<input class="input" id="gpSearch" type="search" placeholder="Search game or session…" autocomplete="off">' +
          "</div>" +
          '<select class="select" id="gpGameFilter" style="width:200px">' +
            '<option value="">All games</option>' +
          "</select>" +
          '<div class="row gap-2" id="gpFilters">' +
            '<button class="chip" data-status="" aria-pressed="true">All</button>' +
            '<button class="chip" data-status="ACTIVE">Active</button>' +
            '<button class="chip" data-status="INACTIVE">Inactive</button>' +
          "</div>" +
        "</div>" +
        '<div class="card card-body-flush" id="gpTable"></div>';
      root.appendChild(page);

      page.querySelector("#gpAdd").addEventListener("click", function () { priceForm(null); });

      var refreshBtn = page.querySelector("#gpRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return load(); });
      });

      var search = page.querySelector("#gpSearch");
      search.value = query;
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { query = search.value.trim(); load(); }, 250);
      });

      page.querySelector("#gpGameFilter").addEventListener("change", function (e) {
        gameFilter = e.target.value;
        load();
      });

      UI.$$("#gpFilters .chip", page).forEach(function (chip) {
        chip.addEventListener("click", function () {
          statusFilter = chip.dataset.status;
          syncFilters();
          load();
        });
      });

      syncFilters();
      load();
    },

    unmount: function () {
      clearTimeout(searchTimer);
      rootEl = null;
    }
  };
})(window);
