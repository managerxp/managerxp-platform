# Access & Permissions

This repository is managed under a GitHub Organization.  
Each member has a role that decides what actions they can perform.

If something is not working (push denied, merge blocked, workflows not running), check your role below.

---

## Roles

### Read
✅ Can: view code, clone repo, open/comment on issues  
❌ Cannot: push code, create branches, merge, run workflows

### Triage
✅ Can: everything in Read + manage issues/labels  
❌ Cannot: push code, merge PRs, change settings

### Write
✅ Can: create branches, push code, open PRs, trigger workflows by pushing commits  
❌ Cannot: change repo settings, delete repo, manage protections

### Maintain
✅ Can: merge PRs, re-run workflows, manage repo (limited settings)  
❌ Cannot: delete/transfer repo ownership

### Admin
✅ Full control: permissions, settings, branch protection, secrets, workflows

---

## Branch Rules (Important)

- `main` → Production (stable only)
- `develop` → Staging (testing + integration)

✅ Do not push directly to `main` or `develop`  
✅ Always create a feature branch and merge into `develop` first

---

## Common Problems

### Push denied / permission denied
- You likely don’t have **Write** access OR tried pushing to a protected branch  
✅ Fix: create a branch and push there

### Cannot merge PR
- Only **Maintain/Admin** can merge  
✅ Fix: request a maintainer/admin

### Workflow not running
- Only **Write+** can trigger workflows (by pushing code)  
✅ Fix: ask admin for Write access

---

## Need Help / Access Upgrade?

Contact Admin: **@managerxp**  
Include:
- your GitHub username
- what you were trying to do
- screenshot/error message
