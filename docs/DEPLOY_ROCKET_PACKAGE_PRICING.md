# Deploy — direct rocket launch package pricing

Package IDs and prices: `rocket_solo` **$100** · `rocket_duo` **$190** · `rocket_private` **$450** (10000 / 19000 / 45000 Stripe cents).

Legacy pricing remains **$85 × guests** until the server flag is enabled.

Groupon voucher redemption stays separate — no direct Stripe charge on the Groupon booking path.

## Feature flags

| Variable | Host | Effect |
|----------|------|--------|
| `DIRECT_ROCKET_PACKAGE_PRICING_ENABLED=true` | Render API | Server uses package pricing for direct rocket checkout |
| `VITE_DIRECT_ROCKET_PACKAGE_PRICING_ENABLED=true` | Vercel frontend | `/launches` and Book Now show package cards and send `pricing_package_id` |

Both should be `true` in production once Slice B (customer UI) is deployed. Backend pricing is authoritative even if the frontend flag is off.

Vite variables are compiled at build time. Changing the frontend flag requires a **new frontend build and deploy**.

## Deployment sequence

1. Reuse existing direct package columns from bio pricing (`pricing_package_id`, etc.).
2. Apply Supabase migration `20260819120000_rocket_shared_departure_fields.sql` (`shared_departure_id`, `departure_confirmation_status`).
3. Deploy **server** with `DIRECT_ROCKET_PACKAGE_PRICING_ENABLED=true` after tests pass.
3. Build and deploy **frontend** (Slice B) with `VITE_DIRECT_ROCKET_PACKAGE_PRICING_ENABLED=true`.
4. Stripe **test mode**: complete checkout for `rocket_solo`, `rocket_duo`, `rocket_private` ($100 / $190 / $450).
5. Confirm legacy rocket bookings still price at $85/guest when the flag is off.
6. Confirm Groupon redemption still creates $0 due bookings (no direct package Stripe charge).

## Rollback

1. Set `VITE_DIRECT_ROCKET_PACKAGE_PRICING_ENABLED=false`; rebuild and deploy frontend.
2. Set `DIRECT_ROCKET_PACKAGE_PRICING_ENABLED=false`; restart or redeploy server.

**Emergency:** If the frontend still shows packages but the server must be disabled immediately, deploy frontend with the flag off first, then disable the server flag.

## Tests

```bash
cd server && npm run test:rocket-packages
```
