import { shortId } from './adminDisplay';

type PreTripSignature = {
  waiver_signed?: boolean;
  waiver_signature?: string | null;
  waiver_signed_at?: string | null;
  id?: string;
};

type BookingWaiver = {
  electronic_signature?: string | null;
  signature_date?: string | null;
  ip_address?: string | null;
  accepted?: boolean | null;
};

type Props =
  | {
      mode: 'pre_trip';
      data: PreTripSignature;
    }
  | {
      mode: 'booking';
      data: {
        waiver_signed?: boolean;
        waiver_signed_at?: string | null;
        waivers?: BookingWaiver[] | BookingWaiver | null;
      };
      bookingId?: string;
    };

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function AdminSignatureVerification(props: Props) {
  if (props.mode === 'pre_trip') {
    const { data } = props;
    if (!data.waiver_signed) {
      return <p className="text-xs text-slate-500">Waiver not signed.</p>;
    }
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
        <p className="font-bold text-slate-900">Electronic signature (typed name)</p>
        <p className="mt-1 font-semibold">{data.waiver_signature?.trim() || '—'}</p>
        <p className="mt-1 text-slate-600">Signed: {formatWhen(data.waiver_signed_at)}</p>
        {data.id ? (
          <p className="mt-1 font-mono text-[10px] text-slate-400" title={data.id}>
            Submission {shortId(data.id)}
          </p>
        ) : null}
        <p className="mt-2 text-[10px] leading-snug text-slate-500">
          No drawn signature image is stored for this record — only the typed legal name and timestamp.
        </p>
      </div>
    );
  }

  const waiver = Array.isArray(props.data.waivers) ? props.data.waivers[0] : props.data.waivers;
  const signed = Boolean(props.data.waiver_signed || waiver?.electronic_signature);
  if (!signed) {
    return <p className="text-xs text-slate-500">Waiver not signed.</p>;
  }

  const signatureText = waiver?.electronic_signature?.trim() || '—';
  const signedAt = waiver?.signature_date || props.data.waiver_signed_at;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
      <p className="font-bold text-slate-900">Electronic signature (typed name)</p>
      <p className="mt-1 font-semibold">{signatureText}</p>
      <p className="mt-1 text-slate-600">Signed: {formatWhen(signedAt)}</p>
      {waiver?.ip_address ? <p className="mt-1 text-slate-600">IP: {waiver.ip_address}</p> : null}
      {props.bookingId ? (
        <p className="mt-1 font-mono text-[10px] text-slate-400" title={props.bookingId}>
          Booking {shortId(props.bookingId)}
        </p>
      ) : null}
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        No drawn signature image is stored for this record — only the typed legal name and timestamp.
      </p>
    </div>
  );
}
