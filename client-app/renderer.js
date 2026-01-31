const statusEl = document.getElementById("status");
const logsEl = document.getElementById("logs");

window.api.onStatus((status) => {
  statusEl.textContent = status;
  statusEl.className = status === "CONNECTED"
    ? "connected"
    : "disconnected";
});

window.api.onLog((msg) => {
  const div = document.createElement("div");
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
});
