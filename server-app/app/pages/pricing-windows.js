/* ==========================================================================
   CafeXP Admin — Peak & Happy Hours

   The "when" layer over the Gaming Price Master. A window covers some days
   and a time range, and either adds a percentage to the base price or
   replaces it with a fixed one.

   The screen deliberately shows two things side by side: the windows the
   owner has configured, and what the catalogue actually costs right now
   because of them. A pricing rule you cannot see the effect of is a pricing
   rule nobody trusts.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var rules = [];
  var rates = [];
  var games = [];
  var loading = false;
  var loadError = null;
  var tickTimer = null;

  var DAYS = [
    { value: 0, short: "Sun", long: "Sunday" },
    { value: 1, short: "Mon", long: "Monday" },
    { value: 2, short: "Tue", long: "Tuesday" },
    { value: 3, short: "Wed", long: "Wednesday" },
    { value: 4, short: "Thu", long: "Thursday" },
    { value: 5, short: "Fri", long: "Friday" },
    { value: 6, short: "Sat", long: "Saturday" }
  ];

  var KINDS = [
    { value: "PEAK",    label: "Peak hours",   hint: "Busy times — usually a surcharge." },
    { value: "OFFPEAK", label: "Off-peak",     hint: "Quiet times — usually cheaper." },
    { value: "HAPPY",   label: "Happy hour",   hint: "A short, deliberate discount." },
    { value: "WEEKEND", label: "Weekend rate", hint: "Whole-weekend pricing." },
    { value: "CUSTOM",  label: "Custom",       hint: "Anything else." }
  ];

  var KIND_STATUS = {
    PEAK: "warning", WEEKEND: "warning",
    HAPPY: "online", OFFPEAK: "online",
    CUSTOM: "accent"
  };

  /* One colour per kind of bill line the window covers. */
  var SCOPE_STATUS = {
    GAMING: "in-session",
    FNB: "online",
    SHOP: "warning",
    ALL: "accent"
  };

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

  /* "Mon, Tue, Wed" is noise once it is the whole working week. */
  function daysText(days) {
    var set = (days || []).slice().sort(function (a, b) { return a - b; });
    var key = set.join(",");
    if (key === "0,1,2,3,4,5,6") return "Every day";
    if (key === "0,6") return "Weekends";
    if (key === "1,2,3,4,5") return "Weekdays";
    return set.map(function (d) { return DAYS[d] ? DAYS[d].short : d; }).join(", ");
  }

  function windowText(rule) {
    return rule.start_time + "–" + rule.end_time +
      (rule.crosses_midnight ? " (next day)" : "");
  }

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function load() {
    loading = true;
    loadError = null;
    render();
    return Promise.all([
      Store.listPricingRules(),
      Store.previewRates(),
      games.length ? Promise.resolve({ data: games }) : Store.listGames({ limit: 200 })
    ])
      .then(function (res) {
        rules = res[0].data || [];
        rates = res[1] || [];
        games = (res[2].data || []).filter(function (g) { return g.is_active !== false; });
        loading = false;
        render();
      })
      .catch(function (err) {
        loading = false; loadError = err.message; render();
      });
  }

  /* The live panel is only true for the minute it was fetched, so refresh the
     rates quietly while the page is open. Rules are not re-fetched — they only
     change when someone on this screen changes them. */
  function refreshRates() {
    return Store.previewRates()
      .then(function (r) { rates = r || []; renderRates(); })
      .catch(function () { /* a stale rate panel is better than an error toast */ });
  }

  function knownCategories() {
    var seen = {};
    games.forEach(function (g) { if (g.category) seen[g.category] = true; });
    return Object.keys(seen).sort();
  }

  /* ==========================================================================
     FORM
     ========================================================================== */
  function ruleForm(existing) {
    var editing = !!existing;
    var body = UI.el("div", { class: "col gap-4" });

    /* The dropdown carries one value for what is really two fields on the
       server — the kind of line, and (for gaming) which game or category. */
    var scopeValue = existing
      ? (existing.software_id ? "game:" + existing.software_id
        : existing.category ? "cat:" + existing.category
        : existing.applies_to === "FNB" ? "fnb"
        : existing.applies_to === "SHOP" ? "shop"
        : existing.applies_to === "ALL" ? "all"
        : "")
      : "";

    body.innerHTML =
      '<div class="field">' +
        '<label class="field-label field-req" for="prName">Name</label>' +
        '<input class="input" id="prName" maxlength="120" placeholder="Friday Night Peak" data-autofocus>' +
        '<div class="field-hint">What this window is called on the session and the bill.</div>' +
      "</div>" +

      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="prKind">Type</label>' +
          '<select class="select" id="prKind">' +
            KINDS.map(function (k) {
              return '<option value="' + k.value + '">' + UI.esc(k.label) + "</option>";
            }).join("") +
          "</select>" +
          '<div class="field-hint" id="prKindHint"></div></div>' +
        '<div class="field"><label class="field-label" for="prPriority">Priority</label>' +
          '<input class="input" id="prPriority" type="number" min="1" max="999" step="1" value="100">' +
          '<div class="field-hint">Lower wins when two windows overlap.</div></div>' +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label field-req">Days</label>' +
        '<div class="row gap-2 wrap" id="prDays">' +
          DAYS.map(function (d) {
            return '<button type="button" class="chip" data-day="' + d.value + '">' + d.short + "</button>";
          }).join("") +
        "</div>" +
        '<div class="row gap-2" style="margin-top:var(--s-2)">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-preset="weekdays">Weekdays</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-preset="weekends">Weekends</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-preset="all">Every day</button>' +
        "</div>" +
      "</div>" +

      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="prStart">From</label>' +
          '<input class="input" id="prStart" type="time" value="18:00"></div>' +
        '<div class="field"><label class="field-label field-req" for="prEnd">Until</label>' +
          '<input class="input" id="prEnd" type="time" value="23:00">' +
          '<div class="field-hint" id="prWrapHint"></div></div>' +
      "</div>" +

      /*
       * What the offer covers, in one list.
       *
       * Grouped so the common answers — all gaming, all food — are the first
       * things read, with the narrower options underneath. Food and shop sit
       * beside gaming here because a window is no longer gaming-only: "10%
       * off food from 3 to 5" is the same kind of thing as a peak rate, and
       * splitting them across two screens would only hide that.
       */
      '<div class="field">' +
        '<label class="field-label" for="prScope">This offer applies to</label>' +
        '<select class="select" id="prScope">' +
          '<optgroup label="Gaming">' +
            '<option value="">All gaming</option>' +
            (knownCategories().length
              ? knownCategories().map(function (c) {
                  return '<option value="cat:' + UI.esc(c) + '">Only ' + UI.esc(c) + "</option>";
                }).join("")
              : "") +
            games.map(function (g) {
              return '<option value="game:' + g.software_id + '">Only ' + UI.esc(g.software_name) + "</option>";
            }).join("") +
          "</optgroup>" +
          '<optgroup label="Food &amp; drink">' +
            '<option value="fnb">All food &amp; drink</option>' +
          "</optgroup>" +
          '<optgroup label="Shop">' +
            '<option value="shop">All shop items</option>' +
          "</optgroup>" +
          '<optgroup label="Everything">' +
            '<option value="all">Everything on the bill</option>' +
          "</optgroup>" +
        "</select>" +
        '<div class="field-hint">Set a different percentage for food and for gaming by making one window for each.</div>' +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label field-req">Price during this window</label>' +
        '<div class="row gap-2" id="prType">' +
          '<button type="button" class="chip" data-type="PERCENT" aria-pressed="true">Adjust by %</button>' +
          '<button type="button" class="chip" data-type="FIXED">Set a fixed price</button>' +
        "</div>" +
        '<div class="row gap-2" style="margin-top:var(--s-2);align-items:center">' +
          '<input class="input" id="prValue" type="number" step="0.01" style="max-width:160px" placeholder="25">' +
          '<span class="field-hint" id="prValueUnit"></span>' +
        "</div>" +
        '<div class="field-hint" id="prValueHint"></div>' +
      "</div>" +

      '<div class="notice" data-status="accent" id="prExample" style="padding:10px 12px"></div>';

    /* --- day chips --- */
    var selectedDays = existing ? (existing.days || []).slice() : [5, 6];
    function paintDays() {
      UI.$$("#prDays .chip", body).forEach(function (chip) {
        var on = selectedDays.indexOf(Number(chip.dataset.day)) !== -1;
        chip.setAttribute("aria-pressed", String(on));
      });
      updateExample();
    }
    UI.$$("#prDays .chip", body).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var day = Number(chip.dataset.day);
        var i = selectedDays.indexOf(day);
        if (i === -1) selectedDays.push(day); else selectedDays.splice(i, 1);
        paintDays();
      });
    });
    UI.$$("[data-preset]", body).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = btn.dataset.preset;
        selectedDays = p === "weekdays" ? [1, 2, 3, 4, 5]
          : p === "weekends" ? [0, 6]
          : [0, 1, 2, 3, 4, 5, 6];
        paintDays();
      });
    });

    /* --- percent vs fixed --- */
    var adjustType = existing ? existing.adjust_type : "PERCENT";
    function paintType() {
      UI.$$("#prType .chip", body).forEach(function (chip) {
        chip.setAttribute("aria-pressed", String(chip.dataset.type === adjustType));
      });
      body.querySelector("#prValueUnit").textContent = adjustType === "PERCENT" ? "%" : "per session block";
      body.querySelector("#prValueHint").textContent = adjustType === "PERCENT"
        ? "Positive adds to the base price, negative takes off. −30 is a 30% happy-hour discount."
        : "Replaces the catalogue price for this block, whatever it normally costs.";
      updateExample();
    }
    UI.$$("#prType .chip", body).forEach(function (chip) {
      chip.addEventListener("click", function () { adjustType = chip.dataset.type; paintType(); });
    });

    /* --- a worked example, so the effect is never a guess --- */
    var valueInput = body.querySelector("#prValue");
    var startInput = body.querySelector("#prStart");
    var endInput = body.querySelector("#prEnd");

    function updateExample() {
      var note = body.querySelector("#prExample");
      var value = Number(valueInput.value);
      var wrapHint = body.querySelector("#prWrapHint");
      wrapHint.textContent = (endInput.value && startInput.value && endInput.value <= startInput.value)
        ? "Runs past midnight into the next morning."
        : "";

      if (!selectedDays.length || !Number.isFinite(value)) {
        note.innerHTML = Icon("info", 14) + "<div>Pick the days and an amount to see an example.</div>";
        return;
      }
      var sample = 400;
      var result = adjustType === "FIXED"
        ? Math.max(0, value)
        : Math.max(0, sample * (1 + value / 100));

      /* Name what it covers, not just the arithmetic — the whole point of
         the example is catching "I meant food, not gaming" before saving. */
      var scopeSel = body.querySelector("#prScope");
      var coversLabel = scopeSel && scopeSel.options[scopeSel.selectedIndex]
        ? scopeSel.options[scopeSel.selectedIndex].textContent
        : "All gaming";
      var noun = /food|drink/i.test(coversLabel) ? "item"
        : /shop/i.test(coversLabel) ? "item"
        : /everything/i.test(coversLabel) ? "line"
        : "session";

      note.innerHTML = Icon("info", 14) +
        "<div><strong>" + UI.esc(coversLabel) + "</strong> · " +
        UI.esc(daysText(selectedDays)) + " " +
        UI.esc(startInput.value + "–" + endInput.value) + "<br>a " +
        money(sample) + " " + noun + " becomes <strong>" + money(result) + "</strong>.</div>";
    }
    valueInput.addEventListener("input", updateExample);
    startInput.addEventListener("input", updateExample);
    endInput.addEventListener("input", updateExample);
    // So the example renames itself the moment the scope changes.
    body.querySelector("#prScope").addEventListener("change", updateExample);

    var kindSel = body.querySelector("#prKind");
    kindSel.addEventListener("change", function () {
      var k = KINDS.filter(function (x) { return x.value === kindSel.value; })[0];
      body.querySelector("#prKindHint").textContent = k ? k.hint : "";
    });

    /* --- prefill --- */
    if (editing) {
      body.querySelector("#prName").value = existing.name || "";
      kindSel.value = existing.rule_kind || "CUSTOM";
      body.querySelector("#prPriority").value = existing.priority;
      startInput.value = existing.start_time;
      endInput.value = existing.end_time;
      body.querySelector("#prScope").value = scopeValue;
      valueInput.value = existing.adjust_value;
    }
    kindSel.dispatchEvent(new Event("change"));
    paintDays();
    paintType();

    UI.modal({
      title: editing ? "Edit pricing window" : "New pricing window",
      description: editing
        ? "Changes apply to sessions started from now on. Sessions already running keep the price they started at."
        : "Adjusts the catalogue price during the days and hours you choose.",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: editing ? "Save changes" : "Create window",
          variant: "primary", icon: "check",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#prName").value.trim();
            if (!name) {
              Motion.shake(ctx.node); UI.toast.warn("Give the window a name"); return false;
            }
            if (!selectedDays.length) {
              Motion.shake(ctx.node); UI.toast.warn("Pick at least one day"); return false;
            }
            var value = Number(valueInput.value);
            if (!Number.isFinite(value)) {
              Motion.shake(ctx.node); UI.toast.warn("Enter an amount"); return false;
            }

            var scope = ctx.body.querySelector("#prScope").value;
            var payload = {
              name: name,
              rule_kind: kindSel.value,
              days: selectedDays,
              start_time: startInput.value,
              end_time: endInput.value,
              adjust_type: adjustType,
              adjust_value: value,
              priority: Number(ctx.body.querySelector("#prPriority").value) || 100,
              applies_to: scope === "fnb" ? "FNB"
                : scope === "shop" ? "SHOP"
                : scope === "all" ? "ALL"
                : "GAMING",
              software_id: scope.indexOf("game:") === 0 ? Number(scope.slice(5)) : null,
              category: scope.indexOf("cat:") === 0 ? scope.slice(4) : null
            };

            var call = editing
              ? Store.updatePricingRule(existing.rule_id, payload)
              : Store.createPricingRule(payload);

            return call
              .then(function () {
                UI.toast.ok(editing ? "Window updated" : "Window created", name);
                return load();
              })
              .then(function () { return true; })
              .catch(function (e) {
                UI.toast.error(editing ? "Could not save" : "Could not create", e.message);
                return false;
              });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     LIVE RATES
     ========================================================================== */
  function renderRates() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#prRates");
    if (!host) return;
    UI.clear(host);

    if (!rates.length) {
      host.appendChild(UI.el("div", {
        class: "faint",
        style: "padding:var(--s-4);font-size:var(--t-sm)",
        text: "No active catalogue prices to show."
      }));
      return;
    }

    var changed = rates.filter(function (r) { return r.changed; });
    var summary = UI.el("div", {
      class: "row gap-2",
      style: "padding:var(--s-3) var(--s-4);border-bottom:1px solid var(--line);align-items:center"
    });
    summary.innerHTML =
      '<span class="badge" data-status="' + (changed.length ? "warning" : "idle") + '">' +
        (changed.length ? changed.length + " of " + rates.length + " adjusted" : "Base prices") + "</span>" +
      '<span class="faint" style="font-size:var(--t-xs)">as of ' +
        UI.esc(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) + "</span>";
    host.appendChild(summary);

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Game</th><th>Session</th>" +
      "<th class='td-num'>Base</th><th class='td-num'>Right now</th>" +
      "<th>Window</th><th>Next change</th></tr></thead>";
    var tbody = UI.el("tbody");

    rates.forEach(function (r) {
      var tr = UI.el("tr", { dataset: { status: r.changed ? "warning" : "idle" } });
      tr.innerHTML =
        "<td><strong>" + UI.esc(r.software_name) + "</strong>" +
          (r.category ? ' <span class="faint" style="font-size:var(--t-xs)">' + UI.esc(r.category) + "</span>" : "") +
        "</td>" +
        "<td>" + UI.esc(r.session_name) + "</td>" +
        '<td class="td-num mono faint">' + UI.esc(money(r.base_price, r.currency)) + "</td>" +
        '<td class="td-num" style="font-weight:700' + (r.changed ? ";color:var(--warn)" : "") + '">' +
          UI.esc(money(r.current_price, r.currency)) + "</td>" +
        "<td>" + (r.rule_label
          ? '<span class="badge" data-status="' + (KIND_STATUS[r.rule_kind] || "accent") + '">' +
            UI.esc(r.rule_label) + "</span>"
          : '<span class="faint" style="font-size:var(--t-xs)">—</span>') + "</td>" +
        '<td class="faint" style="font-size:var(--t-xs)">' + (r.next_change_time
          ? UI.esc(r.next_change_time + " → " + money(r.next_price, r.currency))
          : "no change today") + "</td>";
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    host.appendChild(table);
  }

  /* ==========================================================================
     RULE LIST
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#prList");
    if (!host) return;
    UI.clear(host);

    if (loading && !rules.length) { host.appendChild(UI.skeletonRows(4)); return; }
    if (loadError) { host.appendChild(UI.errorState(loadError, load)); return; }

    if (!rules.length) {
      host.appendChild(UI.emptyState({
        icon: "clock",
        title: "No pricing windows yet",
        text: "Charge more at peak times, less when it is quiet, or run a happy hour — " +
              "without touching the base prices in the catalogue.",
        actions: [{
          label: "Add a window", icon: "plus", variant: "primary",
          onClick: function () { ruleForm(null); }
        }]
      }));
      renderRates();
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th class='td-num'>Priority</th><th>Window</th><th>When</th>" +
      "<th>Applies to</th><th class='td-num'>Effect</th><th>Status</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    rules.forEach(function (rule) {
      var active = rule.status === "ACTIVE";
      var tr = UI.el("tr", { dataset: { status: active ? "online" : "idle" } });
      tr.innerHTML =
        '<td class="td-num mono faint">' + rule.priority + "</td>" +
        "<td><strong>" + UI.esc(rule.name) + "</strong>" +
          ' <span class="badge" data-status="' + (KIND_STATUS[rule.rule_kind] || "accent") + '">' +
            UI.esc((KINDS.filter(function (k) { return k.value === rule.rule_kind; })[0] || {}).label || rule.rule_kind) +
          "</span></td>" +
        "<td>" + UI.esc(daysText(rule.days)) +
          '<div class="faint mono" style="font-size:var(--t-xs)">' + UI.esc(windowText(rule)) + "</div></td>" +
        /* Colour-coded by kind of line, so a food window and a gaming window
           are told apart at a glance rather than by reading the text. */
        '<td><span class="badge" data-status="' + SCOPE_STATUS[rule.applies_to || "GAMING"] + '">' +
          UI.esc(rule.scope_label) + "</span></td>" +
        '<td class="td-num" style="font-weight:700;color:' +
          (rule.adjust_type === "PERCENT" && rule.adjust_value < 0 ? "var(--ok)" : "var(--warn)") + '">' +
          UI.esc(rule.effect_label) + "</td>" +
        '<td><span class="badge" data-status="' + (active ? "online" : "idle") + '">' +
          (active ? "Active" : "Paused") + "</span></td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");

      var editBtn = UI.el("button", {
        class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit"
      });
      editBtn.addEventListener("click", function () { ruleForm(rule); });

      var toggleBtn = UI.el("button", {
        class: "btn btn-sm btn-icon " + (active ? "btn-warn" : "btn-ok"),
        html: Icon(active ? "pause" : "check", 13),
        "data-tip": active ? "Pause this window" : "Activate this window"
      });
      toggleBtn.addEventListener("click", function () {
        UI.withBusy(toggleBtn, function () {
          /* A full replace, so every field has to travel — omitting
             applies_to would quietly re-scope a food window to gaming just
             because somebody paused it. */
          return Store.updatePricingRule(rule.rule_id, {
            name: rule.name, rule_kind: rule.rule_kind, days: rule.days,
            start_time: rule.start_time, end_time: rule.end_time,
            software_id: rule.software_id, category: rule.category,
            applies_to: rule.applies_to,
            adjust_type: rule.adjust_type, adjust_value: rule.adjust_value,
            priority: rule.priority,
            status: active ? "INACTIVE" : "ACTIVE"
          })
            .then(function () {
              UI.toast.ok(active ? "Window paused" : "Window active", rule.name);
              return load();
            })
            .catch(function (e) { UI.toast.error("Could not change it", e.message); });
        });
      });

      var delBtn = UI.el("button", {
        class: "btn btn-danger btn-sm btn-icon", html: Icon("trash", 13), "data-tip": "Delete"
      });
      delBtn.addEventListener("click", function () {
        UI.confirm({
          title: "Delete “" + rule.name + "”?",
          message: "Sessions already priced under this window keep the rate they started at — " +
                   "deleting it only stops it applying to new sessions.",
          confirmLabel: "Delete", variant: "danger"
        }).then(function (ok) {
          if (!ok) return;
          Store.deletePricingRule(rule.rule_id)
            .then(function () { UI.toast.ok("Window deleted", rule.name); return load(); })
            .catch(function (e) { UI.toast.error("Could not delete", e.message); });
        });
      });

      actions.appendChild(editBtn);
      actions.appendChild(toggleBtn);
      actions.appendChild(delBtn);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    host.appendChild(table);
    renderRates();
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages["pricing-windows"] = {
    title: "Peak & Happy Hours",
    subtitle: "Time-based pricing over the catalogue",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Peak &amp; Happy Hours</div>' +
            '<div class="page-sub">Charge more when you are busy and less when you are not. ' +
              'Base prices stay in the Gaming Price Master — these windows adjust them by day and hour.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="prRefresh">' + Icon("refresh", 15) +
              '<span class="btn-label">Refresh</span></button>' +
            '<button class="btn btn-primary" id="prAdd">' + Icon("plus", 15) +
              '<span class="btn-label">Add window</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="card card-body-flush" id="prList" style="margin-bottom:var(--s-5)"></div>' +
        '<div style="margin-bottom:var(--s-3)">' +
          '<div class="section-title">What the catalogue costs right now</div>' +
          '<div class="page-sub">The same calculation used when a session starts, ' +
            'so this is exactly what a customer will be charged.</div>' +
        "</div>" +
        '<div class="card card-body-flush" id="prRates"></div>';
      root.appendChild(page);

      page.querySelector("#prAdd").addEventListener("click", function () { ruleForm(null); });

      var refreshBtn = page.querySelector("#prRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return load(); });
      });

      /* A window opening or closing changes the live panel with nobody
         touching anything, so keep it honest without hammering the server. */
      tickTimer = setInterval(refreshRates, 60000);

      load();
    },

    unmount: function () {
      clearInterval(tickTimer);
      tickTimer = null;
      rootEl = null;
    }
  };
})(window);
