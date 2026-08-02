import { useCallback, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Plus } from 'lucide-react';
import SmartImage from '../components/ui/SmartImage';
import {
  CANCELLATION_REFUND_POLICY_FAQ_SUMMARY,
  CANCELLATION_REFUND_POLICY_WEATHER_MONITORING_SENTENCE,
  getCancellationRefundWeatherBody,
} from '../content/cancellationRefundPolicy';

const WEATHER_FAQ_ANSWER = `${getCancellationRefundWeatherBody()} ${CANCELLATION_REFUND_POLICY_WEATHER_MONITORING_SENTENCE}`;

const FAQ_HERO_IMAGE = '/images/space-coast-rocket-launch-viewing-boat-charter-faq-launchzone.png';
const FAQ_HERO_ALT =
  'Space Coast rocket launch viewing from a charter boat, Launch Zone Charters FAQ';

interface FAQsProps {
  onNavigate: (page: string) => void;
}

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQGroup {
  id: string;
  title: string;
  items: FAQItem[];
}

/** Same copy as before, grouped for category UX */
const FAQ_GROUPS: FAQGroup[] = [
  {
    id: 'booking',
    title: 'Booking & Availability',
    items: [
    {
      question: 'How far in advance do I need to book?',
        answer:
          'We recommend booking at least 24 hours in advance to ensure availability. However, same-day bookings are accepted when boats are available. For rocket launch tours and peak season dates, we strongly recommend booking several days to weeks in advance.',
      },
      {
        question: 'Where do we pick up and return the boat?',
        answer:
          'Pick-up and drop-off locations are confirmed when you complete your booking. We operate from multiple convenient locations in Port Orange, Daytona Beach, Titusville, and the Orlando area. Specific addresses and directions will be provided in your booking confirmation.',
      },
      {
        question: 'Can I book for a special event or party?',
        answer:
          'Absolutely! Our boats are perfect for birthdays, anniversaries, corporate events, bachelor/bachelorette parties, and other celebrations. Contact us to discuss your event, and we can help customize the perfect experience.',
      },
      {
        question: 'How do I receive updates about my booking?',
        answer:
          'We send email and SMS confirmations upon booking. You can also opt in to receive SMS alerts about rocket launches, weather updates, and other important notifications. All communication includes relevant details and contact information.',
      },
      {
        question: 'How do I redeem my Groupon voucher?',
        answer:
          'Book online at launchzonecharters.com/booking/groupon. Enter your Groupon voucher number and the last name on the voucher, then choose your date and time. Your request is submitted with $0 due today, but your trip is not confirmed until Launch Zone Charters reviews availability and sends confirmation. Do not use a promo code on the regular Book Now checkout; Groupon vouchers must be redeemed on the Groupon booking page.',
      },
    ],
  },
  {
    id: 'pricing',
    title: 'Pricing & Policies',
    items: [
      {
        question: 'What is your cancellation and refund policy?',
        answer: CANCELLATION_REFUND_POLICY_FAQ_SUMMARY,
      },
      {
        question: 'What is peak pricing?',
        answer:
          'Peak pricing applies during holidays, special events, and major rocket launches. Surcharges typically range from 10-20% above standard rates. Peak dates include Memorial Day weekend, 4th of July weekend, Labor Day weekend, and major SpaceX/NASA launches. You will see the total price including any surcharges before completing your booking.',
    },
    {
      question: 'What is included in the rental price?',
        answer:
          'Your rental includes the boat, fuel for standard cruising, all required safety equipment, life jackets for all passengers, basic orientation and instruction, and access to our on-water support team. A refundable $300 security deposit is charged at booking (via Stripe) and refunded after the vessel is returned and inspected.',
    },
    {
      question: 'What is the security deposit for?',
        answer:
          'A refundable $300 security deposit is charged at booking and held by our payment processor (Stripe). It is refunded after the vessel is returned and inspected. It may be partially or fully retained for damage, excessive cleaning, fuel discrepancies, or late return. Deductions are limited to actual costs. Refunds go to the original payment method; banks typically process in 5–10 business days.',
      },
      {
        question: 'What happens if I return the boat late?',
        answer:
          'Late returns are automatically billed in 15-minute increments at the applicable hourly rate. We understand delays happen, so please contact us if you anticipate being late. Excessive lateness without communication may result in additional fees.',
      },
      {
        question: 'Is your business licensed and insured?',
        answer:
          'Yes, Launch Zone Charters is fully licensed and maintains commercial marine insurance. All our captains are USCG certified. However, renters are still responsible for their actions and passengers. Our insurance does not eliminate renter responsibility, and certain damages or violations may not be covered.',
      },
    ],
  },
  {
    id: 'rocket',
    title: 'Rocket Launch Viewing',
    items: [
    {
      question: 'What are rocket launch tours?',
        answer:
          'Rocket launch charters are captain-led trips scheduled around SpaceX and NASA launches from Cape Canaveral. A licensed captain runs the boat while you view from the water. This is not a self-drive rental. Please note that launch timing is never guaranteed, and launches may be delayed or scrubbed. In such cases, your trip may proceed as a sightseeing cruise, and no refunds are provided for launch delays or cancellations per our policies.',
    },
    {
      question: 'How do you determine the best days for rocket launch viewing?',
        answer:
          'We use AI-powered analysis that evaluates launch schedule confidence, historical scrub patterns, weather conditions, wind and wave forecasts, tide timing, and visibility factors. Each launch receives a quality score and rating to help you choose the best viewing day.',
      },
      {
        question: 'Can we rent a boat at night?',
        answer:
          'Yes, night tours are available with advance reservation. Night tours require approval and may have different pricing. All boats are equipped with proper navigation lights and safety equipment for nighttime operation.',
      },
    ],
  },
  {
    id: 'safety',
    title: 'Safety & Requirements',
    items: [
      {
        question: 'Do I need a boating license?',
        answer:
          'If you plan to operate the boat yourself, you must have a valid boating license and be at least 25 years old. If you prefer not to drive, you can add a professional USCG-certified captain to your rental for an additional fee. Our captains are experienced, knowledgeable about local waters, and handle all navigation.',
      },
      {
        question: 'What happens if there is bad weather?',
        answer: WEATHER_FAQ_ANSWER,
      },
      {
        question: 'Can I bring food and drinks on board?',
        answer:
          'Yes! You are welcome to bring food, snacks, and beverages. All boats have cooler space for your convenience. Please note that glass containers are not permitted for safety reasons. We recommend bringing plenty of water and sun protection.',
      },
      {
        question: 'How many people can fit on a boat?',
        answer:
          'Our standard pontoons accommodate up to 10 passengers, while our premium pontoons can hold up to 12 passengers. All capacity limits are strictly enforced for safety and comply with USCG regulations.',
      },
      {
        question: 'Are life jackets provided?',
        answer:
          'Yes, USCG-approved life jackets are provided for all passengers at no additional charge. We have sizes for adults and children. Wearing a life jacket is required for children under 6 years old at all times while on the boat.',
      },
      {
        question: 'What should I bring?',
        answer:
          "We recommend bringing sunscreen, sunglasses, hats, towels, food and drinks in non-glass containers, and any personal items you may need. Don't forget your camera for photos and your government-issued ID, which is required for check-in.",
      },
      {
        question: 'Are pets allowed on the boats?',
        answer:
          'Pets are allowed on select boats with advance notice. Please inform us during booking if you plan to bring a pet. Owners are responsible for their pets and any cleaning required. Service animals are always welcome.',
      },
    ],
  },
];

