import { env } from '../config/env.js';
import { withTimeout } from './adminDiagnostics';

export type AdminWaiverContext = 'pre_trip' | 'booking';

function waiverPdfPath(context: AdminWaiverContext, recordId: string): string {
  if (context === 'booking') {
    return `/api/admin/bookings/${encodeURIComponent(recordId)}/waiver-pdf`;
  }
  return `/api/admin/pre-trip-submissions/${encodeURIComponent(recordId)}/waiver-pdf`;
}

export async function downloadAdminWaiverPdf(
  token: string,
  params: { context: AdminWaiverContext; recordId: string }
): Promise<void> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('API URL is not configured.');
  }
  const res = await withTimeout(
    'Admin waiver PDF download',
    fetch(`${env.apiUrl}${waiverPdfPath(params.context, params.recordId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
    30000
  );
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || 'Could not download signed waiver PDF.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/i);
  const fileName = match?.[1] || `signed-waiver-${params.recordId.slice(0, 8)}.pdf`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
