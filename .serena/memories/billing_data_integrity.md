# Billing data-integrity rules & past incidents

## Invariant: deliveries must reconcile to bills
For any month: `sum(daily_entries.amount)` for the period MUST equal `sum(bills.subtotal)` for
that `period_start`, and every customer with `total_qty>0` must have exactly one bill.
Verify with:
```sql
select (select sum(amount) from daily_entries where date between :start and :end) as milk_revenue,
       (select sum(subtotal) from bills where period_start=:start) as bills_subtotal;
```
Dashboard "milk revenue" reads `daily_entries` **directly**, while bills are a point-in-time
snapshot created by `generateAllMonthlyBills`. Any delivery finalized AFTER bill generation
silently under-bills and makes the dashboard disagree with bills. Bills are never auto-refreshed.

## Mismatch detector (Bills page, added 2026-07)
`checkMismatch()` in `frontend/src/pages/Bills.jsx` runs on every month load: sums
`daily_entries` + `buttermilk_entries` per customer for the period, compares against
`bills.subtotal`, and shows an amber banner when deliveries exceed billed amounts
(reports total gap, customers with no bill, and bills that are short).
**It deliberately skips the current month** (`month >= currentYearMonth()`) — that month's
bills legitimately don't exist yet (generated at the start of the next month), so it would
otherwise always show a large false-positive gap (verified: July showed ₹87,485 / 72 customers).
Verified clean for Apr/May/June after the phantom-data cleanup.

## FIXED BUG (2026-07): historical-date seeding invented deliveries
`seedDraftsIfNeeded` + `loadDeliveryState` (`backend/routes/daily-entry.js`) pre-filled EVERY
active customer with their default morning/evening qty when a date was unlocked — with no check
that the customer existed on that date. Unlocking an old date and pressing Save Final therefore
committed real `daily_entries` for customers created months later, inventing revenue.
**Fix:** both functions now compute `existedOnDate = customer.created_at.slice(0,10) <= date`
and skip default pre-fill when false (existing draft/final rows are still honoured, so real
history is never overwritten). Keep this guard in both places — they must stay in sync.

**Incident:** on 2026-07-29 admin `ps114100052@gmail.com` unlocked/finalized 2026-06-29 twice
(45.5L then 46.5L, 37 customers) while testing the pause/skip feature. This created 36 phantom
`daily_entries` worth ₹3,295 — **14 of them for customers created in July** (provably impossible).
Effect: June milk revenue read ₹71,767.50 vs bills ₹68,472.50 (diff = exactly ₹3,295), 26 bills
appeared "under-billed" and 10 customers appeared "unbilled". All 36 rows were deleted
2026-07-31 after backup to table `_backup_jun29_phantom_entries` (drop it once confident).
June now reconciles exactly: ₹68,472.50 = ₹68,472.50, 38 customers = 38 bills, 0 unbilled.
NOTE: June's real data is a single BULK entry on 2026-06-30 holding the whole month's amount —
not per-day rows. Don't assume June has daily granularity.

## FIXED BUG (2026-07): razorpay_payment_id stored a JSON blob
`fetchPaymentIdFromLink` (`backend/lib/razorpay-sync.js`) did `return link.payments[0]` — but
Razorpay returns an array of OBJECTS (`{payment_id, amount, status, method, created_at}`), not id
strings. So `payments.razorpay_payment_id` held e.g.
`'{"amount":52000,...,"payment_id":"pay_T8wiM539xmGxd3",...}'`.
**Impact: duplicate-payment protection was silently dead** — `mark-paid.js` guards double-payment
via `.eq('razorpay_payment_id', paymentId)`, which could never match a real id, so the same
Razorpay payment could be recorded twice. Same bug existed in `processWebhookEvent`.
**Fix:** both now normalize (`typeof first === 'string' ? first : first.payment_id || first.id`).
7 corrupted rows repaired in-place via `razorpay_payment_id::json ->> 'payment_id'`.

## Known workflow issue (NOT a code bug): Razorpay payments marked as Cash/QR
Staff clicking "Mark Cash Paid" before the Razorpay sync runs records real Razorpay money under
mode `cash`/`qr`, so the Bills page "Payment Link" total under-reports. Confirmed cases: BILL-185
₹4,537.50 booked as QR (was actually 3 Razorpay payments), BILL-191 ₹760 and BILL-169 ₹2,400
booked as cash. The money is present and bills are correct — only the mode attribution is wrong.
Only ~7 of 20 July Razorpay payments were captured by sync as `upi`.

## FIXED INCIDENT (2026-07-31): premature July bills from one wrong click
Admin accidentally clicked "Generate All Bills" for **July while July was still in progress**
(month not yet over) — created 72 bills (BILL-204..BILL-275, period_start=2026-07-01), all
`paid=false`, `sent_at=null`, no Razorpay link, created in one ~40s batch. Since nothing had
gone out (no sends, no payments, no Razorpay links), cleanup was zero-risk: backed up to
`_backup_july_accidental_bills` (drop once confident), verified 0 `payments` rows referenced
any of the 72 bill ids, then deleted all 72 from `bills`. Also relevant: `generateAllMonthlyBills`
skips customers who already have a bill for the period (dedup by `billedCustomers`), so leaving
premature bills in place would have silently blocked the real Aug-1 generation from ever billing
those customers for July.
**Safeguard added:** `runGenerateAll()` in `frontend/src/pages/Bills.jsx` now shows a
`window.confirm()` before calling `generateAllMonthlyBills`, naming the target month and adding
an extra warning line if the selected month hasn't ended yet (`month >= currentYearMonth()`).
This is a manual-UI-only guard — `backend/lib/whatsapp/scheduler.js` (the automated cron
generation/send) was deliberately left untouched, per explicit user instruction.

## Payment attribution model (intentional)
Bills-page per-method totals and Dashboard revenue attribute money by **bill period**
(`bills.period_start`), NOT by `payments.paid_at`. A June bill paid in July counts toward JUNE.
`paid_at` is retained for records/audit only. This is the user's explicit requirement — do not
"fix" it to payment-date scoping.
