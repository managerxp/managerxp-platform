/* ==========================================================================
   CafeXP Client — Wallet
   Reads the customer's balance and ledger from /api/wallet. The client is
   read-only by design: the server rejects a credit or debit on a customer
   token, so money only moves from the café's side.
   ========================================================================== */
(function (global) {
  "use strict";

  /* Corrected below to the console's real address once this station learns it
     — see preload.js's onBackendBase/getBackendBase and main.js's SET_NAME
     handler. Every call in this file reads this same binding, so updating it
     here is enough; nothing needs to be re-created. */
  var API_BASE = "http://localhost:5000";
  var Session = global.CXSession;

  /* This station's own name, so a cash top-up request can say which café's
     counter it was raised at — see requestCashTopup below. */
  var STATION_NAME = "";

  (function watchBackendBase() {
    var api = global.api || {};
    // Pulled first: SET_NAME may already have arrived and been missed if this
    // script loaded after that one push, which a plain event would never
    // correct for.
    if (api.getBackendBase) api.getBackendBase(function (base) { if (base) API_BASE = base; });
    if (api.onBackendBase) api.onBackendBase(function (base) { if (base) API_BASE = base; });
    if (api.getPcName) api.getPcName(function (name) { STATION_NAME = name || STATION_NAME; });
    if (api.onPcName) api.onPcName(function (name) { STATION_NAME = name || STATION_NAME; });
  })();

  var state = {
    balance: null,        // null until loaded
    currency: "XP",
    transactions: [],
    total: 0,
    loading: false,
    error: null,
    loadedAt: null,
    bills: [],
    billsError: null,
    packages: [],
    membership: null,
    membershipHistory: [],
    packageCatalog: [],
    planCatalog: [],
    entitlementsLoaded: false,
    menu: null,
    menuError: null,
    orders: [],
    reservations: [],
    bookableCategories: []
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

  /**
   * The customer's own bills. Read-only — payment is taken by staff, and the
   * server rejects any payment attempt on a customer token.
   */
  function loadBills(limit) {
    var id = customerId();
    if (id == null || !token()) return Promise.resolve([]);
    return request("/api/bills/customer/" + id + "?limit=" + (limit || 20))
      .then(function (body) {
        state.bills = body.data || [];
        emit();
        return state.bills;
      })
      .catch(function (err) {
        console.error("[wallet] bill load failed", err);
        state.billsError = err.status === 401 || err.status === 403 ? "denied" : "unreachable";
        emit();
        return [];
      });
  }

  /** The customer's packages and membership, and what they could still buy. */
  function loadEntitlements() {
    var id = customerId();
    if (id == null || !token()) return Promise.resolve();
    return Promise.all([
      request("/api/packages/customer/" + id).then(function (b) { return b.data || []; }).catch(function () { return null; }),
      request("/api/memberships/customer/" + id).then(function (b) { return b.data; }).catch(function () { return null; }),
      request("/api/packages/catalog").then(function (b) { return b.data || []; }).catch(function () { return []; }),
      request("/api/memberships/plans/catalog").then(function (b) { return b.data || []; }).catch(function () { return []; })
    ]).then(function (res) {
      state.packages = res[0] || [];
      state.membership = res[1] ? res[1].current : null;
      state.membershipHistory = res[1] ? res[1].history : [];
      state.packageCatalog = res[2] || [];
      state.planCatalog = res[3] || [];
      state.entitlementsLoaded = true;
      emit();
    });
  }

  function postJson(path, payload) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (token() || "")
      },
      body: JSON.stringify(payload || {})
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

  /** Buy a package for yourself, paid from your own wallet balance. */
  function purchasePackage(packageId) {
    return postJson("/api/packages/" + packageId + "/purchase-self", {}).then(function (body) {
      load();               // the balance just moved
      loadEntitlements();   // and so did what's owned / still buyable
      return body;
    });
  }

  /** Subscribe to a membership plan, paid from your own wallet balance. */
  function subscribeMembership(planId) {
    return postJson("/api/memberships/plans/" + planId + "/subscribe-self", {}).then(function (body) {
      load();
      loadEntitlements();
      return body;
    });
  }

  /** The menu the customer can order from right now. */
  function loadMenu(kind) {
    if (!token()) return Promise.resolve(null);
    return request("/api/products/menu?kind=" + (kind || "FNB"))
      .then(function (body) {
        state.menu = body;
        state.menuError = null;
        emit();
        return body;
      })
      .catch(function (err) {
        console.error("[menu] load failed", err);
        state.menuError = err.status === 401 || err.status === 403 ? "denied" : "unreachable";
        emit();
        return null;
      });
  }

  function loadOrders() {
    var id = customerId();
    if (id == null || !token()) return Promise.resolve([]);
    return request("/api/orders/customer/" + id)
      .then(function (body) { state.orders = body.data || []; emit(); return state.orders; })
      .catch(function () { return []; });
  }

  /** Place an order. The server takes stock and settles from the wallet. */
  function placeOrder(items, extra) {
    var payload = Object.assign({ items: items }, extra || {});
    return fetch(API_BASE + "/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (token() || "")
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.message || "HTTP " + res.status);
          err.status = res.status;
          throw err;
        }
        // The order moves money and stock, so refresh both.
        load();
        loadOrders();
        loadMenu();
        return body;
      });
    });
  }

  /* ==========================================================================
     RESERVATIONS — booking a station ahead of time
     ========================================================================== */
  /** Station types this café has, so a booking form offers real choices. */
  function loadBookableCategories() {
    if (!token()) return Promise.resolve([]);
    return request("/api/reservations/categories")
      .then(function (body) { state.bookableCategories = body.data || []; emit(); return state.bookableCategories; })
      .catch(function () { return []; });
  }

  function loadReservations() {
    var id = customerId();
    if (id == null || !token()) return Promise.resolve([]);
    return request("/api/reservations/customer/" + id)
      .then(function (body) { state.reservations = body.data || []; emit(); return state.reservations; })
      .catch(function () { return []; });
  }

  /** { category | pc_id, start_time, end_time } -> { available, total, booked } or { pc_id, available }. */
  function checkReservationAvailability(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return request("/api/reservations/availability?" + qs).then(function (b) { return b.data; });
  }

  function bookReservation(payload) {
    return postJson("/api/reservations", payload).then(function (body) {
      loadReservations();
      return body;
    });
  }

  function cancelReservation(id) {
    return postJson("/api/reservations/" + id + "/cancel", {}).then(function (body) {
      loadReservations();
      return body;
    });
  }

  /* ==========================================================================
     TOP-UP

     The one place the client is not read-only — and even here it does not move
     money. It asks the server to start a payment, sends the customer to the
     provider, and asks the server to confirm what came back. The coins are
     credited by the server against a signature it verified itself; nothing
     this file does could make coins appear.
     ========================================================================== */
  function post(path, payload) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (token() || "")
      },
      body: JSON.stringify(payload || {})
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

  /** What the café accepts, and the limits it sets. */
  function topupOptions() {
    return request("/api/payments/topup/options").then(function (body) { return body.data; });
  }

  /** Ask the server to open a payment. Returns what checkout needs, no secrets. */
  function startTopup(provider, amountValue) {
    return post("/api/payments/topup/order", { provider: provider, amount: amountValue })
      .then(function (body) { return body.data; });
  }

  /**
   * Hand the provider's response back for verification.
   *
   * Sending the raw payload rather than a "it worked" flag is the point: the
   * server re-derives the signature from it and decides for itself.
   */
  function confirmTopup(topupId, payload) {
    return post("/api/payments/topup/verify", { topup_id: topupId, payload: payload })
      .then(function (body) {
        // The balance has changed on the server; pull the authoritative number
        // rather than adding the coins locally and hoping they match.
        load();
        return body.data;
      });
  }

  /**
   * Ask the counter for coins against cash.
   *
   * Nothing is credited here. This records the request; a member of staff
   * confirms the notes arrived and their approval is what moves the balance.
   */
  function requestCashTopup(amountValue) {
    return post("/api/payments/topup/cash", { amount: amountValue, pc_name: STATION_NAME })
      .then(function (body) { return body.data; });
  }

  function topupHistory() {
    return request("/api/payments/topup/mine")
      .then(function (body) { return body.data || []; })
      .catch(function () { return []; });
  }

  global.CXWallet = {
    state: state,
    on: on,
    load: load,
    apiBase: function () { return API_BASE; },
    // Generic authenticated GET, for callers that need an endpoint this
    // module doesn't otherwise wrap (e.g. the Account view's own profile
    // fetch) without re-deriving the base URL and auth header themselves.
    request: request,
    topupOptions: topupOptions,
    startTopup: startTopup,
    confirmTopup: confirmTopup,
    requestCashTopup: requestCashTopup,
    topupHistory: topupHistory,
    loadBills: loadBills,
    loadEntitlements: loadEntitlements,
    purchasePackage: purchasePackage,
    subscribeMembership: subscribeMembership,
    loadBookableCategories: loadBookableCategories,
    loadReservations: loadReservations,
    checkReservationAvailability: checkReservationAvailability,
    bookReservation: bookReservation,
    cancelReservation: cancelReservation,
    loadMenu: loadMenu,
    loadOrders: loadOrders,
    placeOrder: placeOrder,
    amount: amount,
    money: money,
    categoryLabel: categoryLabel
  };
})(window);
