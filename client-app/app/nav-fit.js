/* ==========================================================================
   CafeXP Client — Nav fitting

   The nav has three regions competing for one row: the brand, the links, and
   the chips + window controls. Only the links can shrink, and their children
   cannot — so when the row is over-subscribed the links' box narrows while its
   contents keep their natural width and paint straight over the chips.

   This was previously handled with viewport media queries, which cannot work:
   the pressure is not the window width but the sum of the three regions, and
   two of those vary at runtime. A long station name, a five-figure coin
   balance and a long user name can each add 40-80px. The nav overlapped from
   ~1700px down while the first breakpoint sat at 1360px, leaving a 340px band
   where the nav was reliably broken on a perfectly ordinary window.

   So the ladder is driven by measurement instead. Space is surrendered one
   step at a time, cheapest first, until the links stop overflowing.
   ========================================================================== */
(function (global) {
  "use strict";

  var MAX_STEP = 4;

  var nav = null, links = null, brand = null;
  var applying = false;      // our own writes resize the nav; don't recurse
  var queued = false;

  /* A region whose contents are wider than the box it was given is about to
     paint outside it. That — not the window width — is the thing to react to. */
  function overflowing(el) {
    return !!el && el.scrollWidth > el.clientWidth + 1;
  }

  function fit() {
    if (!nav || !links) return;

    applying = true;
    try {
      for (var step = 0; step <= MAX_STEP; step++) {
        nav.setAttribute("data-fit", String(step));
        // Reading scrollWidth flushes layout, so the next iteration measures
        // the step we just applied rather than the previous one.
        if (!overflowing(links) && !overflowing(brand)) return;
      }
      // Still over-subscribed at the last step: the CSS lets the nav scroll
      // rather than clip, so the window controls stay reachable.
    } finally {
      applying = false;
    }
  }

  function schedule() {
    if (applying || queued) return;
    queued = true;

    var run = function () {
      if (!queued) return;      // whichever timer arrives first wins
      queued = false;
      fit();
    };

    /*
     * rAF batches the measurement with the next paint, which is what we want
     * — but it does not fire at all while the window is hidden, minimised or
     * occluded. Relying on it alone leaves `queued` set forever in exactly
     * that case, so the nav is measured once at startup and then never again:
     * a station launched minimised would restore with an overlapping nav and
     * no way to recover short of a resize. The timeout is the floor.
     */
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    setTimeout(run, 150);
  }

  function start() {
    nav = document.querySelector(".nav");
    if (!nav) return;
    links = nav.querySelector(".nav-links");
    brand = nav.querySelector(".nav-brand");
    if (!links) return;

    fit();

    if (global.ResizeObserver) new ResizeObserver(schedule).observe(nav);
    else global.addEventListener("resize", schedule);

    // The chips carry live text — station name, balance, signed-in user — and
    // the links are rendered after this script runs. Both change the arithmetic.
    if (global.MutationObserver) {
      new MutationObserver(schedule).observe(nav, {
        childList: true, subtree: true, characterData: true
      });
    }

    // Web fonts land after first paint and change every text measurement.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  global.CXNavFit = { refit: schedule };
})(window);
