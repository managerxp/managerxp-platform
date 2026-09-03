# ManagerXP Platform

CafeXP — a system for running a gaming café's stations day to day: sessions,
pricing, XP Coin wallets, F&B, and a self-service kiosk for customers.

This repository holds the two Windows desktop apps:

- **ClientXP** (`client-app/`) — the station kiosk a customer sits in front
  of. Full-screen, locked down, runs the customer's session and launches
  their game.
- **ServerXP** (`server-app/`) — the café's admin console: dashboard,
  sessions, customers, gaming prices, billing, reports, CafeXP AI.

Both are Electron apps that talk to each other over a local WebSocket, and
both talk to the ManagerXP backend API (a separate repository —
`Manager-XP-Website/backend`, Node/Express + PostgreSQL — not part of this
one).

## Tech Stack

- Electron.js (both apps)
- Plain JS renderer (no framework) + a small shared `CX*` UI/store/router
  layer per app
- WebSockets, for the client ↔ console link
- Node.js / npm for tooling

## Repository Structure

```
managerxp-platform/
├── client-app/          ClientXP — the station kiosk
│   ├── main.js           Electron main process (kiosk lockdown, sessions,
│   │                      game launch, volume, timer card, updates)
│   ├── preload.js         IPC bridge to the renderer
│   ├── app/               Renderer: portal, wallet, views, session UI
│   ├── scripts/           PowerShell helpers (volume control, etc.)
│   └── updater.js          electron-updater wiring (see Auto Update below)
├── server-app/           ServerXP — the café admin console
│   ├── main.js             Electron main process (WS server, station state)
│   ├── preload.js           IPC bridge
│   └── app/pages/            Dashboard, Sessions, Customers, Gaming Prices,
│                              Billing, Reports, CafeXP AI, Settings…
├── docs/                 CONTRIBUTING.md, ACCESS.md, GITHUB_CI_CD.md
└── .github/workflows/    CI + release pipelines (see below)
```

## Development

### Install dependencies

```bash
cd client-app && npm install
cd ../server-app && npm install
```

### Run ClientXP (the kiosk)

```bash
cd client-app
npm start
```

### Run ServerXP (the admin console)

```bash
cd server-app
npm start
```

Both read their config from a local `.env` — see `.env.example` at the repo
root for the keys each one needs, and the backend API (`Manager-XP-Website/backend`)
needs to be running for either app to do anything beyond boot.

### Building a Windows installer

```bash
cd client-app && npm run dist     # -> client-app/dist/CafeXP-Client-Setup-<version>.exe
cd server-app && npm run dist     # -> server-app/dist/CafeXP-Console-Setup-<version>.exe
```

`npm run dist:publish` does the same build and additionally attempts to
publish per the app's `build.publish` config — used by the release pipeline,
not for a manual local build.

## Git Branching

Documented in full in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md); the
short version:

- `main` — production-ready only, via Pull Request.
- `develop` — integration branch; feature work merges here first.
- `feature/<name>`, `fix/<name>`, `docs/<name>`, `chore/<name>` — everything
  else, branched from `develop`.

## Release & Versioning

Both apps share one release number (semantic versioning: `MAJOR.MINOR.PATCH`,
tagged `v1.2.3`). Pushing a tag matching `v*.*.*` on `main` triggers the
release pipeline described below — it builds **both** installers, publishes
one GitHub Release with both attached, and registers each with ManagerXP's
own release system so stations can be offered the update.

## CI/CD

Three GitHub Actions workflows, all in `.github/workflows/`:

| Workflow | Runs on | What it does |
|---|---|---|
| `clientxp-ci.yml` | PR into `main`/`develop`, push to `develop` | `npm ci` + build ClientXP only when `client-app/**` changed |
| `serverxp-ci.yml` | same | same, for `server-app/**` |
| `release.yml` | push of a `v*.*.*` tag | builds both installers, creates the GitHub Release, registers both with the backend |

Full architecture, secrets, code signing setup, and troubleshooting:
[docs/GITHUB_CI_CD.md](docs/GITHUB_CI_CD.md).

## Auto Update

ClientXP ships `electron-updater` and a session-aware update module
(`client-app/updater.js`) that never installs over a live customer session.
**It is not yet wired into `main.js`** — the backend's release-tracking side
(`client_releases`, `/api/updates/*`) is fully built and is what the release
pipeline above registers new versions with, but nothing currently calls
`updater.js` to act on that. Wiring the two together is tracked as a
follow-up in `docs/GITHUB_CI_CD.md` rather than done as part of CI/CD setup.

## Contributing

Read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) before opening a PR.

## Access & Permissions

If you cannot push code / create branches / access repository settings, see
[docs/ACCESS.md](docs/ACCESS.md).

## License

This is currently a private/team project. Licensing will be decided later.
