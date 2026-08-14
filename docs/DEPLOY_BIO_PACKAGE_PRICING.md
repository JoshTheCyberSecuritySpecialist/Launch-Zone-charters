# Deploy — direct bioluminescence package pricing

Package IDs and prices: `bio_solo` **$58.50** · `bio_two` **$120** · `bio_four` **$240** (5850 / 12000 / 24000 Stripe cents).

Groupon voucher redemption stays separate — no direct Stripe charge on the Groupon booking path.

## Feature flags

| Variable | Host | Effect |
|----------|------|--------|
| `DIRECT_BIO_PACKAGE_PRICING_ENABLED=true` | Render API | Server uses package pricing for direct bio checkout |
| `VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED=true` | Vercel frontend | Book Now shows package cards and sends `pricing_package_id` |

Both should be `true` in production. Backend pricing is authoritative even if the frontend flag is off.

Vite variables are compiled at build time. Changing the frontend flag requires a **new frontend build and deploy**.

## Deployment sequence

1. Apply Supabase migration `20260802180000_bio_direct_package_pricing.sql` if not already applied (additive columns only).
2. Deploy **server** with `DIRECT_BIO_PACKAGE_PRICING_ENABLED=true`.
3. Build and deploy **frontend** with `VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED=true`.
4. Stripe **test mode**: complete checkout for `bio_solo`, `bio_two`, `bio_four` ($58.50 / $120 / $240).
5. Confirm Groupon redemption still creates $0 due bookings (no direct package Stripe charge).

## Rollback

1. Set `VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED=false`; rebuild and deploy frontend.
2. Set `DIRECT_BIO_PACKAGE_PRICING_ENABLED=false`; restart or redeploy server.

**Emergency:** If the frontend still shows packages but the server must be disabled immediately, deploy frontend with the flag off first, then disable the server flag.
