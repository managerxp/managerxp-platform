/* ==========================================================================
   CafeXP Admin — Reports
   Aggregates over bills, sessions and orders. Nothing is modelled or
   projected: if the café has traded for three days, the report covers three
   days and says so.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var tab = "overview";
  var days = 30;
  var loading = false;
  var loadError = null;
  var data = {};

  var PERIODS = [
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
    { label: "This year", days: 365 }
  ];

  var TABS = [
    { id: "overview", label: "Overview" },
    { id: "stations", label: "Stations" },
    { id: "customers", label: "Customers" },
    { id: "products", label: "F&B" }
  ];

  function money(value) {
    var n = Number(value || 0);
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: Math.round(n * 100) % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return n.toFixed(2); }
  }

  function window_() {
    var to = new Date();
    var from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  /* ==========================================================================
     BARS
     A plain bar row rather than a charting library: it reads the same at a
     glance and adds no dependency to a desktop app that loads over file://.
     ========================================================================== */
  function barChart(points, valueKey, labelFor, status) {
    var values = points.map(function (p) { return Number(p[valueKey] || 0); });
    var max = Math.max.apply(null, values.concat([0]));

    if (!points.length || max === 0) {
      return UI.emptyState({
        icon: "reports",
        title: "Nothing in this period",
        text: "No activity was recorded in the selected range."
      });
    }

    var wrap = UI.el("div", { class: "rp-bars", dataset: { status: status || "accent" } });
    points.forEach(function (p) {
      var value = Number(p[valueKey] || 0);
      var col = UI.el("div", { class: "rp-bar" });
      col.innerHTML =
        '<div class="rp-bar-track"><span class="rp-bar-fill" style="height:' +
          (max > 0 ? (value / max) * 100 : 0) + '%"></span></div>' +
        '<div class="rp-bar-label">' + UI.esc(labelFor(p)) + "</div>";
      col.setAttribute("data-tip", labelFor(p) + " · " + money(value));
      wrap.appendChild(col);
    });
    return wrap;
  }

  function statCard(label, value, sub, status) {
    var card = UI.el("div", { class: "stat stat-accent", dataset: { status: status || "accent" } });
    card.innerHTML =
      '<div class="stat-label">' + UI.esc(label) + "</div>" +
      '<div class="stat-value">' + UI.esc(String(value)) + "</div>" +
      (sub ? '<div class="stat-foot">' + UI.esc(sub) + "</div>" : "");
    return card;
  }

  function table(columns, rows, cellFor) {
    if (!rows.length) {
      return UI.emptyState({
        icon: "reports",
        title: "Nothing to show",
        text: "No records fall inside the selected period."
      });
    }
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

  /* ==========================================================================
     LOAD
     ========================================================================== */
  function load() {
    loading = true;
    loadError = null;
    render();

    var range = window_();
    // A 90-day span in daily buckets is unreadable; step up the bucket with
    // the window rather than draw 90 slivers.
    var bucket = days <= 30 ? "day" : (days <= 90 ? "week" : "month");

    var calls = {
      overview: function () {
        return Promise.all([
          Store.report("summary", range),
          Store.report("revenue", { ...range, bucket: bucket }),
          Store.report("hours", range)
        ]).then(function (r) {
          data.summary = r[0].data;
          data.revenue = r[1].data;
          data.bucket = bucket;
          data.hours = r[2].data;
        });
      },
      stations: function () {
        return Store.report("stations", range).then(function (r) {
          data.stations = r.data;
          data.stationWindow = r.window;
        });
      },
      customers: function () {
        return Store.report("customers", range).then(function (r) { data.customers = r.data; });
      },
      products: function () {
        return Store.report("products", range).then(function (r) { data.products = r.data; });
      }
    };

    return calls[tab]()
      .then(function () { loading = false; render(); })
      .catch(function (err) { loading = false; loadError = err.message; render(); });
  }

  /* ==========================================================================
     VIEWS
     ========================================================================== */
  function renderOverview(host) {
    var s = data.summary;
    if (!s) return;

    var strip = UI.el("div", { class: "grid grid-kpi", style: { marginBottom: "var(--s-5)" } });
    strip.appendChild(statCard("Revenue", money(s.revenue.total) + " XP",
      s.revenue.bills + " bills · " + money(s.revenue.average_bill) + " average", "online"));
    strip.appendChild(statCard("Outstanding", money(s.revenue.outstanding) + " XP",
      s.revenue.open + " bill(s) still open", s.revenue.open ? "warning" : "idle"));
    strip.appendChild(statCard("Play time", s.sessions.play_hours + " h",
      s.sessions.count + " sessions · " + s.sessions.average_minutes + " min average", "gaming"));
    strip.appendChild(statCard("F&B", money(s.fnb.revenue) + " XP",
      s.fnb.orders + " orders", "accent"));
    host.appendChild(strip);

    var second = UI.el("div", { class: "grid grid-kpi", style: { marginBottom: "var(--s-5)" } });
    second.appendChild(statCard("Discounts given", money(s.revenue.discounts) + " XP", null,
      s.revenue.discounts > 0 ? "warning" : "idle"));
    second.appendChild(statCard("New customers", s.customers.new, "registered in this period", "accent"));
    second.appendChild(statCard("Guest sessions", s.sessions.guests,
      s.sessions.registered + " by registered customers", "idle"));
    second.appendChild(statCard("Wallet top-ups", money(s.customers.wallet_topped_up) + " XP",
      money(s.customers.wallet_spent) + " XP spent", "online"));
    host.appendChild(second);

    var revCard = UI.el("div", { class: "card", style: { marginBottom: "var(--s-5)" } });
    revCard.innerHTML =
      '<div class="card-head"><div><h3>Revenue</h3>' +
      '<div class="faint" style="font-size:11px;margin-top:2px">By ' + data.bucket +
      ". Quiet days show as zero rather than being skipped.</div></div></div>";
    var revBody = UI.el("div", { class: "card-body" });
    revBody.appendChild(barChart(data.revenue, "revenue", function (p) {
      var d = new Date(p.at);
      return data.bucket === "month"
        ? d.toLocaleDateString([], { month: "short" })
        : d.toLocaleDateString([], { day: "numeric", month: "short" });
    }, "online"));
    revCard.appendChild(revBody);
    host.appendChild(revCard);

    var hoursCard = UI.el("div", { class: "card" });
    hoursCard.innerHTML =
      '<div class="card-head"><div><h3>When the café is busy</h3>' +
      '<div class="faint" style="font-size:11px;margin-top:2px">Sessions started, by hour of day' +
      "</div></div></div>";
    var hoursBody = UI.el("div", { class: "card-body" });
    hoursBody.appendChild(barChart(data.hours, "sessions", function (p) {
      return String(p.hour).padStart(2, "0");
    }, "gaming"));
    hoursCard.appendChild(hoursBody);
    host.appendChild(hoursCard);
  }

  function renderStations(host) {
    var rows = data.stations || [];
    var note = UI.el("div", {
      class: "notice", dataset: { status: "info" },
      html: Icon("info", 16) + "<div>Utilisation is billable play time against the " +
        (data.stationWindow ? Math.round(data.stationWindow.hours) : "?") +
        " hours this period spans — not against opening hours, which the system does not know.</div>"
    });
    host.appendChild(note);

    var card = UI.el("div", { class: "card card-body-flush", style: { marginTop: "var(--s-4)" } });
    card.appendChild(table(
      [
        { key: "pc_name", label: "Station" },
        { key: "zone_name", label: "Zone" },
        { key: "sessions", label: "Sessions", num: true },
        { key: "play_hours", label: "Play hours", num: true },
        { key: "utilisation_percent", label: "Utilisation", num: true },
        { key: "gaming_revenue", label: "Gaming revenue", num: true }
      ],
      rows,
      function (row, col) {
        if (col.key === "pc_name") return "<strong>" + UI.esc(row.pc_name) + "</strong>";
        if (col.key === "zone_name") {
          return row.zone_name
            ? '<span class="badge badge-plain">' + UI.esc(row.zone_name) + "</span>"
            : '<span class="faint">—</span>';
        }
        if (col.key === "gaming_revenue") return money(row.gaming_revenue) + " XP";
        if (col.key === "utilisation_percent") {
          return '<span style="font-weight:700">' + row.utilisation_percent + "%</span>";
        }
        return String(row[col.key]);
      }
    ));
    host.appendChild(card);
  }

  function renderCustomers(host) {
    var c = data.customers || { top: [], mix: {} };

    var strip = UI.el("div", { class: "grid grid-kpi", style: { marginBottom: "var(--s-5)" } });
    strip.appendChild(statCard("First-time visitors", c.mix.new_customers || 0,
      "their first ever session was in this period", "online"));
    strip.appendChild(statCard("Returning", c.mix.existing_customers || 0,
      "played here before this period", "accent"));
    host.appendChild(strip);

    var card = UI.el("div", { class: "card card-body-flush" });
    card.appendChild(table(
      [
        { key: "customer_name", label: "Customer" },
        { key: "phone_number", label: "Mobile" },
        { key: "sessions", label: "Sessions", num: true },
        { key: "play_hours", label: "Play hours", num: true },
        { key: "gaming_spend", label: "Spend", num: true },
        { key: "last_visit", label: "Last visit" }
      ],
      c.top,
      function (row, col) {
        if (col.key === "customer_name") return "<strong>" + UI.esc(row.customer_name) + "</strong>";
        if (col.key === "phone_number") {
          return '<span class="mono faint" style="font-size:11px">' +
            UI.esc(row.phone_number || "—") + "</span>";
        }
        if (col.key === "gaming_spend") return money(row.gaming_spend) + " XP";
        if (col.key === "last_visit") return UI.esc(UI.relTime(row.last_visit));
        return String(row[col.key]);
      }
    ));
    host.appendChild(card);
  }

  function renderProducts(host) {
    var p = data.products || { items: [], categories: [] };

    if (p.categories.length) {
      var catCard = UI.el("div", { class: "card", style: { marginBottom: "var(--s-5)" } });
      catCard.innerHTML = '<div class="card-head"><h3>By category</h3></div>';
      var catBody = UI.el("div", { class: "card-body" });
      catBody.appendChild(barChart(p.categories, "revenue",
        function (row) { return row.category_name; }, "warning"));
      catCard.appendChild(catBody);
      host.appendChild(catCard);
    }

    var card = UI.el("div", { class: "card card-body-flush" });
    card.appendChild(table(
      [
        { key: "product_name", label: "Product" },
        { key: "quantity", label: "Sold", num: true },
        { key: "revenue", label: "Revenue", num: true }
      ],
      p.items,
      function (row, col) {
        if (col.key === "product_name") return "<strong>" + UI.esc(row.product_name) + "</strong>";
        if (col.key === "revenue") return money(row.revenue) + " XP";
        return String(row[col.key]);
      }
    ));
    host.appendChild(card);
  }

  /* ==========================================================================
     RENDER
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#reportBody");
    if (!host) return;
    UI.clear(host);

    if (loading) { host.appendChild(UI.skeletonCards(4, "120px")); return; }
    if (loadError) {
      host.appendChild(UI.errorState(
        loadError === "Your role does not allow this (reports.view)"
          ? "Your role does not allow you to see reports."
          : loadError,
        load
      ));
      return;
    }

    ({
      overview: renderOverview,
      stations: renderStations,
      customers: renderCustomers,
      products: renderProducts
    })[tab](host);

    Motion.stagger(host.children, { step: 0.04, y: 12 });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.reports = {
    title: "Reports",
    subtitle: "Revenue, usage and customers",

    mount: function (root) {
      rootEl = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Reports</div>' +
          '<div class="page-sub">Totals over the bills, sessions and orders you have actually ' +
            "taken. Nothing here is projected or estimated.</div>" +
        "</div><div class='page-actions'>" +
          '<div class="row gap-2" id="reportPeriod">' +
            PERIODS.map(function (p) {
              return '<button class="chip" data-days="' + p.days + '"' +
                (p.days === days ? ' aria-pressed="true"' : "") + ">" + p.label + "</button>";
            }).join("") +
          "</div>" +
          '<button class="btn btn-outline" id="reportRefresh">' + Icon("refresh", 15) +
            '<span class="btn-label">Refresh</span></button>' +
        "</div></div>" +

        '<div class="tabs" id="reportTabs" style="margin-bottom:var(--s-5)">' +
          TABS.map(function (t, i) {
            return '<button data-tab="' + t.id + '" aria-selected="' + (i === 0) + '">' +
              t.label + "</button>";
          }).join("") +
        "</div>" +

        '<div id="reportBody"></div>';
      root.appendChild(page);

      var refreshBtn = page.querySelector("#reportRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return load(); });
      });

      UI.$$("#reportPeriod .chip", page).forEach(function (chip) {
        chip.addEventListener("click", function () {
          days = parseInt(chip.dataset.days, 10);
          UI.$$("#reportPeriod .chip", page).forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
          });
          load();
        });
      });

      UI.$$("#reportTabs button", page).forEach(function (btn) {
        btn.addEventListener("click", function () {
          tab = btn.dataset.tab;
          UI.$$("#reportTabs button", page).forEach(function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          load();
        });
      });

      load();
    },

    unmount: function () { rootEl = null; }
  };
})(window);
