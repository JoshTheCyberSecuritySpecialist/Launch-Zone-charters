import { env } from '../config/env.js';

function requireApiBase(): string {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('Gift ticket download is temporarily unavailable.');
  }
  return env.apiUrl;
}

export function bioGiftTicketsPdfUrl(sessionId: string, ticketCode?: string | null): string {
  const base = requireApiBase();
  const params = new URLSearchParams();
  params.set('sessionId', sessionId);
  if (ticketCode) params.set('code', ticketCode);
  return `${base}/api/bio-gift/tickets.pdf?${params.toString()}`;
}

export async function downloadBioGiftTicketsPdf(
  sessionId: string,
  options?: { ticketCode?: string | null; filenameHint?: string }
): Promise<void> {
  const url = bioGiftTicketsPdfUrl(sessionId, options?.ticketCode);
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
