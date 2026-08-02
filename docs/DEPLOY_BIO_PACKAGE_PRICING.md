# Bioluminescence direct package pricing — production rollout

Package IDs and prices (unchanged): `bio_solo` $40 · `bio_two` $78 · `bio_four` $150.

## Environment variables

Set both flags to the literal string `true` only when ready. Any other value (missing, empty, `false`) keeps package pricing **disabled**.

| Variable | Where | Effect |
|----------|--------|--------|
| `DIRECT_BIO_PACKAGE_PRICING_ENABLED` | Server runtime | Authoritative package validation and Stripe totals |
| `VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED` | Frontend **build** | Package UI in BookNow, marketing pages, staff bio selector |

Vite variables are compiled at build time. Changing the frontend flag requires a **new frontend build and deploy**.

Example (disabled — safe default):

```text
DIRECT_BIO_PACKAGE_PRICING_ENABLED=false
VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED=false
```

## Deployment sequence

1. Back up or snapshot the production database.
2. Apply migration `supabase/migrations/20260802180000_bio_direct_package_pricing.sql`.
3. Verify columns exist: `pricing_package_id`, `pricing_package_name`, `package_guest_count`, `standard_value_cents`, `package_price_cents`, `discount_amount_cents`, `final_amount_cents`.
4. Deploy **server** with `DIRECT_BIO_PACKAGE_PRICING_ENABLED=false`.
5. Run server health check (`GET /api/boats` or your usual probe).
6. Build and deploy **frontend** with `VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED=false`.
7. Verify legacy direct bioluminescence checkout (per-guest pricing) still works.
8. Set `DIRECT_BIO_PACKAGE_PRICING_ENABLED=true` on the server; restart or redeploy.
9. Build frontend with `VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED=true`; deploy.
10. Stripe **test mode**: complete checkout for `bio_solo`, `bio_two`, `bio_four` ($40 / $78 / $150).
11. Verify admin booking details, email, SMS, waiver links.
12. Verify staff package booking and comp audit (`staff_comp_booking_created` activity).
13. Verify Groupon redemption at `/booking/groupon` (unchanged).
14. One controlled **live** payment; monitor logs and booking activity.
15. Keep flags aligned — if server is disabled while frontend shows packages, checkout returns `bio_package_pricing_unavailable`.

## Rollback (no data deletion)

1. Set `VITE_DIRECT_BIO_PACKAGE_PRICING_ENABLED=false`; rebuild and deploy frontend.
2. Set `DIRECT_BIO_PACKAGE_PRICING_ENABLED=false`; restart or redeploy server.
3. Leave package columns and completed package bookings intact.
4. Confirm legacy direct bio flow works.
5. Do **not** reverse completed Stripe charges or recalculate historical totals.
6. Investigate before re-enabling.

**Emergency:** If the frontend still shows packages but the server must be disabled immediately, deploy frontend with the flag off first, then disable the server flag.

Do not drop package columns as part of normal rollback.

## Tests before enable

From repo root:

```bash
npm run typecheck
npm run lint
npm run build
```

From `server/`:

```bash
npm run test:bio-packages
npm run test:staff-booking-duration
```
