# GitHub CI/CD — ManagerXP (ClientXP / ServerXP)

This documents the CI/CD pipeline actually implemented in this repo — not a
generic template. If something here doesn't match what you see in
`.github/workflows/`, the workflow files are the source of truth.

## Architecture

Two independently-buildable Electron apps in one repo, each with its own
`package.json`, its own `electron-builder` config, and its own CI workflow
gated by path filters so one app's changes never trigger the other's build.
A third workflow handles production releases for both together.

```
push to feature branch
  → PR into develop
  → clientxp-ci.yml / serverxp-ci.yml (whichever app changed)
  → merge into develop
  → PR into main
  → tag v1.2.3 on main
  → release.yml: build both → GitHub Release → register with backend
```

## Repository structure

See the root [README.md](../README.md#repository-structure).

## Branching strategy

Kept as already documented in [CONTRIBUTING.md](CONTRIBUTING.md):
`main` / `develop` permanent branches, `feature/*` `fix/*` `docs/*` `chore/*`
short-lived branches off `develop`. The brief this CI/CD setup was built from
suggested an app-prefixed convention (`feature/serverxp-xxx`); that wasn't
adopted since it would duplicate what the CI workflows' own path filters
already do — telling ClientXP's pipeline apart from ServerXP's — without
needing branch names to carry it too.

## Commit conventions

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`,
`test:`. Not enforced by a git hook or CI check today — if that changes,
document it here.

## Local development

```bash
cd client-app && npm install && npm start   # ClientXP
cd server-app && npm install && npm start   # ServerXP
```

Both need the backend (`Manager-XP-Website/backend`) running and their own
`.env` — see `.env.example` at the repo root.

### Building an installer locally

```bash
cd client-app && npm run dist   # client-app/dist/CafeXP-Client-Setup-<version>.exe
cd server-app && npm run dist   # server-app/dist/CafeXP-Console-Setup-<version>.exe
```

If this fails locally with `Cannot create symbolic link: A required
privilege is not held by the client` (from `electron-builder`'s `winCodeSign`
step), that's a Windows Developer Mode setting, not a build config problem —
see Troubleshooting below. It does not affect GitHub Actions' hosted
`windows-latest` runners.

## CI workflows

**`clientxp-ci.yml`** / **`serverxp-ci.yml`** — near-identical, one per app:

- Triggers: PR into `main`/`develop`, and push to `develop`.
- Path-filtered to that app's own directory, so an unrelated app's PR never
  runs this build.
- `windows-latest`, Node 24.x, `npm ci`, `npm run lint --if-present`,
  `npm test --if-present`, then `npm run dist` (`--publish never` — CI never
  publishes anything; only `release.yml` does, and only from a tag).
- No `continue-on-error` anywhere — a real lint/test/build failure fails the
  check, on purpose.

Neither app currently has a `lint` or `test` script, so those two steps are
harmless no-ops (`--if-present`) until one is added — this documents that
plainly rather than pretending they run something today.

## Release process

**`release.yml`** triggers on a pushed tag matching `v*.*.*`:

1. **build-clientxp** and **build-serverxp** run in parallel on
   `windows-latest`. Each sets that app's `package.json` version from the
   tag (`npm version <x.y.z> --no-git-tag-version`) before building, so the
   artifact filename and the in-app version always match the tag exactly —
   you never need to hand-edit `package.json` before tagging. Each uploads
   its installer + `latest*.yml` + `.blockmap` as a build artifact.
2. **release** (needs both, runs on `ubuntu-latest`) downloads both
   artifacts, creates one GitHub Release via `softprops/action-gh-release`
   with all files attached, then reads each `latest.yml` for its `sha512`
   and calls `POST /api/platform/releases` on the ManagerXP backend once per
   component (`client`, `server`) — the exact same endpoint the admin
   console's own "Publish release" screen uses (see
   `Manager-XP-Website/backend/src/controllers/updates.Controller.js`).

A single coordinated `release` job — not two independent ones — creates the
GitHub Release, avoiding two jobs racing to create the same release.

### Tagging a release

```bash
git checkout main
git pull
git tag v1.2.0
git push origin v1.2.0
```

## Versioning

Semantic versioning, one shared number across both apps per release:
`v1.2.0` means `CafeXP-Client-Setup-1.2.0.exe` and
`CafeXP-Console-Setup-1.2.0.exe` are built and released together — matching
how the admin release UI already tracks a `client` and `server` component
under the same version line.

## GitHub Secrets

| Secret | Required | Used by |
|---|---|---|
| `MANAGERXP_API_URL` | Yes, for the automated backend registration step | `release.yml` |
| `MANAGERXP_ADMIN_TOKEN` | Yes, same as above | `release.yml` — sent as `Authorization: Bearer` to `POST /api/platform/releases` |
| `WIN_CSC_LINK` | Only if signing | `clientxp-ci.yml`, `serverxp-ci.yml`, `release.yml` |
| `WIN_CSC_KEY_PASSWORD` | Only if signing | same |

`GITHUB_TOKEN` is provided automatically by Actions; `release.yml` declares
`permissions: contents: write` so `softprops/action-gh-release` can create
the release without a separate PAT.

**`MANAGERXP_ADMIN_TOKEN` is not an admin login.** It's a single opaque
value, generated once (e.g. `openssl rand -hex 32`), stored in exactly two
places: this repo's GitHub Secrets, and the backend's own deployment
environment as `RELEASE_PUBLISH_TOKEN`. It has power over exactly one
endpoint — see "The backend change" below.

## Code signing

Not configured — no certificate exists, and none was invented. Both
`electron-builder` configs sign automatically the moment `WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD` are present as environment variables (this is
`electron-builder`'s own built-in behaviour, not custom code here), and stay
unsigned otherwise. To turn signing on:

1. Base64-encode your `.pfx`/`.p12` certificate file.
2. Add it as the GitHub Secret `WIN_CSC_LINK` (the base64 string, not the
   file), and the certificate's password as `WIN_CSC_KEY_PASSWORD`.
3. Nothing else changes — the next tagged release signs automatically.

Never commit a certificate file. Never paste one into chat, an issue, or a
commit message.

## Electron packaging

Both apps use `electron-builder` (`^25.1.8`), NSIS target, x64, matching the
config style client-app already had (server-app's is new — it had no
packaging config at all before this).

| | ClientXP | ServerXP |
|---|---|---|
| appId | `com.managerxp.cafexp.client` | `com.managerxp.cafexp.console` |
| productName | CafeXP Client | CafeXP Console |
| Installer name | `CafeXP-Client-Setup-<version>.exe` | `CafeXP-Console-Setup-<version>.exe` |

**Two real bugs fixed while wiring this up**, both pre-existing and never
caught because neither app had ever actually been packaged before:

1. `electron` was listed in `dependencies` in both apps' `package.json`.
   `electron-builder` refuses to build with it there — it must be in
   `devDependencies` (the binary is never bundled into the app; it *is* the
   installer). Fixed in both.
2. `server-app/Images/icon.png` is 212×148 — `electron-builder` requires at
   least 256×256 for a Windows icon. **This is not yet fixed** — a properly
   sized, square "CafeXP Console" icon still needs to be supplied (not
   invented here, since choosing the console's icon is a product decision).
   Until it is, `server-app`'s `dist`/`release.yml` build will fail at the
   icon-conversion step. `client-app/Images/icon.png` (1254×1254) is fine.

Also worth knowing: `client-app`'s packaging config (the `build` block,
`electron-updater` dependency, `dist` scripts) existed only on the `feature`
branch this work started from — `develop` had none of it. It's been carried
into this branch as part of making ClientXP CI buildable at all; it wasn't
newly invented.

## ClientXP auto-update

`client-app/updater.js` is a complete, session-aware `electron-updater`
wrapper: never installs over a live customer session, downloads in the
background, defers install until the station is idle, and is driven
entirely by whatever the console/backend tells it (no local config it could
be tricked into pointing elsewhere). **It is never required/imported
anywhere in `main.js`** — so no station updates automatically today, despite
the backend's side of this (`client_releases`, `/api/updates/check`,
`/api/updates/mine`) being fully built and now fed automatically by
`release.yml`.

Wiring the two together is a separate, real piece of work — not done as
part of this CI/CD setup — and needs a decision this doc flags rather than
makes: `updater.js` calls `autoUpdater.setFeedURL({ provider: "generic", url:
feedUrl })`, and the *generic* provider fetches `<feedUrl>/latest.yml`
itself. A GitHub Release's per-tag asset prefix
(`https://github.com/<owner>/<repo>/releases/download/<tag>`) works for this
as long as `latest.yml` is uploaded to that same tag — which `release.yml`
already does — so `feedUrl` would need to resolve to that prefix rather than
the single installer URL `client_releases.download_url` currently stores.

## ServerXP upgrade process

ServerXP is the café's admin console — an operator-facing app, not something
a customer sits in front of. It has no packaged installer or update
mechanism (until this CI/CD change added the installer). No auto-update was
added for it here: given it's operator-run and holds no local database of
its own (all state is in the backend), the safe path is a manual reinstall
from a published `CafeXP-Console-Setup-<version>.exe` when an operator
chooses to upgrade — automatic, unattended ServerXP updates were deliberately
not built, matching the same caution the brief this was built from asked for
around anything that could interrupt a live station mid-shift.

## Troubleshooting

**`Cannot create symbolic link: A required privilege is not held by the
client`** during a local `npm run dist` — Windows Developer Mode is off on
this machine (`electron-builder`'s `winCodeSign` helper needs
`SeCreateSymbolicLinkPrivilege` to unpack). Turn on Developer Mode
(Settings → Privacy & Security → For Developers) to build locally, or just
trust GitHub Actions' `windows-latest` runners, which don't have this
restriction.

**`image ... must be at least 256x256`** — the icon referenced in that app's
`build.icon`/`build.win.icon` is too small. See ServerXP's known gap above.

**`Package "electron" is only allowed in "devDependencies"`** — exactly what
it says; move it there, not into `dependencies`.

**ClientXP CI/ServerXP CI didn't run on my PR** — check the path filter: a
PR touching only the other app, or only files outside both `client-app/**`
and `server-app/**`, is not expected to trigger either.

## Release checklist

- [ ] `develop` merged into `main` via PR, checks green
- [ ] Both apps' `package.json` `version` doesn't need manual editing —
      `release.yml` sets it from the tag
- [ ] Tag pushed as `vMAJOR.MINOR.PATCH` from `main`
- [ ] `release.yml` run completed: both builds green, GitHub Release
      created with 6 files attached (installer + `.yml` + `.blockmap` ×2),
      backend registration step succeeded for both components
- [ ] Spot-check the release on GitHub: correct version, correct two
      installers present
- [ ] Spot-check `GET /api/platform/releases` on the backend (or the admin
      console's own release screen) shows both new rows published
