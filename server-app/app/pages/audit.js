/* ==========================================================================
   CafeXP Admin — Audit log
   Who did what, and when. Append-only: there is no edit and no delete here,
   because a trail that can be tidied up afterwards proves nothing.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var entries = [];
  var facets = null;
  var loading = false;
  var loadError = null;
  var searchTimer = null;

  var filters = {
    search: "",
    category: "",
    actor_id: "",
    sensitive: "",
    from: "",
    limit: 150
  };

  var CATEGORY_LABEL = {
    wallet: "Wallet", billing: "Billing", sessions: "Sessions", staff: "Staff",
    settings: "Settings", station: "Stations", general: "Other"
  };

  var CATEGORY_STATUS = {
    wallet: "accent", billing: "warning", sessions: "gaming",
    staff: "accent", settings: "warning", station: "offline", general: "idle"
  };

  var PERIODS = [
    { label: "Today", hours: 24 },
    { label: "7 days", hours: 24 * 7 },
    { label: "30 days", hours: 24 * 30 },
    { label: "All", hours: null }
  ];

  function coins(value) {
    if (value === null || value === undefined) return null;
    var n = Number(value);
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: Math.round(n * 100) % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return n.toFixed(2); }
  }

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function load() {
    loading = true;
    loadError = null;
    render();

    return Promise.all([
      Store.listAudit(filters),
      facets ? Promise.resolve(facets) : Store.auditFacets()
    ])
      .then(function (res) {
        entries = res[0].data || [];
        facets = res[1];
        loading = false;
        render();
        renderChrome();
      })
      .catch(function (err) {
        loading = false;
        loadError = err.message;
        render();
      });
  }

  /* ==========================================================================
     DETAIL
     ========================================================================== */
  function openEntry(entry) {
    var body = UI.el("div", { class: "col gap-4" });

    var facts = UI.el("div", { class: "card card-pad col" });
    [
      ["When", new Date(entry.created_at).toLocaleString()],
      ["Who", (entry.actor_name || "Unknown") +
        (entry.actor_role ? " · " + entry.actor_role : "") + " (" + entry.actor_kind + ")"],
      ["Action", entry.action],
      ["Area", CATEGORY_LABEL[entry.category] || entry.category],
      ["Record", entry.entity ? entry.entity + " " + (entry.entity_id || "") : "—"],
      ["Amount", entry.amount === null ? "—" : coins(entry.amount) + " XP"],
      ["From", entry.ip_address || "—"]
    ].forEach(function (pair) {
      var row = UI.el("div", { class: "kv" });
      row.innerHTML = '<span class="kv-key">' + UI.esc(pair[0]) + "</span>" +
        '<span class="kv-val">' + UI.esc(String(pair[1])) + "</span>";
      facts.appendChild(row);
    });

    var summary = UI.el("div", {
      class: "notice",
      dataset: { status: entry.sensitive ? "warning" : "info" }
    });
    summary.innerHTML = Icon(entry.sensitive ? "alert" : "info", 16) +
      "<div>" + UI.esc(entry.summary) + "</div>";

    body.appendChild(summary);
    body.appendChild(facts);

    if (entry.meta && Object.keys(entry.meta).length) {
      var meta = UI.el("div", { class: "card card-pad col gap-2" });
      meta.innerHTML = '<div class="eyebrow">Recorded detail</div>' +
        '<pre class="mono" style="font-size:11px;white-space:pre-wrap;margin:0;' +
        'color:var(--text-2)">' + UI.esc(JSON.stringify(entry.meta, null, 2)) + "</pre>";
      body.appendChild(meta);
    }

    UI.modal({
      title: entry.action,
      description: "Entry " + entry.audit_id + " — this record cannot be edited or removed.",
      size: "lg",
      body: body,
      actions: [{ label: "Close", variant: "ghost" }]
    });
  }

  /* ==========================================================================
     RENDER
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#auditBody");
    if (!host) return;
    UI.clear(host);

    if (loading && !entries.length) { host.appendChild(UI.skeletonRows(8)); return; }
    if (loadError) {
      host.appendChild(UI.errorState(
        loadError === "Your role does not allow this (audit.view)"
          ? "Your role does not allow you to read the audit trail."
          : loadError,
        load
      ));
      return;
    }

    if (!entries.length) {
      var filtered = filters.search || filters.category || filters.actor_id ||
        filters.sensitive || filters.from;
      host.appendChild(UI.emptyState({
        icon: "audit",
        title: filtered ? "Nothing matches" : "No actions recorded yet",
        text: filtered
          ? "No entries match the current filters."
          : "The trail fills as staff take money, change sessions, edit settings or " +
            "control a station. Nothing is written retrospectively.",
        actions: filtered
          ? [{ label: "Clear filters", icon: "close", onClick: function () {
              filters = { search: "", category: "", actor_id: "", sensitive: "", from: "", limit: 150 };
              renderChrome();
              load();
            } }]
          : null
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>When</th><th>Who</th><th>Area</th><th>What happened</th>" +
      '<th class="td-num">Amount</th></tr></thead>';
    var tbody = UI.el("tbody");

    entries.forEach(function (entry) {
      var tr = UI.el("tr", {
        style: { cursor: "pointer" },
        dataset: { status: entry.sensitive ? "warning" : "idle" }
      });
      tr.innerHTML =
        '<td style="white-space:nowrap">' +
          '<div style="font-size:12px;font-weight:600">' +
            UI.esc(UI.relTime(entry.created_at)) + "</div>" +
          '<div class="faint" style="font-size:10px">' +
            UI.esc(new Date(entry.created_at).toLocaleTimeString([], { hour12: false })) + "</div>" +
        "</td>" +
        '<td><div class="row gap-2">' +
          '<span class="avatar" style="width:24px;height:24px;font-size:10px">' +
            UI.esc(UI.initials(entry.actor_name || "?")) + "</span>" +
          "<div style='min-width:0'>" +
            '<div style="font-size:12px;font-weight:600">' + UI.esc(entry.actor_name || "Unknown") + "</div>" +
            '<div class="faint" style="font-size:10px">' + UI.esc(entry.actor_role || entry.actor_kind) + "</div>" +
          "</div></div></td>" +
        '<td><span class="badge" data-status="' +
          (CATEGORY_STATUS[entry.category] || "idle") + '">' +
          UI.esc(CATEGORY_LABEL[entry.category] || entry.category) + "</span></td>" +
        "<td><div style='font-size:12px'>" + UI.esc(entry.summary) + "</div>" +
          '<div class="faint mono" style="font-size:10px">' + UI.esc(entry.action) +
          (entry.sensitive ? " · flagged" : "") + "</div></td>" +
        '<td class="td-num">' +
          (entry.amount === null
            ? '<span class="faint">—</span>'
            : '<span style="font-weight:700;font-variant-numeric:tabular-nums">' +
              coins(entry.amount) + '</span><span class="faint" style="font-size:10px;margin-left:3px">XP</span>') +
        "</td>";

      tr.addEventListener("click", function () { openEntry(entry); });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function renderChrome() {
    if (!rootEl || !facets) return;

    var strip = rootEl.querySelector("#auditSummary");
    if (strip) {
      UI.clear(strip);
      var s = facets.summary || {};
      [
        ["Entries", s.total || 0, "accent"],
        ["Today", s.today || 0, "online"],
        ["Flagged", s.sensitive || 0, s.sensitive ? "warning" : "idle"],
        ["Since", s.first_entry ? UI.fmtDate(s.first_entry) : "—", "idle"]
      ].forEach(function (kpi) {
        var card = UI.el("div", { class: "stat stat-accent", dataset: { status: kpi[2] } });
        card.innerHTML = '<div class="stat-label">' + kpi[0] + "</div>" +
          '<div class="stat-value" style="font-size:' +
          (typeof kpi[1] === "string" ? "16px" : "26px") + '">' + UI.esc(String(kpi[1])) + "</div>";
        strip.appendChild(card);
      });
    }

    var catSelect = rootEl.querySelector("#auditCategory");
    if (catSelect && catSelect.options.length <= 1) {
      (facets.categories || []).forEach(function (c) {
        catSelect.appendChild(UI.el("option", {
          value: c.category,
          text: (CATEGORY_LABEL[c.category] || c.category) + " (" + c.count + ")"
        }));
      });
    }

    var actorSelect = rootEl.querySelector("#auditActor");
    if (actorSelect && actorSelect.options.length <= 1) {
      (facets.actors || []).forEach(function (a) {
        if (a.actor_id === null) return;
        actorSelect.appendChild(UI.el("option", {
          value: a.actor_id,
          text: (a.actor_name || "Unknown") + " (" + a.count + ")"
        }));
      });
    }
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.audit = {
    title: "Audit Log",
    subtitle: "Who did what, and when",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Audit Log</div>' +
          '<div class="page-sub">Every action that moves money, changes a session, edits a ' +
            "setting or controls a station. Append-only — nothing here can be edited or removed.</div>" +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="auditRefresh">' + Icon("refresh", 15) +
            '<span class="btn-label">Refresh</span></button>' +
        "</div></div>" +

        '<div class="grid grid-kpi" id="auditSummary" style="margin-bottom:var(--s-5)"></div>' +

        '<div class="toolbar">' +
          '<div class="search" style="width:280px">' + Icon("search", 15) +
            '<input class="input" id="auditSearch" type="search" placeholder="Search what happened…" autocomplete="off"></div>' +
          '<select class="select" id="auditCategory" style="width:170px">' +
            '<option value="">Every area</option></select>' +
          '<select class="select" id="auditActor" style="width:190px">' +
            '<option value="">Everyone</option></select>' +
          '<div class="row gap-2" id="auditPeriod">' +
            PERIODS.map(function (p, i) {
              return '<button class="chip" data-hours="' + (p.hours || "") + '"' +
                (i === PERIODS.length - 1 ? ' aria-pressed="true"' : "") + ">" + p.label + "</button>";
            }).join("") +
          "</div>" +
          '<button class="chip" id="auditSensitive" data-status="warning">Flagged only</button>' +
        "</div>" +

        '<div class="card card-body-flush" id="auditBody"></div>';
      root.appendChild(page);

      var refreshBtn = page.querySelector("#auditRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { facets = null; return load(); });
      });

      var search = page.querySelector("#auditSearch");
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          filters.search = search.value.trim();
          load();
        }, 260);
      });

      page.querySelector("#auditCategory").addEventListener("change", function (e) {
        filters.category = e.target.value;
        load();
      });
      page.querySelector("#auditActor").addEventListener("change", function (e) {
        filters.actor_id = e.target.value;
        load();
      });

      UI.$$("#auditPeriod .chip", page).forEach(function (chip) {
        chip.addEventListener("click", function () {
          var hours = chip.dataset.hours ? parseInt(chip.dataset.hours, 10) : null;
          filters.from = hours
            ? new Date(Date.now() - hours * 3600 * 1000).toISOString()
            : "";
          UI.$$("#auditPeriod .chip", page).forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
          });
          load();
        });
      });

      var sensitiveChip = page.querySelector("#auditSensitive");
      sensitiveChip.addEventListener("click", function () {
        filters.sensitive = filters.sensitive ? "" : "true";
        sensitiveChip.setAttribute("aria-pressed", String(!!filters.sensitive));
        load();
      });

      load();
    },

    unmount: function () {
      clearTimeout(searchTimer);
      rootEl = null;
    }
  };
})(window);
