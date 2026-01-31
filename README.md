# ManagerXP Platform

A modern multi-platform system to manage a racing/simulator center operations.

This project includes:

- **Web Admin Console** (Next.js)
- **Desktop Rig/Kiosk App** (Electron)
- **Backend API** (Node + Express)
- **PostgreSQL database**
- **Real-time updates** via WebSockets

## Goal

ManagerXP is designed to help run a racing center daily with:

- Customer CRM (Profiles + history)
- Rig session management (start/pause/extend/end)
- Payments (Pre-Pay and Post-Pay support)
- Real-time rig dashboard + reporting

This repo is built in phases:

- **Phase 1**: CRM + Rig Sessions + Payments (MVP)
- **Phase 2**: Cafe Management + Ops Enhancements
- **Phase 3**: Employee Management + Permissions

*(Full requirement details are in our internal requirements document.)* ✅

## Tech Stack

### Frontend (Web)
- Next.js
- TypeScript
- Tailwind CSS
- GSAP
- Three.js

### Desktop App (Rig/Kiosk)
- Electron.js

### Backend (Common)
- Node.js
- Express.js
- PostgreSQL
- WebSockets (real-time updates)

## Core Features (Phase 1 MVP)

### 1) Customer CRM
- Register customer (phone/email + name)
- Quick lookup by phone/name/QR
- Profile history (sessions + spend)
- Staff notes and flags (VIP / banned / payment-risk)

### 2) Rig Session Management
- Live rig dashboard (available/reserved/in-session/maintenance/offline)
- Create and assign sessions
- Start/pause/extend/end session lifecycle
- Auto-end based on time expiry (with grace time)
- Move customer between rigs without losing remaining time

### 3) Payments & Billing Ledger
- Supports card/cash (and credit/gift card later)
- Pre-pay (default)
- Post-pay (manager controlled / trusted customers)
- Ledger entries stored immutably for audit and reporting
- Outstanding balances visible

## Repository Structure

*(will update once we have more clear Knowledge)*

```
apps/web      -> Next.js Admin Console
apps/desktop  -> Electron Rig/Kiosk App
apps/server   -> Node.js + Express backend
docs/         -> documentation and system design notes
```

### Current Folder Structure

```
client-app/              -> Client application (connects to server)
  ├── get_apps.ps1       -> PowerShell script to scan installed apps
  ├── index.html         -> Client UI
  ├── main.js            -> Electron main process with WebSocket client
  ├── preload.js         -> IPC bridge
  ├── renderer.js        -> Client UI logic
  ├── package.json       -> Dependencies
  └── output/
      └── apps.json      -> Cached application list

server-app/              -> Server application (manages clients)
  ├── index.html         -> Server dashboard UI
  ├── main.js            -> Electron main process with WebSocket server
  ├── preload.js         -> IPC bridge
  ├── renderer.js        -> Server UI logic
  └── package.json       -> Dependencies


```

## Architecture

### Client App
- Connects to the server via WebSocket
- Automatically scans and sends list of installed Windows applications to server
- Listens for launch commands from server and executes them
- Supports refreshing the application list on demand

### Server App  
- Receives connections from multiple clients
- Displays all connected clients
- Shows installed applications for each client
- Allows launching applications remotely on client machines

## How It Works

1. **Client Startup**:
   - Client connects to server (ws://localhost:8080)
   - Runs PowerShell script to scan installed applications
   - Sends application list to server

2. **Server Interface**:
   - View connected clients
   - Select a client to see their applications
   - Click "Launch" to run an application on the client machine
   - Click "Refresh" to update the application list

3. **Application Detection**:
   - Scans Windows Registry (HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall)
   - Scans Start Menu shortcuts (.lnk files)
   - Extracts application name, version, and executable path

## Message Protocol

### Client → Server:
- `REGISTER`: Client registration with ID and hostname
- `APPS_LIST`: Send list of installed applications
- `HEARTBEAT`: Keep-alive signal every 5 seconds

### Server → Client:
- `LAUNCH_APP`: Command to launch a specific application
- `REFRESH_APPS`: Request to rescan and send updated app list



## 🧑‍💻 Local Setup (Basic)

### 1) Clone
```bash
git clone https://github.com/managerxp/managerxp-platform.git
cd managerxp-platform
```

### 2) Install dependencies
```bash
npm install
```

### 3) Run Web App
```bash
cd apps/web
npm run dev
```

### 4) Run Backend
```bash
cd apps/server
npm run dev
```

### 5) Run Electron App
```bash
cd apps/desktop
npm run dev
```

## Features

✅ Auto-detection of installed Windows applications  
✅ Real-time client connection status  
✅ Remote application launching  
✅ Multi-client support  
✅ Application list refresh  
✅ Automatic reconnection on disconnect  
✅ Heartbeat monitoring

## Contributing

We are building this as a team project.

Read contribution rules here:  
➡️ **CONTRIBUTING.md**

## Access & Permissions

If you cannot push code / create branches / access repository settings:

➡️ Check: **ACCESS.md**  
It explains what each role means and who to contact.

## Roadmap

### Phase 1
- Customer CRM
- Website + Booking
- Rig sessions + Game Control & Telemetry (AC, F1, ACR, iRacing, Le Mans)
- Payments + ledger
- Live dashboard + basic reporting

### Phase 2
- Cafe POS + inventory
- Reservations
- Wallet + loyalty
- Rig maintenance tracking
- Multi-location readiness

### Phase 3
- Employee profiles + roles
- Scheduling & shifts
- Time clock
- RBAC hardening

## 🧾 License

This is currently a private/team project. Licensing will be decided later.
