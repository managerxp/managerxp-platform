# CafeXP Backend — Reference

Node + Express + PostgreSQL. ESM throughout. Serves the marketing website, the
admin desktop console, and (indirectly) every café station.

---

## 1. Running it

```bash
cd backend
npm install
npm run dev        # nodemon, port 5000
```

`.env` (never committed — `.gitignore` excludes `.env*`):

```
DB_USER=postgres
DB_PASSWORD=…
DB_HOST=localhost
DB_PORT=5432
DB_NAME=managerxp
JWT_SECRET=…          # required at boot; there is no fallback, by design
JWT_EXPIRE=12h
PORT=5000
```

`JWT_SECRET` has **no default**. An earlier version fell back to a literal
string, which would have made every customer token forgeable by anyone reading
the source. `config/env.js` refuses to boot without it.

Health check: `GET /health`.

### Schema creation

`initializeDatabase()` in `src/config/database.js` runs on every boot and is
idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`ON CONFLICT DO NOTHING`. There is no migration tool; the file *is* the schema.
Adding a column means adding an `ALTER … IF NOT EXISTS` line, not editing the
original `CREATE`.

**37 tables.** Money is `NUMERIC(12,2)` everywhere — never floating point.

---

## 2. Authentication

Three kinds of principal, distinguished by JWT payload shape. All three are
signed with the same `JWT_SECRET`, so the guards tell them apart by inspecting
claims rather than by using separate secrets.

| Principal | Endpoint | Payload carries | Authority |
|---|---|---|---|
| **Owner** | `POST /api/auth/login` | `role`, no `staff_id` | Full — every permission check passes |
| **Staff** | `POST /api/staff/login` | `staff_id`, `role`, `permissions[]` | Only what the role grants |
| **Customer** | `POST /api/customers/login` | `customer_id` | Own records only |

The owner token predates the staff system. `requirePermission()` treats a token
with a `role` but no `staff_id` as full authority — that is deliberate, but it
means **an owner token is useless for testing RBAC**: everything passes. Use a
staff account.

### Guards — `src/middleware/authGuards.js`

| Guard | Rule |
|---|---|
| `requireAuth` | Any valid token; populates `req.actor` |
| `requireStaff(msg)` | Token must carry `role` |
| `requirePermission(key)` | Staff must hold `key`; owner always passes |
| `canReadWallet` | A customer may read their own; any staff may read anyone's |
| `canMoveMoney` | Staff only — a customer must never credit their own wallet |

Every guard sets `req.actor`, which the audit trail reads to attribute actions.

---

## 3. Route map

25 routers. Guard shown where it is not plain `requireStaff`.

### Identity
```
POST   /api/auth/register            open
POST   /api/auth/login               open        → owner token
POST   /api/auth/verify-token        open
GET    /api/auth/users               open        ⚠ exposes the user list
POST   /api/staff/login              open        → staff token
GET    /api/staff/me                 any token   who am I + my permissions
POST   /api/customers/register       open
POST   /api/customers/login          open        → customer token
```

### Customers & wallet
```
POST   /api/customers                        customers.manage   counter registration
GET    /api/customers?search=&limit=&offset= staff
GET    /api/customers/:id                    staff
GET    /api/wallet/customer/:id              own-or-staff
GET    /api/wallet/customer/:id/transactions own-or-staff
POST   /api/wallet/customer/:id/credit       staff (canMoveMoney)
POST   /api/wallet/customer/:id/debit        staff (canMoveMoney)
```

### Stations & floor
```
GET    /api/pcs, /active, /:id, /cafe/:cafeId, /branch/:branchId   open (read)
POST   /api/pcs/check-exists                 open — discovery calls it pre-auth
POST   /api/pcs                              staff
POST   /api/pcs/register-discovered          staff
PUT    /api/pcs/:id                          staff
DELETE /api/pcs/:id[?permanent=true]         staff   soft delete unless permanent
PATCH  /api/pcs/:id/restore                  staff   reactivate

GET    /api/floor-zones                      staff
POST   /api/floor-zones                      floor.layout
PUT    /api/floor-zones/assign               floor.layout   whole board at once
PUT    /api/floor-zones/:id                  floor.layout
DELETE /api/floor-zones/:id                  floor.layout

GET    /api/stations/power/actions           station.power
POST   /api/stations/power                   station.power   authorise + audit only
```

`POST /api/stations/power` does **not** touch the machine. It checks permission,
warns if a session is live, and writes the audit entry. The console sends the
actual command over its WebSocket only after this returns success — so an action
can never happen without a record.

