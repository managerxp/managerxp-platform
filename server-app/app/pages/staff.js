/* ==========================================================================
   CafeXP Admin — Staff and Roles
   Staff accounts, and the permission matrix that decides what each role can
   do. The server enforces every rule here; this screen just makes it legible.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var tab = "people";
  var staff = [];
  var roles = [];
  var permissionGroups = {};
  var loading = false;
  var loadError = null;
  var searchQuery = "";
  var searchTimer = null;

  var CATEGORY_LABEL = {
    floor: "Floor", sessions: "Sessions", customers: "Customers", wallet: "Wallet",
    billing: "Billing", catalogue: "Catalogue", orders: "Orders", staff: "Staff", system: "System"
  };

  function load() {
    loading = true;
    loadError = null;
    render();
    return Promise.all([
      Store.listStaff({ search: searchQuery }),
      Store.listRoles(),
      Store.listPermissions()
    ])
      .then(function (res) {
        staff = res[0].data || [];
        roles = res[1] || [];
        permissionGroups = res[2].grouped || {};
        loading = false;
        render();
      })
      .catch(function (err) { loading = false; loadError = err.message; render(); });
  }

  /* ==========================================================================
     STAFF FORM
     ========================================================================== */
  function staffForm(existing) {
    var isEdit = !!existing;
    var body = UI.el("div", { class: "col gap-4" });

    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="stName">Name</label>' +
          '<input class="input" id="stName" placeholder="Priya" value="' +
            UI.esc(existing ? existing.staff_name : "") + '" data-autofocus></div>' +
        '<div class="field"><label class="field-label" for="stPhone">Mobile</label>' +
          '<input class="input" id="stPhone" value="' +
            UI.esc(existing && existing.phone_number ? existing.phone_number : "") + '"></div>' +
      "</div>" +
      '<div class="field"><label class="field-label field-req" for="stEmail">Email — used to sign in</label>' +
        '<input class="input" id="stEmail" type="email" value="' +
          UI.esc(existing ? existing.email : "") + '"></div>' +
      '<div class="field"><label class="field-label field-req" for="stRole">Role</label>' +
        '<select class="select" id="stRole">' +
          roles.map(function (r) {
            return '<option value="' + r.role_id + '"' +
              (existing && existing.role_id === r.role_id ? " selected" : "") + ">" +
              UI.esc(r.role_name) + " — " + r.permissions.length + " permissions</option>";
          }).join("") +
        "</select>" +
        '<div class="field-hint" id="stRoleHint"></div></div>' +
      '<div class="field"><label class="field-label' + (isEdit ? "" : " field-req") + '" for="stPassword">' +
        (isEdit ? "New password" : "Password") + "</label>" +
        '<input class="input" id="stPassword" type="password" placeholder="' +
          (isEdit ? "Leave blank to keep the current one" : "At least 6 characters") + '">' +
        '<div class="field-hint">Minimum 6 characters.</div></div>';

    var dialog = UI.modal({
      title: isEdit ? "Edit staff member" : "Add staff member",
      description: isEdit ? existing.staff_name : "They sign in on the admin console with this email.",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: isEdit ? "Save changes" : "Add staff member", variant: "primary", icon: "check",
          onClick: function (ctx) {
            var payload = {
              staff_name: ctx.body.querySelector("#stName").value.trim(),
              email: ctx.body.querySelector("#stEmail").value.trim(),
              phone_number: ctx.body.querySelector("#stPhone").value.trim() || null,
              role_id: parseInt(ctx.body.querySelector("#stRole").value, 10),
              cafe_id: (Store.state.user && Store.state.user.cafe_id) || null
            };
            var password = ctx.body.querySelector("#stPassword").value;
            if (password) payload.password = password;

            if (!payload.staff_name || !payload.email) {
              Motion.shake(ctx.node);
              UI.toast.warn("A name and email are required");
              return false;
            }
            if (!isEdit && (!password || password.length < 6)) {
              Motion.shake(ctx.body.querySelector("#stPassword"));
              UI.toast.warn("Set a password of at least 6 characters");
              return false;
            }

            var call = isEdit
              ? Store.updateStaff(existing.staff_id, payload)
              : Store.createStaff(payload);

            return call
              .then(function (r) {
                UI.toast.ok(isEdit ? "Staff member updated" : "Staff member added", r.data.staff_name);
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not save", err.message); return false; });
          }
        }
      ]
    });

    // Show what the chosen role actually grants, so the decision is informed.
    var roleSelect = body.querySelector("#stRole");
    var hint = body.querySelector("#stRoleHint");
    function refreshHint() {
      var role = roles.filter(function (r) {
        return r.role_id === parseInt(roleSelect.value, 10);
      })[0];
      hint.textContent = role
        ? (role.description || "") + " Grants: " + role.permissions.slice(0, 5).join(", ") +
          (role.permissions.length > 5 ? " and " + (role.permissions.length - 5) + " more." : ".")
        : "";
    }
    roleSelect.addEventListener("change", refreshHint);
    refreshHint();

    return dialog;
  }

  /* ==========================================================================
     PERMISSION MATRIX
     ========================================================================== */
  function permissionEditor(role) {
    var isOwner = role.is_system && role.role_name.toLowerCase() === "owner";
    var selected = role.permissions.slice();

    var body = UI.el("div", { class: "col gap-4" });

    if (isOwner) {
      body.innerHTML =
        '<div class="notice" data-status="warning">' + Icon("alert", 16) +
        "<div>The Owner role always holds every permission. Reducing it could lock the café " +
        "out of its own console, so it is fixed.</div></div>";
    }

    Object.keys(permissionGroups).forEach(function (category) {
      var section = UI.el("div", { class: "card card-pad col gap-3" });
      section.innerHTML = '<div class="eyebrow">' +
        UI.esc(CATEGORY_LABEL[category] || category) + "</div>";

      permissionGroups[category].forEach(function (perm) {
        var held = selected.indexOf(perm.permission_key) !== -1;
        var row = UI.el("label", {
          class: "switch row-between",
          style: { width: "100%", cursor: isOwner ? "not-allowed" : "pointer" }
        });
        row.innerHTML =
          "<span style='min-width:0'>" +
            "<span style='font-size:13px;font-weight:600;display:block'>" +
              UI.esc(perm.description || perm.permission_key) + "</span>" +
            "<span class='faint mono' style='font-size:10px'>" + UI.esc(perm.permission_key) +
            (perm.is_custom ? " · custom" : "") + "</span>" +
          "</span>" +
          '<span class="row gap-2"><input type="checkbox"' +
            (held ? " checked" : "") + (isOwner ? " disabled" : "") +
            ' data-perm="' + UI.esc(perm.permission_key) + '">' +
            '<span class="switch-track"></span></span>';

        row.querySelector("input").addEventListener("change", function (e) {
          var key = e.target.dataset.perm;
          if (e.target.checked) {
            if (selected.indexOf(key) === -1) selected.push(key);
          } else {
            selected = selected.filter(function (k) { return k !== key; });
          }
          count.textContent = selected.length + " granted";
        });
        section.appendChild(row);
      });
      body.appendChild(section);
    });

    var count = UI.el("span", { class: "badge badge-lg", text: selected.length + " granted" });

    return UI.modal({
      title: "Permissions — " + role.role_name,
      description: role.is_system ? "Built-in role" : "Custom role",
      size: "lg",
      body: body,
      actions: [
        { label: isOwner ? "Close" : "Cancel", variant: "ghost" },
        isOwner ? null : {
          label: "Save permissions", variant: "primary", icon: "check",
          onClick: function () {
            return Store.setRolePermissions(role.role_id, selected)
              .then(function (r) {
                UI.toast.ok(r.message, role.role_name);
                // Anyone signed in with this role keeps their old rights until
                // they sign in again, so say so rather than let it surprise.
                if (role.staff_count > 0) {
                  UI.toast.info(
                    "Takes effect at next sign-in",
                    role.staff_count + " staff member(s) hold this role."
                  );
                }
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not save", err.message); return false; });
          }
        }
      ].filter(Boolean)
    });
  }

  function roleForm() {
    var selected = [];

    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label field-req" for="roleName">Role name</label>' +
          '<input class="input" id="roleName" placeholder="Shift Lead" data-autofocus></div>' +
        '<div class="field"><label class="field-label" for="roleCopy">Start from</label>' +
          '<select class="select" id="roleCopy"><option value="">Nothing — pick manually</option>' +
            roles.map(function (r) {
              return '<option value="' + r.role_id + '">' + UI.esc(r.role_name) +
                " (" + r.permissions.length + ")</option>";
            }).join("") +
          "</select></div>" +
      "</div>" +
      '<div class="field"><label class="field-label" for="roleDesc">Description</label>' +
        '<input class="input" id="roleDesc" placeholder="What this role is for"></div>' +
      '<div class="row-between"><span class="field-label">Permissions</span>' +
        '<span class="badge badge-lg" id="rolePermCount">0 selected</span></div>' +
      '<div id="rolePerms" class="col gap-3" style="max-height:320px;overflow:auto"></div>';

    var dialog = UI.modal({
      title: "Add role",
      description: "Choose what this role may do — you can change it later.",
      size: "lg",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Create role", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var name = ctx.body.querySelector("#roleName").value.trim();
            if (!name) {
              Motion.shake(ctx.body.querySelector("#roleName"));
              UI.toast.warn("A role name is required");
              return false;
            }
            return Store.createRole({
              role_name: name,
              description: ctx.body.querySelector("#roleDesc").value.trim() || null,
              permissions: selected,
              cafe_id: (Store.state.user && Store.state.user.cafe_id) || null
            })
              .then(function (r) { UI.toast.ok(r.message, name); return load(); })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not create", err.message); return false; });
          }
        }
      ]
    });

    var permsHost = body.querySelector("#rolePerms");
    var countBadge = body.querySelector("#rolePermCount");

    function syncCount() { countBadge.textContent = selected.length + " selected"; }

    function paintPerms() {
      UI.clear(permsHost);
      Object.keys(permissionGroups).forEach(function (category) {
        var section = UI.el("div", { class: "card card-pad col gap-2" });
        section.innerHTML = '<div class="eyebrow">' +
          UI.esc(CATEGORY_LABEL[category] || category) + "</div>";

        permissionGroups[category].forEach(function (perm) {
          var row = UI.el("label", { class: "switch row-between", style: { width: "100%" } });
          row.innerHTML =
            "<span style='min-width:0'>" +
              "<span style='font-size:13px;font-weight:600;display:block'>" +
                UI.esc(perm.description || perm.permission_key) + "</span>" +
              "<span class='faint mono' style='font-size:10px'>" + UI.esc(perm.permission_key) +
              (perm.is_custom ? " · custom" : "") + "</span>" +
            "</span>" +
            '<span class="row gap-2"><input type="checkbox"' +
              (selected.indexOf(perm.permission_key) !== -1 ? " checked" : "") +
              ' data-perm="' + UI.esc(perm.permission_key) + '">' +
              '<span class="switch-track"></span></span>';

          row.querySelector("input").addEventListener("change", function (e) {
            var key = e.target.dataset.perm;
            if (e.target.checked) {
              if (selected.indexOf(key) === -1) selected.push(key);
            } else {
              selected = selected.filter(function (k) { return k !== key; });
            }
            syncCount();
          });
          section.appendChild(row);
        });
        permsHost.appendChild(section);
      });
    }

    // Copying an existing role is the fast path for "like Cashier, but…".
    body.querySelector("#roleCopy").addEventListener("change", function (e) {
      var source = roles.filter(function (r) { return r.role_id === parseInt(e.target.value, 10); })[0];
      selected = source ? source.permissions.slice() : [];
      paintPerms();
      syncCount();
    });

    paintPerms();
    syncCount();
    return dialog;
  }

  /* ==========================================================================
     CUSTOM PERMISSION
     ========================================================================== */
  function customPermissionForm() {
    var body = UI.el("div", { class: "col gap-4" });
    body.innerHTML =
      '<div class="field"><label class="field-label field-req" for="permKey">Permission key</label>' +
        '<input class="input mono" id="permKey" placeholder="reports.export" data-autofocus>' +
        '<div class="field-hint">Lower case, in the form <strong>area.action</strong>.</div></div>' +
      '<div class="grid grid-2" style="gap:var(--s-3)">' +
        '<div class="field"><label class="field-label" for="permCategory">Category</label>' +
          '<input class="input" id="permCategory" placeholder="custom" value="custom"></div>' +
        '<div class="field"><label class="field-label" for="permDesc">Description</label>' +
          '<input class="input" id="permDesc" placeholder="What it allows"></div>' +
      "</div>" +
      '<div class="notice" data-status="warning">' + Icon("alert", 16) +
        "<div>A custom key can be granted to roles and appears on staff tokens, but it " +
        "<strong>enforces nothing on its own</strong> — the application has to check it before it gates anything. " +
        "Use it to prepare for work that is coming, or to record a rule your team applies by hand.</div></div>";

    return UI.modal({
      title: "Add custom permission",
      body: body,
      actions: [
        { label: "Cancel", variant: "ghost" },
        {
          label: "Add permission", variant: "primary", icon: "plus",
          onClick: function (ctx) {
            var key = ctx.body.querySelector("#permKey").value.trim().toLowerCase();
            if (!/^[a-z0-9]+(\.[a-z0-9_-]+)+$/.test(key)) {
              Motion.shake(ctx.body.querySelector("#permKey"));
              UI.toast.warn("Use the area.action form", "For example reports.export");
              return false;
            }
            return Store.createPermission({
              permission_key: key,
              category: ctx.body.querySelector("#permCategory").value.trim() || "custom",
              description: ctx.body.querySelector("#permDesc").value.trim() || null
            })
              .then(function () {
                UI.toast.ok("Permission added", key);
                return load();
              })
              .then(function () { return true; })
              .catch(function (err) { UI.toast.error("Could not add", err.message); return false; });
          }
        }
      ]
    });
  }

  /* ==========================================================================
     RENDER
     ========================================================================== */
  function render() {
    if (!rootEl) return;
    var host = rootEl.querySelector("#staffBody");
    if (!host) return;
    UI.clear(host);

    if (loading && !staff.length && !roles.length) { host.appendChild(UI.skeletonRows(6)); return; }
    if (loadError) {
      host.appendChild(UI.errorState(
        loadError === "Your role does not allow this (staff.view)"
          ? "Your role does not allow you to see staff accounts."
          : loadError,
        load
      ));
      return;
    }

    if (tab === "roles") { renderRoles(host); return; }

    if (!staff.length) {
      host.appendChild(UI.emptyState({
        icon: "staff",
        title: searchQuery ? "No staff match" : "No staff accounts yet",
        text: searchQuery
          ? "Nothing matches that search."
          : "Add the people who work here. Each gets their own sign-in and only the access their role allows.",
        actions: [{
          label: searchQuery ? "Clear search" : "Add staff member",
          icon: searchQuery ? "close" : "plus", variant: "primary",
          onClick: function () {
            if (searchQuery) {
              searchQuery = "";
              rootEl.querySelector("#staffSearch").value = "";
              load();
            } else staffForm(null);
          }
        }]
      }));
      return;
    }

    var table = UI.el("table", { class: "tbl" });
    table.innerHTML =
      "<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last signed in</th>" +
      "<th>Status</th><th></th></tr></thead>";
    var tbody = UI.el("tbody");

    staff.forEach(function (person) {
      var active = person.status === "ACTIVE";
      var tr = UI.el("tr", { dataset: { status: active ? "online" : "idle" } });
      tr.innerHTML =
        '<td><div class="row gap-3">' +
          '<span class="avatar" style="width:28px;height:28px;font-size:11px">' +
            UI.esc(UI.initials(person.staff_name)) + "</span>" +
          "<strong>" + UI.esc(person.staff_name) + "</strong></div></td>" +
        '<td class="faint" style="font-size:12px">' + UI.esc(person.email) + "</td>" +
        '<td><span class="badge badge-plain">' + UI.esc(person.role_name) + "</span></td>" +
        "<td>" + (person.last_login_at
          ? UI.esc(UI.relTime(person.last_login_at))
          : '<span class="faint">Never</span>') + "</td>" +
        '<td><span class="badge">' + (active ? "Active" : "Deactivated") + "</span></td>" +
        '<td class="td-actions"></td>';

      var actions = tr.querySelector(".td-actions");

      var edit = UI.el("button", {
        class: "btn btn-outline btn-sm btn-icon", html: Icon("edit", 13), "data-tip": "Edit"
      });
      edit.addEventListener("click", function () { staffForm(person); });

      var toggle = UI.el("button", {
        class: "btn btn-sm btn-icon " + (active ? "btn-warn" : "btn-ok"),
        html: Icon(active ? "pause" : "check", 13),
        "data-tip": active ? "Deactivate — blocks sign-in" : "Reactivate"
      });
      toggle.addEventListener("click", function () {
        var next = active ? "INACTIVE" : "ACTIVE";
        var apply = function () {
          Store.setStaffStatus(person.staff_id, next)
            .then(function (r) { UI.toast.ok(r.message, person.staff_name); return load(); })
            .catch(function (e) { UI.toast.error("Could not update", e.message); });
        };
        if (!active) return apply();
        UI.confirm({
          title: "Deactivate " + person.staff_name + "?",
          message: "They will not be able to sign in until reactivated. Their history is kept.",
          confirmLabel: "Deactivate", variant: "danger"
        }).then(function (ok) { if (ok) apply(); });
      });

      actions.appendChild(edit);
      actions.appendChild(toggle);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    var wrap = UI.el("div", { class: "table-wrap" });
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* Every permission the catalogue holds, flattened — used for the custom list. */
  function allPermissions() {
    return Object.keys(permissionGroups).reduce(function (acc, category) {
      return acc.concat(permissionGroups[category]);
    }, []);
  }

  function renderCustomPermissions(host) {
    var custom = allPermissions().filter(function (p) { return p.is_custom; });

    var bar = UI.el("div", {
      class: "card card-pad col gap-3",
      style: { margin: "var(--s-5)" }
    });
    bar.innerHTML =
      '<div class="row-between">' +
        "<div><div class='eyebrow'>Permission catalogue</div>" +
          '<div class="faint" style="font-size:11px;margin-top:2px">' +
            allPermissions().length + " keys · " + custom.length + " added by you. " +
            "A custom key can be granted to a role, but only enforces something once the app checks it." +
          "</div></div>" +
        '<button class="btn btn-outline btn-sm" id="permAdd"></button>' +
      "</div>" +
      (custom.length ? '<div class="col gap-2" id="permList"></div>' : "");

    var addBtn = bar.querySelector("#permAdd");
    addBtn.innerHTML = Icon("plus", 13) + '<span class="btn-label">Add permission</span>';
    addBtn.addEventListener("click", customPermissionForm);

    var list = bar.querySelector("#permList");
    if (list) {
      custom.forEach(function (perm) {
        var row = UI.el("div", { class: "kv row-between" });
        row.innerHTML =
          "<span style='min-width:0'>" +
            "<span class='mono' style='font-size:12px;font-weight:600'>" +
              UI.esc(perm.permission_key) + "</span>" +
            (perm.description
              ? "<span class='faint' style='font-size:11px;display:block'>" +
                UI.esc(perm.description) + "</span>"
              : "") +
          "</span>";

        var del = UI.el("button", {
          class: "btn btn-danger btn-sm btn-icon", html: Icon("trash", 13),
          "data-tip": "Remove from the catalogue"
        });
        del.addEventListener("click", function () {
          UI.confirm({
            title: "Remove " + perm.permission_key + "?",
            message: "It is revoked from every role that holds it. Built-in keys are unaffected.",
            confirmLabel: "Remove", variant: "danger"
          }).then(function (ok) {
            if (!ok) return;
            Store.deletePermission(perm.permission_key)
              .then(function () { UI.toast.ok("Permission removed", perm.permission_key); return load(); })
              .catch(function (e) { UI.toast.error("Could not remove", e.message); });
          });
        });

        row.appendChild(del);
        list.appendChild(row);
      });
    }

    host.appendChild(bar);
  }

  function renderRoles(host) {
    renderCustomPermissions(host);
    var grid = UI.el("div", { class: "grid grid-3", style: { padding: "0 var(--s-5) var(--s-5)" } });

    roles.forEach(function (role) {
      var card = UI.el("div", {
        class: "card card-pad col gap-3",
        dataset: { status: role.is_system ? "accent" : "online" }
      });
      card.innerHTML =
        '<div class="row-between" style="align-items:flex-start">' +
          "<div><div style='font-size:18px;font-weight:750'>" + UI.esc(role.role_name) + "</div>" +
            (role.description
              ? '<div class="faint" style="font-size:11px;margin-top:2px">' + UI.esc(role.description) + "</div>"
              : "") + "</div>" +
          '<span class="badge">' + (role.is_system ? "Built-in" : "Custom") + "</span>" +
        "</div>" +
        '<div class="row gap-5" style="margin-top:var(--s-2)">' +
          "<div><div class='session-label'>Permissions</div>" +
            '<div style="font-size:22px;font-weight:750">' + role.permissions.length + "</div></div>" +
          "<div><div class='session-label'>Staff</div>" +
            '<div style="font-size:22px;font-weight:750">' + role.staff_count + "</div></div>" +
        "</div>";

      var actions = UI.el("div", { class: "row gap-2", style: { marginTop: "auto", paddingTop: "var(--s-4)" } });
      var editBtn = UI.el("button", {
        class: "btn btn-outline btn-sm grow",
        html: Icon("settings", 13) + '<span class="btn-label">Permissions</span>'
      });
      editBtn.addEventListener("click", function () { permissionEditor(role); });
      actions.appendChild(editBtn);

      if (!role.is_system) {
        var del = UI.el("button", {
          class: "btn btn-danger btn-sm btn-icon", html: Icon("trash", 13), "data-tip": "Delete role"
        });
        del.addEventListener("click", function () {
          UI.confirm({
            title: "Delete " + role.role_name + "?",
            message: role.staff_count
              ? "This role is held by " + role.staff_count + " staff member(s) and cannot be deleted yet."
              : "This cannot be undone.",
            confirmLabel: "Delete", variant: "danger"
          }).then(function (ok) {
            if (!ok) return;
            Store.deleteRole(role.role_id)
              .then(function () { UI.toast.ok("Role deleted", role.role_name); return load(); })
              .catch(function (e) { UI.toast.error("Could not delete", e.message); });
          });
        });
        actions.appendChild(del);
      }

      card.appendChild(actions);
      grid.appendChild(card);
    });

    host.appendChild(grid);
    Motion.stagger(grid.children, { step: 0.04, y: 12 });
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.staff = {
    title: "Staff",
    subtitle: "Accounts, roles and permissions",

    mount: function (root) {
      rootEl = root;
      var me = Store.state.me;

      var page = UI.el("div", { class: "page" });
      page.innerHTML =
        '<div class="page-head"><div>' +
          '<div class="page-title">Staff</div>' +
          '<div class="page-sub">Each person signs in with their own account and gets only what their role allows.</div>' +
        "</div><div class='page-actions'>" +
          '<button class="btn btn-outline" id="staffRefresh">' + Icon("refresh", 15) +
            '<span class="btn-label">Refresh</span></button>' +
          '<button class="btn btn-primary" id="staffAdd">' + Icon("plus", 15) +
            '<span class="btn-label">Add staff member</span></button>' +
        "</div></div>" +

        (me
          ? '<div class="notice" data-status="info" style="margin-bottom:var(--s-5)">' + Icon("info", 16) +
            "<div>Signed in as <strong>" + UI.esc(me.staff_name || me.name || "Owner") + "</strong>" +
            (me.role_name ? " · " + UI.esc(me.role_name) : "") +
            " · " + (me.permissions ? me.permissions.length : 0) + " permissions" +
            (me.kind === "owner" ? " (owner account — full access)" : "") + ".</div></div>"
          : "") +

        '<div class="tabs" id="staffTabs" style="margin-bottom:var(--s-5)">' +
          '<button data-tab="people" aria-selected="true">People</button>' +
          '<button data-tab="roles" aria-selected="false">Roles &amp; permissions</button>' +
        "</div>" +
        '<div class="toolbar" id="staffToolbar">' +
          '<div class="search" style="width:300px">' + Icon("search", 15) +
            '<input class="input" id="staffSearch" type="search" placeholder="Search name or email…" autocomplete="off"></div>' +
        "</div>" +
        '<div class="card card-body-flush" id="staffBody"></div>';
      root.appendChild(page);

      var addBtn = page.querySelector("#staffAdd");
      addBtn.addEventListener("click", function () {
        if (tab === "roles") roleForm();
        else staffForm(null);
      });

      var rb = page.querySelector("#staffRefresh");
      rb.addEventListener("click", function () { UI.withBusy(rb, function () { return load(); }); });

      var search = page.querySelector("#staffSearch");
      search.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { searchQuery = search.value.trim(); load(); }, 250);
      });

      UI.$$("#staffTabs button", page).forEach(function (btn) {
        btn.addEventListener("click", function () {
          tab = btn.dataset.tab;
          UI.$$("#staffTabs button", page).forEach(function (b) {
            b.setAttribute("aria-selected", String(b === btn));
          });
          // Roles have no search, and the add button changes meaning.
          page.querySelector("#staffToolbar").classList.toggle("hidden", tab === "roles");
          addBtn.querySelector(".btn-label").textContent =
            tab === "roles" ? "Add role" : "Add staff member";
          render();
        });
      });

      load();
    },

    unmount: function () {
      clearTimeout(searchTimer);
      rootEl = null;
    }
  };
})(window);
