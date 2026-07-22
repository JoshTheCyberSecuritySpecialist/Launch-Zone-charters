import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { logSupabaseError } from '../../lib/supabaseErrors';
import {
  type BoatCapacityProfileRow,
  type BoatVesselMetadata,
  capacityProfileReadyForVerification,
} from '../../lib/boatCapacityTypes';

type AdminBoatCapacityPanelProps = {
  boatId: string;
  boatName: string;
  vesselMetadata: BoatVesselMetadata;
  onMetadataChange: (patch: Partial<BoatVesselMetadata>) => void;
  onSaved?: () => void;
};

const emptyProfile = (boatId: string): BoatCapacityProfileRow => ({
  boat_id: boatId,
  registration_number: null,
  maximum_persons: null,
  maximum_persons_weight_lbs: null,
  maximum_total_load_lbs: null,
  operator_weight_lbs: null,
  standard_equipment_weight_lbs: 0,
  fuel_allowance_weight_lbs: 0,
  safety_buffer_lbs: 0,
  warning_threshold_percent: 85,
  capacity_plate_photo_path: null,
  capacity_source: null,
  capacity_verified: false,
  capacity_verified_at: null,
  capacity_verified_by: null,
  config_version: 1,
  created_at: '',
  updated_at: '',
});

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalDecimal(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseRequiredDecimal(value: string, fallback = 0): number {
  const n = parseOptionalDecimal(value);
  return n != null && n >= 0 ? n : fallback;
}

function statusBadge(profile: BoatCapacityProfileRow) {
  if (profile.capacity_verified) {
    return (
      <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-900">
        Verified · config v{profile.config_version}
      </span>
    );
  }
  if (capacityProfileReadyForVerification(profile)) {
    return (
      <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
        Ready to verify — plate values entered
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-800">
      Capacity data unverified
    </span>
  );
}

export default function AdminBoatCapacityPanel({
  boatId,
  boatName,
  vesselMetadata,
  onMetadataChange,
  onSaved,
}: AdminBoatCapacityPanelProps) {
  const [profile, setProfile] = useState<BoatCapacityProfileRow>(() => emptyProfile(boatId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [plateFile, setPlateFile] = useState<File | null>(null);
  const [platePreviewUrl, setPlatePreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('boat_capacity_profiles')
        .select('*')
        .eq('boat_id', boatId)
        .maybeSingle();

      if (error) {
        logSupabaseError('AdminBoatCapacityPanel.loadProfile', error);
        setMessage({ type: 'err', text: error.message || 'Could not load capacity profile.' });
        return;
      }

      const row = (data as BoatCapacityProfileRow | null) ?? emptyProfile(boatId);
      setProfile(row);

      if (row.capacity_plate_photo_path) {
        const { data: signed, error: signErr } = await supabase.storage
          .from('documents')
          .createSignedUrl(row.capacity_plate_photo_path, 3600);
        if (!signErr && signed?.signedUrl) {
          setPlatePreviewUrl(signed.signedUrl);
        }
      } else {
        setPlatePreviewUrl(null);
      }
    } finally {
      setLoading(false);
    }
  }, [boatId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleSave = async () => {
    setMessage(null);
    setSaving(true);

    try {
      let photoPath = profile.capacity_plate_photo_path;

      if (plateFile) {
        const safeName = plateFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const objectPath = `capacity-plates/${boatId}/${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(objectPath, plateFile, { cacheControl: '3600', upsert: false });

        if (uploadErr) {
          logSupabaseError('AdminBoatCapacityPanel.plateUpload', uploadErr);
          setMessage({ type: 'err', text: uploadErr.message || 'Capacity plate photo upload failed.' });
          return;
        }
        photoPath = objectPath;
      }

      const { error: metaErr } = await supabase
        .from('boats')
        .update({
          year: vesselMetadata.year,
          manufacturer: vesselMetadata.manufacturer?.trim() || null,
          model: vesselMetadata.model?.trim() || null,
          length_feet: vesselMetadata.length_feet,
          engine_description: vesselMetadata.engine_description?.trim() || null,
        })
        .eq('id', boatId);

      if (metaErr) {
        logSupabaseError('AdminBoatCapacityPanel.vesselMetadata', metaErr);
        setMessage({ type: 'err', text: metaErr.message || 'Could not save vessel details.' });
        return;
      }

      const { error: profileErr } = await supabase.from('boat_capacity_profiles').upsert(
        {
          boat_id: boatId,
          registration_number: profile.registration_number?.trim() || null,
          maximum_persons: profile.maximum_persons,
          maximum_persons_weight_lbs: profile.maximum_persons_weight_lbs,
          maximum_total_load_lbs: profile.maximum_total_load_lbs,
          operator_weight_lbs: profile.operator_weight_lbs,
          standard_equipment_weight_lbs: profile.standard_equipment_weight_lbs,
          fuel_allowance_weight_lbs: profile.fuel_allowance_weight_lbs,
          safety_buffer_lbs: profile.safety_buffer_lbs,
          warning_threshold_percent: profile.warning_threshold_percent,
          capacity_plate_photo_path: photoPath,
          capacity_source: profile.capacity_source?.trim() || null,
          capacity_verified: profile.capacity_verified,
          capacity_verified_at: profile.capacity_verified ? profile.capacity_verified_at : null,
          capacity_verified_by: profile.capacity_verified ? profile.capacity_verified_by : null,
        },
        { onConflict: 'boat_id' }
      );

      if (profileErr) {
        logSupabaseError('AdminBoatCapacityPanel.saveProfile', profileErr);
        setMessage({ type: 'err', text: profileErr.message || 'Could not save capacity profile.' });
        return;
      }

      setPlateFile(null);
      setMessage({ type: 'ok', text: 'Boat capacity settings saved.' });
      await loadProfile();
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const handleMarkVerified = async () => {
    if (!capacityProfileReadyForVerification(profile)) {
      window.alert(
        'Enter maximum persons, persons weight, total load, and operator weight from the physical capacity plate before marking verified.'
      );
      return;
    }
    if (
      !window.confirm(
        `Mark capacity data verified for "${boatName}"?\n\nOnly verify values taken directly from the boat's capacity plate or manufacturer documentation.`
      )
    ) {
      return;
    }

    setMessage(null);
    setSaving(true);

    try {
      let photoPath = profile.capacity_plate_photo_path;

      if (plateFile) {
        const safeName = plateFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const objectPath = `capacity-plates/${boatId}/${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(objectPath, plateFile, { cacheControl: '3600', upsert: false });

        if (uploadErr) {
          logSupabaseError('AdminBoatCapacityPanel.plateUpload', uploadErr);
          setMessage({ type: 'err', text: uploadErr.message || 'Capacity plate photo upload failed.' });
          return;
        }
        photoPath = objectPath;
      }

      const { error: metaErr } = await supabase
        .from('boats')
        .update({
          year: vesselMetadata.year,
          manufacturer: vesselMetadata.manufacturer?.trim() || null,
          model: vesselMetadata.model?.trim() || null,
          length_feet: vesselMetadata.length_feet,
          engine_description: vesselMetadata.engine_description?.trim() || null,
        })
        .eq('id', boatId);

      if (metaErr) {
        logSupabaseError('AdminBoatCapacityPanel.vesselMetadata', metaErr);
        setMessage({ type: 'err', text: metaErr.message || 'Could not save vessel details.' });
        return;
      }

      const now = new Date().toISOString();
      const { data: sessionData } = await supabase.auth.getSession();
      const adminId = sessionData.session?.user?.id ?? null;

      const { error } = await supabase.from('boat_capacity_profiles').upsert(
        {
          boat_id: boatId,
          registration_number: profile.registration_number?.trim() || null,
          maximum_persons: profile.maximum_persons,
          maximum_persons_weight_lbs: profile.maximum_persons_weight_lbs,
          maximum_total_load_lbs: profile.maximum_total_load_lbs,
          operator_weight_lbs: profile.operator_weight_lbs,
          standard_equipment_weight_lbs: profile.standard_equipment_weight_lbs,
          fuel_allowance_weight_lbs: profile.fuel_allowance_weight_lbs,
          safety_buffer_lbs: profile.safety_buffer_lbs,
          warning_threshold_percent: profile.warning_threshold_percent,
          capacity_plate_photo_path: photoPath,
          capacity_source: profile.capacity_source?.trim() || null,
          capacity_verified: true,
          capacity_verified_at: now,
          capacity_verified_by: adminId,
        },
        { onConflict: 'boat_id' }
      );

      if (error) {
        logSupabaseError('AdminBoatCapacityPanel.markVerified', error);
        setMessage({ type: 'err', text: error.message || 'Could not mark capacity verified.' });
        return;
      }

      setPlateFile(null);
      setMessage({
        type: 'ok',
        text: 'Capacity saved and marked verified. Public calculator can use this boat once Phase 3 is deployed.',
      });
      await loadProfile();
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const handleUnverify = async () => {
    if (!window.confirm('Remove verified status? The public calculator will block this boat until re-verified.')) {
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('boat_capacity_profiles')
        .update({
          capacity_verified: false,
          capacity_verified_at: null,
          capacity_verified_by: null,
        })
        .eq('boat_id', boatId);

      if (error) {
        logSupabaseError('AdminBoatCapacityPanel.unverify', error);
        setMessage({ type: 'err', text: error.message || 'Could not update verification status.' });
        return;
      }

      await loadProfile();
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-600">Loading capacity profile…</p>;
  }

  return (
    <div className="mt-8 border-t border-slate-200 pt-8">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Boat capacity &amp; safety</h3>
          <p className="mt-1 text-sm text-slate-600">
            Enter values from the physical capacity plate only. Do not guess weight limits.
          </p>
        </div>
        {statusBadge(profile)}
      </div>

      {message && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm font-medium ${
            message.type === 'ok' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Year</span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="numeric"
            value={vesselMetadata.year ?? ''}
            onChange={(e) =>
              onMetadataChange({ year: parseOptionalInt(e.target.value) })
            }
            placeholder="e.g. 2024"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Length (feet)</span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="decimal"
            value={vesselMetadata.length_feet ?? ''}
            onChange={(e) =>
              onMetadataChange({ length_feet: parseOptionalDecimal(e.target.value) })
            }
            placeholder="e.g. 18"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Manufacturer</span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            value={vesselMetadata.manufacturer ?? ''}
            onChange={(e) => onMetadataChange({ manufacturer: e.target.value })}
            placeholder="e.g. Key Largo, SunCatcher"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Model</span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            value={vesselMetadata.model ?? ''}
            onChange={(e) => onMetadataChange({ model: e.target.value })}
            placeholder="From registration or manufacturer docs"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">Engine</span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            value={vesselMetadata.engine_description ?? ''}
            onChange={(e) => onMetadataChange({ engine_description: e.target.value })}
            placeholder="e.g. Yamaha 115 HP"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Registration number (admin only)
          </span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            value={profile.registration_number ?? ''}
            onChange={(e) =>
              setProfile((prev) => ({ ...prev, registration_number: e.target.value }))
            }
            placeholder="e.g. FL3827TT"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Max persons (capacity plate)
          </span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="numeric"
            value={profile.maximum_persons ?? ''}
            onChange={(e) =>
              setProfile((prev) => ({
                ...prev,
                maximum_persons: parseOptionalInt(e.target.value),
              }))
            }
            placeholder="From plate"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Max persons weight (lbs)
          </span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="decimal"
            value={profile.maximum_persons_weight_lbs ?? ''}
            onChange={(e) =>
              setProfile((prev) => ({
                ...prev,
                maximum_persons_weight_lbs: parseOptionalDecimal(e.target.value),
              }))
            }
            placeholder="From plate"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Max total load (lbs)
          </span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="decimal"
            value={profile.maximum_total_load_lbs ?? ''}
            onChange={(e) =>
              setProfile((prev) => ({
                ...prev,
                maximum_total_load_lbs: parseOptionalDecimal(e.target.value),
              }))
            }
            placeholder="From plate — do not estimate"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Captain / operator weight (lbs)
          </span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="decimal"
            value={profile.operator_weight_lbs ?? ''}
            onChange={(e) =>
              setProfile((prev) => ({
                ...prev,
                operator_weight_lbs: parseOptionalDecimal(e.target.value),
              }))
            }
            placeholder="Included in persons weight calc"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Standard equipment allowance (lbs)
          </span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="decimal"
            value={profile.standard_equipment_weight_lbs}
            onChange={(e) =>
              setProfile((prev) => ({
                ...prev,
                standard_equipment_weight_lbs: parseRequiredDecimal(e.target.value),
              }))
            }
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Fuel allowance (lbs)</span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="decimal"
            value={profile.fuel_allowance_weight_lbs}
            onChange={(e) =>
              setProfile((prev) => ({
                ...prev,
                fuel_allowance_weight_lbs: parseRequiredDecimal(e.target.value),
              }))
            }
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Safety buffer (lbs)</span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="decimal"
            value={profile.safety_buffer_lbs}
            onChange={(e) =>
              setProfile((prev) => ({
                ...prev,
                safety_buffer_lbs: parseRequiredDecimal(e.target.value),
              }))
            }
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            Yellow warning threshold (% of operational limit)
          </span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            inputMode="decimal"
            value={profile.warning_threshold_percent}
            onChange={(e) => {
              const n = parseOptionalDecimal(e.target.value);
              setProfile((prev) => ({
                ...prev,
                warning_threshold_percent: n != null && n > 0 && n <= 100 ? n : prev.warning_threshold_percent,
              }));
            }}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">Capacity source</span>
          <input
            className="min-h-[48px] w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
            value={profile.capacity_source ?? ''}
            onChange={(e) =>
              setProfile((prev) => ({ ...prev, capacity_source: e.target.value }))
            }
            placeholder="e.g. USCG capacity plate photo dated …"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-slate-700">Capacity plate photo</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="w-full text-sm text-slate-600 file:mr-4 file:min-h-[48px] file:rounded-lg file:border-0 file:bg-amber-600 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-amber-700"
            onChange={(e) => setPlateFile(e.target.files?.[0] ?? null)}
          />
          {platePreviewUrl && (
            <a
              href={platePreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-semibold text-amber-700 underline"
            >
              View current plate photo
            </a>
          )}
        </label>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="min-h-[48px] rounded-lg bg-amber-600 px-6 py-3 font-bold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save capacity settings'}
        </button>
        {!profile.capacity_verified ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleMarkVerified()}
            className="min-h-[48px] rounded-lg border border-green-600 bg-white px-6 py-3 font-bold text-green-800 hover:bg-green-50 disabled:opacity-60"
          >
            Mark capacity verified
          </button>
        ) : (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleUnverify()}
            className="min-h-[48px] rounded-lg border border-slate-400 bg-white px-6 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Remove verification
          </button>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Marketing capacity ({boatName} listing) stays separate from plate limits. Public safety
        calculator (Phase 3) will stay blocked until this profile is verified.
      </p>
    </div>
  );
}
