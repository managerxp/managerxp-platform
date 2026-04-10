// DOM Elements
const logsEl = document.getElementById("logs");
const clientsEl = document.getElementById("clients");
const appsContainer = document.getElementById("apps-container");
const selectedClientEl = document.getElementById("selected-client");
const timerSection = document.getElementById("timer-section");
const timerDisplay = document.getElementById("timer-display");
const timerControls = document.getElementById("timer-controls");
const timerInputGroup = document.getElementById("timer-input-group");
const runningAppInfo = document.getElementById("running-app-info");

// New UI Elements
const sidebarLeft = document.getElementById("sidebarLeft");
const sidebarRight = document.getElementById("sidebarRight");
const userProfileBtn = document.getElementById("userProfileBtn");
const userMenuDropdown = document.getElementById("userMenuDropdown");
const dashboardContent = document.getElementById("dashboardContent");
const overlay = document.getElementById("overlay");

// Sidebar state (starts collapsed by default)
let sidebarLeftCollapsed = true;
let sidebarRightCollapsed = true;
let currentView = 'home';
let defaultViewSet = false;

// App state
let currentClients = [];
let selectedClient = null;
let clientApps = {};
let timerInterval = null;
let timerSeconds = 0;
let isPaused = false;
let currentRunningApp = null;
let currentUser = null;

// ==================== SIDEBAR TOGGLE ====================
function toggleSidebar(side) {
  if (side === 'left') {
    sidebarLeft.classList.toggle('collapsed');
    sidebarLeftCollapsed = sidebarLeft.classList.contains('collapsed');
  } else if (side === 'right') {
    sidebarRight.classList.toggle('collapsed');
    sidebarRightCollapsed = sidebarRight.classList.contains('collapsed');
    // Close dropdown when toggling sidebar
    closeDropdowns();
  }
}

function expandRightSidebar() {
  if (sidebarRightCollapsed) {
    sidebarRight.classList.remove('collapsed');
    sidebarRightCollapsed = false;
  }
}

// ==================== USER MENU DROPDOWN ====================
function toggleUserMenu() {
  // Expand sidebar if collapsed
  if (sidebarRightCollapsed) {
    expandRightSidebar();
  }
  // Toggle the dropdown
  userMenuDropdown.classList.toggle('active');
  overlay.classList.toggle('active');
}

function closeDropdowns() {
  userMenuDropdown.classList.remove('active');
  overlay.classList.remove('active');
}

// ==================== VIEW SWITCHING ====================
function switchView(view) {
  currentView = view;
  
  // Update menu buttons
  document.getElementById('menuHome').classList.toggle('active', view === 'home');
  document.getElementById('menuDashboard').classList.toggle('active', view === 'dashboard');
  
  // Get main view elements
  const homeViewEl = document.querySelector('div[id="homeView"]');
  const dashboardViewEl = document.getElementById('dashboardView');
  
  // Update view content in main area
  if (view === 'home') {
    homeViewEl.style.display = 'block';
    dashboardViewEl.style.display = 'none';
  } else if (view === 'dashboard') {
    homeViewEl.style.display = 'none';
    dashboardViewEl.style.display = 'block';
    // Reload dashboard if user exists
    if (currentUser) {
      loadDashboard(currentUser);
    }
  }
}

// ==================== USER PROFILE ====================
window.api.onUserUpdated((data) => {
  if (data && data.user) {
    currentUser = data.user;
    displayUserProfile(data.user);
    // Switch to home page by default when user logs in
    switchView('home');
  }
});

function displayUserProfile(user) {
  if (!user) return;
  
  const userName = user.name || user.email || 'User';
  const initials = userName
    .split(' ')
    .map(n => n.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2) || 'U';
  
  // Update sidebar user profile
  const userAvatarCircle = document.getElementById("userAvatarCircle");
  const userNameSidebar = document.getElementById("userNameSidebar");
  const userEmailSidebar = document.getElementById("userEmailSidebar");
  const loginBtnSidebar = document.getElementById("loginBtnSidebar");
  
  userAvatarCircle.textContent = initials;
  userNameSidebar.textContent = userName;
  userEmailSidebar.textContent = user.email || '';
  if (loginBtnSidebar) loginBtnSidebar.style.display = 'none';
  
  console.log(`Welcome ${userName}! You are logged in.`);
}

