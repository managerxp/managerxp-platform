/* ==========================================================================
   CafeXP Client — Portal views
   Home · Games · Food · Shop · Rewards · Account

   Where a feature has no server behind it yet, the view renders its real
   layout with an explicit "waiting on the server" panel rather than invented
   balances, catalogues or orders.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Icon = global.CXIcon, Motion = global.CXMotion, Session = global.CXSession;
  global.CXViews = {};

  /* ==========================================================================
     SHARED PIECES
     ========================================================================== */

  /** Panel for a feature the server does not provide yet. */
  function awaiting(opts) {
    var node = UI.el("div", { class: "awaiting" });
    node.innerHTML =
      '<div class="awaiting-mark">' + Icon(opts.icon || "info", 28) + "</div>" +
      '<div class="awaiting-title">' + UI.esc(opts.title) + "</div>" +
      '<div class="awaiting-text">' + UI.esc(opts.text) + "</div>" +
      (opts.note ? '<div class="awaiting-note">' + opts.note + "</div>" : "");
    return node;
  }

  function sectionHead(title, actionLabel, onAction) {
    var head = UI.el("div", { class: "shelf-head" }, [
      UI.el("div", { class: "shelf-title", text: title })
    ]);
    if (actionLabel) {
      var btn = UI.el("button", {
        class: "shelf-more",
        html: '<span>' + UI.esc(actionLabel) + "</span>" + Icon("chevronR", 15),
        onClick: onAction
      });
      head.appendChild(btn);
    }
    return head;
  }

  /** The café session the staff started for this customer. */
  function cafeSessionCard(session, online, pc) {
    var st = Session.sessionState();
    var paused = session.status === "paused";
    var timed = session.remaining_seconds !== null;

    var card = UI.el("div", {
      class: "session-card",
      dataset: {
        status: paused ? "warning" : st === "critical" ? "expired" : st === "warning" ? "warning" : "gaming",
        timer: st === "paused" ? "normal" : st
      }
    });

    var caption = paused ? "Paused"
      : !timed ? "Time played"
      : st === "critical" ? "Session ending soon"
      : st === "warning" ? "15 minutes left"
      : "Time remaining";

    // An open-ended session has no total to fill a ring against.
    var pct = timed && session.planned_minutes
      ? Math.max(0, Math.min(100, (Session.sessionClockSeconds() / (session.planned_minutes * 60)) * 100))
      : 100;

    card.innerHTML =
      '<div class="row-between" style="align-items:flex-start">' +
        "<div>" +
          '<div class="session-label">Your station</div>' +
          '<div style="font-family:var(--font-mono);font-size:26px;font-weight:750;letter-spacing:-.02em;margin-top:6px">' +
            UI.esc(pc || "—") + "</div>" +
        "</div>" +
        '<span class="badge badge-lg" data-status="' + (online ? "online" : "offline") + '">' +
          '<span class="dot' + (online ? " dot-live" : "") + '"></span>' +
          (online ? "Online" : "Offline") + "</span>" +
      "</div>" +
      '<div style="margin-top:var(--s-6);padding-top:var(--s-6);border-top:1px solid var(--line);display:flex;gap:var(--s-6);align-items:center">' +
        '<div class="timer-ring" data-ring style="--pct:' + pct + '">' +
          '<div class="timer-ring-inner">' +
            '<div class="timer-digits timer-digits-lg" data-session-digits>' +
              Session.clock(Session.sessionClockSeconds()) + "</div>" +
            '<div class="timer-caption" data-session-caption>' + UI.esc(caption) + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="grow" style="min-width:0">' +
          '<div class="session-label">Playing as</div>' +
          '<div style="font-size:var(--t-h2);font-weight:720;letter-spacing:-.02em;margin-top:6px" class="truncate">' +
            UI.esc(session.customer_name || "Guest") + "</div>" +
          '<div class="muted" style="font-size:var(--t-sm);margin-top:var(--s-3);line-height:1.55">' +
            (paused
              ? "Your session is on hold. Ask a staff member when you're ready to carry on."
              : timed
                ? "Ask a staff member if you'd like more time."
                : "Open-ended — play as long as you like.") +
          "</div>" +
        "</div>" +
      "</div>";

    var digits = card.querySelector("[data-session-digits]");
    var captionEl = card.querySelector("[data-session-caption]");
    var ring = card.querySelector("[data-ring]");
    var off = Session.on("session-tick", function () {
      if (!card.isConnected) { off(); return; }
      var s2 = Session.sessionState();
      digits.textContent = Session.clock(Session.sessionClockSeconds());
      card.setAttribute("data-timer", s2 === "paused" ? "normal" : s2);
      if (timed && session.planned_minutes) {
        ring.style.setProperty("--pct",
          Math.max(0, Math.min(100, (Session.sessionClockSeconds() / (session.planned_minutes * 60)) * 100)));
      }
      captionEl.textContent = s2 === "critical" ? "Session ending soon"
        : s2 === "warning" ? "15 minutes left"
        : timed ? "Time remaining" : "Time played";
    });

    return card;
  }

  /**
   * The station / session card. When a game is running it becomes the primary
   * timer surface, driven by the same countdown as the floating timer card.
   */
  function stationCard() {
    var online = Session.isOnline();
    var pc = Session.state.pcName;
    var cafeSession = Session.state.session;

    // A café session is the real thing; the launch timer is a fallback.
    if (cafeSession) return cafeSessionCard(cafeSession, online, pc);

    var play = Session.state.play;
    var timerState = Session.timerState();

    var card = UI.el("div", {
      class: "session-card",
      dataset: {
        status: play ? (timerState === "critical" ? "expired" : timerState === "warning" ? "warning" : "gaming")
                     : (online ? "online" : "offline"),
        timer: timerState
      }
    });

    var header =
      '<div class="row-between" style="align-items:flex-start">' +
        "<div>" +
          '<div class="session-label">Your station</div>' +
          '<div style="font-family:var(--font-mono);font-size:30px;font-weight:750;letter-spacing:-.02em;margin-top:6px">' +
            UI.esc(pc || "Not assigned") + "</div>" +
        "</div>" +
        // Explicit status: this badge reports the connection, not the timer,
        // so it must not inherit the card's state.
        '<span class="badge badge-lg" data-status="' + (online ? "online" : "offline") + '">' +
          '<span class="dot' + (online ? " dot-live" : "") + '"></span>' +
          (online ? "Online" : "Offline") + "</span>" +
      "</div>";

    if (play) {
      var caption = timerState === "critical" ? "Session ending soon"
                  : timerState === "warning" ? "15 minutes left"
                  : "Time remaining";
      card.innerHTML = header +
        '<div style="margin-top:var(--s-6);padding-top:var(--s-6);border-top:1px solid var(--line);display:flex;gap:var(--s-6);align-items:center">' +
          '<div class="timer-ring" data-ring style="--pct:' + Session.progress() + '">' +
            '<div class="timer-ring-inner">' +
              '<div class="timer-digits timer-digits-lg" data-timer-digits>' + Session.clock(play.remaining) + "</div>" +
              '<div class="timer-caption">' + caption + "</div>" +
            "</div>" +
          "</div>" +
          '<div class="grow" style="min-width:0">' +
            '<div class="session-label">Now playing</div>' +
            '<div style="font-size:var(--t-h2);font-weight:720;letter-spacing:-.02em;margin-top:6px" class="truncate">' +
              UI.esc(play.appName) + "</div>" +
            '<div class="muted" style="font-size:var(--t-sm);margin-top:var(--s-3);line-height:1.55">' +
              "Your game closes automatically when the timer reaches zero." +
            "</div>" +
          "</div>" +
        "</div>";

      // Keep this card's numerals in step with the shared countdown.
      var digits = card.querySelector("[data-timer-digits]");
      var ring = card.querySelector("[data-ring]");
      var off = Session.on("tick", function (p) {
        if (!card.isConnected) { off(); return; }
        digits.textContent = Session.clock(p.remaining);
        ring.style.setProperty("--pct", Session.progress());
        var s = Session.timerState();
        card.setAttribute("data-timer", s);
        card.setAttribute("data-status", s === "critical" ? "expired" : s === "warning" ? "warning" : "gaming");
      });
    } else {
      card.innerHTML = header +
        '<div style="margin-top:var(--s-6);padding-top:var(--s-5);border-top:1px solid var(--line)">' +
          '<div class="session-label">Session time</div>' +
          '<div class="muted" style="font-size:var(--t-body);margin-top:6px;line-height:1.55">' +
            (online
              ? "No session is running on this station. When staff start one, the countdown appears here and on the floating timer card."
              : "This station has lost its link to the café server. Please let a staff member know.") +
          "</div>" +
        "</div>";
    }

    return card;
  }

  /* ==========================================================================
     HOME
     ========================================================================== */
  global.CXViews.home = {
    label: "Home",
    icon: "dashboard",
    title: "Home",
    mount: function (root, ctx) {
      var view = UI.el("div", { class: "view-bleed" });

      /* ---- hero ---- */
      var play = Session.state.play;
      var hero = UI.el("section", { class: "hero" });
      hero.innerHTML =
        '<div class="hero-art"></div>' +
        '<div class="vignette"></div>' +
        '<div class="hero-inner">' +
          '<span class="hero-eyebrow">' + Icon("sparkle", 13) +
            (play ? "Now playing" : "Your gaming hub") + "</span>" +
          '<h1 class="hero-title">' +
            (play ? UI.esc(play.appName) : "Welcome back, " + UI.esc(Session.firstName())) +
          "</h1>" +
          '<div class="hero-meta">' +
            (play
              ? '<span class="timer-digits" style="font-size:24px" data-hero-timer>' +
                  Session.clock(play.remaining) + "</span><span class='faint'>remaining</span>"
              : "") +
            '<span class="badge badge-lg" data-status="' + (Session.isOnline() ? "online" : "offline") + '">' +
              '<span class="dot' + (Session.isOnline() ? " dot-live" : "") + '"></span>' +
              (Session.isOnline() ? "Station online" : "Station offline") + "</span>" +
            '<span class="mono faint">' + UI.esc(Session.state.pcName || "Station not assigned") + "</span>" +
          "</div>" +
          '<div class="hero-actions">' +
            '<button class="btn btn-primary btn-hero" id="heroGames">' + Icon("games", 18) +
              '<span class="btn-label">Browse games</span></button>' +
            '<button class="btn btn-outline btn-hero" id="heroFood">' + Icon("fnb", 18) +
              '<span class="btn-label">Order food</span></button>' +
          "</div>" +
        "</div>";
      view.appendChild(hero);

      var body = UI.el("div", { class: "view" });

      /* ---- session + quick actions ---- */
      var split = UI.el("div", {
        class: "grid",
        style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(320px,380px)", gap: "var(--s-6)", alignItems: "start" }
      });

      var left = UI.el("div", { class: "col", style: { gap: "var(--s-6)" } });

      /* Library shelf */
      var libSection = UI.el("section");
      libSection.appendChild(sectionHead("Your library", "See all", function () { ctx.go("games"); }));
      libSection.appendChild(awaiting({
        icon: "games",
        title: "Your library is on its way",
        text: "The games your café has set up for this station will appear here. Ask a staff member if you expected to see something.",
        note: "Waiting for the server to send this station's game list."
      }));
      left.appendChild(libSection);

      split.appendChild(left);

      var right = UI.el("div", { class: "col", style: { gap: "var(--s-5)" } });
      right.appendChild(stationCard());

      var quick = UI.el("div", { class: "card card-pad col", style: { gap: "var(--s-3)" } });
      quick.innerHTML = '<div class="session-label" style="margin-bottom:var(--s-2)">Quick actions</div>';
      [
        ["billing", "My wallet", "wallet"],
        ["packages", "My packages", "packages"],
        ["membership", "Membership", "membership"],
        ["fnb", "Order food", "food"],
        ["packages", "Visit the shop", "shop"],
        ["plan", "Rewards", "rewards"],
        ["customers", "My account", "account"]
      ].forEach(function (item) {
        var btn = UI.el("button", {
          class: "btn btn-outline btn-block",
          style: { justifyContent: "flex-start", gap: "var(--s-3)" },
          html: Icon(item[0], 17) + '<span class="btn-label">' + item[1] + "</span>",
          onClick: function () { ctx.go(item[2]); }
        });
        quick.appendChild(btn);
      });
      right.appendChild(quick);

      split.appendChild(right);
      body.appendChild(split);
      view.appendChild(body);
      root.appendChild(view);

      hero.querySelector("#heroGames").addEventListener("click", function () { ctx.go("games"); });
      hero.querySelector("#heroFood").addEventListener("click", function () { ctx.go("food"); });

      var heroTimer = hero.querySelector("[data-hero-timer]");
      if (heroTimer) {
        var offHero = Session.on("tick", function (p) {
          if (!heroTimer.isConnected) { offHero(); return; }
          heroTimer.textContent = Session.clock(p.remaining);
        });
      }

      Motion.enter(hero.querySelector(".hero-inner"), { y: 20, duration: 0.5 });
      Motion.stagger([left, right], { step: 0.06, y: 16 });
    }
  };

  /* ==========================================================================
     GAMES
     ========================================================================== */
  /* Kept across mounts so navigating away and back does not stack listeners. */
  var gamesOff = null;

  global.CXViews.games = {
    label: "Games",
    icon: "games",
    title: "Games",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head">' +
          "<div>" +
            '<div class="view-title">Choose a game</div>' +
            '<div class="view-sub">Everything your café has made available on this station.</div>' +
          "</div>" +
          '<div class="row gap-3">' +
            '<div class="search" style="width:300px">' + Icon("search", 16) +
              '<input class="input" id="gameSearch" type="search" placeholder="Search games…"></div>' +
          "</div>" +
        "</div>";
      var grid = UI.el("div", { class: "col gap-3", id: "gameGrid" });
      view.appendChild(grid);
      root.appendChild(view);

      var filter = "";

      function launcherClass(l) { return "badge"; }

      function card(g) {
        var el = UI.el("button", {
          class: "card card-pad row gap-4",
          style: { alignItems: "center", textAlign: "left", cursor: "pointer", width: "100%" }
        });
        el.innerHTML =
          '<span class="avatar" style="width:44px;height:44px;font-size:15px;flex:0 0 auto">' +
            UI.esc(UI.initials ? UI.initials(g.name) : g.name.slice(0, 2).toUpperCase()) + "</span>" +
          '<span class="grow" style="min-width:0">' +
            '<span style="display:block;font-size:15px;font-weight:700">' + UI.esc(g.name) + "</span>" +
            '<span class="faint" style="font-size:12px">' +
              UI.esc([g.category, g.launcher].filter(Boolean).join(" · ")) + "</span>" +
          "</span>" +
          '<span class="btn btn-primary btn-sm" style="flex:0 0 auto">' + Icon("play", 14) +
            '<span class="btn-label">Play</span></span>';
        el.addEventListener("click", function () {
          Session.launchGame(g);   // portal's global "launching" handler shows the overlay
        });
        return el;
      }

      function render() {
        UI.clear(grid);
        var games = (Session.state.games || []).filter(function (g) {
          return !filter || (g.name || "").toLowerCase().indexOf(filter) !== -1
            || (g.category || "").toLowerCase().indexOf(filter) !== -1;
        });

        if (!Session.state.games || !Session.state.games.length) {
          grid.appendChild(awaiting({
            icon: "games",
            title: "No games have reached this station yet",
            text: "Your café's staff choose which games appear here. Once a session starts and the server sends this station's library, every title shows up with a play button.",
            note: "Waiting for the server to send this station's game list."
          }));
          return;
        }
        if (!games.length) {
          grid.appendChild(awaiting({ icon: "games", title: "No games match", text: "Nothing matches “" + filter + "”." }));
          return;
        }
        var made = [];
        games.forEach(function (g) { var c = card(g); grid.appendChild(c); made.push(c); });
        Motion.stagger(made, { step: 0.03, y: 8 });
      }

      view.querySelector("#gameSearch").addEventListener("input", function (e) {
        filter = e.target.value.trim().toLowerCase();
        render();
      });

      // Re-render live when the console pushes an updated list.
      if (gamesOff) { try { gamesOff(); } catch (e) {} }
      gamesOff = Session.on("games", render);

      render();
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     FOOD  (live menu from /api/products/menu)
     ========================================================================== */
  var cart = {};          // product_id -> { product, quantity }  (survives view swaps)

  function cartLines() {
    return Object.keys(cart).map(function (k) { return cart[k]; })
      .filter(function (l) { return l.quantity > 0; });
  }
  function cartTotal() {
    return cartLines().reduce(function (sum, l) {
      return sum + Number(l.product.price) * l.quantity;
    }, 0);
  }
  function cartCount() {
    return cartLines().reduce(function (n, l) { return n + l.quantity; }, 0);
  }

  global.CXViews.food = {
    label: "Food",
    icon: "fnb",
    title: "Food & drink",
    mount: function (root, ctx) {
      var Wallet = global.CXWallet;
      var activeCategory = "All";

      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head">' +
          "<div>" +
            '<div class="view-title">Food &amp; drink</div>' +
            '<div class="view-sub">Order to your station without leaving your seat.</div>' +
          "</div>" +
          '<button class="btn btn-primary btn-lg" id="foodCartBtn">' + Icon("fnb", 17) +
            '<span class="btn-label">Your order</span>' +
            '<span class="chip-count" id="foodCartCount" style="background:rgba(0,0,0,.25)">0</span>' +
          "</button>" +
        "</div>" +
        '<div class="row gap-2 wrap" id="foodCats" style="margin-bottom:var(--s-6)"></div>' +
        '<div id="foodHost"></div>' +
        '<div id="foodOrders" style="margin-top:var(--s-12)"></div>';
      root.appendChild(view);

      var host = view.querySelector("#foodHost");
      var catsRow = view.querySelector("#foodCats");
      var ordersHost = view.querySelector("#foodOrders");
      host.appendChild(UI.skeletonCards(6, "260px"));

      function syncCartButton() {
        var count = cartCount();
        view.querySelector("#foodCartCount").textContent = count;
        view.querySelector("#foodCartBtn").disabled = count === 0;
      }

      /*
       * What the menu and the order list are currently showing.
       *
       * Both painters ran on every wallet emit, and the wallet emits for
       * anything it does — a balance refresh, a transaction load, a top-up —
       * none of which change the menu. Each emit tore down every product card
       * and re-ran the staggered slide-in, which is what the flicker was.
       *
       * The signature is the rendered input itself rather than a list of
       * fields, because a menu is a few dozen small objects: stringifying it
       * costs microseconds and cannot miss a field the way a hand-written
       * list can. The cart is deliberately absent — quantities are written
       * straight into their own elements by setQty and never need a repaint.
       */
      var lastMenuSig = "";
      var lastOrdersSig = "";

      /* ---- menu ---- */
      function paintMenu(s) {
        var sig = s.menuError ? "error:" + s.menuError
          : !s.menu ? "loading"
          : activeCategory + "::" + JSON.stringify(s.menu);
        if (sig === lastMenuSig && host.childElementCount) return;
        lastMenuSig = sig;

        UI.clear(catsRow);
        UI.clear(host);

        if (s.menuError) {
          host.appendChild(UI.emptyState({
            icon: "alert", status: "error",
            title: "Couldn't load the menu",
            text: "The café server didn't respond. Please try again.",
            actions: [{ label: "Try again", icon: "refresh", onClick: function () { Wallet.loadMenu(); } }]
          }));
          return;
        }
        if (!s.menu) { host.appendChild(UI.skeletonCards(6, "260px")); return; }

        var all = s.menu.data || [];
        if (!all.length) {
          host.appendChild(UI.emptyState({
            icon: "fnb",
            title: "Nothing on the menu right now",
            text: "The kitchen hasn't put anything up for order. Ask a staff member what's available."
          }));
          return;
        }

        // Category chips, driven by whatever the café actually has.
        var categories = ["All"].concat(s.menu.categories || []);
        categories.forEach(function (name) {
          var chip = UI.el("button", {
            class: "chip",
            text: name,
            "aria-pressed": String(name === activeCategory)
          });
          if (name === activeCategory) chip.setAttribute("data-status", "accent");
          chip.addEventListener("click", function () {
            activeCategory = name;
            paintMenu(s);
          });
          catsRow.appendChild(chip);
        });

        var shown = activeCategory === "All"
          ? all
          : (s.menu.grouped[activeCategory] || []);

        var grid = UI.el("div", { class: "grid-products" });
        shown.forEach(function (product) {
          var line = cart[product.product_id];
          var qty = line ? line.quantity : 0;

          var card = UI.el("div", { class: "product" });
          card.innerHTML =
            '<div class="product-art"' +
              (product.image_url ? ' style="background-image:url(' + UI.esc(product.image_url) + ')"' : "") + ">" +
              (product.stock_state === "low"
                ? '<span class="badge" data-status="warning" style="position:absolute;top:10px;left:10px">Only ' +
                  product.stock_quantity + " left</span>"
                : "") +
            "</div>" +
            '<div class="product-body">' +
              '<div class="product-name">' + UI.esc(product.product_name) + "</div>" +
              (product.description
                ? '<div class="product-desc">' + UI.esc(product.description) + "</div>" : "") +
              '<div class="product-price">' + UI.esc(Wallet.money(product.price)) + "</div>" +
            "</div>";

          var foot = UI.el("div", { class: "product-foot" });
          var stepper = UI.el("div", { class: "stepper" });
          stepper.innerHTML =
            '<button data-minus aria-label="One fewer">' + Icon("close", 12) + "</button>" +
            '<span class="stepper-value" data-qty>' + qty + "</span>" +
            '<button data-plus aria-label="One more">' + Icon("plus", 12) + "</button>";

          var qtyEl = stepper.querySelector("[data-qty]");
          var minus = stepper.querySelector("[data-minus]");
          var plus = stepper.querySelector("[data-plus]");

          function setQty(next) {
            // Never let the customer add more than the shelf holds.
            var cap = product.track_stock ? Number(product.stock_quantity) : Infinity;
            next = Math.max(0, Math.min(next, cap));
            if (next === 0) delete cart[product.product_id];
            else cart[product.product_id] = { product: product, quantity: next };
            qtyEl.textContent = next;
            minus.disabled = next === 0;
            plus.disabled = next >= cap;
            addBtn.classList.toggle("btn-primary", next > 0);
            addBtn.classList.toggle("btn-outline", next === 0);
            syncCartButton();
            Motion.animate(qtyEl, { transform: ["scale(.7)", "scale(1)"] },
              { duration: 0.22, easing: Motion.EASE.out });
          }

          var addBtn = UI.el("button", {
            class: "btn " + (qty > 0 ? "btn-primary" : "btn-outline") + " grow",
            html: '<span class="btn-label">Add to order</span>'
          });
          addBtn.addEventListener("click", function () {
            var current = cart[product.product_id];
            setQty((current ? current.quantity : 0) + 1);
          });

          minus.addEventListener("click", function () {
            var current = cart[product.product_id];
            setQty((current ? current.quantity : 0) - 1);
          });
          plus.addEventListener("click", function () {
            var current = cart[product.product_id];
            setQty((current ? current.quantity : 0) + 1);
          });
          minus.disabled = qty === 0;

          foot.appendChild(stepper);
          foot.appendChild(addBtn);
          card.appendChild(foot);
          grid.appendChild(card);
        });

        host.appendChild(grid);
        Motion.stagger(grid.children, { step: 0.025, y: 12 });
      }

      /* ---- my orders ---- */
      var ORDER_TONE = {
        PLACED: "warning", CONFIRMED: "gaming", PREPARING: "gaming",
        READY: "online", DELIVERED: "idle", CANCELLED: "offline"
      };
      var ORDER_COPY = {
        PLACED: "Sent to the kitchen", CONFIRMED: "Confirmed", PREPARING: "Being prepared",
        READY: "Ready — on its way", DELIVERED: "Delivered", CANCELLED: "Cancelled"
      };

      /*
       * A kitchen order moves through fixed stages, and "Preparing" on its own
       * does not tell the customer how far along that is. The track shows the
       * whole journey with the current stage marked, so the answer to "how
       * much longer" is visible rather than inferred.
       *
       * Cancelled is not a stage on the path — it is a stop — so it renders as
       * a single state rather than a part-filled track.
       */
      var ORDER_STEPS = ["PLACED", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
      var STEP_LABEL = {
        PLACED: "Sent", CONFIRMED: "Confirmed", PREPARING: "Cooking",
        READY: "Ready", DELIVERED: "Delivered"
      };

      function orderTrack(status) {
        var track = UI.el("div", { class: "order-track" });

        if (status === "CANCELLED") {
          track.dataset.status = "offline";
          track.innerHTML = '<div class="order-track-cancelled">' +
            Icon("close", 13) + "<span>This order was cancelled</span></div>";
          return track;
        }

        var reached = ORDER_STEPS.indexOf(status);
        if (reached === -1) reached = 0;

        track.innerHTML = ORDER_STEPS.map(function (step, i) {
          var state = i < reached ? "done" : (i === reached ? "current" : "todo");
          return '<div class="order-step" data-state="' + state + '">' +
            '<span class="order-step-dot"></span>' +
            '<span class="order-step-label">' + STEP_LABEL[step] + "</span>" +
          "</div>";
        }).join("");

        // The bar fills to the current stage, so progress reads at a glance.
        track.style.setProperty(
          "--reached",
          (reached / (ORDER_STEPS.length - 1) * 100).toFixed(1) + "%"
        );
        return track;
      }

      function paintOrders(s) {
        /* Same guard as the menu: an order list only changes when an order
           does, not when the balance is refreshed underneath it. */
        var sig = JSON.stringify(s.orders || []);
        if (sig === lastOrdersSig) return;
        lastOrdersSig = sig;

        UI.clear(ordersHost);
        if (!s.orders || !s.orders.length) return;

        ordersHost.appendChild(sectionHead("Your orders", null, null));
        var card = UI.el("div", { class: "card card-body-flush" });
        s.orders.slice(0, 8).forEach(function (order) {
          var row = UI.el("div", {
            class: "kv",
            style: { padding: "14px var(--s-5)", borderBottom: "1px solid var(--line-faint)" },
            dataset: { status: ORDER_TONE[order.status] || "idle" }
          });
          row.innerHTML =
            '<span style="min-width:0">' +
              '<span class="mono" style="font-size:13px;font-weight:650;display:block">' +
                UI.esc(order.order_number) + "</span>" +
              '<span class="faint" style="font-size:11px">' +
                UI.esc(order.items.map(function (i) { return i.quantity + "× " + i.product_name; }).join(", ")) +
              "</span></span>" +
            '<span style="text-align:right;white-space:nowrap">' +
              '<span style="font-size:15px;font-weight:750">' + UI.esc(Wallet.money(order.total)) + "</span>" +
              '<span style="display:block;margin-top:3px"><span class="badge" data-status="' +
                (ORDER_TONE[order.status] || "idle") + '">' +
                UI.esc(ORDER_COPY[order.status] || order.status) + "</span></span>" +
            "</span>";

          var wrap = UI.el("div", {
            style: { borderBottom: "1px solid var(--line-faint)" },
            dataset: { status: ORDER_TONE[order.status] || "idle" }
          });
          row.style.borderBottom = "0";
          wrap.appendChild(row);
          wrap.appendChild(orderTrack(order.status));
          card.appendChild(wrap);
        });
        ordersHost.appendChild(card);
      }

      /* ---- cart drawer ---- */
      function openCart() {
        var lines = cartLines();
        if (!lines.length) return;

        var body = UI.el("div", { class: "col" });
        function paintCart() {
          UI.clear(body);
          var current = cartLines();
          if (!current.length) { drawer.close(); return; }

          current.forEach(function (line) {
            var row = UI.el("div", { class: "cart-line" });
            row.innerHTML =
              "<span><span class='cart-name'>" + UI.esc(line.product.product_name) + "</span>" +
                "<span class='cart-qty'>" + line.quantity + " × " +
                UI.esc(Wallet.money(line.product.price)) + "</span></span>" +
              "<span class='cart-amount'>" +
                UI.esc(Wallet.money(line.product.price * line.quantity)) + "</span>";
            body.appendChild(row);
          });

          var totals = UI.el("div", { class: "cart-total" });
          totals.innerHTML =
            "<span class='cart-total-label'>Total</span>" +
            "<span class='cart-total-value'>" + UI.esc(Wallet.money(cartTotal())) + "</span>";
          body.appendChild(totals);

          var balance = Wallet.state.balance;
          var note = UI.el("div", { class: "notice", style: { marginTop: "var(--s-5)" } });
          if (balance === null) {
            note.setAttribute("data-status", "idle");
            note.innerHTML = Icon("info", 16) + "<div>Your order will be added to your bill.</div>";
          } else if (balance >= cartTotal()) {
            note.setAttribute("data-status", "online");
            note.innerHTML = Icon("check", 16) +
              "<div>Paid from your wallet, leaving <strong>" +
              UI.esc(Wallet.money(balance - cartTotal())) + "</strong>.</div>";
          } else {
            note.setAttribute("data-status", "warning");
            note.innerHTML = Icon("alert", 16) +
              "<div>Your wallet holds <strong>" + UI.esc(Wallet.money(balance)) +
              "</strong>. The rest goes on your bill to settle at the counter.</div>";
          }
          body.appendChild(note);
        }

        var drawer = UI.drawer({
          head: '<div class="row-between"><div class="page-title" style="font-size:21px">Your order</div></div>',
          body: body,
          foot: "",
          onClose: function () { syncCartButton(); }
        });

        var placeBtn = UI.el("button", {
          class: "btn btn-primary btn-lg btn-block",
          html: Icon("check", 17) + '<span class="btn-label">Place order</span>'
        });
        placeBtn.addEventListener("click", function () {
          UI.withBusy(placeBtn, function () {
            return Wallet.placeOrder(
              cartLines().map(function (l) {
                return { product_id: l.product.product_id, quantity: l.quantity };
              }),
              { pc_name: Session.state.pcName || null }
            )
              .then(function (r) {
                UI.toast.ok(r.message, r.data.order_number);
                cart = {};
                syncCartButton();
                drawer.close();
              })
              .catch(function (err) {
                UI.toast.error("Order failed", err.message);
                // Stock may have moved under us, so refresh the menu.
                Wallet.loadMenu();
              });
          });
        });
        drawer.foot.appendChild(placeBtn);

        paintCart();
      }

      view.querySelector("#foodCartBtn").addEventListener("click", openCart);

      var off = Wallet.on(function (s) {
        if (!view.isConnected) { off(); return; }
        paintMenu(s);
        paintOrders(s);
      });

      if (Wallet.state.menu) { paintMenu(Wallet.state); paintOrders(Wallet.state); }
      Wallet.loadMenu();
      Wallet.loadOrders();
      syncCartButton();
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     SHOP
     ========================================================================== */
  global.CXViews.shop = {
    label: "Shop",
    icon: "packages",
    title: "Shop",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Shop</div>' +
          '<div class="view-sub">Accessories, merch and café extras.</div>' +
        "</div></div>";

      view.appendChild(awaiting({
        icon: "packages",
        title: "The shop is empty for now",
        text: "Items your café puts on sale will appear here, with pictures and prices, ready to add to your bill.",
        note: "Shares the same products catalogue as Food. Once that exists on the server, both pages fill in."
      }));

      root.appendChild(view);
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     REWARDS
     ========================================================================== */
  global.CXViews.rewards = {
    label: "Rewards",
    icon: "plan",
    title: "Rewards",
    mount: function (root) {
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Rewards</div>' +
          '<div class="view-sub">Earn as you play.</div>' +
        "</div></div>";

      view.appendChild(awaiting({
        icon: "plan",
        title: "Rewards haven't launched yet",
        text: "Points for time played and money spent, free hours and credit to redeem — all of it lands here once your café turns it on.",
        note: "Requires a loyalty ledger on the server. Nothing in the platform counts points today, so there is no balance to show you."
      }));

      root.appendChild(view);
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     PACKAGES & MEMBERSHIP  (live, from the café server)
     ========================================================================== */
  function unitLabel(type, units) {
    if (type === "HOURS") {
      var m = Number(units);
      if (m < 60) return Math.round(m) + " min";
      var h = Math.floor(m / 60), rem = Math.round(m % 60);
      return h + "h" + (rem ? " " + rem + "m" : "");
    }
    var W = global.CXWallet;
    return type === "SESSIONS" ? W.amount(units) + " sessions" : W.money(units);
  }

  global.CXViews.packages = {
    label: "Packages",
    icon: "packages",
    title: "My packages",
    mount: function (root) {
      var Wallet = global.CXWallet;
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">My packages</div>' +
          '<div class="view-sub">Prepaid time and coins you have bought.</div>' +
        "</div></div>" +
        '<div id="pkgHost"></div>';
      root.appendChild(view);

      var host = view.querySelector("#pkgHost");
      host.appendChild(UI.skeletonCards(3, "150px"));

      function paint(s) {
        UI.clear(host);
        var active = s.packages.filter(function (p) { return p.status === "ACTIVE"; });
        var past = s.packages.filter(function (p) { return p.status !== "ACTIVE"; });

        if (!s.packages.length) {
          host.appendChild(UI.emptyState({
            icon: "packages",
            title: "No packages yet",
            text: "Ask a staff member about prepaid bundles — they work out cheaper than paying per hour."
          }));
          return;
        }

        var grid = UI.el("div", { class: "grid-products" });
        active.forEach(function (p) {
          var pct = p.total_units > 0 ? (p.remaining_units / p.total_units) * 100 : 0;
          var card = UI.el("div", { class: "card card-pad col gap-3", dataset: { status: "online" } });
          card.innerHTML =
            '<div class="row-between" style="align-items:flex-start">' +
              "<div><div class='session-label'>" + UI.esc(p.package_type) + "</div>" +
                '<div style="font-size:18px;font-weight:750;margin-top:2px">' + UI.esc(p.package_name) + "</div></div>" +
              '<span class="badge" data-status="online">Active</span>' +
            "</div>" +
            '<div style="font-size:30px;font-weight:800;letter-spacing:-.02em">' +
              UI.esc(unitLabel(p.package_type, p.remaining_units)) +
              '<span style="font-size:13px;color:var(--text-3);font-weight:600"> left</span></div>' +
            '<div class="meter meter-lg" data-status="online"><div class="meter-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="row-between" style="font-size:11px;color:var(--text-3)">' +
              "<span>of " + UI.esc(unitLabel(p.package_type, p.total_units)) + "</span>" +
              "<span>" + (p.expires_at ? "Expires " + UI.esc(UI.fmtDate(p.expires_at)) : "No expiry") + "</span>" +
            "</div>";
          grid.appendChild(card);
        });
        host.appendChild(grid);
        Motion.stagger(grid.children, { step: 0.04, y: 12 });

        if (past.length) {
          var hist = UI.el("section", { style: { marginTop: "var(--s-10)" } });
          hist.innerHTML = '<div class="shelf-title" style="margin-bottom:var(--s-4)">Past packages</div>';
          var card = UI.el("div", { class: "card card-body-flush" });
          past.forEach(function (p) {
            var row = UI.el("div", { class: "kv", style: { padding: "12px var(--s-5)", borderBottom: "1px solid var(--line-faint)" } });
            row.innerHTML =
              "<span><span style='font-size:13px;font-weight:600;display:block'>" + UI.esc(p.package_name) + "</span>" +
                "<span class='faint' style='font-size:11px'>" + UI.esc(UI.fmtDate(p.purchased_at)) + "</span></span>" +
              '<span class="badge">' + UI.esc(p.status) + "</span>";
            card.appendChild(row);
          });
          hist.appendChild(card);
          host.appendChild(hist);
        }
      }

      var off = Wallet.on(function (s) {
        if (!view.isConnected) { off(); return; }
        paint(s);
      });
      if (Wallet.state.entitlementsLoaded) paint(Wallet.state);
      Wallet.loadEntitlements();
      Motion.enter(view, { y: 14 });
    }
  };

  global.CXViews.membership = {
    label: "Membership",
    icon: "membership",
    title: "Membership",
    mount: function (root) {
      var Wallet = global.CXWallet;
      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">Membership</div>' +
          '<div class="view-sub">Your tier and what it gets you.</div>' +
        "</div></div>" +
        '<div id="memHost"></div>';
      root.appendChild(view);

      var host = view.querySelector("#memHost");
      host.appendChild(UI.skeletonRows(4));

      function paint(s) {
        UI.clear(host);
        var m = s.membership;

        if (!m) {
          host.appendChild(UI.emptyState({
            icon: "membership",
            title: "You're not a member yet",
            text: "Ask a staff member about membership — tiers come with a standing discount on gaming and a joining bonus."
          }));
          return;
        }

        var card = UI.el("div", { class: "wallet-card" });
        card.innerHTML =
          '<div class="row-between" style="align-items:flex-start">' +
            "<div><div class='wallet-label'>" + UI.esc(m.tier) + " member</div>" +
              '<div style="font-size:38px;font-weight:820;letter-spacing:-.03em;margin-top:6px">' +
                UI.esc(m.plan_name) + "</div></div>" +
            '<span class="badge badge-lg" data-status="' + (m.days_remaining <= 7 ? "warning" : "online") + '">' +
              m.days_remaining + " days left</span>" +
          "</div>" +
          '<div class="row gap-6 wrap" style="margin-top:var(--s-6)">' +
            (m.discount_percent ? "<div><div class='session-label'>Discount</div>" +
              '<div style="font-size:22px;font-weight:750">' + m.discount_percent + "%</div></div>" : "") +
            "<div><div class='session-label'>Valid until</div>" +
              '<div style="font-size:22px;font-weight:750">' + UI.esc(UI.fmtDate(m.expires_at)) + "</div></div>" +
          "</div>";
        host.appendChild(card);

        if (m.perks && m.perks.length) {
          var perks = UI.el("div", { class: "card card-pad", style: { marginTop: "var(--s-5)" } });
          perks.innerHTML = "<div class='session-label' style='margin-bottom:var(--s-4)'>What you get</div>" +
            '<ul style="display:flex;flex-direction:column;gap:10px">' +
            m.perks.map(function (p) {
              return '<li style="display:flex;gap:10px;align-items:center;font-size:var(--t-body)">' +
                '<span class="tx-icon" data-status="online" style="width:28px;height:28px">' + Icon("check", 14) + "</span>" +
                "<span>" + UI.esc(p) + "</span></li>";
            }).join("") + "</ul>";
          host.appendChild(perks);
          Motion.stagger(perks.querySelectorAll("li"), { step: 0.04, y: 8 });
        }
      }

      var off = Wallet.on(function (s) {
        if (!view.isConnected) { off(); return; }
        paint(s);
      });
      if (Wallet.state.entitlementsLoaded) paint(Wallet.state);
      Wallet.loadEntitlements();
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     WALLET  (live, from /api/wallet)
     ========================================================================== */
  var TX_STATUS = { credit: "online", debit: "accent" };

  function transactionRow(tx) {
    var Wallet = global.CXWallet;
    var isCredit = tx.direction === "credit";
    var row = UI.el("div", { class: "tx-row", dataset: { status: TX_STATUS[tx.direction] || "idle" } });

    var when = new Date(tx.created_at);
    var meta = [
      isNaN(when) ? null : when.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      tx.method || null,
      tx.note || null
    ].filter(Boolean).join(" · ");

    row.innerHTML =
      '<span class="tx-icon">' + Icon(isCredit ? "plus" : "fnb", 18) + "</span>" +
      '<div style="min-width:0">' +
        '<div class="tx-title">' + UI.esc(Wallet.categoryLabel(tx.category)) + "</div>" +
        '<div class="tx-meta truncate">' + UI.esc(meta) + "</div>" +
      "</div>" +
      "<div>" +
        // The coin mark is illegible at this size, so the unit is spelled out.
        '<div class="tx-amount">' + (isCredit ? "+" : "−") + UI.esc(Wallet.amount(tx.amount)) +
          '<span style="font-size:11px;font-weight:700;letter-spacing:.06em;opacity:.72;margin-left:4px">XP</span>' +
        "</div>" +
        '<div class="tx-balance">' + UI.esc(Wallet.money(tx.balance_after)) + "</div>" +
      "</div>";
    return row;
  }

  global.CXViews.wallet = {
    label: "Wallet",
    icon: "billing",
    title: "Wallet",
    mount: function (root, ctx) {
      var Wallet = global.CXWallet;

      var view = UI.el("div", { class: "view" });
      view.innerHTML =
        '<div class="view-head">' +
          "<div>" +
            '<div class="view-title">Wallet</div>' +
            '<div class="view-sub">Your café balance and everything it has paid for.</div>' +
          "</div>" +
          '<div class="row gap-3">' +
            '<button class="btn btn-outline" id="walletRefresh">' + Icon("refresh", 16) +
              '<span class="btn-label">Refresh</span></button>' +
          "</div>" +
        "</div>" +
        '<div style="display:grid;grid-template-columns:minmax(320px,420px) minmax(0,1fr);gap:var(--s-6);align-items:start" id="walletGrid">' +
          '<div id="walletBalance"></div>' +
          '<div class="card card-body-flush" id="walletLedger"></div>' +
        "</div>";
      root.appendChild(view);

      var balanceHost = view.querySelector("#walletBalance");
      var ledgerHost = view.querySelector("#walletLedger");

      function renderBalance(s) {
        UI.clear(balanceHost);

        if (s.loading && s.balance === null) {
          var skel = UI.el("div", { class: "wallet-card col", style: { gap: "var(--s-4)" } });
          skel.innerHTML =
            '<div class="skel skel-line" style="width:40%"></div>' +
            '<div class="skel" style="height:52px;width:70%"></div>' +
            '<div class="skel skel-line" style="width:55%"></div>';
          balanceHost.appendChild(skel);
          return;
        }

        if (s.error) {
          balanceHost.appendChild(walletError(s.error));
          return;
        }

        var card = UI.el("div", { class: "wallet-card" });
        card.innerHTML =
          '<div class="row gap-6" style="align-items:center">' +
            '<div class="grow">' +
              '<div class="wallet-label">XP Coin balance</div>' +
              '<div class="wallet-amount-row">' +
                '<span class="wallet-balance" id="walletAmount">' + UI.esc(Wallet.amount(s.balance)) + "</span>" +
                '<span class="wallet-unit">XP</span>' +
              "</div>" +
            "</div>" +
            global.CXCoin(112, { detail: "full", spin: true }).replace('class="xp-coin', 'class="xp-coin xp-coin-hero') +
          "</div>" +
          '<div class="wallet-sub">Earn · Redeem · Grow</div>' +
          '<div class="wallet-actions">' +
            '<button class="btn btn-primary btn-lg grow" id="walletTopup">' + Icon("plus", 17) +
              '<span class="btn-label">Add coins</span></button>' +
          "</div>" +
          '<div class="wallet-foot faint">Or ask a member of staff to add coins at the counter.</div>';
        balanceHost.appendChild(card);

        /* Only offered when the café has a gateway switched on — a button that
           opens a dialog saying "not available" is worse than no button. The
           check is cheap and cached, so it runs on every paint. */
        var topupBtn = card.querySelector("#walletTopup");
        topupBtn.addEventListener("click", function () { global.CXTopup.open(); });

        global.CXWallet.topupOptions()
          .then(function (opts) {
            if (!opts || !opts.enabled) topupBtn.closest(".wallet-actions").remove();
          })
          .catch(function () {
            var host = topupBtn.closest(".wallet-actions");
            if (host) host.remove();
          });

        // Count the balance up on first paint and on any change.
        var amountEl = card.querySelector("#walletAmount");
        var previous = amountEl.dataset.shown != null ? Number(amountEl.dataset.shown) : 0;
        Motion.countTo(amountEl, Number(s.balance), {
          duration: 0.6,
          format: function (v) { return Wallet.amount(v); }
        });
        amountEl.dataset.shown = s.balance;
        if (previous !== s.balance) Motion.pulse(card, "rgba(255,23,68,.32)");
      }

      function walletError(code) {
        var copy = {
          "not-signed-in": ["You're not signed in", "Sign in to see your wallet balance."],
          "no-token": ["Your session needs refreshing", "Please sign in again to load your wallet."],
          denied: ["We can't show this wallet", "Please sign in again, or ask a staff member for help."],
          missing: ["No wallet found", "Ask a staff member to set up your wallet at the counter."],
          unreachable: ["Can't reach your wallet", "The café server didn't respond. Please try again."]
        }[code] || ["Something went wrong", "We couldn't load your wallet."];

        return UI.emptyState({
          icon: "alert",
          status: code === "unreachable" || code === "denied" ? "error" : "warning",
          title: copy[0],
          text: copy[1],
          actions: [{ label: "Try again", icon: "refresh", variant: "outline", onClick: function () { Wallet.load(); } }]
        });
      }

      function renderLedger(s) {
        UI.clear(ledgerHost);
        ledgerHost.appendChild(UI.el("div", {
          class: "card-head",
          html: "<h2>Recent activity</h2>" +
            (s.total ? '<span class="badge badge-plain">' + s.total + " total</span>" : "")
        }));

        if (s.loading && !s.transactions.length) {
          ledgerHost.appendChild(UI.skeletonRows(5));
          return;
        }
        if (s.error) {
          ledgerHost.appendChild(UI.el("div", { class: "card-body" }, [walletError(s.error)]));
          return;
        }
        if (!s.transactions.length) {
          ledgerHost.appendChild(UI.emptyState({
            icon: "billing",
            title: "Nothing here yet",
            text: "Top-ups and anything you spend at the café will be listed here."
          }));
          return;
        }

        var list = UI.el("div");
        var rows = [];
        s.transactions.forEach(function (tx) {
          var row = transactionRow(tx);
          list.appendChild(row);
          rows.push(row);
        });
        ledgerHost.appendChild(list);
        Motion.stagger(rows, { step: 0.02, y: 8, maxDelay: 0.2 });
      }

      function paint(s) { renderBalance(s); renderLedger(s); }

      var off = Wallet.on(function (s) {
        if (!view.isConnected) { off(); return; }
        paint(s);
      });

      var refreshBtn = view.querySelector("#walletRefresh");
      refreshBtn.addEventListener("click", function () {
        UI.withBusy(refreshBtn, function () { return Wallet.load(); });
      });

      paint(Wallet.state);
      Wallet.load();
      Motion.enter(view, { y: 14 });
    }
  };

  /* ==========================================================================
     ACCOUNT  (real customer data)
     ========================================================================== */
  /* Shared by the account order history — the food view has its own copies
     inside its mount closure, and lifting both here keeps the two in step. */
  var ORDER_TONE_ACCT = {
    PLACED: "warning", CONFIRMED: "gaming", PREPARING: "gaming",
    READY: "online", DELIVERED: "idle", CANCELLED: "offline"
  };
  var ACCT_STEPS = ["PLACED", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
  var ACCT_STEP_LABEL = {
    PLACED: "Sent", CONFIRMED: "Confirmed", PREPARING: "Cooking",
    READY: "Ready", DELIVERED: "Delivered"
  };

  function accountOrderTrack(status) {
    var track = UI.el("div", { class: "order-track" });

    if (status === "CANCELLED") {
      track.dataset.status = "offline";
      track.innerHTML = '<div class="order-track-cancelled">' +
        Icon("close", 13) + "<span>This order was cancelled</span></div>";
      return track;
    }

    var reached = ACCT_STEPS.indexOf(status);
    if (reached === -1) reached = 0;

    track.innerHTML = ACCT_STEPS.map(function (step, i) {
      var state = i < reached ? "done" : (i === reached ? "current" : "todo");
      return '<div class="order-step" data-state="' + state + '">' +
        '<span class="order-step-dot"></span>' +
        '<span class="order-step-label">' + ACCT_STEP_LABEL[step] + "</span>" +
      "</div>";
    }).join("");

    track.style.setProperty(
      "--reached",
      (reached / (ACCT_STEPS.length - 1) * 100).toFixed(1) + "%"
    );
    return track;
  }

  global.CXViews.account = {
    label: "Account",
    icon: "customers",
    title: "My account",
    mount: function (root, ctx) {
      var user = Session.state.user;
      var view = UI.el("div", { class: "view" });

      view.innerHTML =
        '<div class="view-head"><div>' +
          '<div class="view-title">My account</div>' +
          '<div class="view-sub">Your CafeXP profile.</div>' +
        "</div></div>";

      if (!user) {
        view.appendChild(UI.emptyState({
          icon: "customers",
          title: "You're not signed in",
          text: "Sign in to see your profile and session.",
          actions: [{ label: "Sign in", variant: "primary", onClick: function () { Session.signOut(); } }]
        }));
        root.appendChild(view);
        return;
      }

      var split = UI.el("div", {
        style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(300px,360px)", gap: "var(--s-6)", alignItems: "start" }
      });

      var profile = UI.el("div", { class: "card" });
      profile.innerHTML =
        '<div class="card-body">' +
          '<div class="row gap-5" style="align-items:center;margin-bottom:var(--s-6)">' +
            '<span class="avatar-orb" style="width:72px;height:72px;font-size:26px">' +
              UI.esc(UI.initials(Session.displayName())) + "</span>" +
            "<div>" +
              '<div style="font-size:var(--t-h1);font-weight:780;letter-spacing:-.02em">' +
                UI.esc(Session.displayName()) + "</div>" +
              '<div class="muted" style="font-size:var(--t-body);margin-top:2px">' +
                UI.esc(user.email || "") + "</div>" +
            "</div>" +
          "</div>" +
          '<div class="col">' +
            '<div class="kv"><span class="kv-key">Mobile</span><span class="kv-val">' +
              UI.esc(user.phone_number || "—") + "</span></div>" +
            '<div class="kv"><span class="kv-key">Address</span><span class="kv-val">' +
              UI.esc(typeof user.address === "string" ? user.address : JSON.stringify(user.address || "—")) + "</span></div>" +
            '<div class="kv"><span class="kv-key">Customer ID</span><span class="kv-val mono">#' +
              UI.esc(user.customer_id != null ? user.customer_id : "—") + "</span></div>" +
            '<div class="kv"><span class="kv-key">Member since</span><span class="kv-val">' +
              UI.esc(user.created_at ? UI.fmtDate(user.created_at) : "—") + "</span></div>" +
          "</div>" +
        "</div>" +
        '<div class="card-foot row gap-2">' +
          '<button class="btn btn-danger btn-sm" id="signOutBtn">' + Icon("logout", 15) +
            '<span class="btn-label">Sign out</span></button>' +
        "</div>";

      // Bills — real, from the café server. Read-only: staff take payment.
      var Wallet = global.CXWallet;
      var history = UI.el("div", { class: "card" });
      history.innerHTML =
        '<div class="card-head"><h2>Your history</h2>' +
          '<div class="tabs tabs-sm" id="acctTabs">' +
            '<button data-tab="bills" aria-selected="true">Bills</button>' +
            '<button data-tab="orders" aria-selected="false">Orders</button>' +
          "</div>" +
        "</div>";
      var histBody = UI.el("div", { class: "card-body-flush" });
      histBody.appendChild(UI.skeletonRows(3));
      history.appendChild(histBody);

      // Which pane the card is showing. Both panes read data the account
      // already loads, so switching costs nothing extra.
      var acctTab = "bills";

      var STATUS_TONE = { OPEN: "warning", PARTIAL: "gaming", PAID: "online", VOID: "idle" };

      function paintOrderHistory(s) {
        UI.clear(histBody);

        if (!s.orders || !s.orders.length) {
          histBody.appendChild(UI.emptyState({
            icon: "fnb",
            title: "No orders yet",
            text: "Anything you order from the Food menu shows up here, with its progress."
          }));
          return;
        }

        var made = [];
        s.orders.forEach(function (order) {
          var block = UI.el("div", {
            style: { padding: "14px var(--s-5)", borderBottom: "1px solid var(--line-faint)" },
            dataset: { status: ORDER_TONE_ACCT[order.status] || "idle" }
          });
          block.innerHTML =
            '<div class="row-between">' +
              '<span style="min-width:0">' +
                '<span class="mono" style="font-size:13px;font-weight:650;display:block">' +
                  UI.esc(order.order_number) + "</span>" +
                '<span class="faint" style="font-size:11px">' +
                  UI.esc(order.items.map(function (i) { return i.quantity + "× " + i.product_name; }).join(", ")) +
                "</span></span>" +
              '<span style="font-size:15px;font-weight:750;white-space:nowrap">' +
                UI.esc(Wallet.money(order.total)) + "</span>" +
            "</div>";
          block.appendChild(accountOrderTrack(order.status));
          histBody.appendChild(block);
          made.push(block);
        });
        Motion.stagger(made, { step: 0.02, y: 6 });
      }

      function paintHistory(s) {
        if (acctTab === "orders") paintOrderHistory(s);
        else paintBills(s);
      }

      function paintBills(s) {
        UI.clear(histBody);

        if (s.billsError) {
          histBody.appendChild(UI.emptyState({
            icon: "alert", status: "error",
            title: "Couldn't load your bills",
            text: "The café server didn't respond. Please try again.",
            actions: [{ label: "Try again", icon: "refresh", onClick: function () { Wallet.loadBills(); } }]
          }));
          return;
        }
        if (!s.bills.length) {
          histBody.appendChild(UI.emptyState({
            icon: "billing",
            title: "No bills yet",
            text: "Your gaming time and anything you order will be itemised here."
          }));
          return;
        }

        var made = [];
        s.bills.forEach(function (bill) {
          var row = UI.el("div", {
            class: "kv",
            style: { padding: "14px var(--s-5)", borderBottom: "1px solid var(--line-faint)" },
            dataset: { status: STATUS_TONE[bill.status] || "idle" }
          });
          row.innerHTML =
            '<span style="min-width:0">' +
              '<span class="mono" style="font-size:13px;font-weight:650;display:block">' +
                UI.esc(bill.bill_number) + "</span>" +
              '<span class="faint" style="font-size:11px">' +
                UI.esc(new Date(bill.created_at).toLocaleString([], {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                })) + (bill.pc_name ? " · " + UI.esc(bill.pc_name) : "") + "</span>" +
            "</span>" +
            '<span style="text-align:right;white-space:nowrap">' +
              '<span style="font-size:15px;font-weight:750;font-variant-numeric:tabular-nums">' +
                UI.esc(Wallet.money(bill.total)) + "</span>" +
              '<span style="display:block;margin-top:3px"><span class="badge" data-status="' +
                (STATUS_TONE[bill.status] || "idle") + '">' +
                (bill.status === "PAID" ? "Paid"
                  : bill.status === "PARTIAL" ? "Part paid — " + Wallet.money(bill.balance_due) + " due"
                  : bill.status === "OPEN" ? Wallet.money(bill.balance_due) + " due"
                  : "Void") + "</span></span>" +
            "</span>";
          histBody.appendChild(row);
          made.push(row);
        });
        Motion.stagger(made, { step: 0.02, y: 6 });
      }

      var offBills = Wallet.on(function (s) {
        if (!history.isConnected) { offBills(); return; }
        paintHistory(s);
      });
      if (Wallet.state.bills.length) paintHistory(Wallet.state);
      Wallet.loadBills();

      UI.$$("#acctTabs button", history).forEach(function (btn) {
        btn.addEventListener("click", function () {
          acctTab = btn.dataset.tab;
          UI.$$("#acctTabs button", history).forEach(function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          paintHistory(Wallet.state);
        });
      });

      var col = UI.el("div", { class: "col", style: { gap: "var(--s-6)" } });
      col.appendChild(profile);
      col.appendChild(history);
      split.appendChild(col);

      var side = UI.el("div", { class: "col", style: { gap: "var(--s-5)" } });
      side.appendChild(stationCard());

      // Wallet summary, straight from the live balance.
      var Wallet = global.CXWallet;
      var walletBox = UI.el("div", { class: "card card-pad" });
      function paintWalletBox(s) {
        walletBox.innerHTML =
          '<div class="row-between" style="align-items:center">' +
            '<div><div class="session-label">XP Coin</div>' +
              '<div class="coin-inline" style="margin-top:6px">' +
                '<span style="font-size:30px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums">' +
                  (s.error ? "—" : s.balance === null ? "…" : UI.esc(Wallet.amount(s.balance))) + "</span>" +
                '<span style="font-size:13px;font-weight:750;letter-spacing:.08em;color:var(--accent-hot)">XP</span>' +
              "</div>" +
            "</div>" +
            (s.error
              ? '<span class="badge" data-status="warning">Unavailable</span>'
              : global.CXCoin(52, { detail: "plain", spin: true })) +
          "</div>" +
          '<button class="btn btn-outline btn-block" style="margin-top:var(--s-4)" id="walletOpen">' +
            Icon("billing", 16) + '<span class="btn-label">View wallet</span></button>';
        walletBox.querySelector("#walletOpen").addEventListener("click", function () { ctx.go("wallet"); });
      }
      paintWalletBox(Wallet.state);
      var offWallet = Wallet.on(function (s) {
        if (!walletBox.isConnected) { offWallet(); return; }
        paintWalletBox(s);
      });
      side.appendChild(walletBox);

      split.appendChild(side);

      view.appendChild(split);
      root.appendChild(view);

      profile.querySelector("#signOutBtn").addEventListener("click", function () {
        UI.confirm({
          title: "Sign out?",
          message: "You'll be returned to the sign-in screen on this station.",
          confirmLabel: "Sign out",
          variant: "danger"
        }).then(function (ok) { if (ok) Session.signOut(); });
      });

      Motion.stagger([col, side], { step: 0.06, y: 16 });
    }
  };
})(window);
