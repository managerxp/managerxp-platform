import React from 'react';
import { Moon, Sun } from 'lucide-react';

/** The light/dark switch in both dashboard headers. */
const DashThemeToggle = ({ theme, onToggle }) => {
  const next = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="grid h-9 w-9 place-items-center border border-white/15 text-neutral-300 transition-colors hover:border-white hover:text-white"
    >
      {theme === 'light' ? <Moon aria-hidden="true" className="h-4 w-4" /> : <Sun aria-hidden="true" className="h-4 w-4" />}
    </button>
  );
};

export default DashThemeToggle;
