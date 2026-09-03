import React from 'react';

/**
 * Marks a product visual as an illustrative mock-up. The numbers in these
 * sections are sample data for demonstration, not ManagerXP usage statistics —
 * this badge keeps that explicit wherever such a visual appears.
 */
const DemoBadge = ({ className = '' }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5
                px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-neutral-400 ${className}`}
  >
    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-neutral-500" />
    Sample data · interface preview
  </span>
);

export default DemoBadge;
