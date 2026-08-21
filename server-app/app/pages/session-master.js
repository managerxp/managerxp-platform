/* ==========================================================================
   CafeXP Admin — Session Master
   The sellable gaming durations. duration_minutes is computed by the server,
   so this screen only ever sends the type and the raw duration.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var rows = [];
  var loading = false;
  var loadError = null;
  var query = "";
  var statusFilter = "";
  var searchTimer = null;

  var TYPES = [
    { value: "MINUTES",   label: "Minutes" },
    { value: "HOURS",     label: "Hours" },
    { value: "CUSTOM",    label: "Custom (minutes)" },
    { value: "UNLIMITED", label: "Unlimited / Any Time" }
  ];

  /** Mirror of the server's calculation, purely so the form can preview it. */
  function minutesFor(type, duration) {
    if (type === "UNLIMITED") return null;
    var n = parseInt(duration, 10);
    if (!n || n < 1) return null;
    return type === "HOURS" ? n * 60 : n;
  }

  function durationText(row) {
    if (row.duration_minutes === null) return "Unlimited";
    var m = row.duration_minutes;
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), rem = m % 60;
    return h + "h" + (rem ? " " + rem + "m" : "") + " (" + m + " min)";
  }

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function load() {
    loading = true;
    loadError = null;
    render();
    return Store.listSessionMaster({ search: query, status: statusFilter, limit: 200 })
      .then(function (body) { rows = body.data || []; loading = false; render(); })
      .catch(function (err) { loading = false; loadError = err.message; rows = []; render(); });
  }

  /* ==========================================================================
     ADD / EDIT
     ========================================================================== */
  function sessionForm(existing) {
    var isEdit = !!existing;
    var body = UI.el("div", { class: "col gap-4" });

    body.innerHTML =
      '<div class="field">' +
        '<label class="field-label field-req" for="smName">Session name</label>' +
        '<input class="input" id="smName" placeholder="1 Hour" maxlength="255" ' +
          'value="' + UI.esc(existing ? existing.session_name : "") + '" data-autofocus>' +
        '<div class="field-hint">What staff will see when starting a session.</div>' +
      "</div>" +

      '<div class="field">' +
        '<label class="field-label field-req" for="smType">Duration type</label>' +
        '<select class="select" id="smType">' +
          TYPES.map(function (t) {
            return '<option value="' + t.value + '"' +
              (existing && existing.duration_type === t.value ? " selected" : "") + ">" + t.label + "</option>";
          }).join("") +
        "</select>" +
      "</div>" +

      '<div class="field" id="smDurationField">' +
        '<label class="field-label field-req" for="smDuration">Duration</label>' +
        '<input class="input" id="smDuration" type="number" min="1" step="1" placeholder="1" ' +
          'value="' + UI.esc(existing && existing.duration !== null ? existing.duration : "") + '">' +
      "</div>" +

      '<div class="notice" data-status="accent" id="smPreview"></div>' +

      '<label class="switch">' +
        '<input type="checkbox" id="smStatus"' +
          (!existing || existing.status === "ACTIVE" ? " checked" : "") + '>' +
        '<span class="switch-track"></span>' +
        '<span style="font-size:13px">Active — available when starting a session</span>' +
      "</label>";

    var dialog = UI.modal({
      title: isEdit ? "Edit session" : "Add session",
      description: isEdit ? existing.session_name : "Create a gaming duration staff can sell.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isEdit ? "Save changes" : "Create session",
          variant: "primary",
          icon: "check",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#smName").value.trim();
            var type = ctx.body.querySelector("#smType").value;
            var durationRaw = ctx.body.querySelector("#smDuration").value;
            var status = ctx.body.querySelector("#smStatus").checked ? "ACTIVE" : "INACTIVE";

            if (!name) {
              Motion.shake(ctx.body.querySelector("#smName"));
              UI.toast.warn("A session name is required");
              return false;
            }
            if (type !== "UNLIMITED") {
              var n = parseInt(durationRaw, 10);
              if (!n || n < 1) {
                Motion.shake(ctx.body.querySelector("#smDuration"));
                UI.toast.warn("Enter a duration of at least 1");
                return false;
              }
            }

            var payload = {
              session_name: name,
              duration_type: type,
              duration: type === "UNLIMITED" ? null : parseInt(durationRaw, 10),
              status: status
            };

            var call = isEdit
              ? Store.updateSessionMaster(existing.id, payload)
              : Store.createSessionMaster(payload);

            return call
              .then(function (r) {
                UI.toast.ok(isEdit ? "Session updated" : "Session created", r.data.session_name);
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) {
                UI.toast.error(isEdit ? "Could not save" : "Could not create", err.message);
                return false;
              });
          }
        }
      ]
    });

    /* Type drives whether a duration is asked for at all. */
    var typeSelect = body.querySelector("#smType");
    var durationField = body.querySelector("#smDurationField");
    var durationInput = body.querySelector("#smDuration");
    var preview = body.querySelector("#smPreview");

    function refresh() {
      var type = typeSelect.value;
      var unlimited = type === "UNLIMITED";
      durationField.classList.toggle("hidden", unlimited);

      if (unlimited) {
        preview.setAttribute("data-status", "warning");
        preview.innerHTML = Icon("clock", 16) +
          "<div>No time limit — the session runs until staff end it. " +
          "Duration is stored as <strong>NULL</strong>.</div>";
        return;
      }

      var minutes = minutesFor(type, durationInput.value);
      if (minutes === null) {
        preview.setAttribute("data-status", "idle");
        preview.innerHTML = Icon("info", 16) + "<div>Enter a duration to see the calculated minutes.</div>";
        return;
      }
      preview.setAttribute("data-status", "accent");
      preview.innerHTML = Icon("check", 16) +
        "<div>Stored as <strong>" + minutes + " minutes</strong>" +
        (type === "HOURS" ? " (" + durationInput.value + " × 60)" : "") + ".</div>";
    }

    typeSelect.addEventListener("change", refresh);
    durationInput.addEventListener("input", refresh);
    refresh();

    return dialog;
  }

  /* ==========================================================================
     TABLE
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#smTable");
    if (!host) return;
    UI.clear(host);

    if (loading && !rows.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (loadError) { host.appendChild(UI.errorState(loadError, load)); return; }

    if (!rows.length) {
      host.appendChild(UI.emptyState({
        icon: "clock",
        title: query || statusFilter ? "No sessions match" : "No sessions yet",
        text: query || statusFilter
          ? "Nothing matches the current search and filter."
          : "Create the durations your café sells — 30 minutes, 1 hour, a night package.",
        actions: [{
          label: query || statusFilter ? "Clear filters" : "Add session",
          icon: query || statusFilter ? "close" : "plus",
          variant: "primary",
          onClick: function () {
            if (query || statusFilter) {
              query = ""; statusFilter = "";
              rootEl.querySelector("#smSearch").value = "";
              syncFilters();
              load();
            } else sessionForm(null);
          }
        }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>ID</th><th>Session name</th><th>Type</th>" +
      "<th class='td-num'>Duration</th><th class='td-num'>Minutes</th>" +
      "<th>Prices</th><th>Status</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    rows.forEach(function (row) {
      var active = row.status === "ACTIVE";
      var tr = UI.el("tr", { dataset: { status: active ? "online" : "idle" } });
      tr.innerHTML =
        '<td class="mono faint">#' + row.id + "</td>" +
        "<td><strong>" + UI.esc(row.session_name) + "</strong></td>" +
        '<td><span class="badge badge-plain">' + UI.esc(row.duration_type) + "</span></td>" +
        '<td class="td-num">' + (row.duration === null ? '<span class="faint">—</span>' : row.duration) + "</td>" +
        '<td class="td-num mono">' + UI.esc(durationText(row)) + "</td>" +
        "<td>" + (row.price_count
          ? '<span class="badge badge-plain">' + row.price_count + "</span>"
          : '<span class="faint">none</span>') + "</td>" +
        '<td><span class="badge" data-status="' + (active ? "online" : "idle") + '">' +
          (active ? "Active" : "Inactive") + "</span></td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");

      var editBtn = UI.el("button", {
        class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit"
      });
      editBtn.addEventListener("click", function () { sessionForm(row); });

      var toggleBtn = UI.el("button", {
        class: "btn btn-sm btn-icon " + (active ? "btn-warn" : "btn-ok"),
        html: Icon(active ? "pause" : "check", 13),
        "data-tip": active ? "Deactivate" : "Activate"
      });
      toggleBtn.addEventListener("click", function () {
        Store.setSessionMasterStatus(row.id, active ? "INACTIVE" : "ACTIVE")
          .then(function (r) { UI.toast.ok(r.message, row.session_name); return load(); })
          .catch(function (err) { UI.toast.error("Could not update status", err.message); });
      });

      var delBtn = UI.el("button", {
        class: "btn btn-danger btn-sm btn-icon", html: Icon("trash", 13), "data-tip": "Delete"
      });
      delBtn.addEventListener("click", function () { confirmDelete(row); });

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

  /** Deleting a priced session takes its prices with it, so say so plainly. */
  function confirmDelete(row) {
    UI.confirm({
      title: "Delete " + row.session_name + "?",
      message: row.price_count
        ? "This session has " + row.price_count + " price(s) configured. Deleting removes those prices too. " +
          "Deactivating keeps the history instead."
        : "This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger"
    }).then(function (ok) {
      if (!ok) return;
      Store.deleteSessionMaster(row.id, row.price_count > 0)
        .then(function () { UI.toast.ok("Session deleted", row.session_name); return load(); })
        .catch(function (err) { UI.toast.error("Could not delete", err.message); });
    });
  }

  function syncFilters() {
    if (!rootEl) return;
    UI.$$("#smFilters .chip", rootEl).forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.dataset.status === statusFilter));
    });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages["session-master"] = {
    title: "Session Master",
    subtitle: "Gaming durations you can sell",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Session Master</div>' +
            '<div class="page-sub">The durations staff choose from. Minutes are calculated for you.</div>' +
          "</div>" +
          '<div class="page-actions">' +
            '<button class="btn btn-outline" id="smRefresh">' + Icon("refresh", 15) +
              '<span class="btn-label">Refresh</span></button>' +
            '<button class="btn btn-primary" id="smAdd">' + Icon("plus", 15) +
              '<span class="btn-label">Add session</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="toolbar">' +
          '<div class="search" style="width:300px">' + Icon("search", 15) +
            '<input class="input" id="smSearch" type="search" placeholder="Search session name…" autocomplete="off">' +
          "</div>" +
          '<div class="row gap-2" id="smFilters">' +
            '<button class="chip" data-status="" data-status-chip aria-pressed="true">All</button>' +
            '<button class="chip" data-status="ACTIVE">Active</button>' +
            '<button class="chip" data-status="INACTIVE">Inactive</button>' +
          "</div>" +
        "</div>" +
        '<div class="card card-body-flush" id="smTable"></div>';
      root.appendChild(page);

      page.querySelector("#smAdd").addEventListener("click", function () { sessionForm(null); });

      var refreshBtn = page.querySelector("#smRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return load(); });
      });

      var search = page.querySelector("#smSearch");
      search.value = query;
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { query = search.value.trim(); load(); }, 250);
      });

      UI.$$("#smFilters .chip", page).forEach(function (chip) {
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
