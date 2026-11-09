import React from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';

const tone = {
  success: 'border-emerald-700 bg-emerald-50 text-emerald-900',
  warn: 'border-amber-700 bg-amber-50 text-amber-900',
  error: 'border-signal bg-red-50 text-red-900',
};

/** Submission outcome, announced politely. Error text names the problem and the recovery. */
const FormStatus = ({ status }) => (
  <div aria-live="polite">
    {status.message && (
      <p className={`flex items-start gap-2.5 border px-4 py-3 text-[15px] ${tone[status.type] || tone.error}`}>
        {status.type === 'success' ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
        {status.message}
      </p>
    )}
  </div>
);

export default FormStatus;
