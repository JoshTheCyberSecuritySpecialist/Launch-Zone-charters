import { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { downloadAdminWaiverPdf } from '../../lib/adminWaivers';
import { withTimeout } from '../../lib/adminDiagnostics';
import { shortId } from './adminDisplay';

type PreTripSignature = {
  waiver_signed?: boolean;
  waiver_signature?: string | null;
  waiver_signed_at?: string | null;
  created_at?: string | null;
  id?: string;
};

type BookingWaiver = {
  electronic_signature?: string | null;
  signature_date?: string | null;
  ip_address?: string | null;
  waiver_content?: string | null;
  waiver_version?: string | null;
  waiver_version_effective_at?: string | null;
  accepted?: boolean | null;
};

type Props = {
  variant?: 'compact' | 'panel';
} & (
  | {
      mode: 'pre_trip';
      data: PreTripSignature;
    }
  | {
      mode: 'booking';
      data: {
        waiver_signed?: boolean;
        waiver_signed_at?: string | null;
        terms_accepted?: boolean | null;
        damage_fee_acknowledged?: boolean | null;
        waivers?: BookingWaiver[] | BookingWaiver | null;
      };
      bookingId?: string;
    }
);

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString();
}

function inferWaiverSource(waiver: BookingWaiver | null | undefined): string {
  const content = String(waiver?.waiver_content || '').toLowerCase();
  if (content.includes('pre-trip')) return 'Off-platform pre-trip form';
  if (content.includes('checkout') || content.includes('stripe')) return 'Website checkout';
  if (content) return 'Waivers & insurance page';
  return 'Booking record';
}

function AckRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-slate-700">{label}</span>
      <span className={`font-semibold ${done ? 'text-green-700' : 'text-slate-400'}`}>{done ? 'Yes' : 'No'}</span>
    </div>
  );
}

function VerificationDisclaimer() {
  return (
    <p className="text-[10px] leading-snug text-slate-500">
      This system stores a typed legal name and timestamp — not a drawn signature image. Use this panel to verify
      what was captured, not to imply a pen-and-ink signature exists.
    </p>
  );
}

