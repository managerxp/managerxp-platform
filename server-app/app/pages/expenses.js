/* ==========================================================================
   CafeXP — Expenses
   What the café pays out — salaries, stock, rent, maintenance — logged once
   and never lost. Previously a tab tucked inside Settings; a café's outgoings
   are business data, not configuration, so this is its own page under
   Business, alongside Reports and Payments.

   Category is free text with suggestions, not a lookup table a café has to
   administer before it can log a purchase — the same choice made for gaming
   and station categories elsewhere in this app.

   Void, never deleted — the same rule bills and sessions already follow, so
   the books never have a gap where a spend used to be with no trace of it
   having existed.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var pageRoot = null;
  var rows = null;
  var categories = [];
  var summary = null;
  var loading = false;
  var loadError = null;

  // Persisted only for the life of the page — reopening it starts fresh at
  // the same default the backend itself uses (Active, last 30 days).
  var filters = { from: "", to: "", category: "", status: "ACTIVE" };

  function money(v) {
    var n = Number(v || 0);
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: Math.round(n * 100) % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return n.toFixed(2); }
  }

  function dateOnly(v) { return v ? String(v).slice(0, 10) : "—"; }
  function dateTime(v) { return v ? new Date(v).toLocaleString() : "—"; }

  /* ==========================================================================
     DIALOGS
     ========================================================================== */
  function expenseDialog(existing) {
    var isEdit = !!existing;
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="expCategory">Category</label>' +
        '<input class="input" id="expCategory" list="expCategoryList" maxlength="60" ' +
          'placeholder="Salary" value="' + UI.esc(existing ? existing.category : "") + '" data-autofocus>' +
        '<datalist id="expCategoryList">' +
          categories.map(function (c) {
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
                loadAll();
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
                loadAll();
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

  /** Every field the backend tracks, read-only — "logged by" and the void
      trail matter for a café's own bookkeeping even when nothing here is
      editable. */
  function detailDialog(row) {
    var voided = row.status === "VOID";
    var body = UI.el("div", { class: "col gap-3" });
    body.innerHTML =
      '<div class="kv"><span class="kv-key">Category</span><span class="kv-val">' + UI.esc(row.category) + "</span></div>" +
      '<div class="kv"><span class="kv-key">Amount</span><span class="kv-val" style="font-weight:700">' +
        money(row.amount) + " " + UI.esc(row.currency || "XP") + "</span></div>" +
      '<div class="kv"><span class="kv-key">Date</span><span class="kv-val">' + dateOnly(row.expense_date) + "</span></div>" +
      '<div class="kv"><span class="kv-key">Description</span><span class="kv-val">' + UI.esc(row.description || "—") + "</span></div>" +
      '<div class="kv"><span class="kv-key">Status</span><span class="kv-val"><span class="badge" data-status="' +
        (voided ? "offline" : "online") + '">' + (voided ? "Voided" : "Active") + "</span></span></div>" +
      '<div class="kv"><span class="kv-key">Logged by</span><span class="kv-val">' + UI.esc(row.created_by || "—") + "</span></div>" +
      '<div class="kv"><span class="kv-key">Logged at</span><span class="kv-val">' + dateTime(row.created_at) + "</span></div>" +
      (row.updated_at && row.updated_at !== row.created_at
        ? '<div class="kv"><span class="kv-key">Last edited</span><span class="kv-val">' + dateTime(row.updated_at) + "</span></div>"
        : "") +
      (voided
        ? '<hr style="border:none;border-top:1px solid var(--line);margin:var(--s-1) 0">' +
          '<div class="kv"><span class="kv-key">Voided by</span><span class="kv-val">' + UI.esc(row.voided_by || "—") + "</span></div>" +
          '<div class="kv"><span class="kv-key">Voided at</span><span class="kv-val">' + dateTime(row.voided_at) + "</span></div>" +
          '<div class="kv"><span class="kv-key">Reason</span><span class="kv-val">' + UI.esc(row.void_reason || "—") + "</span></div>"
        : "");

    return UI.modal({
      title: "Expense #" + row.expense_id,
      body: body,
      actions: [{ label: "Close", variant: "ghost" }]
    });
  }

  /* ==========================================================================
     SUMMARY
     ========================================================================== */
  function paintSummary(host) {
    if (!host) return;
    if (!summary) { UI.clear(host); return; }

    var top = summary.by_category.slice(0, 8);
    var maxAmount = top.reduce(function (m, c) { return Math.max(m, c.amount); }, 0) || 1;

    var rangeLabel = filters.from || filters.to
      ? (filters.from || "…") + " → " + (filters.to || "…")
      : "Last 30 days";

    UI.clear(host);
    var totals = UI.el("div", { class: "card" });
    totals.innerHTML =
      '<div class="card-body row gap-6 wrap">' +
        '<div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">' +
          UI.esc(rangeLabel) + "</div>" +
          '<div style="font-size:22px;font-weight:750">' + money(summary.total) + " XP</div></div>" +
        '<div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Entries</div>' +
          '<div style="font-size:22px;font-weight:750">' + summary.count + "</div></div>" +
        '<div><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Average per entry</div>' +
          '<div style="font-size:22px;font-weight:750">' +
            money(summary.count ? summary.total / summary.count : 0) + " XP</div></div>" +
      "</div>";
    host.appendChild(totals);

    var byCat = UI.el("div", { class: "card" });
    var head = '<div class="card-head"><h2>By category</h2></div>';
    var listBody;
    if (!top.length) {
      listBody = '<div class="card-body faint" style="font-size:13px">Nothing logged in this range.</div>';
    } else {
      listBody = '<div class="card-body col gap-3">' +
        top.map(function (c) {
          var pct = Math.round((c.amount / maxAmount) * 100);
          return (
            '<div class="col gap-1">' +
              '<div class="row row-between" style="font-size:13px">' +
                "<strong>" + UI.esc(c.category) + "</strong>" +
                '<span class="mono">' + money(c.amount) + " XP <span class=\"faint\">(" + c.count + ")</span></span>" +
              "</div>" +
              '<div style="height:6px;border-radius:99px;background:var(--bg-inset);overflow:hidden">' +
                '<div style="height:100%;width:' + pct + '%;border-radius:99px;background:var(--accent)"></div>' +
              "</div>" +
            "</div>"
          );
        }).join("") +
      "</div>";
    }
    byCat.innerHTML = head + listBody;
    host.appendChild(byCat);
  }

  /* ==========================================================================
     TABLE
     ========================================================================== */
  function paintTable(host) {
    if (!host) return;
    UI.clear(host);

    if (loadError) {
      host.appendChild(UI.emptyState({
        icon: "alert", status: "offline", title: "Could not load expenses", text: loadError
      }));
      return;
    }
    if (loading && !rows) {
      host.appendChild(UI.skeletonCards ? UI.skeletonCards(4, "44px") : UI.el("div"));
      return;
    }
    if (!rows || !rows.length) {
      host.appendChild(UI.emptyState({
        icon: "billing", title: "No expenses match this filter",
        text: "Salaries, stock, rent — log what the café pays out here.",
        actions: [{ label: "Add expense", icon: "plus", variant: "primary", onClick: function () { expenseDialog(); } }]
      }));
      return;
    }

    var wrap = UI.el("div", { class: "table-wrap" });
    var table = UI.el("table", { class: "tbl" });
    table.innerHTML = "<thead><tr><th>Date</th><th>Category</th><th>Description</th>" +
      '<th class="td-num">Amount</th><th>Logged by</th><th>Status</th><th></th></tr></thead>';
    var tbody = UI.el("tbody");

    rows.forEach(function (row) {
      var voided = row.status === "VOID";
      var tr = UI.el("tr", { style: voided ? "opacity:.6" : "" });
      var statusBadge = '<span class="badge" data-status="' + (voided ? "offline" : "online") + '"' +
        (voided && row.void_reason ? ' data-tip="' + UI.esc(row.void_reason) + '"' : "") + ">" +
        (voided ? "Voided" : "Active") + "</span>";

      tr.innerHTML =
        '<td class="mono faint" style="font-size:12px">' + dateOnly(row.expense_date) + "</td>" +
        "<td><strong>" + UI.esc(row.category) + "</strong></td>" +
        '<td class="faint" style="font-size:12px">' + UI.esc(row.description || "—") + "</td>" +
        '<td class="td-num" style="font-weight:700">' + money(row.amount) + "</td>" +
        '<td class="faint" style="font-size:12px">' + UI.esc(row.created_by || "—") + "</td>" +
        "<td>" + statusBadge + "</td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");
      var view = UI.el("button", { class: "btn btn-ghost btn-sm btn-icon", html: Icon("info", 13), "data-tip": "View details" });
      view.addEventListener("click", function () { detailDialog(row); });
      actions.appendChild(view);

      if (!voided) {
        var edit = UI.el("button", { class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit" });
        edit.addEventListener("click", function () { expenseDialog(row); });
        var voidBtn = UI.el("button", { class: "btn btn-ghost btn-sm btn-icon", html: Icon("close", 13), "data-tip": "Void" });
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

  /* ==========================================================================
     FILTERS
     ========================================================================== */
  function paintFilters(host) {
    if (!host) return;
    host.innerHTML =
      '<div class="card-body row gap-3 wrap" style="align-items:flex-end">' +
        '<div class="field" style="max-width:160px"><label class="field-label" for="expFFrom">From</label>' +
          '<input class="input" id="expFFrom" type="date" value="' + UI.esc(filters.from) + '"></div>' +
        '<div class="field" style="max-width:160px"><label class="field-label" for="expFTo">To</label>' +
          '<input class="input" id="expFTo" type="date" value="' + UI.esc(filters.to) + '"></div>' +
        '<div class="field" style="max-width:200px"><label class="field-label" for="expFCategory">Category</label>' +
          '<select class="select" id="expFCategory"><option value="">All categories</option>' +
            categories.map(function (c) {
              return '<option value="' + UI.esc(c.category) + '"' +
                (c.category === filters.category ? " selected" : "") + ">" + UI.esc(c.category) + "</option>";
            }).join("") +
          "</select></div>" +
        '<div class="field" style="max-width:160px"><label class="field-label" for="expFStatus">Status</label>' +
          '<select class="select" id="expFStatus">' +
            ["ACTIVE", "VOID", "ALL"].map(function (s) {
              var label = s === "ACTIVE" ? "Active" : s === "VOID" ? "Voided" : "All";
              return '<option value="' + s + '"' + (s === filters.status ? " selected" : "") + ">" + label + "</option>";
            }).join("") +
          "</select></div>" +
        '<button class="btn btn-ghost btn-sm" id="expFClear">' + Icon("close", 13) + '<span class="btn-label">Clear</span></button>' +
      "</div>";

    function onChange() {
      filters.from = host.querySelector("#expFFrom").value;
      filters.to = host.querySelector("#expFTo").value;
      filters.category = host.querySelector("#expFCategory").value;
      filters.status = host.querySelector("#expFStatus").value;
      loadAll();
    }
    ["expFFrom", "expFTo", "expFCategory", "expFStatus"].forEach(function (id) {
      var el = host.querySelector("#" + id);
      if (el) el.addEventListener("change", onChange);
    });
    host.querySelector("#expFClear").addEventListener("click", function () {
      filters = { from: "", to: "", category: "", status: "ACTIVE" };
      paintFilters(host);
      loadAll();
    });
  }

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function loadAll() {
    if (!pageRoot) return Promise.resolve();
    loading = true;
    loadError = null;
    paintTable(pageRoot.querySelector("#expTableBody"));

    var listOpts = { limit: 200 };
    if (filters.from) listOpts.from = filters.from;
    if (filters.to) listOpts.to = filters.to;
    if (filters.category) listOpts.category = filters.category;
    if (filters.status && filters.status !== "ALL") listOpts.status = filters.status;

    var summaryOpts = {};
    if (filters.from) summaryOpts.from = filters.from;
    if (filters.to) summaryOpts.to = filters.to;

    return Promise.all([
      Store.listExpenses(listOpts),
      Store.expenseCategories(),
      Store.expenseSummary(summaryOpts)
    ]).then(function (res) {
      rows = res[0].data || [];
      categories = res[1] || [];
      summary = res[2];
      loading = false;
      if (!pageRoot) return;
      paintSummary(pageRoot.querySelector("#expSummary"));
      paintFilters(pageRoot.querySelector("#expFilters"));
      paintTable(pageRoot.querySelector("#expTableBody"));
    }).catch(function (err) {
      loading = false;
      loadError = err.message;
      if (pageRoot) paintTable(pageRoot.querySelector("#expTableBody"));
    });
  }

  global.CXPages.expenses = {
    title: "Expenses",
    subtitle: "What the café pays out — logged once, never lost",

    mount: function (root) {
      pageRoot = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Expenses</div>' +
          '<div class="page-sub">Salaries, stock, rent, maintenance — everything the café pays out.</div>' +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="expRefresh">' + Icon("refresh", 15) + '<span class="btn-label">Refresh</span></button>' +
          '<button class="btn btn-primary" id="expAdd">' + Icon("plus", 15) + '<span class="btn-label">Add expense</span></button>' +
        "</div></div>" +
        '<div class="col gap-4" id="expSummary"></div>' +
        '<div class="card" id="expFilters" style="margin-top:var(--s-4)"></div>' +
        '<div class="card card-body-flush" id="expTableBody" style="margin-top:var(--s-4)"></div>';
      root.appendChild(page);

      page.querySelector("#expAdd").addEventListener("click", function () { expenseDialog(); });
      var rb = page.querySelector("#expRefresh");
      rb.addEventListener("click", function () { UI.withBusy(rb, function () { return loadAll(); }); });

      // See what is already known before the network answers, same as every
      // other list page — a re-open from cache should not flash empty.
      paintSummary(page.querySelector("#expSummary"));
      paintFilters(page.querySelector("#expFilters"));
      paintTable(page.querySelector("#expTableBody"));

      loadAll();
    },

    unmount: function () { pageRoot = null; }
  };
})(window);
