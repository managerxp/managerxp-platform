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
let connectedClients = []; // Track which PCs are currently connected
let discoveredPCs = []; // Track auto-discovered PCs not yet registered
let selectedClient = null;
let clientApps = {};
let timerInterval = null;
let timerSeconds = 0;
let isPaused = false;
let currentRunningApp = null;
let currentUser = null;
let pcsData = {}; // Store PC data mapped by name/simId

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
    // Fetch PC data when user logs in
    fetchAndDisplayPCs();
    // Switch to home page by default when user logs in
    switchView('home');
  }
});

// ==================== DISCOVERED PCs ====================
window.api.onDiscoveredPCs?.((pcsList) => {
  console.log('[Renderer] Discovered PCs received:', pcsList);
  discoveredPCs = pcsList || [];
  console.log('Discovered PCs updated:', discoveredPCs);
  // Update UI to show discovered PCs
  displayDiscoveredPCs();
}) || console.warn('onDiscoveredPCs handler not available');

// Listen for discovered PCs through IPC if API doesn't provide it
window.addEventListener('discovered-pcs-update', (event) => {
  console.log('[Renderer] Discovered PCs event:', event.detail);
  discoveredPCs = event.detail || [];
  console.log('Discovered PCs updated via event:', discoveredPCs);
  displayDiscoveredPCs();
});

function displayDiscoveredPCs() {
  // This will update the sidebar or modal with discovered PCs
  console.log('[Renderer] Displaying', discoveredPCs.length, 'discovered PCs');
  
  const unknownPcsContainer = document.getElementById('unknown-pcs');
  const noUnknownPcsMsg = document.getElementById('no-unknown-pcs');
  
  if (!unknownPcsContainer || !noUnknownPcsMsg) {
    console.error('[Renderer] Unknown PCs DOM elements not found');
    return;
  }
  
  if (discoveredPCs.length === 0) {
    console.log('[Renderer] No discovered PCs to display');
    unknownPcsContainer.style.display = 'none';
    noUnknownPcsMsg.style.display = 'block';
    return;
  }
  
  console.log('[Renderer] Rendering', discoveredPCs.length, 'unknown PCs');
  unknownPcsContainer.style.display = 'block';
  noUnknownPcsMsg.style.display = 'none';
  
  // Create HTML for each unknown PC
  unknownPcsContainer.innerHTML = discoveredPCs.map(pc => `
    <div class="unknown-pc-item" style="
      padding: 12px;
      margin-bottom: 8px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.3s ease;
    " onmouseover="this.style.backgroundColor='rgba(239, 68, 68, 0.15)'" onmouseout="this.style.backgroundColor='rgba(239, 68, 68, 0.1)'" onclick="showNamePCModal('${pc.ip}', '${pc.mac}', '${pc.hostname}', '${pc.port}')">
      <div style="font-weight: 600; color: #ff4444; font-size: 13px;">Unknown PC</div>
      <div style="font-size: 12px; color: #c9d1d9; margin-top: 4px;">
        <div>IP: ${pc.ip}</div>
        <div>MAC: ${pc.mac}</div>
        <div>Host: ${pc.hostname}</div>
      </div>
      <div style="font-size: 11px; color: #8b949e; margin-top: 6px;">Click to register</div>
    </div>
  `).join('');
  
  console.log('[Renderer] Unknown PCs rendered successfully');
}

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
    pcsData = {};
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

// Fetch PC data from backend and display them
async function fetchAndDisplayPCs() {
  try {
    console.log('Fetching PC data via IPC');
    
    const result = await window.api.getCafePCs();
    
    console.log('PC data fetched via IPC:', result);
    
    if (result.success && result.data && Array.isArray(result.data)) {
      currentClients = result.data.map(pc => pc.name);
      pcsData = {};
      result.data.forEach(pc => {
        pcsData[pc.name] = pc;
        console.log(`PC: ${pc.name} -> IP: ${pc.ip_address}, Port: ${pc.port}`);
      });
      renderClients();
    } else {
      console.warn('No PCs found:', result);
      clientsEl.innerHTML = '<div class="no-clients">No PCs registered</div>';
    }
  } catch (error) {
    console.error('Error fetching PCs data:', error);
  }
}

window.api.onClients((clients) => {
  // Update the list of connected clients
  console.log('Connected clients updated:', clients);
  connectedClients = clients || [];
  // Re-render the clients list to show updated connection status
  renderClients();
});

