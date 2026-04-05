const logsEl = document.getElementById("logs");
const clientsEl = document.getElementById("clients");
const appsContainer = document.getElementById("apps-container");
const selectedClientEl = document.getElementById("selected-client");
const timerSection = document.getElementById("timer-section");
const timerDisplay = document.getElementById("timer-display");
const timerControls = document.getElementById("timer-controls");
const timerInputGroup = document.getElementById("timer-input-group");
const runningAppInfo = document.getElementById("running-app-info");

// User profile elements
const userProfileEl = document.getElementById("userProfile");
const userAvatarEl = document.getElementById("userAvatar");
const userNameEl = document.getElementById("userName");
const logoutBtn = document.getElementById("logoutBtn");

let currentClients = [];
let selectedClient = null;
let clientApps = {};
let timerInterval = null;
let timerSeconds = 0;
let isPaused = false;
let currentRunningApp = null;
let currentUser = null;

// Initialize user profile when page loads
window.api.onUserUpdated((data) => {
  if (data && data.user) {
    currentUser = data.user;
    displayUserProfile(data.user);
  }
});

// Display user profile with avatar and welcome message
function displayUserProfile(user) {
  if (!user) return;
  
  const userName = user.name || user.email || 'User';
  const initials = userName
    .split(' ')
    .map(n => n.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2) || 'U';
  
  userAvatarEl.textContent = initials;
  userNameEl.textContent = userName;
  userProfileEl.style.display = 'flex';
  
  console.log(`Welcome ${userName}! You are logged in.`);
}

// Handle logout
function handleLogout() {
  if (confirm('Are you sure you want to log out?')) {
    // Clear local state
    currentUser = null;
    clientApps = {};
    selectedClient = null;
    currentClients = [];
    if (timerInterval) clearInterval(timerInterval);
    
    // Notify main process to handle logout
    window.api.logout();
  }
}

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
    clientsEl.innerHTML = '<div class="no-clients">No clients connected</div>';
    return;
  }

  clientsEl.innerHTML = "";
  currentClients.forEach((clientId) => {
    const item = document.createElement("div");
    item.className = "client-item";
    if (clientId === selectedClient) {
      item.classList.add("selected");
    }

    const nameDiv = document.createElement("div");
    nameDiv.className = "client-name";
    nameDiv.textContent = clientId;

    const actions = document.createElement("div");
    actions.className = "client-actions";

    const viewBtn = document.createElement("button");
    viewBtn.textContent = "View";
    viewBtn.onclick = () => selectClient(clientId);

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "refresh";
    refreshBtn.textContent = "Refresh";
    refreshBtn.onclick = () => refreshClientApps(clientId);

    actions.appendChild(viewBtn);
    actions.appendChild(refreshBtn);

    item.appendChild(nameDiv);
    item.appendChild(actions);
    clientsEl.appendChild(item);
  });
}

async function selectClient(clientId) {
  selectedClient = clientId;
  selectedClientEl.textContent = clientId;
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
    appsContainer.innerHTML = '<div class="no-apps">No applications found on this client</div>';
    return;
  }

  apps.forEach((app, index) => {
    const item = document.createElement("div");
    item.className = "app-item";

    const appInfo = document.createElement("div");
    appInfo.className = "app-info";

    const appIcon = document.createElement("div");
    appIcon.className = "app-icon";
    // Use first letter of app name as icon
    appIcon.textContent = app.name.charAt(0).toUpperCase();

    const appDetails = document.createElement("div");
    appDetails.className = "app-details";

    const nameSpan = document.createElement("div");
    nameSpan.className = "app-name";
    nameSpan.textContent = app.name;

    const versionSpan = document.createElement("div");
    versionSpan.className = "app-version";
    versionSpan.textContent = app.version || "Version unknown";

    appDetails.appendChild(nameSpan);
    appDetails.appendChild(versionSpan);

    appInfo.appendChild(appIcon);
    appInfo.appendChild(appDetails);

    const launchBtn = document.createElement("button");
    launchBtn.className = "launch-btn";
    launchBtn.textContent = "🚀 Launch";
    launchBtn.disabled = !app.launch;
    launchBtn.onclick = () => launchApp(app);

    item.appendChild(appInfo);
    item.appendChild(launchBtn);

    appsContainer.appendChild(item);
  });
}

async function launchApp(app) {
  if (!selectedClient || !app.launch) return;

  // Store app info but don't launch yet - wait for timer to be set
  currentRunningApp = {
    simId: selectedClient,
    appName: app.name,
    appPath: app.launch
  };
  showTimerSection();
}

function showTimerSection() {
  timerSection.classList.add('active');
  runningAppInfo.innerHTML = `
    <div class="running-app-name">💻 ${currentRunningApp.appName}</div>
    <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Running on: ${currentRunningApp.simId}</div>
  `;
  timerInputGroup.style.display = 'flex';
  timerDisplay.style.display = 'none';
  timerControls.style.display = 'none';
}

function startTimer() {
  const minutes = parseInt(document.getElementById('timer-minutes').value);
  if (!minutes || minutes < 1) {
    alert('Please enter a valid timer duration (minimum 1 minute)');
    return;
  }

  timerSeconds = minutes * 60;
  isPaused = false;
  
  // Send timer to client
  if (currentRunningApp) {
    window.api.launchApp({
      simId: currentRunningApp.simId,
      appName: currentRunningApp.appName,
      appPath: currentRunningApp.appPath,
      timerMinutes: minutes
    });
  }
  
  timerInputGroup.style.display = 'none';
  timerDisplay.style.display = 'block';
  timerControls.style.display = 'flex';
  
  updateTimerDisplay();
  
  if (timerInterval) clearInterval(timerInterval);
  
  timerInterval = setInterval(() => {
    if (!isPaused) {
      timerSeconds--;
      updateTimerDisplay();
      
      if (timerSeconds <= 0) {
        clearInterval(timerInterval);
        closeApplication();
      }
    }
  }, 1000);
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerSeconds / 60);
  const seconds = timerSeconds % 60;
  const timeString = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  
  timerDisplay.textContent = timeString;
  
  // Change color based on remaining time
  timerDisplay.className = 'timer-display';
  if (timerSeconds <= 60) {
    timerDisplay.classList.add('danger');
  } else if (timerSeconds <= 300) {
    timerDisplay.classList.add('warning');
  }
}

function pauseTimer() {
  isPaused = true;
}

function resumeTimer() {
  isPaused = false;
}

function stopTimer() {
  if (confirm('Are you sure you want to stop the timer and close the application?')) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    closeApplication();
  }
}

async function closeApplication() {
  if (!currentRunningApp) return;

  const success = await window.api.closeApp({
    simId: currentRunningApp.simId,
    appName: currentRunningApp.appName,
    appPath: currentRunningApp.appPath
  });

  if (success) {
    alert(`Application "${currentRunningApp.appName}" has been closed.`);
  } else {
    alert('Failed to close application. Client may be disconnected.');
  }

  // Reset timer section
  timerSection.classList.remove('active');
  currentRunningApp = null;
  timerSeconds = 0;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}
