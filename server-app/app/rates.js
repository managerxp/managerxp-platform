/* ==========================================================================
   CafeXP — Gaming rate card (shared)

   The Gaming Price Master owns one price per game + session pair. That table
   was only visible on its own page, which meant the two screens that most need
   it were working blind: Billing, where a gaming line was typed from memory,
   and Packages, where an operator set a package price with no idea what the
   same play time costs at the standard rate.

   This is the shared read side. It deliberately does not cache: a price the
   café edited a minute ago must not be quoted from a stale copy onto a bill a
   customer is about to pay. The list is small and these screens open rarely,
   so a request each time is the cheaper mistake.
   ========================================================================== */
(function (global) {
  "use strict";

  var Store = global.CXStore;

  /* Same formatting as the master page, so a price reads identically wherever
     it appears. */
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

  /** "Valorant · 1 Hour (60 min)" — what the operator is choosing. */
  function label(row) {
    return row.software_name + " · " + row.session_name + " (" + durationText(row) + ")";
  }

  /** What a gaming bill line should be called when priced from the master. */
  function billDescription(row) {
    return row.software_name + " — " + row.session_name;
  }

  /* Only ACTIVE rows. An inactive price is one the café has withdrawn; putting
     it on a bill or quoting it against a package would be quoting a rate they
     have decided to stop charging. */
  function list() {
    if (!Store || !Store.listGamingPrices) return Promise.resolve([]);
    return Store.listGamingPrices({ status: "ACTIVE", limit: 200 })
      .then(function (body) { return body.data || []; });
  }

  /* Rate per minute, for comparing a package against the standard rate.
     Unlimited sessions have no duration and so no per-minute rate — they are
     skipped rather than counted as zero, which would drag an average down and
     make every package look expensive. */
  function perMinute(row) {
    if (!row.duration_minutes) return null;
    var p = Number(row.price);
    if (!isFinite(p) || p <= 0) return null;
    return p / row.duration_minutes;
  }

  /*
   * The same list, priced for this moment.
   *
   * `list()` returns the catalogue's base prices. Anywhere a session is about
   * to be *started*, that is the wrong number to show: a peak or happy-hour
   * window may be open, and quoting ₹400 while the server charges ₹500 is how
   * an argument at the counter starts. This merges the server's own rate
   * preview — computed by the very code that prices the session — onto each
   * row, so the dropdown and the charge cannot disagree.
   *
   * Falls back to the base list if the preview cannot be reached. A café with
   * no windows configured gets identical numbers either way, so the fallback
   * is only ever wrong in the case where it is also unavoidable.
   */
  function listLive() {
    if (!Store || !Store.previewRates) return list();
    return Promise.all([list(), Store.previewRates().catch(function () { return null; })])
      .then(function (res) {
        var rows = res[0], preview = res[1];
        if (!preview) return rows;

        var byId = {};
        preview.forEach(function (p) { byId[p.gaming_price_id] = p; });

        return rows.map(function (row) {
          var live = byId[row.price_id];
          if (!live) return row;
          return Object.assign({}, row, {
            base_price: live.base_price,
            price: live.current_price,       // what this session will actually cost
            rule_label: live.rule_label,
            rule_kind: live.rule_kind,
            changed: live.changed,
            next_change_time: live.next_change_time,
            next_price: live.next_price
          });
        });
      });
  }

  global.CXRates = {
    list: list,
    listLive: listLive,
    money: money,
    durationText: durationText,
    label: label,
    billDescription: billDescription,
    perMinute: perMinute
  };
})(window);