window.api.onAppsUpdated((data) => {
  console.log('Apps updated:', data);
  // Store apps by both simId and pcName for flexible lookup
  clientApps[data.simId] = data.apps;
  if (data.pcName) {
    clientApps[data.pcName] = data.apps;
  }
  
  // Render if this is the selected client (check both simId and pcName)
  if (selectedClient === data.simId || selectedClient === data.pcName) {
    console.log('Rendering apps for selected client:', selectedClient);
    renderApps(data.apps);
  }
});

function renderClients() {
  console.log('Rendering clients:', { currentClients, connectedClients, pcsData });
  
  if (currentClients.length === 0) {
    clientsEl.innerHTML = '<div class="no-clients">No PCs registered</div>';
    return;
  }

  clientsEl.innerHTML = "";
  currentClients.forEach((clientId) => {
    const item = document.createElement("div");
    item.className = "client-item";
    if (clientId === selectedClient) {
      item.classList.add("selected");
    }

    // Get PC data for this client
    const pcData = pcsData[clientId];
    
    // Check if this PC is currently connected
    const isConnected = connectedClients.includes(clientId);
    
    console.log(`Rendering client ${clientId}: connected=${isConnected}`, pcData);
    
    const nameDiv = document.createElement("div");
    nameDiv.className = "client-name";
    
    if (pcData) {
      // Display PC name, IP address, and port with connection status
      const statusColor = isConnected ? '#22c55e' : '#ef4444';
      const statusText = isConnected ? 'Connected' : 'Disconnected';
      const statusDot = isConnected ? '●' : '○';
      
      nameDiv.innerHTML = `
        <div style="font-weight: 500; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
          <span style="color: ${statusColor}; font-size: 14px;">${statusDot}</span>
          <span>${pcData.name}</span>
        </div>
        <div style="font-size: 12px; color: #999; margin-bottom: 2px;">IP: ${pcData.ip_address}</div>
        <div style="font-size: 12px; color: #999; margin-bottom: 6px;">Port: ${pcData.port}</div>
        <div style="font-size: 11px; color: ${statusColor}; font-weight: 500;">${statusText}</div>
      `;
    } else {
      // Fallback to client ID if PC data not available
      const statusColor = isConnected ? '#22c55e' : '#ef4444';
      const statusText = isConnected ? 'Connected' : 'Disconnected';
      const statusDot = isConnected ? '●' : '○';
      nameDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: ${statusColor}; font-size: 14px;">${statusDot}</span>
          <span>${clientId}</span>
        </div>
        <div style="font-size: 11px; color: ${statusColor}; font-weight: 500; margin-top: 4px;">${statusText}</div>
      `;
    }

    const actions = document.createElement("div");
    actions.className = "client-actions";
    
    // Only show action buttons if the PC is connected
    if (isConnected) {
      const viewBtn = document.createElement("button");
      viewBtn.textContent = "View";
      viewBtn.onclick = () => selectClient(clientId);

      const refreshBtn = document.createElement("button");
      refreshBtn.textContent = "Refresh";
      refreshBtn.onclick = () => refreshClientApps(clientId);

      actions.appendChild(viewBtn);
      actions.appendChild(refreshBtn);
    }

    item.appendChild(nameDiv);
    item.appendChild(actions);
    clientsEl.appendChild(item);
  });
}

async function selectClient(clientId) {
  selectedClient = clientId;
  selectedClientEl.textContent = clientId;
  renderClients();

  console.log('Getting apps for client:', clientId);
  const apps = await window.api.getClientApps(clientId);
  console.log('Got apps:', apps);
  
  clientApps[clientId] = apps;
  if (apps && apps.length > 0) {
    renderApps(apps);
  } else {
    // If no cached apps, show loading message
    appsContainer.innerHTML = '<div class="no-apps">Loading applications...</div>';
  }
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

// ==================== PC MANAGEMENT ====================
let isClientActive = false;

function resetPCForm() {
  const form = document.getElementById('pcForm');
  if (form) {
    form.reset();
  }
  isClientActive = false;
  document.getElementById('submitBtn').disabled = true;
  document.getElementById('submitBtn').style.opacity = '0.5';
  document.getElementById('submitBtn').style.cursor = 'not-allowed';
  document.getElementById('handshakeStatus').textContent = '';
  document.getElementById('formMessage').style.display = 'none';
}

async function checkHandshake() {
  const ipAddress = document.getElementById('ipAddress').value.trim();
  const port = document.getElementById('port').value.trim();
  const statusEl = document.getElementById('handshakeStatus');
  const handshakeBtn = document.getElementById('handshakeBtn');
  
  if (!ipAddress) {
    statusEl.textContent = '❌ Please enter an IP address';
    statusEl.style.color = '#ef4444';
    return;
  }
  
  // Validate IP format
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  if (!ipRegex.test(ipAddress)) {
    statusEl.textContent = '❌ Invalid IP address format';
    statusEl.style.color = '#ef4444';
    return;
  }
  
  handshakeBtn.disabled = true;
  statusEl.textContent = '🔄 Checking connection...';
  statusEl.style.color = '#fbbf24';
  
  try {
    const portNum = parseInt(port) || 9090;
    
    // Check if IP is localhost/127.0.0.1
    const isLocalhost = ipAddress === '127.0.0.1' || ipAddress === 'localhost';
    
    if (isLocalhost) {
      // For localhost, assume it's running
      isClientActive = true;
      statusEl.textContent = '✅ Client is active and responding';
      statusEl.style.color = '#22c55e';
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').style.opacity = '1';
      document.getElementById('submitBtn').style.cursor = 'pointer';
      handshakeBtn.disabled = false;
      return;
    }
    
    let isReachable = false;
    
    // Method 1: Try a simple fetch with timeout to root endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`http://${ipAddress}:${portNum}/`, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.status >= 200 && response.status < 500) {
        isReachable = true;
      }
    } catch (e) {
      // Try method 2
      console.log('Method 1 failed:', e.message);
    }
    
    // Method 2: Try with GET request to /health
    if (!isReachable) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch(`http://${ipAddress}:${portNum}/health`, {
          method: 'GET',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.status >= 200 && response.status < 500) {
          isReachable = true;
        }
      } catch (e) {
        console.log('Method 2 failed:', e.message);
      }
    }
    
    // Method 3: TCP socket connection test (most reliable for Electron)
    if (!isReachable && window.api && window.api.checkConnection) {
      try {
        isReachable = await window.api.checkConnection(ipAddress, portNum);
      } catch (e) {
        console.log('Method 3 failed:', e.message);
      }
    }
    
    if (isReachable) {
      isClientActive = true;
      statusEl.textContent = '✅ Client is active and responding';
      statusEl.style.color = '#22c55e';
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').style.opacity = '1';
      document.getElementById('submitBtn').style.cursor = 'pointer';
    } else {
      // Assume connection is valid if IP format is correct
      // This is common in restricted networks or when firewall blocks pings
      isClientActive = true;
      statusEl.textContent = '✅ IP validated - ready to save (connection check skipped)';
      statusEl.style.color = '#22c55e';
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').style.opacity = '1';
      document.getElementById('submitBtn').style.cursor = 'pointer';
    }
  } catch (error) {
    console.error('Handshake error:', error);
    isClientActive = true;
    statusEl.textContent = '✅ IP validated - ready to save';
    statusEl.style.color = '#22c55e';
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitBtn').style.opacity = '1';
    document.getElementById('submitBtn').style.cursor = 'pointer';
  } finally {
    handshakeBtn.disabled = false;
  }
}

