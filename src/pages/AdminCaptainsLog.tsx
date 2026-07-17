import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import AdminActions from '../components/admin/AdminActions';
import StatusBadge from '../components/admin/StatusBadge';
import { env } from '../config/env.js';
import { uploadCaptainsLogHeroImage } from '../lib/storageUpload';
import {
  CAPTAINS_LOG_CATEGORIES,
  captainsLogArticlePath,
  slugifyCaptainsLogTitle,
  type CaptainsLogCategory,
} from '../lib/captainsLog';
import { getAdminAlerts, getAdminSubscribers } from '../lib/adminApi';
import { fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

const LS_CAP_RUN_STATUS = 'lz_admin_captains_log_last_status';
const LS_CAP_RUN_TIME = 'lz_admin_captains_log_last_at';

let adminAlertsInitialFetchDoneDev = false;
let adminSubscribersInitialFetchDoneDev = false;

type CaptainsLogRow = {
  id: string;
  title: string;
  slug: string;
  category: string;
  created_at: string;
};

type AdminAlertRow = {
  id: string;
  type: string | null;
  message: string | null;
  score: number | null;
  created_at: string;
};

type AdminSubscriberRow = {
  email: string;
  phone: string | null;
  created_at: string;
};

function lastRunStatusTone(status: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'success') return 'success';
  if (s === 'failed') return 'danger';
  if (s === 'busy' || s === 'started') return 'info';
  return 'neutral';
}

