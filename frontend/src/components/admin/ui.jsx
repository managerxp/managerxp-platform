import React from 'react';
import { authFieldClasses, authLabelClasses } from '../AuthLayout';

/*
 * Shared admin primitives.
 *
 * The console had grown seven pages each inventing its own card border, its
 * own input styling and its own idea of what a heading weighs — which is most
 * of why it read as unfinished. These are the pieces they all now use, so a
 * change to how a panel looks happens once.
 *
 * They wear the same clothes as /login: glassy white/10 surfaces over black,
 * mono uppercase labels, the red bloom, and the gradient button. Signing in
 * should not feel like being handed off to a different product, and an
 * operator who lives in this console all day should recognise it as the same
 * one they logged into.
 *
 * The field and label styles are imported from AuthLayout rather than restated
 * here. Two copies of a colour is how the login page and the console drifted
 * apart in the first place.
 */

/** Glass panel surface — the login card's treatment, reusable. */
export const surface =
  'rounded-2xl border border-white/10 bg-neutral-950/70 backdrop-blur-xl ' +
  'shadow-[0_0_50px_-20px_rgba(220,38,38,0.25)]';

/** The gradient action button, shared by Button and anything hand-rolled. */
export const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 ' +
  'bg-gradient-to-br from-red-700 to-red-900 px-4 py-2 text-sm font-semibold text-white ' +
  'shadow-[0_0_20px_-5px_rgba(220,38,38,0.4)] hover:shadow-[0_0_28px_-5px_rgba(220,38,38,0.6)] ' +
  'transition-all duration-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60';

export const Page = ({ title, lede, actions, children }) => (
  <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
        {lede && <p className="mt-1 max-w-2xl text-sm text-neutral-400">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
    {children}
  </div>
);

/*
 * A panel. `hud` adds the terminal strip from the login card — worth it on a
 * page's primary panel, noise if every panel on the page wears one.
 */
export const Panel = ({ title, description, hud, children, className = '' }) => (
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
    <div className="p-4 sm:p-5">
      {(title || description) && (
        <div className="mb-4">
          {title && <h3 className="text-sm font-semibold text-white">{title}</h3>}
          {description && <p className="mt-1 text-xs leading-relaxed text-neutral-400">{description}</p>}
        </div>
      )}
      {children}
    </div>
  </section>
);

export const Button = ({ variant = 'primary', className = '', children, ...props }) => {
  const variants = {
    ghost: 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-neutral-300 transition-colors hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50',
    danger: 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-neutral-400 transition-colors hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50',
    good: 'inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50'
  };
  return (
    <button className={`${variants[variant] || primaryButtonClass} ${className}`} {...props}>
      {children}
    </button>
  );
};

/*
 * Every field is labelled and every label is bound to its control. Several of
 * the older forms used placeholder text as the only label, which disappears
 * the moment anyone types and is invisible to a screen reader.
 */
export const Field = ({ label, hint, id, children }) => (
  <div>
    <label htmlFor={id} className={authLabelClasses}>{label}</label>
    {children}
    {hint && <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>}
  </div>
);

// eslint-disable-next-line react-refresh/only-export-components -- shared non-component constant, deliberately kept beside the components that use it
export const inputClass = authFieldClasses;

export const Input = (props) => <input className={inputClass} {...props} />;
export const Select = ({ children, ...props }) => (
  <select className={inputClass} {...props}>{children}</select>
);

export const Pill = ({ tone = 'mute', children }) => {
  const tones = {
    good: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    bad: 'bg-red-500/15 text-red-300 border-red-500/30',
    info: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    mute: 'bg-white/[0.06] text-neutral-400 border-white/10'
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
};

export const Banner = ({ tone = 'info', children }) => {
  const tones = {
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    bad: 'border-red-500/30 bg-red-500/10 text-red-300',
    info: 'border-white/10 bg-white/[0.03] text-neutral-300'
  };
  return <div className={`rounded-xl border p-3 text-sm ${tones[tone]}`}>{children}</div>;
};

export const Empty = ({ title, text, action }) => (
  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
    <p className="text-sm font-medium text-neutral-300">{title}</p>
    {text && <p className="mx-auto mt-1.5 max-w-sm text-sm text-neutral-500">{text}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

export const Skeleton = ({ rows = 3, height = 'h-20' }) => (
  <div className="space-y-2">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className={`${height} animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]`} />
    ))}
  </div>
);

export const Table = ({ columns, children }) => (
  <div className="overflow-x-auto rounded-2xl border border-white/10">
    <table className="w-full text-sm">
      <thead className="bg-white/[0.04] text-left font-mono text-[10px] uppercase tracking-wider text-neutral-500">
        <tr>
          {columns.map((c) => (
            <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/5">{children}</tbody>
    </table>
  </div>
);

/*
 * A value the admin must copy once and cannot get back — a licence key, a
 * temporary password. Shown in a way that makes copying the obvious action,
 * and says plainly that it will not be shown again, because the commonest
 * failure is closing the dialog and losing it.
 */
export const CopyableSecret = ({ label, value, note }) => {
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
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-300">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="select-all break-all rounded-xl border border-white/10 bg-black/60 px-3 py-2 font-mono text-sm text-white">
          {value}
        </code>
        <Button variant="ghost" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      {note && <p className="mt-2 text-xs text-amber-200/80">{note}</p>}
    </div>
  );
};
