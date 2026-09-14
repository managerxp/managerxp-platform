/* ==========================================================================
   CafeXP — XP Coin mark
   Inline SVG so it stays crisp from a 16px nav chip to a 4K hero, costs no
   network request, and can be recoloured by CSS. Each instance gets its own
   gradient ids because ids are document-global.
   ========================================================================== */
(function (global) {
  "use strict";

  var seq = 0;

  /**
   * coin(size, opts)
   *   size          px, default 40
   *   opts.spin     add the idle-spin class
   *
   * Just the "XP" monogram — no ring lettering. Depth comes from a beveled
   * rim (a bright arc over a dark one, not one flat stroke), a concave inner
   * dish, and a grounding drop shadow, not from text.
   */
  function coin(size, opts) {
    opts = opts || {};
    var s = size || 40;
    var id = "xpc" + (++seq);

    // Tick marks flanking the monogram, as on the reference coin — noise at
    // nav-chip sizes, so only drawn once the coin is big enough to read them.
    var showTicks = s >= 40;
    var ticks = "";
    if (showTicks) {
      [-1, 1].forEach(function (dir) {
        for (var i = 0; i < 3; i++) {
          var x = 100 + dir * (46 + i * 6);
          ticks += '<rect x="' + (x - 1.4) + '" y="92" width="2.8" height="16" rx="1.4" fill="url(#' + id + 'gold)"/>';
        }
      });
    }

    return '' +
    '<svg class="xp-coin' + (opts.spin ? " xp-coin-spin" : "") + '" width="' + s + '" height="' + s + '" ' +
         'viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      "<defs>" +
        '<radialGradient id="' + id + 'body" cx="36%" cy="28%" r="82%">' +
          '<stop offset="0%" stop-color="#2b2b33"/>' +
          '<stop offset="52%" stop-color="#141419"/>' +
          '<stop offset="100%" stop-color="#08080c"/>' +
        "</radialGradient>" +
        // Gold — the rim, the monogram and the ticks. The whole coin, now
        // that nothing on it is red ring lettering.
        '<linearGradient id="' + id + 'gold" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#fff3c4"/>' +
          '<stop offset="45%" stop-color="#f0b937"/>' +
          '<stop offset="100%" stop-color="#b5820f"/>' +
        "</linearGradient>" +
        // Rim bevel: a light source from the upper-left, so the metal reads
        // as curved rather than a flat ring of one colour.
        '<linearGradient id="' + id + 'rimHi" x1="0" y1="1" x2="0" y2="0">' +
          '<stop offset="0%" stop-color="#c8940f"/>' +
          '<stop offset="100%" stop-color="#fff6d6"/>' +
        "</linearGradient>" +
        '<linearGradient id="' + id + 'rimSh" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#8a5f08"/>' +
          '<stop offset="100%" stop-color="#3a2604"/>' +
        "</linearGradient>" +
        // The dish the monogram sits in — darkest at its own rim, lighter
        // toward the upper-left where the same light source would reach in.
        '<radialGradient id="' + id + 'dish" cx="38%" cy="30%" r="75%">' +
          '<stop offset="0%" stop-color="#1c1c22"/>' +
          '<stop offset="70%" stop-color="#0d0d12"/>' +
          '<stop offset="100%" stop-color="#020203"/>' +
        "</radialGradient>" +
      "</defs>" +

      // Drop shadow — grounds the coin and, by only peeking out at the
      // bottom once the body circle covers it, implies the rim has real
      // thickness rather than being a flat disc.
      '<ellipse cx="100" cy="107" rx="92" ry="94" fill="#000" opacity=".24"/>' +

      // body
      '<circle cx="100" cy="100" r="95" fill="url(#' + id + 'body)"/>' +

      // beveled rim — a bright arc over a dark one, not one flat stroke
      '<path d="M 5 100 A 95 95 0 0 1 195 100" fill="none" stroke="url(#' + id + 'rimHi)" stroke-width="7" stroke-linecap="round"/>' +
      '<path d="M 5 100 A 95 95 0 0 0 195 100" fill="none" stroke="url(#' + id + 'rimSh)" stroke-width="7" stroke-linecap="round"/>' +

      // concave inner dish
      '<circle cx="100" cy="100" r="86" fill="none" stroke="#4a3607" stroke-width="1.6"/>' +
      '<circle cx="100" cy="100" r="72" fill="url(#' + id + 'dish)"/>' +
      // the dish's own rim catching the light, same side as the outer bevel
      '<path d="M 33 76 A 72 72 0 0 1 167 76" fill="none" stroke="#fff6d6" stroke-width="1.2" opacity=".18"/>' +

      ticks +

      // XP monogram — an offset shadow copy plus a thin bright edge on the
      // front copy, so the letters read as struck/raised metal.
      '<g font-family="Inter, Segoe UI, system-ui, sans-serif" font-weight="900" ' +
         'text-anchor="middle" font-size="72" letter-spacing="-4">' +
        '<text x="103" y="127" fill="#020203">XP</text>' +
        '<text x="100" y="123" fill="url(#' + id + 'gold)" stroke="#fff6d6" stroke-width=".6" stroke-opacity=".4">XP</text>' +
      "</g>" +

      // top-left specular sweep
      '<ellipse cx="72" cy="58" rx="46" ry="26" fill="#ffffff" opacity=".07" transform="rotate(-28 72 58)"/>' +
    "</svg>";
  }

  global.CXCoin = coin;
})(window);
