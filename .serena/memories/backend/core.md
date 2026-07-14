# Backend Core (`backend/`)

Express 5, CommonJS. Entry `server.js`. Uses Supabase **service-role** key (`lib/supabase.js`) → bypasses RLS.

## server.js wiring
- CORS allowlist from `FRONTEND_URL` (comma-separated).
- `/webhook` uses `express.raw()` (needs raw body for Razorpay HMAC); everything else `express.json()`.
- Optional `requireApiKey` (header `x-api-key` vs env `API_KEY`) gates `/api/razorpay` EXCEPT `POST /confirm-payment` (public, customer post-payment).
- Mounts: `/api/razorpay` → `routes/razorpay.js`, `/api/daily-entry` → `routes/daily-entry.js`, `/api/logs` → `routes/logs.js`, `/webhook` → `routes/webhook.js`. `GET /health`.
- Central error handler returns `{ error }` 500.

## lib/
- `auth.js` — `requireUser` middleware: Bearer token → `supabase.auth.getUser(token)` → `req.user = {id,email}`. 401 on missing/invalid.
- `activity-log.js` — `logActivity(user, action, entityType, {entityId, entityDate, details})` inserts into `activity_logs`; failures only console-log.
- `mark-paid.js` — `markBillPaidFromRazorpay({billId, paymentId, amountPaid, mode})`: THE idempotent bill-paid path. Skips if already paid; dedupes on `razorpay_payment_id`; updates bill (`paid`, `paid_at`, `payment_mode`) + inserts a `payments` row.
- `razorpay-sync.js` — Razorpay engine (exports `razorpay` SDK instance + fns):
  - `verifyCallbackSignature(params)` — HMAC-SHA256 of `linkId|referenceId|status|paymentId` with `RAZORPAY_KEY_SECRET`.
  - `syncBillFromRazorpay(billId)` — fetch payment link; if `status==='paid'` → `markBillPaidFromRazorpay`. Returns `{success, synced, alreadyPaid, ...}`.
  - `reconcileUnpaidBills()` — loops all unpaid bills with a link, syncs each.
  - `processWebhookEvent(event)` — handles `payment_link.paid` / `.partially_paid` (by `reference_id` = billId) and `payment.captured` (billId from `notes.bill_id` or `BILL-\d+` in description).

## routes/
- `razorpay.js`: `POST /create-link` (creates Razorpay paymentLink, saves `razorpay_link_id`+`razorpay_short_url` to bill; notify sms/email OFF, `callback_url=FRONTEND_URL/payment-success`), `POST /confirm-payment` (public; verifies signature if present → sync), `POST /verify-payment` (admin sync one), `POST /reconcile` (admin sync all).
- `webhook.js`: `POST /razorpay` — verifies `x-razorpay-signature` against raw body with `RAZORPAY_WEBHOOK_SECRET`, then `processWebhookEvent`.
- `logs.js`: `GET /` — reads `activity_logs` (limit 1..300, filters `action`/`entityType`). `ENTITY_GROUPS` maps a UI group → underlying `entity_type` values.
- `daily-entry.js`: the multi-user delivery lock workflow — see below.

## Delivery lock/unlock/finalize workflow (`daily-entry.js`)
Purpose: let multiple staff edit a day's deliveries safely before committing to `daily_entries`.
- Three tables: `daily_entry_sessions` (per-date status: `locked`|`unlocked`|`finalized`), `daily_entry_drafts` (editable staging, per customer+date), `daily_entries` (final committed, per customer+date, has generated `total_qty`/`amount`).
- `GET /?date=` → `loadDeliveryState`: merges session + drafts + finals; entries default to each customer's `morning_qty`/`evening_qty`/`rate` when no draft/final exists.
- `POST /unlock` → `seedDraftsIfNeeded` (copy finals-or-customer-defaults into drafts) + set session `unlocked`.
- `POST /lock` → `saveDraftEntries` (upsert drafts) + session `locked`.
- `POST /finalize` → save drafts, then upsert **delivered** rows (qty>0 && delivered) into `daily_entries` and DELETE skipped customers' rows for that date; session `finalized`. Logs summary.
- All three log via `logActivity` (`deliveries` entityType). NOTE migration 012 dropped the per-row `daily_entries` trigger to avoid spam — delivery audit comes from these backend logs only.
