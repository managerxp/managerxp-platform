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
   *   opts.detail   "full" (ring lettering) | "plain" (monogram only, small sizes)
   *   opts.spin     add the idle-spin class
   */
  function coin(size, opts) {
    opts = opts || {};
    var s = size || 40;
    // Ring lettering is illegible below ~56px, so drop it automatically.
    var detail = opts.detail || (s >= 56 ? "full" : "plain");
    var id = "xpc" + (++seq);

    var ring = detail === "full"
      ? '<path id="' + id + 'top" d="M 30 100 A 70 70 0 0 1 170 100" fill="none"/>' +
        '<path id="' + id + 'bot" d="M 34 100 A 66 66 0 0 0 166 100" fill="none"/>' +
        '<text class="xpc-ring" font-size="15" font-weight="700" letter-spacing="3.4" fill="url(#' + id + 'red)">' +
          '<textPath href="#' + id + 'top" startOffset="50%" text-anchor="middle">XP COIN</textPath></text>' +
        '<text class="xpc-ring" font-size="11.5" font-weight="600" letter-spacing="2.6" fill="#7d1524">' +
          '<textPath href="#' + id + 'bot" startOffset="50%" text-anchor="middle">EARN · REDEEM · GROW</textPath></text>' +
        '<circle cx="100" cy="100" r="60" fill="none" stroke="#521018" stroke-width="1.4"/>'
      : "";

    // Tick marks flanking the monogram, as on the reference coin.
    var ticks = "";
    if (detail === "full") {
      [-1, 1].forEach(function (dir) {
        for (var i = 0; i < 3; i++) {
          var x = 100 + dir * (46 + i * 6);
          ticks += '<rect x="' + (x - 1.4) + '" y="92" width="2.8" height="16" rx="1.4" fill="#8d1a2b"/>';
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
        '<linearGradient id="' + id + 'red" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#ff5c78"/>' +
          '<stop offset="46%" stop-color="#ff1744"/>' +
          '<stop offset="100%" stop-color="#a30c26"/>' +
        "</linearGradient>" +
        '<linearGradient id="' + id + 'rim" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="#ff4569"/>' +
          '<stop offset="40%" stop-color="#8c1122"/>' +
          '<stop offset="100%" stop-color="#ff1744"/>' +
        "</linearGradient>" +
      "</defs>" +

      // body + rim
      '<circle cx="100" cy="100" r="95" fill="url(#' + id + 'body)"/>' +
      '<circle cx="100" cy="100" r="95" fill="none" stroke="url(#' + id + 'rim)" stroke-width="5"/>' +
      '<circle cx="100" cy="100" r="86" fill="none" stroke="#3a0b13" stroke-width="1.6"/>' +
      '<circle cx="100" cy="100" r="72" fill="#0d0d12" opacity=".55"/>' +

      ring + ticks +

      // XP monogram, with an offset shadow copy for the struck-metal depth
      '<g font-family="Inter, Segoe UI, system-ui, sans-serif" font-weight="900" ' +
         'text-anchor="middle" font-size="72" letter-spacing="-4">' +
        '<text x="103" y="126" fill="#460910">XP</text>' +
        '<text x="100" y="123" fill="url(#' + id + 'red)">XP</text>' +
      "</g>" +

      // top-left specular sweep
      '<ellipse cx="72" cy="58" rx="46" ry="26" fill="#ffffff" opacity=".05" transform="rotate(-28 72 58)"/>' +
    "</svg>";
  }

  global.CXCoin = coin;
})(window);
