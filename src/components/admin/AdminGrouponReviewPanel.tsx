import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';

type ConflictRow = { code: string; message: string };
type AlternativeRow = { startIso: string; label?: string; date?: string };

type Props = {
  bookingId: string;
  bookingStatus: string;
  bookingSource: string | null;
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onActionComplete: () => Promise<void> | void;
  boats: Array<{ id: string; name: string }>;
  captains: Array<{ id: string; full_name: string }>;
  currentBoatId?: string | null;
  currentCaptainId?: string | null;
  tripDate?: string;
  startTimeLocal?: string;
  endTimeLocal?: string;
};

const rejectReasons = [
  ['requested_time_unavailable', 'Requested time unavailable'],
  ['boat_unavailable', 'Boat unavailable'],
  ['captain_unavailable', 'Captain unavailable'],
  ['capacity_exceeded', 'Capacity exceeded'],
  ['weight_limit_exceeded', 'Weight limit exceeded'],
  ['voucher_issue', 'Voucher issue'],
  ['duplicate_request', 'Duplicate request'],
  ['customer_cancelled', 'Customer cancelled'],
  ['other', 'Other'],
] as const;

export default function AdminGrouponReviewPanel({
  bookingId,
  bookingStatus,
  bookingSource,
  authedFetch,
  onActionComplete,
  boats,
  captains,
  currentBoatId,
  currentCaptainId,
  tripDate,
  startTimeLocal,
  endTimeLocal,
}: Props) {
  const isGrouponPending =
    bookingSource === 'groupon' && ['pending_verification', 'pending'].includes(String(bookingStatus || ''));

  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [alternatives, setAlternatives] = useState<AlternativeRow[]>([]);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualBookingsEntered, setManualBookingsEntered] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [rejectReasonCode, setRejectReasonCode] = useState('requested_time_unavailable');
  const [rejectReasonText, setRejectReasonText] = useState('');
  const [proposeDate, setProposeDate] = useState(tripDate || '');
  const [proposeStart, setProposeStart] = useState(startTimeLocal || '');
  const [proposeEnd, setProposeEnd] = useState(endTimeLocal || '');
  const [proposeBoatId, setProposeBoatId] = useState(currentBoatId || '');
  const [proposeCaptainId, setProposeCaptainId] = useState(currentCaptainId || '');
  const [proposeMessage, setProposeMessage] = useState('');

  const loadConflicts = useCallback(async () => {
    if (!isGrouponPending) return;
    setConflictsLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/bookings/${bookingId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action: 'check_groupon_conflicts' }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        conflicts?: ConflictRow[];
        alternatives?: AlternativeRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || 'Could not check conflicts.');
      setConflicts(Array.isArray(payload.conflicts) ? payload.conflicts : []);
      setAlternatives(Array.isArray(payload.alternatives) ? payload.alternatives : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check conflicts.');
    } finally {
      setConflictsLoading(false);
    }
  }, [authedFetch, bookingId, isGrouponPending]);

  useEffect(() => {
    void loadConflicts();
  }, [loadConflicts]);

  const runGrouponAction = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(action);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/bookings/${bookingId}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action, ...body }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        conflicts?: ConflictRow[];
        alternatives?: AlternativeRow[];
        requireManualBookingsCheck?: boolean;
      };
      if (!res.ok) {
        if (payload.conflicts) setConflicts(payload.conflicts);
        if (payload.alternatives) setAlternatives(payload.alternatives);
        throw new Error(payload.error || 'Action failed.');
      }
      await onActionComplete();
      await loadConflicts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!manualBookingsEntered) {
      setError('Confirm that phone and manual bookings have been entered for this date.');
      return;
    }
    const hasScheduleConflict = conflicts.some(
      (c) => !['missing_boat', 'missing_captain', 'voucher_issue'].includes(c.code)
    );
    if (hasScheduleConflict && !overrideReason.trim()) {
      setError('Enter an override reason to approve despite schedule conflicts.');
      return;
    }
    if (
      hasScheduleConflict &&
      !window.confirm('Schedule conflicts detected. Approve anyway with your override reason?')
    ) {
      return;
    }
    if (
      !window.confirm(
        'Approve and confirm this Groupon request? The customer will receive confirmation email/SMS.'
      )
    ) {
      return;
    }
    await runGrouponAction('approve_groupon', {
      manualBookingsEntered: true,
      overrideReason: hasScheduleConflict ? overrideReason.trim() : undefined,
      confirmOverride: hasScheduleConflict ? true : undefined,
    });
  };

  const reject = async () => {
    if (!rejectReasonText.trim()) {
      setError('Enter a rejection reason.');
      return;
    }
    if (!window.confirm('Reject this Groupon request? The hold will be released and the customer notified.')) {
      return;
    }
    await runGrouponAction('reject_groupon', {
      reasonCode: rejectReasonCode,
      reason: rejectReasonText.trim(),
    });
  };

  const proposeTime = async () => {
    if (!proposeDate || !proposeStart || !proposeEnd) {
      setError('Choose a proposed date, start time, and end time.');
      return;
    }
    if (!window.confirm('Send this alternate time to the customer?')) return;
    const resolved = {
      date: proposeDate,
      startTime: proposeStart,
      endTime: proposeEnd,
    };
    const startIso = new Date(`${resolved.date}T${resolved.startTime}`).toISOString();
    const endIso = new Date(`${resolved.date}T${resolved.endTime}`).toISOString();
    await runGrouponAction('propose_groupon_time', {
      startTime: startIso,
      endTime: endIso,
      boatId: proposeBoatId || undefined,
      captainId: proposeCaptainId || undefined,
      customerMessage: proposeMessage.trim() || undefined,
    });
  };

  const recordResponse = async (response: 'accepted' | 'declined') => {
    const note = window.prompt(
      response === 'accepted'
        ? 'Optional note about customer acceptance:'
        : 'Optional note about customer decline:'
    );
    await runGrouponAction('groupon_proposal_response', {
      response,
      note: note || undefined,
    });
  };

  if (!isGrouponPending) return null;

  return (
    <div className="rounded-2xl border-2 border-fuchsia-300 bg-fuchsia-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-fuchsia-950">Groupon request review</h2>
          <p className="mt-1 text-sm text-fuchsia-900/90">
            Pending admin approval — not confirmed until you approve.
          </p>
        </div>
        <span className="rounded-full bg-fuchsia-200 px-3 py-1 text-xs font-bold uppercase tracking-wide text-fuchsia-950">
          {bookingStatus.replace(/_/g, ' ')}
        </span>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-fuchsia-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
          <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
          Conflict check
          {conflictsLoading ? <span className="font-normal text-slate-500">Checking…</span> : null}
        </div>
        {conflicts.length === 0 && !conflictsLoading ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            No blocking conflicts detected from current schedule data.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-red-800">
            {conflicts.map((c) => (
              <li key={`${c.code}-${c.message}`}>• {c.message}</li>
            ))}
          </ul>
        )}
        {alternatives.length > 0 ? (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Available alternatives</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {alternatives.map((alt) => (
                <li key={alt.startIso}>
                  <Clock className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  {alt.label || alt.startIso}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5"
          checked={manualBookingsEntered}
          onChange={(e) => setManualBookingsEntered(e.target.checked)}
        />
        <span>Have all phone and manual bookings been entered for this date?</span>
      </label>

      {conflicts.some((c) => !['missing_boat', 'missing_captain', 'voucher_issue'].includes(c.code)) ? (
        <label className="mt-3 block text-sm font-semibold text-slate-800">
          Override reason (required to approve with schedule conflicts)
          <textarea
            className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Why are you approving despite the conflict?"
          />
        </label>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void approve()}
          className="inline-flex min-h-14 items-center justify-center rounded-xl bg-green-700 px-4 py-3 text-base font-black text-white disabled:opacity-60"
        >
          {busy === 'approve_groupon' ? 'Approving…' : 'Approve & Confirm'}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void loadConflicts()}
          className="inline-flex min-h-14 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-bold text-slate-900 disabled:opacity-60"
        >
          Recheck conflicts
        </button>
      </div>

      <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-base font-black text-slate-900">Propose different time</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Date
            <input type="date" className="mt-1 w-full rounded-lg border px-3 py-2" value={proposeDate} onChange={(e) => setProposeDate(e.target.value)} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Start
            <input type="time" className="mt-1 w-full rounded-lg border px-3 py-2" value={proposeStart} onChange={(e) => setProposeStart(e.target.value)} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            End
            <input type="time" className="mt-1 w-full rounded-lg border px-3 py-2" value={proposeEnd} onChange={(e) => setProposeEnd(e.target.value)} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Boat
            <select className="mt-1 w-full rounded-lg border px-3 py-2" value={proposeBoatId} onChange={(e) => setProposeBoatId(e.target.value)}>
              <option value="">—</option>
              {boats.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
            Captain
            <select className="mt-1 w-full rounded-lg border px-3 py-2" value={proposeCaptainId} onChange={(e) => setProposeCaptainId(e.target.value)}>
              <option value="">—</option>
              {captains.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
            Message to customer
            <textarea className="mt-1 min-h-[80px] w-full rounded-lg border px-3 py-2" value={proposeMessage} onChange={(e) => setProposeMessage(e.target.value)} />
          </label>
        </div>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void proposeTime()}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan-700 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
        >
          {busy === 'propose_groupon_time' ? 'Sending…' : 'Propose different time'}
        </button>
        {bookingStatus === 'pending' ? (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void recordResponse('accepted')}
              className="min-h-12 flex-1 rounded-xl bg-green-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              Customer accepted
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void recordResponse('declined')}
              className="min-h-12 flex-1 rounded-xl bg-slate-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              Customer declined
            </button>
          </div>
        ) : null}
      </details>

      <details className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <summary className="cursor-pointer text-base font-black text-red-900">Reject request</summary>
        <div className="mt-4 grid gap-3">
          <label className="text-sm font-semibold text-red-950">
            Reason code
            <select className="mt-1 w-full rounded-lg border px-3 py-2" value={rejectReasonCode} onChange={(e) => setRejectReasonCode(e.target.value)}>
              {rejectReasons.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-red-950">
            Details
            <textarea
              className="mt-1 min-h-[80px] w-full rounded-lg border px-3 py-2"
              value={rejectReasonText}
              onChange={(e) => setRejectReasonText(e.target.value)}
              placeholder="Explain why this request is being rejected."
            />
          </label>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void reject()}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" aria-hidden />
            {busy === 'reject_groupon' ? 'Rejecting…' : 'Reject request'}
          </button>
        </div>
      </details>
    </div>
  );
}
