import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { logSupabaseError } from '../lib/supabaseErrors';
import { useAuth } from '../contexts/useAuth';
import FullPageLoader from '../components/FullPageLoader';
import AdminShell from '../components/admin/AdminShell';
import AdminAccessDenied from '../components/admin/AdminAccessDenied';

interface AdminBoatsProps {
  onNavigate: (page: string) => void;
}

type BoatType = 'standard' | 'premium';

type BoatRow = {
  id: string;
  name: string;
  type: BoatType;
  capacity: number;
  description: string | null;
  image_url: string | null;
  hourly_rate: number;
  half_day_rate: number;
  full_day_rate: number;
  is_active: boolean;
};

/**
 * Object path within the `boats` storage bucket from a public object URL.
 * Returns null if the URL is not a Supabase public file for this bucket.
 */
function boatsStorageObjectPath(imageUrl: string | null | undefined): string | null {
  if (!imageUrl?.trim()) return null;
  try {
    const u = new URL(imageUrl);
    const prefix = '/storage/v1/object/public/boats/';
    const i = u.pathname.indexOf(prefix);
    if (i === -1) return null;
    const path = u.pathname.slice(i + prefix.length);
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

/** Derive half/full-day rates from hourly using the same ratios as seed data (~3.17x / ~5.83x). */
function ratesFromHourly(hourly: number, boatType: BoatType): { half: number; full: number } {
  const multHalf = boatType === 'premium' ? 480 / 150 : 380 / 120;
  const multFull = boatType === 'premium' ? 900 / 150 : 700 / 120;
  return {
    half: Math.round(hourly * multHalf * 100) / 100,
    full: Math.round(hourly * multFull * 100) / 100,
  };
}

export default function AdminBoats(_props: AdminBoatsProps) {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capacity, setCapacity] = useState('');
  const [price, setPrice] = useState('');
  const [boatType, setBoatType] = useState<BoatType>('standard');
  const [file, setFile] = useState<File | null>(null);
  const [editingBoat, setEditingBoat] = useState<BoatRow | null>(null);
  const [boats, setBoats] = useState<BoatRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingBoatId, setDeletingBoatId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fetchBoats = useCallback(async (opts?: { silent?: boolean }) => {
    if (!isAdmin) return;
    if (!opts?.silent) {
      setListLoading(true);
    }
    try {
      const { data, error } = await supabase.from('boats').select('*').order('created_at', { ascending: false });
      if (error) {
        logSupabaseError('AdminBoats.fetchBoats', error);
        // Silent refetch must not wipe the list on transient errors (would make a deleted boat "reappear").
        if (!opts?.silent) {
          setBoats([]);
        }
        return;
      }
      setBoats((data as BoatRow[] | null) ?? []);
    } finally {
      if (!opts?.silent) {
        setListLoading(false);
      }
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    void fetchBoats();
  }, [isAdmin, fetchBoats]);

  useEffect(() => {
    if (editingBoat) {
      setName(editingBoat.name);
      setDescription(editingBoat.description ?? '');
      setCapacity(String(editingBoat.capacity));
      setPrice(String(editingBoat.hourly_rate));
      setBoatType(editingBoat.type);
      setFile(null);
    }
  }, [editingBoat]);

  const clearForm = () => {
    setEditingBoat(null);
    setName('');
    setDescription('');
    setCapacity('');
    setPrice('');
    setBoatType('standard');
    setFile(null);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this boat?')) return;
    const trimmedId = id.trim();
    if (!trimmedId) {
      console.error('[AdminBoats.delete] missing boat id');
      return;
    }

    const boat = boats.find((b) => b.id === trimmedId);
    const imageUrl = boat?.image_url ?? null;

    setMessage(null);
    setDeletingBoatId(trimmedId);

    try {
      const { data, error } = await supabase.from('boats').delete().eq('id', trimmedId).select('id');

      if (error) {
        logSupabaseError('AdminBoats.delete', error);
        console.error('[AdminBoats.delete] database error', {
          id: trimmedId,
          code: error.code,
          message: error.message,
          details: error.details,
        });
        const fkBlocked = String(error.code || '') === '23503';
        if (fkBlocked) {
          const { error: archiveErr } = await supabase
            .from('boats')
            .update({ is_active: false })
            .eq('id', trimmedId);
          logSupabaseError('AdminBoats.archiveOnDeleteFallback', archiveErr);
          if (!archiveErr) {
            setMessage({
              type: 'ok',
              text: 'Boat has existing bookings and was archived (set inactive) instead of deleted.',
            });
            setBoats((prev) =>
              prev.map((b) => (b.id === trimmedId ? { ...b, is_active: false } : b))
            );
            window.alert('Boat has existing bookings, so it was archived instead of deleted.');
            return;
          }
        }

        const userMsg =
          error.message ||
          'Could not delete this boat. It may still be referenced by bookings, or your admin RLS policy may be blocking delete.';
        setMessage({ type: 'err', text: userMsg });
        window.alert(userMsg);
        return;
      }

      const deleted = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
      if (!deleted.length) {
        console.error('[AdminBoats.delete] 0 rows deleted — RLS denied delete or invalid id', {
          id: trimmedId,
        });
        setMessage({
          type: 'err',
          text:
            'Delete did not remove any row. Ensure you are signed in as an admin with permission to delete boats.',
        });
        window.alert(
          'Delete was blocked. Ensure your account is in the admins table and the latest RLS migrations are applied.'
        );
        return;
      }

      console.info('[AdminBoats.delete] row deleted', { id: trimmedId });

      const objectPath = boatsStorageObjectPath(imageUrl);
      if (objectPath) {
        const { error: storageError } = await supabase.storage.from('boats').remove([objectPath]);
        if (storageError) {
          logSupabaseError('AdminBoats.deleteStorage', storageError);
          console.warn('[AdminBoats.delete] storage object not removed (row already deleted)', {
            id: trimmedId,
            objectPath,
            message: storageError.message,
          });
        } else {
          console.info('[AdminBoats.delete] storage object removed', { objectPath });
        }
      }

      setBoats((prev) => prev.filter((b) => b.id !== trimmedId));
      if (editingBoat?.id === trimmedId) {
        clearForm();
      }

      await fetchBoats({ silent: true });
    } finally {
      setDeletingBoatId(null);
    }
  };

  const handleUpdate = async () => {
    if (!editingBoat) return;
    setMessage(null);

    const n = name.trim();
    if (!n) {
      window.alert('Enter a boat name.');
      return;
    }
    const cap = parseInt(capacity, 10);
    if (Number.isNaN(cap) || cap < 1) {
      window.alert('Enter a valid capacity (number of passengers).');
      return;
    }
    const hourly = parseFloat(price);
    if (Number.isNaN(hourly) || hourly <= 0) {
      window.alert('Enter a valid hourly price.');
      return;
    }

    setSaving(true);
    let imageUrl: string | null = editingBoat.image_url;

    if (file) {
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('boats').upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });
      if (uploadError) {
        logSupabaseError('AdminBoats.storageUploadUpdate', uploadError);
        setSaving(false);
        setMessage({
          type: 'err',
          text: uploadError.message || 'Image upload failed.',
        });
        return;
      }
      const {
        data: { publicUrl },
      } = supabase.storage.from('boats').getPublicUrl(fileName);
      imageUrl = publicUrl;
    }

    const { half, full } = ratesFromHourly(hourly, boatType);

    const { error } = await supabase
      .from('boats')
      .update({
        name: n,
        description: description.trim() || null,
        capacity: cap,
        type: boatType,
        hourly_rate: hourly,
        half_day_rate: half,
        full_day_rate: full,
        image_url: imageUrl,
      })
      .eq('id', editingBoat.id);

    if (error) {
      logSupabaseError('AdminBoats.update', error);
      setSaving(false);
      setMessage({ type: 'err', text: error.message || 'Could not update boat.' });
      return;
    }

    setSaving(false);
    window.alert('Updated!');
    clearForm();
    void fetchBoats();
  };

  const handleUpload = async () => {
    setMessage(null);
    if (!file) {
      window.alert('Please choose a boat image to upload.');
      return;
    }
    const n = name.trim();
    if (!n) {
      window.alert('Enter a boat name.');
      return;
    }
    const cap = parseInt(capacity, 10);
    if (Number.isNaN(cap) || cap < 1) {
      window.alert('Enter a valid capacity (number of passengers).');
      return;
    }
    const hourly = parseFloat(price);
    if (Number.isNaN(hourly) || hourly <= 0) {
      window.alert('Enter a valid hourly price.');
      return;
    }

    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    setSaving(true);

    const { error: uploadError } = await supabase.storage.from('boats').upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });

    if (uploadError) {
      logSupabaseError('AdminBoats.storageUpload', uploadError);
      setSaving(false);
      setMessage({
        type: 'err',
        text: uploadError.message || 'Image upload failed. Ensure the "boats" storage bucket exists and policies allow admin uploads.',
      });
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('boats').getPublicUrl(fileName);

    const { half, full } = ratesFromHourly(hourly, boatType);

    const { error: insertError } = await supabase.from('boats').insert([
      {
        name: n,
        description: description.trim() || null,
        capacity: cap,
        type: boatType,
        hourly_rate: hourly,
        half_day_rate: half,
        full_day_rate: full,
        image_url: publicUrl,
        is_active: true,
      },
    ]);

    if (insertError) {
      logSupabaseError('AdminBoats.insert', insertError);
      setSaving(false);
      setMessage({ type: 'err', text: insertError.message || 'Could not save boat.' });
      return;
    }

    setSaving(false);
    window.alert('Boat added!');
    clearForm();
    void fetchBoats();
  };

  const handleSubmit = () => {
    if (editingBoat) {
      void handleUpdate();
    } else {
      void handleUpload();
    }
  };

  if (authLoading) {
    return <FullPageLoader message="Checking admin access…" />;
  }

  if (!isAdmin) {
    return (
      <AdminAccessDenied
        signedIn={Boolean(user)}
        message={
          user
            ? 'This account is not authorized to manage boats.'
            : 'Sign in with an administrator account.'
        }
      />
    );
  }

  return (
    <AdminShell
      title="Manage boats"
      subtitle="Upload images and add vessels to Supabase"
      maxWidth="5xl"
    >
        {message && (
          <div
            className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${
              message.type === 'ok' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
            }`}
          >
            {message.text}
          </div>
        )}

        <section className="mb-12 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              {editingBoat ? 'Edit boat' : 'Add boat'}
            </h2>
            {editingBoat && (
              <button
                type="button"
                onClick={() => clearForm()}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel edit
              </button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">Boat name</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                placeholder="Boat Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">Description</span>
              <textarea
                className="min-h-[100px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Capacity (passengers)</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                placeholder="Capacity"
                inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Hourly rate (USD)</span>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                placeholder="Price per hour"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">Type</span>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                value={boatType}
                onChange={(e) => setBoatType(e.target.value as BoatType)}
              >
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Boat image {editingBoat ? '(optional; leave empty to keep current)' : '(required for new boats)'}
              </span>
              <input
                key={editingBoat?.id ?? 'new-boat'}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-amber-600 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-amber-700"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSubmit()}
            className="mt-6 rounded-lg bg-amber-600 px-6 py-3 font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : editingBoat ? 'Update Boat' : 'Add Boat'}
          </button>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold text-slate-900">Existing boats</h2>
          {listLoading ? (
            <p className="text-slate-600">Loading…</p>
          ) : boats.length === 0 ? (
            <p className="text-slate-600">No boats in the database yet.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {boats.map((boat) => (
                <div
                  key={boat.id}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  {boat.image_url ? (
                    <img
                      src={boat.image_url}
                      alt=""
                      width={400}
                      height={225}
                      className="h-44 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-44 items-center justify-center bg-slate-100 text-slate-400">
                      No image
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="font-bold text-slate-900">{boat.name}</h3>
                    <p className="text-sm text-slate-600">
                      {boat.capacity} people · {boat.type} · ${boat.hourly_rate}/hr
                    </p>
                    {!boat.is_active && (
                      <p className="mt-1 text-xs font-semibold text-amber-700">Inactive</p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingBoat(boat)}
                        className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={deletingBoatId !== null}
                        onClick={() => void handleDelete(boat.id)}
                        className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingBoatId === boat.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
    </AdminShell>
  );
}
