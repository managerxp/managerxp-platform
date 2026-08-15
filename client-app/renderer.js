/* ==========================================================================
   CafeXP Client — Connection screen
   Same IPC channels as before (status, pc-name, log); presentation only.
   ========================================================================== */
(function () {
  "use strict";

  var Motion = window.CXMotion;

  var orb = document.getElementById("connOrb");
  var dot = document.getElementById("connDot");
  var head = document.getElementById("connHead");
  var text = document.getElementById("connText");
  var logsEl = document.getElementById("logs");
  var clientIdValue = document.getElementById("clientIdValue");

  var COPY = {
    CONNECTED: {
      status: "online",
      head: "Connected to the café server",
      text: "This station is online. Getting your welcome screen ready…"
    },
    DISCONNECTED: {
      status: "offline",
      head: "Waiting for the café server",
      text: "This station can't reach the CafeXP server. It will keep trying — please let the staff know if this persists."
    }
  };

  function paint(status) {
    var copy = COPY[status] || COPY.DISCONNECTED;
    orb.setAttribute("data-status", copy.status);
    dot.setAttribute("data-status", copy.status);
    dot.classList.toggle("dot-live", copy.status === "online");
    head.textContent = copy.head;
    text.textContent = copy.text;
    if (Motion) Motion.enter(head, { y: 6, duration: 0.22 });
  }

  window.api.onStatus(paint);
  if (window.api.getStatus) window.api.getStatus(paint);

  window.api.onPcName(function (name) {
    clientIdValue.textContent = name;
  });
  if (window.api.getPcName) {
    window.api.getPcName(function (name) {
      if (name) clientIdValue.textContent = name;
    });
  }

  window.api.onLog(function (msg) {
    var line = document.createElement("div");
    line.textContent = "[" + new Date().toLocaleTimeString([], { hour12: false }) + "] " + msg;
    logsEl.appendChild(line);
    while (logsEl.childNodes.length > 200) logsEl.removeChild(logsEl.firstChild);
    logsEl.scrollTop = logsEl.scrollHeight;
  });
})();
