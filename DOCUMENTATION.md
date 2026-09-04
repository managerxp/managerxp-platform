# CafeXP Desktop Platform — Reference

Two Electron applications. **`server-app`** is the admin console the café runs at
the counter; **`client-app`** runs on each gaming station. They talk to each
other over WebSocket and to the backend over HTTP.

---

## 1. Shape of the system

```
   ┌──────────────┐   HTTP :5000    ┌───────────────────────┐
   │  Backend     │◄────────────────│  server-app (admin)   │
   │  Express +   │                 │  Electron, frameless  │
   │  PostgreSQL  │                 └───────────┬───────────┘
   └──────────────┘                     WebSocket│ (admin dials out)
          ▲                                      ▼
          │ HTTP (customer token)     ┌───────────────────────┐
          └───────────────────────────│  client-app (station) │
                                      │  Electron, full screen│
                                      │  WS server on :9090   │
                                      └───────────────────────┘
```

**The station is the WebSocket *server*.** It listens on `0.0.0.0:9090`; the
admin console dials out to each station it knows about. That is backwards from
the usual arrangement and worth remembering when debugging: if a station is
unreachable, the admin is the one failing to connect.

The station also broadcasts its IP/MAC to the admin's HTTP listener on **:3334**
so a new machine is discovered without being configured by hand.

---

## 2. Running them

```bash
cd server-app && npm install && npm start     # admin console
cd client-app && npm install && npm start     # station
```

Start the **client first**, then the admin — see §7.

### Hard constraint: no ES modules

Both renderers load over `file://`, where `import` is blocked. Every renderer
file is a classic script attaching to a global via an IIFE:

```js
(function (global) {
  "use strict";
  global.CXThing = { … };
})(window);
```

`index.html` script order therefore matters. Motion One is vendored locally at
`vendor/motion.min.js` (global `Motion`) rather than loaded from a CDN.

Renderer globals: `CXUI`, `CXMotion`, `CXIcon`, `CXStore`, `CXRouter`,
`CXPages`, `CXSession`, `CXWallet`, `CXCoin`, `CXViews`, `CXSessionUI`,
`CXStationPanel`.

---

## 3. WebSocket protocol

### Admin → station

| Message | Payload | Effect |
|---|---|---|
| `SET_NAME` | `name` | Station adopts this name and registers under it |
| `GET_SOFTWARE_LIST` | — | Station replies `SOFTWARE_LIST` |
| `REFRESH_APPS` | — | Re-scan installed applications |
| `LAUNCH_APP` | `appName`, `appPath`, `timerMinutes` | Launch, with auto-close countdown |
| `CLOSE_APP` | `appName` | Terminate it |
| `GET_MAC_ADDRESS` | — | Station replies `MAC_ADDRESS` |
| `SESSION_STATE` | `session` \| `null` | Display only — the café owns the session |
| `GET_TELEMETRY` | — | Sample now rather than waiting for the tick |
| `TELEMETRY_CONFIG` | `sample_seconds` | Change the sampling cadence |
| `POWER` | `action`, `delaySeconds` | `restart` · `shutdown` · `lock` · `signout` · `restart-client` |
| `HEARTBEAT_PING` | — | Station replies `HEARTBEAT_PONG` |

### Station → admin

| Message | Payload |
|---|---|
| `REGISTER` | `simId`, `hostname` |
| `APPS_LIST` | `apps[]` |
| `SOFTWARE_LIST` | `software[]` |
| `MAC_ADDRESS` | `macAddress` |
| `TELEMETRY` | `sample` (see §5) |
| `POWER_RESULT` | `action`, `success`, `message` |
| `HEARTBEAT` / `HEARTBEAT_PONG` | — |

`SESSION_STATE` is **display only**. The station never talks back about
sessions; the backend is the source of truth and the admin pushes state down.

---

## 4. Remote power

The console authorises with the backend **first** (`POST /api/stations/power`),
which checks the permission and writes the audit entry, and only then sends the
`POWER` message. That ordering is what guarantees an action can never happen
without a record.

On the station:

| Action | Command |
|---|---|
| `restart` | `shutdown /r /f /t <n>` |
| `shutdown` | `shutdown /s /f /t <n>` |
| `lock` | `rundll32.exe user32.dll,LockWorkStation` |
| `signout` | `shutdown /l /f` |
| `restart-client` | `app.relaunch()` — Electron only, Windows keeps running |

`/f` forces applications closed; a game sitting on a *"save before quitting?"*
prompt would otherwise block the shutdown indefinitely. A 0–60 s grace period
puts a full-screen countdown on the station first, so the desktop does not
simply vanish on whoever is playing.

Windows-only. On any other platform the station replies with a failure rather
than pretending it worked.

---

## 5. Telemetry

`client-app/telemetry.js` samples the machine's own counters every 15 s
(configurable) and pushes them over the existing socket.

