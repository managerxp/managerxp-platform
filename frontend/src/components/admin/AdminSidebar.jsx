import React from 'react';

/*
 * Grouped rather than a flat list. The console now covers two distinct jobs —
 * running the business (who pays, what they owe) and maintaining the product
 * (plans, software, accounts) — and a single column of eight buttons made
 * "where do I send an invoice from?" a hunt.
 */
const GROUPS = [
  {
    label: 'Business',
    items: [
      { id: 'overview', label: 'Overview' },
      { id: 'customers', label: 'Customers' },
      { id: 'subscriptions', label: 'Subscriptions' },
      { id: 'links', label: 'Payment Links' },
      { id: 'licenses', label: 'Licence Keys' }
    ]
  },
  {
    label: 'Product',
    items: [
      { id: 'plans', label: 'Subscription Plans' },
      { id: 'software', label: 'Software Master' },
      { id: 'users', label: 'User Management' }
    ]
  }
];

const AdminSidebar = ({ user, activeMenu, onMenuChange, onLogout }) => (
  <aside className="flex flex-col border-r border-neutral-800 p-4 sm:p-5">
    <h1 className="text-xl font-semibold tracking-tight">ManagerXP</h1>
    <p className="mt-1 text-xs text-neutral-400">{user?.email || 'managerxp2026@gmail.com'}</p>

    <nav className="mt-6 flex-1 space-y-5 overflow-y-auto">
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            {group.label}
          </div>
          <div className="space-y-1">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onMenuChange(item.id)}
                aria-current={activeMenu === item.id ? 'page' : undefined}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                  activeMenu === item.id
                    ? 'border border-red-500/35 bg-red-500/15 text-white'
                    : 'border border-transparent text-neutral-300 hover:bg-neutral-900 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>

    <button
      type="button"
      onClick={onLogout}
      className="mt-4 w-full rounded-lg border border-neutral-800 px-3 py-2 text-sm font-medium text-neutral-400 transition hover:border-red-500/40 hover:text-white"
    >
      Sign out
    </button>
  </aside>
);

export default AdminSidebar;
