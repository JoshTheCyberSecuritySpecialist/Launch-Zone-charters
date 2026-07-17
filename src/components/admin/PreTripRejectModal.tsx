import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  customerLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
};

export default function PreTripRejectModal({
  open,
  customerLabel,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = () => {
    const trimmed = reason.replace(/\s+/g, ' ').trim();
    if (trimmed.length < 3) {
      setError('Enter a short reason (at least 3 characters).');
      return;
    }
    setError(null);
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pre-trip-reject-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div>
            <h2 id="pre-trip-reject-title" className="text-lg font-black text-slate-900">
              Reject submission
            </h2>
            {customerLabel ? (
              <p className="mt-0.5 text-sm text-slate-600">{customerLabel}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            aria-label="Close reject dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          <label className="block text-sm font-bold text-slate-800">
            Reason for rejection
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              rows={4}
              placeholder="Example: License photo is unreadable — please resubmit."
              className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
              disabled={busy}
            />
          </label>
          {error ? (
            <p className="text-sm font-semibold text-red-700" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              This reason is saved for your records. The customer is not emailed automatically.
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Rejecting…' : 'Reject submission'}
          </button>
        </div>
      </div>
    </div>
  );
}
