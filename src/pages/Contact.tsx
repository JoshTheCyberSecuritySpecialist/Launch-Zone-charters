import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Phone, MapPin, Clock, Send, Loader2 } from 'lucide-react';
import { env } from '../config/env';
import { supabase } from '../lib/supabase';
import { logSupabaseError, userFacingSupabaseMessage } from '../lib/supabaseErrors';
import { beginAsyncInteraction } from '../lib/clickPerf';
import {
  CANCELLATION_REFUND_POLICY_FAQ_SUMMARY,
  getCancellationRefundWeatherBody,
} from '../content/cancellationRefundPolicy';

interface ContactProps {
  onNavigate: (page: string) => void;
}

const DEFAULT_SITE_ORIGIN = 'https://launchzonecharters.com';
const CONTACT_HERO_IMAGE =
  '/images/contact-us-space-coast-rocket-launch-boat-tour-titusville-florida-pontoon-and-center-console-charter-launch-zone-charters.jpg';
const CONTACT_HERO_ALT =
  'contact Launch Zone Charters rocket launch boat tours Titusville Florida Space Coast pontoon and center console boats';

/** Format stored digits (e.g. 8035421761) for display; pass through unknown strings. */
function formatUsPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw.trim() || raw;
}

function telHref(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d ? `tel:${d}` : '#';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateContactFields(fullName: string, email: string, message: string): string | null {
  if (!fullName || fullName.length > 200) return 'Please enter your full name (max 200 characters).';
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) return 'Please enter a valid email address.';
  if (!message || message.length > 10000) return 'Please enter a message (max 10,000 characters).';
  return null;
}

function siteOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  const envUrl = import.meta.env.VITE_SITE_URL as string | undefined;
  if (envUrl && typeof envUrl === 'string') {
    return envUrl.replace(/\/$/, '');
  }
  return DEFAULT_SITE_ORIGIN;
}

