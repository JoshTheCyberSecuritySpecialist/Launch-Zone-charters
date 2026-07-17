import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import AdminActions from '../components/admin/AdminActions';
import StatusBadge from '../components/admin/StatusBadge';
import LoadingSection from '../components/admin/LoadingSection';
import AdminSignatureVerification from '../components/admin/AdminSignatureVerification';
import { ADMIN_MOBILE_STICKY_NOTICE_CLASS, humanizeLabel, shortId } from '../components/admin/adminDisplay';
import {
  filterPreTripSubmissions,
  formatReviewedAt,
  preTripStatusTone,
  tripTypeLabel,
  type PreTripListFilter,
  type PreTripSubmissionRow,
} from '../lib/preTripAdminShared';
import { describeError, withTimeout } from '../lib/adminDiagnostics';

export default function AdminPreTrip() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [preTripSubmissions, setPreTripSubmissions] = useState<PreTripSubmissionRow[]>([]);
  const [preTripLoading, setPreTripLoading] = useState(false);
  const [listFilter, setListFilter] = useState<PreTripListFilter>('review');

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

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }

  const initialLoading = preTripLoading && !hasLoaded;
  const visibleSubmissions = filterPreTripSubmissions(preTripSubmissions, listFilter);
  const reviewCount = filterPreTripSubmissions(preTripSubmissions, 'review').length;

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
        <div
          className={`${ADMIN_MOBILE_STICKY_NOTICE_CLASS} ${
            notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
          role="status"
        >
          {notice.text}
        </div>
      ) : null}

      <div className="relative rounded-xl bg-white shadow">
        {preTripLoading && !hasLoaded && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60">
            <div className="text-sm font-semibold text-slate-600">Loading submissions…</div>
          </div>
        )}
        <div className="border-b border-slate-200 p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Pre-Trip Submissions</h2>
              <p className="mt-1 text-sm text-slate-500">
                Off-platform waiver and insurance uploads. Open a submission to review documents and approve.
              </p>
            </div>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setListFilter('review')}
                className={`min-h-10 rounded-md px-3 py-2 text-sm font-bold ${
                  listFilter === 'review' ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-600'
                }`}
              >
                Needs review ({reviewCount})
              </button>
              <button
                type="button"
                onClick={() => setListFilter('all')}
                className={`min-h-10 rounded-md px-3 py-2 text-sm font-bold ${
                  listFilter === 'all' ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-600'
                }`}
              >
                All ({preTripSubmissions.length})
              </button>
            </div>
          </div>
        </div>
        {initialLoading ? (
          <LoadingSection message="Loading pre-trip submissions…" className="m-4" />
        ) : (
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
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {visibleSubmissions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          {listFilter === 'review'
                            ? 'No submissions need review right now.'
                            : 'No pre-trip submissions yet.'}
                        </td>
                      </tr>
                    ) : (
                      visibleSubmissions.map((row) => (
                        <tr key={row.id} className="align-top hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{row.customer_name || '—'}</div>
                            <div className="text-slate-600">{row.email}</div>
                            <div className="text-xs text-slate-500">{row.phone || '—'}</div>
                            {row.groupon_code ? (
                              <div className="mt-1 text-xs font-medium text-emerald-700">Groupon: {row.groupon_code}</div>
                            ) : null}
                            <Link
                              to={`/admin/pre-trip/${row.id}`}
                              className="mt-2 inline-flex text-xs font-bold text-amber-800 underline"
                            >
                              Open submission
                            </Link>
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
                            <div className="flex flex-col gap-2 text-xs">
                              {row.waiver_signed ? (
                                <AdminSignatureVerification
                                  variant="compact"
                                  mode="pre_trip"
                                  data={{
                                    waiver_signed: row.waiver_signed,
                                    waiver_signature: row.waiver_signature,
                                    waiver_signed_at: row.waiver_signed_at,
                                    created_at: row.created_at,
                                  }}
                                />
                              ) : (
                                <span className="text-slate-500">Waiver not signed</span>
                              )}
                              <span>License: {humanizeLabel(row.license_status)}</span>
                              <span>Insurance: {humanizeLabel(row.insurance_status)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge tone={preTripStatusTone(row.admin_status)}>
                              {humanizeLabel(row.admin_status)}
                            </StatusBadge>
                            {row.matched_booking_id ? (
                              <div className="mt-1 font-mono text-[10px] text-slate-500" title={row.matched_booking_id}>
                                → {shortId(row.matched_booking_id)}
                              </div>
                            ) : null}
                            {row.reviewed_at ? (
                              <div className="mt-1 text-[10px] text-slate-500">
                                Reviewed {formatReviewedAt(row.reviewed_at)}
                              </div>
                            ) : null}
                            {row.rejection_reason ? (
                              <div className="mt-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-800">
                                {row.rejection_reason}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              to={`/admin/pre-trip/${row.id}`}
                              className="inline-flex rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
                            >
                              Review
                            </Link>
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
                {visibleSubmissions.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    {listFilter === 'review'
                      ? 'No submissions need review right now.'
                      : 'No pre-trip submissions yet.'}
                  </p>
                ) : null}
                {visibleSubmissions.map((row) => (
                  <MobileAdminCard
                    key={`pre-m-${row.id}`}
                    title={row.customer_name || 'Customer'}
                    subtitle={row.email}
                    badge={
                      <StatusBadge tone={preTripStatusTone(row.admin_status)}>
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
                        label: 'Waiver',
                        value: row.waiver_signed ? (
                          <AdminSignatureVerification
                            variant="compact"
                            mode="pre_trip"
                            data={{
                              waiver_signed: row.waiver_signed,
                              waiver_signature: row.waiver_signature,
                              waiver_signed_at: row.waiver_signed_at,
                              created_at: row.created_at,
                            }}
                          />
                        ) : (
                          'Not signed'
                        ),
                      },
                      {
                        label: 'Docs',
                        value: `License ${humanizeLabel(row.license_status)} · Insurance ${humanizeLabel(row.insurance_status)}`,
                      },
                      {
                        label: 'Status',
                        value: row.rejection_reason
                          ? `Rejected — ${row.rejection_reason}`
                          : row.reviewed_at
                            ? `${humanizeLabel(row.admin_status)} · ${formatReviewedAt(row.reviewed_at)}`
                            : humanizeLabel(row.admin_status),
                      },
                      {
                        label: 'Matched',
                        value: row.matched_booking_id ? (
                          <Link
                            to={`/admin/bookings/${row.matched_booking_id}`}
                            className="font-semibold text-amber-800 underline"
                          >
                            Open booking {shortId(row.matched_booking_id, 10)}
                          </Link>
                        ) : (
                          '—'
                        ),
                      },
                    ]}
                    actions={
                      <AdminActions columns={1}>
                        <Link
                          to={`/admin/pre-trip/${row.id}`}
                          className="min-h-12 rounded-lg bg-amber-600 px-3 py-3 text-center text-base font-bold text-white"
                        >
                          Review submission
                        </Link>
                      </AdminActions>
                    }
                  />
                ))}
              </div>
            }
          />
        )}
      </div>
    </AdminShell>
  );
}