function WaiverPdfDownloadButton({
  context,
  recordId,
}: {
  context: 'pre_trip' | 'booking';
  recordId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
      if (!session?.access_token) throw new Error('Admin session expired.');
      await downloadAdminWaiverPdf(session.access_token, { context, recordId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleDownload()}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
      >
        <FileText className="h-4 w-4" aria-hidden />
        {busy ? 'Generating PDF…' : 'Download signed waiver PDF'}
      </button>
      {error ? (
        <p className="mt-2 text-[10px] font-semibold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function AdminSignatureVerification(props: Props) {
  const variant = props.variant || 'panel';
  const [expanded, setExpanded] = useState(variant === 'panel');

  if (props.mode === 'pre_trip') {
    const { data } = props;
    if (!data.waiver_signed) {
      return variant === 'compact' ? (
        <span className="text-slate-500">Not signed</span>
      ) : (
        <p className="text-xs text-slate-500">Waiver not signed.</p>
      );
    }

    const signatureText = data.waiver_signature?.trim() || '—';
    const signedAt = data.waiver_signed_at || data.created_at || null;

    if (variant === 'compact') {
      return (
        <div className="text-xs text-slate-800">
          <span className="font-semibold text-green-700">{signatureText}</span>
          <span className="text-slate-500"> · {formatWhen(signedAt)}</span>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3 text-xs text-slate-800">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-black text-slate-900">Waiver verification</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
              Off-platform pre-trip form
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Typed legal name</p>
          <p className="mt-1 text-sm font-black text-slate-900">{signatureText}</p>
          <p className="mt-2 text-slate-600">
            <span className="font-semibold text-slate-700">Signed:</span> {formatWhen(signedAt)}
          </p>
        </div>

        <div className="mt-3 space-y-1 rounded-md border border-slate-200 bg-white px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Acknowledgements at submit</p>
          <AckRow label="Terms of service" done={true} />
          <AckRow label="Liability waiver" done={true} />
          <AckRow label="$500 damage fee policy" done={true} />
          <p className="pt-1 text-[10px] text-slate-500">
            All three are required before a pre-trip submission is accepted.
          </p>
        </div>

        {data.id ? (
          <p className="mt-2 font-mono text-[10px] text-slate-400" title={data.id}>
            Submission {shortId(data.id)}
          </p>
        ) : null}

        {data.id ? <WaiverPdfDownloadButton context="pre_trip" recordId={data.id} /> : null}

        <div className="mt-3">
          <VerificationDisclaimer />
        </div>
      </div>
    );
  }

  const waiver = Array.isArray(props.data.waivers) ? props.data.waivers[0] : props.data.waivers;
  const signed = Boolean(props.data.waiver_signed || waiver?.electronic_signature);
  if (!signed) {
    return variant === 'compact' ? (
      <span className="text-slate-500">Not signed</span>
    ) : (
      <p className="text-xs text-slate-500">Waiver not signed.</p>
    );
  }

  const signatureText = waiver?.electronic_signature?.trim() || '—';
  const signedAt = waiver?.signature_date || props.data.waiver_signed_at;
  const source = inferWaiverSource(waiver);
  const termsAccepted = Boolean(props.data.terms_accepted);
  const damageAck = Boolean(props.data.damage_fee_acknowledged);
  const waiverAccepted = waiver?.accepted !== false;

  if (variant === 'compact') {
    return (
      <div className="text-xs text-slate-800">
        <span className="font-semibold text-green-700">{signatureText}</span>
        <span className="text-slate-500"> · {formatWhen(signedAt)}</span>
      </div>
    );
  }

  const waiverContent = waiver?.waiver_content?.trim() || '';

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-3 text-xs text-slate-800">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-black text-slate-900">Waiver verification</p>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">{source}</p>
        </div>
        {variant === 'panel' ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-bold text-slate-700"
            aria-expanded={expanded}
          >
            {expanded ? 'Less' : 'More'}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        ) : null}
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Typed legal name</p>
        <p className="mt-1 text-sm font-black text-slate-900">{signatureText}</p>
        <p className="mt-2 text-slate-600">
          <span className="font-semibold text-slate-700">Signed:</span> {formatWhen(signedAt)}
        </p>
        {'waiver_version' in (waiver || {}) && waiver?.waiver_version ? (
          <p className="mt-1 text-slate-600">
            <span className="font-semibold text-slate-700">Waiver version:</span> {waiver.waiver_version}
            {waiver.waiver_version_effective_at
              ? ` (effective ${formatWhen(waiver.waiver_version_effective_at)})`
              : ''}
          </p>
        ) : null}
        {waiver?.ip_address ? (
          <p className="mt-1 text-slate-600">
            <span className="font-semibold text-slate-700">IP:</span> {waiver.ip_address}
          </p>
        ) : (
          <p className="mt-1 text-slate-500">IP not recorded for this waiver.</p>
        )}
      </div>

      {props.bookingId ? <WaiverPdfDownloadButton context="booking" recordId={props.bookingId} /> : null}

      {expanded ? (
        <>
          <div className="mt-3 space-y-1 rounded-md border border-slate-200 bg-white px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Acknowledgements</p>
            <AckRow label="Terms of service" done={termsAccepted} />
            <AckRow label="Liability waiver accepted" done={waiverAccepted} />
            <AckRow label="$500 damage fee policy" done={damageAck} />
          </div>

          {waiverContent ? (
            <details className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2">
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Waiver content on file
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{waiverContent}</p>
            </details>
          ) : (
            <p className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-500">
              Full waiver text was not stored with this record — only signature metadata.
            </p>
          )}

          {props.bookingId ? (
            <p className="mt-2 font-mono text-[10px] text-slate-400" title={props.bookingId}>
              Booking {shortId(props.bookingId)}
            </p>
          ) : null}

          <div className="mt-3">
            <VerificationDisclaimer />
          </div>
        </>
      ) : null}
    </div>
  );
}