| Metric | Source | Notes |
|---|---|---|
| CPU % | delta between two `os.cpus()` tick readings | Pure arithmetic |
| Memory | `os.totalmem()` / `os.freemem()` | |
| Uptime | `os.uptime()` | |
| Disk | PowerShell `Win32_LogicalDisk` | Cached 60 s |
| GPU name / VRAM | PowerShell `Win32_VideoController` | Resolved once per process |
| Temperature | `MSAcpi_ThermalZoneTemperature` | Usually **null** — most consumer boards do not expose it |
| Latency | measured by the **admin**, from heartbeat round-trip | The station has no clock to trust |

Two rules shape the file:

1. **Nothing is invented.** A counter the machine will not report stays `null`
   all the way to the database. `0` would read as a healthy idle machine.
2. **It runs while someone is gaming.** CPU and memory are arithmetic; the two
   counters needing a shell out are cached, never on the tick.

`AdapterRAM` is a signed 32-bit field, so anything ≥ 4 GB comes back wrong — it
is discarded rather than reported as a small number.

The admin caches the newest reading per station for the live wall and flushes to
the backend in batches every 20 s. A failed flush **puts the samples back**
rather than dropping them.

---

## 6. Admin console (`server-app`)

Frameless window, custom black/red controls, `-webkit-app-region: drag` on the
topbar. Sections:

**Operations** — Dashboard · Floor · Counter · Billing · Sessions · Customers
**Catalogue** — Games · F&B · Inventory · Session Master · Gaming Prices ·
Packages · Memberships · Discount Codes
**Infrastructure** — Devices · Discovery · Telemetry · Server Log
**Business** — Reports · Staff · Audit Log · Subscription · Settings

### Counter (the till)

Product tiles left, ticket pinned right so the total is never scrolled away.
Tapping a product twice bumps the quantity rather than adding a second row.

**Nothing is written until you settle** — an abandoned ticket leaves no orphan
bill. On settle it creates the bill, applies the code, then posts each tender
**sequentially** (each payment recalculates the same row; concurrent writes
would race).

### Floor

Four layouts — Grid · Rows · Zones · Compact — plus an S/M/L size switch, stored
in `app_settings` so every terminal at the counter shows the same floor. Zones
are presentation only: deleting one moves its stations to Unassigned and touches
nothing in pricing, sessions or billing.

`pcStatus()` checks `is_active` **first**. A deactivated station reads
"Deactivated" regardless of whether its socket happens to be up — otherwise a
station taken out of service still showed as Available while refusing sessions.

---

## 7. Station client (`client-app`)

Full screen, frameless, `minWidth: 1024`. Views: Home · Games · Packages ·
Membership · Food · Shop · Rewards · Account.

Window controls (minimise / maximise / fullscreen / close) live **inside the
portal nav**, not as OS chrome. The nav gives up space in a deliberate order as
the window narrows — wordmark, then link labels, then the avatar name, then the
wallet caption. The **session timer and the window controls are never reduced**:
one is the centrepiece, the other is the only way out of a frameless window.

The session timer derives from `receivedAt` drift rather than a local countdown,
so it survives a restart. States: normal → warning → critical → ended.

### Ordering matters at startup

The admin connects to stations during its own startup, **before** its window
finishes loading. The `clients` event fires into a renderer that is not
listening yet. The store therefore *pulls* the connected list on init and every
10 s (`pc:get-connected`) rather than relying on the push alone — without that,
every station reads Offline while its socket is perfectly alive.

Start the client first so this path is exercised the way it will be in a café,
where stations are on before the counter opens.

---

## 8. Known issues

| Issue | Impact |
|---|---|
| Three near-identical WS message handlers in `server-app/main.js` | Any new message type must be added in three places |
| `client-app/main.js` is ~900 lines | Window management, WS, launching and telemetry in one file |
| Launch timer is renderer-side | A countdown started from the console does not survive an admin restart; the *session* does |
| Windows-only power actions | By design, but unhandled on other platforms beyond an error reply |

### Fixed in this cycle, worth knowing about

- **Station naming.** `/api/pcs/check-exists` returns the station under `data`,
  but the console read `checkResult.pc_name` off the top level — always
  undefined, so every discovered station was renamed to an invented `PC-xx:xx`
  and no longer matched its own record. Telemetry and session pushes silently
  went nowhere.
- **Heartbeat was one-way.** The admin sent `HEARTBEAT_PING`, the station
  ignored it; the station sent `HEARTBEAT`, the admin ignored it. Both were
  keeping the socket warm and measuring nothing. The station now answers, so
  latency is a real round trip.
- **Deactivation was one-way.** There was a Deactivate button and no way back —
  no reactivate control anywhere, and no `restorePC` in the store, though the
  backend route existed the whole time.
