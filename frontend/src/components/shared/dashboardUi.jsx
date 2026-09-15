import React from 'react';
import { authFieldClasses, authLabelClasses } from '../AuthLayout';

/*
 * The shared base both signed-in shells (café-owner portal, ManagerXP
 * admin) actually draw from.
 *
 * `components/portal/ui.jsx` and `components/admin/ui.jsx` used to define
 * these independently — identical JSX, retyped, so a change to how a panel
 * looks meant remembering to make it twice. This file is the one definition;
 * each shell's own `ui.jsx` now just re-exports from here (some under the
 * name that shell's pages already call it — `Panel` is `Card` by another
 * name), so no call site in either console had to change.
 *
 * `Pill` is deliberately NOT here — portal's softer ring-based tone and
 * admin's sharper bordered one are a documented, intentional difference in
 * how the two consoles feel, not drift, so each shell keeps its own.
 */

/** Glass panel surface — the login card's treatment, reusable. */
export const surface =
  'rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl ' +
  'shadow-[0_0_50px_-20px_rgba(220,38,38,0.25)]';

/** The gradient action button's own classes, for anything hand-rolled that isn't <Button>. */
export const primaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 ' +
  'bg-gradient-to-br from-red-700 to-red-900 px-4 py-2 text-sm font-semibold text-white ' +
  'shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)] ' +
  'transition-all duration-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60';

export const Page = ({ title, lede, actions, children }) => (
  <div className="space-y-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {lede && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-neutral-400">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
    {children}
  </div>
);

/*
 * A panel. `hud` adds the terminal strip from the login card — worth it on
 * a page's primary panel, noise if every panel on the page wears one.
 * Portal's pages call this `Card`; admin's call it `Panel` — same component.
 */
export const Card = ({ title, description, actions, hud, className = '', children }) => (
  <section className={`${surface} overflow-hidden ${className}`}>
    {hud && (
      <div className="flex items-center gap-1.5 border-b border-white/5 bg-white/[0.02] px-4 py-3">
        <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
        <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
        <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
        <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-neutral-600">
          {typeof hud === 'string' ? hud : 'panel'}
        </span>
      </div>
    )}
    {(title || actions) && (
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          {title && <h2 className="text-sm font-semibold text-white">{title}</h2>}
          {description && <p className="mt-1 text-xs leading-relaxed text-neutral-400">{description}</p>}
        </div>
        {actions}
      </div>
    )}
    <div className="p-5">{children}</div>
  </section>
);

export const Button = ({ variant = 'primary', size = 'md', className = '', children, ...props }) => {
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-4 py-2 text-sm' };
  const variants = {
    primary:
      'border border-white/10 bg-gradient-to-br from-red-700 to-red-900 text-white ' +
      'shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)] ' +
      'active:scale-[0.99] disabled:opacity-60',
    ghost: 'border border-white/10 bg-white/[0.03] text-neutral-300 hover:border-white/20 hover:text-white disabled:opacity-50',
    danger: 'border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50',
    quiet: 'text-neutral-400 hover:text-white disabled:opacity-50',
    good: 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50'
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all duration-300 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export const Field = ({ label, hint, id, required, children }) => (
  <div>
    <label htmlFor={id} className={authLabelClasses}>
      {label}{required && <span className="ml-1 text-red-400">*</span>}
    </label>
    {children}
    {hint && <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>}
  </div>
);

// eslint-disable-next-line react-refresh/only-export-components -- shared non-component constant, deliberately kept beside the components that use it
export const inputClass = authFieldClasses;

export const Input = (props) => <input className={inputClass} {...props} />;
export const Select = ({ className = '', children, ...props }) => (
  <select className={`${inputClass} ${className}`} {...props}>{children}</select>
);

export const Banner = ({ tone = 'info', title, children, action }) => {
  const tones = {
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    bad: 'border-red-500/30 bg-red-500/10 text-red-100',
    info: 'border-white/10 bg-white/[0.03] text-neutral-300'
  };
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${tones[tone]}`}>
      <div className="text-sm">
        {title && <strong className="mr-1.5">{title}</strong>}
        {children}
      </div>
      {action}
    </div>
  );
};

export const Empty = ({ title, text, action }) => (
  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
    <p className="text-sm font-medium text-neutral-300">{title}</p>
    {text && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-500">{text}</p>}
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>
);

export const Skeleton = ({ rows = 3, height = 'h-24' }) => (
  <div className="space-y-3">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className={`${height} animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]`} />
    ))}
  </div>
);

export const Table = ({ columns, children }) => (
  <div className="overflow-x-auto rounded-2xl border border-white/10">
    <table className="w-full text-sm">
      <thead className="bg-white/[0.04] text-left font-mono text-[10px] uppercase tracking-wider text-neutral-500">
        <tr>{columns.map((c) => (
          <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>
        ))}</tr>
      </thead>
      <tbody className="divide-y divide-white/5">{children}</tbody>
    </table>
  </div>
);

/*
 * A value that must be copied once and cannot be retrieved again — an
 * invite link, a licence key, a temporary password. Portal calls this
 * `CopyBox`, admin calls it `CopyableSecret` — same component.
 */
export const CopySecret = ({ label, value, note }) => {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(`Copy this ${label.toLowerCase()}:`, value);
    }
  };
  return (
    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-300">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="select-all break-all rounded-xl border border-white/10 bg-black/60 px-3 py-2 font-mono text-xs text-white">
          {value}
        </code>
        <Button variant="ghost" size="sm" type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {note && <p className="mt-2 text-xs text-amber-200/70">{note}</p>}
    </div>
  );
};

/* A live/offline dot. Shape and colour together, so the state survives being
   read by someone who cannot distinguish red from green. Portal-only — the
   admin console has no equivalent live-status surface today. */
export const StatusDot = ({ online, label }) => (
  <span className="inline-flex items-center gap-1.5 text-xs">
    <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
    <span className={online ? 'text-emerald-300' : 'text-neutral-500'}>
      {label || (online ? 'Online' : 'Offline')}
    </span>
  </span>
);

/* Portal-only — a KPI tile for the café owner's own dashboard. */
export const Stat = ({ label, value, sub, tone = 'default' }) => {
  const rings = {
    default: 'border-white/10',
    good: 'border-emerald-500/25',
    warn: 'border-amber-500/30',
    bad: 'border-red-500/30'
  };
  return (
    <div className={`rounded-2xl border ${rings[tone]} bg-white/[0.03] p-4 backdrop-blur-xl`}>
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-white">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
};

/*
 * A usage meter — "18 / 50 PCs". Portal-only — plan limits are a café-owner
 * concept, not something the admin console itself is bound by.
 */
export const Meter = ({ used, max, label }) => {
  if (max == null) {
    return <div className="text-sm text-neutral-400">{used} {label}</div>;
  }
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-neutral-300">{label}</span>
        <span className="font-semibold text-white">
          {used} <span className="text-neutral-500">/ {max}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${tone} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};
