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
  // Set by the "Custom" chip; takes over from `days` entirely while active.
  // { from, to } as ISO strings — start and end of the chosen days.
  var customRange = null;
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
    { id: "finance",  label: "Finance" },
    { id: "stations", label: "Stations" },
    { id: "customers", label: "Customers" },
    { id: "products", label: "F&B" },
    { id: "games",    label: "Games" }
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
    if (customRange) return customRange;
    var to = new Date();
    var from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  /* How many days the current window actually spans — a preset already knows
     this from `days`, but a custom range does not, so both go through the
     same arithmetic rather than keeping two ways to answer one question. */
  function spanDays() {
    var w = window_();
    return Math.max(1, Math.round((new Date(w.to) - new Date(w.from)) / 86400000));
  }

  function customRangeDialog() {
    var w = window_();
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="rpFrom">From</label>' +
          '<input class="input" id="rpFrom" type="date" value="' +
            new Date(w.from).toISOString().slice(0, 10) + '" data-autofocus></div>' +
        '<div class="field"><label class="field-label field-req" for="rpTo">To</label>' +
          '<input class="input" id="rpTo" type="date" value="' +
            new Date(w.to).toISOString().slice(0, 10) + '" max="' +
            new Date().toISOString().slice(0, 10) + '"></div>' +
      "</div>";

    return UI.modal({
      title: "Choose a date range",
      description: "Any span — a single day, a specific week, a custom quarter.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Apply", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var fromStr = ctx.body.querySelector("#rpFrom").value;
            var toStr = ctx.body.querySelector("#rpTo").value;
            if (!fromStr || !toStr) {
              Motion.shake(ctx.node);
              UI.toast.warn("Pick both dates");
              return false;
            }
            var from = new Date(fromStr + "T00:00:00");
            var to = new Date(toStr + "T23:59:59.999");
            if (from > to) {
              Motion.shake(ctx.node);
              UI.toast.warn("The from date is after the to date");
              return false;
            }
            customRange = { from: from.toISOString(), to: to.toISOString() };
            paintPeriodChips();
            load();
            return true;
          }
        }
      ]
    });
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

  /* ==========================================================================
     LINE CHART
     Two series over time — revenue against expense — as a plain inline SVG.
     No charting library: this is the one place a trend genuinely reads better
     as a line than as bars, so it earns being the one exception, but it stays
     dependency-free like everything else on this page.
     ========================================================================== */
  function lineChart(points, series, labelFor) {
    if (!points.length) {
      return UI.emptyState({
        icon: "reports", title: "Nothing in this period",
        text: "No activity was recorded in the selected range."
      });
    }

    var W = 640, H = 220, padL = 8, padR = 8, padT = 14, padB = 28;
    var innerW = W - padL - padR, innerH = H - padT - padB;

    var allValues = [];
    points.forEach(function (p) {
      series.forEach(function (s) { allValues.push(Number(p[s.key] || 0)); });
    });
    var max = Math.max.apply(null, allValues.concat([1]));

    var stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    var y = function (v) { return padT + innerH - (v / max) * innerH; };
    var x = function (i) { return padL + i * stepX; };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
      'style="width:100%;height:220px;display:block">';

    // A light horizontal baseline at zero, so a profit line dipping below
    // revenue reads as "below zero gain" rather than just "lower".
    svg += '<line x1="' + padL + '" y1="' + y(0) + '" x2="' + (W - padR) + '" y2="' + y(0) +
      '" style="stroke:var(--line);stroke-width:1" />';

    series.forEach(function (s) {
      var coords = points.map(function (p, i) { return x(i) + "," + y(Number(p[s.key] || 0)); });
      svg += '<polyline points="' + coords.join(" ") + '" fill="none" ' +
        'style="stroke:' + s.color + ';stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round" />';
      points.forEach(function (p, i) {
        svg += '<circle cx="' + x(i) + '" cy="' + y(Number(p[s.key] || 0)) + '" r="2.5" ' +
          'style="fill:' + s.color + '"><title>' + UI.esc(s.label) + " · " + UI.esc(labelFor(p)) +
          " · " + money(p[s.key]) + " XP</title></circle>";
      });
    });

    svg += "</svg>";

    var wrap = UI.el("div", { class: "col gap-3" });
    var legend = UI.el("div", { class: "row gap-4" });
    legend.innerHTML = series.map(function (s) {
      return '<span class="row gap-2" style="align-items:center;font-size:12px">' +
        '<span style="width:10px;height:10px;border-radius:3px;background:' + s.color + ';display:inline-block"></span>' +
        UI.esc(s.label) + "</span>";
    }).join("");
    wrap.appendChild(legend);

    var chart = UI.el("div");
    chart.innerHTML = svg;
    wrap.appendChild(chart);

    // A handful of labels along the axis rather than one per point — one per
    // bucket on a 90-day span would overlap into an unreadable smear.
    var labels = UI.el("div", { class: "row row-between faint", style: { fontSize: "11px" } });
    var everyNth = Math.max(1, Math.ceil(points.length / 6));
    labels.innerHTML = points
      .filter(function (_, i) { return i % everyNth === 0 || i === points.length - 1; })
      .map(function (p) { return "<span>" + UI.esc(labelFor(p)) + "</span>"; })
      .join("");
    wrap.appendChild(labels);

    return wrap;
  }

  /* ==========================================================================
     DONUT
     A category breakdown where the shape of the split matters as much as the
     numbers — "is one category eating the budget" is a question a list of
     rows answers slower than a ring does.
     ========================================================================== */
  var DONUT_COLORS = ["var(--accent)", "var(--ok)", "var(--warn)", "var(--info)", "var(--danger)", "var(--text-3)"];

  function donutChart(segments, totalLabel) {
    var total = segments.reduce(function (s, seg) { return s + Number(seg.value || 0); }, 0);
    if (!segments.length || total <= 0) {
      return UI.emptyState({
        icon: "reports", title: "Nothing to break down",
        text: "No activity was recorded in the selected range."
      });
    }

    var size = 180, r = 68, cx = size / 2, cy = size / 2, stroke = 26;
    var circumference = 2 * Math.PI * r;
    var offset = 0;

    var svg = '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">';
    segments.forEach(function (seg, i) {
      var value = Number(seg.value || 0);
      var frac = value / total;
      var dash = frac * circumference;
      var color = seg.color || DONUT_COLORS[i % DONUT_COLORS.length];
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" ' +
        'style="stroke:' + color + ';stroke-width:' + stroke + ';stroke-dasharray:' +
        dash + " " + (circumference - dash) + ';stroke-dashoffset:' + (-offset) +
        '" transform="rotate(-90 ' + cx + " " + cy + ')"><title>' + UI.esc(seg.label) +
        " · " + money(value) + " XP (" + Math.round(frac * 100) + "%)</title></circle>";
      offset += dash;
    });
    svg += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" ' +
      'style="fill:var(--text);font-size:15px;font-weight:750">' + money(total) + "</text>";
    svg += '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" ' +
      'style="fill:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:.04em">' +
      UI.esc(totalLabel || "total") + "</text>";
    svg += "</svg>";

    var row = UI.el("div", { class: "row gap-5", style: { alignItems: "center", flexWrap: "wrap" } });
    var chart = UI.el("div");
    chart.innerHTML = svg;
    row.appendChild(chart);

    var legend = UI.el("div", { class: "col gap-2", style: { minWidth: "180px", flex: "1" } });
    segments.forEach(function (seg, i) {
      var value = Number(seg.value || 0);
      var color = seg.color || DONUT_COLORS[i % DONUT_COLORS.length];
      var item = UI.el("div", { class: "row row-between", style: { fontSize: "12px" } });
      item.innerHTML =
        '<span class="row gap-2" style="align-items:center">' +
          '<span style="width:9px;height:9px;border-radius:50%;background:' + color + ';display:inline-block"></span>' +
          UI.esc(seg.label) + "</span>" +
        '<span style="font-weight:650">' + money(value) + " XP · " + Math.round((value / total) * 100) + "%</span>";
      legend.appendChild(item);
    });
    row.appendChild(legend);

    return row;
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
    // the window rather than draw 90 slivers. Goes by the window's actual
    // length so a custom range buckets exactly as sensibly as a preset does.
    var span = spanDays();
    var bucket = span <= 30 ? "day" : (span <= 90 ? "week" : "month");

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
      finance: function () {
        return Store.report("finance", { ...range, bucket: bucket }).then(function (r) {
          data.finance = r.data;
          data.financeBucket = bucket;
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
      },
      games: function () {
        return Store.report("games", range).then(function (r) { data.games = r.data; });
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

  function renderFinance(host) {
    var f = data.finance;
    if (!f) return;

    var strip = UI.el("div", { class: "grid grid-kpi", style: { marginBottom: "var(--s-5)" } });
    strip.appendChild(statCard("Revenue", money(f.total_revenue) + " XP", null, "online"));
    strip.appendChild(statCard("Expenses", money(f.total_expenses) + " XP", null,
      f.total_expenses > 0 ? "warning" : "idle"));
    strip.appendChild(statCard("Profit", money(f.profit) + " XP",
      f.profit >= 0 ? "in the black" : "in the red", f.profit >= 0 ? "online" : "offline"));
    host.appendChild(strip);

    var trendCard = UI.el("div", { class: "card", style: { marginBottom: "var(--s-5)" } });
    trendCard.innerHTML =
      '<div class="card-head"><div><h3>Revenue vs. expenses</h3>' +
      '<div class="faint" style="font-size:11px;margin-top:2px">By ' + data.financeBucket +
      ". Quiet periods show as zero rather than being skipped.</div></div></div>";
    var trendBody = UI.el("div", { class: "card-body" });
    trendBody.appendChild(lineChart(
      f.points,
      [
        { key: "revenue", label: "Revenue", color: "var(--ok)" },
        { key: "expenses", label: "Expenses", color: "var(--danger)" }
      ],
      function (p) {
        var d = new Date(p.at);
        return data.financeBucket === "month"
          ? d.toLocaleDateString([], { month: "short" })
          : d.toLocaleDateString([], { day: "numeric", month: "short" });
      }
    ));
    trendCard.appendChild(trendBody);
    host.appendChild(trendCard);

    var expCard = UI.el("div", { class: "card" });
    expCard.innerHTML = '<div class="card-head"><h3>Where it went</h3></div>';
    var expBody = UI.el("div", { class: "card-body" });
    expBody.appendChild(UI.emptyState({
      icon: "reports", title: "Nothing spent yet",
      text: "Log an expense under Settings → Expenses to see the split here."
    }));
    expCard.appendChild(expBody);
    host.appendChild(expCard);

    // Loaded separately: the finance report is revenue-vs-expense totals,
    // and the category split is the expense list's own summary — no reason
    // for one endpoint to duplicate the other's grouping.
    Store.expenseSummary(window_()).then(function (s) {
      UI.clear(expBody);
      if (!s.by_category.length) {
        expBody.appendChild(UI.emptyState({
          icon: "reports", title: "Nothing spent in this period",
          text: "Log an expense under Settings → Expenses to see the split here."
        }));
        return;
      }
      expBody.appendChild(donutChart(
        s.by_category.map(function (c) { return { label: c.category, value: c.amount }; }),
        "spent"
      ));
    }).catch(function () { /* the finance totals above still stand on their own */ });
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

  function renderGames(host) {
    var g = data.games || { games: [], rows: [] };

    if (g.games.length) {
      var chartCard = UI.el("div", { class: "card", style: { marginBottom: "var(--s-5)" } });
      chartCard.innerHTML = '<div class="card-head"><h3>By revenue</h3></div>';
      var chartBody = UI.el("div", { class: "card-body" });
      chartBody.appendChild(barChart(g.games, "revenue",
        function (row) { return row.software_name; }, "gaming"));
      chartCard.appendChild(chartBody);
      host.appendChild(chartCard);
    }

    if (!g.rows.length) {
      host.appendChild(UI.emptyState({
        icon: "games", title: "No priced sessions in this period",
        text: "Only sessions started from a Gaming Price Master rate appear here — an open-ended " +
          "hourly session has no game to attribute the time to."
      }));
      return;
    }

    // Grouped by game rather than one flat table: "which game" is the
    // question this report exists to answer, so it is the heading, not a
    // column someone has to scan for.
    var card = UI.el("div", { class: "card card-body-flush" });
    var wrap = UI.el("div", { class: "table-wrap" });
    var tbl = UI.el("table", { class: "tbl" });
    tbl.innerHTML = "<thead><tr><th>Customer</th><th>Sessions</th>" +
      '<th class="td-num">Play hours</th><th class="td-num">Revenue</th></tr></thead>';
    var tbody = UI.el("tbody");

    var currentGame = null;
    g.rows.forEach(function (row) {
      if (row.software_id !== currentGame) {
        currentGame = row.software_id;
        var totals = g.games.filter(function (x) { return x.software_id === row.software_id; })[0];
        var head = UI.el("tr", { style: "background:var(--surface-2, rgba(255,255,255,.03))" });
        head.innerHTML = '<td colspan="4" style="padding-top:var(--s-4)">' +
          "<strong>" + UI.esc(row.software_name) + "</strong>" +
          (row.category ? ' <span class="badge badge-plain" style="margin-left:6px">' +
            UI.esc(row.category) + "</span>" : "") +
          (totals ? '<span class="faint" style="float:right;font-size:11px">' +
            totals.sessions + " sessions · " + totals.play_hours + " h · " +
            money(totals.revenue) + " XP total</span>" : "") +
        "</td>";
        tbody.appendChild(head);
      }

      var tr = UI.el("tr");
      tr.innerHTML =
        "<td>" + (row.is_guest
          ? '<span class="faint">' + UI.esc(row.customer_name) + " (guest)</span>"
          : "<strong>" + UI.esc(row.customer_name) + "</strong>") + "</td>" +
        "<td>" + row.sessions + "</td>" +
        '<td class="td-num">' + row.play_hours + "</td>" +
        '<td class="td-num" style="font-weight:650">' + money(row.revenue) + "</td>";
      tbody.appendChild(tr);
    });

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
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
      finance: renderFinance,
      stations: renderStations,
      customers: renderCustomers,
      products: renderProducts,
      games: renderGames
    })[tab](host);

    Motion.stagger(host.children, { step: 0.04, y: 12 });
  }

  /*
   * The period chip row, as both markup and behaviour in one place.
   *
   * Applying a custom range from its dialog changes `customRange` from code
   * that has no reference to this row's buttons — `load()` only repaints
   * `#reportBody`. Repainting the whole row from state, rather than toggling
   * one attribute on whichever button was clicked, is what lets both paths
   * end up correct: a preset click, and a dialog three functions away.
   */
  function paintPeriodChips() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#reportPeriod");
    if (!host) return;

    host.innerHTML = PERIODS.map(function (p) {
      return '<button class="chip" data-days="' + p.days + '"' +
        (!customRange && p.days === days ? ' aria-pressed="true"' : "") + ">" + p.label + "</button>";
    }).join("") +
      '<button class="chip" id="reportCustom" data-tip="Pick any date range"' +
        (customRange ? ' aria-pressed="true"' : "") + ">" + Icon("reports", 13) +
        (customRange
          ? " " + new Date(customRange.from).toLocaleDateString([], { day: "numeric", month: "short" }) +
            " – " + new Date(customRange.to).toLocaleDateString([], { day: "numeric", month: "short" })
          : " Custom") +
      "</button>";

    UI.$$(".chip", host).forEach(function (chip) {
      if (chip.id === "reportCustom") {
        chip.addEventListener("click", customRangeDialog);
        return;
      }
      chip.addEventListener("click", function () {
        days = parseInt(chip.dataset.days, 10);
        customRange = null;   // a preset always overrides a custom range
        paintPeriodChips();
        load();
      });
    });
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
          '<div class="row gap-2" id="reportPeriod"></div>' +
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

      paintPeriodChips();

      var refreshBtn = page.querySelector("#reportRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return load(); });
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
