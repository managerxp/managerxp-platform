import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ArrowLeft, LogOut, Menu } from 'lucide-react';
import { adminApi, adminAuth } from '../../lib/adminApi';
import { Button, surface } from '../admin/ui';
import ShellBackground from '../ShellBackground';
import logo from '../../assets/whitelogo.png';

/*
 * The ManagerXP admin shell — sidebar, header, and the guard in front of both.
 *
 * Dressed to match /login: the same logo, the same black ground with its red
 * ambient glow and tech grid, the same terminal strip, the same glassy white/10
 * surfaces. Signing in should feel like walking further into one product rather
 * than being handed to another.
 *
 * It takes the static half of the login background — grid and glow — and leaves
 * out the particle canvas and the racing streaks. Those are fine behind a
 * single card someone looks at for ten seconds; behind dense tables an operator
 * reads all day they are a moving distraction and a canvas animating forever.
 *
 * The navigation is section 56's, in full. Sections whose backend does not
 * exist yet are marked `soon` and say so when opened, rather than being hidden.
 * Hiding them would make the console look finished and leave an operator
 * wondering where Invoices went; a greyed entry that explains itself is the
 * honest version of the same information.
 *
 * Entries are also filtered by the administrator's permissions. That filtering
 * is presentation only — the API re-checks every request — so a stale cached
 * permission list can offer something the server then refuses, but can never
 * grant it.
 */

const AdminContext = createContext(null);
export const useAdmin = () => useContext(AdminContext);

const NAV = [
  { items: [{ to: '/admin', label: 'Dashboard', end: true }] },
  {
    label: 'Business',
    items: [
      { to: '/admin/cafe-owners', label: 'Cafe Owners', can: 'organizations.view' },
      { to: '/admin/organizations', label: 'Organizations', can: 'organizations.view' },
      { to: '/admin/branches', label: 'Branches', can: 'branches.view' },
      { to: '/admin/subscriptions', label: 'Subscriptions', can: 'subscriptions.view' },
      { to: '/admin/payments', label: 'Payments', can: 'payments.view' },
      { to: '/admin/invoices', label: 'Invoices', can: 'payments.view' },
      { to: '/admin/payment-links', label: 'Payment Links', can: 'payments.view' },
      { to: '/admin/gateways', label: 'Payment Gateway', can: 'payments.view' }
    ]
  },
  {
    label: 'Product',
    items: [
      { to: '/admin/packages', label: 'Package Master', can: 'packages.view' },
      { to: '/admin/features', label: 'Feature Master', can: 'features.view' },
      { to: '/admin/addons', label: 'Add-ons', can: 'addons.view' }
    ]
  },
  {
    label: 'Access',
    items: [
      { to: '/admin/installations', label: 'Installations', can: 'installations.view' },
      { to: '/admin/devices', label: 'Devices / PCs', can: 'devices.view' }
    ]
  },
  {
    label: 'Games',
    items: [
      { to: '/admin/game-catalog', label: 'Game Catalog', can: 'catalogue.view' }
    ]
  },
  {
    label: 'Support',
    items: [
      { to: '/admin/support', label: 'Support Tickets', can: 'support.manage' },
      { to: '/admin/announcements', label: 'Announcements', can: 'support.manage', soon: true }
    ]
  },
  {
    label: 'System',
    items: [
      { to: '/admin/admin-users', label: 'Admin Users', can: 'admins.view' },
      { to: '/admin/roles', label: 'Roles & Permissions', can: 'admins.view' },
      { to: '/admin/audit-logs', label: 'Audit Logs', can: 'audit.view' },
      { to: '/admin/settings', label: 'Settings', can: 'settings.edit' }
    ]
  }
];

