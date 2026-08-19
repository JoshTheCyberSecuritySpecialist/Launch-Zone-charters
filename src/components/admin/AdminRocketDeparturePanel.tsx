import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Rocket, Users } from 'lucide-react';
import {
  type AdminRocketDepartureDetail,
  ROCKET_LAUNCH_MIN_GUESTS,
  rocketDepartureStatusBadgeClass,
  rocketDepartureStatusLabel,
} from '../../lib/rocketLaunchPackages';
import { shortId } from './adminDisplay';

type Props = {
  bookingId: string;
  charterType?: string | null;
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onUpdated?: () => void;
};

export default function AdminRocketDeparturePanel({
  bookingId,
  charterType,
  authedFetch,
  onUpdated,
}: Props) {
  const charter = String(charterType || '').trim().toLowerCase();
  const isRocket = charter === 'rocket' || charter === 'rocket_launch';

  const [detail, setDetail] = useState<AdminRocketDepartureDetail | null>(null);
  const [loading, setLoading] = useState(isRocket);
  const [error, setError] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadDetail = useCallback(async () => {
    if (!isRocket) {
      setDetail(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/rocket-departure`);
      const payload = (await res.json().catch(() => ({}))) as AdminRocketDepartureDetail & { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not load rocket departure detail.');
      setDetail(payload.applicable ? payload : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load rocket departure detail.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [authedFetch, bookingId, isRocket]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const submitOverride = async (action: 'force_confirm' | 'revert_to_computed') => {
    setOverrideSaving(true);
    setActionMessage(null);
    try {
      const res = await authedFetch(
        `/api/admin/bookings/${encodeURIComponent(bookingId)}/rocket-departure-override`,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            reason: overrideReason.trim(),
            confirmOverride: action === 'force_confirm' ? confirmOverride : undefined,
          }),
        }
      );
      const payload = (await res.json().catch(() => ({}))) as AdminRocketDepartureDetail & {
        error?: string;
        requiresConfirmOverride?: boolean;
      };
      if (res.status === 409 && payload.requiresConfirmOverride) {
        setConfirmOverride(true);
        setActionMessage({
          type: 'err',
          text: 'This departure is below the guest minimum. Confirm the override below, then try again.',
        });
        return;
      }
      if (!res.ok) throw new Error(payload.error || 'Override failed.');
      setDetail(payload.applicable ? payload : null);
      setOverrideReason('');
      setConfirmOverride(false);
      setActionMessage({
        type: 'ok',
        text:
          action === 'force_confirm'
            ? 'Departure confirmed for the group. Confirmation emails will send if not already sent.'
            : 'Departure status reverted to computed guest totals.',
      });
      onUpdated?.();
    } catch (err) {
      setActionMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Override failed.',
      });
    } finally {
      setOverrideSaving(false);
    }
  };

  if (!isRocket) return null;

  if (loading) {
    return (
      <div className="rounded-xl border border-amber-500/25 bg-slate-900/80 p-4 text-sm text-slate-300">
        Loading rocket departure status…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-100">
        {error}
      </div>
    );
  }

  if (!detail) return null;

  const status = detail.departureStatus || detail.summary?.departureStatus || null;
  const awaitingMinimum = status === 'awaiting_minimum';
  const summary = detail.summary;

  return (
    <div
      className={`rounded-xl border p-4 text-sm ${
        awaitingMinimum
          ? 'border-amber-400/40 bg-amber-950/30 text-amber-50'
          : 'border-orange-500/25 bg-slate-900/80 text-slate-200'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-orange-300" aria-hidden />
          <div>
            <p className="font-semibold text-orange-100">Rocket launch departure</p>
            {detail.privateCharter ? (
              <p className="mt-1 text-slate-300">{detail.label}</p>
            ) : detail.legacyBooking ? (
              <p className="mt-1 text-slate-400">{detail.label}</p>
            ) : (
              <>
                <p className="mt-1 text-slate-300">{detail.label}</p>
                {summary ? (
                  <p className="mt-2 text-slate-400">
                    Minimum {ROCKET_LAUNCH_MIN_GUESTS} guests · {summary.guestsBooked} booked ·{' '}
                    {summary.seatsRemaining} seat{summary.seatsRemaining === 1 ? '' : 's'} remaining
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
        {status ? (
          <span
            className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${rocketDepartureStatusBadgeClass(status)}`}
          >
            {rocketDepartureStatusLabel(status)}
            {detail.staffOverridden ? ' · staff override' : ''}
          </span>
        ) : null}
      </div>

      {awaitingMinimum ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-950/40 p-3 text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            This shared departure has not reached the {ROCKET_LAUNCH_MIN_GUESTS}-guest minimum. Customers
            received a reservation email, not a full departure confirmation.
          </p>
        </div>
      ) : null}

      {detail.bookings && detail.bookings.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 flex items-center gap-2 font-semibold text-slate-200">
            <Users className="h-4 w-4" aria-hidden />
            Departure group ({detail.bookings.length})
          </p>
          <ul className="space-y-2">
            {detail.bookings.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-slate-100">
                    {row.customerName || 'Guest'}{' '}
                    <span className="text-slate-500">· {row.guestCount} guest{row.guestCount === 1 ? '' : 's'}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {row.packageName || 'Rocket charter'} · {humanizeStatus(row.status)}
                  </p>
                </div>
                {row.id !== bookingId ? (
                  <Link
                    to={`/admin/bookings/${row.id}`}
                    className="text-xs font-semibold text-orange-300 hover:text-orange-200"
                  >
                    View {shortId(row.id, 8)}
                  </Link>
                ) : (
                  <span className="text-xs text-slate-500">This booking</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!detail.privateCharter && !detail.legacyBooking && (detail.canForceConfirm || detail.canRevertToComputed) ? (
        <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/50 p-4">
          <p className="font-semibold text-slate-100">Staff override</p>
          <p className="mt-1 text-xs text-slate-400">
            Force confirmation below minimum or revert to the computed guest total. Actions are audit-logged.
          </p>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Reason (required)
          </label>
          <textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white"
            placeholder="Explain why this departure should be confirmed or reverted…"
          />
          {detail.canForceConfirm ? (
            <label className="mt-3 flex items-start gap-2 text-sm text-amber-100">
              <input
                type="checkbox"
                checked={confirmOverride}
                onChange={(e) => setConfirmOverride(e.target.checked)}
                className="mt-1"
              />
              I confirm forcing departure confirmation below the {ROCKET_LAUNCH_MIN_GUESTS}-guest minimum.
            </label>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {detail.canForceConfirm ? (
              <button
                type="button"
                disabled={
                  overrideSaving || overrideReason.trim().length < 8 || !confirmOverride
                }
                onClick={() => void submitOverride('force_confirm')}
                className="min-h-10 rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Force confirm departure
              </button>
            ) : null}
            {detail.canRevertToComputed ? (
              <button
                type="button"
                disabled={overrideSaving || overrideReason.trim().length < 8}
                onClick={() => void submitOverride('revert_to_computed')}
                className="min-h-10 rounded-lg border border-slate-500 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-100 disabled:opacity-50"
              >
                Revert to computed status
              </button>
            ) : null}
          </div>
          {actionMessage ? (
            <p
              className={`mt-3 text-sm ${actionMessage.type === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}
            >
              {actionMessage.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function humanizeStatus(status: string): string {
  return String(status || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
