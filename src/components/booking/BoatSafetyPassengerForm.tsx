import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { LIFE_JACKET_SIZES, type PassengerType } from '../../lib/boatCapacityTypes';
import type { PublicCapacityCheckResult } from '../../lib/publicBooking';
import { WI_BODY, WI_FIELD, WI_HINT, WI_LABEL, WI_PRIMARY_BTN } from '../../lib/waiversSeniorUi';

export type PassengerFormRow = {
  passenger_name: string;
  passenger_type: PassengerType;
  weight_lbs: string;
  life_jacket_size: string;
  mobility_assistance_required: boolean;
  mobility_notes: string;
};

export type CapacityLoadForm = {
  cooler_weight_lbs: string;
  personal_gear_weight_lbs: string;
  other_equipment_weight_lbs: string;
  other_equipment_description: string;
};

export type CapacityFormPayload = {
  expectedPassengerCount: number;
  passengers: Array<{
    passenger_name: string;
    passenger_type: PassengerType;
    weight_lbs: number;
    life_jacket_size: string;
    mobility_assistance_required: boolean;
    mobility_notes?: string;
  }>;
  load: {
    cooler_weight_lbs: number;
    personal_gear_weight_lbs: number;
    other_equipment_weight_lbs: number;
    other_equipment_description?: string;
  };
  customerConfirmed: boolean;
};

type BoatSafetyPassengerFormProps = {
  boatLabel: string;
  captainIncluded: boolean;
  suggestedPassengerCount?: number | null;
  disabled?: boolean;
  completedResult?: PublicCapacityCheckResult | null;
  onSubmit: (payload: CapacityFormPayload) => Promise<PublicCapacityCheckResult>;
  onSuccess?: (result: PublicCapacityCheckResult) => void;
  idPrefix?: string;
};

function emptyPassenger(): PassengerFormRow {
  return {
    passenger_name: '',
    passenger_type: 'adult',
    weight_lbs: '',
    life_jacket_size: 'Adult medium',
    mobility_assistance_required: false,
    mobility_notes: '',
  };
}

function statusPanelClass(status: PublicCapacityCheckResult['status']): string {
  switch (status) {
    case 'within_operating_range':
      return 'border-emerald-400/35 bg-emerald-950/30 text-emerald-50';
    case 'captain_review_required':
      return 'border-amber-400/35 bg-amber-950/35 text-amber-50';
    case 'capacity_exceeded':
    case 'capacity_unverified':
      return 'border-red-400/35 bg-red-950/35 text-red-50';
    default:
      return 'border-white/15 bg-slate-950/40 text-slate-100';
  }
}