export default function Contact({ onNavigate }: ContactProps) {
  const contactDigits = env.contactPhone;
  const contactMail = env.contactEmail;
  const canonicalUrl = useMemo(() => `${siteOrigin()}/contact`, []);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const perf = beginAsyncInteraction('contact_form_submit');
    let outcome = 'completed';

    const full_name = formData.name.trim();
    const email = formData.email.trim().toLowerCase();
    const message = formData.message.trim();

    const invalid = validateContactFields(full_name, email, message);
    if (invalid) {
      setSubmitError(invalid);
      outcome = 'validation_failed';
      perf.end(outcome);
      return;
    }

    setSubmitting(true);
    try {
      perf.markNetworkStart();
      const { error } = await supabase.from('contact_messages').insert([
        {
          full_name,
          email,
          message,
        },
      ]);

      if (error) {
        logSupabaseError('Contact.submit', error);
        setSubmitError(userFacingSupabaseMessage(error));
        outcome = 'supabase_error';
        return;
      }

      setSubmitted(true);
      setFormData({ name: '', email: '', message: '' });
      outcome = 'success';
    } catch (err) {
      logSupabaseError('Contact.submit', {
        message: err instanceof Error ? err.message : String(err),
      });
      setSubmitError('Something went wrong. Please try again or call us.');
      outcome = 'error';
    } finally {
      setSubmitting(false);
      perf.end(outcome);
    }
  };

  return (
    <div className="contact-page min-h-screen bg-[#020617] text-slate-200">
      <Helmet prioritizeSeoTags>
        <title>Contact Launch Zone Charters | Titusville Boat Rentals & Rocket Launch Tours</title>
        <meta
          name="description"
          content="Contact Launch Zone Charters for Space Coast rocket launch boat tours, Titusville pontoon rentals, center console charters, and booking support."
        />
        <meta
          name="keywords"
          content="contact Launch Zone Charters, Titusville boat tour contact, Space Coast rocket launch charter, pontoon rental Titusville Florida, center console charter"
        />
        <link rel="canonical" href={canonicalUrl} />
        <link rel="preload" as="image" href={CONTACT_HERO_IMAGE} />
        <meta property="og:title" content="Contact Launch Zone Charters | Space Coast Booking Support" />
        <meta
          property="og:description"
          content="Have questions before booking? Reach Launch Zone Charters for Titusville and Space Coast trips."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={`${siteOrigin()}${CONTACT_HERO_IMAGE}`} />
        <meta property="og:image:alt" content={CONTACT_HERO_ALT} />
      </Helmet>

      <section
        className="contact-page-hero"
        aria-labelledby="contact-hero-heading"
        aria-describedby="contact-hero-subtitle"
      >
        <h1 id="contact-hero-heading" className="sr-only">
          Contact Launch Zone Charters
        </h1>
        <img src={CONTACT_HERO_IMAGE} alt={CONTACT_HERO_ALT} className="sr-only" loading="eager" />
        <div className="relative z-[3] mx-auto flex min-h-[inherit] w-full max-w-7xl items-start px-4 pb-14 pt-24 sm:px-6 sm:pb-16 sm:pt-28 lg:px-8 lg:pt-32">
          <p
            id="contact-hero-subtitle"
            className="contact-page-hero__subtitle max-w-xl text-base leading-relaxed text-slate-50 sm:text-xl"
          >
            Have Questions? We&apos;re here to help. Reach out and lets plan your perfect day on the water.
          </p>
        </div>
        <div className="contact-page-hero__fade" aria-hidden />
      </section>

      <section className="bg-gradient-to-b from-[#040b16] via-[#020617] to-[#020617] py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <h2 className="text-3xl font-bold text-white mb-8">Get In Touch</h2>

              <div className="space-y-6 mb-12">
                <div className="flex items-start space-x-4 rounded-2xl border border-cyan-400/15 bg-slate-950/45 p-5 backdrop-blur-sm">
                  <div className="w-12 h-12 bg-amber-500/15 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Phone className="h-6 w-6 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Phone</h3>
                    {contactDigits ? (
                      <a
                        href={telHref(contactDigits)}
                        className="text-lg text-amber-600 hover:text-amber-700 font-semibold"
                      >
                        {formatUsPhone(contactDigits)}
                      </a>
                    ) : (
                      <p className="text-sm text-slate-400">Use the message form; phone is set via site config.</p>
                    )}
                    {contactMail ? (
                      <p className="text-sm mt-2">
                        <a
                          href={`mailto:${contactMail}`}
                          className="text-amber-600 hover:text-amber-700 font-semibold break-all"
                        >
                          {contactMail}
                        </a>
                      </p>
                    ) : null}
                    <p className="text-sm text-slate-400 mt-1">
                      Available 7 days a week, 8 AM - 8 PM
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-4 rounded-2xl border border-cyan-400/15 bg-slate-950/45 p-5 backdrop-blur-sm">
                  <div className="w-12 h-12 bg-amber-500/15 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MapPin className="h-6 w-6 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Service Areas</h3>
                    <div className="text-slate-300 space-y-1">
                      <p>Port Orange, FL</p>
                      <p>Daytona Beach, FL</p>
                      <p>Titusville, FL</p>
                      <p>Orlando, FL</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-start space-x-4 rounded-2xl border border-cyan-400/15 bg-slate-950/45 p-5 backdrop-blur-sm">
                  <div className="w-12 h-12 bg-amber-500/15 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Clock className="h-6 w-6 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Operating Hours</h3>
                    <div className="text-slate-300">
                      <p>7 Days a Week</p>
                      <p className="text-sm mt-1">Sunrise to Sunset</p>
                      <p className="text-sm text-amber-600 mt-2">
                        Night tours available with advance reservation
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lz-card-glass p-8">
                <h3 className="text-xl font-bold mb-4">Quick Booking</h3>
                <p className="text-slate-300 mb-6">
                  Ready to book? Skip the contact form and reserve your boat now.
                </p>
                <button
                  onClick={() => onNavigate('book')}
                  className="lz-btn-primary w-full px-6 py-3"
                >
                  Book Now
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/55 p-8 shadow-[0_0_36px_rgba(0,207,255,0.08)] backdrop-blur-sm">
              <h2 className="text-2xl font-bold text-white mb-6">Send Us a Message</h2>

              {submitted ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Send className="h-8 w-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold text-green-900 mb-2">Message Sent!</h3>
                  <p className="text-green-700">
                    Message sent successfully. We&apos;ll get back to you soon.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSubmitted(false)}
                    className="mt-6 text-amber-700 hover:text-amber-800 font-semibold underline-offset-2 hover:underline"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  {submitError && (
                    <div
                      className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3"
                      role="alert"
                    >
                      {submitError}
                    </div>
                  )}
                  <div>
                    <label htmlFor="name" className="block text-sm font-semibold text-slate-100 mb-2">
                      Full Name
                    </label>
                    <input
                      type="text"
                      id="name"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-transparent focus:ring-2 focus:ring-amber-600"
                      placeholder="John Doe"
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-semibold text-slate-100 mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      id="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-transparent focus:ring-2 focus:ring-amber-600"
                      placeholder="john@example.com"
                    />
                  </div>

                  <div>
                    <label htmlFor="message" className="block text-sm font-semibold text-slate-100 mb-2">
                      Message
                    </label>
                    <textarea
                      id="message"
                      required
                      rows={6}
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-transparent focus:ring-2 focus:ring-amber-600"
                      placeholder="Tell us about your trip plans..."
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="lz-btn-primary w-full py-3 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center space-x-2"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Sending…</span>
                      </>
                    ) : (
                      <>
                        <Send className="h-5 w-5" />
                        <span>Send Message</span>
                      </>
                    )}
                  </button>

                  {contactDigits ? (
                    <p className="text-center text-slate-400 text-sm pt-2">
                      Call or Text:{' '}
                      <a
                        href={telHref(contactDigits)}
                        className="font-semibold text-amber-600 hover:text-amber-700"
                      >
                        {formatUsPhone(contactDigits)}
                      </a>
                    </p>
                  ) : null}
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-cyan-500/15 bg-[#050a14] py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white text-center mb-12">Frequently Asked Questions</h2>
          <div className="grid md:grid-cols-2 gap-8 mb-8">
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/50 p-6 backdrop-blur-sm">
              <h3 className="font-semibold text-white mb-2">How far in advance should I book?</h3>
              <p className="text-slate-300">
                We recommend booking at least 24 hours in advance. Same-day bookings are accepted based on availability.
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/50 p-6 backdrop-blur-sm">
              <h3 className="font-semibold text-white mb-2">What if the weather is bad?</h3>
              <p className="text-slate-300">{getCancellationRefundWeatherBody()}</p>
            </div>
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/50 p-6 backdrop-blur-sm">
              <h3 className="font-semibold text-white mb-2">Do I need a boating license?</h3>
              <p className="text-slate-300">
                Yes, if you plan to self-drive. Alternatively, you can add a professional captain to your booking.
              </p>
            </div>
            <div className="rounded-2xl border border-cyan-400/15 bg-slate-950/50 p-6 backdrop-blur-sm">
              <h3 className="font-semibold text-white mb-2">What&apos;s your cancellation policy?</h3>
              <p className="text-slate-300">
                {CANCELLATION_REFUND_POLICY_FAQ_SUMMARY} See our{' '}
                <button
                  onClick={() => onNavigate('refund-policy')}
                  className="text-amber-600 hover:text-amber-700 font-semibold"
                >
                  refund policy
                </button>{' '}
                for details.
              </p>
            </div>
          </div>
          <div className="text-center">
            <button
              onClick={() => onNavigate('faqs')}
              className="lz-btn-secondary px-8 py-3"
            >
              View All FAQs
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