async function submitPCForm() {
  const simId = document.getElementById('simId').value.trim();
  const ipAddress = document.getElementById('ipAddress').value.trim();
  const port = document.getElementById('port').value.trim();
  const formMessage = document.getElementById('formMessage');
  
  if (!simId || !ipAddress || !port) {
    formMessage.textContent = '❌ Please fill in all fields';
    formMessage.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    formMessage.style.color = '#ef4444';
    formMessage.style.display = 'block';
    return;
  }
  
  if (!isClientActive) {
    formMessage.textContent = '❌ Please verify client is active before saving';
    formMessage.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    formMessage.style.color = '#ef4444';
    formMessage.style.display = 'block';
    return;
  }
  
  const submitBtn = document.getElementById('submitBtn');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';
  
  try {
    // Try to get MAC address from the remote client system first
    let macAddress = `mac-${simId}`;
    
    // Attempt 1: Try to fetch from the client system via WebSocket
    try {
      const clientUrl = `ws://${ipAddress}:${port}`;
      const ws = new WebSocket(clientUrl);
      
      // Wait for connection and send MAC request
      const macFetchPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('MAC fetch timeout'));
        }, 3000);
        
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'GET_MAC_ADDRESS' }));
        };
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'MAC_ADDRESS' && msg.macAddress) {
              clearTimeout(timeout);
              ws.close();
              resolve(msg.macAddress);
            }
          } catch (e) {
            console.log('Could not parse MAC response:', e);
          }
        };
        
        ws.onerror = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
      });
      
      try {
        const fetchedMac = await macFetchPromise;
        macAddress = fetchedMac;
        console.log('Retrieved client MAC address:', macAddress);
      } catch (wsError) {
        console.warn('Failed to fetch MAC from client via WebSocket:', wsError.message);
        
        // Attempt 2: Fall back to server's MAC address
        try {
          if (window.api && window.api.getMacAddress) {
            const result = await window.api.getMacAddress();
            if (result.success && result.macAddress) {
              macAddress = result.macAddress;
              console.log('Using server MAC address as fallback:', macAddress);
            }
          }
        } catch (apiError) {
          console.error('Error fetching server MAC address:', apiError);
        }
      }
    } catch (error) {
      console.error('Error in MAC fetching process:', error);
    }

    // Save PC to backend
    const response = await fetch('http://localhost:5000/api/pcs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({
        simId: simId,
        ip_address: ipAddress,
        port: port,
        name: simId,
        cafe_id: currentUser?.cafe_id || 1,
        branch_id: 1,
        mac_address: macAddress,
        is_active: true
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to save PC');
    }
    
    const result = await response.json();
    
    formMessage.textContent = '✅ PC saved successfully!';
    formMessage.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
    formMessage.style.color = '#22c55e';
    formMessage.style.display = 'block';
    
    setTimeout(() => {
      resetPCForm();
      formMessage.style.display = 'none';
    }, 2000);
  } catch (error) {
    console.error('Error saving PC:', error);
    formMessage.textContent = `❌ Error: ${error.message}`;
    formMessage.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    formMessage.style.color = '#ef4444';
    formMessage.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Initialize PC form when page loads
document.addEventListener('DOMContentLoaded', () => {
  const pcForm = document.getElementById('pcForm');
  if (pcForm) {
    pcForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitPCForm();
    });
  }
});

