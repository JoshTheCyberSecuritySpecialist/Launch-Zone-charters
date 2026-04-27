import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as supabaseSingleton } from './supabaseClient.js';

type BoatsRow = {
  id: string;
  name: string;
  type: 'standard' | 'premium';
  capacity: number;
  description: string | null;
  image_url: string | null;
  hourly_rate: number;
  half_day_rate: number;
  full_day_rate: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type CustomersRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  id_document_url: string | null;
  insurance_proof_url: string | null;
  sms_opt_in: boolean;
  created_at: string;
  updated_at: string;
};

type BookingsRow = {
  id: string;
  customer_id: string;
  boat_id: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  rental_type: 'hourly' | 'half_day' | 'full_day' | 'custom';
  captain_included: boolean;
  captain_fee: number;
  base_price: number;
  peak_surcharge: number;
  security_deposit: number;
  total_price: number;
  /** Amount charged for deposit checkout (Stripe line item). */
  deposit_amount: number | null;
  deposit_paid: number;
  balance_due: number;
  /** pending → deposit_paid after successful Stripe Checkout webhook */
  payment_status: string;
  status:
    | 'pending'
    | 'pending_verification'
    | 'confirmed'
    | 'cancelled'
    | 'completed';
  is_night_tour: boolean;
  is_rocket_tour: boolean;
  special_requests: string | null;
  waiver_signed: boolean;
  waiver_signed_at: string | null;
  terms_accepted: boolean;
  damage_fee_acknowledged: boolean;
  license_status: 'pending' | 'verified' | 'rejected';
  insurance_status: 'pending' | 'verified' | 'rejected';
  /** Per-booking doc URLs (e.g. Storage); may mirror customers.id_document_url / insurance_proof_url */
  license_url: string | null;
  insurance_url: string | null;
  stripe_payment_id: string | null;
  /** Stripe Checkout Session id while unpaid hold; cleared after payment finalization */
  stripe_checkout_session_id: string | null;
  /** Checkout hold expiry (pending + unpaid); null after payment */
  expires_at: string | null;
  admin_notes: string | null;
  /** Set by server after one incomplete-verification reminder email */
  verification_reminder_sent_at: string | null;
  /** Set by server after one incomplete-verification SMS */
  verification_sms_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UserVerificationsRow = {
  id: string;
  booking_id: string;
  buoy_status: 'pending' | 'verified' | 'rejected';
  buoy_proof_url: string | null;
  created_at: string;
  updated_at: string;
};

type WaiversRow = {
  id: string;
  booking_id: string;
  customer_id: string;
  electronic_signature: string;
  signature_date: string;
  ip_address: string | null;
  waiver_content: string;
  accepted: boolean;
  created_at: string;
};

type AdminsRow = {
  id: string;
};

type LaunchesRow = {
  id: string;
  external_id: string | null;
  mission_name: string;
  provider: string | null;
  rocket_type: string | null;
  launch_pad: string | null;
  launch_time: string | null;
  launch_window_end: string | null;
  status: 'scheduled' | 'delayed' | 'scrubbed' | 'success' | 'failure';
  description: string | null;
  live_stream_url: string | null;
  ai_score: number | null;
  ai_rating: 'excellent' | 'good' | 'risky' | null;
  ai_explanation: string | null;
  weather_forecast: unknown;
  created_at: string;
  updated_at: string;
};

type PricingOverridesRow = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  surcharge_percent: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
};

type BlockedDatesRow = {
  id: string;
  boat_id: string | null;
  start_time: string;
  end_time: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

type ContactsRow = {
  id: string;
  name: string;
  email: string;
  message: string;
  created_at: string;
};

type ContactMessagesRow = {
  id: string;
  full_name: string;
  email: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

type CaptainsLogRow = {
  id: string;
  title: string;
  slug: string;
  content: string;
  image_url: string | null;
  image_alt: string | null;
  category: 'Launch Updates' | 'Water Adventures' | 'Boating Tips' | 'Local Highlights';
  created_at: string;
  summary: string | null;
  publish_date: string | null;
  source: string | null;
  source_url: string | null;
  image_source?: string | null;
  seo_keywords?: string[] | null;
  image_seo_filename?: string | null;
};

export type Database = {
  public: {
    Tables: {
      boats: {
        Row: BoatsRow;
        Insert: Omit<BoatsRow, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<BoatsRow, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      customers: {
        Row: CustomersRow;
        Insert: Omit<CustomersRow, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<CustomersRow, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      bookings: {
        Row: BookingsRow;
        Insert: Omit<
          BookingsRow,
          | 'id'
          | 'created_at'
          | 'updated_at'
          | 'verification_reminder_sent_at'
          | 'verification_sms_sent_at'
        >;
        Update: Partial<Omit<BookingsRow, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'bookings_customer_id_fkey';
            columns: ['customer_id'];
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_boat_id_fkey';
            columns: ['boat_id'];
            referencedRelation: 'boats';
            referencedColumns: ['id'];
          },
        ];
      };
      user_verifications: {
        Row: UserVerificationsRow;
        Insert: Omit<UserVerificationsRow, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<UserVerificationsRow, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'user_verifications_booking_id_fkey';
            columns: ['booking_id'];
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
        ];
      };
      waivers: {
        Row: WaiversRow;
        Insert: Omit<WaiversRow, 'id' | 'created_at'>;
        Update: Partial<Omit<WaiversRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      admins: {
        Row: AdminsRow;
        Insert: AdminsRow;
        Update: Partial<AdminsRow>;
        Relationships: [];
      };
      launches: {
        Row: LaunchesRow;
        Insert: Omit<LaunchesRow, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<LaunchesRow, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      pricing_overrides: {
        Row: PricingOverridesRow;
        Insert: Omit<PricingOverridesRow, 'id' | 'created_at'>;
        Update: Partial<Omit<PricingOverridesRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      blocked_dates: {
        Row: BlockedDatesRow;
        Insert: Omit<BlockedDatesRow, 'id' | 'created_at'>;
        Update: Partial<Omit<BlockedDatesRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      contacts: {
        Row: ContactsRow;
        Insert: Omit<ContactsRow, 'id' | 'created_at'>;
        Update: Partial<Omit<ContactsRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      contact_messages: {
        Row: ContactMessagesRow;
        Insert: Omit<ContactMessagesRow, 'id' | 'created_at' | 'is_read'>;
        Update: Partial<Omit<ContactMessagesRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
      captains_log: {
        Row: CaptainsLogRow;
        Insert: Omit<CaptainsLogRow, 'id' | 'created_at'>;
        Update: Partial<Omit<CaptainsLogRow, 'id' | 'created_at'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      admin_delete_captains_log: {
        Args: { article_id: string };
        Returns: boolean;
      };
      resolve_captains_log_slug: {
        Args: { p: string };
        Returns: CaptainsLogRow | null;
      };
    };
  };
};

export const supabase = supabaseSingleton as unknown as SupabaseClient<Database>;
