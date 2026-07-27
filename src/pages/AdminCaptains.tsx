import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';
import AdminResponsiveList from '../components/admin/AdminResponsiveList';
import MobileAdminCard from '../components/admin/MobileAdminCard';
import StatusBadge from '../components/admin/StatusBadge';
import type { AdminCaptainListItem } from '../lib/adminCaptains';
import { fetchAllCaptains } from '../lib/adminCaptains';

type BoatOption = { id: string; name: string };

type CaptainFormState = {
  fullName: string;
  phone: string;
  email: string;
  authUserId: string;
  defaultBoatId: string;
  notes: string;
  active: boolean;
};

const blankForm = (): CaptainFormState => ({
  fullName: '',
  phone: '',
  email: '',
  authUserId: '',
  defaultBoatId: '',
  notes: '',
  active: true,
});

function formFromCaptain(row: AdminCaptainListItem): CaptainFormState {
  return {
    fullName: row.full_name || '',
    phone: row.phone || '',
    email: row.email || '',
    authUserId: row.auth_user_id || '',
    defaultBoatId: row.default_boat_id || '',
    notes: row.notes || '',
    active: row.active !== false,
  };
}

export default function AdminCaptains() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [captains, setCaptains] = useState<AdminCaptainListItem[]>([]);
  const [boats, setBoats] = useState<BoatOption[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [form, setForm] = useState<CaptainFormState>(() => blankForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadCaptains = useCallback(async () => {
    if (!isAdmin) return;
    setListLoading(true);
    try {
      const rows = await fetchAllCaptains();
      setCaptains(rows);
    } catch (err) {
      logSupabaseError('AdminCaptains.loadCaptains', err);
      setCaptains([]);
      setMessage({ type: 'err', text: err instanceof Error ? err.message : 'Could not load captains.' });
    } finally {
      setListLoading(false);
    }
  }, [isAdmin]);

  const loadBoats = useCallback(async () => {
    if (!isAdmin) return;
    const { data, error } = await supabase.from('boats').select('id, name').eq('is_active', true).order('name');
    if (error) {
      logSupabaseError('AdminCaptains.loadBoats', error);
      return;
    }
    setBoats((data as BoatOption[] | null) ?? []);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadCaptains();
    void loadBoats();
  }, [isAdmin, loadBoats, loadCaptains]);

  const clearForm = () => {
    setEditingId(null);
    setForm(blankForm());
  };

  const startEdit = (row: AdminCaptainListItem) => {
    setEditingId(row.id);
    setForm(formFromCaptain(row));
    setMessage(null);
  };

  const saveCaptain = async () => {
    const fullName = form.fullName.trim();
    if (!fullName) {
      setMessage({ type: 'err', text: 'Full name is required.' });
      return;
    }

    const payload = {
      full_name: fullName,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      auth_user_id: form.authUserId.trim() || null,
      default_boat_id: form.defaultBoatId || null,
      notes: form.notes.trim() || null,
      active: form.active,
    };

    setSaving(true);
    setMessage(null);
    try {
      if (editingId) {
        const { error } = await supabase.from('captains').update(payload).eq('id', editingId);
        if (error) throw error;
        setMessage({ type: 'ok', text: 'Captain updated.' });
      } else {
        const { error } = await supabase.from('captains').insert(payload);
        if (error) throw error;
        setMessage({ type: 'ok', text: 'Captain added.' });
      }
      clearForm();
      await loadCaptains();
    } catch (err) {
      logSupabaseError('AdminCaptains.saveCaptain', err);
      setMessage({ type: 'err', text: err instanceof Error ? err.message : 'Could not save captain.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: AdminCaptainListItem) => {
    const nextActive = !row.active;
    const label = nextActive ? 'Re-enable' : 'Disable';
    if (!window.confirm(`${label} ${row.full_name}?`)) return;
    setBusyId(row.id);
    setMessage(null);
    try {
      const { error } = await supabase.from('captains').update({ active: nextActive }).eq('id', row.id);
      if (error) throw error;
      setMessage({ type: 'ok', text: nextActive ? 'Captain re-enabled.' : 'Captain disabled.' });
      if (editingId === row.id) {
        setForm((prev) => ({ ...prev, active: nextActive }));
      }
      await loadCaptains();
    } catch (err) {
      logSupabaseError('AdminCaptains.toggleActive', err);
      setMessage({ type: 'err', text: err instanceof Error ? err.message : 'Could not update captain.' });
    } finally {
      setBusyId(null);
    }
  };

  if (authLoading) return <FullPageLoader message="Checking admin access…" />;
  if (!isAdmin) return <AdminAccessDenied signedIn={Boolean(user)} />;

  return (
    <AdminShell
      title="Captains"
      subtitle="Crew portal access — distinct from Captain's Log articles"
      maxWidth="5xl"
    >
      <p className="mb-4 text-base text-slate-600">
        <Link to="/admin/more" className="font-bold text-amber-800 underline">
          Back to More Tools
        </Link>
      </p>

      {message ? (
        <div
          className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${
            message.type === 'ok' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <section className="mb-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold text-slate-900">{editingId ? 'Edit captain' : 'Add captain'}</h2>
          {editingId ? (
            <button
              type="button"
              onClick={clearForm}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel edit
            </button>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">Full name *</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              value={form.fullName}
              onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Phone</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">Supabase auth user ID</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900"
              placeholder="Optional — links this captain to a login"
              value={form.authUserId}
              onChange={(e) => setForm((p) => ({ ...p, authUserId: e.target.value }))}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Same user may also be an admin. They sign in at /captain-login with this auth account.
            </span>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">Default boat</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              value={form.defaultBoatId}
              onChange={(e) => setForm((p) => ({ ...p, defaultBoatId: e.target.value }))}
            >
              <option value="">None</option>
              {boats.map((boat) => (
                <option key={boat.id} value={boat.id}>
                  {boat.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">Notes</span>
            <textarea
              className="min-h-[90px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-3 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
              className="h-5 w-5"
            />
            <span className="text-sm font-medium text-slate-700">Active (can sign in to captain portal)</span>
          </label>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveCaptain()}
          className="mt-6 rounded-lg bg-amber-600 px-6 py-3 font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : editingId ? 'Update captain' : 'Add captain'}
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">All captains</h2>
            <p className="text-sm text-slate-500">Assign these on captain charter bookings.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadCaptains()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
        {listLoading ? (
          <p className="px-5 py-8 text-center text-slate-500">Loading captains…</p>
        ) : captains.length === 0 ? (
          <p className="px-5 py-8 text-center text-slate-500">No captains yet.</p>
        ) : (
          <AdminResponsiveList
            desktop={
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Contact</th>
                      <th className="px-5 py-3">Portal login</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {captains.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-5 py-4 font-semibold">{row.full_name}</td>
                        <td className="px-5 py-4 text-sm text-slate-700">
                          <div>{row.phone || '—'}</div>
                          <div>{row.email || '—'}</div>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-600">
                          {row.auth_user_id ? 'Linked' : 'Not linked'}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge tone={row.active ? 'success' : 'neutral'}>
                            {row.active ? 'Active' : 'Inactive'}
                          </StatusBadge>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void toggleActive(row)}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
                            >
                              {row.active ? 'Disable' : 'Enable'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
            mobile={captains.map((row) => (
              <MobileAdminCard key={row.id} title={row.full_name} subtitle={row.email || row.phone || 'No contact'}>
                <div className="mt-2 flex items-center gap-2">
                  <StatusBadge tone={row.active ? 'success' : 'neutral'}>
                    {row.active ? 'Active' : 'Inactive'}
                  </StatusBadge>
                  <span className="text-xs text-slate-500">{row.auth_user_id ? 'Login linked' : 'No login'}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void toggleActive(row)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-60"
                  >
                    {row.active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </MobileAdminCard>
            ))}
          />
        )}
      </section>
    </AdminShell>
  );
}