// ==================== HANDLE LOGOUT ====================
function handleLogout() {
  if (confirm('Are you sure you want to log out?')) {
    // Clear local state
    currentUser = null;
    clientApps = {};
    selectedClient = null;
    currentClients = [];
    if (timerInterval) clearInterval(timerInterval);
    
    // Reset sidebar user profile
    const userAvatarCircle = document.getElementById("userAvatarCircle");
    const userNameSidebar = document.getElementById("userNameSidebar");
    const userEmailSidebar = document.getElementById("userEmailSidebar");
    const loginBtnSidebar = document.getElementById("loginBtnSidebar");
    
    userAvatarCircle.textContent = '?';
    userNameSidebar.textContent = 'User';
    userEmailSidebar.textContent = 'guest@localhost';
    if (loginBtnSidebar) loginBtnSidebar.style.display = 'inline-block';
    
    // Close dropdown
    closeDropdowns();
    
    // Switch to home view
    switchView('home');
    
    // Notify main process to handle logout
    window.api.logout();
  }
}

// ==================== HANDLE LOGIN ====================
function handleLogin() {
  window.api.login();
}

// ==================== DASHBOARD ====================
async function loadDashboard(user) {
  if (!user || !user.cafe_id) {
    dashboardContent.innerHTML = `
      <div class="dashboard-card">
        <h3>ℹ️ No Cafe Associated</h3>
        <p>Please link a cafe to your account to view subscription details.</p>
      </div>
    `;
    return;
  }

  try {
    // Fetch subscription data from backend
    const response = await fetch(`http://localhost:5000/api/subscriptions/cafe/${user.cafe_id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch subscription data');
    }

    const result = await response.json();
    
    if (result.success && result.data && result.data.length > 0) {
      const subscription = result.data[0];
      displayDashboard(user, subscription);
    } else {
      dashboardContent.innerHTML = `
        <div class="dashboard-card">
          <h3>📊 Subscription</h3>
          <p>No active subscription found.</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
    dashboardContent.innerHTML = `
      <div class="dashboard-card">
        <h3>❌ Error</h3>
        <p>Failed to load subscription data. Please try again.</p>
      </div>
    `;
  }
}

function displayDashboard(user, subscription) {
  const startDate = new Date(subscription.start_date);
  const endDate = new Date(subscription.end_date);
  const today = new Date();
  const isActive = subscription.is_active && today <= endDate;
  
  dashboardContent.innerHTML = `
    <div class="dashboard-card">
      <h3>Cafe Information</h3>
      <div class="dashboard-item">
        <span class="dashboard-label">Cafe Name</span>
        <p class="dashboard-value">${user.name || 'Cafe'}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">Cafe ID</span>
        <p class="dashboard-value">${user.cafe_id}</p>
      </div>
    </div>

    <div class="dashboard-card">
      <h3>Current Plan</h3>
      <div class="dashboard-item">
        <span class="dashboard-label">Plan Name</span>
        <p class="dashboard-value">${subscription.name}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">Max PCs</span>
        <p class="dashboard-value">${subscription.max_pcs}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">Plan Type</span>
        <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
          ${subscription.is_freetrial ? '<span class="dashboard-badge badge-trial">Free Trial</span>' : ''}
          ${subscription.is_single_pc_price ? '<span class="dashboard-badge badge-single">Single PC</span>' : '<span class="dashboard-badge badge-multi">Multi PC</span>'}
        </div>
      </div>
    </div>

    <div class="dashboard-card">
      <h3>Plan Duration</h3>
      <div class="dashboard-item">
        <span class="dashboard-label">Start Date</span>
        <p class="dashboard-value">${startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">End Date</span>
        <p class="dashboard-value">${endDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
      </div>
      <div class="dashboard-item">
        <span class="dashboard-label">Days Remaining</span>
        <p class="dashboard-value" style="color: ${isActive ? '#22c55e' : '#ef4444'};">${Math.max(0, Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)))}</p>
      </div>
    </div>

    <div class="dashboard-card">
      <h3>Status</h3>
      <div class="dashboard-item">
        <span class="dashboard-label">Plan Status</span>
        <div style="margin-top: 8px;">
          <span class="dashboard-status-badge ${isActive ? 'status-active' : 'status-inactive'}">
            ${isActive ? '● Active' : '● Inactive'}
          </span>
        </div>
      </div>
    </div>
  `;
}

// ==================== CLIENTS & APPS ====================
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

// ==================== APP LAUNCH & TIMER ====================
async function launchApp(app) {
  if (!selectedClient || !app.launch) return;

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

  timerSection.classList.remove('active');
  currentRunningApp = null;
  timerSeconds = 0;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ==================== EVENT LISTENERS ====================
// Close dropdown when clicking overlay
if (overlay) {
  overlay.addEventListener('click', closeDropdowns);
}
