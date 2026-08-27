import {
  CANCELLATION_REFUND_POLICY_SUBSECTIONS,
  CANCELLATION_REFUND_POLICY_TITLE,
  CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT,
} from '../../content/cancellationRefundPolicy';
import {
  SECURITY_DEPOSIT_AUTHORIZATION_CLAUSE,
  SECURITY_DEPOSIT_TERMS_PARAGRAPH,
} from '../../content/securityDeposit';
import { requiresDamageFeeAcknowledgment } from '../../lib/damageFeeAcknowledgment';

export type WaiverFormData = {
  agreed: boolean;
  signature: string;
};

export type WaiverBlockProps = {
  bookingMode: 'rental' | 'charter';
  waiverData: WaiverFormData;
  onWaiverDataChange: (data: WaiverFormData) => void;
  termsAccepted: boolean;
  onTermsAcceptedChange: (value: boolean) => void;
  damageFeeAcknowledged: boolean;
  onDamageFeeAcknowledgedChange: (value: boolean) => void;
  onNavigateTerms: () => void;
  fieldClass?: string;
  /** Prefix for input ids when multiple blocks could exist on one page */
  idPrefix?: string;
  signatureHelperText?: string;
};

const DEFAULT_FIELD_CLASS =
  'lz-input-on-dark w-full rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/20';

export function waiverFormComplete(
  waiverData: WaiverFormData,
  termsAccepted: boolean,
  damageFeeAcknowledged: boolean,
  bookingMode: 'rental' | 'charter'
): boolean {
  if (!termsAccepted || !waiverData.agreed || waiverData.signature.trim().length === 0) {
    return false;
  }
  if (requiresDamageFeeAcknowledgment(bookingMode) && !damageFeeAcknowledged) {
    return false;
  }
  return true;
}

