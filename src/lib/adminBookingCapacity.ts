import {
  CAPACITY_STATUS_LABELS,
  type BoatCapacityProfileRow,
  type CapacityCalculationStatus,
  type CapacityThresholdBand,
} from './boatCapacityTypes';

export type AdminBookingCapacityPassenger = {
  id: string;
  passenger_number: number;
  passenger_name: string;
  passenger_type: string;
  weight_lbs: number;
  life_jacket_size: string | null;
  mobility_assistance_required: boolean;
  mobility_notes: string | null;
  created_at: string;
};

export type AdminBookingCapacityCalculation = {
  id: string;
  booking_id: string | null;
  boat_id: string;
  config_version: number;
  passenger_count: number;
  total_persons_aboard: number;
  passenger_weight_total_lbs: number;
  operator_weight_lbs: number;
  cooler_weight_lbs: number;
  personal_gear_weight_lbs: number;
  other_equipment_weight_lbs: number;
  other_equipment_description: string | null;
  estimated_operating_load_lbs: number;
  operational_weight_limit_lbs: number | null;
  remaining_margin_lbs: number | null;
  capacity_percent: number | null;
  status: CapacityCalculationStatus;
  threshold_band: CapacityThresholdBand | null;
  customer_confirmed_at: string | null;
  calculated_at: string;
};

export type AdminCapacityOverride = {
  id: string;
  original_status: string;
  override_status: string;
  reason: string;
  overridden_by: string | null;
  overridden_at: string;
};

export type AdminBookingCapacityDetail = {
  calculation: AdminBookingCapacityCalculation | null;
  passengers: AdminBookingCapacityPassenger[];
  boat_capacity_profile: BoatCapacityProfileRow | null;
  boat: { id: string; name: string; type: string | null } | null;
  booking: {
    boat_id: string | null;
    guest_count: number | null;
    booking_type: string | null;
    captain_included: boolean | null;
  } | null;
  overrides: AdminCapacityOverride[];
  effective_status: CapacityCalculationStatus;
  calculated_status: CapacityCalculationStatus | null;
  latest_override: AdminCapacityOverride | null;
};

export const OVERRIDE_STATUS_OPTIONS: {
  value: CapacityCalculationStatus;
  label: string;
}[] = [
  { value: 'within_operating_range', label: CAPACITY_STATUS_LABELS.within_operating_range },
  { value: 'captain_review_required', label: CAPACITY_STATUS_LABELS.captain_review_required },
];

export function capacityStatusBadgeClass(status: CapacityCalculationStatus | null | undefined): string {
  switch (status) {
    case 'within_operating_range':
      return 'bg-green-100 text-green-900';
    case 'captain_review_required':
      return 'bg-amber-100 text-amber-900';
    case 'capacity_exceeded':
      return 'bg-red-100 text-red-900';
    default:
      return 'bg-slate-200 text-slate-800';
  }
}

export function formatLbs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })} lb`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(1)}%`;
}
