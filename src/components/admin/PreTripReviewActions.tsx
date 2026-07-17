import PreTripMatchPicker from './PreTripMatchPicker';
import type { PreTripSubmissionRow } from '../../lib/preTripAdminShared';
import { isPreTripTerminal } from '../../lib/preTripAdminShared';
import type { PreTripMatchSuggestion } from '../../lib/publicBooking';

type Props = {
  row: PreTripSubmissionRow;
  suggestions?: PreTripMatchSuggestion[];
  suggestionsLoading: boolean;
  selectedId: string | null;
  adminNotes: string;
  actionBusy: 'approve' | 'reject' | 'match' | null;
  onSelectMatch: (bookingId: string) => void;
  onLoadSuggestions: () => void;
  onSearch: (query: string) => void;
  onNotesChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
};

function buttonLabel(
  busy: Props['actionBusy'],
  action: 'approve' | 'reject',
  idle: string
): string {
  if (busy !== action) return idle;
  return action === 'approve' ? 'Approving…' : 'Rejecting…';
}

export default function PreTripReviewActions({
  row,
  suggestions,
  suggestionsLoading,
  selectedId,
  adminNotes,
  actionBusy,
  onSelectMatch,
  onLoadSuggestions,
  onSearch,
  onNotesChange,
  onApprove,
  onReject,
}: Props) {
  const terminal = isPreTripTerminal(row.admin_status);
  const busy = actionBusy != null;

  return (
    <div className="space-y-3">
      {!terminal ? (
        <PreTripMatchPicker
          submissionId={row.id}
          matchedBookingId={row.matched_booking_id}
          customerEmail={row.email}
          customerName={row.customer_name}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          selectedId={selectedId}
          onSelect={onSelectMatch}
          onLoadSuggestions={onLoadSuggestions}
          onSearch={onSearch}
        />
      ) : null}

      <label className="block text-xs font-bold text-slate-700">
        Admin notes
        <textarea
          placeholder="Internal notes (optional)"
          rows={3}
          value={adminNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={terminal}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-slate-900 disabled:bg-slate-100"
        />
      </label>

      {!terminal ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="min-h-12 rounded-lg bg-green-600 px-3 py-3 text-base font-bold text-white hover:bg-green-700 disabled:opacity-40"
          >
            {buttonLabel(actionBusy, 'approve', 'Approve')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="min-h-12 rounded-lg bg-red-600 px-3 py-3 text-base font-bold text-white hover:bg-red-700 disabled:opacity-40"
          >
            {buttonLabel(actionBusy, 'reject', 'Reject')}
          </button>
        </div>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          This submission is {row.admin_status} and cannot be changed here.
        </p>
      )}
    </div>
  );
}
