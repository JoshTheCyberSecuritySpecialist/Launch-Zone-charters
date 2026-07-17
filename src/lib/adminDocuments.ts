import { env } from '../config/env.js';
import { withTimeout } from './adminDiagnostics';

export type AdminDocumentContext = 'pre_trip' | 'booking';
export type AdminDocumentKind = 'license' | 'insurance' | 'buoy_proof';
export type AdminDocumentViewMode = 'pdf' | 'image' | 'unsupported';

export type AdminDocumentAccessMeta = {
  context: AdminDocumentContext;
  recordId: string;
  document: AdminDocumentKind;
  signedUrl: string;
  mimeType: string;
  viewMode: AdminDocumentViewMode;
  fileName: string;
  expiresInSeconds: number;
};

type AccessParams = {
  context: AdminDocumentContext;
  recordId: string;
  document: AdminDocumentKind;
};

function buildQuery(params: AccessParams): string {
  const q = new URLSearchParams({
    context: params.context,
    recordId: params.recordId,
    document: params.document,
  });
  return q.toString();
}

export async function fetchAdminDocumentAccess(
  token: string,
  params: AccessParams
): Promise<AdminDocumentAccessMeta> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('API URL is not configured.');
  }
  const res = await withTimeout(
    'Admin document access',
    fetch(`${env.apiUrl}/api/admin/documents/access?${buildQuery(params)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    }),
    20000
  );
  const payload = (await res.json().catch(() => ({}))) as AdminDocumentAccessMeta & { error?: string };
  if (!res.ok) {
    throw new Error(payload.error || 'Could not open document.');
  }
  if (!payload.signedUrl) {
    throw new Error('Document access URL is unavailable.');
  }
  return payload;
}

export async function downloadAdminDocument(token: string, params: AccessParams): Promise<void> {
  if (!env.apiUrlConfigured || !env.apiUrl) {
    throw new Error('API URL is not configured.');
  }
  const res = await withTimeout(
    'Admin document download',
    fetch(`${env.apiUrl}/api/admin/documents/download?${buildQuery(params)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
    30000
  );
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || 'Could not download document.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/i);
  const fileName = match?.[1] || `${params.document}-${params.recordId.slice(0, 8)}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
