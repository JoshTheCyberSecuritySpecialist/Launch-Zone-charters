import { MapPin } from 'lucide-react';
import {
  BIO_DEPARTURE_AREA_LABEL,
  TITUSVILLE_MEETING_LOCATION,
} from '../../lib/meetingLocations';
import { formatCharterDurationLabel } from '../../lib/charterDuration';

const FAQ_ITEMS = [
  {
    q: 'How long is the tour?',
    a: `${formatCharterDurationLabel()}.`,
  },
  {
    q: 'Where do we meet?',
    a: `${BIO_DEPARTURE_AREA_LABEL}. Your booking confirmation contains your exact meeting location and Get Directions button.`,
  },
  {
    q: 'Is a captain included?',
    a: 'Yes. Your licensed captain and fuel are included.',
  },
  {
    q: 'Do I need boat insurance?',
    a: 'No. Insurance verification is for self-drive rentals, not captain-led charters.',
  },
  {
    q: 'When should I arrive?',
    a: 'Please arrive about 15 minutes before your scheduled departure.',
  },
  {
    q: 'What should I bring?',
    a: 'Sunscreen, sunglasses, a hat, towels, food and drinks in non-glass containers, a camera, and a government-issued ID for check-in. For night tours, dim red lighting helps your eyes adjust.',
  },
] as const;

export default function BioBookingHelp() {
  const location = TITUSVILLE_MEETING_LOCATION;

  return (
    <div className="mt-8 space-y-4">
      <div className="rounded-2xl border border-cyan-400/30 bg-cyan-950/20 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cyan-200">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden />
          {BIO_DEPARTURE_AREA_LABEL}
        </p>
        <p className="mt-2 text-base font-bold text-white">{location.name}</p>
        <p className="mt-1 text-sm text-slate-200">
          {location.city}, {location.state}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Your confirmation will include the exact ramp address and a Get Directions button.
        </p>
      </div>

      <details className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-white">
          Common questions
        </summary>
        <dl className="mt-4 space-y-4">
          {FAQ_ITEMS.map((item) => (
            <div key={item.q}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-cyan-200/90">{item.q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-300">{item.a}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
