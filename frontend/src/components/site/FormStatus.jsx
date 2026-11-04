import React from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';

/** Submission outcome, announced politely. Error text names the problem and the recovery. */
const FormStatus = ({ status }) => (
  <div aria-live="polite">
    {status.message && (
      <p
        className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[14px] ${
          status.type === 'success'
            ? 'border-emerald-500/40 text-emerald-300'
            : status.type === 'warn'
              ? 'border-amber-500/40 text-amber-200'
              : 'border-signal/60 text-red-300'
        }`}
      >
        {status.type === 'success' ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
        {status.message}
      </p>
    )}
  </div>
);

export default FormStatus;
