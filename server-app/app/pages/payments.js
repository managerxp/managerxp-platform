/* ==========================================================================
   Payments — gateway setup and the top-ups it produces.

   This page handles the café's merchant credentials, so it is deliberately
   built around one rule: a secret can be written and replaced, never read.
   The API returns only a four-character hint, and there is no code path here
   that would display more even if the API changed its mind. Leaving a secret
   field blank means "keep what is stored" — the page cannot echo the value
   back, so it must not treat an empty box as an erasure.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var state = { gateways: [], catalogue: [], encryptionReady: true, topups: [], summary: null };
  var loading = true;
  var loadError = null;
  var tab = "gateways";

  /* Brand colour per provider, so the cards are told apart at a glance rather
     than by reading. */
  var BRAND = {
    razorpay: { tint: "#3395ff", initials: "Rz" },
    cashfree: { tint: "#6933ff", initials: "Cf" },
    payu:     { tint: "#00b463", initials: "Pu" }
  };

  /* Local copies of the small presentational helpers the other data pages use;
     CXUI deliberately keeps only primitives. */
  function statCard(label, value, sub, status) {
    var card = UI.el("div", { class: "stat stat-accent", dataset: { status: status || "accent" } });
    card.innerHTML =
      '<div class="stat-label">' + UI.esc(label) + "</div>" +
      '<div class="stat-value">' + UI.esc(String(value)) + "</div>" +
      (sub ? '<div class="stat-foot">' + UI.esc(sub) + "</div>" : "");
    return card;
  }

  function table(columns, rows, cellFor) {
    var el = UI.el("table", { class: "tbl" });
    el.innerHTML = "<thead><tr>" + columns.map(function (c) {
      return "<th" + (c.num ? ' class="td-num"' : "") + ">" + UI.esc(c.label) + "</th>";
    }).join("") + "</tr></thead>";

    var tbody = UI.el("tbody");
    rows.forEach(function (row) {
      var tr = UI.el("tr");
      tr.innerHTML = columns.map(function (c) {
        return "<td" + (c.num ? ' class="td-num"' : "") + ">" + cellFor(row, c) + "</td>";
      }).join("");
      tbody.appendChild(tr);
    });
    el.appendChild(tbody);

    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(el);
    return wrap;
  }

  var money = function (n) { return Number(n || 0).toFixed(2); };

  function gatewayFor(providerId) {
    for (var i = 0; i < state.gateways.length; i++) {
      if (state.gateways[i].provider === providerId) return state.gateways[i];
    }
    return null;
  }

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function load() {
    loading = true; loadError = null; render();

    return Store.listGateways()
      .then(function (data) {
        state.gateways = data.gateways || [];
        state.catalogue = data.catalogue || [];
        state.encryptionReady = data.encryption_ready !== false;
        return Store.listTopups(100).catch(function () { return null; });
      })
      .then(function (data) {
        if (data) { state.topups = data.topups || []; state.summary = data.summary || null; }
        loading = false; render();
      })
      .catch(function (err) {
        loading = false;
        loadError = err.message;
        render();
      });
  }

  /* ==========================================================================
     CONFIGURE DIALOG
     ========================================================================== */
  function configure(providerId) {
    var spec = null;
    for (var i = 0; i < state.catalogue.length; i++) {
      if (state.catalogue[i].id === providerId) spec = state.catalogue[i];
    }
    if (!spec) return;

    var saved = gatewayFor(providerId);
    var fields = spec.fields || {};

    var body = UI.el("div", { class: "col gap-4" });

    var modeRow = UI.el("div", { class: "field" });
    modeRow.innerHTML =
      '<label class="field-label">Mode</label>' +
      '<div class="seg" role="group">' +
        '<button type="button" class="seg-btn" data-mode="test">Test</button>' +
        '<button type="button" class="seg-btn" data-mode="live">Live</button>' +
      "</div>" +
      '<div class="field-hint">Test mode uses the provider\'s sandbox — no real money moves.</div>';
    body.appendChild(modeRow);

    var mode = (saved && saved.mode) || "test";
    function paintMode() {
      modeRow.querySelectorAll("[data-mode]").forEach(function (b) {
        b.setAttribute("aria-pressed", b.dataset.mode === mode ? "true" : "false");
        b.classList.toggle("is-active", b.dataset.mode === mode);
      });
    }
    modeRow.querySelectorAll("[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () { mode = b.dataset.mode; paintMode(); });
    });
    paintMode();

    var inputs = {};
    Object.keys(fields).forEach(function (key) {
      var field = fields[key];
      var stored = saved && (
        key === "key_id" ? saved.key_id
          : (key === "key_secret" ? (saved.has_key_secret ? saved.key_secret_hint : null)
          : (saved.has_webhook_secret ? "stored" : null))
      );

      var wrap = UI.el("div", { class: "field" });
      wrap.innerHTML =
        '<label class="field-label">' + UI.esc(field.label) +
          (field.required ? '<span class="req">*</span>' : "") + "</label>" +
        '<input class="input" type="' + (field.secret ? "password" : "text") + '" ' +
          'autocomplete="off" spellcheck="false" ' +
          'placeholder="' + UI.esc(field.secret && stored ? "Stored — leave blank to keep" : (field.hint || "")) + '">' +
        '<div class="field-hint">' + UI.esc(field.hint || "") +
          (field.secret && stored
            // The hint is the whole point: enough to recognise, useless to steal.
            ? ' · currently <span class="mono">' + UI.esc(stored === "stored" ? "set" : stored) + "</span>"
            : "") +
        "</div>";

      var input = wrap.querySelector("input");
      if (!field.secret && stored) input.value = stored;
      inputs[key] = input;
      body.appendChild(wrap);
    });

    var enableRow = UI.el("label", { class: "check-row" });
    enableRow.innerHTML =
      '<input type="checkbox" class="check">' +
      "<span><strong>Accept payments through this gateway</strong>" +
      '<span class="faint block">Customers see it on the station only while this is on.</span></span>';
    var enableBox = enableRow.querySelector("input");
    enableBox.checked = !!(saved && saved.is_enabled);
    body.appendChild(enableRow);

    if (spec.docs) {
      var help = UI.el("div", { class: "notice", dataset: { status: "info" } });
      help.innerHTML = Icon("info", 16) +
        "<div>Find these in your " + UI.esc(spec.label) + " dashboard. CafeXP stores them " +
        "encrypted and never shows them again — only the last four characters.</div>";
      body.appendChild(help);
    }

    UI.modal({
      title: "Configure " + spec.label,
      description: "Credentials are encrypted before they are stored, and never shown again.",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Save", variant: "primary", icon: "check",
          onClick: function () {
            var payload = { mode: mode, is_enabled: enableBox.checked };
            Object.keys(inputs).forEach(function (key) {
              var value = inputs[key].value.trim();
              // Blank means "leave the stored secret alone", never "clear it".
              if (value) payload[key] = value;
            });

            if (enableBox.checked && !payload.key_id && !(saved && saved.key_id)) {
              UI.toast.warn("Add the key first", "A gateway cannot be enabled without credentials.");
              return false;
            }

            return Store.saveGateway(providerId, payload)
              .then(function () {
                UI.toast.ok(spec.label + " saved", enableBox.checked
                  ? "Customers can now pay with " + spec.label + "."
                  : "Saved, but not yet accepting payments.");
                load();
              })
              .catch(function (err) { UI.toast.err("Could not save", err.message); return false; });
          }
        }
      ]
    });
  }

  function testConnection(providerId, btn) {
    var label = btn.querySelector(".btn-label");
    var was = label ? label.textContent : "";
    if (label) label.textContent = "Testing…";
    btn.disabled = true;

    Store.testGateway(providerId)
      .then(function (r) { UI.toast.ok("Connected", r.message); })
      .catch(function (err) { UI.toast.err("Test failed", err.message); })
      .then(function () {
        btn.disabled = false;
        if (label) label.textContent = was;
        load();
      });
  }

  function removeGateway(providerId, label) {
    UI.confirm({
      title: "Remove " + label + "?",
      message: "The stored credentials are deleted. Customers lose this payment option " +
        "immediately; top-ups already credited are unaffected.",
      confirmLabel: "Remove",
      variant: "danger"
    }).then(function (ok) {
      if (!ok) return;
      Store.deleteGateway(providerId)
        .then(function () { UI.toast.ok("Removed", label + " is no longer configured."); load(); })
        .catch(function (err) { UI.toast.err("Could not remove", err.message); });
    });
  }

  /* ==========================================================================
     RENDER — GATEWAYS
     ========================================================================== */
  function gatewayCard(spec) {
    var saved = gatewayFor(spec.id);
    var brand = BRAND[spec.id] || { tint: "var(--accent)", initials: spec.label.slice(0, 2) };

    var configured = !!(saved && saved.key_id && saved.has_key_secret);
    var live = configured && saved.is_enabled;

    var status = live
      ? { tone: "online", text: saved.mode === "live" ? "Accepting live payments" : "Accepting test payments" }
      : (configured
        ? { tone: "idle", text: "Configured, switched off" }
        : { tone: "offline", text: "Not set up" });

    var card = UI.el("article", { class: "gw-card", dataset: { state: live ? "live" : (configured ? "ready" : "empty") } });

    var head = UI.el("div", { class: "gw-head" });
    head.innerHTML =
      '<span class="gw-mark" style="--tint:' + brand.tint + '">' + UI.esc(brand.initials) + "</span>" +
      '<div class="gw-id">' +
        '<div class="gw-name">' + UI.esc(spec.label) + "</div>" +
        '<div class="gw-sub faint">' + UI.esc((spec.currencies || []).join(", ")) + "</div>" +
      "</div>" +
      '<span class="badge" data-status="' + status.tone + '">' + UI.esc(status.text) + "</span>";
    card.appendChild(head);

    var meta = UI.el("dl", { class: "gw-meta" });
    meta.innerHTML =
      "<div><dt>Mode</dt><dd>" +
        (saved ? '<span class="tag" data-tone="' + (saved.mode === "live" ? "warn" : "muted") + '">' +
          UI.esc(saved.mode) + "</span>" : "—") + "</dd></div>" +
      "<div><dt>Key</dt><dd class=\"mono\">" + UI.esc(saved && saved.key_id ? saved.key_id : "—") + "</dd></div>" +
      "<div><dt>Secret</dt><dd class=\"mono\">" +
        UI.esc(saved && saved.key_secret_hint ? saved.key_secret_hint : "—") + "</dd></div>" +
      "<div><dt>Webhook</dt><dd>" +
        (saved && saved.has_webhook_secret
          ? '<span class="tag" data-tone="ok">set</span>'
          // Without it, a customer who closes the window mid-payment is stuck.
          : '<span class="tag" data-tone="warn">not set</span>') + "</dd></div>";
    card.appendChild(meta);

    if (saved && saved.last_error) {
      var err = UI.el("div", { class: "notice", dataset: { status: "offline" } });
      err.innerHTML = Icon("alert", 15) + "<div>" + UI.esc(saved.last_error) + "</div>";
      card.appendChild(err);
    } else if (saved && saved.last_verified_at) {
      var okNote = UI.el("div", { class: "gw-verified faint" });
      okNote.innerHTML = Icon("check", 13) + " Credentials verified " + UI.relTime(saved.last_verified_at);
      card.appendChild(okNote);
    }

    var actions = UI.el("div", { class: "gw-actions row gap-2" });

    var setupBtn = UI.el("button", {
      class: "btn " + (configured ? "btn-ghost" : "btn-primary"), type: "button",
      html: Icon("settings", 15) + '<span class="btn-label">' +
        (configured ? "Edit" : "Set up") + "</span>",
      onClick: function () { configure(spec.id); }
    });
    actions.appendChild(setupBtn);

    if (configured) {
      actions.appendChild(UI.el("button", {
        class: "btn btn-ghost", type: "button",
        html: Icon("radar", 15) + '<span class="btn-label">Test</span>',
        onClick: function () { testConnection(spec.id, this); }
      }));
      actions.appendChild(UI.el("button", {
        class: "btn btn-ghost btn-danger-ghost", type: "button",
        html: Icon("trash", 15) + '<span class="btn-label">Remove</span>',
        onClick: function () { removeGateway(spec.id, spec.label); }
      }));
    }

    card.appendChild(actions);
    return card;
  }

  function renderGateways(host) {
    if (!state.encryptionReady) {
      var warn = UI.el("div", { class: "notice", dataset: { status: "offline" } });
      warn.innerHTML = Icon("alert", 16) +
        "<div><strong>Credentials cannot be stored securely.</strong> The server has no " +
        "<span class=\"mono\">PAYMENTS_ENC_KEY</span> configured, so gateway secrets would sit " +
        "unprotected. Set one and restart the API before adding a gateway.</div>";
      host.appendChild(warn);
    }

    var lede = UI.el("p", { class: "page-lede" });
    lede.textContent = "Connect the payment provider you already use. Customers can then add " +
      "coins from their station without coming to the counter.";
    host.appendChild(lede);

    var grid = UI.el("div", { class: "gw-grid" });
    state.catalogue.forEach(function (spec) { grid.appendChild(gatewayCard(spec)); });
    host.appendChild(grid);

    Motion.stagger(grid.children, { step: 0.04, y: 12, maxDelay: 0.3 });

    var webhookNote = UI.el("section", { class: "card" });
    webhookNote.innerHTML =
      '<div class="card-head"><h3 class="card-title">Webhook endpoint</h3></div>' +
      '<div class="card-body col gap-3">' +
        "<p class=\"faint\">Paste this into the provider's dashboard so payments still land when a " +
        "customer closes the window before returning. Without it, a payment taken but not " +
        "confirmed has to be credited by hand.</p>" +
        '<code class="code-block">POST https://your-server/api/payments/webhook/&lt;provider&gt;</code>' +
      "</div>";
    host.appendChild(webhookNote);
  }

  /* ==========================================================================
     RENDER — TOP-UPS
     ========================================================================== */
  function renderTopups(host) {
    if (state.summary) {
      var stats = UI.el("div", { class: "grid grid-kpi" });
      stats.appendChild(statCard("Collected", money(state.summary.collected_30d), "last 30 days"));
      stats.appendChild(statCard("Top-ups credited", state.summary.credited_30d, "last 30 days", "online"));
      stats.appendChild(statCard("In progress", state.summary.pending, "awaiting the gateway", "idle"));
      stats.appendChild(statCard("Failed", state.summary.failed_30d, "last 30 days",
        state.summary.failed_30d > 0 ? "offline" : "idle"));
      host.appendChild(stats);
    }

    if (!state.topups.length) {
      host.appendChild(UI.emptyState({
        icon: "billing",
        title: "No top-ups yet",
        text: "Once a gateway is switched on, every coin a customer buys from their " +
          "station is listed here."
      }));
      return;
    }

    var TONE = {
      credited: "online", paid: "warning", pending: "idle", created: "idle",
      failed: "offline", expired: "offline", refunded: "warning"
    };

    var columns = [
      { key: "when", label: "When" },
      { key: "customer", label: "Customer" },
      { key: "provider", label: "Provider" },
      { key: "amount", label: "Paid", num: true },
      { key: "coins", label: "Coins", num: true },
      { key: "status", label: "Status" },
      { key: "ref", label: "Reference" }
    ];

    host.appendChild(table(columns, state.topups, function (t, c) {
      switch (c.key) {
        case "when": return UI.esc(UI.relTime(t.created_at));
        case "customer": return UI.esc(t.customer_name || "Customer " + t.customer_id);
        case "provider":
          return '<span class="tag" data-tone="muted">' + UI.esc(t.provider) + "</span>" +
            (t.mode === "test" ? ' <span class="tag" data-tone="warn">test</span>' : "");
        case "amount": return money(t.amount);
        case "coins": return money(t.coins);
        case "status":
          return '<span class="badge" data-status="' + (TONE[t.status] || "idle") + '">' +
            UI.esc(t.status) + "</span>" +
            (t.failure_reason ? '<div class="faint tiny">' + UI.esc(t.failure_reason) + "</div>" : "");
        case "ref":
          return '<span class="mono tiny">' +
            UI.esc(t.provider_payment_id || t.provider_order_id || "—") + "</span>";
        default: return "";
      }
    }));
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#payBody");
    if (!host) return;
    UI.clear(host);

    if (loading) { host.appendChild(UI.skeletonCards(3)); return; }
    if (loadError) {
      host.appendChild(UI.errorState(
        loadError.indexOf("does not allow") !== -1
          ? "Your role does not allow you to manage payment gateways."
          : loadError
      ));
      return;
    }

    if (tab === "gateways") renderGateways(host);
    else renderTopups(host);

    rootEl.querySelectorAll("[data-tab]").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.tab === tab);
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });
  }

  global.CXPages.payments = {
    title: "Payments",
    subtitle: "Gateways and customer top-ups",

    mount: function (root, ctx) {
      rootEl = root;
      tab = "gateways";

      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="tabs" role="tablist">' +
          '<button class="tab is-active" data-tab="gateways" role="tab">Gateways</button>' +
          '<button class="tab" data-tab="topups" role="tab">Top-ups</button>' +
        "</div>" +
        '<div id="payBody" class="col gap-6"></div>';
      root.appendChild(page);

      page.querySelectorAll("[data-tab]").forEach(function (b) {
        b.addEventListener("click", function () { tab = b.dataset.tab; render(); });
      });

      if (ctx && ctx.tools) {
        ctx.tools.appendChild(UI.el("button", {
          class: "btn btn-ghost btn-sm", type: "button",
          html: Icon("refresh", 14) + '<span class="btn-label">Refresh</span>',
          onClick: load
        }));
      }

      load();
    },

    unmount: function () { rootEl = null; }
  };
})(window);
