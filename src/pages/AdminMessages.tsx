import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Mail, Trash2 } from 'lucide-react';
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
import { fetchJsonWithTimeout, withTimeout } from '../lib/adminDiagnostics';

type ContactInboxRow = {
  id: string;
  full_name: string;
  email: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type ContactReplyPreview = {
  from: string;
  to: string;
  subject: string;
  message: string;
  originalMessage: string;
  customerName: string;
};

function previewMessageBody(text: string, maxLen = 120): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

export default function AdminMessages() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [contactInbox, setContactInbox] = useState<ContactInboxRow[]>([]);
  const [contactInboxLoading, setContactInboxLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [notice, setNotice] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);

  const [contactReplyRow, setContactReplyRow] = useState<ContactInboxRow | null>(null);
  const [contactReplyDraft, setContactReplyDraft] = useState({ to: '', subject: '', message: '' });
  const [contactReplyPreview, setContactReplyPreview] = useState<ContactReplyPreview | null>(null);
  const [contactReplyBusy, setContactReplyBusy] = useState<'preview' | 'send' | null>(null);

  const getAdminToken = useCallback(async (): Promise<string | null> => {
    const {
      data: { session },
    } = await withTimeout('Admin session lookup', supabase.auth.getSession(), 12000);
    return session?.access_token || null;
  }, []);

  const apiRequest = useCallback(
    async (path: string, options?: RequestInit) => {
      if (!env.apiUrlConfigured || !env.apiUrl) {
        throw new Error('API server URL is not configured (set VITE_API_URL).');
      }
      const token = await getAdminToken();
      if (!token) throw new Error('Admin session unavailable.');
      const headers: HeadersInit = {
        Authorization: `Bearer ${token}`,
        ...(options?.headers || {}),
      };
      return await fetchJsonWithTimeout<Record<string, unknown>>(
        `admin-api:${path}`,
        `${env.apiUrl}${path}`,
        { ...options, headers },
        15000
      );
    },
    [getAdminToken]
  );

  const loadContactInbox = useCallback(async () => {
    if (!isAdmin) return;
    setContactInboxLoading(true);
    try {
      const { data, error } = await supabase
        .from('contact_messages')
        .select('id, full_name, email, message, is_read, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      logSupabaseError('AdminMessages.loadContactInbox', error);
      if (data) {
        setContactInbox(data as ContactInboxRow[]);
      } else {
        setContactInbox([]);
      }
    } finally {
      setHasLoaded(true);
      setContactInboxLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadContactInbox();
  }, [isAdmin, loadContactInbox]);

  const handleMarkContactMessageRead = async (messageId: string, read: boolean) => {
    const { error } = await supabase.from('contact_messages').update({ is_read: read }).eq('id', messageId);
    logSupabaseError('AdminMessages.markContactMessageRead', error);
    if (!error) {
      void loadContactInbox();
    } else {
      window.alert(error.message || 'Could not update message.');
    }
  };

  const handleDeleteContactMessage = async (messageId: string) => {
    if (!window.confirm('Delete this customer message? This cannot be undone.')) {
      return;
    }
    const { error } = await supabase.from('contact_messages').delete().eq('id', messageId);
    logSupabaseError('AdminMessages.deleteContactMessage', error);
    if (!error) {
      void loadContactInbox();
    } else {
      window.alert(error.message || 'Could not delete message.');
    }
  };

  const openContactReply = (row: ContactInboxRow) => {
    setContactReplyRow(row);
    setContactReplyPreview(null);
    setContactReplyDraft({
      to: row.email,
      subject: `Re: Your message to Launch Zone Charters`,
      message: `Hi ${row.full_name || 'there'},\n\n\n\nJoshua\nLaunch Zone Charters`,
    });
  };

  const closeContactReply = (force = false) => {
    if (contactReplyBusy && !force) return;
    setContactReplyRow(null);
    setContactReplyPreview(null);
    setContactReplyDraft({ to: '', subject: '', message: '' });
  };

  const validateContactReplyDraft = () => {
    if (!contactReplyDraft.to.trim()) return 'Customer email is missing.';
    if (!contactReplyDraft.subject.trim()) return 'Subject is required.';
    if (!contactReplyDraft.message.trim()) return 'Message is required.';
    return '';
  };

  const previewContactReply = async () => {
    if (!contactReplyRow) return;
    const validationError = validateContactReplyDraft();
    if (validationError) {
      setNotice({ variant: 'error', text: validationError });
      return;
    }
    setContactReplyBusy('preview');
    try {
      const payload = await apiRequest(`/api/admin/contact-messages/${contactReplyRow.id}/reply/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactReplyDraft),
      });
      const preview = payload.preview as ContactReplyPreview | undefined;
      if (!preview) throw new Error('Could not preview reply.');
      setContactReplyPreview(preview);
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not preview reply.' });
    } finally {
      setContactReplyBusy(null);
    }
  };

  const sendContactReply = async () => {
    if (!contactReplyRow || !contactReplyPreview) return;
    setContactReplyBusy('send');
    try {
      await apiRequest(`/api/admin/contact-messages/${contactReplyRow.id}/reply/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: contactReplyPreview.to,
          subject: contactReplyPreview.subject,
          message: contactReplyPreview.message,
        }),
      });
      setNotice({ variant: 'success', text: 'Reply sent.' });
      closeContactReply(true);
      await loadContactInbox();
    } catch (err) {
      setNotice({ variant: 'error', text: err instanceof Error ? err.message : 'Could not send reply.' });
    } finally {
      setContactReplyBusy(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) {
    return <AdminAccessDenied signedIn={Boolean(user)} />;
  }
  if (contactInboxLoading && !hasLoaded) return <FullPageLoader message="Loading customer messages…" />;

  return (
    <AdminShell
      title="Customer Messages"
      subtitle="Inbox from the public contact form"
      actions={
        <Link
          to="/admin/bookings"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-800 px-4 py-3 text-sm font-bold text-white"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back to Bookings
        </Link>
      }
    >
      {notice ? (
        <div className={`mb-5 rounded-xl px-4 py-3 font-semibold ${notice.variant === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="h-5 w-5 text-amber-600" aria-hidden />
            <h2 className="text-lg font-bold text-slate-900">Customer Messages</h2>
          </div>
          <p className="text-xs text-slate-500">
            Inbox from the public contact form (newest first). Mark as read when handled; deletes are
            permanent.
          </p>
        </div>

        <AdminResponsiveList
          desktop={
            <div className="max-h-[28rem] overflow-x-auto overflow-y-auto">
          {contactInboxLoading ? (
            <p className="px-4 py-6 text-sm text-slate-500">Loading messages…</p>
          ) : contactInbox.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No messages yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Message</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {contactInbox.map((row) => (
                  <tr
                    key={row.id}
                    className={`align-top hover:bg-slate-50 ${row.is_read ? '' : 'bg-amber-50/60'}`}
                  >
                    <td className="whitespace-nowrap px-4 py-2">
                      {row.is_read ? (
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          Read
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          New
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-900">{row.full_name}</td>
                    <td className="max-w-[200px] break-all px-4 py-2 text-slate-700">
                      <a href={`mailto:${row.email}`} className="font-semibold text-amber-700 hover:text-amber-800">
                        {row.email}
                      </a>
                    </td>
                    <td className="max-w-md px-4 py-2 text-slate-700" title={row.message}>
                      {previewMessageBody(row.message)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {new Date(row.created_at).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
                        <button
                          type="button"
                          onClick={() => openContactReply(row)}
                          className="inline-flex items-center justify-center rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100"
                        >
                          Reply
                        </button>
                        {!row.is_read ? (
                          <button
                            type="button"
                            onClick={() => void handleMarkContactMessageRead(row.id, true)}
                            className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50"
                          >
                            Mark read
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleMarkContactMessageRead(row.id, false)}
                            className="inline-flex items-center justify-center rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                          >
                            Mark unread
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDeleteContactMessage(row.id)}
                          className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 transition-colors hover:bg-red-100"
                          title="Delete message"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
            </div>
          }
          mobile={
            <div className="max-h-[28rem] space-y-3 overflow-y-auto p-3">
              {contactInboxLoading ? (
                <p className="py-6 text-center text-sm text-slate-500">Loading messages…</p>
              ) : contactInbox.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No messages yet.</p>
              ) : (
                contactInbox.map((row) => (
                  <MobileAdminCard
                    key={`ci-m-${row.id}`}
                    className={row.is_read ? undefined : 'border-amber-300 bg-amber-50/40'}
                    title={row.full_name}
                    subtitle={row.email}
                    badge={
                      <StatusBadge tone={row.is_read ? 'neutral' : 'warning'}>
                        {row.is_read ? 'Read' : 'New'}
                      </StatusBadge>
                    }
                    fields={[
                      { label: 'Message', value: previewMessageBody(row.message) },
                      {
                        label: 'Date',
                        value: new Date(row.created_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      },
                    ]}
                    actions={
                      <AdminActions>
                        <button
                          type="button"
                          onClick={() => openContactReply(row)}
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"
                        >
                          Reply
                        </button>
                        {!row.is_read ? (
                          <button
                            type="button"
                            onClick={() => void handleMarkContactMessageRead(row.id, true)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
                          >
                            Mark read
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleMarkContactMessageRead(row.id, false)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600"
                          >
                            Mark unread
                          </button>
                        )}
                        <a
                          href={`mailto:${row.email}`}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-sm font-semibold text-amber-800"
                        >
                          Email
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleDeleteContactMessage(row.id)}
                          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
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

      {contactReplyRow ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900">Reply to Customer</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Original message from {contactReplyRow.full_name || contactReplyRow.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => closeContactReply()}
                disabled={contactReplyBusy != null}
                className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">Customer Message</div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{contactReplyRow.message}</p>
            </div>

            {!contactReplyPreview ? (
              <div className="mt-5 space-y-4">
                <label className="block text-sm font-bold text-slate-700">
                  To
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900"
                    type="email"
                    value={contactReplyDraft.to}
                    onChange={(event) => setContactReplyDraft((prev) => ({ ...prev, to: event.target.value }))}
                  />
                </label>
                <label className="block text-sm font-bold text-slate-700">
                  Subject
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900"
                    value={contactReplyDraft.subject}
                    onChange={(event) => setContactReplyDraft((prev) => ({ ...prev, subject: event.target.value }))}
                  />
                </label>
                <label className="block text-sm font-bold text-slate-700">
                  Message
                  <textarea
                    className="mt-1 min-h-[240px] w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900"
                    value={contactReplyDraft.message}
                    onChange={(event) => setContactReplyDraft((prev) => ({ ...prev, message: event.target.value }))}
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void previewContactReply()}
                    disabled={contactReplyBusy != null}
                    className="rounded-xl bg-slate-900 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
                  >
                    {contactReplyBusy === 'preview' ? 'Previewing...' : 'Preview Reply'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void previewContactReply()}
                    disabled={contactReplyBusy != null}
                    className="rounded-xl bg-green-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
                  >
                    Send Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => setContactReplyDraft({ to: contactReplyRow.email, subject: '', message: '' })}
                    disabled={contactReplyBusy != null}
                    className="rounded-xl border border-slate-300 px-5 py-4 text-lg font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-xs font-semibold text-slate-500">
                  Send Reply opens preview first. Nothing sends until you confirm.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">From</div>
                  <p className="mt-1 font-semibold text-slate-900">{contactReplyPreview.from}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">To</div>
                  <p className="mt-1 font-semibold text-slate-900">{contactReplyPreview.to}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">Subject</div>
                  <p className="mt-1 font-semibold text-slate-900">{contactReplyPreview.subject}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-black uppercase tracking-wide text-slate-500">Message</div>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-4 text-sm text-slate-900">
                    {contactReplyPreview.message}
                  </pre>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setContactReplyPreview(null)}
                    disabled={contactReplyBusy === 'send'}
                    className="rounded-xl border border-slate-300 px-5 py-4 text-lg font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => closeContactReply()}
                    disabled={contactReplyBusy === 'send'}
                    className="rounded-xl border border-slate-300 px-5 py-4 text-lg font-black text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void sendContactReply()}
                    disabled={contactReplyBusy === 'send'}
                    className="rounded-xl bg-green-700 px-5 py-4 text-lg font-black text-white disabled:opacity-50"
                  >
                    {contactReplyBusy === 'send' ? 'Sending...' : 'Send Reply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
