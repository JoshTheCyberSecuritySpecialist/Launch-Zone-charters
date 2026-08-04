# Phase 5 — Whole-Site Security Review (Aug 2026)

Structured OWASP-style review of Launch Zone Charters (Express API + Vite SPA + Supabase). **No production penetration testing** was run; findings are from static code and configuration review.

## Executive summary

Core money paths (Stripe checkout, webhooks, bio package pricing) are **server-authoritative** with existing tests. Admin and captain APIs consistently use JWT + database role checks. Prior RLS/storage hardening migration exists but must be **applied on Supabase** if not already (`20260701120000_security_rls_storage_hardening.sql`).

This pass added **low-risk API hardening** (body size limit, baseline security headers, contact + upload URL rate limits). Remaining items are mostly **operational** (CAPTCHA, Redis rate limits, MFA, secret rotation).

---

## Findings

| ID | Severity | Area | Finding | Remediation | Status |
|----|----------|------|---------|-------------|--------|
| P5-01 | **High** (if migration not applied) | Supabase RLS | Legacy anon policies allowed broad reads/writes on bookings, customers, storage | Run `20260701120000_security_rls_storage_hardening.sql`; follow `docs/SECURITY_HARDENING.md` | **Manual** — verify in Supabase |
| P5-02 | **Medium** | Abuse / availability | `/api/contact` and browser anon INSERT on `contact_messages` — no server rate limit before this audit | IP rate limit on `/api/contact` (8/min); CAPTCHA still recommended for browser form | **Fixed** (API); browser form unchanged |
| P5-03 | **Medium** | Abuse | Signed upload URL minting without rate limit | Reuse find-booking IP bucket on `/api/public/booking-upload-url` | **Fixed** |
| P5-04 | **Medium** | DoS | `express.json()` default unlimited body size | `express.json({ limit: '2mb' })` (webhook uses raw route before JSON) | **Fixed** |
| P5-05 | **Medium** | Headers | No `helmet` / baseline API response headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` on all API responses | **Fixed** |
| P5-06 | **Medium** (multi-instance) | Rate limits | In-memory IP maps do not share state across Render instances | Redis-backed limiter or edge WAF (Cloudflare) | **Future** |
| P5-07 | **Low** | Secrets | Groupon HMAC falls back to `SUPABASE_SERVICE_ROLE_KEY` or dev string if `GROUPON_VOUCHER_HASH_SECRET` unset | Set dedicated `GROUPON_VOUCHER_HASH_SECRET` in production | **Manual** |
| P5-08 | **Low** | Auth | Admin match by email (`ilike`) if `admins.id` ≠ `auth.users.id` | Align IDs; disable public signup; prefer uid-only checks | **Manual** (documented) |
| P5-09 | **Info** | Stripe | Client price mismatch logged but **Stripe charge uses server `expected.amountDueToday`** | Monitor `[pricing-shadow-mismatch]` logs | **OK** |
| P5-10 | **Info** | Stripe webhook | Raw body + `constructEvent`, idempotency via `stripe_webhook_events` | Keep webhook secret rotated on Stripe dashboard events | **OK** |
| P5-11 | **Info** | Groupon | Direct checkout rejects `bookingSource=groupon`; verify/book flows rate-limited | No change | **OK** |
| P5-12 | **Info** | Uploads | Document URLs validated to project Supabase host + allowed buckets | Keep buckets private per migration | **OK** |
| P5-13 | **Info** | Frontend | No `dangerouslySetInnerHTML` in `src/`; service role not in Vite env | Continue using anon key + API for sensitive ops | **OK** |
| P5-14 | **Info** | CORS | Production refuses open CORS when origins unset | Ensure `FRONTEND_URL` / `CORS_ORIGIN` on Render API | **Ops** |
| P5-15 | **Info** | Admin surface | 83 `/api/admin/*` routes; all use `verifyAdminRequest` except intentional `/api/admin/verify` | Periodic script re-check on new routes | **OK** |
| P5-16 | **Info** | Debug | `/api/test-supabase` returns 404 in production | Do not enable in prod | **OK** |
| P5-17 | **Low** | CSP | Full Content-Security-Policy not set on API (JSON API only) | Set CSP on **static frontend** host (Netlify/Vercel/etc.) | **Frontend host** |
| P5-18 | **Low** | Enumeration | `/api/finalize-checkout-session` requires valid **paid** Stripe session ID | Session IDs are unguessable; idempotent finalize is acceptable | **OK** |

---

## What was verified (no code change required)

- **Authentication (admin/captain):** Bearer JWT validated via Supabase Auth; admin requires `admins` row; captain requires active `captains` row.
- **Checkout tampering:** `computeExpectedBookingTotals` + Stripe `unit_amount` from server; bio packages gated by `DIRECT_BIO_PACKAGE_PRICING_ENABLED` and package validators (see `npm run test:bio-packages`).
- **Cron:** `requireCronBearer` — no query-string secret.
- **PII in logs:** Stripe metadata includes customer email (Stripe-side); avoid adding voucher numbers to logs (Groupon paths use masking helpers).

---

## Deploy checklist (after this commit)

1. Deploy **server** to Render (`Launch-Zone-charters` API).
2. Confirm Supabase migration **P5-01** applied.
3. Set `GROUPON_VOUCHER_HASH_SECRET` if not set (**P5-07**).
4. Run smoke: contact form, waiver upload URL, one checkout in test mode.

---

## Commands run during audit

```bash
npm run build          # frontend
cd server && npm run test:bio-packages
npm audit              # root + server (review only; no --force)
```

---

## Related docs

- `docs/SECURITY_HARDENING.md` — RLS migration and dashboard steps
- `docs/DEPLOY_BIO_PACKAGE_PRICING.md` — package pricing flags