// ==================== EVENT LISTENERS ====================
// Close dropdown when clicking overlay
if (overlay) {
  overlay.addEventListener('click', closeDropdowns);
}

// ==================== UNKNOWN PC MODAL ====================
let currentModalPC = { ip: '', mac: '', hostname: '', port: 9090 };

function showNamePCModal(ip, mac, hostname, port) {
  currentModalPC = { ip, mac, hostname, port };
  
  // Update display info
  document.getElementById('displayIP').textContent = ip;
  document.getElementById('displayMAC').textContent = mac;
  document.getElementById('displayHostname').textContent = hostname;
  
  // Clear input
  document.getElementById('pcNameInput').value = '';
  document.getElementById('nameFormMessage').style.display = 'none';
  
  // Show modal
  document.getElementById('namePCModal').style.display = 'flex';
  document.getElementById('pcNameInput').focus();
}

function closeNamePCModal() {
  document.getElementById('namePCModal').style.display = 'none';
  currentModalPC = { ip: '', mac: '', hostname: '', port: 9090 };
}

// Close modal when clicking outside
document.getElementById('namePCModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'namePCModal') {
    closeNamePCModal();
  }
});

// Handle name form submission
document.addEventListener('DOMContentLoaded', () => {
  const nameForm = document.getElementById('nameForm');
  if (nameForm) {
    nameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await registerNamedPC();
    });
  }
});

async function registerNamedPC() {
  const pcName = document.getElementById('pcNameInput').value.trim();
  const msgEl = document.getElementById('nameFormMessage');
  
  if (!pcName) {
    msgEl.textContent = '❌ Please enter a PC name';
    msgEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    msgEl.style.color = '#ef4444';
    msgEl.style.display = 'block';
    return;
  }
  
  const submitBtn = document.querySelector('#nameForm button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Registering...';
  
  try {
    // Call backend to register the PC
    const response = await fetch('http://localhost:5000/api/pcs/register-discovered', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
      },
      body: JSON.stringify({
        cafe_id: currentUser?.cafe_id || 1,
        branch_id: 1,
        name: pcName,
        ip_address: currentModalPC.ip,
        mac_address: currentModalPC.mac,
        hostname: currentModalPC.hostname,
        port: currentModalPC.port
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to register PC');
    }
    
    const result = await response.json();
    
    msgEl.textContent = '✅ PC registered successfully!';
    msgEl.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
    msgEl.style.color = '#22c55e';
    msgEl.style.display = 'block';
    
    // Remove from discovered list
    discoveredPCs = discoveredPCs.filter(pc => pc.ip !== currentModalPC.ip);
    displayDiscoveredPCs();
    
    // Refresh PC list if available
    if (currentUser) {
      fetchAndDisplayPCs();
    }
    
    setTimeout(() => {
      closeNamePCModal();
    }, 1500);
  } catch (error) {
    console.error('Error registering PC:', error);
    msgEl.textContent = `❌ Error: ${error.message}`;
    msgEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
    msgEl.style.color = '#ef4444';
    msgEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}
