/* ==========================================================================
   CafeXP — Motion kit
   Thin wrapper over the vendored Motion One build (window.Motion).
   Every helper degrades to an instant, correct end-state if Motion is missing
   or the user prefers reduced motion, so no UI ever depends on animation.
   ========================================================================== */
(function (global) {
  "use strict";

  var M = global.Motion || null;
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var enabled = !!M && !reduced;

  /* ---------- Spring / easing presets ----------
     Kept deliberately quick: staff use this app all shift. */
  var SPRING = {
    snappy: { stiffness: 420, damping: 34, mass: 0.9 },
    soft:   { stiffness: 260, damping: 30, mass: 1 },
    firm:   { stiffness: 560, damping: 40, mass: 0.8 }
  };
  var EASE = {
    out: [0.22, 1, 0.36, 1],
    inOut: [0.65, 0, 0.35, 1]
  };

  function spring(cfg) {
    if (!M || !M.spring) return { duration: 0.28, easing: EASE.out };
    return { easing: M.spring(cfg || SPRING.snappy) };
  }

  /** Core animate. Falls back to setting the final style values directly. */
  function animate(el, keyframes, options) {
    if (!el) return null;
    if (!enabled) {
      applyFinal(el, keyframes);
      return null;
    }
    return M.animate(el, keyframes, options || {});
  }

  function applyFinal(el, keyframes) {
    var nodes = el instanceof global.Element ? [el] : Array.prototype.slice.call(el || []);
    nodes.forEach(function (node) {
      if (!node || !node.style) return;
      Object.keys(keyframes).forEach(function (prop) {
        var v = keyframes[prop];
        var last = Array.isArray(v) ? v[v.length - 1] : v;
        if (prop === "opacity") node.style.opacity = last;
        else if (prop === "transform") node.style.transform = last;
        else if (prop === "x") node.style.transform = "translateX(" + toPx(last) + ")";
        else if (prop === "y") node.style.transform = "translateY(" + toPx(last) + ")";
        else if (prop === "scale") node.style.transform = "scale(" + last + ")";
        else node.style[prop] = last;
      });
      // Neutralise leftover transforms once an element has settled.
      if (keyframes.y || keyframes.x || keyframes.scale) node.style.transform = "";
    });
  }
  function toPx(v) { return typeof v === "number" ? v + "px" : v; }

  /* ---------- Entrance patterns ---------- */

  /** Fade + lift, used for page content and panels. */
  function enter(el, opts) {
    opts = opts || {};
    return animate(el,
      { opacity: [0, 1], transform: ["translateY(" + (opts.y == null ? 8 : opts.y) + "px)", "none"] },
      { duration: opts.duration || 0.26, easing: EASE.out, delay: opts.delay || 0 }
    );
  }

  /** Staggered entrance for lists and card grids. Capped so long lists stay fast. */
  function stagger(nodes, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(nodes || []);
    if (!list.length) return;
    if (!enabled) { list.forEach(function (n) { n.style.opacity = 1; n.style.transform = ""; }); return; }
    var step = opts.step || 0.022;
    var maxDelay = opts.maxDelay == null ? 0.24 : opts.maxDelay;
    list.forEach(function (node, i) {
      M.animate(node,
        { opacity: [0, 1], transform: ["translateY(" + (opts.y == null ? 10 : opts.y) + "px) scale(.99)", "none"] },
        { duration: opts.duration || 0.3, easing: EASE.out, delay: Math.min(i * step, maxDelay) }
      );
    });
  }

  /** Exit for elements being removed; resolves when done. */
  function exit(el, opts) {
    opts = opts || {};
    if (!enabled || !el) return Promise.resolve();
    var a = M.animate(el,
      { opacity: [1, 0], transform: ["none", "translateY(" + (opts.y == null ? -6 : opts.y) + "px)"] },
      { duration: opts.duration || 0.16, easing: EASE.inOut }
    );
    return a.finished.catch(function () {});
  }

  /* ---------- Overlays ---------- */

  function scrimIn(el) {
    return animate(el, { opacity: [0, 1] }, { duration: 0.18, easing: EASE.out });
  }
  function scrimOut(el) {
    if (!enabled) { el.style.opacity = 0; return Promise.resolve(); }
    return M.animate(el, { opacity: [1, 0] }, { duration: 0.15, easing: EASE.inOut }).finished.catch(function () {});
  }

  function modalIn(el) {
    if (!enabled) { el.style.opacity = 1; return null; }
    return M.animate(el,
      { opacity: [0, 1], transform: ["translate(-50%,-50%) scale(.965)", "translate(-50%,-50%) scale(1)"] },
      spring(SPRING.snappy)
    );
  }
  function modalOut(el) {
    if (!enabled) return Promise.resolve();
    return M.animate(el,
      { opacity: [1, 0], transform: ["translate(-50%,-50%) scale(1)", "translate(-50%,-50%) scale(.975)"] },
      { duration: 0.14, easing: EASE.inOut }
    ).finished.catch(function () {});
  }

  function drawerIn(el) {
    if (!enabled) { el.style.transform = "none"; return null; }
    return M.animate(el, { transform: ["translateX(100%)", "translateX(0)"] }, spring(SPRING.snappy));
  }
  function drawerOut(el) {
    if (!enabled) return Promise.resolve();
    return M.animate(el, { transform: ["translateX(0)", "translateX(100%)"] },
      { duration: 0.2, easing: EASE.inOut }).finished.catch(function () {});
  }

  function toastIn(el) {
    if (!enabled) { el.style.opacity = 1; return null; }
    return M.animate(el,
      { opacity: [0, 1], transform: ["translateX(24px) scale(.97)", "none"] },
      spring(SPRING.snappy)
    );
  }
  function toastOut(el) {
    if (!enabled) return Promise.resolve();
    return M.animate(el,
      { opacity: [1, 0], transform: ["none", "translateX(24px)"] },
      { duration: 0.16, easing: EASE.inOut }
    ).finished.catch(function () {});
  }

  /* ---------- Value transitions ---------- */

  /**
   * Tween a numeric readout. Skipped for tiny deltas so idle dashboards
   * don't shimmer with pointless motion.
   */
  function countTo(el, to, opts) {
    if (!el) return;
    opts = opts || {};
    var from = parseFloat(String(el.dataset.value == null ? el.textContent : el.dataset.value).replace(/[^0-9.-]/g, "")) || 0;
    var decimals = opts.decimals || 0;
    var format = opts.format || function (v) { return v.toFixed(decimals); };
    el.dataset.value = to;

    if (!enabled || Math.abs(to - from) < (opts.threshold == null ? 0.001 : opts.threshold)) {
      el.textContent = format(to);
      return;
    }

    var duration = opts.duration || 0.55;
    var anim = M.animate(function (p) {
      el.textContent = format(from + (to - from) * p);
    }, { duration: duration, easing: EASE.out });

    // The driver above is the only thing writing the text, so if its frames
    // never run — a hidden window, a dropped frame budget — the element would
    // keep the stale value. Always land on the target.
    var settle = function () {
      if (Number(el.dataset.value) === to) el.textContent = format(to);
    };
    if (anim && anim.finished) anim.finished.then(settle).catch(settle);
    setTimeout(settle, duration * 1000 + 150);
  }

  /** Animate a .meter-fill to a percentage. */
  function meterTo(el, pct) {
    if (!el) return;
    var v = Math.max(0, Math.min(100, pct || 0));
    el.style.width = v + "%";     // CSS transition on .meter-fill handles the easing
  }

  /** Flash an element to acknowledge a state change (e.g. PC went online). */
  function pulse(el, color) {
    if (!enabled || !el) return;
    var c = color || "rgba(255,23,68,.45)";
    M.animate(el,
      { boxShadow: ["0 0 0 0 " + c, "0 0 0 10px transparent"] },
      { duration: 0.7, easing: EASE.out }
    );
  }

  /** Small nudge for invalid input / rejected action. */
  /*
   * Shake an element to say "no".
   *
   * The nudge is composed on top of whatever transform the element already
   * carries, rather than replacing it. A modal is centred with
   * `translate(-50%,-50%)`, so a bare `translateX(...)` here would overwrite
   * that and drop the dialog half its own width down and to the right — where
   * its buttons end up off the bottom of the screen. That is a refusal
   * animation making the dialog it is complaining about unusable.
   *
   * The computed transform is a matrix, which composes cleanly as a prefix and
   * is an empty string for the plain inputs most callers pass.
   */
  function shake(el) {
    if (!enabled || !el) return;

    var base = "";
    try {
      var current = window.getComputedStyle(el).transform;
      if (current && current !== "none") base = current + " ";
    } catch (e) { /* no computed style — shake from nothing */ }

    M.animate(el,
      {
        transform: [
          base + "translateX(0)",
          base + "translateX(-5px)",
          base + "translateX(4px)",
          base + "translateX(-2px)",
          base + "translateX(0)"
        ]
      },
      { duration: 0.32, easing: EASE.inOut }
    );
  }

  /** Slide the segmented-control thumb under the active button. */
  function moveThumb(thumb, target) {
    if (!thumb || !target) return;
    var parent = thumb.parentElement;
    var left = target.offsetLeft;
    var width = target.offsetWidth;
    if (!enabled || !parent) {
      thumb.style.left = left + "px";
      thumb.style.width = width + "px";
      return;
    }
    if (!thumb.style.width) {           // first placement: no travel animation
      thumb.style.left = left + "px";
      thumb.style.width = width + "px";
      return;
    }
    M.animate(thumb, { left: left + "px", width: width + "px" }, spring(SPRING.firm));
  }

  /** Expand/collapse height without a hard jump. */
  function expand(el, open) {
    if (!el) return;
    if (!enabled) { el.style.height = open ? "auto" : "0px"; el.style.overflow = open ? "" : "hidden"; return; }
    var h = el.scrollHeight;
    el.style.overflow = "hidden";
    if (open) {
      M.animate(el, { height: ["0px", h + "px"], opacity: [0, 1] }, { duration: 0.26, easing: EASE.out })
        .finished.then(function () { el.style.height = "auto"; el.style.overflow = ""; }).catch(function () {});
    } else {
      M.animate(el, { height: [h + "px", "0px"], opacity: [1, 0] }, { duration: 0.2, easing: EASE.inOut });
    }
  }

  global.CXMotion = {
    enabled: enabled,
    lib: M,
    SPRING: SPRING,
    EASE: EASE,
    spring: spring,
    animate: animate,
    enter: enter,
    exit: exit,
    stagger: stagger,
    scrimIn: scrimIn,
    scrimOut: scrimOut,
    modalIn: modalIn,
    modalOut: modalOut,
    drawerIn: drawerIn,
    drawerOut: drawerOut,
    toastIn: toastIn,
    toastOut: toastOut,
    countTo: countTo,
    meterTo: meterTo,
    pulse: pulse,
    shake: shake,
    moveThumb: moveThumb,
    expand: expand
  };
})(window);
