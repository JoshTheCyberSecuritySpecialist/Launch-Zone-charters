/** Life-jacket sizing options for passenger manifest (Phase 3 public form). */
export const LIFE_JACKET_SIZES = [
  'Infant',
  'Child',
  'Youth',
  'Adult small',
  'Adult medium',
  'Adult large',
  'Adult XL',
  'Adult 2XL+',
  'Unsure — staff assistance needed',
] as const;

export type LifeJacketSize = (typeof LIFE_JACKET_SIZES)[number];

export type PassengerType = 'adult' | 'child' | 'infant';

export type CapacityCalculationStatus =
  | 'within_operating_range'
  | 'captain_review_required'
  | 'capacity_exceeded'
  | 'capacity_unverified';

export type CapacityThresholdBand = 'green' | 'yellow' | 'red';

export type BoatCapacityProfileRow = {
  boat_id: string;
  registration_number: string | null;
  maximum_persons: number | null;
  maximum_persons_weight_lbs: number | null;
  maximum_total_load_lbs: number | null;
  operator_weight_lbs: number | null;
  standard_equipment_weight_lbs: number;
  fuel_allowance_weight_lbs: number;
  safety_buffer_lbs: number;
  warning_threshold_percent: number;
  capacity_plate_photo_path: string | null;
  capacity_source: string | null;
  capacity_verified: boolean;
  capacity_verified_at: string | null;
  capacity_verified_by: string | null;
  config_version: number;
  created_at: string;
  updated_at: string;
};

export type BoatVesselMetadata = {
  year: number | null;
  manufacturer: string | null;
  model: string | null;
  length_feet: number | null;
  engine_description: string | null;
};

export const CAPACITY_STATUS_LABELS: Record<CapacityCalculationStatus, string> = {
  within_operating_range: 'Safe operating range',
  captain_review_required: 'Review required',
  capacity_exceeded: 'Capacity exceeded',
  capacity_unverified: 'Capacity data unverified',
};

/** Returns true when all plate limit fields needed for verification are present. */
export function capacityProfileReadyForVerification(profile: {
  maximum_persons: number | null;
  maximum_persons_weight_lbs: number | null;
  maximum_total_load_lbs: number | null;
  operator_weight_lbs: number | null;
}): boolean {
  return (
    profile.maximum_persons != null &&
    profile.maximum_persons > 0 &&
    profile.maximum_persons_weight_lbs != null &&
    profile.maximum_persons_weight_lbs > 0 &&
    profile.maximum_total_load_lbs != null &&
    profile.maximum_total_load_lbs > 0 &&
    profile.operator_weight_lbs != null &&
    profile.operator_weight_lbs > 0
  );
}
