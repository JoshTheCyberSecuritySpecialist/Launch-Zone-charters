import { useEffect, useState } from 'react';
import AdminModalShell from './AdminModalShell';

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
    <AdminModalShell
      open={open}
      onClose={onClose}
      titleId="pre-trip-reject-title"
      title="Reject submission"
      subtitle={customerLabel || null}
      closeOnBackdrop={!busy}
      enableSwipeToClose={!busy}
    >
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

      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
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
    </AdminModalShell>
  );
}
