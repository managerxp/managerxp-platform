/* ==========================================================================
   CafeXP — Planned sections
   These sections have no backend behind them yet. Rather than render invented
   numbers, each page states what it will do, what it needs, and where the
   gap is — so nobody mistakes a mock-up for live data.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var SECTIONS = {
    sessions: {
      title: "Sessions",
      subtitle: "Play sessions across every station",
      icon: "sessions",
      lede: "A live and historical record of every play session — who was on which station, for how long, on what package, and what it came to.",
      features: [
        ["Active & paused sessions", "Live list with station, customer, elapsed and remaining time"],
        ["Session lifecycle", "Start, pause, resume, extend, transfer between stations, end"],
        ["Completed history", "Filter by day, station, customer, staff member or package"],
        ["Guest sessions", "Walk-in sessions with optional name and phone"],
        ["Running charge", "Amount accrued so far against the active package"]
      ],
      needs: "a sessions table and REST routes (create / pause / resume / extend / transfer / end / list)",
      today: "Today the Floor page can launch an application on a station with a countdown. That countdown runs inside this window only — it is not written to the database, so it does not survive a restart and cannot be billed or reported on."
    },
    customers: {
      title: "Customers",
      subtitle: "Customer directory and history",
      icon: "customers",
      lede: "Search, register and manage the people who play here, with their session history, spend and current station at a glance.",
      features: [
        ["Directory & search", "Instant lookup by name, phone or email"],
        ["Registration", "Add a customer in seconds from the floor"],
        ["Profile", "Contact details, notes, VIP / banned flags"],
        ["History", "Past sessions, spend and visit frequency"],
        ["Assignment", "Put a customer straight onto a free station"]
      ],
      needs: "list, search, get-by-id and update routes on /api/customers",
      today: "The backend has exactly two customer routes — POST /api/customers/register and POST /api/customers/login — both used by the client kiosk so a player can sign in at the station. There is no route that returns customers to the admin, so this page has nothing to list."
    },
    billing: {
      title: "Billing",
      subtitle: "Bills, payments and invoices",
      icon: "billing",
      lede: "Every open and settled bill: gaming time, food and drink, discounts, tax, payment method and the final invoice.",
      features: [
        ["Open bills", "Charges accruing against active sessions"],
        ["Completed bills", "Settled transactions with payment method"],
        ["Line items", "Gaming charges and F&B on one bill"],
        ["Discounts & tax", "Applied per bill with a reason recorded"],
        ["Invoice", "Printable / exportable receipt"]
      ],
      needs: "bills, bill_items and payments tables plus their routes",
      today: "No billing exists anywhere in the platform yet — no tables, no routes, no calculations. Nothing here can be shown until the pricing model is decided."
    },
    fnb: {
      title: "F&B / Products",
      subtitle: "Food, drink and merchandise",
      icon: "fnb",
      lede: "The product catalogue customers can order from — priced, categorised, stocked and switchable on or off.",
      features: [
        ["Product records", "Name, image, category, price, cost, tax, SKU"],
        ["Availability", "Enable or disable what customers can see"],
        ["Stock", "Quantity on hand with low-stock warnings"],
        ["Categories", "Food, drinks, snacks, combos, accessories"],
        ["Kiosk visibility", "Products flow to the client ordering screen"]
      ],
      needs: "products and categories tables plus CRUD routes, and an ordering endpoint the client app can read",
      today: "There is no product system in the backend, and the client app has no ordering screen to feed. Building a catalogue here would create a second, disconnected product store."
    },
    inventory: {
      title: "Inventory",
      subtitle: "Stock levels and movement",
      icon: "inventory",
      lede: "What is on the shelf, what is running out, and every adjustment that got it there.",
      features: [
        ["Stock on hand", "Per product, per category"],
        ["Low & out of stock", "Clear warning states"],
        ["Movement log", "Sales, restocks and manual adjustments"],
        ["Adjustments", "Correct counts with a reason and an audit trail"]
      ],
      needs: "stock and stock_movements tables — depends on F&B / Products landing first",
      today: "Inventory sits on top of the product catalogue, which does not exist yet."
    },
    packages: {
      title: "Packages",
      subtitle: "Time and pricing packages",
      icon: "packages",
      lede: "The bundles staff sell at the counter — hourly blocks, night rates, VIP tiers and memberships.",
      features: [
        ["Package records", "Name, duration, price, zone restrictions"],
        ["Happy hour / night rates", "Time-of-day pricing"],
        ["Assignment", "Pick a package when starting a session"],
        ["Activation", "Enable or retire a package without deleting history"]
      ],
      needs: "a packages table and routes, plus session pricing to consume it",
      today: "Sessions are launched with a plain countdown in minutes. There is no pricing model to attach a package to."
    },
    memberships: {
      title: "Memberships",
      subtitle: "Plans, credits and loyalty",
      icon: "membership",
      lede: "Recurring plans and stored value — remaining hours, wallet balance, points and expiry.",
      features: [
        ["Plans", "Membership tiers and their benefits"],
        ["Active & expired", "Who is current, who lapsed"],
        ["Usage", "Hours or credits consumed and remaining"],
        ["Wallet & points", "Stored balance and loyalty accrual"]
      ],
      needs: "membership plans, customer_memberships and a wallet ledger",
      today: "Note: /api/subscriptions is the cafe's own licence to run CafeXP, not a customer membership. That licence is shown on the Subscription page."
    },
    reservations: {
      title: "Reservations",
      subtitle: "Bookings and check-ins",
      icon: "reservations",
      lede: "Upcoming bookings by station and time slot, with check-in and no-show handling.",
      features: [
        ["Today & upcoming", "Timeline of booked slots"],
        ["Station / zone", "Reserve a specific machine or any in a zone"],
        ["Check-in", "Convert a booking into a live session"],
        ["Cancellation", "Cancel or mark as a no-show"]
      ],
      needs: "a reservations table and routes",
      today: "Nothing in the platform records bookings yet."
    },
    staff: {
      title: "Staff",
      subtitle: "Team, roles and shifts",
      icon: "staff",
      lede: "Who works here, what they are allowed to do, and what they did on shift.",
      features: [
        ["Staff records", "Name, role, contact, status"],
        ["Roles & permissions", "What each role can access"],
        ["Shifts", "Who is on now, shift history"],
        ["Activity", "Transactions and actions per staff member"]
      ],
      needs: "staff/users tables with roles, and a permissions model",
      today: "Authentication today is a single cafe-owner login (/api/auth). There are no staff accounts, roles or permissions to manage."
    },
    reports: {
      title: "Reports",
      subtitle: "Revenue, usage and customer analytics",
      icon: "reports",
      lede: "Daily, weekly and monthly performance across revenue, station utilisation, customers and product sales.",
      features: [
        ["Revenue", "Daily / weekly / monthly totals and trend"],
        ["Gaming", "Session counts, play time, peak hours, revenue per station"],
        ["Customers", "New vs returning, top customers"],
        ["F&B", "Product and category sales"]
      ],
      needs: "sessions, bills and product sales to report on — every input is missing",
      today: "Reporting is downstream of sessions and billing. Charts drawn now would be fiction."
    },
    telemetry: {
      title: "Telemetry",
      subtitle: "Hardware health per station",
      icon: "telemetry",
      lede: "Live CPU, GPU, memory, disk, temperature and network for every station, with history and alerting.",
      features: [
        ["Live metrics", "CPU, GPU, RAM, disk, temperature"],
        ["Network", "Latency and packet loss to each client"],
        ["In-game", "Running title and frame rate"],
        ["Alerts", "Thresholds for overheating or saturated machines"]
      ],
      needs: "the client agent to sample hardware counters and push them over the existing WebSocket, plus a metrics message type the server records",
      today: "The client currently sends REGISTER, HEARTBEAT, APPS_LIST, SOFTWARE_LIST and MAC_ADDRESS. No hardware counters are sampled or transmitted, so there is nothing to chart. What the server does know per station — reachability, heartbeat, connection failures and the running application — is on the Devices page."
    },
    audit: {
      title: "Audit Log",
      subtitle: "Who did what, and when",
      icon: "audit",
      lede: "An immutable record of staff actions: refunds, discounts, session changes, station controls and configuration edits.",
      features: [
        ["Action trail", "Actor, action, target, timestamp"],
        ["Sensitive actions", "Refunds, discounts and overrides highlighted"],
        ["Filters", "By staff member, station, customer or bill"],
        ["Immutability", "Append-only, never edited"]
      ],
      needs: "an audit_log table written to by every mutating route",
      today: "The Server Log page shows live runtime output from this session — connection attempts, launches, errors. It is not persisted and is not an audit trail."
    }
  };

  function buildPage(key) {
    var cfg = SECTIONS[key];

    return {
      title: cfg.title,
      subtitle: cfg.subtitle,
      mount: function (root) {
        var wrap = UI.el("div", { class: "planned-wrap" });

        var hero = UI.el("div", { class: "planned-hero" });
        hero.innerHTML =
          '<div class="planned-mark">' + Icon(cfg.icon, 24) + "</div>" +
          '<div class="grow">' +
            '<div class="row gap-3" style="align-items:center">' +
              '<div class="planned-title">' + UI.esc(cfg.title) + "</div>" +
              '<span class="badge" data-status="warning">Not built yet</span>' +
            "</div>" +
            '<div class="planned-lede">' + UI.esc(cfg.lede) + "</div>" +
          "</div>";
        wrap.appendChild(hero);

        var list = UI.el("div", { class: "planned-list" });
        cfg.features.forEach(function (f) {
          var item = UI.el("div", { class: "planned-item" });
          item.innerHTML =
            '<span class="planned-item-dot"></span>' +
            "<div>" +
              '<div class="planned-item-title">' + UI.esc(f[0]) + "</div>" +
              '<div class="planned-item-desc">' + UI.esc(f[1]) + "</div>" +
            "</div>";
          list.appendChild(item);
        });
        wrap.appendChild(list);

        var req = UI.el("div", { class: "planned-req" });
        req.innerHTML =
          '<div class="planned-req-title">Where it stands today</div>' +
          '<div style="font-size:13px;line-height:1.65;color:var(--text-2)">' + UI.esc(cfg.today) + "</div>" +
          '<div class="planned-req-title" style="margin-top:16px">To switch this page on</div>' +
          '<div style="font-size:13px;line-height:1.65;color:var(--text-2)">Requires ' + UI.esc(cfg.needs) + ".</div>";
        wrap.appendChild(req);

        root.appendChild(wrap);
        Motion.stagger(wrap.querySelectorAll(".planned-item"), { step: 0.018, y: 8 });
      }
    };
  }

  Object.keys(SECTIONS).forEach(function (key) {
    global.CXPages[key] = buildPage(key);
  });
})(window);