export default function WaiverBlock({
  bookingMode,
  waiverData,
  onWaiverDataChange,
  termsAccepted,
  onTermsAcceptedChange,
  damageFeeAcknowledged,
  onDamageFeeAcknowledgedChange,
  onNavigateTerms,
  fieldClass = DEFAULT_FIELD_CLASS,
  idPrefix = '',
  signatureHelperText = 'Electronic signature is required. By typing your name, you agree this constitutes a legal electronic signature when the waiver checkbox is checked.',
}: WaiverBlockProps) {
  const termsId = `${idPrefix}agreeTerms`;
  const waiverId = `${idPrefix}agreeWaiver`;
  const damageId = `${idPrefix}damageAck`;
  const signatureId = `${idPrefix}waiverSignature`;

  return (
    <>
      <h3 className="mt-10 text-sm font-bold uppercase tracking-widest text-cyan-200/90">Waiver</h3>
      <div className="mt-4 max-h-80 overflow-y-auto rounded-[var(--lz-radius)] border border-white/10 bg-slate-950/60 p-5">
        <h4 className="text-base font-bold text-white">Florida Boating Liability Waiver</h4>
        <div className="prose prose-sm prose-invert mt-4 max-w-none space-y-4 text-slate-300">
          <p>By signing this waiver, I acknowledge and agree to the following terms and conditions:</p>
          <h4 className="!mt-0 font-semibold text-slate-100">Assumption of Risk</h4>
          <p>
            I understand that boating activities involve inherent risks including but not limited to: injury,
            death, property damage, weather hazards, marine hazards, and equipment failure. I voluntarily
            assume all such risks.
          </p>
          <h4 className="font-semibold text-slate-100">Release of Liability</h4>
          <p>
            I hereby release, waive, discharge, and covenant not to sue Launch Zone Charters, its owners,
            employees, and agents from any and all liability for injury, death, or property damage arising
            from my participation in boating activities.
          </p>
          <h4 className="font-semibold text-slate-100">Indemnification</h4>
          <p>
            I agree to indemnify and hold harmless Launch Zone Charters from any claims, damages, or expenses
            arising from my use of the rental vessel.
          </p>
          <h4 className="font-semibold text-slate-100">Acknowledgments</h4>
          <ul className="list-inside list-disc space-y-1">
            {bookingMode === 'rental' ? (
              <>
                <li>I am at least 25 years of age</li>
                <li>I possess a valid boating license (if operating the vessel)</li>
                <li>I am physically capable of operating the vessel safely</li>
                <li>I will follow all maritime laws and regulations</li>
                <li>I am responsible for all passengers and their safety</li>
                <li>I am responsible for any damage to the vessel beyond normal wear and tear</li>
                <li>I understand late return fees apply</li>
              </>
            ) : (
              <>
                <li>I will follow captain safety instructions at all times.</li>
                <li>I understand charter timing can shift for weather and launch delays.</li>
                <li>I acknowledge reschedule rules for launch and marine conditions.</li>
              </>
            )}
          </ul>
          <h4 className="!mt-6 font-semibold text-slate-100">{CANCELLATION_REFUND_POLICY_TITLE}</h4>
          <div className="space-y-3">
            {CANCELLATION_REFUND_POLICY_SUBSECTIONS.map(({ heading, body }) => (
              <p key={heading} className="text-sm leading-relaxed">
                <strong className="text-slate-200">{heading}:</strong> {body}
              </p>
            ))}
            <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-relaxed text-slate-300">
              {CANCELLATION_REFUND_POLICY_WAIVER_ACKNOWLEDGMENT}
            </p>
          </div>
          {bookingMode === 'rental' && (
            <>
              <h4 className="!mt-6 font-semibold text-slate-100">Security deposit</h4>
              <p>{SECURITY_DEPOSIT_TERMS_PARAGRAPH}</p>
              <p className="text-sm">
                <strong className="text-slate-200">Authorization.</strong> {SECURITY_DEPOSIT_AUTHORIZATION_CLAUSE}
              </p>
            </>
          )}
          <p className="text-sm italic">
            For full terms and conditions, see our{' '}
            <button
              type="button"
              onClick={onNavigateTerms}
              className="font-semibold text-cyan-400 underline decoration-cyan-500/50 hover:text-cyan-300"
            >
              Terms &amp; Conditions page
            </button>
            .
          </p>
        </div>
      </div>

      <h3 className="mt-10 text-sm font-bold uppercase tracking-widest text-cyan-200/90">
        {bookingMode === 'rental' ? 'Agreement & documents' : 'Agreement'}
      </h3>
      <div className="mt-4 space-y-6">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id={termsId}
            checked={termsAccepted}
            onChange={(e) => onTermsAcceptedChange(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-[var(--lz-cta)] focus:ring-cyan-500/40"
          />
          <label htmlFor={termsId} className="text-sm font-semibold text-slate-100">
            I have read and agree to the Terms &amp; Conditions.
          </label>
        </div>
        <p className="-mt-3 pl-8 text-xs text-slate-400">
          Review full terms here:{' '}
          <button
            type="button"
            onClick={onNavigateTerms}
            className="font-semibold text-cyan-400 underline decoration-cyan-500/50 hover:text-cyan-300"
          >
            Terms &amp; Conditions
          </button>
          .
        </p>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id={waiverId}
            checked={waiverData.agreed}
            onChange={(e) => onWaiverDataChange({ ...waiverData, agreed: e.target.checked })}
            className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-[var(--lz-cta)] focus:ring-cyan-500/40"
          />
          <label htmlFor={waiverId} className="text-sm font-semibold text-slate-100">
            I have read and agree to the waiver terms above.
          </label>
        </div>

        <div>
          <label htmlFor={signatureId} className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Electronic signature
          </label>
          <input
            id={signatureId}
            type="text"
            value={waiverData.signature}
            onChange={(e) => onWaiverDataChange({ ...waiverData, signature: e.target.value })}
            className={fieldClass}
            placeholder="Type your full legal name"
          />
          <p className="mt-1 text-xs text-slate-500">{signatureHelperText}</p>
        </div>

        {bookingMode === 'rental' ? (
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id={damageId}
              checked={damageFeeAcknowledged}
              onChange={(e) => onDamageFeeAcknowledgedChange(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 rounded border-white/20 text-[var(--lz-cta)] focus:ring-cyan-500/40"
            />
            <label htmlFor={damageId} className="text-sm font-semibold text-slate-100">
              I understand I am financially responsible for damage, prop strikes, grounding, towing, excessive
              cleaning, and missing equipment.
            </label>
          </div>
        ) : null}
      </div>
    </>
  );
}
