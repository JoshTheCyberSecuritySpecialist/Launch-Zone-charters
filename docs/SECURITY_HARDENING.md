# Security Hardening — Deploy Guide

## What was fixed in code (deploy first)

- Removed production exposure of `/api/test-supabase`
- Hardened `/api/send-booking-confirmation` (rate limit, email match, idempotency)
- Magic link no longer returns full email until phone is confirmed (`/api/public/confirm-waivers-access`)
- New API routes replace direct anon Supabase access:
  - `GET /api/public/verify-booking`
  - `POST /api/public/verify-booking-gate`
  - `POST /api/public/booking-upload-url`
  - `POST /api/booking-mark-insurance-proof`
- Document URL validation on server (Supabase storage host + path only)
- Phone required on insurance mark endpoints
- Cron endpoints: Bearer token only (no `?secret=`)

## What you must run (database)

After deploying API + frontend:

```bash
npm run db:push
```

Or paste the migration into **Supabase → SQL Editor**:

`supabase/migrations/20260701120000_security_rls_storage_hardening.sql`

## Supabase Dashboard (manual)

1. **Authentication → Providers → Email** — disable **Enable sign up** (invite admins only).
2. **Table `admins`** — each row’s `id` must equal the admin’s `auth.users.id`. Remove reliance on email-only matching when possible.
3. **Environment** — set on the API server:
   - `FRONTEND_URL` or `APP_PUBLIC_URL`
   - `CORS_ORIGIN` if you use preview URLs
   - `CRON_SECRET` (rotate if previously sent in query strings)
4. **Resend / Twilio** — no changes required.

## Verify after migration

1. Book on website → checkout → `/booking-success` still works.
2. Open `/waivers-insurance?bookingId=<uuid>` → checklist loads → confirm phone → upload license + insurance.
3. Manual pre-trip flow still uploads to `documents/licenses/pre-trip/...`.
4. Admin dashboard still loads bookings and can open document links (admin session required for private storage).
5. `/verify?bookingId=` email gate works via API.

## If something breaks

- **Upload fails:** confirm API has `SUPABASE_SERVICE_ROLE_KEY` and `createSignedUploadUrl` is enabled on your project.
- **Admin cannot view docs:** sign in as admin; storage policies require `lz_is_admin()`.
- **Rollback RLS:** re-apply policies from `20260413120000_user_verifications_buoy.sql` (not recommended).

## Still recommended (future)

- Signed expiring magic links (HMAC/JWT) instead of raw booking UUIDs
- CAPTCHA on public find-booking / contact form
- Redis-backed rate limits for multi-instance API
- Remove email fallback from `lz_is_admin()` once all admins use `auth.uid()`
- Set `GROUPON_VOUCHER_HASH_SECRET` in production (do not rely on service-role fallback)
- See **`docs/SECURITY_PHASE5_AUDIT.md`** for the full Phase 5 findings table (Aug 2026)
