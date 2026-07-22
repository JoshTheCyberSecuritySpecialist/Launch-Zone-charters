import PreTripMatchPicker from './PreTripMatchPicker';
import type { PreTripSubmissionRow } from '../../lib/preTripAdminShared';
import {
  isPreTripTerminal,
  resolvePreTripSelectedBookingId,
  staffBookingUrlFromPreTripSubmission,
} from '../../lib/preTripAdminShared';
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
  sticky?: boolean;
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
  sticky = false,
}: Props) {
  const terminal = isPreTripTerminal(row.admin_status);
  const busy = actionBusy != null;
  const resolvedBookingId = resolvePreTripSelectedBookingId(
    selectedId,
    row.matched_booking_id,
    suggestions
  );
  const canApprove = Boolean(resolvedBookingId);

  const shellClass = sticky
    ? 'sticky top-14 z-20 -mx-1 space-y-4 rounded-2xl border border-amber-200 bg-amber-50/95 p-4 shadow-lg backdrop-blur-sm sm:mx-0 sm:p-5'
    : 'space-y-4';

  return (
    <div className={shellClass}>
      <div>
        <h2 className="text-lg font-black text-slate-900 sm:text-xl">Match &amp; approve waiver</h2>
        <p className="mt-1 text-sm text-slate-600">
          Select the customer&apos;s booking, then approve to copy waiver and documents onto it.
        </p>
      </div>

      {!terminal ? (
        <PreTripMatchPicker
          submissionId={row.id}
          matchedBookingId={row.matched_booking_id}
          customerEmail={row.email}
          customerName={row.customer_name}
          customerPhone={row.phone}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          selectedId={selectedId}
          createBookingUrl={staffBookingUrlFromPreTripSubmission(row)}
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
        <div className="space-y-2">
          {!canApprove ? (
            <p className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-950">
              Approve is disabled until you select a booking match above.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || !canApprove}
              onClick={onApprove}
              title={canApprove ? 'Approve and link waiver to selected booking' : 'Select a booking first'}
              className="min-h-12 rounded-lg bg-green-600 px-3 py-3 text-base font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
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
        </div>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
          This submission is {row.admin_status} and cannot be changed here.
        </p>
      )}
    </div>
  );
}
