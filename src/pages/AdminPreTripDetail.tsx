import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import {
  adminUpdatePreTripSubmission,
  fetchPreTripMatchSuggestions,
  type PreTripMatchSuggestion,
} from '../lib/publicBooking';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import LoadingSection from '../components/admin/LoadingSection';
import StatusBadge from '../components/admin/StatusBadge';
import AdminDocumentViewer from '../components/admin/AdminDocumentViewer';
import AdminSignatureVerification from '../components/admin/AdminSignatureVerification';
import PreTripReviewActions from '../components/admin/PreTripReviewActions';
import PreTripRejectModal from '../components/admin/PreTripRejectModal';
import {
  ADMIN_MOBILE_STICKY_NOTICE_CLASS,
  humanizeLabel,
  shortId,
} from '../components/admin/adminDisplay';
import {
  formatReviewedAt,
  isPreTripTerminal,
  preTripNeedsReview,
  preTripStatusTone,
  resolvePreTripSelectedBookingId,
  tripTypeLabel,
  type PreTripSubmissionRow,
} from '../lib/preTripAdminShared';
import { describeError, withTimeout } from '../lib/adminDiagnostics';

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow sm:p-5">
      <h2 className="text-lg font-black text-slate-900">{title}</h2>
      <div className="mt-3 space-y-2 text-sm text-slate-800">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="font-semibold text-slate-900 sm:text-right">{value}</span>
    </div>
  );
}

