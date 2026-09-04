/* ==========================================================================
   CafeXP — Icon set
   Inline 24x24 stroke icons (Lucide-style geometry, hand-inlined so the app
   keeps zero runtime dependencies). Usage: CXIcon("floor", 18)
   ========================================================================== */
(function (global) {
  "use strict";

  var P = {
    dashboard:  '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    floor:      '<rect x="2" y="4" width="9" height="7" rx="1.5"/><rect x="13" y="4" width="9" height="7" rx="1.5"/><rect x="2" y="13" width="9" height="7" rx="1.5"/><rect x="13" y="13" width="9" height="7" rx="1.5"/>',
    monitor:    '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    pc:         '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 9v6M10 12h4M15 9v2"/>',
    sessions:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    customers:  '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    billing:    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    games:      '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="5"/>',
    fnb:        '<path d="M18 8h1a3 3 0 0 1 0 6h-1"/><path d="M2 8h16v5a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6z"/><path d="M6 1v3M10 1v3M14 1v3"/>',
    inventory:  '<path d="M21 8V21H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><path d="M10 12h4"/>',
    packages:   '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7.3 12 12l8.7-4.7M12 12v10"/>',
    membership: '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M5 17c.7-2 2.2-3 4-3s3.3 1 4 3M15 9h4M15 13h4"/>',
    reservations:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
    staff:      '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    reports:    '<path d="M3 3v18h18"/><path d="M7 15l4-5 3.5 3L21 6"/>',
    telemetry:  '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    devices:    '<rect x="3" y="4" width="13" height="10" rx="2"/><rect x="17" y="9" width="5" height="11" rx="1.5"/><path d="M6 20h6M9 14v6"/>',
    bell:       '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    audit:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
    settings:   '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    logs:       '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5"/>',
    plan:       '<path d="M12 2l2.4 6.2 6.6.3-5.2 4 1.9 6.4L12 15.5 6.3 18.9l1.9-6.4-5.2-4 6.6-.3z"/>',
    search:     '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    plus:       '<path d="M12 5v14M5 12h14"/>',
    close:      '<path d="M18 6 6 18M6 6l12 12"/>',
    chevronL:   '<path d="m15 18-6-6 6-6"/>',
    chevronR:   '<path d="m9 18 6-6-6-6"/>',
    chevronD:   '<path d="m6 9 6 6 6-6"/>',
    refresh:    '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    play:       '<path d="M7 4.5v15l13-7.5z"/>',
    pause:      '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    stop:       '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    power:      '<path d="M12 3v9"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    link:       '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    unlink:     '<path d="m18.8 13.2 1.5-1.5a5 5 0 0 0-7-7l-1.5 1.5M5.2 10.8 3.7 12.3a5 5 0 0 0 7 7l1.5-1.5M2 2l20 20"/>',
    check:      '<path d="M20 6 9 17l-5-5"/>',
    alert:      '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    info:       '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    trash:      '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    edit:       '<path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    download:   '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    clock:      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    wifi:       '<path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="M2 9a15 15 0 0 1 20 0"/>',
    wifiOff:    '<path d="M2 2l20 20"/><path d="M8.5 16a5 5 0 0 1 6-.8"/><path d="M12 20h.01"/><path d="M5 12.5a10 10 0 0 1 4-2.4"/><path d="M2 9a15 15 0 0 1 5.5-3.5"/><path d="M16.7 10.6A10 10 0 0 1 19 12.5"/>',
    radar:      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 19 5"/>',
    logout:     '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    filter:     '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    grid:       '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    list:       '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    panel:      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
    cpu:        '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    construction:'<rect x="2" y="6" width="20" height="8" rx="1"/><path d="M17 14v7M7 14v7M6 6l3 8M14 6l3 8"/>',
    external:   '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
    copy:       '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    menu:       '<path d="M3 6h18M3 12h18M3 18h18"/>',
    sparkle:    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
    volume:     '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    volumeMute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M16 9l6 6M22 9l-6 6"/>',
    help:       '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'
  };

  function icon(name, size, cls) {
    var d = P[name] || P.info;
    var s = size || 18;
    return '<svg class="' + (cls || "") + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + d + '</svg>';
  }

  icon.has = function (name) { return !!P[name]; };
  global.CXIcon = icon;
})(window);
