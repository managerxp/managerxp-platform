/* ==========================================================================
   CafeXP Admin — F&B / Products and Inventory
   Two pages: the catalogue customers order from (with a live kitchen queue),
   and the stock screen. Stock only ever moves through the inventory endpoints
   so the ledger stays complete.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  function coins(value) {
    var n = Number(value || 0);
    var whole = Math.round(n * 100) % 100 === 0;
    try {
      return new Intl.NumberFormat("en-IN", {
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2
      }).format(n);
    } catch (e) { return whole ? String(Math.round(n)) : n.toFixed(2); }
  }

  var STOCK_TONE = { ok: "online", low: "warning", out: "offline", untracked: "idle" };
  var STOCK_LABEL = { ok: "In stock", low: "Low", out: "Out of stock", untracked: "Untracked" };

  var ORDER_FLOW = ["PLACED", "CONFIRMED", "PREPARING", "READY", "DELIVERED"];
  var ORDER_TONE = {
    PLACED: "warning", CONFIRMED: "gaming", PREPARING: "gaming",
    READY: "online", DELIVERED: "idle", CANCELLED: "offline"
  };

  /* Shared across both pages so a stock change on one is visible on the other. */
  var categories = [];

  function loadCategories() {
    return Store.listProductCategories({})
      .then(function (b) { categories = b.data || []; return categories; })
      .catch(function () { return []; });
  }

  /* ==========================================================================
     PRODUCT FORM
     ========================================================================== */
  function productForm(existing, onSaved) {
    var isEdit = !!existing;
    var body = UI.el("div", { class: "col gap-4" });

    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="prName">Product name</label>' +
          '<input class="input" id="prName" placeholder="Chicken Burger" value="' +
            UI.esc(existing ? existing.product_name : "") + '" data-autofocus></div>' +
        '<div class="field"><label class="field-label" for="prSku">SKU</label>' +
          '<input class="input" id="prSku" placeholder="BRG-01" value="' +
            UI.esc(existing && existing.sku ? existing.sku : "") + '"></div>' +
      "</div>" +
      '<div class="field"><label class="field-label" for="prCategory">Category</label>' +
        '<select class="select" id="prCategory"><option value="">— None —</option>' +
          categories.map(function (c) {
            return '<option value="' + c.category_id + '"' +
              (existing && existing.category_id === c.category_id ? " selected" : "") + ">" +
              UI.esc(c.category_name) + " (" + c.kind + ")</option>";
          }).join("") +
        "</select></div>" +
      '<div class="field"><label class="field-label" for="prDesc">Description</label>' +
        '<input class="input" id="prDesc" placeholder="What the customer sees" value="' +
          UI.esc(existing && existing.description ? existing.description : "") + '"></div>' +
      '<div class="field"><label class="field-label" for="prImage">Image URL</label>' +
        '<input class="input" id="prImage" placeholder="https://…" value="' +
          UI.esc(existing && existing.image_url ? existing.image_url : "") + '"></div>' +
      '<div class="grid grid-3" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="prPrice">Price (XP)</label>' +
          '<input class="input" id="prPrice" type="number" min="0" step="0.01" value="' +
            UI.esc(existing ? existing.price : "") + '"></div>' +
        '<div class="field"><label class="field-label" for="prCost">Cost price</label>' +
          '<input class="input" id="prCost" type="number" min="0" step="0.01" value="' +
            UI.esc(existing && existing.cost_price !== null ? existing.cost_price : "") + '"></div>' +
        '<div class="field"><label class="field-label" for="prTax">Tax (%)</label>' +
          '<input class="input" id="prTax" type="number" min="0" max="100" step="0.5" value="' +
            UI.esc(existing ? existing.tax_percent : "0") + '"></div>' +
      "</div>" +
      '<label class="switch"><input type="checkbox" id="prTrack"' +
        (!existing || existing.track_stock ? " checked" : "") + '>' +
        '<span class="switch-track"></span><span style="font-size:13px">Track stock for this product</span></label>' +
      '<div class="grid grid-2" style="gap:var(--s-3)" id="prStockFields">' +
        (isEdit
          ? '<div class="field"><label class="field-label">Current stock</label>' +
            '<input class="input" value="' + UI.esc(existing.stock_quantity === null ? "—" : existing.stock_quantity) +
            '" disabled><div class="field-hint">Change it from Inventory so the ledger records why.</div></div>'
          : '<div class="field"><label class="field-label" for="prStock">Opening stock</label>' +
            '<input class="input" id="prStock" type="number" min="0" step="1" value="0"></div>') +
        '<div class="field"><label class="field-label" for="prThreshold">Low-stock warning at</label>' +
          '<input class="input" id="prThreshold" type="number" min="0" step="1" value="' +
            UI.esc(existing ? existing.low_stock_threshold : "5") + '"></div>' +
      "</div>" +
      '<label class="switch"><input type="checkbox" id="prAvailable"' +
        (!existing || existing.is_available ? " checked" : "") + '>' +
        '<span class="switch-track"></span><span style="font-size:13px">Show on the customer menu</span></label>';

    var dialog = UI.modal({
      title: isEdit ? "Edit product" : "Add product",
      description: isEdit ? existing.product_name : "Something customers can order from their station.",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isEdit ? "Save changes" : "Create product", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var payload = {
              product_name: ctx.body.querySelector("#prName").value.trim(),
              sku: ctx.body.querySelector("#prSku").value.trim() || null,
              category_id: ctx.body.querySelector("#prCategory").value || null,
              description: ctx.body.querySelector("#prDesc").value.trim() || null,
              image_url: ctx.body.querySelector("#prImage").value.trim() || null,
              price: Number(ctx.body.querySelector("#prPrice").value),
              cost_price: ctx.body.querySelector("#prCost").value === ""
                ? null : Number(ctx.body.querySelector("#prCost").value),
              tax_percent: Number(ctx.body.querySelector("#prTax").value) || 0,
              track_stock: ctx.body.querySelector("#prTrack").checked,
              low_stock_threshold: Number(ctx.body.querySelector("#prThreshold").value) || 0,
              is_available: ctx.body.querySelector("#prAvailable").checked
            };
            var openingField = ctx.body.querySelector("#prStock");
            if (openingField) payload.stock_quantity = Number(openingField.value) || 0;

            if (!payload.product_name || !Number.isFinite(payload.price) || payload.price < 0) {
              Motion.shake(ctx.node);
              UI.toast.warn("A name and a price of zero or more are required");
              return false;
            }

            var call = isEdit
              ? Store.updateProduct(existing.product_id, payload)
              : Store.createProduct(payload);

            return call
              .then(function (r) {
                UI.toast.ok(isEdit ? "Product updated" : "Product created", r.data.product_name);
                if (onSaved) onSaved();
                return true;
              })
              .catch(function (err) { UI.toast.error("Could not save", err.message); return false; });
          }
        }
      ]
    });

    // Hide the stock fields entirely when the product isn't tracked.
    var track = body.querySelector("#prTrack");
    var stockFields = body.querySelector("#prStockFields");
    function syncTrack() { stockFields.classList.toggle("hidden", !track.checked); }
    track.addEventListener("change", syncTrack);
    syncTrack();

    return dialog;
  }

  /* ==========================================================================
     CATEGORY MANAGER
     ========================================================================== */
  function categoryManager(onChanged) {
    var body = UI.el("div", { class: "col gap-4" });

    function paint() {
      UI.clear(body);

      var list = UI.el("div", { class: "card card-body-flush" });
      if (!categories.length) {
        list.appendChild(UI.emptyState({
          icon: "inventory", title: "No categories",
          text: "Categories group the menu for customers."
        }));
      } else {
        categories.forEach(function (c) {
          var row = UI.el("div", {
            class: "kv",
            style: { padding: "10px var(--s-4)", borderBottom: "1px solid var(--line-faint)" }
          });
          row.innerHTML =
            "<span><span style='font-size:13px;font-weight:600'>" + UI.esc(c.category_name) + "</span>" +
              ' <span class="badge badge-plain">' + UI.esc(c.kind) + "</span>" +
              "<span class='faint' style='display:block;font-size:11px'>" +
                (c.product_count || 0) + " product(s)</span></span>";
          var del = UI.el("button", {
            class: "btn btn-ghost btn-sm btn-icon", html: Icon("trash", 12), "data-tip": "Delete"
          });
          del.addEventListener("click", function () {
            Store.deleteProductCategory(c.category_id)
              .then(function () { UI.toast.ok("Category deleted", c.category_name); return loadCategories(); })
              .then(function () { paint(); if (onChanged) onChanged(); })
              .catch(function (e) { UI.toast.error("Could not delete", e.message); });
          });
          row.appendChild(del);
          list.appendChild(row);
        });
      }
      body.appendChild(list);

      var add = UI.el("div", { class: "card card-pad col gap-3" });
      add.innerHTML =
        "<div class='eyebrow'>Add a category</div>" +
        '<div class="grid grid-2" style="gap:var(--s-3)">' +
          '<div class="field"><input class="input" id="catName" placeholder="Desserts"></div>' +
          '<div class="field"><select class="select" id="catKind">' +
            '<option value="FNB">Food &amp; drink</option><option value="SHOP">Shop</option>' +
          "</select></div>" +
        "</div>";
      var addBtn = UI.el("button", {
        class: "btn btn-primary btn-block",
        html: Icon("plus", 15) + '<span class="btn-label">Add category</span>'
      });
      addBtn.addEventListener("click", function () {
        var name = add.querySelector("#catName").value.trim();
        if (!name) { Motion.shake(add.querySelector("#catName")); return; }
        Store.createProductCategory({ name: name, category_name: name, kind: add.querySelector("#catKind").value })
          .then(function () { UI.toast.ok("Category added", name); return loadCategories(); })
          .then(function () { paint(); if (onChanged) onChanged(); })
          .catch(function (e) { UI.toast.error("Could not add", e.message); });
      });
      add.appendChild(addBtn);
      body.appendChild(add);
    }

    paint();
    return UI.modal({
      title: "Categories",
      description: "How the menu is grouped for customers.",
      body: body,
      actions: [{ label: "Done", variant: "primary" }]
    });
  }

  /* ==========================================================================
     F&B PAGE
     ========================================================================== */
  var fnbRoot = null, products = [], orders = [], fnbLoading = false, fnbError = null;
  var fnbTab = "menu", kindFilter = "", searchQuery = "", searchTimer = null, orderTimer = null;

  function loadFnb() {
    fnbLoading = true; fnbError = null; renderFnb();
    return Promise.all([
      loadCategories(),
      Store.listProducts({ kind: kindFilter, search: searchQuery }),
      Store.listOrders({ active: "true" })
    ])
      .then(function (res) {
        products = res[1].data || [];
        orders = res[2].data || [];
        fnbLoading = false;
        renderFnb();
      })
      .catch(function (e) { fnbLoading = false; fnbError = e.message; renderFnb(); });
  }

  /** Only the order queue needs polling; the catalogue changes rarely. */
  function refreshOrders() {
    return Store.listOrders({ active: "true" })
      .then(function (r) {
        orders = r.data || [];
        if (fnbRoot) {
          var badge = fnbRoot.querySelector("#fnbOrderCount");
          if (badge) badge.textContent = orders.length;
          if (fnbTab === "orders") renderFnb();
        }
      })
      .catch(function () { /* the next tick tries again */ });
  }

  function renderFnb() {
    if (!fnbRoot) return;

    // Keep the tab badge honest on every render, not only on the poll.
    var badge = fnbRoot.querySelector("#fnbOrderCount");
    if (badge) badge.textContent = orders.length;

    var host = fnbRoot.querySelector("#fnbBody");
    if (!host) return;
    UI.clear(host);

    if (fnbLoading && !products.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (fnbError) { host.appendChild(UI.errorState(fnbError, loadFnb)); return; }

    if (fnbTab === "orders") { renderOrderQueue(host); return; }

    if (!products.length) {
      host.appendChild(UI.emptyState({
        icon: "fnb",
        title: searchQuery || kindFilter ? "No products match" : "No products yet",
        text: searchQuery || kindFilter
          ? "Nothing matches the current search and filter."
          : "Add what your café sells — customers see it on their station straight away.",
        actions: [{
          label: searchQuery || kindFilter ? "Clear filters" : "Add product",
          icon: searchQuery || kindFilter ? "close" : "plus",
          variant: "primary",
          onClick: function () {
            if (searchQuery || kindFilter) {
              searchQuery = ""; kindFilter = "";
              fnbRoot.querySelector("#fnbSearch").value = "";
              syncKindChips();
              loadFnb();
            } else productForm(null, loadFnb);
          }
        }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Product</th><th>Category</th><th class='td-num'>Price</th>" +
      "<th class='td-num'>Stock</th><th>On menu</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    products.forEach(function (p) {
      var tr = UI.el("tr", { dataset: { status: STOCK_TONE[p.stock_state] || "idle" } });
      tr.innerHTML =
        '<td><div class="row gap-3">' +
          '<span class="sw-icon" style="width:34px;height:34px"' +
            (p.image_url ? ' style="background-image:url(' + UI.esc(p.image_url) + ');background-size:cover"' : "") + ">" +
            (p.image_url ? "" : UI.esc(p.product_name.charAt(0).toUpperCase())) + "</span>" +
          "<div><strong>" + UI.esc(p.product_name) + "</strong>" +
            (p.sku ? '<div class="faint mono" style="font-size:10px">' + UI.esc(p.sku) + "</div>" : "") +
          "</div></div></td>" +
        "<td>" + (p.category_name
          ? UI.esc(p.category_name) + ' <span class="badge badge-plain">' + UI.esc(p.kind) + "</span>"
          : '<span class="faint">—</span>') + "</td>" +
        '<td class="td-num" style="font-weight:700">' + coins(p.price) + " XP</td>" +
        '<td class="td-num">' +
          (p.track_stock
            ? '<span style="font-weight:700">' + coins(p.stock_quantity) + "</span>" +
              ' <span class="badge">' + UI.esc(STOCK_LABEL[p.stock_state]) + "</span>"
            : '<span class="faint">Untracked</span>') + "</td>" +
        "<td>" + (p.orderable
          ? '<span class="badge" data-status="online">Yes</span>'
          : '<span class="badge" data-status="idle">' +
            (!p.is_available ? "Hidden" : p.stock_state === "out" ? "Out of stock" : "No") + "</span>") + "</td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");

      var toggle = UI.el("button", {
        class: "btn btn-sm btn-icon " + (p.is_available ? "btn-warn" : "btn-ok"),
        html: Icon(p.is_available ? "pause" : "check", 13),
        "data-tip": p.is_available ? "Hide from the menu" : "Show on the menu"
      });
      toggle.addEventListener("click", function () {
        Store.setProductAvailability(p.product_id, !p.is_available)
          .then(function (r) { UI.toast.ok(r.message, p.product_name); return loadFnb(); })
          .catch(function (e) { UI.toast.error("Could not update", e.message); });
      });

      var edit = UI.el("button", {
        class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit"
      });
      edit.addEventListener("click", function () { productForm(p, loadFnb); });

      actions.appendChild(toggle);
      actions.appendChild(edit);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  function renderOrderQueue(host) {
    if (!orders.length) {
      host.appendChild(UI.emptyState({
        icon: "fnb", status: "online",
        title: "Nothing in the queue",
        text: "Orders placed from a station appear here the moment they are sent."
      }));
      return;
    }

    var list = UI.el("div", { class: "col", style: { padding: "var(--s-5)", gap: "var(--s-4)" } });
    orders.forEach(function (order) {
      var card = UI.el("div", {
        class: "card card-pad col gap-3",
        dataset: { status: ORDER_TONE[order.status] || "idle" }
      });
      card.innerHTML =
        '<div class="row-between" style="align-items:flex-start">' +
          "<div><div class='row gap-3' style='align-items:center'>" +
            '<span class="mono" style="font-size:15px;font-weight:700">' + UI.esc(order.order_number) + "</span>" +
            '<span class="badge badge-lg">' + UI.esc(order.status) + "</span>" +
            (order.payment_status === "PAID"
              ? '<span class="badge" data-status="online">Paid</span>'
              : '<span class="badge" data-status="warning">Unpaid</span>') +
          "</div>" +
          '<div class="faint" style="font-size:12px;margin-top:4px">' +
            UI.esc(order.customer_name || "Guest") +
            (order.pc_name ? " · " + UI.esc(order.pc_name) : "") +
            " · " + UI.esc(new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) +
          "</div></div>" +
          '<div style="text-align:right"><div style="font-size:19px;font-weight:800">' +
            coins(order.total) + " XP</div></div>" +
        "</div>" +
        '<div class="col gap-1" style="padding-top:var(--s-3);border-top:1px solid var(--line-faint)">' +
          order.items.map(function (i) {
            return '<div class="kv" style="padding:4px 0"><span class="kv-key">' +
              i.quantity + " × " + UI.esc(i.product_name) + "</span>" +
              '<span class="kv-val">' + coins(i.amount) + " XP</span></div>";
          }).join("") +
          (order.note ? '<div class="notice" data-status="warning" style="margin-top:var(--s-3)">' +
            Icon("info", 16) + "<div>" + UI.esc(order.note) + "</div></div>" : "") +
        "</div>";

      var actions = UI.el("div", { class: "row gap-2 wrap", style: { marginTop: "var(--s-2)" } });
      var next = ORDER_FLOW[ORDER_FLOW.indexOf(order.status) + 1];
      if (next) {
        var advance = UI.el("button", {
          class: "btn btn-primary grow",
          html: Icon("chevronR", 15) + '<span class="btn-label">Mark ' + next.toLowerCase() + "</span>"
        });
        advance.addEventListener("click", function () {
          Store.setOrderStatus(order.order_id, next)
            .then(function (r) { UI.toast.ok(r.message, order.order_number); return refreshOrders(); })
            .catch(function (e) { UI.toast.error("Could not update", e.message); });
        });
        actions.appendChild(advance);
      }

      var cancel = UI.el("button", {
        class: "btn btn-danger", html: Icon("close", 15) + '<span class="btn-label">Cancel</span>'
      });
      cancel.addEventListener("click", function () {
        UI.confirm({
          title: "Cancel " + order.order_number + "?",
          message: "The stock goes back on the shelf. Any payment already taken is not refunded automatically.",
          confirmLabel: "Cancel order", variant: "danger"
        }).then(function (ok) {
          if (!ok) return;
          Store.setOrderStatus(order.order_id, "CANCELLED")
            .then(function (r) { UI.toast.ok(r.message); return refreshOrders(); })
            .catch(function (e) { UI.toast.error("Could not cancel", e.message); });
        });
      });
      actions.appendChild(cancel);

      card.appendChild(actions);
      list.appendChild(card);
    });

    host.appendChild(list);
    Motion.stagger(list.children, { step: 0.04, y: 10 });
  }

  function syncKindChips() {
    if (!fnbRoot) return;
    UI.$$("#fnbKinds .chip", fnbRoot).forEach(function (chip) {
      chip.setAttribute("aria-pressed", String(chip.dataset.kind === kindFilter));
    });
  }

  global.CXPages.fnb = {
    title: "F&B / Products",
    subtitle: "What customers can order",

    mount: function (root) {
      fnbRoot = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">F&amp;B / Products</div>' +
          '<div class="page-sub">Anything on the menu appears on the customer\'s station immediately.</div>' +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="fnbCats">' + Icon("inventory", 15) + '<span class="btn-label">Categories</span></button>' +
          '<button class="btn btn-outline" id="fnbRefresh">' + Icon("refresh", 15) + '<span class="btn-label">Refresh</span></button>' +
          '<button class="btn btn-primary" id="fnbAdd">' + Icon("plus", 15) + '<span class="btn-label">Add product</span></button>' +
        "</div></div>" +
        '<div class="tabs" id="fnbTabs" style="margin-bottom:var(--s-5)">' +
          '<button data-tab="menu" aria-selected="true">Catalogue</button>' +
          '<button data-tab="orders" aria-selected="false">Order queue ' +
            '<span class="chip-count" id="fnbOrderCount">0</span></button>' +
        "</div>" +
        '<div class="toolbar" id="fnbToolbar">' +
          '<div class="search" style="width:280px">' + Icon("search", 15) +
            '<input class="input" id="fnbSearch" type="search" placeholder="Search name or SKU…" autocomplete="off"></div>' +
          '<div class="row gap-2" id="fnbKinds">' +
            '<button class="chip" data-kind="" aria-pressed="true">All</button>' +
            '<button class="chip" data-kind="FNB">Food &amp; drink</button>' +
            '<button class="chip" data-kind="SHOP">Shop</button>' +
          "</div>" +
        "</div>" +
        '<div class="card card-body-flush" id="fnbBody"></div>';
      root.appendChild(page);

      page.querySelector("#fnbAdd").addEventListener("click", function () { productForm(null, loadFnb); });
      page.querySelector("#fnbCats").addEventListener("click", function () { categoryManager(loadFnb); });
      var rb = page.querySelector("#fnbRefresh");
      rb.addEventListener("click", function () { UI.withBusy(rb, function () { return loadFnb(); }); });

      var search = page.querySelector("#fnbSearch");
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { searchQuery = search.value.trim(); loadFnb(); }, 250);
      });

      UI.$$("#fnbKinds .chip", page).forEach(function (chip) {
        chip.addEventListener("click", function () {
          kindFilter = chip.dataset.kind;
          syncKindChips();
          loadFnb();
        });
      });

      UI.$$("#fnbTabs button", page).forEach(function (btn) {
        btn.addEventListener("click", function () {
          fnbTab = btn.dataset.tab;
          UI.$$("#fnbTabs button", page).forEach(function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          // The order queue has its own filters, so hide the catalogue toolbar.
          page.querySelector("#fnbToolbar").classList.toggle("hidden", fnbTab === "orders");
          renderFnb();
        });
      });

      loadFnb();
      // Kitchen orders arrive while staff are looking at this page.
      orderTimer = setInterval(refreshOrders, 15000);
    },

    unmount: function () {
      clearTimeout(searchTimer);
      clearInterval(orderTimer);
      orderTimer = null;
      fnbRoot = null;
    }
  };

  /* ==========================================================================
     INVENTORY PAGE
     ========================================================================== */
  var invRoot = null, invRows = [], invSummary = null, invLoading = false, invError = null;
  var invFilter = "all", invTimer = null, invQuery = "";

  function loadInventory() {
    invLoading = true; invError = null; renderInventory();
    return Promise.all([
      Store.listProducts({ search: invQuery, low_stock: invFilter === "low" ? "true" : "" }),
      Store.inventorySummary()
    ])
      .then(function (res) {
        invRows = (res[0].data || []).filter(function (p) {
          if (!p.track_stock) return invFilter === "all";
          if (invFilter === "out") return p.stock_state === "out";
          return true;
        });
        invSummary = res[1];
        invLoading = false;
        renderInventory();
      })
      .catch(function (e) { invLoading = false; invError = e.message; renderInventory(); });
  }

  function adjustDialog(product, onDone) {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="card card-pad col gap-1" style="background:var(--bg-inset)">' +
        '<div class="kv"><span class="kv-key">Product</span><span class="kv-val">' +
          UI.esc(product.product_name) + "</span></div>" +
        '<div class="kv"><span class="kv-key">On the shelf</span>' +
          '<span class="kv-val" style="font-size:18px;font-weight:750">' +
          coins(product.stock_quantity) + "</span></div>" +
      "</div>" +
      '<div class="segmented" id="adjDir" style="width:100%">' +
        '<button type="button" data-dir="in" aria-selected="true" style="flex:1">Add stock</button>' +
        '<button type="button" data-dir="out" aria-selected="false" style="flex:1">Remove stock</button>' +
      "</div>" +
      '<div class="field"><label class="field-label field-req" for="adjQty">Quantity</label>' +
        '<input class="input" id="adjQty" type="number" min="1" step="1" value="1" data-autofocus></div>' +
      '<div class="field"><label class="field-label" for="adjNote">Reason</label>' +
        '<input class="input" id="adjNote" placeholder="Weekly delivery, breakage, stock count…"></div>' +
      '<div class="notice" data-status="accent" id="adjPreview"></div>';

    var direction = "in";

    var dialog = UI.modal({
      title: "Adjust stock",
      description: product.product_name,
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Apply", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var qty = Number(ctx.body.querySelector("#adjQty").value);
            if (!qty || qty <= 0) {
              Motion.shake(ctx.body.querySelector("#adjQty"));
              UI.toast.warn("Quantity must be greater than zero");
              return false;
            }
            return Store.adjustStock(product.product_id, {
              direction: direction,
              quantity: qty,
              reason: direction === "in" ? "restock" : "adjustment",
              note: ctx.body.querySelector("#adjNote").value.trim() || null
            })
              .then(function (r) {
                UI.toast.ok(r.message, product.product_name + " → " + coins(r.data.stock_quantity));
                if (onDone) onDone();
                return true;
              })
              .catch(function (err) { UI.toast.error("Could not adjust", err.message); return false; });
          }
        }
      ]
    });

    var qtyInput = body.querySelector("#adjQty");
    var preview = body.querySelector("#adjPreview");

    function refresh() {
      var qty = Number(qtyInput.value) || 0;
      var current = Number(product.stock_quantity);
      var next = direction === "in" ? current + qty : current - qty;
      if (next < 0) {
        preview.setAttribute("data-status", "offline");
        preview.innerHTML = Icon("alert", 16) +
          "<div>Only <strong>" + coins(current) + "</strong> on the shelf — you cannot remove " + coins(qty) + ".</div>";
        return;
      }
      preview.setAttribute("data-status", next <= Number(product.low_stock_threshold) ? "warning" : "accent");
      preview.innerHTML = Icon(next <= Number(product.low_stock_threshold) ? "alert" : "check", 16) +
        "<div>New count: <strong>" + coins(next) + "</strong>" +
        (next <= Number(product.low_stock_threshold) ? " — at or below the low-stock warning." : ".") + "</div>";
    }

    UI.$$("#adjDir button", body).forEach(function (btn) {
      btn.addEventListener("click", function () {
        direction = btn.dataset.dir;
        UI.$$("#adjDir button", body).forEach(function (b) {
          b.setAttribute("aria-selected", String(b === btn));
        });
        refresh();
      });
    });
    qtyInput.addEventListener("input", refresh);
    refresh();
    return dialog;
  }

  function movementsDialog(product) {
    var body = UI.el("div", {});
    body.appendChild(UI.skeletonRows(4));

    var dialog = UI.modal({
      title: "Stock history",
      description: product.product_name,
      size: "lg",
      body: body,
      actions: [{ label: "Close", variant: "ghost" }]
    });

    Store.stockMovements(product.product_id)
      .then(function (rows) {
        UI.clear(body);
        if (!rows.length) {
          body.appendChild(UI.emptyState({
            icon: "inventory", title: "No movements", text: "Nothing has moved yet."
          }));
          return;
        }
        var table = UI.el("table", { class: "tbl" });
        table.innerHTML = "<thead><tr><th>When</th><th>Change</th><th class='td-num'>After</th>" +
          "<th>Reason</th><th>By</th></tr></thead>";
        var tbody = UI.el("tbody");
        rows.forEach(function (m) {
          var tr = UI.el("tr", { dataset: { status: m.direction === "in" ? "online" : "accent" } });
          tr.innerHTML =
            "<td>" + UI.esc(new Date(m.created_at).toLocaleString([], {
              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
            })) + "</td>" +
            '<td style="color:var(--st);font-weight:700">' +
              (m.direction === "in" ? "+" : "−") + coins(m.quantity) + "</td>" +
            '<td class="td-num">' + coins(m.stock_after) + "</td>" +
            "<td>" + UI.esc(m.reason) + (m.note ? ' <span class="faint">· ' + UI.esc(m.note) + "</span>" : "") + "</td>" +
            '<td class="faint" style="font-size:11px">' + UI.esc(m.performed_by || "—") + "</td>";
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        var wrap = UI.el("div", { class: "table-wrap" });
        wrap.appendChild(table);
        body.appendChild(wrap);
      })
      .catch(function (err) {
        UI.clear(body);
        body.appendChild(UI.errorState(err.message));
      });

    return dialog;
  }

  function renderInventory() {
    if (!invRoot) return;

    if (invSummary) {
      var s = invRoot.querySelector("#invSummary");
      if (s) {
        Motion.countTo(s.querySelector("[data-sum=tracked]"), invSummary.tracked);
        Motion.countTo(s.querySelector("[data-sum=low]"), invSummary.low_stock);
        Motion.countTo(s.querySelector("[data-sum=out]"), invSummary.out_of_stock);
        s.querySelector("[data-sum=value]").textContent = coins(invSummary.stock_value);
      }
    }

    var host = invRoot.querySelector("#invTable");
    if (!host) return;
    UI.clear(host);

    if (invLoading && !invRows.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (invError) { host.appendChild(UI.errorState(invError, loadInventory)); return; }

    if (!invRows.length) {
      host.appendChild(UI.emptyState({
        icon: "inventory",
        status: invFilter === "all" ? "idle" : "online",
        title: invFilter === "low" ? "Nothing running low"
          : invFilter === "out" ? "Nothing out of stock"
          : "No tracked products",
        text: invFilter === "all"
          ? "Add a product with stock tracking to see it here."
          : "Everything is comfortably in stock."
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Product</th><th>Category</th><th class='td-num'>On shelf</th>" +
      "<th class='td-num'>Warn at</th><th class='td-num'>Value</th><th>State</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    invRows.forEach(function (p) {
      var tr = UI.el("tr", { dataset: { status: STOCK_TONE[p.stock_state] || "idle" } });
      var value = p.track_stock && p.cost_price ? Number(p.stock_quantity) * Number(p.cost_price) : null;
      tr.innerHTML =
        "<td><strong>" + UI.esc(p.product_name) + "</strong>" +
          (p.sku ? '<div class="faint mono" style="font-size:10px">' + UI.esc(p.sku) + "</div>" : "") + "</td>" +
        "<td>" + UI.esc(p.category_name || "—") + "</td>" +
        '<td class="td-num" style="font-weight:700;font-size:15px">' +
          (p.track_stock ? coins(p.stock_quantity) : '<span class="faint">—</span>') + "</td>" +
        '<td class="td-num faint">' + (p.track_stock ? coins(p.low_stock_threshold) : "—") + "</td>" +
        '<td class="td-num">' + (value === null ? '<span class="faint">—</span>' : coins(value) + " XP") + "</td>" +
        '<td><span class="badge">' + UI.esc(STOCK_LABEL[p.stock_state]) + "</span></td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");
      if (p.track_stock) {
        var adjust = UI.el("button", {
          class: "btn btn-primary btn-sm",
          html: Icon("plus", 13) + '<span class="btn-label">Adjust</span>'
        });
        adjust.addEventListener("click", function () { adjustDialog(p, loadInventory); });

        var history = UI.el("button", {
          class: "btn btn-outline btn-sm btn-icon", html: Icon("logs", 13), "data-tip": "Stock history"
        });
        history.addEventListener("click", function () { movementsDialog(p); });

        actions.appendChild(adjust);
        actions.appendChild(history);
      }
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  global.CXPages.inventory = {
    title: "Inventory",
    subtitle: "Stock levels and movement",

    mount: function (root) {
      invRoot = root;
      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Inventory</div>' +
          '<div class="page-sub">Every change is recorded, so a count can always be explained.</div>' +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="invRefresh">' + Icon("refresh", 15) + '<span class="btn-label">Refresh</span></button>' +
        "</div></div>" +

        '<div class="grid grid-kpi" id="invSummary" style="margin-bottom:var(--s-5)">' +
          '<div class="stat stat-accent" data-status="accent">' +
            '<div class="stat-label">' + Icon("inventory", 13) + "Tracked</div>" +
            '<div class="stat-value" data-sum="tracked">0</div>' +
            '<div class="stat-foot">products with stock counts</div></div>' +
          '<div class="stat stat-accent" data-status="warning">' +
            '<div class="stat-label">' + Icon("alert", 13) + "Running low</div>" +
            '<div class="stat-value" data-sum="low">0</div>' +
            '<div class="stat-foot">at or below the warning level</div></div>' +
          '<div class="stat stat-accent" data-status="offline">' +
            '<div class="stat-label">' + Icon("close", 13) + "Out of stock</div>" +
            '<div class="stat-value" data-sum="out">0</div>' +
            '<div class="stat-foot">not orderable right now</div></div>' +
          '<div class="stat stat-accent" data-status="online">' +
            '<div class="stat-label">' + Icon("billing", 13) + "Stock value</div>" +
            '<div class="stat-value" data-sum="value">0</div>' +
            '<div class="stat-foot">at cost price</div></div>' +
        "</div>" +

        '<div class="toolbar">' +
          '<div class="search" style="width:280px">' + Icon("search", 15) +
            '<input class="input" id="invSearch" type="search" placeholder="Search product…" autocomplete="off"></div>' +
          '<div class="row gap-2" id="invFilters">' +
            '<button class="chip" data-filter="all" aria-pressed="true" data-status="accent">All</button>' +
            '<button class="chip" data-filter="low" data-status="warning">Running low</button>' +
            '<button class="chip" data-filter="out" data-status="offline">Out of stock</button>' +
          "</div>" +
        "</div>" +
        '<div class="card card-body-flush" id="invTable"></div>';
      root.appendChild(page);

      var rb = page.querySelector("#invRefresh");
      rb.addEventListener("click", function () { UI.withBusy(rb, function () { return loadInventory(); }); });

      var search = page.querySelector("#invSearch");
      search.addEventListener("input", function () {
        clearTimeout(invTimer);
        invTimer = setTimeout(function () { invQuery = search.value.trim(); loadInventory(); }, 250);
      });

      UI.$$("#invFilters .chip", page).forEach(function (chip) {
        chip.addEventListener("click", function () {
          invFilter = chip.dataset.filter;
          UI.$$("#invFilters .chip", page).forEach(function (c) {
            c.setAttribute("aria-pressed", String(c === chip));
          });
          loadInventory();
        });
      });

      loadInventory();
    },

    unmount: function () {
      clearTimeout(invTimer);
      invRoot = null;
    }
  };
})(window);
