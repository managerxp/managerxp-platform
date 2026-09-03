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
     HOUSE ACTIVITIES

     A pool table or a dartboard is something the café sells time on but that
     ManagerXP never published, so it cannot come from the catalogue. Added
     here, beside the prices, because "I want to charge for the pool table" and
     "I want to set the pool table's price" are one errand.
     ========================================================================== */
  function knownCategories() {
    var seen = {};
    games.forEach(function (g) { if (g.category) seen[g.category] = true; });
    return Object.keys(seen).sort();
  }

  function activityForm() {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="gaName">Name</label>' +
        '<input class="input" id="gaName" placeholder="Pool Table" data-autofocus>' +
        '<div class="field-hint">What staff and the bill will call it.</div></div>' +
      '<div class="field"><label class="field-label" for="gaCategory">Category</label>' +
        '<input class="input" id="gaCategory" list="gaCategoryList" maxlength="60" placeholder="Pool">' +
        '<datalist id="gaCategoryList">' +
          knownCategories().map(function (c) {
            return '<option value="' + UI.esc(c) + '"></option>';
          }).join("") +
        "</datalist>" +
        '<div class="field-hint">Groups it on the till. Type a new one to create it.</div></div>' +
      '<div class="notice" data-status="idle">' + Icon("info", 16) +
        "<div>Added to this café's own list. Give it a price next, and it appears " +
        "on the till.</div></div>";

    return UI.modal({
      title: "Add activity",
      description: "Something you charge for that is not in the catalogue — a pool table, a dartboard, a racing rig.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Add", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#gaName").value.trim();
            if (!name) {
              Motion.shake(ctx.body.querySelector("#gaName"));
              UI.toast.warn("Give it a name");
              return false;
            }
            return Store.createHouseActivity({
              software_name: name,
              category: ctx.body.querySelector("#gaCategory").value.trim()
            })
              .then(function (r) {
                UI.toast.ok("Activity added", r.data.software_name);
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) {
                UI.toast.error("Could not add", err.message);
                return false;
              });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     ADD / EDIT
     ========================================================================== */
  function priceForm(existing) {
    var isEdit = !!existing;

    /* No games is no longer a dead end: the picker below can create one. Only
       an empty Session Master still blocks, because a price is per duration
       and there is nothing sensible to invent there. */
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
          /* Anything the café charges for that is not in the list — a VR rig,
             a pool table, a racing seat. Creating it here rather than sending
             someone to another screen and back: "price the VR rig" is one
             errand, not two.

             Offered only when adding. Repointing an existing price at a
             freshly invented activity is not an edit anyone means to make. */
          (isEdit ? "" : '<option value="__new">＋ Something else — type a name…</option>') +
        "</select>" +
      "</div>" +

      /* Revealed only when "something else" is chosen. */
      '<div class="field hidden" id="gpNewWrap">' +
        '<label class="field-label field-req" for="gpNewName">New activity</label>' +
        '<input class="input" id="gpNewName" maxlength="255" placeholder="VR Arena">' +
        '<div class="row gap-2" style="margin-top:var(--s-2)">' +
          '<input class="input" id="gpNewCategory" list="gpNewCatList" maxlength="60" ' +
            'placeholder="Category — VR, Pool, Darts">' +
          '<datalist id="gpNewCatList">' +
            knownCategories().map(function (c) {
              return '<option value="' + UI.esc(c) + '"></option>';
            }).join("") +
          "</datalist>" +
        "</div>" +
        '<div class="field-hint">Added to this café\'s own list and priced in one go. ' +
          "The category is the tab it appears under on the till.</div>" +
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
            var gameSel = ctx.body.querySelector("#gpGame");
            var creating = gameSel.value === "__new";
            var softwareId = creating ? null : parseInt(gameSel.value, 10);
            var sessionId = parseInt(ctx.body.querySelector("#gpSession").value, 10);
            var priceRaw = ctx.body.querySelector("#gpPrice").value;
            var newName = ctx.body.querySelector("#gpNewName").value.trim();

            if (creating && !newName) {
              Motion.shake(ctx.body.querySelector("#gpNewName"));
              UI.toast.warn("Name the new activity");
              return false;
            }
            if (!creating && !softwareId) {
              Motion.shake(gameSel);
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

            var base = {
              session_master_id: sessionId,
              price: Number(priceRaw),
              currency: (ctx.body.querySelector("#gpCurrency").value || "INR").trim().toUpperCase(),
              status: ctx.body.querySelector("#gpStatus").checked ? "ACTIVE" : "INACTIVE"
            };

            /* Creating first, then pricing. If the price fails the activity is
               left behind — deliberately, and said so below: it is a real thing
               the café now has, and silently deleting it would lose the name
               they just typed. They can price it from the list. */
            var resolveGame = creating
              ? Store.createHouseActivity({
                  software_name: newName,
                  category: ctx.body.querySelector("#gpNewCategory").value.trim()
                }).then(function (r) { return r.data.software_id; })
              : Promise.resolve(softwareId);

            return resolveGame
              .then(function (id) {
                var payload = Object.assign({ software_id: id }, base);
                return isEdit
                  ? Store.updateGamingPrice(existing.id, payload)
                  : Store.createGamingPrice(payload);
              })
              .then(function (r) {
                UI.toast.ok(isEdit ? "Price updated" : "Price saved",
                  r.data.software_name + " · " + r.data.session_name + " · " + money(r.data.price, r.data.currency));
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) {
                if (creating) {
                  /* Reload regardless: if the activity was created and only the
                     price failed, it must appear in the list rather than seem
                     to have vanished. */
                  load();
                }
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

    var newWrap = body.querySelector("#gpNewWrap");
    var newName = body.querySelector("#gpNewName");

    function refresh() {
      var session = selectedSession();
      durationInput.value = !session ? "—"
        : session.duration_minutes === null ? "Unlimited"
        : session.duration_minutes + " minutes";

      var creating = gameSelect.value === "__new";
      newWrap.classList.toggle("hidden", !creating);

      /* A brand new activity cannot clash with an existing price, and its name
         is the thing being previewed rather than a row in `games`. */
      if (creating) {
        var typed = newName.value.trim();
        var newPrice = Number(priceInput.value);
        if (!typed || !session) {
          preview.setAttribute("data-status", "idle");
          preview.innerHTML = Icon("info", 16) +
            "<div>Name the activity and pick a session.</div>";
          return;
        }
        preview.setAttribute("data-status", "accent");
        preview.innerHTML = Icon("check", 16) +
          "<div>Creates <strong>" + UI.esc(typed) + "</strong> and prices it at " +
          UI.esc(session.session_name) + " → " +
          (session.duration_minutes === null ? "unlimited" : session.duration_minutes + " min") +
          (Number.isFinite(newPrice) && priceInput.value !== ""
            ? " → <strong>" + money(newPrice) + "</strong>" : "") +
          ".</div>";
        return;
      }

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

    gameSelect.addEventListener("change", function () {
      refresh();
      if (gameSelect.value === "__new") newName.focus();
    });
    sessionSelect.addEventListener("change", refresh);
    priceInput.addEventListener("input", refresh);
    newName.addEventListener("input", refresh);
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
     COIN TOP-UP
     "Pay 1000, get 1100" — a fixed payout for specific top-up amounts, shown
     to the customer as a highlighted quick-pick on the top-up screen (client
     and counter both), rather than a flat rate applied invisibly. An amount
     with no tier here just uses the standard coin rate as always.

     Lives on this page rather than in Settings: it's a price, same as every
     row in the table beside it, just priced in XP paid rather than minutes
     played.
     ========================================================================== */
  var topupTiers = [];
  var topupLoaded = false;
  var topupRoot = null;

  function renderTopupRows() {
    if (!topupRoot) return;
    var rowsHost = topupRoot.querySelector("#gpBonusRows");
    if (!rowsHost) return;
    UI.clear(rowsHost);
    if (!topupTiers.length) {
      rowsHost.appendChild(UI.el("div", {
        class: "faint", style: "font-size:12px",
        text: "No bonus tiers — every top-up uses the standard coin rate."
      }));
      return;
    }
    topupTiers.forEach(function (t, i) {
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
      remove.addEventListener("click", function () { topupTiers.splice(i, 1); renderTopupRows(); });
      row.appendChild(remove);
      row.querySelector("[data-pay]").addEventListener("input", function (e) { t.pay_amount = e.target.value; });
      row.querySelector("[data-credit]").addEventListener("input", function (e) { t.credit_amount = e.target.value; });
      rowsHost.appendChild(row);
    });
  }

  function loadTopupTiers() {
    if (topupLoaded) { renderTopupRows(); return Promise.resolve(); }
    return Store.getSettings("wallet").then(function (rows) {
      var row = (rows || []).filter(function (r) { return r.setting_key === "topup.bonus_tiers"; })[0];
      try {
        topupTiers = row && row.setting_value ? JSON.parse(row.setting_value) : [];
      } catch (e) { topupTiers = []; }
      if (!Array.isArray(topupTiers)) topupTiers = [];
      topupLoaded = true;
      renderTopupRows();
    }).catch(function () { renderTopupRows(); });
  }

  function renderTopupPane(pane) {
    pane.innerHTML =
      '<div class="card">' +
        '<div class="card-head"><h2>Coin bonus on top-up</h2></div>' +
        '<div class="card-body col gap-3">' +
          '<div class="faint" style="font-size:13px;line-height:1.6">Reward bigger top-ups — e.g. pay ' +
            '₹1,000, get 1,100 XP. Shown to customers as a highlighted quick-pick on the top-up screen, ' +
            'in the client app and at the counter alike.</div>' +
          '<div class="col gap-2" id="gpBonusRows"></div>' +
          '<div class="row gap-2">' +
            '<button class="btn btn-outline btn-sm" type="button" id="gpBonusAdd">' + Icon("plus", 14) +
              '<span class="btn-label">Add a tier</span></button>' +
            '<button class="btn btn-primary btn-sm" type="button" id="gpBonusSave">' + Icon("check", 14) +
              '<span class="btn-label">Save</span></button>' +
          "</div>" +
        "</div>" +
      "</div>";
    topupRoot = pane;

    pane.querySelector("#gpBonusAdd").addEventListener("click", function () {
      topupTiers.push({ pay_amount: "", credit_amount: "" });
      renderTopupRows();
    });

    var saveBtn = pane.querySelector("#gpBonusSave");
    saveBtn.addEventListener("click", function () {
      var clean = topupTiers
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
            topupTiers = clean;
            renderTopupRows();
            UI.toast.ok("Coin bonus saved",
              clean.length ? clean.length + " tier(s) active" : "No tiers — standard rate applies to every top-up");
          })
          .catch(function (e) { UI.toast.error("Could not save", e.message); });
      });
    });

    loadTopupTiers();
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  var activeTab = "prices";

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
          '<div class="page-actions" id="gpPriceActions">' +
            '<button class="btn btn-outline" id="gpRefresh">' + Icon("refresh", 15) +
              '<span class="btn-label">Refresh</span></button>' +
            '<button class="btn btn-outline" id="gpAddGame">' + Icon("plus", 15) +
              '<span class="btn-label">Add activity</span></button>' +
            '<button class="btn btn-primary" id="gpAdd">' + Icon("plus", 15) +
              '<span class="btn-label">Add price</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="tabs" id="gpTabs" style="margin-bottom:var(--s-5)">' +
          '<button data-tab="prices" aria-selected="true">Prices</button>' +
          '<button data-tab="topup" aria-selected="false">Coin Top-up</button>' +
        "</div>" +
        '<div id="gpPricesPane">' +
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
          '<div class="card card-body-flush" id="gpTable"></div>' +
        "</div>" +
        '<div id="gpTopupPane" class="hidden"></div>';
      root.appendChild(page);

      page.querySelector("#gpAdd").addEventListener("click", function () { priceForm(null); });
      page.querySelector("#gpAddGame").addEventListener("click", function () { activityForm(); });

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

      var pricesPane = page.querySelector("#gpPricesPane");
      var topupPane = page.querySelector("#gpTopupPane");
      var priceActions = page.querySelector("#gpPriceActions");

      function syncTab() {
        UI.$$("#gpTabs button", page).forEach(function (btn) {
          btn.setAttribute("aria-selected", String(btn.dataset.tab === activeTab));
        });
        var onPrices = activeTab === "prices";
        pricesPane.classList.toggle("hidden", !onPrices);
        topupPane.classList.toggle("hidden", onPrices);
        priceActions.classList.toggle("hidden", !onPrices);
        if (!onPrices && !topupPane.childElementCount) renderTopupPane(topupPane);
      }
      UI.$$("#gpTabs button", page).forEach(function (btn) {
        btn.addEventListener("click", function () {
          activeTab = btn.dataset.tab;
          syncTab();
        });
      });
      syncTab();

      syncFilters();
      load();
    },

    unmount: function () {
      clearTimeout(searchTimer);
      rootEl = null;
      topupRoot = null;
    }
  };
})(window);