const ManagerXpShell = ({ children }) => {
  const location = useLocation();
  const [admin, setAdmin] = useState(() => adminAuth.admin());
  const [loading, setLoading] = useState(!adminAuth.admin());
  const [error, setError] = useState(null);
  const [navOpen, setNavOpen] = useState(false);

  /* Revalidate against the server on mount. The cached copy paints the sidebar
     immediately; this confirms the session is still real and the permissions
     still current, and signs the user out if not. */
  const load = useCallback(async () => {
    try {
      const fresh = await adminApi.me();
      adminAuth.setAdmin(fresh);
      setAdmin(fresh);
      setError(null);
    } catch (e) {
      if (e.status === 401) {
        adminAuth.signOut();
        setAdmin(null);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const signOut = async () => {
    await adminApi.logout();
    adminAuth.signOut();
    window.location.href = '/login';
  };

  const value = useMemo(
    () => ({ admin, can: (k) => adminAuth.can(k), reload: load }),
    [admin, load]
  );

  const nav = useMemo(
    () => NAV
      .map((group) => ({
        ...group,
        items: group.items.filter((i) => !i.can || adminAuth.can(i.can))
      }))
      .filter((group) => group.items.length > 0),
    [admin]
  );

  if (!adminAuth.isSignedIn()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-800 border-t-red-500" />
      </div>
    );
  }

  if (!admin) return <Navigate to="/login" replace />;

  if (error) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-black px-4">
        <ShellBackground />
        <div className={`relative z-10 max-w-md ${surface} p-8 text-center`}>
          <p className="text-sm text-neutral-300">{error}</p>
          <Button className="mt-5" onClick={load}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <AdminContext.Provider value={value}>
      <div className="relative min-h-screen bg-black text-white antialiased">
        <ShellBackground />

        <div className="relative z-10 mx-auto flex max-w-[1600px]">

          <aside
            className={`fixed inset-y-0 left-0 z-40 w-60 shrink-0 overflow-y-auto border-r border-white/10
                        bg-neutral-950/80 px-3 py-5 backdrop-blur-xl transition-transform
                        lg:sticky lg:top-0 lg:h-screen lg:translate-x-0
                        ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
          >
            <Link to="/admin" className="flex items-center px-2 transition-opacity hover:opacity-80">
              <img src={logo} alt="ManagerXP" className="h-7 w-auto" />
            </Link>
            <p className="mt-2 px-2 font-mono text-[10px] uppercase tracking-wider text-neutral-600">
              control_plane
            </p>

            {/* The way out. Every other page on the site has this; the console
                had no route back to the public site short of editing the
                address bar, which is not a thing to make anyone do. */}
            <Link
              to="/"
              className="group mt-4 flex items-center gap-1.5 px-2 font-mono text-[11px] text-neutral-500 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
              Back to site
            </Link>

            <nav className="mt-6 space-y-5">
              {nav.map((group, i) => (
                <div key={group.label || i}>
                  {group.label && (
                    <div className="mb-1.5 px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                      {group.label}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = item.end
                        ? location.pathname === item.to
                        : location.pathname.startsWith(item.to);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setNavOpen(false)}
                          aria-current={active ? 'page' : undefined}
                          className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                            active
                              ? 'border border-red-500/25 bg-gradient-to-r from-red-500/15 to-transparent text-white'
                              : item.soon
                                ? 'border border-transparent text-neutral-600 hover:bg-white/[0.04] hover:text-neutral-400'
                                : 'border border-transparent text-neutral-400 hover:bg-white/[0.04] hover:text-white'
                          }`}
                        >
                          <span>{item.label}</span>
                          {item.soon && (
                            <span className="rounded border border-white/10 bg-white/[0.06] px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-neutral-500">
                              soon
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>

          {navOpen && (
            <button
              type="button"
              aria-label="Close navigation"
              className="fixed inset-0 z-30 bg-black/60 lg:hidden"
              onClick={() => setNavOpen(false)}
            />
          )}

          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-white/10 bg-black/80 px-4 py-2.5 backdrop-blur-xl sm:px-6">
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-neutral-300 transition-colors hover:text-white lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </button>

              {/* The same three lights as the login card's strip — the visual
                  cue that says "you are inside ManagerXP". */}
              <div aria-hidden="true" className="hidden items-center gap-1.5 sm:flex">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
              </div>

              <Breadcrumbs />

              <div className="ml-auto flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <div className="text-xs font-medium text-neutral-300">{admin.name}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-neutral-600">
                    {admin.role_label || admin.role}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-neutral-400 transition-colors hover:border-red-500/40 hover:text-white"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </header>

            <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </div>
    </AdminContext.Provider>
  );
};

/* Derived from the path rather than passed down, so a new page gets working
   breadcrumbs without having to remember to declare them. */
const LABELS = {
  admin: 'ManagerXP', gateways: 'Payment Gateway', 'payment-links': 'Payment Links', 'cafe-owners': 'Cafe Owners', organizations: 'Organizations',
  packages: 'Package Master', features: 'Feature Master', addons: 'Add-ons',
  'audit-logs': 'Audit Logs', branches: 'Branches', subscriptions: 'Subscriptions',
  payments: 'Payments', invoices: 'Invoices', installations: 'Installations',
  devices: 'Devices', 'game-catalog': 'Game Catalog', support: 'Support',
  announcements: 'Announcements', 'admin-users': 'Admin Users', roles: 'Roles & Permissions',
  settings: 'Settings'
};

const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-xs text-neutral-500">
      {parts.map((part, i) => {
        const to = '/' + parts.slice(0, i + 1).join('/');
        const last = i === parts.length - 1;
        // A numeric segment is a record id; the page itself shows the name.
        const label = LABELS[part] || (/^\d+$/.test(part) ? `#${part}` : part);
        return (
          <React.Fragment key={to}>
            {i > 0 && <span className="text-neutral-700">/</span>}
            {last ? (
              <span className="font-medium text-neutral-300">{label}</span>
            ) : (
              <Link to={to} className="transition hover:text-neutral-300">{label}</Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

export default ManagerXpShell;
