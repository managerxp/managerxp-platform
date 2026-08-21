/* ==========================================================================
   Receipt template

   The café's own identity on the bill they hand a customer: logo, trading
   name, address, tax registration, and what the tax is called and charged at.

   Built as an editor beside a live preview rather than a form with a "preview"
   button, because every field here is visual — the only way to know whether an
   address block is too long or a logo too tall is to see it against the
   receipt while typing.

   The tax rate set here is not a display setting: the backend reads it when it
   recalculates a bill, so changing it changes what customers are charged. The
   editor says so plainly rather than letting that be discovered.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var settings = {};
  var dirty = {};
  var loading = true;
  var saving = false;

  /* Blocks the café can turn off. Kept as a list rather than a boolean each,
     so adding one later does not mean another settings key. */
  var BLOCKS = [
    { id: "logo",       label: "Logo" },
    { id: "address",    label: "Address" },
    { id: "phone",      label: "Phone & email" },
    { id: "tax_number", label: "Tax number" },
    { id: "cashier",    label: "Served by" },
    { id: "customer",   label: "Customer name" },
    { id: "footer",     label: "Footer line" }
  ];

  var WIDTHS = [
    { id: "58mm", label: "58 mm", hint: "Small thermal roll" },
    { id: "80mm", label: "80 mm", hint: "Standard thermal roll" },
    { id: "a4",   label: "A4",    hint: "Full page invoice" }
  ];

  function val(key, fallback) {
    if (dirty[key] !== undefined) return dirty[key];
    return settings[key] !== undefined && settings[key] !== null ? settings[key] : (fallback || "");
  }
  function set(key, value) { dirty[key] = value; paintPreview(); paintSaveBar(); }
  function isOn(key) { return String(val(key, "false")) === "true"; }

  function shownBlocks() {
    return String(val("billing.receipt_show", "")).split(",")
      .map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function blockOn(id) { return shownBlocks().indexOf(id) !== -1; }
  function toggleBlock(id, on) {
    var list = shownBlocks().filter(function (b) { return b !== id; });
    if (on) list.push(id);
    set("billing.receipt_show", list.join(","));
  }

  /* ==========================================================================
     PREVIEW

     Rendered from a sample bill, not a real one — a café setting this up for
     the first time has nothing to preview, and a real bill would change under
     them as the till is used.
     ========================================================================== */
  var SAMPLE = {
    bill_number: "CX-000128",
    created_at: new Date(),
    customer_name: "Priya Nair",
    contact_phone: "98765 00011",
    created_by: "Rahul",
    items: [
      { description: "PS5 · 1 Hour", quantity: 1, amount: 180 },
      { description: "Coca Cola", quantity: 2, amount: 100 },
      { description: "Gaming T-Shirt", quantity: 1, amount: 799 }
    ]
  };

  function computeSample() {
    var subtotal = SAMPLE.items.reduce(function (a, i) { return a + i.amount; }, 0);
    var discount = 0;
    var taxable = subtotal - discount;
    var percent = Number(val("billing.tax_percent", 0)) || 0;
    var enabled = isOn("billing.tax_enabled") && percent > 0;
    var inclusive = isOn("billing.tax_inclusive");

    var tax = 0, total = taxable;
    if (enabled && inclusive) {
      // Mirrors the server exactly; a preview that computed tax differently
      // from the till would be worse than no preview.
      tax = taxable - taxable / (1 + percent / 100);
      total = taxable;
    } else if (enabled) {
      tax = taxable * percent / 100;
      total = taxable + tax;
    }
    return { subtotal: subtotal, discount: discount, tax: tax, total: total,
             enabled: enabled, inclusive: inclusive, percent: percent };
  }

  function money(n) { return Number(n || 0).toFixed(2); }

  function paintPreview() {
    var host = rootEl && rootEl.querySelector("#rtPreview");
    if (!host) return;

    var t = computeSample();
    var logo = val("billing.logo", "");
    var name = val("billing.business_name", "").trim() || "Your café name";
    var label = val("billing.tax_label", "GST").trim() || "GST";

    host.className = "receipt-paper rt-" + val("billing.receipt_width", "80mm");
    host.innerHTML =
      (blockOn("logo") && logo
        ? '<img class="rt-logo" src="' + UI.esc(logo) + '" alt="">'
        : "") +
      '<div class="rt-brand">' + UI.esc(name) + "</div>" +
      (val("billing.receipt_header_note")
        ? '<div class="rt-note">' + UI.esc(val("billing.receipt_header_note")) + "</div>" : "") +
      (blockOn("address") && val("billing.address")
        ? '<div class="rt-meta">' + UI.esc(val("billing.address")) + "</div>" : "") +
      (blockOn("phone") && (val("billing.phone") || val("billing.email"))
        ? '<div class="rt-meta">' +
            UI.esc([val("billing.phone"), val("billing.email")].filter(Boolean).join(" · ")) +
          "</div>" : "") +
      (blockOn("tax_number") && val("billing.tax_number")
        ? '<div class="rt-meta">' + UI.esc(label) + "IN " + UI.esc(val("billing.tax_number")) + "</div>" : "") +

      '<div class="rt-rule"></div>' +
      '<div class="rt-meta rt-left">' + UI.esc(SAMPLE.bill_number) + "</div>" +
      '<div class="rt-meta rt-left">' + SAMPLE.created_at.toLocaleString() + "</div>" +
      (blockOn("customer")
        ? '<div class="rt-meta rt-left">' + UI.esc(SAMPLE.customer_name) +
          " · " + UI.esc(SAMPLE.contact_phone) + "</div>" : "") +
      (blockOn("cashier")
        ? '<div class="rt-meta rt-left">Served by ' + UI.esc(SAMPLE.created_by) + "</div>" : "") +
      '<div class="rt-rule"></div>' +

      SAMPLE.items.map(function (i) {
        return '<div class="rt-line"><span>' + UI.esc(i.description) +
          (i.quantity > 1 ? " ×" + i.quantity : "") + "</span><span>" + money(i.amount) + "</span></div>";
      }).join("") +

      '<div class="rt-rule"></div>' +
      '<div class="rt-line"><span>Subtotal</span><span>' + money(t.subtotal) + "</span></div>" +
      (t.enabled
        ? '<div class="rt-line"><span>' + UI.esc(label) + " " + t.percent + "%" +
          (t.inclusive ? " (included)" : "") + "</span><span>" + money(t.tax) + "</span></div>"
        : "") +
      '<div class="rt-line rt-total"><span>Total</span><span>' + money(t.total) + "</span></div>" +

      (blockOn("footer") && val("billing.receipt_footer")
        ? '<div class="rt-foot">' + UI.esc(val("billing.receipt_footer")) + "</div>" : "");
  }

  /* ==========================================================================
     EDITOR
     ========================================================================== */
  function field(key, label, opts) {
    opts = opts || {};
    var wrap = UI.el("div", { class: "field" });
    var id = "rt-" + key.replace(/\./g, "-");
    wrap.innerHTML =
      '<label class="field-label" for="' + id + '">' + UI.esc(label) + "</label>" +
      (opts.textarea
        ? '<textarea class="input" id="' + id + '" rows="2"></textarea>'
        : '<input class="input" id="' + id + '" type="' + (opts.type || "text") + '"' +
          (opts.min !== undefined ? ' min="' + opts.min + '"' : "") +
          (opts.max !== undefined ? ' max="' + opts.max + '"' : "") +
          (opts.step ? ' step="' + opts.step + '"' : "") +
          ' placeholder="' + UI.esc(opts.placeholder || "") + '">') +
      (opts.hint ? '<div class="field-hint">' + UI.esc(opts.hint) + "</div>" : "");

    var input = wrap.querySelector("input, textarea");
    input.value = val(key, "");
    input.addEventListener("input", function () { set(key, input.value); });
    return wrap;
  }

  function logoField() {
    var wrap = UI.el("div", { class: "field" });
    wrap.innerHTML =
      '<label class="field-label" for="rtLogo">Logo</label>' +
      '<div class="rt-logo-row">' +
        '<div class="rt-logo-box" id="rtLogoBox"></div>' +
        '<div class="col gap-2">' +
          '<input type="file" id="rtLogo" accept="image/png,image/jpeg,image/svg+xml" class="hidden">' +
          '<button class="btn btn-outline btn-sm" type="button" id="rtLogoPick">Choose image</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" id="rtLogoClear">Remove</button>' +
        "</div>" +
      "</div>" +
      '<div class="field-hint">PNG, JPEG or SVG. Kept small — a thermal printer renders about 200px wide.</div>';

    function paintBox() {
      var box = wrap.querySelector("#rtLogoBox");
      var current = val("billing.logo", "");
      box.innerHTML = current
        ? '<img src="' + UI.esc(current) + '" alt="Current logo">'
        : '<span class="faint">No logo</span>';
    }
    paintBox();

    var file = wrap.querySelector("#rtLogo");
    wrap.querySelector("#rtLogoPick").addEventListener("click", function () { file.click(); });
    wrap.querySelector("#rtLogoClear").addEventListener("click", function () {
      set("billing.logo", "");
      paintBox();
    });

    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f) return;

      /* Stored as a data URI in a settings row, so it has to stay small. A
         2 MB photo would bloat every settings read for every page in the
         console, and no thermal printer can use the detail anyway. */
      if (f.size > 400 * 1024) {
        UI.toast.warn("That image is too large", "Use one under 400 KB — a receipt logo needs very little.");
        file.value = "";
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        set("billing.logo", String(reader.result));
        paintBox();
      };
      reader.readAsDataURL(f);
    });

    return wrap;
  }

  function toggle(key, label, hint) {
    var row = UI.el("label", { class: "check-row" });
    row.innerHTML =
      '<input type="checkbox" class="check">' +
      "<span><strong>" + UI.esc(label) + "</strong>" +
      (hint ? '<span class="faint block">' + UI.esc(hint) + "</span>" : "") + "</span>";
    var box = row.querySelector("input");
    box.checked = isOn(key);
    box.addEventListener("change", function () { set(key, String(box.checked)); paintTaxFields(); });
    return row;
  }

  function paintTaxFields() {
    var host = rootEl && rootEl.querySelector("#rtTaxFields");
    if (!host) return;
    host.classList.toggle("hidden", !isOn("billing.tax_enabled"));
  }

  function paintSaveBar() {
    var bar = rootEl && rootEl.querySelector("#rtSave");
    if (!bar) return;
    var count = Object.keys(dirty).length;
    bar.classList.toggle("hidden", count === 0);
    var label = bar.querySelector(".rt-save-count");
    if (label) label.textContent = count + " unsaved change" + (count === 1 ? "" : "s");
  }

  function save() {
    var keys = Object.keys(dirty);
    if (!keys.length || saving) return;
    saving = true;

    /* Sequential. Each is a separate settings write, and firing eight at once
       against one settings cache is how you get a half-applied template. */
    var chain = Promise.resolve();
    keys.forEach(function (k) {
      chain = chain.then(function () { return Store.setSetting(k, dirty[k]); });
    });

    chain
      .then(function () {
        keys.forEach(function (k) { settings[k] = dirty[k]; });
        dirty = {};
        saving = false;
        paintSaveBar();
        UI.toast.ok("Template saved", "New bills print with these details.");
      })
      .catch(function (err) {
        saving = false;
        UI.toast.err("Could not save", err.message);
      });
  }

  function load() {
    loading = true;
    return Store.getSettings("billing")
      .then(function (rows) {
        settings = {};
        (rows || []).forEach(function (r) { settings[r.setting_key] = r.setting_value; });
        loading = false;
        render();
      })
      .catch(function (err) {
        loading = false;
        if (rootEl) {
          UI.clear(rootEl.querySelector("#rtBody"));
          rootEl.querySelector("#rtBody").appendChild(UI.errorState(err.message));
        }
      });
  }

  function render() {
    var body = rootEl && rootEl.querySelector("#rtBody");
    if (!body) return;
    UI.clear(body);

    if (loading) { body.appendChild(UI.skeletonCards(2)); return; }

    var grid = UI.el("div", { class: "rt-layout" });

    /* ---- editor column ---- */
    var editor = UI.el("div", { class: "col gap-5" });

    var identity = UI.el("section", { class: "card card-pad col gap-4" });
    identity.innerHTML = '<div class="card-head"><h3 class="card-title">Your café</h3></div>';
    identity.appendChild(logoField());
    identity.appendChild(field("billing.business_name", "Trading name",
      { placeholder: "Riverside Gaming Café",
        hint: "Printed at the top. Blank falls back to the name on your subscription." }));
    identity.appendChild(field("billing.receipt_header_note", "Tagline",
      { placeholder: "Play. Eat. Repeat." }));
    identity.appendChild(field("billing.address", "Address", { textarea: true }));
    identity.appendChild(field("billing.phone", "Phone", { placeholder: "98765 00011" }));
    identity.appendChild(field("billing.email", "Email", { type: "email" }));
    editor.appendChild(identity);

    var tax = UI.el("section", { class: "card card-pad col gap-4" });
    tax.innerHTML = '<div class="card-head"><h3 class="card-title">Tax</h3></div>' +
      '<div class="notice" data-status="warning">' + Icon("alert", 15) +
      "<div>This is not a print setting. The rate below is applied when a bill is " +
      "calculated, so changing it changes what customers are charged.</div></div>";
    tax.appendChild(toggle("billing.tax_enabled", "Charge tax on bills",
      "Leave off if you are not registered."));

    var taxFields = UI.el("div", { class: "col gap-4", id: "rtTaxFields" });
    taxFields.appendChild(field("billing.tax_label", "What it is called",
      { placeholder: "GST", hint: "GST, VAT, Sales Tax — printed on the receipt line." }));
    taxFields.appendChild(field("billing.tax_percent", "Rate %",
      { type: "number", min: 0, max: 100, step: "0.01", placeholder: "18",
        hint: "Charged on the subtotal after any discount." }));
    taxFields.appendChild(field("billing.tax_number", "Registration number",
      { placeholder: "29ABCDE1234F1Z5" }));
    taxFields.appendChild(toggle("billing.tax_inclusive", "Prices already include tax",
      "The total stays the same; the receipt shows how much of it was tax."));
    tax.appendChild(taxFields);
    editor.appendChild(tax);

    var layout = UI.el("section", { class: "card card-pad col gap-4" });
    layout.innerHTML = '<div class="card-head"><h3 class="card-title">Layout</h3></div>' +
      '<div class="field"><label class="field-label">Paper width</label>' +
      '<div class="seg" id="rtWidth">' +
        WIDTHS.map(function (w) {
          return '<button type="button" class="seg-btn" data-w="' + w.id + '" data-tip="' +
            UI.esc(w.hint) + '">' + UI.esc(w.label) + "</button>";
        }).join("") +
      "</div></div>";

    layout.querySelectorAll("[data-w]").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.w === val("billing.receipt_width", "80mm"));
      b.addEventListener("click", function () {
        set("billing.receipt_width", b.dataset.w);
        layout.querySelectorAll("[data-w]").forEach(function (x) {
          x.classList.toggle("is-active", x === b);
        });
      });
    });

    var blocks = UI.el("div", { class: "field" });
    blocks.innerHTML = '<label class="field-label">Show on the receipt</label>' +
      '<div class="rt-blocks" id="rtBlocks"></div>';
    var blockHost = blocks.querySelector("#rtBlocks");
    BLOCKS.forEach(function (b) {
      var chip = UI.el("button", { class: "chip", type: "button", text: b.label });
      chip.setAttribute("aria-pressed", String(blockOn(b.id)));
      chip.addEventListener("click", function () {
        var on = !blockOn(b.id);
        toggleBlock(b.id, on);
        chip.setAttribute("aria-pressed", String(on));
      });
      blockHost.appendChild(chip);
    });
    layout.appendChild(blocks);
    layout.appendChild(field("billing.receipt_footer", "Footer line",
      { placeholder: "Thank you for playing" }));
    editor.appendChild(layout);

    grid.appendChild(editor);

    /* ---- preview column ---- */
    var preview = UI.el("div", { class: "rt-preview-col" });
    preview.innerHTML =
      '<div class="rt-preview-head">' +
        '<span class="eyebrow">Preview</span>' +
        '<button class="btn btn-outline btn-sm" type="button" id="rtPrint">' +
          Icon("download", 14) + '<span class="btn-label">Test print</span></button>' +
      "</div>" +
      '<div class="receipt-paper" id="rtPreview"></div>' +
      '<p class="faint rt-preview-note">Sample figures. Real bills use their own lines and totals.</p>';
    grid.appendChild(preview);

    body.appendChild(grid);

    preview.querySelector("#rtPrint").addEventListener("click", function () {
      var node = rootEl.querySelector("#rtPreview");
      var w = window.open("", "_blank", "width=420,height=640");
      if (!w) { UI.toast.warn("The print window was blocked"); return; }
      w.document.write(
        '<html><head><title>Test print</title><style>' +
        "body{font-family:ui-monospace,monospace;font-size:12px;margin:12px;color:#000;background:#fff}" +
        ".rt-line{display:flex;justify-content:space-between;margin:2px 0}" +
        ".rt-total{font-weight:700;font-size:14px;margin-top:4px}" +
        ".rt-brand{font-size:16px;font-weight:800;text-align:center;margin-bottom:2px}" +
        ".rt-meta,.rt-note{text-align:center;font-size:11px;color:#333}" +
        ".rt-left{text-align:left}" +
        ".rt-rule{border-top:1px dashed #999;margin:8px 0}" +
        ".rt-logo{display:block;max-width:180px;max-height:70px;margin:0 auto 6px}" +
        ".rt-foot{text-align:center;margin-top:10px;font-size:11px}" +
        "</style></head><body>" + node.innerHTML + "</body></html>"
      );
      w.document.close();
      w.focus();
      w.print();
    });

    paintTaxFields();
    paintPreview();
    paintSaveBar();
    Motion.enter(grid, { y: 10, duration: 0.2 });
  }

  global.CXPages["receipt-template"] = {
    title: "Receipt template",
    subtitle: "What your customers see on the bill",

    mount: function (root) {
      rootEl = root;
      dirty = {};

      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Receipt template</div>' +
          '<div class="page-sub">Your logo, name and tax details, and how the printed bill is laid out.</div>' +
        "</div></div>" +
        '<div class="rt-savebar hidden" id="rtSave">' +
          '<span class="rt-save-count"></span>' +
          '<button class="btn btn-primary btn-sm" type="button" id="rtSaveBtn">Save changes</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" id="rtDiscard">Discard</button>' +
        "</div>" +
        '<div id="rtBody"></div>';
      root.appendChild(page);

      page.querySelector("#rtSaveBtn").addEventListener("click", save);
      page.querySelector("#rtDiscard").addEventListener("click", function () {
        dirty = {};
        render();
      });

      load();
    },

    unmount: function () { rootEl = null; dirty = {}; }
  };
})(window);
