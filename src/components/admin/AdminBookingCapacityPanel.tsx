import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  type AdminBookingCapacityDetail,
  OVERRIDE_STATUS_OPTIONS,
  capacityStatusBadgeClass,
  formatLbs,
  formatPercent,
} from '../../lib/adminBookingCapacity';
import { CAPACITY_STATUS_LABELS, type CapacityCalculationStatus } from '../../lib/boatCapacityTypes';

type Props = {
  bookingId: string;
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  boatId?: string | null;
  onUpdated?: () => void;
};

function statusLabel(status: CapacityCalculationStatus | null | undefined): string {
  if (!status) return CAPACITY_STATUS_LABELS.capacity_unverified;
  return CAPACITY_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

export default function AdminBookingCapacityPanel({
  bookingId,
  authedFetch,
  boatId,
  onUpdated,
}: Props) {
  const [detail, setDetail] = useState<AdminBookingCapacityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<CapacityCalculationStatus>('within_operating_range');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/capacity`);
      const payload = (await res.json().catch(() => ({}))) as AdminBookingCapacityDetail & { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Could not load capacity data.');
      setDetail(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load capacity data.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [authedFetch, bookingId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, boatId]);

  const recalculate = async () => {
    setRecalculating(true);
    setActionMessage(null);
    try {
      const res = await authedFetch(
        `/api/admin/bookings/${encodeURIComponent(bookingId)}/capacity-recalculate`,
        { method: 'POST', body: '{}' }
      );
      const payload = (await res.json().catch(() => ({}))) as AdminBookingCapacityDetail & { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Recalculate failed.');
      setDetail(payload);
      setActionMessage({ type: 'ok', text: 'Capacity recalculated from saved passenger manifest.' });
      onUpdated?.();
    } catch (err) {
      setActionMessage({
        type: 'err',
        text: err instanceof Error ? err.message : 'Recalculate failed.',
      });
    } finally {
      setRecalculating(false);
    }
  };

  const submitOverride = async () => {
    if (!detail?.calculation?.id) return;
    setOverrideSaving(true);
    setActionMessage(null);
    try {
      const res = await authedFetch(
        `/api/admin/bookings/${encodeURIComponent(bookingId)}/capacity-override`,
        {
          method: 'POST',
          body: JSON.stringify({
            calculationId: detail.calculation.id,
            overrideStatus,
            reason: overrideReason.trim(),
          }),
        }
      );
      const payload = (await res.json().catch(() => ({}))) as AdminBookingCapacityDetail & { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Override failed.');
      setDetail(payload);
      setOverrideReason('');
      setActionMessage({ type: 'ok', text: 'Capacity override recorded with audit trail.' });
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

  const calc = detail?.calculation;
  const profile = detail?.boat_capacity_profile;
  const effectiveStatus = detail?.effective_status ?? calc?.status ?? 'capacity_unverified';
  const calculatedStatus = detail?.calculated_status ?? calc?.status ?? null;
  const hasOverride = Boolean(detail?.latest_override);
  const mobilityFlags = (detail?.passengers || []).filter((p) => p.mobility_assistance_required);

  return (
    <div className="rounded-2xl border border-sky-200 bg-white p-5 shadow">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Anchor className="mt-0.5 h-6 w-6 shrink-0 text-sky-700" aria-hidden />
          <div>
            <h2 className="text-xl font-black text-slate-900">Boat Safety Capacity</h2>
            <p className="mt-1 text-sm text-slate-600">
              Passenger manifest, operating load, plate limits, and captain review status for this booking.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${capacityStatusBadgeClass(effectiveStatus)}`}
          >
            {statusLabel(effectiveStatus)}
            {hasOverride ? ' (override)' : ''}
          </span>
          {calculatedStatus && calculatedStatus !== effectiveStatus ? (
            <span className="text-xs text-slate-500">
              Calculated: {statusLabel(calculatedStatus)}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-600">Loading capacity data…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-700">{error}</p>
      ) : !calc ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
          <p>No capacity calculation saved yet. Customer must complete the passenger section on waivers before departure review.</p>
          {(detail?.passengers?.length ?? 0) > 0 ? (
            <button
              type="button"
              disabled={recalculating}
              onClick={() => void recalculate()}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${recalculating ? 'animate-spin' : ''}`} aria-hidden />
              {recalculating ? 'Recalculating…' : 'Run capacity check'}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Boat" value={detail?.boat?.name || '—'} />
            <Metric label="Guest count" value={String(detail?.booking?.guest_count ?? calc.passenger_count)} />
            <Metric label="Persons aboard" value={String(calc.total_persons_aboard)} />
            <Metric label="Passenger weight" value={formatLbs(calc.passenger_weight_total_lbs)} />
            <Metric label="Gear (cooler / personal / other)" value={`${formatLbs(calc.cooler_weight_lbs)} / ${formatLbs(calc.personal_gear_weight_lbs)} / ${formatLbs(calc.other_equipment_weight_lbs)}`} />
            <Metric label="Operating load" value={formatLbs(calc.estimated_operating_load_lbs)} />
            <Metric label="Operating limit" value={formatLbs(calc.operational_weight_limit_lbs)} />
            <Metric label="Remaining margin" value={formatLbs(calc.remaining_margin_lbs)} />
            <Metric label="Capacity used" value={formatPercent(calc.capacity_percent)} />
            <Metric label="Config version" value={`v${calc.config_version}`} />
            <Metric
              label="Calculated"
              value={calc.calculated_at ? new Date(calc.calculated_at).toLocaleString() : '—'}
            />
            <Metric
              label="Plate verified"
              value={profile?.capacity_verified ? 'Yes' : 'No — verify in fleet admin'}
            />
          </div>

          {profile ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              Plate limits: max {profile.maximum_persons ?? '—'} persons ·{' '}
              {formatLbs(profile.maximum_persons_weight_lbs)} persons weight ·{' '}
              {formatLbs(profile.maximum_total_load_lbs)} total load · buffer {formatLbs(profile.safety_buffer_lbs)}
              {detail?.boat?.id ? (
                <>
                  {' '}
                  ·{' '}
                  <Link to="/admin/boats" className="font-semibold text-sky-800 underline">
                    Edit boat capacity
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          {mobilityFlags.length > 0 ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Mobility assistance flagged</p>
                <ul className="mt-1 list-disc pl-5">
                  {mobilityFlags.map((p) => (
                    <li key={p.id}>
                      {p.passenger_name}
                      {p.mobility_notes ? ` — ${p.mobility_notes}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {(detail?.passengers?.length ?? 0) > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Weight</th>
                    <th className="py-2 pr-3">Life jacket</th>
                    <th className="py-2">Mobility</th>
                  </tr>
                </thead>
                <tbody>
                  {detail!.passengers.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3">{p.passenger_number}</td>
                      <td className="py-2 pr-3 font-medium text-slate-900">{p.passenger_name}</td>
                      <td className="py-2 pr-3 capitalize">{p.passenger_type}</td>
                      <td className="py-2 pr-3">{formatLbs(p.weight_lbs)}</td>
                      <td className="py-2 pr-3">{p.life_jacket_size || '—'}</td>
                      <td className="py-2">{p.mobility_assistance_required ? 'Yes' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={recalculating || !(detail?.passengers?.length ?? 0)}
              onClick={() => void recalculate()}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-bold text-sky-900 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${recalculating ? 'animate-spin' : ''}`} aria-hidden />
              {recalculating ? 'Recalculating…' : 'Recalculate from manifest'}
            </button>
          </div>

          {calc.status !== 'capacity_unverified' ? (
            <div className="mt-6 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-900">Override status (audit logged)</h3>
              <p className="mt-1 text-xs text-slate-600">
                Original calculation and customer manifest are preserved. Overrides apply a captain/admin decision with a written reason.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">New status</span>
                  <select
                    value={overrideStatus}
                    onChange={(e) => setOverrideStatus(e.target.value as CapacityCalculationStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    {OVERRIDE_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="font-semibold text-slate-700">Written reason (required)</span>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Document captain review decision, equipment changes, or why departure is approved despite yellow band…"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={overrideSaving || overrideReason.trim().length < 8}
                onClick={() => void submitOverride()}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {overrideSaving ? 'Saving override…' : 'Apply override'}
              </button>
            </div>
          ) : null}

          {(detail?.overrides?.length ?? 0) > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-slate-900">Override history</h3>
              <ul className="mt-2 space-y-2">
                {detail!.overrides.map((o) => (
                  <li key={o.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-800">
                      {statusLabel(o.original_status as CapacityCalculationStatus)} →{' '}
                      {statusLabel(o.override_status as CapacityCalculationStatus)}
                    </p>
                    <p className="mt-1 text-slate-700">{o.reason}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(o.overridden_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {actionMessage ? (
        <p
          className={`mt-4 text-sm ${actionMessage.type === 'ok' ? 'text-green-800' : 'text-red-700'}`}
          role="status"
        >
          {actionMessage.text}
        </p>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
    </div>
  );
}