export default function AdminPreTripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAdmin, loading: authLoading } = useAuth();

  const [submission, setSubmission] = useState<PreTripSubmissionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<PreTripMatchSuggestion[] | undefined>();
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [actionBusy, setActionBusy] = useState<'approve' | 'reject' | 'match' | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const getAdminToken = useCallback(async () => {
    const {
      data: { session },
    } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return session?.access_token || null;
  }, []);

  const loadSubmission = useCallback(async () => {
    if (!isAdmin || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await withTimeout(
        'Admin pre-trip submission detail',
        supabase.from('pre_trip_submissions').select('*').eq('id', id).maybeSingle(),
        15000
      );
      logSupabaseError('AdminPreTripDetail.loadSubmission', error);
      if (error) throw error;
      const row = (data as PreTripSubmissionRow | null) ?? null;
      if (!row?.id) {
        setSubmission(null);
        return;
      }
      setSubmission(row);
      setAdminNotes(row.admin_notes || '');
      setSelectedMatchId(row.matched_booking_id);
      setSuggestions(undefined);
    } catch (err) {
      setSubmission(null);
      setNotice({ variant: 'error', text: describeError(err, 'Could not load submission.') });
    } finally {
      setLoading(false);
    }
  }, [id, isAdmin]);

  const loadSuggestions = useCallback(
    async (query?: string) => {
      if (!id) return;
      setSuggestionsLoading(true);
      try {
        const token = await getAdminToken();
        if (!token) {
          setNotice({ variant: 'error', text: 'Sign in again to load booking matches.' });
          return;
        }
        const out = await withTimeout(
          'Admin pre-trip match suggestions',
          fetchPreTripMatchSuggestions(token, id, query),
          15000
        );
        if (out.ok) {
          setSuggestions(out.suggestions);
          if (out.suggestions.length === 1) {
            setSelectedMatchId((prev) => prev || out.suggestions[0].id);
          }
        } else {
          setSuggestions([]);
          setNotice({ variant: 'error', text: out.error || 'Could not search for bookings.' });
        }
      } catch (err) {
        setNotice({ variant: 'error', text: describeError(err, 'Could not load match suggestions.') });
      } finally {
        setSuggestionsLoading(false);
      }
    },
    [getAdminToken, id]
  );

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    void loadSubmission();
  }, [authLoading, isAdmin, loadSubmission]);

  useEffect(() => {
    if (!submission?.id || !preTripNeedsReview(submission.admin_status)) return;
    void loadSuggestions();
  }, [loadSuggestions, submission?.id, submission?.admin_status]);

  const resolveBookingId = (): string | null =>
    resolvePreTripSelectedBookingId(selectedMatchId, submission?.matched_booking_id, suggestions);

  const runAction = async (action: 'approve' | 'reject', rejectionReason?: string) => {
    if (!submission) return;
    if (isPreTripTerminal(submission.admin_status)) {
      setNotice({ variant: 'error', text: `This submission is already ${submission.admin_status}.` });
      return;
    }
    const matched_booking_id = resolveBookingId();
    if (action === 'approve' && !matched_booking_id) {
      setNotice({ variant: 'error', text: 'Select a booking match before approving.' });
      return;
    }
    if (action === 'reject' && !rejectionReason?.trim()) {
      setRejectOpen(true);
      return;
    }

    setActionBusy(action);
    try {
      const token = await getAdminToken();
      if (!token) {
        setNotice({ variant: 'error', text: 'Sign in again to continue.' });
        return;
      }
      const out = await withTimeout(
        'Admin pre-trip action',
        adminUpdatePreTripSubmission(token, submission.id, {
          action,
          matched_booking_id: matched_booking_id || undefined,
          admin_notes: adminNotes.trim() || undefined,
          rejection_reason: rejectionReason?.trim() || undefined,
        }),
        15000
      );
      if (!out.ok) {
        setNotice({ variant: 'error', text: out.error || 'Action failed.' });
        return;
      }
      setRejectOpen(false);
      setNotice({
        variant: 'success',
        text: action === 'reject' ? 'Submission rejected.' : 'Submission approved and linked to booking.',
      });
      await loadSubmission();
    } catch (err) {
      setNotice({ variant: 'error', text: describeError(err, 'Pre-trip action failed.') });
    } finally {
      setActionBusy(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) return <AdminAccessDenied signedIn={Boolean(user)} />;

  const title = submission?.customer_name || submission?.email || 'Pre-Trip Submission';
  const needsReview = submission ? preTripNeedsReview(submission.admin_status) : false;

  return (
    <AdminShell
      title={title}
      subtitle={submission ? `Submission ${shortId(submission.id)}` : 'Loading…'}
      actions={
        <>
          <Link
            to="/admin/pre-trip"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to queue
          </Link>
          <button
            type="button"
            onClick={() => void loadSubmission()}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            {loading ? 'Refreshing…' : 'Refresh'}
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

      {loading && !submission ? (
        <LoadingSection message="Loading submission…" />
      ) : !submission ? (
        <div className="rounded-2xl bg-white p-6 shadow">
          <p className="text-slate-700">Submission not found.</p>
          <button
            type="button"
            onClick={() => navigate('/admin/pre-trip')}
            className="mt-4 min-h-11 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white"
          >
            Back to pre-trip queue
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={preTripStatusTone(submission.admin_status)}>
              {humanizeLabel(submission.admin_status)}
            </StatusBadge>
            {submission.matched_booking_id ? (
              <Link
                to={`/admin/bookings/${submission.matched_booking_id}`}
                className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 hover:bg-amber-200"
              >
                Open matched booking {shortId(submission.matched_booking_id, 10)}
              </Link>
            ) : null}
          </div>

          {needsReview ? (
            <PreTripReviewActions
              row={submission}
              suggestions={suggestions}
              suggestionsLoading={suggestionsLoading}
              selectedId={selectedMatchId}
              adminNotes={adminNotes}
              actionBusy={actionBusy}
              sticky
              onSelectMatch={setSelectedMatchId}
              onLoadSuggestions={() => void loadSuggestions()}
              onSearch={(query) => void loadSuggestions(query)}
              onNotesChange={setAdminNotes}
              onApprove={() => void runAction('approve')}
              onReject={() => setRejectOpen(true)}
            />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <InfoCard title="Customer">
              <InfoRow label="Name" value={submission.customer_name || '—'} />
              <InfoRow label="Email" value={submission.email} />
              <InfoRow label="Phone" value={submission.phone || '—'} />
              {submission.groupon_code ? (
                <InfoRow label="Groupon" value={submission.groupon_code} />
              ) : null}
              <InfoRow
                label="Submitted"
                value={new Date(submission.created_at).toLocaleString()}
              />
              <InfoRow
                label="Submission ID"
                value={<span className="font-mono text-xs" title={submission.id}>{shortId(submission.id, 12)}</span>}
              />
            </InfoCard>

            <InfoCard title="Trip">
              <InfoRow label="Type" value={tripTypeLabel(submission.trip_type)} />
              <InfoRow
                label="Requested date"
                value={
                  submission.requested_trip_date
                    ? new Date(submission.requested_trip_date).toLocaleString()
                    : '—'
                }
              />
              <InfoRow label="Buoy boat" value={submission.selected_boat_reg_no || '—'} />
              <InfoRow label="License status" value={humanizeLabel(submission.license_status)} />
              <InfoRow label="Insurance status" value={humanizeLabel(submission.insurance_status)} />
            </InfoCard>
          </div>

          <InfoCard title="Signed waiver">
            <AdminSignatureVerification
              variant="panel"
              mode="pre_trip"
              data={{
                id: submission.id,
                waiver_signed: submission.waiver_signed,
                waiver_signature: submission.waiver_signature,
                waiver_signed_at: submission.waiver_signed_at,
                created_at: submission.created_at,
              }}
            />
          </InfoCard>

          <InfoCard title="Documents">
            <div className="flex flex-wrap gap-2">
              <AdminDocumentViewer
                context="pre_trip"
                recordId={submission.id}
                document="license"
                label="View license"
                available={Boolean(submission.license_url)}
                linkClassName="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
              />
              <AdminDocumentViewer
                context="pre_trip"
                recordId={submission.id}
                document="insurance"
                label="View insurance"
                available={Boolean(submission.insurance_url)}
                linkClassName="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
              />
            </div>
            {!submission.license_url && !submission.insurance_url ? (
              <p className="text-sm text-slate-500">No documents uploaded.</p>
            ) : null}
          </InfoCard>

          {submission.reviewed_at || submission.rejection_reason ? (
            <InfoCard title="Review audit">
              {submission.reviewed_at ? (
                <InfoRow label="Reviewed" value={formatReviewedAt(submission.reviewed_at)} />
              ) : null}
              {submission.rejection_reason ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                  {submission.rejection_reason}
                </div>
              ) : null}
            </InfoCard>
          ) : null}
        </div>
      )}

      <PreTripRejectModal
        open={rejectOpen}
        customerLabel={submission?.customer_name || submission?.email || undefined}
        busy={actionBusy === 'reject'}
        onClose={() => {
          if (actionBusy === 'reject') return;
          setRejectOpen(false);
        }}
        onConfirm={(reason) => void runAction('reject', reason)}
      />
    </AdminShell>
  );
}
