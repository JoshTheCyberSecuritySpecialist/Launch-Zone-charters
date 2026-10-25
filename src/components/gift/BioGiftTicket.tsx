import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import QRCode from 'qrcode';
import { SITE_LOGO_PATH } from '../../constants/branding';
import {
  BIO_GIFT_TICKET_COORDINATES,
  BIO_GIFT_TICKET_QR_HINT,
  BIO_GIFT_TICKET_TAGLINE,
  type BioGiftTicketViewModel,
} from '../../lib/bioGiftTicket';
import {
  normalizeBioGiftTicketTheme,
  type BioGiftTicketThemeId,
} from '../../lib/bioGiftTicketThemes';

type BioGiftTicketProps = {
  ticket: BioGiftTicketViewModel;
  theme?: BioGiftTicketThemeId | string;
  className?: string;
};

type ThemeVisual = {
  cardClass: string;
  atmosphereStyle: CSSProperties;
  starsOpacity: string;
  wakeStyle: CSSProperties;
  labelClass: string;
  accentClass: string;
  stubClass: string;
  borderClass: string;
  qrDark: string;
  qrLight: string;
  quoteBorderClass: string;
};

const THEME_VISUALS: Record<BioGiftTicketThemeId, ThemeVisual> = {
  glow: {
    cardClass: 'bg-[#071018]',
    borderClass: 'border-cyan-300/25',
    labelClass: 'text-cyan-200/70',
    accentClass: 'text-cyan-200/90',
    stubClass: 'border-cyan-200/25 bg-[#050d16]/80',
    quoteBorderClass: 'border-cyan-400/40',
    starsOpacity: 'opacity-[0.55]',
    qrDark: '#0B1220',
    qrLight: '#E8F7FF',
    atmosphereStyle: {
      background:
        'radial-gradient(120% 70% at 50% 115%, rgba(34,211,238,0.18) 0%, transparent 55%), radial-gradient(80% 50% at 80% 0%, rgba(14,116,144,0.16) 0%, transparent 50%), linear-gradient(180deg, #050a12 0%, #071821 48%, #041018 100%)',
    },
    wakeStyle: {
      background:
        'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.15) 20%, rgba(125,211,252,0.55) 50%, rgba(34,211,238,0.15) 80%, transparent 100%)',
      boxShadow: '0 0 18px 2px rgba(34,211,238,0.25)',
    },
  },
  space: {
    cardClass: 'bg-[#09091a]',
    borderClass: 'border-violet-300/30',
    labelClass: 'text-violet-200/70',
    accentClass: 'text-violet-200/90',
    stubClass: 'border-violet-200/25 bg-[#060612]/85',
    quoteBorderClass: 'border-violet-400/40',
    starsOpacity: 'opacity-[0.7]',
    qrDark: '#1e1b4b',
    qrLight: '#F5F3FF',
    atmosphereStyle: {
      background:
        'radial-gradient(90% 55% at 15% 0%, rgba(129,140,248,0.22) 0%, transparent 50%), radial-gradient(100% 60% at 85% 100%, rgba(34,211,238,0.12) 0%, transparent 55%), linear-gradient(180deg, #05050f 0%, #0c0c22 50%, #070714 100%)',
    },
    wakeStyle: {
      background:
        'linear-gradient(90deg, transparent 0%, rgba(167,139,250,0.2) 25%, rgba(196,181,253,0.55) 50%, rgba(129,140,248,0.2) 75%, transparent 100%)',
      boxShadow: '0 0 20px 2px rgba(129,140,248,0.28)',
    },
  },
  golden: {
    cardClass: 'bg-[#120e08]',
    borderClass: 'border-amber-400/35',
    labelClass: 'text-amber-200/70',
    accentClass: 'text-amber-200/90',
    stubClass: 'border-amber-300/25 bg-[#0c0905]/90',
    quoteBorderClass: 'border-amber-400/45',
    starsOpacity: 'opacity-[0.35]',
    qrDark: '#1c1917',
    qrLight: '#FFFBEB',
    atmosphereStyle: {
      background:
        'radial-gradient(100% 60% at 50% 120%, rgba(217,119,6,0.16) 0%, transparent 55%), radial-gradient(70% 40% at 90% 10%, rgba(251,191,36,0.12) 0%, transparent 50%), linear-gradient(180deg, #0a0805 0%, #16100a 50%, #0c0905 100%)',
    },
    wakeStyle: {
      background:
        'linear-gradient(90deg, transparent 0%, rgba(217,119,6,0.2) 20%, rgba(251,191,36,0.55) 50%, rgba(217,119,6,0.2) 80%, transparent 100%)',
      boxShadow: '0 0 16px 2px rgba(251,191,36,0.22)',
    },
  },
};