Permanent delete is refused when the station has sessions against it; deleting
would take its trading history with it.

### Sessions
```
GET    /api/sessions/defaults
GET    /api/sessions?status=&pc_id=&customer_id=
POST   /api/sessions                 start (customer or guest)
GET    /api/sessions/:id
POST   /api/sessions/:id/pause | /resume | /extend | /transfer | /end
```

Time is derived from timestamps, never counted by a ticker:

```
elapsed = now − started_at − paused_seconds − (paused_at ? now − paused_at : 0)
```

A restart of any process therefore loses no time and invents none. On end, the
elapsed figure bills at the rate captured when the session **started**, so a
later price change never rewrites history.

### Billing
```
GET    /api/bills?status=&customer_id=
POST   /api/bills
GET    /api/bills/:id                        any token (controller checks ownership)
GET    /api/bills/customer/:customerId       own-or-staff
POST   /api/bills/:id/items
DELETE /api/bills/:id/items/:itemId
PATCH  /api/bills/:id/discount               manual discount + reason
POST   /api/bills/:id/discount-code          apply a code
DELETE /api/bills/:id/discount-code
POST   /api/bills/:id/payments               one tender; call repeatedly to split
POST   /api/bills/:id/void
```

**Split payment needs no special endpoint.** `recalculate()` sums the `payments`
rows and moves the bill `OPEN → PARTIAL → PAID`; post one payment per tender.
Settlement uses a cent of tolerance, because an exact equality test strands
bills a hundredth short.

Every mutation runs in a transaction with the bill row locked (`FOR UPDATE`), so
two tills taking payment at once cannot both think they settled it.

### Discount codes
```
GET    /api/discounts                staff — a cashier must be able to check one
POST   /api/discounts/validate       staff — dry run, returns the refusal sentence
POST   /api/discounts                discounts.manage
PATCH  /api/discounts/:id/status     discounts.manage
DELETE /api/discounts/:id            discounts.manage
GET    /api/discounts/:id/redemptions discounts.manage
```

Three audiences: `public`, `tier` (matched against a live membership tier), and
`customers` (named individuals). Refusals return **200 with `valid: false`** and
a sentence a cashier can read aloud — *"GOLD15 is for GOLD members only"* — not
a 4xx. A rejected code is a normal counter event, not an error.

Redemptions are rows, not a counter on the code. That is what makes a
per-customer limit enforceable, and why a **used code cannot be deleted** — it
would orphan the discount on bills that reference it.

### Catalogue, F&B, orders
```
GET    /api/products/menu                 any token — the station's menu
GET    /api/products, /categories, /inventory/summary
POST   /api/products, /categories
PUT    /api/products/:id, /categories/:id
PATCH  /api/products/:id/availability
POST   /api/products/:id/stock            adjustment + reason
GET    /api/products/:id/movements
POST   /api/orders                        any token — a customer orders from the station
GET    /api/orders, /customer/:customerId
PATCH  /api/orders/:id/status
```

### Packages, memberships, pricing
```
/api/packages           list, create, purchase, consume, cancel
/api/memberships        plans, subscribe, cancel, per-customer
/api/session-master     session definitions
/api/gaming-prices      lookup, matrix, CRUD
```

### Telemetry
```
POST   /api/telemetry                  staff — the console relays a batch
GET    /api/telemetry/latest           telemetry.view — one row per station + verdict
GET    /api/telemetry/alerts           telemetry.view — only what needs attention
GET    /api/telemetry/history/:pcName  telemetry.view — bucketed
DELETE /api/telemetry/:pcName          floor.layout
```

**Every metric column is nullable on purpose.** A counter the machine cannot
read is stored as `null`, never `0` — a zero would read as a healthy idle
machine, which is worse than an honest gap. Temperature is usually null on
consumer hardware; the WMI thermal class needs a driver most vendors omit.

`sampled_at` / `received_at` are `TIMESTAMPTZ`. A bare `TIMESTAMP` picks up the
local offset on write but not on read, which made every fresh sample look hours
stale.

History buckets the window into a fixed number of points, so a 7-day chart costs
the same as an hour.

### Reports
```
GET /api/reports/summary | /revenue | /stations | /hours | /customers | /products
```
All take `?from=&to=`; `/revenue` also takes `?bucket=day|week|month`.

Revenue comes from `bills`, not `sessions.amount_charged` — a bill is the settled
figure after discounts and tax, while a session charge is only the gaming line.
`generate_series` fills gaps, so a quiet day shows as zero rather than being
skipped; a chart that omits quiet days lies about the trend.

