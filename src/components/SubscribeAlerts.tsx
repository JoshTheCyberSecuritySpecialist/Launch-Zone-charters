import { useState } from 'react';
import { Bell, Loader2 } from 'lucide-react';
import { env } from '../config/env.js';
import { beginAsyncInteraction } from '../lib/clickPerf';
interface SubscribeAlertsProps {
  subscribedTo: 'bio' | 'rocket';
  variant?: 'dark' | 'light';
  /** Override default heading */
  title?: string;
  /** Override default description */
  subtitle?: string;
  /** Submit button label */
  submitLabel?: string;
  /** Extra classes on outer wrapper */
  className?: string;
  /** Large gradient CTA (e.g. bioluminescence command center) */
  primaryCta?: boolean;
}

export default function SubscribeAlerts({
  subscribedTo,
  variant = 'dark',
  title,
  subtitle,
  submitLabel,
  className = '',
  primaryCta = false,
}: SubscribeAlertsProps) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDark = variant === 'dark';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const perf = beginAsyncInteraction(`alerts_subscribe_${subscribedTo}`);
    let outcome = 'completed';
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        setError('This form is unavailable until the site API URL is configured.');
        outcome = 'no_api';
        return;
      }
      perf.markNetworkStart();
      const res = await fetch(`${env.apiUrl}/api/alerts/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          phone: phone.trim() || undefined,
          subscribed_to: subscribedTo,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not subscribe. Try again later.');
        outcome = 'api_error';
        return;
      }
      setMessage("You're on the list. We'll only ping you when conditions hit PERFECT (max once per 24 hours).");
      setEmail('');
      setPhone('');
      outcome = 'success';
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[subscribe]', err);
      }
      setError(err instanceof Error ? err.message : 'Unable to reach the server.');
      outcome = 'error';
    } finally {
      setLoading(false);
      perf.end(outcome);
    }
  };

  const shell = isDark
    ? 'border-cyan-400/25 bg-slate-950/50 text-slate-200'
    : 'border-slate-200 bg-white text-slate-800 shadow-md';

  const defaultTitle = 'Get alerts for perfect nights';
  const defaultBioSubtitle =
    'SMS and/or email when bioluminescence conditions score PERFECT (automated check, no spam).';
  const defaultRocketSubtitle =
    'SMS and/or email when rocket viewing conditions score PRIME/PERFECT (same rules).';

  return (
    <div className={`rounded-2xl border p-6 md:p-8 ${shell} ${className}`.trim()}>
      <div className="mb-4 flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            isDark ? 'bg-cyan-500/15 text-cyan-300' : 'bg-amber-100 text-amber-700'
          }`}
        >
          <Bell className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3 className={`text-lg font-bold uppercase tracking-widest ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {title ?? defaultTitle}
          </h3>
          <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            {subtitle ??
              (subscribedTo === 'bio' ? defaultBioSubtitle : defaultRocketSubtitle)}
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor={`sub-email-${subscribedTo}`} className="mb-1 block text-xs font-semibold uppercase tracking-wider">
            Email <span className="text-rose-400">*</span>
          </label>
          <input
            id={`sub-email-${subscribedTo}`}
            type="email"
            required
            autoComplete="email"
            disabled={loading}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full rounded-lg border px-3 py-2.5 text-sm ${
              isDark
                ? 'border-white/15 !bg-transparent !text-white placeholder:text-gray-400 caret-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 disabled:opacity-100 disabled:text-white'
                : 'border-slate-300 bg-white text-slate-900'
            }`}
            style={
              isDark
                ? {
                    color: '#ffffff',
                    WebkitTextFillColor: '#ffffff',
                    backgroundColor: 'transparent',
                    WebkitBoxShadow: '0 0 0px 1000px transparent inset',
                    opacity: 1,
                  }
                : undefined
            }
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label htmlFor={`sub-phone-${subscribedTo}`} className="mb-1 block text-xs font-semibold uppercase tracking-wider">
            Mobile (optional)
          </label>
          <input
            id={`sub-phone-${subscribedTo}`}
            type="tel"
            autoComplete="tel"
            disabled={loading}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`w-full rounded-lg border px-3 py-2.5 text-sm ${
              isDark
                ? 'border-white/15 !bg-transparent !text-white placeholder:text-gray-400 caret-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 disabled:opacity-100 disabled:text-white'
                : 'border-slate-300 bg-white text-slate-900'
            }`}
            style={
              isDark
                ? {
                    color: '#ffffff',
                    WebkitTextFillColor: '#ffffff',
                    backgroundColor: 'transparent',
                    WebkitBoxShadow: '0 0 0px 1000px transparent inset',
                    opacity: 1,
                  }
                : undefined
            }
            placeholder="5551234567"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className={
            isDark && primaryCta
              ? `w-full rounded-xl border border-cyan-400/40 bg-gradient-to-r from-sky-600/90 to-cyan-600/90 py-3.5 text-sm font-bold uppercase tracking-widest text-white shadow-[0_0_28px_rgba(34,211,238,0.35)] transition hover:scale-[1.01] hover:shadow-[0_0_40px_rgba(34,211,238,0.5)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100`
              : isDark
                ? 'lz-btn-secondary w-full !py-2.5 !text-sm disabled:opacity-60'
                : 'w-full rounded-lg bg-amber-600 py-2.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60'
          }
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            submitLabel ?? 'Subscribe to alerts'
          )}
        </button>
      </form>

      {message && (
        <p className="mt-4 text-sm text-emerald-300/95" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-4 text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}
      <p className={`mt-4 text-[11px] leading-snug ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
        By subscribing you agree to receive rare operational alerts from Launch Zone. Reply STOP to opt out of SMS
        where supported. We never sell your contact info.
      </p>
    </div>
  );
}
