/* ==========================================================================
   CafeXP Admin — Reservations
   Bookings ahead of time, by a specific station or "any station of a type".
   Availability is checked against real capacity — how many stations of that
   type exist versus how many overlapping bookings already claim one — the
   same rule the create endpoint enforces server-side.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var STATUS_TONE = {
    CONFIRMED: "accent", CHECKED_IN: "online", CANCELLED: "idle",
    NO_SHOW: "error", COMPLETED: "idle"
  };
  var STATUS_LABEL = {
    CONFIRMED: "Confirmed", CHECKED_IN: "Checked in", CANCELLED: "Cancelled",
    NO_SHOW: "No-show", COMPLETED: "Completed"
  };

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function categories() {
    var seen = {}, out = [];
    (Store.state.pcs || []).forEach(function (p) {
      if (p.category && !seen[p.category]) { seen[p.category] = true; out.push(p.category); }
    });
    return out.sort();
  }

  /* ==========================================================================
     BOOKING DIALOG
     ========================================================================== */
  function bookingDialog(onSaved) {
    var target = "category";   // "category" | "pc"
    var customer = null;

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label">Station</label>' +
        '<div class="row gap-2" id="rsTargetTabs">' +
          '<button type="button" class="btn btn-outline btn-sm is-active" data-target="category">Any of a type</button>' +
          '<button type="button" class="btn btn-outline btn-sm" data-target="pc">A specific station</button>' +
        "</div></div>" +
      '<div class="field" id="rsCategoryField"><label class="field-label" for="rsCategory">Station type</label>' +
        '<select class="select" id="rsCategory">' +
          categories().map(function (c) { return '<option value="' + UI.esc(c) + '">' + UI.esc(c) + "</option>"; }).join("") +
        "</select></div>" +
      '<div class="field hidden" id="rsPcField"><label class="field-label" for="rsPc">Station</label>' +
        '<select class="select" id="rsPc">' +
          (Store.state.pcs || []).map(function (p) {
            return '<option value="' + p.pc_id + '">' + UI.esc(p.name) + (p.category ? " — " + UI.esc(p.category) : "") + "</option>";
          }).join("") +
        "</select></div>" +
      '<div class="grid grid-3" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="rsDate">Date</label>' +
          '<input class="input" id="rsDate" type="date"></div>' +
        '<div class="field"><label class="field-label" for="rsStart">Start time</label>' +
          '<input class="input" id="rsStart" type="time"></div>' +
        '<div class="field"><label class="field-label" for="rsDuration">Duration</label>' +
          '<select class="select" id="rsDuration">' +
            [[30, "30 min"], [60, "1 hr"], [90, "1.5 hr"], [120, "2 hr"], [180, "3 hr"], [240, "4 hr"]].map(function (d) {
              return '<option value="' + d[0] + '"' + (d[0] === 60 ? " selected" : "") + ">" + d[1] + "</option>";
            }).join("") +
          "</select></div>" +
      "</div>" +
      '<div class="notice hidden" id="rsAvail"></div>' +
      '<div class="field"><label class="field-label">Who is it for</label>' +
        '<div id="rsCustomerPicker"></div>' +
        '<div class="row gap-2" style="margin-top:var(--s-2)" id="rsGuestFields">' +
          '<input class="input" id="rsGuestName" placeholder="Guest name" style="flex:1">' +
          '<input class="input" id="rsGuestPhone" placeholder="Phone (optional)" style="flex:1">' +
        "</div></div>" +
      '<div class="field"><label class="field-label" for="rsNotes">Notes</label>' +
        '<input class="input" id="rsNotes" placeholder="Optional"></div>';

    var dialog = UI.modal({
      title: "New booking",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Book", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var dateVal = ctx.body.querySelector("#rsDate").value;
            var timeVal = ctx.body.querySelector("#rsStart").value;
            var minutes = Number(ctx.body.querySelector("#rsDuration").value);
            if (!dateVal || !timeVal) {
              UI.toast.warn("Pick a date and time");
              return false;
            }
            var start = new Date(dateVal + "T" + timeVal);
            var end = new Date(start.getTime() + minutes * 60000);

            var payload = {
              start_time: start.toISOString(),
              end_time: end.toISOString(),
              notes: ctx.body.querySelector("#rsNotes").value.trim() || null
            };
            if (target === "pc") {
              payload.pc_id = Number(ctx.body.querySelector("#rsPc").value);
            } else {
              var cat = ctx.body.querySelector("#rsCategory").value;
              if (!cat) { UI.toast.warn("No station types are set up yet"); return false; }
              payload.category = cat;
            }
            if (customer) {
              payload.customer_id = customer.customer_id;
            } else {
              var guestName = ctx.body.querySelector("#rsGuestName").value.trim();
              if (!guestName) {
                Motion.shake(ctx.body.querySelector("#rsGuestName"));
                UI.toast.warn("Pick a customer or enter a guest name");
                return false;
              }
              payload.guest_name = guestName;
              payload.guest_phone = ctx.body.querySelector("#rsGuestPhone").value.trim() || null;
            }

            return Store.createReservation(payload)
              .then(function (r) {
                UI.toast.ok("Booked", r.data.pc_name || r.data.category);
                if (onSaved) onSaved();
                return true;
              })
              .catch(function (e) { UI.toast.error("Could not book that", e.message); return false; });
          }
        }
      ]
    });

    // Target toggle: category vs a specific station.
    var tabs = body.querySelectorAll("#rsTargetTabs button");
    var catField = body.querySelector("#rsCategoryField");
    var pcField = body.querySelector("#rsPcField");
    tabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        target = btn.dataset.target;
        tabs.forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        catField.classList.toggle("hidden", target !== "category");
        pcField.classList.toggle("hidden", target !== "pc");
        checkAvail();
      });
    });

    // Customer vs guest.
    var pickerHost = body.querySelector("#rsCustomerPicker");
    var guestFields = body.querySelector("#rsGuestFields");
    var custInput = UI.el("div", { class: "search" });
    custInput.innerHTML = Icon("search", 15) +
      '<input class="input" id="rsCustSearch" placeholder="Search a customer, or leave blank for a guest…" autocomplete="off">';
    var custResults = UI.el("div", { style: { maxHeight: "150px", overflow: "auto" } });
    pickerHost.appendChild(custInput);
    pickerHost.appendChild(custResults);

    var searchTimer = null;
    function searchCustomers() {
      var q = custInput.querySelector("input").value.trim();
      if (!q) { UI.clear(custResults); return; }
      Store.getCustomers({ search: q, limit: 10 }).then(function (b) {
        UI.clear(custResults);
        (b.data || []).forEach(function (c) {
          var row = UI.el("button", {
            type: "button", class: "kv", style: { width: "100%", padding: "8px 4px", border: 0, background: "transparent", textAlign: "left" }
          });
          row.innerHTML = "<span>" + UI.esc(c.customer_name) + "</span>" +
            '<span class="faint" style="font-size:11px">' + UI.esc(c.phone_number || c.email || "") + "</span>";
          row.addEventListener("click", function () {
            customer = c;
            custInput.querySelector("input").value = c.customer_name;
            UI.clear(custResults);
            guestFields.classList.add("hidden");
          });
          custResults.appendChild(row);
        });
      });
    }
    custInput.querySelector("input").addEventListener("input", function () {
      customer = null;
      guestFields.classList.remove("hidden");
      clearTimeout(searchTimer);
      searchTimer = setTimeout(searchCustomers, 250);
    });

    // Live availability check as the target/date/time/duration change.
    var availBox = body.querySelector("#rsAvail");
    function checkAvail() {
      var dateVal = body.querySelector("#rsDate").value;
      var timeVal = body.querySelector("#rsStart").value;
      var minutes = Number(body.querySelector("#rsDuration").value);
      if (!dateVal || !timeVal) { availBox.classList.add("hidden"); return; }
      var start = new Date(dateVal + "T" + timeVal);
      var end = new Date(start.getTime() + minutes * 60000);
      var params = { start_time: start.toISOString(), end_time: end.toISOString() };
      if (target === "pc") params.pc_id = body.querySelector("#rsPc").value;
      else params.category = body.querySelector("#rsCategory").value;

      Store.checkReservationAvailability(params).then(function (d) {
        availBox.classList.remove("hidden");
        availBox.setAttribute("data-status", d.available ? "online" : "error");
        if (!d.available && d.reason === "closed") {
          availBox.innerHTML = Icon("alert", 16) + "<div>" + UI.esc(d.message) + "</div>";
        } else if (target === "pc") {
          availBox.innerHTML = Icon(d.available ? "check" : "alert", 16) +
            "<div>" + (d.available ? "That station is free then." : "That station is already booked then.") + "</div>";
        } else {
          availBox.innerHTML = Icon(d.available ? "check" : "alert", 16) +
            "<div>" + d.booked + " of " + d.total + " " + UI.esc(d.category) + " station" + (d.total === 1 ? "" : "s") +
            " already booked then" + (d.available ? " — " + (d.total - d.booked) + " free." : ", none free.") + "</div>";
        }
      }).catch(function () { availBox.classList.add("hidden"); });
    }
    ["rsDate", "rsStart", "rsDuration", "rsCategory", "rsPc"].forEach(function (id) {
      var el = body.querySelector("#" + id);
      if (el) el.addEventListener("change", checkAvail);
    });

    // Sensible defaults: today, next half hour.
    var now = new Date();
    now.setMinutes(now.getMinutes() < 30 ? 30 : 60, 0, 0);
    body.querySelector("#rsDate").value = now.toISOString().slice(0, 10);
    body.querySelector("#rsStart").value = now.toTimeString().slice(0, 5);
    checkAvail();

    return dialog;
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  var rootEl = null, bodyEl = null;
  var reservations = [], loading = true, loadError = null;
  var filterDate = null, filterStatus = "", filterCategory = "";
  var viewMode = "calendar";   // "calendar" | "list"

  // 8am-midnight until the café's real hours load, and permanently for a
  // café that has never set any, or whose hours cross midnight — a single
  // day-column grid has no good way to draw a wrapped overnight window, so
  // that case keeps the wide default rather than drawing something wrong.
  var CAL_HOUR_START = 8, CAL_HOUR_END = 24;
  var CAL_PX_PER_HOUR = 56;

  function loadCalendarHours() {
    Store.getReservationHours().then(function (h) {
      if (!h.opening_time || !h.closing_time) return;
      var openHour = Number(h.opening_time.split(":")[0]);
      var closeHour = Number(h.closing_time.split(":")[0]) || 24;
      if (closeHour <= openHour) return;   // crosses midnight — keep the default
      CAL_HOUR_START = openHour;
      CAL_HOUR_END = closeHour;
      render();
    }).catch(function () {});
  }

  function dayRange(dateStr) {
    var start = new Date(dateStr + "T00:00:00");
    var end = new Date(dateStr + "T23:59:59.999");
    return { from: start.toISOString(), to: end.toISOString() };
  }

  function load() {
    loading = true; loadError = null; render();
    var params = {};
    var range = dayRange(filterDate);
    params.from = range.from; params.to = range.to;
    if (filterStatus) params.status = filterStatus;
    if (filterCategory) params.category = filterCategory;

    return Store.listReservations(params)
      .then(function (r) { reservations = r.data || []; loading = false; render(); })
      .catch(function (e) { loading = false; loadError = e.message; render(); });
  }

  function act(promise, okMsg) {
    return promise
      .then(function () { UI.toast.ok(okMsg); load(); })
      .catch(function (e) { UI.toast.error("Could not update that booking", e.message); });
  }

  /* Shared by the table row and the calendar block's detail popover, so
     check-in/no-show/cancel behave identically wherever a booking is acted
     on from. */
  function actionButtons(r, opts) {
    var wrap = UI.el("div", { class: "row gap-2 wrap" });
    if (r.status !== "CONFIRMED") return wrap;

    var checkIn = UI.el("button", { class: "btn btn-outline btn-sm", html: Icon("check", 13) + '<span class="btn-label">Check in</span>' });
    checkIn.addEventListener("click", function () { act(Store.checkInReservation(r.reservation_id), "Checked in"); });

    var noShow = UI.el("button", { class: "btn btn-ghost btn-sm", text: "No-show" });
    noShow.addEventListener("click", function () {
      UI.confirm({
        title: "Mark as a no-show?",
        message: (r.customer_name || "This guest") + " did not show up for their booking.",
        confirmLabel: "Mark no-show", variant: "danger"
      }).then(function (ok) { if (ok) act(Store.markReservationNoShow(r.reservation_id), "Marked as a no-show"); });
    });

    var cancel = UI.el("button", { class: "btn btn-ghost btn-sm", html: Icon("close", 13) + (opts && opts.labelled ? '<span class="btn-label">Cancel</span>' : "") });
    if (!(opts && opts.labelled)) cancel.title = "Cancel";
    cancel.addEventListener("click", function () {
      UI.confirm({
        title: "Cancel this booking?",
        message: "The station is freed for that time.",
        confirmLabel: "Cancel booking", variant: "danger"
      }).then(function (ok) { if (ok) act(Store.cancelReservation(r.reservation_id), "Booking cancelled"); });
    });

    wrap.appendChild(checkIn); wrap.appendChild(noShow); wrap.appendChild(cancel);
    return wrap;
  }

  function row(r) {
    var tr = UI.el("tr");
    tr.innerHTML =
      '<td class="mono" style="font-size:12px">' + fmtTime(r.start_time) + "–" + fmtTime(r.end_time) + "</td>" +
      "<td>" + UI.esc(r.pc_name || (r.category ? "Any " + r.category : "—")) + "</td>" +
      "<td><div>" + UI.esc(r.customer_name || "Guest") + "</div>" +
        (r.guest_phone ? '<div class="faint" style="font-size:11px">' + UI.esc(r.guest_phone) + "</div>" : "") + "</td>" +
      '<td><span class="badge" data-status="' + (STATUS_TONE[r.status] || "idle") + '">' + (STATUS_LABEL[r.status] || r.status) + "</span></td>" +
      '<td class="faint" style="font-size:12px">' + UI.esc(r.notes || "—") + "</td>" +
      '<td class="td-actions"></td>';
    tr.querySelector(".td-actions").appendChild(actionButtons(r));
    return tr;
  }

  /** A booking's detail + actions, opened by clicking its block on the calendar. */
  function detailDialog(r) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="card card-pad col gap-1" style="background:var(--bg-inset)">' +
        '<div class="kv"><span class="kv-key">Station</span><span class="kv-val">' +
          UI.esc(r.pc_name || (r.category ? "Any " + r.category : "—")) + "</span></div>" +
        '<div class="kv"><span class="kv-key">When</span><span class="kv-val">' +
          fmtTime(r.start_time) + "–" + fmtTime(r.end_time) + "</span></div>" +
        '<div class="kv"><span class="kv-key">Who</span><span class="kv-val">' + UI.esc(r.customer_name || "Guest") +
          (r.guest_phone ? " · " + UI.esc(r.guest_phone) : "") + "</span></div>" +
        '<div class="kv"><span class="kv-key">Status</span><span class="kv-val"><span class="badge" data-status="' +
          (STATUS_TONE[r.status] || "idle") + '">' + (STATUS_LABEL[r.status] || r.status) + "</span></span></div>" +
        (r.notes ? '<div class="kv"><span class="kv-key">Notes</span><span class="kv-val">' + UI.esc(r.notes) + "</span></div>" : "") +
      "</div>";
    var actionsHost = UI.el("div");
    actionsHost.appendChild(actionButtons(r, { labelled: true }));
    body.appendChild(actionsHost);

    return UI.modal({ title: "Booking", body: body, actions: [{ label: "Close", variant: "ghost" }] });
  }

  /*
   * A day-view calendar: one column per station type, hour rows down the
   * side, each booking a block positioned by its actual start/duration.
   * Pinned-station bookings and "any station" ones land in the same column
   * (their type) — the block itself still says which station once it is
   * pinned to one.
   */
  function renderCalendar(host) {
    var cols = filterCategory ? [filterCategory] : categories();
    var gridHeight = (CAL_HOUR_END - CAL_HOUR_START) * CAL_PX_PER_HOUR;

    if (!cols.length) {
      host.appendChild(UI.emptyState({
        icon: "reservations", title: "No station types set up",
        text: "Add a category to your stations before bookings can be scheduled by type."
      }));
      return;
    }

    var cal = UI.el("div", { class: "card", style: { overflow: "hidden" } });
    var head = UI.el("div", { class: "row", style: { borderBottom: "1px solid var(--line)" } });
    head.appendChild(UI.el("div", { style: { width: "56px", flex: "0 0 auto" } }));
    cols.forEach(function (c) {
      head.appendChild(UI.el("div", {
        style: { flex: "1", minWidth: "160px", padding: "10px 12px", fontWeight: "650", fontSize: "13px", borderLeft: "1px solid var(--line-faint)" },
        text: c
      }));
    });
    cal.appendChild(head);

    var body = UI.el("div", { class: "row", style: { position: "relative", alignItems: "stretch" } });

    // Hour gutter.
    var gutter = UI.el("div", { style: { width: "56px", flex: "0 0 auto", position: "relative", height: gridHeight + "px" } });
    for (var h = CAL_HOUR_START; h <= CAL_HOUR_END; h++) {
      var top = (h - CAL_HOUR_START) * CAL_PX_PER_HOUR;
      gutter.appendChild(UI.el("div", {
        style: { position: "absolute", top: (top - 6) + "px", right: "8px", fontSize: "11px", color: "var(--text-3)" },
        text: (h % 24 === 0 ? "12am" : h < 12 ? h + "am" : h === 12 ? "12pm" : (h - 12) + "pm")
      }));
    }
    body.appendChild(gutter);

    cols.forEach(function (c) {
      var col = UI.el("div", {
        style: { flex: "1", minWidth: "160px", position: "relative", height: gridHeight + "px", borderLeft: "1px solid var(--line-faint)" }
      });
      for (var hh = CAL_HOUR_START; hh <= CAL_HOUR_END; hh++) {
        col.appendChild(UI.el("div", {
          style: {
            position: "absolute", top: ((hh - CAL_HOUR_START) * CAL_PX_PER_HOUR) + "px",
            left: 0, right: 0, borderTop: "1px solid var(--line-faint)"
          }
        }));
      }

      reservations
        .filter(function (r) { return (r.category || "") === c; })
        .forEach(function (r) {
          var s = new Date(r.start_time), e = new Date(r.end_time);
          var startHour = s.getHours() + s.getMinutes() / 60;
          var endHour = e.getHours() + e.getMinutes() / 60;
          if (endHour <= startHour) endHour += 24;   // past midnight
          var top = Math.max(0, (startHour - CAL_HOUR_START) * CAL_PX_PER_HOUR);
          var height = Math.max(20, (endHour - startHour) * CAL_PX_PER_HOUR);

          var block = UI.el("div", {
            style: {
              position: "absolute", top: top + "px", height: height + "px", left: "4px", right: "4px",
              borderRadius: "8px", padding: "4px 8px", overflow: "hidden", cursor: "pointer",
              background: "var(--st-soft)", border: "1px solid var(--st-line)", borderLeft: "3px solid var(--st)"
            },
            dataset: { status: STATUS_TONE[r.status] || "idle" }
          });
          block.innerHTML =
            '<div style="font-size:11px;font-weight:700;line-height:1.3">' + UI.esc(r.pc_name || "Any station") + "</div>" +
            '<div class="faint" style="font-size:10px;line-height:1.3">' + fmtTime(r.start_time) + "–" + fmtTime(r.end_time) + "</div>" +
            '<div style="font-size:11px;line-height:1.3" class="truncate">' + UI.esc(r.customer_name || "Guest") + "</div>";
          block.addEventListener("click", function () { detailDialog(r); });
          col.appendChild(block);
        });

      body.appendChild(col);
    });

    cal.appendChild(body);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(cal);
    host.appendChild(wrap);
  }

  function render() {
    if (!bodyEl) return;
    UI.clear(bodyEl);

    var filters = UI.el("div", { class: "row gap-3 wrap", style: { marginBottom: "var(--s-4)" } });
    filters.innerHTML =
      '<input class="input" id="rsFilterDate" type="date" style="max-width:160px">' +
      '<select class="select" id="rsFilterStatus" style="max-width:160px">' +
        '<option value="">Every status</option>' +
        Object.keys(STATUS_LABEL).map(function (s) {
          return '<option value="' + s + '"' + (filterStatus === s ? " selected" : "") + ">" + STATUS_LABEL[s] + "</option>";
        }).join("") +
      "</select>" +
      '<select class="select" id="rsFilterCategory" style="max-width:160px">' +
        '<option value="">Every type</option>' +
        categories().map(function (c) { return '<option value="' + UI.esc(c) + '"' + (filterCategory === c ? " selected" : "") + ">" + UI.esc(c) + "</option>"; }).join("") +
      "</select>" +
      '<div class="row gap-1" id="rsViewToggle" style="margin-left:auto">' +
        '<button type="button" class="btn btn-sm ' + (viewMode === "calendar" ? "btn-primary" : "btn-outline") + '" data-mode="calendar">Calendar</button>' +
        '<button type="button" class="btn btn-sm ' + (viewMode === "list" ? "btn-primary" : "btn-outline") + '" data-mode="list">List</button>' +
      "</div>";
    bodyEl.appendChild(filters);
    filters.querySelector("#rsFilterDate").value = filterDate;
    filters.querySelector("#rsFilterDate").addEventListener("change", function (e) { filterDate = e.target.value; load(); });
    filters.querySelector("#rsFilterStatus").addEventListener("change", function (e) { filterStatus = e.target.value; load(); });
    filters.querySelector("#rsFilterCategory").addEventListener("change", function (e) { filterCategory = e.target.value; load(); });
    filters.querySelectorAll("#rsViewToggle button").forEach(function (btn) {
      btn.addEventListener("click", function () { viewMode = btn.dataset.mode; render(); });
    });

    if (loading) { bodyEl.appendChild(UI.skeletonRows(5)); return; }
    if (loadError) { bodyEl.appendChild(UI.errorState(loadError, load)); return; }

    if (viewMode === "calendar") {
      renderCalendar(bodyEl);
      return;
    }

    if (!reservations.length) {
      bodyEl.appendChild(UI.emptyState({
        icon: "reservations", title: "Nothing booked for this day",
        text: "Bookings made here or from the website for this date and filter will show up here."
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML = "<thead><tr><th>Time</th><th>Station</th><th>Who</th><th>Status</th><th>Notes</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");
    reservations.forEach(function (r) { tbody.appendChild(row(r)); });
    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    bodyEl.appendChild(wrap);
    Motion.enter(wrap, { y: 8, duration: 0.2 });
  }

  global.CXPages.reservations = {
    title: "Reservations",
    subtitle: "Bookings and check-ins",

    mount: function (root) {
      rootEl = root;
      filterDate = new Date().toISOString().slice(0, 10);
      filterStatus = ""; filterCategory = "";

      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head">' +
          "<div>" +
            '<div class="page-title">Reservations</div>' +
            '<div class="page-sub">Bookings by station and time, with check-in and no-show</div>' +
          "</div>" +
          '<div class="page-actions"><button class="btn btn-primary" id="rsNew">' + Icon("plus", 15) +
            '<span class="btn-label">New booking</span></button></div>' +
        "</div>" +
        '<div id="rsBody"></div>';
      root.appendChild(page);
      bodyEl = page.querySelector("#rsBody");
      page.querySelector("#rsNew").addEventListener("click", function () { bookingDialog(load); });
      load();
      loadCalendarHours();
    },

    unmount: function () { rootEl = null; bodyEl = null; }
  };
})(window);
