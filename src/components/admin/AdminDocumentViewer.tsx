import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { withTimeout } from '../../lib/adminDiagnostics';
import {
  downloadAdminDocument,
  fetchAdminDocumentAccess,
  type AdminDocumentAccessMeta,
  type AdminDocumentContext,
  type AdminDocumentKind,
} from '../../lib/adminDocuments';
import AdminModalShell from './AdminModalShell';

type Props = {
  context: AdminDocumentContext;
  recordId: string;
  document: AdminDocumentKind;
  label: string;
  available?: boolean;
  className?: string;
  linkClassName?: string;
};

export default function AdminDocumentViewer({
  context,
  recordId,
  document,
  label,
  available = true,
  className = '',
  linkClassName = 'inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800 hover:underline',
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<AdminDocumentAccessMeta | null>(null);

  const titleId = `admin-doc-title-${recordId}-${document}`;

  const getAdminToken = useCallback(async () => {
    const {
      data: { session },
    } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return session?.access_token || null;
  }, []);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      const access = await fetchAdminDocumentAccess(token, { context, recordId, document });
      setMeta(access);
    } catch (err) {
      setMeta(null);
      setError(err instanceof Error ? err.message : 'Could not load document.');
    } finally {
      setLoading(false);
    }
  }, [context, document, getAdminToken, recordId]);

  useEffect(() => {
    if (!open) return;
    void loadAccess();
  }, [loadAccess, open]);

  const handleClose = () => {
    setOpen(false);
    setMeta(null);
    setError(null);
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session expired.');
      await downloadAdminDocument(token, { context, recordId, document });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download document.');
    } finally {
      setDownloading(false);
    }
  };

  if (!available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${linkClassName} ${className}`.trim()}
        aria-label={`View ${label}`}
      >
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        {label}
      </button>

      <AdminModalShell
        open={open}
        onClose={handleClose}
        titleId={titleId}
        title={label}
        subtitle={meta?.fileName || null}
        headerActions={
          <button
            type="button"
            disabled={loading || downloading}
            onClick={() => void handleDownload()}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {downloading ? 'Downloading…' : 'Download'}
          </button>
        }
      >
        <div className="p-3 sm:p-4">
          {loading ? (
            <p className="py-8 text-center text-sm font-semibold text-slate-600">Loading document…</p>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {error}
            </div>
          ) : meta?.viewMode === 'image' && meta.signedUrl ? (
            <img
              src={meta.signedUrl}
              alt={label}
              className="mx-auto w-auto max-w-full rounded-lg bg-white object-contain shadow"
              style={{ maxHeight: 'calc(92dvh - 8rem)' }}
            />
          ) : meta?.viewMode === 'pdf' && meta.signedUrl ? (
            <iframe
              title={label}
              src={meta.signedUrl}
              className="w-full rounded-lg border border-slate-200 bg-white"
              style={{ height: 'calc(92dvh - 8rem)', minHeight: '240px' }}
            />
          ) : meta ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold">Preview unavailable for this file type.</p>
              <p className="mt-1">Use Download to open the file on your device.</p>
            </div>
          ) : null}
        </div>
      </AdminModalShell>
    </>
  );
}
