/** Shared senior-friendly class names for the Waivers & Insurance flow. */

export const WI_FIELD =
  'lz-input-on-dark w-full min-h-12 rounded-xl border border-white/15 bg-slate-950/85 px-4 py-3.5 text-lg shadow-inner focus:border-[var(--lz-cta)]/55 focus:outline-none focus:ring-2 focus:ring-[var(--lz-cta)]/25';

export const WI_LABEL = 'mb-2 block text-[17px] font-semibold leading-snug text-slate-100';

export const WI_HINT = 'mt-1.5 text-base leading-relaxed text-slate-300';

export const WI_BODY = 'text-lg leading-relaxed text-slate-200';

export const WI_SECTION =
  'lz-card-glass rounded-[var(--lz-radius-card)] border border-white/10 p-6 md:p-8';

export const WI_PRIMARY_BTN =
  'lz-btn-primary flex min-h-12 w-full items-center justify-center gap-2 px-6 py-4 text-lg !normal-case !tracking-wide';

export const WI_SECONDARY_BTN =
  'flex min-h-12 w-full items-center justify-center rounded-xl border border-white/20 bg-slate-950/50 px-6 py-3.5 text-lg font-semibold text-cyan-100 hover:bg-slate-900/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50';

export const WI_UPLOAD_ZONE =
  'mt-4 flex min-h-[12rem] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/25 bg-slate-950/40 px-4 py-10 hover:border-cyan-400/40 focus-within:border-cyan-400/50 focus-within:ring-2 focus-within:ring-cyan-300/30';

export type DocStatusText = 'Not started' | 'Needs attention' | 'Uploading' | 'Completed';

export function docStatusClass(status: DocStatusText): string {
  switch (status) {
    case 'Completed':
      return 'border-emerald-400/35 bg-emerald-950/30 text-emerald-100';
    case 'Uploading':
      return 'border-cyan-400/35 bg-cyan-950/30 text-cyan-100';
    case 'Needs attention':
      return 'border-amber-400/40 bg-amber-950/35 text-amber-100';
    default:
      return 'border-white/15 bg-slate-950/40 text-slate-200';
  }
}
