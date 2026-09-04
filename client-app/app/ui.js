/* ==========================================================================
   CafeXP — UI primitives
   Toasts · Modals · Drawers · Confirm · Tooltips · Segmented control ·
   small DOM/format helpers used by every page.
   ========================================================================== */
(function (global) {
  "use strict";

  var Motion = global.CXMotion;
  var Icon = global.CXIcon;

  /* ==========================================================================
     DOM + format helpers
     ========================================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "dataset") Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  /** Escape for safe interpolation into innerHTML strings. */
  function esc(v) {
    if (v == null) return "";
    return String(v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  /** hh:mm:ss from seconds. */
  function hms(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (h > 0 ? String(h).padStart(2, "0") + ":" : "") +
      String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  function relTime(date) {
    if (!date) return "—";
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d)) return "—";
    var diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 5) return "just now";
    if (diff < 60) return diff + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  function fmtDate(date) {
    if (!date) return "—";
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function initials(name) {
    if (!name) return "?";
    return String(name).trim().split(/\s+/).map(function (n) { return n.charAt(0).toUpperCase(); })
      .join("").slice(0, 2) || "?";
  }

  /*
   * An address as a person would read it.
   *
   * `customers.address` is JSONB and has held three different shapes over the
   * life of the app: a plain string, a `{ value: "..." }` wrapper (what the
   * server makes of a single-line address typed at sign-up), and a structured
   * object with line/city/state/country parts. Anything that just prints the
   * value ends up showing a customer `{"value":"Hyderabad"}` on their own
   * account page, so every shape is resolved to text here, once.
   *
   * Unknown keys are kept rather than dropped — an address with a field this
   * does not know about should still show that field, not silently lose it —
   * but ordered so the familiar parts read in the usual order.
   */
  var ADDRESS_ORDER = [
    "line1", "line2", "address", "street", "area", "locality",
    "city", "district", "state", "region", "postal_code", "postcode", "zip", "country"
  ];

  function fmtAddress(address) {
    if (address === null || address === undefined || address === "") return "—";
    if (typeof address === "string") return address.trim() || "—";
    if (typeof address !== "object") return String(address);

    if (Array.isArray(address)) {
      var flat = address.map(fmtAddress).filter(function (p) { return p && p !== "—"; });
      return flat.length ? flat.join(", ") : "—";
    }

    /* The single-line wrapper the server produces for a plain string. Unwrapped
       rather than labelled, because "value" is an implementation detail. */
    var keys = Object.keys(address);
    if (keys.length === 1 && keys[0] === "value") return fmtAddress(address.value);

    var known = ADDRESS_ORDER.filter(function (k) { return keys.indexOf(k) !== -1; });
    var rest = keys.filter(function (k) { return ADDRESS_ORDER.indexOf(k) === -1; }).sort();

    var parts = known.concat(rest).map(function (k) {
      var v = address[k];
      if (v === null || v === undefined) return "";
      if (typeof v === "object") return fmtAddress(v);
      return String(v).trim();
    }).filter(function (p) { return p && p !== "—"; });

    return parts.length ? parts.join(", ") : "—";
  }

  /* ==========================================================================
     TOASTS
     ========================================================================== */
  var toastStack = null;
  function stack() {
    if (!toastStack) {
      toastStack = el("div", { class: "toast-stack", id: "toastStack" });
      document.body.appendChild(toastStack);
    }
    return toastStack;
  }

  var TOAST_ICON = { ok: "check", error: "alert", warn: "alert", info: "info", accent: "sparkle" };

  /**
   * toast({ title, message, status, duration })
   * status: ok | error | warn | info | accent   (drives colour via data-status)
   */
  function toast(opts) {
    opts = typeof opts === "string" ? { title: opts } : (opts || {});
    var status = opts.status || "info";
    var duration = opts.duration == null ? (status === "error" ? 6500 : 3800) : opts.duration;

    var node = el("div", { class: "toast", dataset: { status: status }, role: "status" });
    node.innerHTML =
      '<span class="toast-icon">' + Icon(TOAST_ICON[status] || "info", 16) + "</span>" +
      '<div class="grow">' +
        '<div class="toast-title">' + esc(opts.title || "") + "</div>" +
        (opts.message ? '<div class="toast-msg">' + esc(opts.message) + "</div>" : "") +
      "</div>" +
      '<button class="toast-close" aria-label="Dismiss">' + Icon("close", 13) + "</button>" +
      (duration ? '<div class="toast-timer"></div>' : "");

    stack().appendChild(node);
    Motion.toastIn(node);

    var done = false;
    function dismiss() {
      if (done) return;
      done = true;
      settle([Motion.toastOut(node)], 260).then(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    }
    node.querySelector(".toast-close").addEventListener("click", dismiss);

    if (duration) {
      var bar = node.querySelector(".toast-timer");
      if (bar && Motion.enabled && Motion.lib) {
        Motion.lib.animate(bar, { width: ["100%", "0%"] }, { duration: duration / 1000, easing: "linear" });
      }
      var t = setTimeout(dismiss, duration);
      node.addEventListener("mouseenter", function () { clearTimeout(t); });
      node.addEventListener("mouseleave", function () { t = setTimeout(dismiss, 1200); });
    }
    return { dismiss: dismiss };
  }

  toast.ok    = function (title, message) { return toast({ title: title, message: message, status: "ok" }); };
  toast.error = function (title, message) { return toast({ title: title, message: message, status: "error" }); };
  toast.warn  = function (title, message) { return toast({ title: title, message: message, status: "warn" }); };
  toast.info  = function (title, message) { return toast({ title: title, message: message, status: "info" }); };

  /* ==========================================================================
     OVERLAY BASE (modal + drawer share the scrim & escape handling)
     ========================================================================== */
  var openLayers = [];

  /**
   * Resolve once the exit animations finish OR a deadline passes, whichever
   * comes first. Without this, an animation that never settles — a hidden
   * window, a dropped frame budget — would leave a dialog on screen with no
   * way to dismiss it.
   */
  function settle(work, ms) {
    return Promise.race([
      Promise.all(work.map(function (p) { return Promise.resolve(p); })).catch(function () {}),
      new Promise(function (resolve) { setTimeout(resolve, ms || 320); })
    ]);
  }

  function pushLayer(layer) {
    openLayers.push(layer);
    document.addEventListener("keydown", escHandler);
  }
  function popLayer(layer) {
    openLayers = openLayers.filter(function (l) { return l !== layer; });
    if (!openLayers.length) document.removeEventListener("keydown", escHandler);
  }
  function escHandler(e) {
    if (e.key !== "Escape" || !openLayers.length) return;
    var top = openLayers[openLayers.length - 1];
    if (top && top.dismissible !== false) { e.stopPropagation(); top.close(); }
  }

  function makeScrim(onClick) {
    var scrim = el("div", { class: "scrim" });
    scrim.addEventListener("click", onClick);
    document.body.appendChild(scrim);
    Motion.scrimIn(scrim);
    return scrim;
  }

  function focusFirst(root) {
    var target = root.querySelector("[data-autofocus]") ||
      root.querySelector("input:not([type=hidden]), select, textarea, button");
    if (target) setTimeout(function () { try { target.focus(); } catch (e) {} }, 40);
  }

  /* ==========================================================================
     MODAL
     ========================================================================== */
  /**
   * modal({ title, description, body (string|Node), size, actions:[{label,variant,onClick,keepOpen}],
   *         dismissible, onClose })
   */
  function modal(opts) {
    opts = opts || {};
    var layer = { dismissible: opts.dismissible !== false };

    var scrim = makeScrim(function () { if (layer.dismissible) layer.close(); });
    var node = el("div", {
      class: "modal" + (opts.size === "lg" ? " modal-lg" : opts.size === "xl" ? " modal-xl" : ""),
      role: "dialog",
      "aria-modal": "true"
    });

    var head = el("div", { class: "modal-head" }, [
      el("div", {}, [
        el("div", { class: "modal-title", text: opts.title || "" }),
        opts.description ? el("div", { class: "modal-desc", text: opts.description }) : null
      ]),
      layer.dismissible
        ? el("button", { class: "modal-close", "aria-label": "Close", html: Icon("close", 15), onClick: function () { layer.close(); } })
        : null
    ]);

    var body = el("div", { class: "modal-body" });
    if (typeof opts.body === "string") body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);

    node.appendChild(head);
    node.appendChild(body);

    if (opts.actions && opts.actions.length) {
      var foot = el("div", { class: "modal-foot" });
      opts.actions.forEach(function (a) {
        var btn = el("button", {
          class: "btn " + (a.variant ? "btn-" + a.variant : ""),
          html: (a.icon ? Icon(a.icon, 15) : "") + '<span class="btn-label">' + esc(a.label) + "</span>"
        });
        btn.addEventListener("click", function () {
          var result = a.onClick ? a.onClick({ body: body, node: node, close: function () { layer.close(); }, button: btn }) : true;
          if (result && typeof result.then === "function") {
            btn.dataset.busy = "true";
            result.then(function (r) {
              btn.dataset.busy = "false";
              if (r !== false && !a.keepOpen) layer.close();
            }).catch(function () { btn.dataset.busy = "false"; });
          } else if (result !== false && !a.keepOpen) {
            layer.close();
          }
        });
        foot.appendChild(btn);
      });
      node.appendChild(foot);
    }

    document.body.appendChild(node);
    Motion.modalIn(node);
    focusFirst(node);
    pushLayer(layer);

    layer.close = function () {
      if (layer.closed) return;
      layer.closed = true;
      popLayer(layer);
      settle([Motion.modalOut(node), Motion.scrimOut(scrim)]).then(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (opts.onClose) opts.onClose();
      });
    };
    layer.node = node;
    layer.body = body;
    return layer;
  }

  /** confirm({title, message, confirmLabel, variant}) -> Promise<boolean> */
  function confirmDialog(opts) {
    opts = typeof opts === "string" ? { message: opts } : (opts || {});
    return new Promise(function (resolve) {
      var settled = false;
      var m = modal({
        title: opts.title || "Are you sure?",
        body: '<div style="font-size:13px;line-height:1.6;color:var(--text-2)">' + esc(opts.message || "") + "</div>",
        actions: [
          { label: opts.cancelLabel || "Cancel", variant: "ghost", onClick: function () { settled = true; resolve(false); } },
          {
            label: opts.confirmLabel || "Confirm",
            variant: opts.variant || "primary",
            icon: opts.icon,
            onClick: function () { settled = true; resolve(true); }
          }
        ],
        onClose: function () { if (!settled) resolve(false); }
      });
      return m;
    });
  }

  /* ==========================================================================
     DRAWER
     ========================================================================== */
  /** drawer({ head (Node|string), body, foot, wide, onClose }) */
  function drawer(opts) {
    opts = opts || {};
    var layer = { dismissible: opts.dismissible !== false };

    var scrim = makeScrim(function () { if (layer.dismissible) layer.close(); });
    var node = el("div", {
      class: "drawer" + (opts.wide ? " drawer-wide" : ""),
      role: "dialog",
      "aria-modal": "true"
    });
    node.style.transform = "translateX(100%)";

    var head = el("div", { class: "drawer-head" });
    var body = el("div", { class: "drawer-body" });
    var foot = opts.foot != null ? el("div", { class: "drawer-foot" }) : null;

    function fill(target, content) {
      if (content == null) return;
      if (typeof content === "string") target.innerHTML = content;
      else target.appendChild(content);
    }
    fill(head, opts.head);
    fill(body, opts.body);
    if (foot) fill(foot, opts.foot);

    node.appendChild(head);
    node.appendChild(body);
    if (foot) node.appendChild(foot);

    document.body.appendChild(node);
    Motion.drawerIn(node);
    pushLayer(layer);

    layer.close = function () {
      if (layer.closed) return;
      layer.closed = true;
      popLayer(layer);
      settle([Motion.drawerOut(node), Motion.scrimOut(scrim)]).then(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (opts.onClose) opts.onClose();
      });
    };
    layer.node = node;
    layer.head = head;
    layer.body = body;
    layer.foot = foot;
    return layer;
  }

  /* ==========================================================================
     TOOLTIPS  (delegated; any element with [data-tip])
     ========================================================================== */
  var tipNode = null, tipTimer = null;

  function showTip(target) {
    var text = target.getAttribute("data-tip");
    if (!text) return;
    if (!tipNode) {
      tipNode = el("div", { class: "tip" });
      document.body.appendChild(tipNode);
    }
    tipNode.textContent = text;
    tipNode.style.opacity = "0";
    tipNode.style.display = "block";

    var r = target.getBoundingClientRect();
    var tr = tipNode.getBoundingClientRect();
    var top = r.top - tr.height - 8;
    var placeBelow = top < 8;
    if (placeBelow) top = r.bottom + 8;
    var left = Math.min(
      Math.max(8, r.left + r.width / 2 - tr.width / 2),
      window.innerWidth - tr.width - 8
    );
    tipNode.style.top = top + "px";
    tipNode.style.left = left + "px";
    Motion.animate(tipNode, { opacity: [0, 1], transform: [placeBelow ? "translateY(-3px)" : "translateY(3px)", "none"] },
      { duration: 0.13, easing: Motion.EASE.out });
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (tipNode) tipNode.style.display = "none";
  }
  document.addEventListener("mouseover", function (e) {
    var t = e.target.closest ? e.target.closest("[data-tip]") : null;
    if (!t) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () { showTip(t); }, 380);
  });
  document.addEventListener("mouseout", function (e) {
    if (e.target.closest && e.target.closest("[data-tip]")) hideTip();
  });
  document.addEventListener("click", hideTip, true);
  window.addEventListener("scroll", hideTip, true);

  /* ==========================================================================
     SEGMENTED CONTROL / CHIP GROUP
     ========================================================================== */
  /**
   * segmented(container, items, value, onChange)
   * items: [{ value, label }]
   */
  function segmented(container, items, value, onChange) {
    container.className = "segmented";
    container.innerHTML = '<span class="segmented-thumb"></span>';
    var thumb = container.firstChild;
    var buttons = items.map(function (it) {
      var b = el("button", {
        type: "button",
        text: it.label,
        "aria-selected": String(it.value === value),
        dataset: { value: it.value }
      });
      b.addEventListener("click", function () {
        if (b.getAttribute("aria-selected") === "true") return;
        buttons.forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
        Motion.moveThumb(thumb, b);
        onChange(it.value);
      });
      container.appendChild(b);
      return b;
    });
    var active = buttons.filter(function (b) { return b.getAttribute("aria-selected") === "true"; })[0] || buttons[0];
    // Defer: offsetLeft is only meaningful once laid out.
    requestAnimationFrame(function () { Motion.moveThumb(thumb, active); });
    return {
      set: function (v) {
        buttons.forEach(function (b) {
          var on = b.dataset.value === String(v);
          b.setAttribute("aria-selected", String(on));
          if (on) Motion.moveThumb(thumb, b);
        });
      }
    };
  }

  /* ==========================================================================
     SKELETON + STATE BLOCKS
     ========================================================================== */
  function skeletonCards(count, height) {
    var wrap = el("div", { class: "grid grid-stations" });
    for (var i = 0; i < (count || 8); i++) {
      wrap.appendChild(el("div", { class: "skel skel-card", style: height ? { height: height } : null }));
    }
    return wrap;
  }

  function skeletonRows(count) {
    var wrap = el("div", { class: "col gap-3", style: { padding: "var(--s-5)" } });
    for (var i = 0; i < (count || 5); i++) {
      wrap.appendChild(el("div", { class: "skel skel-line", style: { width: (55 + Math.random() * 40) + "%" } }));
    }
    return wrap;
  }

  /**
   * emptyState({ icon, status, title, text, actions:[{label,variant,icon,onClick}] })
   */
  function emptyState(opts) {
    opts = opts || {};
    var node = el("div", { class: "empty", dataset: { status: opts.status || "idle" } });
    node.innerHTML =
      '<div class="empty-icon">' + Icon(opts.icon || "info", 24) + "</div>" +
      '<div class="empty-title">' + esc(opts.title || "Nothing here yet") + "</div>" +
      (opts.text ? '<div class="empty-text">' + esc(opts.text) + "</div>" : "");
    if (opts.actions && opts.actions.length) {
      var row = el("div", { class: "empty-actions" });
      opts.actions.forEach(function (a) {
        row.appendChild(el("button", {
          class: "btn " + (a.variant ? "btn-" + a.variant : "btn-outline"),
          html: (a.icon ? Icon(a.icon, 15) : "") + '<span class="btn-label">' + esc(a.label) + "</span>",
          onClick: a.onClick
        }));
      });
      node.appendChild(row);
    }
    return node;
  }

  function errorState(message, onRetry) {
    return emptyState({
      icon: "alert",
      status: "error",
      title: "Something went wrong",
      text: message || "The request could not be completed.",
      actions: onRetry ? [{ label: "Try again", icon: "refresh", variant: "outline", onClick: onRetry }] : null
    });
  }

  /* ==========================================================================
     BUTTON BUSY HELPER
     ========================================================================== */
  /** Wrap an async action so the button shows a spinner and can't double-fire. */
  function withBusy(button, fn) {
    if (!button) return fn();
    if (button.dataset.busy === "true") return Promise.resolve();
    var original = button.innerHTML;
    button.dataset.busy = "true";
    button.innerHTML = '<span class="spinner"></span><span class="btn-label">' + (button.dataset.busyLabel || "Working") + "</span>";
    return Promise.resolve()
      .then(fn)
      .finally(function () {
        button.dataset.busy = "false";
        button.innerHTML = original;
      });
  }

  global.CXUI = {
    $: $, $$: $$, el: el, esc: esc, clear: clear,
    hms: hms, relTime: relTime, fmtDate: fmtDate, initials: initials,
    fmtAddress: fmtAddress,
    toast: toast, modal: modal, confirm: confirmDialog, drawer: drawer,
    segmented: segmented,
    skeletonCards: skeletonCards, skeletonRows: skeletonRows,
    emptyState: emptyState, errorState: errorState,
    withBusy: withBusy
  };
})(window);