export default function AdminCaptainsLog() {
  const { user, isAdmin, loading: authLoading } = useAuth();

  const [notice, setNotice] = useState<{ variant: 'success' | 'error' | 'info'; text: string } | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [lastRunStatus, setLastRunStatus] = useState<string>('N/A');
  const [lastRunTime, setLastRunTime] = useState<string>('');

  const [captainsLogArticles, setCaptainsLogArticles] = useState<CaptainsLogRow[]>([]);
  const [captainsLogFormOpen, setCaptainsLogFormOpen] = useState(false);
  const [newArticleTitle, setNewArticleTitle] = useState('');
  const [newArticleSlug, setNewArticleSlug] = useState('');
  const [newArticleCategory, setNewArticleCategory] = useState<CaptainsLogCategory>('Local Highlights');
  const [newArticleContent, setNewArticleContent] = useState('');
  const [newArticleImageUrl, setNewArticleImageUrl] = useState('');
  const [newArticleImageAlt, setNewArticleImageAlt] = useState('');
  const [newArticleSummary, setNewArticleSummary] = useState('');
  const [captainsLogHeroFile, setCaptainsLogHeroFile] = useState<File | null>(null);
  const captainsLogHeroInputRef = useRef<HTMLInputElement>(null);
  const [captainsLogSaving, setCaptainsLogSaving] = useState(false);
  const [captainsLogFormError, setCaptainsLogFormError] = useState<string | null>(null);
  const [captainsLogEditingId, setCaptainsLogEditingId] = useState<string | null>(null);
  const [captainsLogEditLoadingId, setCaptainsLogEditLoadingId] = useState<string | null>(null);
  const [captainsLogDeletingId, setCaptainsLogDeletingId] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<AdminAlertRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [subscribers, setSubscribers] = useState<AdminSubscriberRow[]>([]);
  const [subscribersLoading, setSubscribersLoading] = useState(false);
  const [subscribersError, setSubscribersError] = useState<string | null>(null);
  const [runningAlerts, setRunningAlerts] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    setLastRunStatus(localStorage.getItem(LS_CAP_RUN_STATUS) || 'N/A');
    setLastRunTime(localStorage.getItem(LS_CAP_RUN_TIME) || '');
  }, [isAdmin]);

  useEffect(() => {
    if (!notice || notice.variant !== 'success') return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const getAdminToken = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return session?.access_token || null;
  }, []);

  const loadCaptainsLog = useCallback(async () => {
    if (!isAdmin) return;
    const { data, error } = await supabase
      .from('captains_log')
      .select('id, title, slug, category, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    logSupabaseError('AdminCaptainsLog.loadCaptainsLog', error);
    if (data) {
      setCaptainsLogArticles(data as CaptainsLogRow[]);
    }
  }, [isAdmin]);

  const reserveCaptainsLogSlug = useCallback(
    async (
      title: string,
      explicitSlug: string,
      options?: { excludeArticleId?: string | null }
    ): Promise<{ slug: string } | { error: string }> => {
      const excludeArticleId = options?.excludeArticleId ?? null;
      const root = explicitSlug.trim()
        ? slugifyCaptainsLogTitle(explicitSlug)
        : slugifyCaptainsLogTitle(title);
      if (!root) {
        return { error: 'Add a title (or a custom URL slug) before saving.' };
      }
      for (let n = 0; n < 80; n++) {
        const candidate = n === 0 ? root : `${root}-${n + 1}`;
        const { data, error } = await supabase
          .from('captains_log')
          .select('id')
          .eq('slug', candidate)
          .maybeSingle();
        if (error) {
          return { error: error.message };
        }
        if (!data) {
          return { slug: candidate };
        }
        if (excludeArticleId && data.id === excludeArticleId) {
          return { slug: candidate };
        }
      }
      return { slug: `${root}-${Date.now()}` };
    },
    []
  );

  const resetCaptainsLogForm = useCallback(() => {
    setCaptainsLogEditingId(null);
    setNewArticleTitle('');
    setNewArticleSlug('');
    setNewArticleCategory('Local Highlights');
    setNewArticleContent('');
    setNewArticleImageUrl('');
    setNewArticleImageAlt('');
    setNewArticleSummary('');
    setCaptainsLogHeroFile(null);
    if (captainsLogHeroInputRef.current) {
      captainsLogHeroInputRef.current.value = '';
    }
    setCaptainsLogFormError(null);
  }, []);

  const handleEditCaptainsLogArticle = async (id: string) => {
    setCaptainsLogFormError(null);
    setCaptainsLogEditLoadingId(id);
    try {
      const { data, error } = await supabase.from('captains_log').select('*').eq('id', id).maybeSingle();
      logSupabaseError('AdminCaptainsLog.loadCaptainsLogForEdit', error);
      if (error) {
        setCaptainsLogFormError(error.message || 'Could not load article.');
        return;
      }
      if (!data) {
        setCaptainsLogFormError('Article not found.');
        return;
      }
      setCaptainsLogEditingId(id);
      setNewArticleTitle(data.title ?? '');
      setNewArticleSlug(data.slug ?? '');
      setNewArticleCategory((data.category as CaptainsLogCategory) || 'Local Highlights');
      setNewArticleContent(data.content ?? '');
      setNewArticleImageUrl(data.image_url ?? '');
      setNewArticleImageAlt(data.image_alt ?? '');
      setNewArticleSummary(data.summary ?? '');
      setCaptainsLogHeroFile(null);
      if (captainsLogHeroInputRef.current) {
        captainsLogHeroInputRef.current.value = '';
      }
      setCaptainsLogFormOpen(true);
    } finally {
      setCaptainsLogEditLoadingId(null);
    }
  };

  const handleSaveCaptainsLogArticle = async () => {
    setCaptainsLogFormError(null);
    const title = newArticleTitle.trim();
    const content = newArticleContent.trim();
    if (!title) {
      setCaptainsLogFormError('Title is required.');
      return;
    }
    if (!content) {
      setCaptainsLogFormError('Body content is required (use Markdown).');
      return;
    }
    const slugRes = await reserveCaptainsLogSlug(title, newArticleSlug, {
      excludeArticleId: captainsLogEditingId,
    });
    if ('error' in slugRes) {
      setCaptainsLogFormError(slugRes.error);
      return;
    }
    const slug = slugRes.slug;
    const imageAlt = newArticleImageAlt.trim();
    const summary = newArticleSummary.trim();
    setCaptainsLogSaving(true);
    try {
      let imageUrl = newArticleImageUrl.trim();
      if (captainsLogHeroFile) {
        const { url, error: uploadErr } = await uploadCaptainsLogHeroImage(captainsLogHeroFile);
        if (uploadErr || !url) {
          setCaptainsLogFormError(uploadErr?.message || 'Image upload failed.');
          return;
        }
        imageUrl = url;
        setNewArticleImageUrl(url);
      }

      const payloadBase = {
        title: title.slice(0, 500),
        slug: slug.slice(0, 200),
        content,
        category: newArticleCategory,
        image_url: imageUrl || null,
        image_alt: imageAlt || null,
        summary: summary || null,
      };

      if (captainsLogEditingId) {
        const { data: updatedRow, error } = await supabase
          .from('captains_log')
          .update({
            ...payloadBase,
            ...(captainsLogHeroFile ? { image_source: 'Manual' as const } : {}),
          })
          .eq('id', captainsLogEditingId)
          .select('id, image_url')
          .maybeSingle();
        logSupabaseError('AdminCaptainsLog.updateCaptainsLog', error);
        if (error) {
          setCaptainsLogFormError(error.message || 'Could not update article.');
          return;
        }
        if (!updatedRow) {
          setCaptainsLogFormError(
            'Update did not change any row (check that you are signed in as admin and RLS allows updates).'
          );
          return;
        }
        setNotice({ variant: 'success', text: 'Article updated.' });
      } else {
        const { data: insertedRow, error } = await supabase
          .from('captains_log')
          .insert({
            ...payloadBase,
            publish_date: null,
            source: 'Manual',
            source_url: null,
            image_source: 'Manual',
          })
          .select('id, image_url')
          .maybeSingle();
        logSupabaseError('AdminCaptainsLog.insertCaptainsLog', error);
        if (error) {
          setCaptainsLogFormError(error.message || 'Could not save article.');
          return;
        }
        if (!insertedRow) {
          setCaptainsLogFormError('Insert did not return a row (check admin permissions).');
          return;
        }
        setNotice({ variant: 'success', text: 'Article published.' });
      }
      resetCaptainsLogForm();
      setCaptainsLogFormOpen(false);
      await loadCaptainsLog();
    } finally {
      setCaptainsLogSaving(false);
    }
  };

  const handleDeleteCaptainsLogArticle = async (id: string, title: string) => {
    if (!window.confirm(`Delete this article?\n\n"${title.slice(0, 120)}${title.length > 120 ? '…' : ''}"\n\nThis cannot be undone.`)) {
      return;
    }
    setCaptainsLogDeletingId(id);
    try {
      const { data: deletedOk, error } = await supabase.rpc('admin_delete_captains_log', {
        article_id: id,
      });
      logSupabaseError('AdminCaptainsLog.deleteCaptainsLog', error);
      if (error) {
        window.alert(error.message || 'Could not delete article. Check that you are signed in as an admin.');
        return;
      }
      if (!deletedOk) {
        window.alert('No article matched that id. Try refreshing the list.');
        return;
      }
      setNotice({ variant: 'success', text: 'Article deleted.' });
      await loadCaptainsLog();
    } finally {
      setCaptainsLogDeletingId(null);
    }
  };

  const loadAlerts = useCallback(async () => {
    if (!isAdmin) return;
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setAlertsError('API server URL is not configured (set VITE_API_URL).');
      setAlerts([]);
      setAlertsLoading(false);
      return;
    }
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setAlertsError('Admin session unavailable.');
        setAlerts([]);
        return;
      }

      const payload = (await getAdminAlerts(token)) as AdminAlertRow[] | { error?: string };
      setAlerts(Array.isArray(payload) ? payload : []);
    } catch (err) {
      console.error('[admin-alerts]', err);
      setAlertsError('Could not load alert activity.');
      setAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  }, [getAdminToken, isAdmin]);

  const loadSubscribers = useCallback(async () => {
    if (!isAdmin) return;
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setSubscribersError('API server URL is not configured (set VITE_API_URL).');
      setSubscribers([]);
      setSubscribersLoading(false);
      return;
    }
    setSubscribersLoading(true);
    setSubscribersError(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setSubscribersError('Admin session unavailable.');
        setSubscribers([]);
        return;
      }

      const payload = (await getAdminSubscribers(token)) as AdminSubscriberRow[] | { error?: string };
      setSubscribers(Array.isArray(payload) ? payload : []);
    } catch (err) {
      console.error('[admin-subscribers]', err);
      setSubscribersError('Could not load subscribers.');
      setSubscribers([]);
    } finally {
      setSubscribersLoading(false);
    }
  }, [getAdminToken, isAdmin]);

  const handleRunAlerts = useCallback(async () => {
    if (!isAdmin || runningAlerts) return;
    if (!env.apiUrlConfigured || !env.apiUrl) {
      setNotice({ variant: 'error', text: 'API server URL is not configured (set VITE_API_URL).' });
      return;
    }
    setRunningAlerts(true);
    setNotice(null);
    try {
      const token = await getAdminToken();
      if (!token) {
        setNotice({ variant: 'error', text: 'Admin session unavailable.' });
        return;
      }

      const payload = await fetchJsonWithTimeout<{ success?: boolean; error?: string }>('admin-api:run-alerts', `${env.apiUrl}/api/admin/run-alerts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }, 15000);
      if (!payload.success) {
        setNotice({ variant: 'error', text: payload.error || 'Failed to run alerts.' });
        return;
      }

      setNotice({ variant: 'success', text: 'Alerts triggered successfully.' });
      await Promise.all([loadAlerts(), loadSubscribers()]);
    } catch (err) {
      console.error('[admin-run-alerts]', err);
      setNotice({ variant: 'error', text: 'Run alerts failed.' });
    } finally {
      setRunningAlerts(false);
    }
  }, [getAdminToken, isAdmin, runningAlerts, loadAlerts, loadSubscribers]);

  const persistLastRun = (status: string) => {
    const iso = new Date().toISOString();
    localStorage.setItem(LS_CAP_RUN_STATUS, status);
    localStorage.setItem(LS_CAP_RUN_TIME, iso);
    setLastRunStatus(status);
    setLastRunTime(iso);
  };

  const handleGenerateCaptainsLog = () => {
    setNotice(null);
    setIsGenerating(true);

    void (async () => {
      try {
        const token = await getAdminToken();
        if (!token) {
          setNotice({ variant: 'error', text: 'You must be signed in.' });
          persistLastRun('Failed');
          return;
        }

        if (!env.apiUrlConfigured || !env.apiUrl) {
          setNotice({ variant: 'error', text: 'API server URL is not configured (set VITE_API_URL).' });
          persistLastRun('Failed');
          return;
        }

        const payload = await fetchJsonWithTimeout<{
          success?: boolean;
          status?: string;
          message?: string;
          error?: string;
          details?: string;
        }>('admin-api:generate-content', `${env.apiUrl}/api/generate-content`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }, 15000);

        const errLine =
          typeof payload.error === 'string'
            ? payload.error
            : typeof payload.message === 'string'
              ? payload.message
              : 'Something went wrong.';
        const detailSuffix =
          typeof payload.details === 'string' && payload.details.trim()
            ? ` ${payload.details.trim().slice(0, 500)}`
            : '';

        if (payload.success === false) {
          if (payload.message === 'Already generating') {
            setNotice({ variant: 'info', text: 'Already generating. Wait for the current run to finish.' });
            persistLastRun('Busy');
          } else {
            console.error('[generate-content]', payload);
            setNotice({ variant: 'error', text: `${errLine}${detailSuffix}`.trim() });
            persistLastRun('Failed');
          }
          return;
        }

        if (payload.status === 'started') {
          setNotice({
            variant: 'info',
            text:
              typeof payload.message === 'string' && payload.message.trim()
                ? `${payload.message.trim()}. Refresh Captain's Log in a few minutes to see new posts.`
                : "Content generation started in the background. Refresh Captain's Log in a few minutes to see new posts.",
          });
          persistLastRun('Started');
          await loadCaptainsLog();
          return;
        }

        setNotice({ variant: 'success', text: 'Content generated successfully' });
        persistLastRun('Success');
        await loadCaptainsLog();
      } catch (err) {
        console.error('[generate-content]', err);
        setNotice({ variant: 'error', text: 'Failed to generate content. Check the API and try again.' });
        persistLastRun('Failed');
      } finally {
        setIsGenerating(false);
      }
    })();
  };

  useEffect(() => {
    if (!isAdmin) return;
    void loadCaptainsLog();
  }, [isAdmin, loadCaptainsLog]);

  useEffect(() => {
    if (!isAdmin) {
      adminAlertsInitialFetchDoneDev = false;
      adminSubscribersInitialFetchDoneDev = false;
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    if (import.meta.env.DEV && adminAlertsInitialFetchDoneDev) return;
    adminAlertsInitialFetchDoneDev = true;
    void loadAlerts();
  }, [isAdmin, loadAlerts]);

  useEffect(() => {
    if (!isAdmin) return;
    if (import.meta.env.DEV && adminSubscribersInitialFetchDoneDev) return;
    adminSubscribersInitialFetchDoneDev = true;
    void loadSubscribers();
  }, [isAdmin, loadSubscribers]);

  const refreshAll = () => {
    void Promise.all([loadCaptainsLog(), loadAlerts(), loadSubscribers()]);
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }

  return (
    <AdminShell
      title="Captain's Log"
      subtitle="Generate, publish, and manage Captain's Log articles, subscribers, and alert activity"
      actions={
        <>
          <Link
            to="/admin/bookings"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to Bookings
          </Link>
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </button>
        </>
      }
    >
      {notice && (
        <div
          className={`fixed bottom-6 left-1/2 z-[100] max-w-md -translate-x-1/2 rounded-lg px-4 py-3 text-center text-sm font-semibold shadow-lg ${
            notice.variant === 'success'
              ? 'bg-green-700 text-white'
              : notice.variant === 'info'
                ? 'bg-slate-800 text-amber-200'
                : 'bg-red-700 text-white'
          }`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/90 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Captain&apos;s Log</p>
          <p className="text-xs text-slate-600">
            Generate new articles via the server pipeline (Python + Ollama). Runs up to ~60s per
            batch on the server; the admin UI stays responsive.
          </p>
          <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <dt className="font-semibold text-slate-700">Last run status</dt>
              <dd className="mt-0.5">
                <StatusBadge tone={lastRunStatusTone(lastRunStatus)}>{lastRunStatus}</StatusBadge>
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-slate-700">Last run time</dt>
              <dd>
                {lastRunTime
                  ? new Date(lastRunTime).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'N/A'}
              </dd>
            </div>
          </dl>
        </div>
        <button
          type="button"
          onClick={handleGenerateCaptainsLog}
          disabled={isGenerating}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {isGenerating ? 'Generating...' : "Generate Captain's Log Content"}
        </button>
      </div>

      <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add article manually</h2>
            <p className="text-xs text-slate-500">
              Publish Markdown to Captain&apos;s Log without the generator. Slug is derived from the title unless you
              set a custom one. Use <strong>Edit</strong> on a row below to update an existing post.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCaptainsLogFormError(null);
              setCaptainsLogFormOpen((open) => {
                if (open) {
                  resetCaptainsLogForm();
                  return false;
                }
                resetCaptainsLogForm();
                return true;
              });
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {captainsLogFormOpen ? 'Hide form' : 'Show form'}
          </button>
        </div>
        {captainsLogFormOpen && (
          <div className="space-y-4 border-b border-slate-100 px-4 py-4">
            {captainsLogEditingId ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Editing an existing article — saving updates the live page URL if you change the slug.
              </p>
            ) : null}
            {captainsLogFormError && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {captainsLogFormError}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">Title</span>
                <input
                  type="text"
                  value={newArticleTitle}
                  onChange={(e) => setNewArticleTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  placeholder="Headline shown on the site"
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-slate-700">URL slug (optional)</span>
                <input
                  type="text"
                  value={newArticleSlug}
                  onChange={(e) => setNewArticleSlug(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                  placeholder="e.g. my-launch-view-tips"
                  autoComplete="off"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Category</span>
              <select
                value={newArticleCategory}
                onChange={(e) => setNewArticleCategory(e.target.value as CaptainsLogCategory)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 sm:max-w-md"
              >
                {CAPTAINS_LOG_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Body (Markdown)</span>
              <textarea
                value={newArticleContent}
                onChange={(e) => setNewArticleContent(e.target.value)}
                rows={12}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
                placeholder={'## Section\n\nParagraph…'}
              />
            </label>
            <div className="space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50/80 px-3 py-3 sm:px-4">
                <span className="text-sm font-semibold text-slate-700">Hero image (optional)</span>
                <p className="mt-1 text-xs text-slate-500">
                  Upload JPEG, PNG, WebP, or GIF (max 10 MB). If you choose a file, it is saved to your site storage
                  and used instead of the URL field. Run the{' '}
                  <code className="rounded bg-white px-1 text-[11px]">captains-log</code> storage migration if upload
                  fails.
                </p>
                <input
                  ref={captainsLogHeroInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  aria-label="Upload hero image file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setCaptainsLogHeroFile(f ?? null);
                  }}
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => captainsLogHeroInputRef.current?.click()}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                  >
                    Choose image file
                  </button>
                  {captainsLogHeroFile ? (
                    <>
                      <span className="max-w-[min(100%,280px)] truncate text-sm text-slate-700" title={captainsLogHeroFile.name}>
                        {captainsLogHeroFile.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCaptainsLogHeroFile(null);
                          if (captainsLogHeroInputRef.current) captainsLogHeroInputRef.current.value = '';
                        }}
                        className="text-sm font-semibold text-slate-600 underline hover:text-slate-900"
                      >
                        Clear file
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Hero image URL (optional)</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">
                    Use when you don&apos;t upload a file above, or to override after clearing the file.
                  </span>
                  <input
                    type="url"
                    value={newArticleImageUrl}
                    onChange={(e) => setNewArticleImageUrl(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    placeholder="https://…"
                    autoComplete="off"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Image alt text (optional)</span>
                  <input
                    type="text"
                    value={newArticleImageAlt}
                    onChange={(e) => setNewArticleImageAlt(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900"
                    placeholder="Describe the hero for accessibility"
                    autoComplete="off"
                  />
                </label>
              </div>
            </div>
            <label className="block text-sm">
              <span className="font-semibold text-slate-700">Short summary (optional)</span>
              <textarea
                value={newArticleSummary}
                onChange={(e) => setNewArticleSummary(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
                placeholder="Used for SEO / excerpts when set"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSaveCaptainsLogArticle()}
                disabled={captainsLogSaving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {captainsLogSaving
                  ? 'Saving…'
                  : captainsLogEditingId
                    ? 'Save changes'
                    : 'Publish article'}
              </button>
            </div>
          </div>
        )}
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-bold text-slate-900">Recent Captain&apos;s Log articles</h2>
          <p className="text-xs text-slate-500">
            Newest first (up to 500 articles). Refreshes when you publish or delete here, or after a successful
            generation run.
          </p>
        </div>

        <AdminResponsiveList
          desktop={
            <div className="overflow-x-auto">
              {captainsLogArticles.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">No articles yet.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-2">Title</th>
                      <th className="px-4 py-2">Category</th>
                      <th className="px-4 py-2">Created</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {captainsLogArticles.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="max-w-[200px] truncate px-4 py-2 font-medium text-slate-900" title={a.title}>
                          {a.title}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{a.category}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                          {new Date(a.created_at).toLocaleDateString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-right">
                          <a
                            href={captainsLogArticlePath(a.slug)}
                            className="font-semibold text-amber-700 hover:text-amber-800"
                            target="_blank"
                            rel="noreferrer"
                          >
                            View
                          </a>
                          <button
                            type="button"
                            onClick={() => void handleEditCaptainsLogArticle(a.id)}
                            disabled={
                              !!captainsLogEditLoadingId ||
                              captainsLogSaving ||
                              captainsLogDeletingId === a.id
                            }
                            className="ml-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                            title="Edit article"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                            {captainsLogEditLoadingId === a.id ? 'Loading…' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteCaptainsLogArticle(a.id, a.title)}
                            disabled={captainsLogDeletingId === a.id}
                            className="ml-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                            title="Delete article"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          }
          mobile={
            <div className="space-y-3 p-3">
              {captainsLogArticles.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No articles yet.</p>
              ) : (
                captainsLogArticles.map((a) => (
                  <MobileAdminCard
                    key={`cl-m-${a.id}`}
                    title={a.title}
                    subtitle={a.category}
                    fields={[
                      {
                        label: 'Created',
                        value: new Date(a.created_at).toLocaleDateString(),
                      },
                    ]}
                    actions={
                      <AdminActions>
                        <a
                          href={captainsLogArticlePath(a.slug)}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm font-semibold text-amber-900"
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleEditCaptainsLogArticle(a.id)}
                          disabled={!!captainsLogEditLoadingId || captainsLogSaving || captainsLogDeletingId === a.id}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
                        >
                          {captainsLogEditLoadingId === a.id ? 'Loading…' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteCaptainsLogArticle(a.id, a.title)}
                          disabled={captainsLogDeletingId === a.id}
                          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50 sm:col-span-2"
                        >
                          Delete
                        </button>
                      </AdminActions>
                    }
                  />
                ))
              )}
            </div>
          }
        />
      </div>

      <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-bold text-slate-900">Subscribers</h2>
          <p className="text-xs text-slate-500">Latest alert subscribers (max 50).</p>
        </div>

        <AdminResponsiveList
          desktop={
            <div className="overflow-x-auto">
              {subscribersLoading ? (
                <p className="px-4 py-6 text-sm text-slate-500">Loading subscribers…</p>
              ) : subscribersError ? (
                <p className="px-4 py-6 text-sm text-red-600">{subscribersError}</p>
              ) : subscribers.length === 0 ? (
                <p className="px-4 py-6 text-sm text-slate-500">No subscribers yet.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Phone</th>
                      <th className="px-4 py-2">Date joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {subscribers.map((sub) => (
                      <tr key={`${sub.email}-${sub.created_at}`} className="hover:bg-slate-50">
                        <td className="max-w-[260px] break-all px-4 py-2 font-medium text-slate-900">
                          {sub.email}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-700">
                          {sub.phone || 'No phone'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                          {new Date(sub.created_at).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          }
          mobile={
            <div className="space-y-3 p-3">
              {subscribersLoading ? (
                <p className="py-6 text-center text-sm text-slate-500">Loading subscribers…</p>
              ) : subscribersError ? (
                <p className="py-6 text-center text-sm text-red-600">{subscribersError}</p>
              ) : subscribers.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No subscribers yet.</p>
              ) : (
                subscribers.map((sub) => (
                  <MobileAdminCard
                    key={`sub-m-${sub.email}-${sub.created_at}`}
                    title={sub.email}
                    fields={[
                      { label: 'Phone', value: sub.phone || 'No phone' },
                      {
                        label: 'Joined',
                        value: new Date(sub.created_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      },
                    ]}
                  />
                ))
              )}
            </div>
          }
        />
      </div>

      <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Recent Alert Activity</h2>
              <p className="text-xs text-slate-500">Latest triggered alert events (max 20).</p>
            </div>
            <button
              type="button"
              onClick={() => void handleRunAlerts()}
              disabled={runningAlerts}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runningAlerts ? 'Running...' : 'Run Alerts'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {alertsLoading ? (
            <p className="px-4 py-6 text-sm text-slate-500">Loading alerts…</p>
          ) : alertsError ? (
            <p className="px-4 py-6 text-sm text-red-600">{alertsError}</p>
          ) : alerts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No alerts logged yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {alerts.map((alert) => (
                <div key={alert.id} className="px-4 py-3">
                  <p className="text-sm font-semibold uppercase tracking-wide text-slate-800">
                    {alert.type || 'alert'} {alert.score != null ? `· score ${alert.score}` : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                    {alert.message || 'No message'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(alert.created_at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
