alter table public.bookings
  add column if not exists booking_source text,
  add column if not exists staff_created boolean not null default false,
  add column if not exists staff_notes text,
  add column if not exists external_reference text;

create index if not exists idx_bookings_staff_created
on public.bookings (staff_created);

create index if not exists idx_bookings_booking_source
on public.bookings (booking_source);

create index if not exists idx_bookings_external_reference
on public.bookings (external_reference)
where external_reference is not null;
