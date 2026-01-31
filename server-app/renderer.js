const logsEl = document.getElementById("logs");
const clientsEl = document.getElementById("clients");
const appsContainer = document.getElementById("apps-container");
const selectedClientEl = document.getElementById("selected-client");

let currentClients = [];
let selectedClient = null;
let clientApps = {};

window.api.onLog((msg) => {
  const div = document.createElement("div");
  div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logsEl.appendChild(div);
  logsEl.scrollTop = logsEl.scrollHeight;
});

window.api.onClients((clients) => {
  currentClients = clients;
  renderClients();
});

window.api.onAppsUpdated((data) => {
  clientApps[data.simId] = data.apps;
  if (selectedClient === data.simId) {
    renderApps(data.apps);
  }
});

function renderClients() {
  if (currentClients.length === 0) {
    clientsEl.innerHTML = "None";
    return;
  }

  clientsEl.innerHTML = "";
  currentClients.forEach((clientId) => {
    const item = document.createElement("div");
    item.className = "client-item";
    if (clientId === selectedClient) {
      item.classList.add("selected");
    }

    const nameSpan = document.createElement("span");
    nameSpan.textContent = clientId;

    const actions = document.createElement("div");
    actions.className = "client-actions";

    const viewBtn = document.createElement("button");
    viewBtn.textContent = "View Apps";
    viewBtn.onclick = () => selectClient(clientId);

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.onclick = () => refreshClientApps(clientId);

    actions.appendChild(viewBtn);
    actions.appendChild(refreshBtn);

    item.appendChild(nameSpan);
    item.appendChild(actions);
    clientsEl.appendChild(item);
  });
}

async function selectClient(clientId) {
  selectedClient = clientId;
  selectedClientEl.textContent = `(${clientId})`;
  renderClients();

  const apps = await window.api.getClientApps(clientId);
  clientApps[clientId] = apps;
  renderApps(apps);
}

async function refreshClientApps(clientId) {
  await window.api.refreshApps(clientId);
}

function renderApps(apps) {
  appsContainer.innerHTML = "";

  if (!apps || apps.length === 0) {
    appsContainer.innerHTML = '<div class="no-apps">No applications found</div>';
    return;
  }

  apps.forEach((app) => {
    const item = document.createElement("div");
    item.className = "app-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "app-name";
    nameSpan.textContent = app.name;

    const versionSpan = document.createElement("span");
    versionSpan.className = "app-version";
    versionSpan.textContent = app.version || "";

    const launchBtn = document.createElement("button");
    launchBtn.className = "launch-btn";
    launchBtn.textContent = "Launch";
    launchBtn.disabled = !app.launch;
    launchBtn.onclick = () => launchApp(app);

    item.appendChild(nameSpan);
    if (app.version) {
      item.appendChild(versionSpan);
    }
    item.appendChild(launchBtn);

    appsContainer.appendChild(item);
  });
}

async function launchApp(app) {
  if (!selectedClient || !app.launch) return;

  const success = await window.api.launchApp({
    simId: selectedClient,
    appName: app.name,
    appPath: app.launch
  });

  if (!success) {
    alert("Failed to send launch command. Client may be disconnected.");
  }
}
