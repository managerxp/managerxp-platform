const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("statusText");
const statusCardEl = document.getElementById("statusCard");
const statusMessageEl = document.getElementById("statusMessage");
const logsEl = document.getElementById("logs");

window.api.onStatus((status) => {
  statusTextEl.textContent = status;
  
  if (status === "CONNECTED") {
    statusEl.className = "status-indicator";
    statusCardEl.className = "status-card connected";
    statusMessageEl.textContent = "✓ Successfully connected to server";
  } else {
    statusEl.className = "status-indicator";
    statusCardEl.className = "status-card disconnected";
    statusMessageEl.textContent = "⚠ Connection lost. Attempting to reconnect...";
  }
});

window.api.onLog((msg) => {
  const div = document.createElement("div");
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
});

