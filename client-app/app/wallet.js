/* ==========================================================================
   CafeXP Client — Wallet
   Reads the customer's balance and ledger from /api/wallet. The client is
   read-only by design: the server rejects a credit or debit on a customer
   token, so money only moves from the café's side.
   ========================================================================== */
(function (global) {
  "use strict";

  var API_BASE = "http://localhost:5000";
  var Session = global.CXSession;

  var state = {
    balance: null,        // null until loaded
    currency: "XP",
    transactions: [],
    total: 0,
    loading: false,
    error: null,
    loadedAt: null
  };

  var listeners = [];
  function on(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }
  function emit() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error("[wallet] listener failed", e); }
    });
  }

  function customerId() {
    var user = Session.state.user;
    return user && user.customer_id != null ? user.customer_id : null;
  }

  function token() {
    return Session.state.token || null;
  }

  function request(path) {
    return fetch(API_BASE + path, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (token() || "")
      }
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.message || "HTTP " + res.status);
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  /**
   * Load balance and recent movements together, so the view never shows a
   * balance from one moment beside a ledger from another.
   */
  function load(limit) {
    var id = customerId();
    if (id == null) {
      state.error = "not-signed-in";
      state.loading = false;
      emit();
      return Promise.resolve(state);
    }
    if (!token()) {
      state.error = "no-token";
      state.loading = false;
      emit();
      return Promise.resolve(state);
    }

    state.loading = true;
    state.error = null;
    emit();

    return request("/api/wallet/customer/" + id + "/transactions?limit=" + (limit || 25))
      .then(function (body) {
        state.balance = Number(body.balance || 0);
        state.currency = body.currency || "XP";
        state.transactions = body.data || [];
        state.total = (body.pagination && body.pagination.total) || state.transactions.length;
        state.loadedAt = Date.now();
        state.loading = false;
        emit();
        return state;
      })
      .catch(function (err) {
        state.loading = false;
        // Keep the raw reason in the console; the UI shows friendly copy.
        console.error("[wallet] load failed", err);
        state.error = err.status === 401 || err.status === 403 ? "denied"
                    : err.status === 404 ? "missing"
                    : "unreachable";
        emit();
        return state;
      });
  }

  /**
   * Balances are XP Coins. Whole amounts read as "1,250"; part-coins keep two
   * decimals so a debit never appears to round in the café's favour.
   */
  function amount(value) {
    var n = Number(value || 0);
    var whole = Math.round(n * 100) % 100 === 0;
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2
      }).format(n);
    } catch (e) {
      return whole ? String(Math.round(n)) : n.toFixed(2);
    }
  }

  /** Same number with the unit appended, for places without a coin glyph. */
  function money(value) {
    return amount(value) + " XP";
  }

  /** Human label for a ledger category. */
  var CATEGORY_LABEL = {
    topup: "Coins added",
    food: "Food & drink",
    gaming: "Gaming time",
    shop: "Shop purchase",
    refund: "Refund",
    bonus: "Bonus",
    purchase: "Purchase",
    other: "Adjustment"
  };
  function categoryLabel(category) {
    return CATEGORY_LABEL[category] || (category ? String(category) : "Adjustment");
  }

  global.CXWallet = {
    state: state,
    on: on,
    load: load,
    amount: amount,
    money: money,
    categoryLabel: categoryLabel
  };
})(window);
