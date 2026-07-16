import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { adminUpdatePreTripSubmission, fetchPreTripMatchSuggestions, type PreTripMatchSuggestion } from '../lib/publicBooking';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import AdminActions from '../components/admin/AdminActions';
import StatusBadge from '../components/admin/StatusBadge';
import { humanizeLabel, shortId } from '../components/admin/adminDisplay';
import { describeError, withTimeout } from '../lib/adminDiagnostics';

type PreTripSubmissionRow = {
  id: string;
  matched_booking_id: string | null;
  customer_name: string | null;
  email: string;
  phone: string | null;
  trip_type: string;
  selected_boat_reg_no: string | null;
  groupon_code: string | null;
  requested_trip_date: string | null;
  waiver_signed: boolean;
  license_url: string | null;
  insurance_url: string | null;
  license_status: string;
  insurance_status: string;
  admin_status: string;
  admin_notes: string | null;
  created_at: string;
};

function tripTypeLabel(tripType: string): string {
  switch (tripType) {
    case 'pontoon_rental':
      return 'Pontoon Rental';
    case 'center_console_rental':
      return 'Center Console Rental';
    case 'captain_charter':
      return 'Captain-Led Charter';
    default:
      return tripType;
  }
}

export default function AdminPreTrip() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [preTripSubmissions, setPreTripSubmissions] = useState<PreTripSubmissionRow[]>([]);
  const [preTripSuggestions, setPreTripSuggestions] = useState<Record<string, PreTripMatchSuggestion[]>>({});
  const [preTripSuggestionsLoading, setPreTripSuggestionsLoading] = useState<string | null>(null);
  const [preTripLoading, setPreTripLoading] = useState(false);
  const [preTripMatchIds, setPreTripMatchIds] = useState<Record<string, string>>({});
  const [preTripNotes, setPreTripNotes] = useState<Record<string, string>>({});
  const [preTripActionBusy, setPreTripActionBusy] = useState<string | null>(null);

  const getAdminToken = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return session?.access_token || null;
  }, []);

  const loadPreTripSubmissions = useCallback(async () => {
    if (!isAdmin) {
      setPreTripLoading(false);
      return;
    }
    setPreTripLoading(true);
    try {
      const { data, error } = await withTimeout(
        'Admin pre-trip submissions',
        supabase
          .from('pre_trip_submissions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        15000
      );
      logSupabaseError('AdminPreTrip.loadPreTripSubmissions', error);
      setPreTripSubmissions((data as PreTripSubmissionRow[]) || []);
    } catch (err) {
      console.error('[AdminPreTrip.loadPreTripSubmissions]', err);
      setPreTripSubmissions([]);
      setNotice({ variant: 'error', text: describeError(err, 'Could not load pre-trip submissions.') });
    } finally {
      setHasLoaded(true);
      setPreTripLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadPreTripSubmissions();
  }, [authLoading, isAdmin, loadPreTripSubmissions]);

  const loadPreTripSuggestions = async (submissionId: string) => {
    setPreTripSuggestionsLoading(submissionId);
    try {
      const token = await getAdminToken();
      if (!token) return;
      const out = await withTimeout('Admin pre-trip match suggestions', fetchPreTripMatchSuggestions(token, submissionId), 15000);
      if (out.ok) {
        setPreTripSuggestions((prev) => ({ ...prev, [submissionId]: out.suggestions }));
      }
    } catch (err) {
      setNotice({ variant: 'error', text: describeError(err, 'Could not load match suggestions.') });
    } finally {
      setPreTripSuggestionsLoading(null);
    }
  };

  const runPreTripAdminAction = async (
    submissionId: string,
    action: 'match' | 'approve' | 'reject'
  ) => {
    const matched_booking_id = (preTripMatchIds[submissionId] || '').trim();
    if ((action === 'match' || action === 'approve') && !matched_booking_id) {
      window.alert('Enter a booking ID to match this submission.');
      return;
    }
    setPreTripActionBusy(submissionId);
    try {
      const token = await getAdminToken();
      if (!token) {
        window.alert('Sign in again to continue.');
        return;
      }
      const out = await withTimeout(
        'Admin pre-trip action',
        adminUpdatePreTripSubmission(token, submissionId, {
          action,
          matched_booking_id: matched_booking_id || undefined,
          admin_notes: preTripNotes[submissionId]?.trim() || undefined,
        }),
        15000
      );
      if (!out.ok) {
        window.alert(out.error || 'Action failed.');
        return;
      }
      setNotice({ variant: 'success', text: `Submission ${action}ed successfully.` });
      void loadPreTripSubmissions();
    } catch (err) {
      setNotice({ variant: 'error', text: describeError(err, 'Pre-trip action failed.') });
    } finally {
      setPreTripActionBusy(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }
  if (preTripLoading && !hasLoaded) return <FullPageLoader message="Loading pre-trip submissions…" />;

  return (
    <AdminShell
      title="Pre-Trip Submissions"
      subtitle="Off-platform waiver and insurance uploads"
      actions={
        <>
          <Link
            to="/admin/bookings"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Bookings
          </Link>
          <button
            type="button"
            onClick={() => void loadPreTripSubmissions()}
            disabled={preTripLoading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            {preTripLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </>
      }
    >
      {notice ? (
        <div className={`mb-5 rounded-xl px-4 py-3 font-semibold ${notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="relative rounded-xl bg-white shadow">
        {preTripLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60">
            <div className="text-sm font-semibold text-slate-600">Loading submissions…</div>
          </div>
        )}
        <div className="border-b border-slate-200 p-6">
          <h2 className="text-2xl font-bold text-slate-900">Pre-Trip Submissions</h2>
          <p className="mt-1 text-sm text-slate-500">
            Off-platform waiver and insurance uploads. Match to an existing booking, then approve or reject.
          </p>
        </div>
        <AdminResponsiveList
          desktop={
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Trip</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Docs</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Match booking</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {preTripSubmissions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No pre-trip submissions yet.
                      </td>
                    </tr>
                  ) : (
                    preTripSubmissions.map((row) => (
                      <tr key={row.id} className="align-top hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{row.customer_name || '—'}</div>
                          <div className="text-slate-600">{row.email}</div>
                          <div className="text-xs text-slate-500">{row.phone || '—'}</div>
                          {row.groupon_code ? (
                            <div className="mt-1 text-xs font-medium text-emerald-700">Groupon: {row.groupon_code}</div>
                          ) : null}
                          <div className="mt-1 font-mono text-[10px] text-slate-400" title={row.id}>{shortId(row.id)}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-800">
                          <div>{tripTypeLabel(row.trip_type)}</div>
                          {row.requested_trip_date ? (
                            <div className="text-xs text-slate-500">
                              {new Date(row.requested_trip_date).toLocaleString()}
                            </div>
                          ) : null}
                          {row.selected_boat_reg_no ? (
                            <div className="text-xs text-slate-500">Buoy {row.selected_boat_reg_no}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 text-xs">
                            <span>Waiver: {row.waiver_signed ? '✅' : '❌'}</span>
                            <span>License: {row.license_status}</span>
                            <span>Insurance: {row.insurance_status}</span>
                            {row.license_url ? (
                              <a
                                href={row.license_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-blue-700 hover:underline"
                              >
                                View license
                              </a>
                            ) : null}
                            {row.insurance_url ? (
                              <a
                                href={row.insurance_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold text-blue-700 hover:underline"
                              >
                                View insurance
                              </a>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-800">
                            {row.admin_status.replace(/_/g, ' ')}
                          </span>
                          {row.matched_booking_id ? (
                            <div className="mt-1 font-mono text-[10px] text-slate-500" title={row.matched_booking_id}>
                              → {shortId(row.matched_booking_id)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            placeholder="Booking UUID"
                            value={preTripMatchIds[row.id] ?? row.matched_booking_id ?? ''}
                            onChange={(e) =>
                              setPreTripMatchIds((prev) => ({ ...prev, [row.id]: e.target.value }))
                            }
                            className="mb-2 w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                          {row.groupon_code || row.email ? (
                            <div className="mb-2">
                              <button
                                type="button"
                                disabled={preTripSuggestionsLoading === row.id}
                                onClick={() => void loadPreTripSuggestions(row.id)}
                                className="text-xs font-semibold text-cyan-700 hover:underline disabled:opacity-50"
                              >
                                {preTripSuggestionsLoading === row.id
                                  ? 'Finding matches…'
                                  : 'Suggest matching bookings'}
                              </button>
                              {(preTripSuggestions[row.id] || []).length > 0 ? (
                                <ul className="mt-2 space-y-1">
                                  {preTripSuggestions[row.id].map((s) => (
                                    <li key={s.id}>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPreTripMatchIds((prev) => ({ ...prev, [row.id]: s.id }))
                                        }
                                        className="w-full rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-left text-[11px] text-emerald-900 hover:bg-emerald-100"
                                      >
                                        <span className="font-semibold">{s.match_reason}</span>
                                        <br />
                                        {s.customer_name || 'Customer'} ·{' '}
                                        {new Date(s.start_time).toLocaleDateString()}
                                        {s.promo_code ? ` · ${s.promo_code}` : ''}
                                        <br />
                                        <span className="font-mono text-[10px]" title={s.id}>{shortId(s.id)}</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              ) : preTripSuggestions[row.id] ? (
                                <p className="mt-1 text-[11px] text-slate-500">No automatic matches found.</p>
                              ) : null}
                            </div>
                          ) : null}
                          <textarea
                            placeholder="Admin notes"
                            rows={2}
                            value={preTripNotes[row.id] ?? row.admin_notes ?? ''}
                            onChange={(e) =>
                              setPreTripNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                            }
                            className="w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              disabled={preTripActionBusy === row.id}
                              onClick={() => void runPreTripAdminAction(row.id, 'match')}
                              className="rounded bg-cyan-700 px-2 py-1 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-40"
                            >
                              Match
                            </button>
                            <button
                              type="button"
                              disabled={preTripActionBusy === row.id}
                              onClick={() => void runPreTripAdminAction(row.id, 'approve')}
                              className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={preTripActionBusy === row.id}
                              onClick={() => void runPreTripAdminAction(row.id, 'reject')}
                              className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          }
          mobile={
            <div className="space-y-3 p-3">
              {preTripSubmissions.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No pre-trip submissions yet.</p>
              ) : null}
              {preTripSubmissions.map((row) => (
                <MobileAdminCard
                  key={`pre-m-${row.id}`}
                  title={row.customer_name || 'Customer'}
                  subtitle={row.email}
                  badge={
                    <StatusBadge tone={row.admin_status === 'approved' ? 'success' : row.admin_status === 'rejected' ? 'danger' : 'warning'}>
                      {humanizeLabel(row.admin_status)}
                    </StatusBadge>
                  }
                  fields={[
                    { label: 'Phone', value: row.phone || '—', hideIfEmpty: true },
                    { label: 'Trip', value: tripTypeLabel(row.trip_type) },
                    {
                      label: 'Requested',
                      value: row.requested_trip_date
                        ? new Date(row.requested_trip_date).toLocaleString()
                        : '—',
                      hideIfEmpty: true,
                    },
                    {
                      label: 'Docs',
                      value: `Waiver ${row.waiver_signed ? 'Yes' : 'No'} · License ${humanizeLabel(row.license_status)} · Insurance ${humanizeLabel(row.insurance_status)}`,
                    },
                    {
                      label: 'Matched',
                      value: row.matched_booking_id ? (
                        <span className="font-mono text-xs" title={row.matched_booking_id}>
                          {shortId(row.matched_booking_id)}
                        </span>
                      ) : (
                        '—'
                      ),
                    },
                    {
                      label: 'Ref',
                      value: (
                        <span className="font-mono text-xs" title={row.id}>
                          {shortId(row.id)}
                        </span>
                      ),
                    },
                  ]}
                  actions={
                    <AdminActions columns={1}>
                      <label className="block text-sm font-semibold text-slate-700">
                        Match booking
                        <input
                          type="text"
                          placeholder="Booking UUID"
                          value={preTripMatchIds[row.id] ?? row.matched_booking_id ?? ''}
                          onChange={(e) =>
                            setPreTripMatchIds((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      {(row.groupon_code || row.email) ? (
                        <button
                          type="button"
                          disabled={preTripSuggestionsLoading === row.id}
                          onClick={() => void loadPreTripSuggestions(row.id)}
                          className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm font-semibold text-cyan-900 disabled:opacity-50"
                        >
                          {preTripSuggestionsLoading === row.id ? 'Finding matches…' : 'Suggest matches'}
                        </button>
                      ) : null}
                      {(preTripSuggestions[row.id] || []).length > 0 ? (
                        <ul className="space-y-1">
                          {preTripSuggestions[row.id].map((s) => (
                            <li key={s.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  setPreTripMatchIds((prev) => ({ ...prev, [row.id]: s.id }))
                                }
                                className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-900"
                              >
                                <span className="font-semibold">{s.match_reason}</span>
                                <br />
                                {s.customer_name || 'Customer'} · {new Date(s.start_time).toLocaleDateString()}
                                <br />
                                <span className="font-mono" title={s.id}>{shortId(s.id)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <textarea
                        placeholder="Admin notes"
                        rows={2}
                        value={preTripNotes[row.id] ?? row.admin_notes ?? ''}
                        onChange={(e) =>
                          setPreTripNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                        className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          disabled={preTripActionBusy === row.id}
                          onClick={() => void runPreTripAdminAction(row.id, 'match')}
                          className="rounded-lg bg-cyan-700 px-2 py-2 text-sm font-semibold text-white disabled:opacity-40"
                        >
                          Match
                        </button>
                        <button
                          type="button"
                          disabled={preTripActionBusy === row.id}
                          onClick={() => void runPreTripAdminAction(row.id, 'approve')}
                          className="rounded-lg bg-green-600 px-2 py-2 text-sm font-semibold text-white disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={preTripActionBusy === row.id}
                          onClick={() => void runPreTripAdminAction(row.id, 'reject')}
                          className="rounded-lg bg-red-600 px-2 py-2 text-sm font-semibold text-white disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                      {row.license_url ? (
                        <a href={row.license_url} target="_blank" rel="noopener noreferrer" className="text-center text-sm font-semibold text-blue-700 underline">
                          View license
                        </a>
                      ) : null}
                      {row.insurance_url ? (
                        <a href={row.insurance_url} target="_blank" rel="noopener noreferrer" className="text-center text-sm font-semibold text-blue-700 underline">
                          View insurance
                        </a>
                      ) : null}
                    </AdminActions>
                  }
                />
              ))}
            </div>
          }
        />
      </div>
    </AdminShell>
  );
}