function FAQCard({
  cardId,
  question,
  answer,
  isOpen,
  onToggle,
}: {
  cardId: string;
  question: string;
  answer: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const headingId = `${cardId}-heading`;
  const panelId = `${cardId}-panel`;

  return (
    <div className="faqs-page-card group">
      <button
        type="button"
        id={headingId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        className="faqs-page-card__trigger flex w-full items-start justify-between gap-4 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1a2a]"
      >
        <span className="faqs-page-card__question pt-0.5 font-semibold leading-snug text-slate-100">
          {question}
        </span>
        <span className="faqs-page-card__icon-wrap mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-500/5 text-cyan-300 transition-transform duration-300 ease-out group-hover:border-cyan-300/40 group-hover:bg-cyan-500/10">
          <Plus
            className={`h-5 w-5 transition-transform duration-300 ease-out ${isOpen ? 'rotate-45' : ''}`}
            aria-hidden
          />
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headingId}
        className="faqs-page-card__panel"
        data-open={isOpen ? 'true' : 'false'}
      >
        <div className="faqs-page-card__panel-inner min-h-0">
          <p className="faqs-page-card__answer border-t border-cyan-400/10 pt-4 text-sm leading-relaxed text-slate-300">
            {answer}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function FAQs({ onNavigate }: FAQsProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const toggle = useCallback((key: string) => {
    setOpenKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <div className="faqs-page min-h-screen bg-[#020617] text-slate-200">
      <Helmet prioritizeSeoTags>
        <title>FAQs | Launch Zone Charters, Space Coast Boat Charters</title>
        <meta
          name="description"
          content="Answers about booking, pricing, rocket launch viewing, safety, and policies for Launch Zone Charters on the Space Coast."
        />
        <link rel="preload" as="image" href={FAQ_HERO_IMAGE} />
      </Helmet>

      {/* Hero: headline lives in artwork */}
      <section className="faqs-page-hero" aria-label="Frequently asked questions">
        <div className="faqs-page-hero__visual lz-hero-container lz-hero-viewport">
          <div className="absolute inset-0 z-0 overflow-visible" aria-hidden>
            <SmartImage
              src={FAQ_HERO_IMAGE}
              alt={FAQ_HERO_ALT}
              priority
              sizes="100vw"
              className="lz-hero-bg hero-img-faqs absolute inset-0 h-full w-full"
            />
          </div>
          <div className="lz-hero-overlay" aria-hidden />
        </div>

        <div className="faqs-page-hero__cta-band">
          <div className="lz-hero-cta faqs-page-hero__cta-shell">
            <p className="faqs-page-hero__tagline lz-hero-fade lz-hero-fade--delay-1 text-center text-sm leading-relaxed text-white/95 sm:text-base">
              Everything you need to know before your launch experience
            </p>
            <button
              type="button"
              onClick={() => onNavigate('book')}
              className="lz-btn-accent faqs-page-hero__cta lz-hero-fade lz-hero-fade--delay-2 mt-5 w-full justify-center sm:mt-6"
            >
              Book Your Launch Experience
            </button>
          </div>
        </div>
      </section>

      {/* FAQ body */}
      <section className="faqs-page-qa px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="sr-only">FAQ topics and answers</h2>
          {FAQ_GROUPS.map((group) => (
            <div key={group.id} className="mb-14 last:mb-0 sm:mb-16">
              <div className="faqs-page-section-head">
                <h3 className="faqs-page-section-title">{group.title}</h3>
                <div className="faqs-page-section-rule" aria-hidden />
                  </div>
              <div className="mt-6 space-y-4 sm:mt-8">
                {group.items.map((faq, index) => {
                  const key = `${group.id}-${index}`;
                  return (
                    <FAQCard
                      key={key}
                      cardId={key}
                      question={faq.question}
                      answer={faq.answer}
                      isOpen={openKey === key}
                      onToggle={() => toggle(key)}
                    />
                  );
                })}
              </div>
              </div>
            ))}
        </div>
      </section>

      <section className="faqs-page-footer-cta border-t border-white/[0.06] bg-[#020617] px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Still have questions?</h2>
          <p className="mt-3 text-base text-slate-400 sm:text-lg">
            We&apos;re here to help. Reach out and we&apos;ll get back to you quickly.
          </p>
          <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            <button
              type="button"
              onClick={() => onNavigate('contact')}
              className="lz-btn-accent inline-flex justify-center px-8 py-3"
            >
              Contact us
            </button>
            <a
              href="tel:803-542-1761"
              className="inline-flex justify-center rounded-[var(--lz-radius)] border border-cyan-400/30 bg-cyan-500/5 px-8 py-3 font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-500/10"
            >
              Call 803-542-1761
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
