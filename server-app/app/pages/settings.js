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
    { id: "expenses", label: "Expenses" },
    { id: "system",   label: "System" }
  ];

  // Cached across tab switches so flipping away and back does not mean
  // waiting on the network again for a list that has not changed.
  var expRows = null;
  var expCategories = [];
  var expSummary = null;

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

    pane.appendChild(card);
    pane.appendChild(missing);
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
     EXPENSES
     What the café spends, so a report can compare it against what it takes
     in. Category is free text with suggestions from what this café has
     already used — the same choice made for gaming and station categories —
     because the list of things a café spends against (Salary, Rent, Stock,
     Maintenance…) is its own and differs café to café.
     ========================================================================== */
  function money(v) {
    var n = Number(v || 0);
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: Math.round(n * 100) % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return n.toFixed(2); }
  }

  function expenseDialog(existing) {
    var isEdit = !!existing;
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="expCategory">Category</label>' +
        '<input class="input" id="expCategory" list="expCategoryList" maxlength="60" ' +
          'placeholder="Salary" value="' + UI.esc(existing ? existing.category : "") + '" data-autofocus>' +
        '<datalist id="expCategoryList">' +
          expCategories.map(function (c) {
            return '<option value="' + UI.esc(c.category) + '"></option>';
          }).join("") +
        "</datalist></div>" +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="expAmount">Amount</label>' +
          '<input class="input" id="expAmount" type="number" min="0.01" step="0.01" ' +
            'value="' + UI.esc(existing ? existing.amount : "") + '" placeholder="8000"></div>' +
        '<div class="field"><label class="field-label" for="expDate">Date</label>' +
          '<input class="input" id="expDate" type="date" value="' +
            (existing ? String(existing.expense_date).slice(0, 10)
                      : new Date().toISOString().slice(0, 10)) + '" max="' +
            new Date().toISOString().slice(0, 10) + '"></div>' +
      "</div>" +
      '<div class="field"><label class="field-label" for="expNote">Description</label>' +
        '<input class="input" id="expNote" maxlength="255" placeholder="What this was for" ' +
          'value="' + UI.esc(existing ? (existing.description || "") : "") + '"></div>';

    return UI.modal({
      title: isEdit ? "Edit expense" : "Log an expense",
      description: isEdit ? existing.category : "Salaries, stock, rent — anything the café pays out.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isEdit ? "Save changes" : "Log expense", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var category = ctx.body.querySelector("#expCategory").value.trim();
            var amount = Number(ctx.body.querySelector("#expAmount").value);
            var date = ctx.body.querySelector("#expDate").value;
            var note = ctx.body.querySelector("#expNote").value.trim();

            if (!category) {
              Motion.shake(ctx.body.querySelector("#expCategory"));
              UI.toast.warn("A category is required");
              return false;
            }
            if (!Number.isFinite(amount) || amount <= 0) {
              Motion.shake(ctx.body.querySelector("#expAmount"));
              UI.toast.warn("Enter an amount greater than zero");
              return false;
            }

            var payload = { category: category, amount: amount, expense_date: date, description: note || null };
            var call = isEdit ? Store.updateExpense(existing.expense_id, payload) : Store.createExpense(payload);

            return call
              .then(function (r) {
                UI.toast.ok(isEdit ? "Expense updated" : "Expense logged",
                  r.data.category + " — " + money(r.data.amount) + " XP");
                expRows = null; // force a refetch so the list and summary agree
                render();
                return true;
              })
              .catch(function (err) {
                UI.toast.error("Could not save", err.message);
                return false;
              });
          }
        }
      ]
    });
  }

  function voidExpenseDialog(row) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="col">' +
        '<div class="kv"><span class="kv-key">Category</span><span class="kv-val">' + UI.esc(row.category) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Amount</span><span class="kv-val">' + money(row.amount) + " XP</span></div>" +
        (row.description
          ? '<div class="kv"><span class="kv-key">Note</span><span class="kv-val">' + UI.esc(row.description) + "</span></div>"
          : "") +
      "</div>" +
      '<div class="field"><label class="field-label" for="expVoidReason">Reason</label>' +
        '<input class="input" id="expVoidReason" maxlength="255" placeholder="Entered twice" data-autofocus></div>';

    return UI.modal({
      title: "Void this expense?",
      description: "Kept on record as voided — never deleted — so the books never have a gap.",
      body: body,
      actions: [
        { label: "Keep it", variant: "ghost" },
        {
          label: "Void expense", variant: "danger", icon: "close",
          onClick: function (ctx) {
            return Store.voidExpense(row.expense_id, ctx.body.querySelector("#expVoidReason").value.trim())
              .then(function () {
                UI.toast.ok("Expense voided");
                expRows = null;
                render();
                return true;
              })
              .catch(function (err) {
                UI.toast.error("Could not void", err.message);
                return false;
              });
          }
        }
      ]
    });
  }

  function expensesPane() {
    var pane = UI.el("div", { class: "col gap-4" });

    var summaryCard = UI.el("div", { class: "card" });
    summaryCard.innerHTML = '<div class="card-body row gap-6" id="expSummaryBody"></div>';
    pane.appendChild(summaryCard);

    var card = UI.el("div", { class: "card" });
    card.innerHTML =
      '<div class="card-head"><h2>Expenses</h2>' +
        '<button class="btn btn-primary btn-sm" id="expAdd">' + Icon("plus", 14) +
        '<span class="btn-label">Add expense</span></button></div>' +
      '<div class="card-body-flush" id="expBody"></div>';
    pane.appendChild(card);

    function paintSummary() {
      var host = pane.querySelector("#expSummaryBody");
      if (!host || !expSummary) return;
      var top = expSummary.by_category[0];
      host.innerHTML =
        '<div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Last 30 days</div>' +
          '<div style="font-size:22px;font-weight:750">' + money(expSummary.total) + " XP</div></div>" +
        '<div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Entries</div>' +
          '<div style="font-size:22px;font-weight:750">' + expSummary.count + "</div></div>" +
        (top
          ? '<div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Top category</div>' +
            '<div style="font-size:22px;font-weight:750">' + UI.esc(top.category) + '</div>' +
            '<div class="faint" style="font-size:11px">' + money(top.amount) + " XP</div></div>"
          : "") +
        '<div class="faint" style="align-self:center;font-size:12px">' +
          'See it against revenue under <strong>Reports → Finance</strong>.</div>';
    }

    function paintTable() {
      var host = pane.querySelector("#expBody");
      if (!host) return;
      UI.clear(host);

      if (!expRows.length) {
        host.appendChild(UI.emptyState({
          icon: "billing", title: "No expenses logged",
          text: "Salaries, stock, rent — log what the café pays out here.",
          actions: [{ label: "Add expense", icon: "plus", variant: "primary", onClick: function () {
            expenseDialog();
          } }]
        }));
        return;
      }

      var wrap = UI.el("div", { class: "table-wrap" });
      var table = UI.el("table", { class: "tbl" });
      table.innerHTML = "<thead><tr><th>Date</th><th>Category</th><th>Note</th>" +
        '<th class="td-num">Amount</th><th>Status</th><th></th></tr></thead>';
      var tbody = UI.el("tbody");

      expRows.forEach(function (row) {
        var voided = row.status === "VOID";
        var tr = UI.el("tr", { style: voided ? "opacity:.55" : "" });
        tr.innerHTML =
          '<td class="mono faint" style="font-size:12px">' + UI.esc(String(row.expense_date).slice(0, 10)) + "</td>" +
          "<td><strong>" + UI.esc(row.category) + "</strong></td>" +
          '<td class="faint" style="font-size:12px">' + UI.esc(row.description || "—") + "</td>" +
          '<td class="td-num" style="font-weight:700">' + money(row.amount) + "</td>" +
          '<td><span class="badge" data-status="' + (voided ? "offline" : "online") + '">' +
            (voided ? "Voided" : "Active") + "</span></td>" +
          '<td class="td-actions"></td>';

        if (!voided) {
          var actions = tr.querySelector(".td-actions");
          var edit = UI.el("button", {
            class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit"
          });
          edit.addEventListener("click", function () { expenseDialog(row); });
          var voidBtn = UI.el("button", {
            class: "btn btn-ghost btn-sm btn-icon", html: Icon("close", 13), "data-tip": "Void"
          });
          voidBtn.addEventListener("click", function () { voidExpenseDialog(row); });
          actions.appendChild(edit);
          actions.appendChild(voidBtn);
        }
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      wrap.appendChild(table);
      host.appendChild(wrap);
    }

    function loadAndPaint() {
      var host = pane.querySelector("#expBody");
      if (host) host.appendChild(UI.skeletonCards ? UI.skeletonCards(3, "44px") : UI.el("div"));
      Promise.all([
        Store.listExpenses({ limit: 100 }),
        Store.expenseCategories(),
        Store.expenseSummary()
      ]).then(function (res) {
        expRows = res[0].data || [];
        expCategories = res[1] || [];
        expSummary = res[2];
        paintSummary();
        paintTable();
      }).catch(function (err) {
        UI.clear(pane.querySelector("#expBody"));
        pane.querySelector("#expBody").appendChild(UI.emptyState({
          icon: "alert", status: "offline", title: "Could not load expenses", text: err.message
        }));
      });
    }

    setTimeout(function () {
      var addBtn = pane.querySelector("#expAdd");
      if (addBtn) addBtn.addEventListener("click", function () { expenseDialog(); });

      if (expRows) { paintSummary(); paintTable(); }
      else loadAndPaint();
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
    pane.appendChild(cleanup);
    pane.appendChild(kiosk);

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
    expenses: expensesPane, system: systemPane
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
        return [p.pc_id, p.name, p.ip_address || "", p.category || "", Store.pcStatus(p)].join(":");
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
