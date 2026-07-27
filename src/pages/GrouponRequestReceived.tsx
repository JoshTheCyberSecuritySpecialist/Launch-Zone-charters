import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Hash, Mail, Phone, Users } from 'lucide-react';
import { env } from '../config/env.js';
import { wrapNavigateClick } from '../lib/clickPerf';

interface GrouponRequestReceivedProps {
  onNavigate: (page: string) => void;
}

type RequestSummary = {
  bookingId: string;
  status: string;
  startTime: string;
  endTime: string;
  guestCount: number;
  customerName: string | null;
  email: string | null;
  phone: string | null;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function GrouponRequestReceived({ onNavigate }: GrouponRequestReceivedProps) {
  const [searchParams] = useSearchParams();
  const bookingId = (searchParams.get('bookingId') || '').trim();
  const [summary, setSummary] = useState<RequestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!bookingId) {
      setError('Missing booking reference.');
      setLoading(false);
      return;
    }
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setError('Online booking status is unavailable right now. Please call 803-542-1761.');
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(
          `${env.apiUrl}/api/public/groupon-request-status?bookingId=${encodeURIComponent(bookingId)}`
        );
        const payload = (await res.json().catch(() => ({}))) as RequestSummary & { error?: string };
        if (!res.ok) {
          setError(payload.error || 'Could not load your booking request.');
          return;
        }
        setSummary(payload);
      } catch {
        setError('Could not load your booking request.');
      } finally {
        setLoading(false);
      }
    })();
  }, [bookingId]);

  const statusLabel = useMemo(() => {
    const status = String(summary?.status || 'pending_verification');
    if (status === 'pending_verification' || status === 'pending') return 'Pending review';
    if (status === 'confirmed' || status === 'ready_for_departure') return 'Confirmed';
    return status.replace(/_/g, ' ');
  }, [summary?.status]);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-14 text-slate-100 md:py-20">
      <div className="mx-auto max-w-lg">
        {loading ? (
          <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 text-center">
            <h1 className="font-display text-xl font-bold text-white">Loading your request…</h1>
          </div>
        ) : error || !summary ? (
          <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 text-center">
            <h1 className="font-display text-xl font-bold text-white">Request not found</h1>
            <p className="mt-3 text-sm text-slate-400">{error || 'Please contact us if you need help.'}</p>
            <button
              type="button"
              onClick={wrapNavigateClick('groupon_request_received', 'contact', onNavigate)}
              className="lz-btn-primary mt-8 w-full justify-center"
            >
              Contact us
            </button>
          </div>
        ) : (
          <div className="lz-card-glass rounded-[var(--lz-radius-card)] p-8 md:p-10">
            <div className="rounded-xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-center text-amber-50">
              <p className="text-sm font-semibold md:text-base">Request received — awaiting confirmation</p>
            </div>

            <h1 className="mt-6 font-display text-2xl font-bold text-white md:text-3xl">
              Your Groupon request is pending review
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-300 md:text-base">
              Your Groupon booking request has been received. Your requested date and time are{' '}
              <strong className="text-white">not confirmed yet</strong>. Launch Zone Charters will review boat,
              captain, capacity, and schedule availability. You will receive confirmation or an alternate-time message
              after review.
            </p>
            <p className="mt-4 rounded-lg border border-red-400/30 bg-red-950/30 px-4 py-3 text-sm font-semibold text-red-100">
              Do not arrive until you receive a confirmed reservation.
            </p>

            <div className="mt-8 space-y-4 rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/50 p-5 text-sm">
              <div className="flex items-start gap-3">
                <Hash className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Request number</p>
                  <p className="mt-1 break-all font-mono text-white">{summary.bookingId}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 border-t border-white/10 pt-4">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requested date &amp; time</p>
                  <p className="mt-1 text-white">{formatDateTime(summary.startTime)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 border-t border-white/10 pt-4">
                <Users className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" aria-hidden />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guest count</p>
                  <p className="mt-1 text-white">{summary.guestCount}</p>
                </div>
              </div>
              <div className="border-t border-white/10 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
                <p className="mt-1 font-semibold text-amber-200">{statusLabel}</p>
              </div>
              {summary.customerName ? (
                <div className="border-t border-white/10 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</p>
                  <p className="mt-1 text-white">{summary.customerName}</p>
                  {summary.email ? (
                    <p className="mt-1 flex items-center gap-2 text-slate-300">
                      <Mail className="h-4 w-4 shrink-0" aria-hidden />
                      {summary.email}
                    </p>
                  ) : null}
                  {summary.phone ? (
                    <p className="mt-1 flex items-center gap-2 text-slate-300">
                      <Phone className="h-4 w-4 shrink-0" aria-hidden />
                      {summary.phone}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-8 rounded-[var(--lz-radius)] border border-cyan-400/20 bg-cyan-950/25 p-4 text-sm text-cyan-50">
              <p className="font-semibold text-cyan-100">Next steps</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
                <li>Watch for an email or text saying your request was received (awaiting approval).</li>
                <li>We will send a separate confirmation only after admin review.</li>
                <li>Questions? Call <a href="tel:803-542-1761" className="font-semibold text-cyan-200 underline">803-542-1761</a>.</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={wrapNavigateClick('groupon_request_received', 'home', onNavigate)}
              className="lz-btn-secondary mt-8 w-full justify-center"
            >
              Back to home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