export default function BoatSafetyPassengerForm({
  boatLabel,
  captainIncluded,
  suggestedPassengerCount,
  disabled = false,
  completedResult,
  onSubmit,
  onSuccess,
  idPrefix = 'cap-',
}: BoatSafetyPassengerFormProps) {
  const initialCount = Math.max(1, suggestedPassengerCount ?? 1);
  const [passengerCount, setPassengerCount] = useState(String(initialCount));
  const [passengers, setPassengers] = useState<PassengerFormRow[]>(() =>
    Array.from({ length: initialCount }, () => emptyPassenger())
  );
  const [load, setLoad] = useState<CapacityLoadForm>({
    cooler_weight_lbs: '',
    personal_gear_weight_lbs: '',
    other_equipment_weight_lbs: '',
    other_equipment_description: '',
  });
  const [accuracyConfirmed, setAccuracyConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicCapacityCheckResult | null>(completedResult ?? null);

  useEffect(() => {
    if (completedResult) setResult(completedResult);
  }, [completedResult]);

  const countNum = useMemo(() => {
    const n = parseInt(passengerCount, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [passengerCount]);

  useEffect(() => {
    if (countNum <= 0) return;
    setPassengers((prev) => {
      if (prev.length === countNum) return prev;
      if (prev.length < countNum) {
        return [...prev, ...Array.from({ length: countNum - prev.length }, () => emptyPassenger())];
      }
      return prev.slice(0, countNum);
    });
  }, [countNum]);

  const updatePassenger = (index: number, patch: Partial<PassengerFormRow>) => {
    setPassengers((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const buildPayload = (): CapacityFormPayload | { error: string } => {
    if (countNum < 1) return { error: 'Enter how many passengers are in your group.' };
    if (passengers.length !== countNum) {
      return { error: 'Passenger count must match the number of passenger records entered.' };
    }

    const parsedPassengers = [];
    for (let i = 0; i < passengers.length; i += 1) {
      const row = passengers[i];
      const name = row.passenger_name.trim();
      const weight = parseFloat(row.weight_lbs);
      if (!name) return { error: `Enter a name for passenger ${i + 1}.` };
      if (!Number.isFinite(weight) || weight <= 0) {
        return { error: `Enter a valid weight in pounds for passenger ${i + 1}.` };
      }
      parsedPassengers.push({
        passenger_name: name,
        passenger_type: row.passenger_type,
        weight_lbs: weight,
        life_jacket_size: row.life_jacket_size,
        mobility_assistance_required: row.mobility_assistance_required,
        mobility_notes: row.mobility_notes.trim() || undefined,
      });
    }

    const parseLoad = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return 0;
      const n = parseFloat(trimmed);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    return {
      expectedPassengerCount: countNum,
      passengers: parsedPassengers,
      load: {
        cooler_weight_lbs: parseLoad(load.cooler_weight_lbs),
        personal_gear_weight_lbs: parseLoad(load.personal_gear_weight_lbs),
        other_equipment_weight_lbs: parseLoad(load.other_equipment_weight_lbs),
        other_equipment_description: load.other_equipment_description.trim() || undefined,
      },
      customerConfirmed: accuracyConfirmed,
    };
  };

  const handleSubmit = async () => {
    setError(null);
    const payload = buildPayload();
    if ('error' in payload) {
      setError(payload.error);
      return;
    }
    if (!payload.customerConfirmed) {
      setError('Please confirm that the passenger and equipment information is accurate.');
      return;
    }

    setBusy(true);
    try {
      const out = await onSubmit(payload);
      setResult(out);
      if (!out.canProceed && out.status === 'capacity_exceeded') {
        setError(out.message);
      } else {
        setError(null);
        if (out.canProceed) onSuccess?.(out);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save passenger information.');
    } finally {
      setBusy(false);
    }
  };

  const showForm =
    !result ||
    (!result.canProceed &&
      result.status !== 'capacity_exceeded' &&
      result.status !== 'capacity_unverified');

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-white">Boat Safety and Passenger Information</h3>
        <p className={`${WI_BODY} mt-2`}>
          To help us safely assign your boat and required safety equipment, please provide accurate
          information for every passenger. This information is used for vessel capacity and safety
          planning only.
        </p>
        <p className={`${WI_HINT} mt-2`}>
          Assigned boat: <span className="font-semibold text-white">{boatLabel}</span>
          {captainIncluded ? ' · Captain included (+1 aboard)' : ''}
        </p>
      </div>

      {result ? (
        <div className={`rounded-xl border px-4 py-4 text-lg leading-relaxed ${statusPanelClass(result.status)}`} role="status">
          {result.message}
          {result.status === 'captain_review_required' ? (
            <p className="mt-2 text-base opacity-90">
              You may continue with waiver and documents. Our captain will review before departure.
            </p>
          ) : null}
        </div>
      ) : null}

      {showForm && !disabled ? (
        <>
          <div>
            <label htmlFor={`${idPrefix}count`} className={WI_LABEL}>
              Number of passengers in your group
            </label>
            <input
              id={`${idPrefix}count`}
              type="number"
              min={1}
              inputMode="numeric"
              className={WI_FIELD}
              value={passengerCount}
              onChange={(e) => setPassengerCount(e.target.value)}
            />
            {suggestedPassengerCount != null ? (
              <p className={WI_HINT}>Your booking lists {suggestedPassengerCount} guest(s).</p>
            ) : null}
          </div>

          <div className="space-y-5">
            {passengers.map((row, index) => (
              <div
                key={index}
                className="rounded-xl border border-white/10 bg-slate-950/35 p-4 md:p-5"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h4 className="text-lg font-bold text-white">Passenger {index + 1}</h4>
                  {passengers.length > 1 ? (
                    <button
                      type="button"
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-base font-semibold text-slate-300 hover:text-white"
                      onClick={() => {
                        setPassengers((prev) => prev.filter((_, i) => i !== index));
                        setPassengerCount(String(Math.max(1, passengers.length - 1)));
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label htmlFor={`${idPrefix}name-${index}`} className={WI_LABEL}>
                      Passenger name
                    </label>
                    <input
                      id={`${idPrefix}name-${index}`}
                      className={WI_FIELD}
                      value={row.passenger_name}
                      onChange={(e) => updatePassenger(index, { passenger_name: e.target.value })}
                      autoComplete="name"
                    />
                  </div>
                  <div>
                    <label htmlFor={`${idPrefix}type-${index}`} className={WI_LABEL}>
                      Adult, child, or infant
                    </label>
                    <select
                      id={`${idPrefix}type-${index}`}
                      className={WI_FIELD}
                      value={row.passenger_type}
                      onChange={(e) =>
                        updatePassenger(index, { passenger_type: e.target.value as PassengerType })
                      }
                    >
                      <option value="adult">Adult</option>
                      <option value="child">Child</option>
                      <option value="infant">Infant</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor={`${idPrefix}weight-${index}`} className={WI_LABEL}>
                      Weight (pounds)
                    </label>
                    <input
                      id={`${idPrefix}weight-${index}`}
                      className={WI_FIELD}
                      inputMode="decimal"
                      value={row.weight_lbs}
                      onChange={(e) => updatePassenger(index, { weight_lbs: e.target.value })}
                      aria-describedby={`${idPrefix}weight-hint-${index}`}
                    />
                    <p id={`${idPrefix}weight-hint-${index}`} className={WI_HINT}>
                      Used for vessel safety and life-jacket preparation only.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label htmlFor={`${idPrefix}jacket-${index}`} className={WI_LABEL}>
                      Life-jacket size
                    </label>
                    <select
                      id={`${idPrefix}jacket-${index}`}
                      className={WI_FIELD}
                      value={row.life_jacket_size}
                      onChange={(e) => updatePassenger(index, { life_jacket_size: e.target.value })}
                    >
                      {LIFE_JACKET_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="flex min-h-12 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1.5 h-5 w-5 rounded border-white/30"
                        checked={row.mobility_assistance_required}
                        onChange={(e) =>
                          updatePassenger(index, { mobility_assistance_required: e.target.checked })
                        }
                      />
                      <span className={`${WI_BODY} !text-base`}>
                        Mobility assistance needed for boarding or seating
                      </span>
                    </label>
                    {row.mobility_assistance_required ? (
                      <textarea
                        className={`${WI_FIELD} mt-3 min-h-[96px]`}
                        placeholder="Optional notes for the captain (boarding, seating, etc.)"
                        value={row.mobility_notes}
                        onChange={(e) => updatePassenger(index, { mobility_notes: e.target.value })}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {passengers.length < 12 ? (
            <button
              type="button"
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/20 px-4 text-lg font-semibold text-cyan-100"
              onClick={() => {
                setPassengers((prev) => [...prev, emptyPassenger()]);
                setPassengerCount(String(passengers.length + 1));
              }}
            >
              <Plus className="h-5 w-5" aria-hidden />
              Add passenger
            </button>
          ) : null}

          <div className="rounded-xl border border-white/10 bg-slate-950/35 p-4 md:p-5">
            <h4 className="text-lg font-bold text-white">Equipment and gear (approximate)</h4>
            <p className={`${WI_HINT} mt-1`}>Coolers, bags, and other items brought aboard.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor={`${idPrefix}cooler`} className={WI_LABEL}>
                  Cooler and food (lbs)
                </label>
                <input
                  id={`${idPrefix}cooler`}
                  className={WI_FIELD}
                  inputMode="decimal"
                  value={load.cooler_weight_lbs}
                  onChange={(e) => setLoad((prev) => ({ ...prev, cooler_weight_lbs: e.target.value }))}
                />
              </div>
              <div>
                <label htmlFor={`${idPrefix}gear`} className={WI_LABEL}>
                  Personal gear (lbs)
                </label>
                <input
                  id={`${idPrefix}gear`}
                  className={WI_FIELD}
                  inputMode="decimal"
                  value={load.personal_gear_weight_lbs}
                  onChange={(e) =>
                    setLoad((prev) => ({ ...prev, personal_gear_weight_lbs: e.target.value }))
                  }
                />
              </div>
              <div>
                <label htmlFor={`${idPrefix}other-weight`} className={WI_LABEL}>
                  Other equipment (lbs)
                </label>
                <input
                  id={`${idPrefix}other-weight`}
                  className={WI_FIELD}
                  inputMode="decimal"
                  value={load.other_equipment_weight_lbs}
                  onChange={(e) =>
                    setLoad((prev) => ({ ...prev, other_equipment_weight_lbs: e.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor={`${idPrefix}other-desc`} className={WI_LABEL}>
                  Unusually heavy equipment description (optional)
                </label>
                <input
                  id={`${idPrefix}other-desc`}
                  className={WI_FIELD}
                  value={load.other_equipment_description}
                  onChange={(e) =>
                    setLoad((prev) => ({ ...prev, other_equipment_description: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>

          <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-slate-950/35 p-4">
            <input
              type="checkbox"
              className="mt-1.5 h-5 w-5 rounded border-white/30"
              checked={accuracyConfirmed}
              onChange={(e) => setAccuracyConfirmed(e.target.checked)}
            />
            <span className={WI_BODY}>
              I confirm that the passenger and equipment information entered is accurate to the best
              of my knowledge. I understand that inaccurate information may create a safety risk and
              may require the captain to change or delay the trip.
            </span>
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSubmit()}
            className={WI_PRIMARY_BTN}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : null}
            Save Passenger Information
          </button>

          {error ? (
            <p className="text-lg text-amber-100" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {result?.canProceed && result.status === 'within_operating_range' ? (
        <p className={`${WI_BODY} text-emerald-100`}>
          Passenger information saved. Continue with your waiver and documents below.
        </p>
      ) : null}
    </div>
  );
}

export function capacityBlocksDocuments(result: PublicCapacityCheckResult | null | undefined): boolean {
  if (!result) return true;
  if (result.status === 'capacity_exceeded' || result.status === 'capacity_unverified') return true;
  return !result.canProceed;
}

export function capacityAllowsWaiver(result: PublicCapacityCheckResult | null | undefined): boolean {
  if (!result) return false;
  return result.canProceed;
}
