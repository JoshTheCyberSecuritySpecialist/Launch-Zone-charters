import { env } from '../config/env.js';
import type { BioGiftTicketThemeId } from './bioGiftTicketThemes';

function requireApiBase(): string {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('Gift ticket download is temporarily unavailable.');
  }
  return env.apiUrl;
}

export function bioGiftTicketsPdfUrl(
  sessionId: string,
  options?: { ticketCode?: string | null; theme?: BioGiftTicketThemeId | string | null }
): string {
  const base = requireApiBase();
  const params = new URLSearchParams();
  params.set('sessionId', sessionId);
  if (options?.ticketCode) params.set('code', options.ticketCode);
  if (options?.theme) params.set('theme', String(options.theme));
  return `${base}/api/bio-gift/tickets.pdf?${params.toString()}`;
}

export async function downloadBioGiftTicketsPdf(
  sessionId: string,
  options?: {
    ticketCode?: string | null;
    theme?: BioGiftTicketThemeId | string | null;
    filenameHint?: string;
  }
): Promise<void> {
  const url = bioGiftTicketsPdfUrl(sessionId, {
    ticketCode: options?.ticketCode,
    theme: options?.theme,
  });
  const res = await fetch(url);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Could not download gift ticket PDF.');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = options?.filenameHint || 'launch-zone-bioluminescence-gift-tickets.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function saveBioGiftTicketTheme(
  sessionId: string,
  theme: BioGiftTicketThemeId
): Promise<{ ticketTheme: BioGiftTicketThemeId }> {
  const base = requireApiBase();
  const res = await fetch(`${base}/api/bio-gift/ticket-theme`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, theme }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    ticketTheme?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Could not save ticket theme.');
  }
  return { ticketTheme: (data.ticketTheme || theme) as BioGiftTicketThemeId };
}

export async function emailBioGiftTickets(
  sessionId: string
): Promise<{ emailed: boolean; to: string; ticketCount: number }> {
  const base = requireApiBase();
  const res = await fetch(`${base}/api/bio-gift/email-tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    emailed?: boolean;
    to?: string;
    ticketCount?: number;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Could not email gift tickets.');
  }
  return {
    emailed: Boolean(data.emailed),
    to: String(data.to || ''),
    ticketCount: Number(data.ticketCount) || 0,
  };
}

/** Capture on-screen ticket DOM node(s) as high-res PNG download(s). */
export async function downloadBioGiftTicketsPng(
  nodes: Array<HTMLElement | null>,
  options?: { filenamePrefix?: string }
): Promise<number> {
  const { toPng } = await import('html-to-image');
  const prefix = options?.filenamePrefix || 'LZC-bioluminescence-gift';
  let saved = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    const dataUrl = await toPng(node, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: '#020617',
    });
    const a = document.createElement('a');
    a.href = dataUrl;
    const code = node.getAttribute('data-gift-code') || String(i + 1);
    a.download = `${prefix}-${code}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    saved += 1;
    // Brief pause so browsers don't coalesce multiple downloads.
    if (nodes.length > 1) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  if (!saved) throw new Error('No tickets were ready to export as PNG.');
  return saved;
}