Station utilisation is measured against the hours the window spans, not opening
hours — the system does not know those, and inventing them would be fiction.

### Audit
```
GET /api/audit?search=&category=&actor_id=&sensitive=true&from=&to=   audit.view
GET /api/audit/facets                                                 audit.view
GET /api/audit/entity/:entity/:id                                     audit.view
```

Read-only by design. **There is no create, update or delete route** — rows are
written by the actions they describe, via `recordAudit()`, and nothing may edit
them. A trail that can be tidied up afterwards is not evidence.

Actor name and role are **copied in**, not joined, so deleting a staff account
never erases what that account did.

`recordAudit()` swallows its own failures deliberately: losing the record of a
refund is bad, but refusing the refund because the log was down would make the
audit table an outage risk for the whole café.

Instrumented: wallet credit/debit, bill discount/payment/void/code, session
start/pause/resume/extend/transfer/end, staff create/status, role permissions,
settings changes (keeping the **old** value), station power/deactivate/restore/
delete, discount code create/status/delete.

---

## 4. RBAC

**33 permission keys**, four built-in roles.

| Role | Keys | Notes |
|---|---|---|
| Owner | 33 | Everything |
| Manager | 31 | No `staff.manage`, no `settings.manage` — may read settings, not change them |
| Cashier | 17 | Till, payment, discount, sessions, wallet credit |
| Attendant | 10 | Floor, sessions, orders, `wallet.credit` — no billing |

Custom roles and custom permission keys can be created from the console. A
custom key is granted and appears on staff tokens, but **enforces nothing until
code checks it** — the UI says so explicitly.

### ⚠ Enforcement gap — the most important thing in this document

**22 of the 33 keys are not checked by any route.** Only 11 are enforced.

Unenforced today: `floor.view`, `floor.manage`, `sessions.*` (all four),
`customers.view`, `wallet.view`, `wallet.credit`, `wallet.debit`, `billing.view`,
`billing.counter`, `billing.payment`, `billing.discount`, `billing.void`,
`products.view`, `products.manage`, `inventory.adjust`, `pricing.manage`,
`packages.manage`, `orders.view`, `orders.manage`.

Those endpoints sit behind plain `requireStaff`, so **any** staff token passes.
A Cashier can void a bill or debit a wallet today regardless of what their role
says. Granting or withholding those keys changes nothing.

Enforced: `customers.manage`, `floor.layout`, `station.power`, `telemetry.view`,
`discounts.manage`, `reports.view`, `audit.view`, `staff.view`, `staff.manage`,
`settings.view`, `settings.manage`.

The website's `/store` console measures this live and marks the gap amber.
Closing it means replacing `requireStaff` with `requirePermission(key)` across
roughly 60 routes — deliberate work, since it starts refusing things staff can
do today.

---

## 5. Settings

`app_settings` holds what used to be constants. `config/settings.js` caches for
30 s and invalidates on write, so a change takes effect without a restart.

| Key | Default | Meaning |
|---|---|---|
| `session.default_rate_per_hour` | 60 | Fallback hourly rate |
| `session.warn_minutes` / `critical_minutes` | 15 / 5 | Timer states |
| `wallet.currency` | XP | Wallet currency code |
| `wallet.max_transaction` | 1000000 | Largest single movement |
| `station.default_port` | 9090 | Client agent port |
| `station.default_cafe_id` / `default_branch_id` | 1 / 1 | For auto-discovered stations |
| `floor.layout` / `floor.card_size` | grid / normal | Floor arrangement, shared across terminals |
| `telemetry.sample_seconds` | 15 | Station sampling cadence |
| `telemetry.retention_days` | 7 | Prune window |
| `telemetry.cpu_warn` / `mem_warn` / `disk_warn` / `temp_warn` | 85 / 90 / 90 / 85 | Alert thresholds |
| `telemetry.stale_seconds` | 90 | When a station counts as not reporting |

`PUT /api/settings/:key` takes `{ value }` — **not** `{ setting_value }`. The API
updates values; it does not invent keys.

---

## 6. Known issues

| Issue | Impact |
|---|---|
| 22 of 33 permissions unenforced | Roles are advisory on most endpoints |
| `GET /api/auth/users` is open | Exposes the user list without a token |
| `/api/pcs` reads are open | Station names/IPs readable without a token |
| Session billing is elapsed-time only | Packages, memberships and gaming prices are not wired into what a session charges |
| `customers.address` now nullable | Relaxed so staff can register a walk-in without one |
