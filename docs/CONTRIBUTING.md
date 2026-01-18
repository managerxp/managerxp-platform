# Contributing to ManagerXP

Thanks for contributing to ManagerXP.  
This repository follows a simple and disciplined workflow to keep production stable and staging always up-to-date.

---

## Branch Strategy

We use two permanent branches:

### `main` (Production)
- Always stable
- Represents production-ready code
- Only updated after staging is verified

### `develop` (Staging)
- Integration branch for all new work
- Represents staging-ready code
- Must stay in sync with `main` after every production release

---

## Contribution Workflow (Required)

Every change must follow this flow:

1. Create a new branch from `develop`
2. Work on your task
3. Test it locally
4. Merge into `develop`
5. Deploy/test on staging from `develop`
6. If everything works, merge `develop` → `main`

✅ This ensures:
- `main` stays production-safe
- `develop` always stays staging-ready
- Changes are tested before production release

---

## Step-by-Step: How to Work

### 1) Switch to develop and pull latest code
```bash
git checkout develop
git pull origin develop
````

### 2) Create a new feature branch from develop

```bash
git checkout -b feature/your-branch-name
```

### 3) Work on your changes

Make changes in code, then commit them:

```bash
git add .
git commit -m "your commit message"
```

### 4) Push your branch to GitHub

```bash
git push origin feature/your-branch-name
```

### 5) Merge into develop

Once tested locally:

* open a Pull Request (recommended)
  OR
* merge manually

✅ PR Target branch should always be:
➡️ `develop`

---

## Branch Naming Convention (Simple)

Use one of these formats:

### Feature work

```
feature/<short-description>
```

Example:

```
feature/customer-crm
feature/rig-session-timer
```

### Bug fix

```
fix/<short-description>
```

Example:

```
fix/payment-ledger-bug
fix/websocket-disconnect
```

### Documentation

```
docs/<short-description>
```

Example:

```
docs/setup-guide
docs/readme-update
```

### Refactoring / cleanup

```
chore/<short-description>
```

Example:

```
chore/code-cleanup
chore/update-deps
```

---

## Local Testing (Required)

Before merging to `develop`, you must test locally:

✅ Backend:

* API endpoints should work
* Database changes should be verified
* WebSocket changes should be tested

✅ Web (Next.js):

* No UI break
* Pages load correctly
* API integration works

✅ Desktop (Electron):

* App launches
* Rig status sync works (if applicable)

If a feature needs setup steps (env vars / DB changes), mention it clearly in the PR or commit.

---

## Staging Testing (After merging to develop)

After your code is merged into `develop`:

* it should be tested on staging
* any issues found should be fixed via another branch and merged back into `develop`

Once staging is stable:
✅ merge `develop` → `main`

---

## Sync Rules (Very Important)

After merging `develop` into `main`, ensure branches remain synced.

✅ Recommended:

* Merge `main` back into `develop` if anything changed during release
* Or enforce "develop always ahead of main only by verified changes"

---

## Workflow Pipelines (CI/CD)

### Who can run pipelines?

* Only users with the required repository permissions can trigger pipelines:

  * **Write**: can trigger workflows by pushing commits
  * **Maintain/Admin**: can re-run workflows, approve, and manage checks

### Workflow Rules

* Always keep pipeline green on `develop` and `main`
* Never merge broken pipeline code into `main`

If workflow fails:

* fix the issue in a new branch from `develop`
* merge into `develop`
* verify again

---

## Code Quality Guidelines

* Keep changes small and focused
* Follow folder structure
* Do not hardcode secrets
* Keep reusable logic in shared modules/utilities
* Do not push `.env` files or credentials

---

## Need Help?

If you are blocked by permissions or cannot push/merge:
➡️ Check [ACCESS.md](./ACCESS.md) or contact the admin.
---
