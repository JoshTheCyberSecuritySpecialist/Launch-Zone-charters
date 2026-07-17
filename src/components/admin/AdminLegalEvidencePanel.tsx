import { Download, FileArchive, FileText, ShieldCheck } from 'lucide-react';
import AdminDocumentViewer from './AdminDocumentViewer';
import AdminSignatureVerification from './AdminSignatureVerification';

type Props = {
  bookingId: string;
  booking: Record<string, any>;
  waiverDone: boolean;
  insuranceDone: boolean;
  licenseDone: boolean;
  hasLicenseDoc: boolean;
  hasInsuranceDoc: boolean;
  hasBuoyDoc: boolean;
  checklistDone: boolean;
  evidenceLoading: boolean;
  exportLoading: 'pdf' | 'zip' | null;
  onGenerateSummary: () => void;
  onDownloadPdf: () => void;
  onDownloadZip: () => void;
};

export default function AdminLegalEvidencePanel({
  bookingId,
  booking,
  waiverDone,
  insuranceDone,
  licenseDone,
  hasLicenseDoc,
  hasInsuranceDoc,
  hasBuoyDoc,
  checklistDone,
  evidenceLoading,
  exportLoading,
  onGenerateSummary,
  onDownloadPdf,
  onDownloadZip,
}: Props) {
  const waiver = Array.isArray(booking.waivers) ? booking.waivers[0] : booking.waivers;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-black text-slate-900">Legal Evidence Package</h2>
          <p className="mt-1 text-sm text-slate-600">
            View documents, download signed waiver PDFs, and export a complete evidence ZIP for insurance,
            chargebacks, or legal requests.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={evidenceLoading}
          onClick={onGenerateSummary}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          <FileText className="h-4 w-4" aria-hidden />
          {evidenceLoading ? 'Generating…' : 'View Evidence Summary'}
        </button>
        <button
          type="button"
          disabled={exportLoading != null}
          onClick={onDownloadPdf}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden />
          {exportLoading === 'pdf' ? 'Downloading…' : 'Download Booking Summary PDF'}
        </button>
        <button
          type="button"
          disabled={exportLoading != null}
          onClick={onDownloadZip}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-900 disabled:opacity-50"
        >
          <FileArchive className="h-4 w-4" aria-hidden />
          {exportLoading === 'zip' ? 'Downloading…' : 'Download Evidence Package'}
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Signed waiver</h3>
          {waiverDone ? (
            <div className="mt-3">
              <AdminSignatureVerification
                variant="panel"
                mode="booking"
                bookingId={bookingId}
                data={{
                  waiver_signed: booking.waiver_signed,
                  waiver_signed_at: booking.waiver_signed_at,
                  terms_accepted: booking.terms_accepted,
                  damage_fee_acknowledged: booking.damage_fee_acknowledged,
                  waivers: booking.waivers,
                }}
              />
              {waiver?.waiver_version ? (
                <p className="mt-2 text-xs text-slate-500">
                  Waiver version {waiver.waiver_version}
                  {waiver.waiver_version_effective_at
                    ? ` · effective ${new Date(waiver.waiver_version_effective_at).toLocaleDateString()}`
                    : ''}
                </p>
              ) : (
                <p className="mt-2 text-xs text-amber-700">
                  Waiver version not recorded for this older record.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm font-semibold text-amber-800">Waiver not signed yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Documents</h3>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 font-bold ${licenseDone ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
                Driver&apos;s License: {licenseDone ? 'On file' : 'Missing'}
              </span>
              {hasLicenseDoc ? (
                <AdminDocumentViewer context="booking" recordId={bookingId} document="license" label="View" linkClassName="text-sm font-bold underline" />
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 font-bold ${insuranceDone ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
                Insurance: {insuranceDone ? 'On file' : 'Missing'}
              </span>
              {hasInsuranceDoc ? (
                <AdminDocumentViewer context="booking" recordId={bookingId} document="insurance" label="View" linkClassName="text-sm font-bold underline" />
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 font-bold ${hasBuoyDoc ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                Buoy proof: {hasBuoyDoc ? 'On file' : 'Not uploaded'}
              </span>
              {hasBuoyDoc ? (
                <AdminDocumentViewer context="booking" recordId={bookingId} document="buoy_proof" label="View" linkClassName="text-sm font-bold underline" />
              ) : null}
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 font-bold ${checklistDone ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>
                Trip checklist: {checklistDone ? 'Complete' : 'Pending'}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
