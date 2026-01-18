# ManagerXP Platform 
A modern multi-platform system to manage a racing/simulator center operations.

This project includes:
- Web Admin Console (Next.js)
- Desktop Rig/Kiosk App (Electron)
- Backend API (Node + Express)
- PostgreSQL database
- Real-time updates via WebSockets

---

## Goal

ManagerXP is designed to help run a racing center daily with:
- Customer CRM (Profiles + history)
- Rig session management (start/pause/extend/end)
- Payments (Pre-Pay and Post-Pay support)
- Real-time rig dashboard + reporting

This repo is built in phases:
- Phase 1: CRM + Rig Sessions + Payments (MVP)
- Phase 2: Cafe Management + Ops Enhancements
- Phase 3: Employee Management + Permissions

(Full requirement details are in our internal requirements document.) ✅

---

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

---

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

---

## Repository Structure (will update once we have more clear Knowledge)

```

apps/web      -> Next.js Admin Console
apps/desktop  -> Electron Rig/Kiosk App
apps/server   -> Node.js + Express backend
docs/         -> documentation and system design notes

````

---

## 🧑‍💻 Local Setup (Basic)

### 1) Clone
```bash
git clone https://github.com/managerxp/managerxp-platform.git
cd managerxp-platform
````

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

---

## Contributing
We are building this as a team project.

Read contribution rules here:  
➡️ [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## Access & Permissions
If you cannot push code / create branches / access repository settings:

➡️ Check: [ACCESS.md](./ACCESS.md)  
It explains what each role means and who to contact.

---

## Roadmap

### Phase 1

* Customer CRM
* Rig sessions
* Payments + ledger
* Live dashboard + basic reporting

### Phase 2

* Cafe POS + inventory
* Reservations
* Wallet + loyalty
* Rig maintenance tracking
* Multi-location readiness

### Phase 3

* Employee profiles + roles
* Scheduling & shifts
* Time clock
* RBAC hardening

---

## 🧾 License

This is currently a private/team project. Licensing will be decided later.

````