function TicketField({
  label,
  value,
  labelClass,
}: {
  label: string;
  value: string;
  labelClass: string;
}) {
  return (
    <div>
      <p className={`text-[9px] font-semibold uppercase tracking-[0.22em] ${labelClass}`}>{label}</p>
      <p className="mt-1 text-sm font-semibold leading-snug text-white sm:text-[0.95rem]">{value}</p>
    </div>
  );
}

const BioGiftTicket = forwardRef<HTMLElement, BioGiftTicketProps>(function BioGiftTicket(
  { ticket, theme: themeProp = 'glow', className = '' },
  ref
) {
  const themeId = normalizeBioGiftTicketTheme(themeProp);
  const visual = THEME_VISUALS[themeId];
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(ticket.redeemUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 168,
      color: {
        dark: visual.qrDark,
        light: visual.qrLight,
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.redeemUrl, visual.qrDark, visual.qrLight]);

  const multi =
    ticket.ticketCount != null && ticket.ticketCount > 1 && ticket.ticketIndex != null
      ? `Ticket ${ticket.ticketIndex} of ${ticket.ticketCount}`
      : null;

  return (
    <article
      ref={ref}
      className={`bio-gift-ticket relative overflow-hidden rounded-2xl border ${visual.borderClass} ${visual.cardClass} text-left shadow-[0_18px_50px_rgba(0,0,0,0.55)] print:break-inside-avoid print:shadow-none ${className}`.trim()}
      aria-label={`Gift ticket ${ticket.giftCode}`}
      data-gift-code={ticket.giftCode}
      data-ticket-theme={themeId}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden style={visual.atmosphereStyle} />
      <div
        className={`pointer-events-none absolute inset-0 ${visual.starsOpacity}`}
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,0.55) 0, transparent 100%), radial-gradient(1px 1px at 28% 42%, rgba(255,255,255,0.35) 0, transparent 100%), radial-gradient(1px 1px at 47% 14%, rgba(255,255,255,0.45) 0, transparent 100%), radial-gradient(1px 1px at 63% 36%, rgba(255,255,255,0.3) 0, transparent 100%), radial-gradient(1px 1px at 78% 22%, rgba(255,255,255,0.5) 0, transparent 100%), radial-gradient(1px 1px at 88% 48%, rgba(255,255,255,0.28) 0, transparent 100%), radial-gradient(1px 1px at 18% 68%, rgba(255,255,255,0.25) 0, transparent 100%), radial-gradient(1px 1px at 55% 72%, rgba(255,255,255,0.2) 0, transparent 100%)',
        }}
      />
      {themeId === 'space' ? (
        <div
          className="pointer-events-none absolute right-[8%] top-[10%] h-16 w-16 rounded-full opacity-40"
          aria-hidden
          style={{
            background:
              'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.55) 0%, rgba(196,181,253,0.25) 35%, transparent 70%)',
          }}
        />
      ) : null}
      <div
        className="pointer-events-none absolute bottom-[18%] left-[-5%] right-[-5%] h-px opacity-70"
        aria-hidden
        style={visual.wakeStyle}
      />

      <div className="relative grid md:grid-cols-[1fr_168px]">
        <div className="p-5 sm:p-6 md:pr-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <img
                src={SITE_LOGO_PATH}
                alt="Launch Zone Charters"
                className="h-auto w-[132px] object-contain sm:w-[148px]"
                loading="lazy"
                decoding="async"
              />
              <p className={`mt-3 text-[10px] font-semibold uppercase tracking-[0.28em] ${visual.accentClass}`}>
                Launch Zone Charters
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                {BIO_GIFT_TICKET_COORDINATES}
              </p>
              {multi ? (
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--lz-cta)]">
                  {multi}
                </p>
              ) : null}
            </div>
          </div>

          <p className={`mt-5 text-[11px] font-semibold uppercase tracking-[0.28em] ${visual.accentClass}`}>
            {ticket.seasonYear} Bioluminescence Adventure
          </p>
          <h2 className="mt-2 font-display text-xl font-bold leading-tight tracking-wide text-white sm:text-2xl">
            {BIO_GIFT_TICKET_TAGLINE}
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <TicketField label="Gifted to" value={ticket.recipientName} labelClass={visual.labelClass} />
            <TicketField label="From" value={ticket.fromName} labelClass={visual.labelClass} />
            <TicketField label="Experience" value={ticket.packageName} labelClass={visual.labelClass} />
            <TicketField label="Guests" value={ticket.guestLabel} labelClass={visual.labelClass} />
            <TicketField label="Valid season" value={ticket.validSeasonLabel} labelClass={visual.labelClass} />
            <TicketField label="Gift ticket" value={ticket.giftCode} labelClass={visual.labelClass} />
          </div>

          {ticket.giftMessage ? (
            <blockquote
              className={`mt-5 border-l-2 ${visual.quoteBorderClass} pl-3 text-sm italic leading-relaxed text-slate-200`}
            >
              “{ticket.giftMessage}”
            </blockquote>
          ) : null}

          <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
            Titusville · Florida Space Coast
            <br />
            Dates subject to availability and weather conditions.
            <br />
            <span className={visual.accentClass}>launchzonecharters.com</span>
          </p>
        </div>

        <div className={`relative border-t border-dashed p-5 md:border-l md:border-t-0 md:px-4 md:py-6 ${visual.stubClass}`}>
          <div
            className="pointer-events-none absolute left-0 top-0 hidden h-full w-px md:block"
            aria-hidden
            style={{
              backgroundImage:
                themeId === 'golden'
                  ? 'repeating-linear-gradient(180deg, transparent 0 7px, rgba(251,191,36,0.4) 7px 10px)'
                  : themeId === 'space'
                    ? 'repeating-linear-gradient(180deg, transparent 0 7px, rgba(196,181,253,0.4) 7px 10px)'
                    : 'repeating-linear-gradient(180deg, transparent 0 7px, rgba(125,211,252,0.35) 7px 10px)',
            }}
          />
          <div className="flex h-full flex-col items-center justify-between gap-4 text-center">
            <p className={`text-[9px] font-semibold uppercase tracking-[0.22em] ${visual.accentClass}`}>
              Boarding stub
            </p>
            <div
              className="rounded-lg border border-white/15 p-2"
              style={{ backgroundColor: visual.qrLight }}
            >
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code for gift ticket ${ticket.giftCode}`}
                  className="h-[132px] w-[132px]"
                  width={132}
                  height={132}
                />
              ) : (
                <div
                  className="flex h-[132px] w-[132px] items-center justify-center bg-slate-200 text-[10px] text-slate-600"
                  role="status"
                >
                  Preparing QR…
                </div>
              )}
            </div>
            <div>
              <p className="font-mono text-[11px] font-semibold tracking-wide text-white">{ticket.giftCode}</p>
              <p className="mt-2 max-w-[9.5rem] text-[10px] leading-snug text-slate-400">
                {BIO_GIFT_TICKET_QR_HINT}
              </p>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
});

export default BioGiftTicket;
