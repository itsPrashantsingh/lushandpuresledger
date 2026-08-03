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

## FIXED BUG (2026-08-01): Automation tab message counts used send date, not bill period
`GET /api/whatsapp/summary` (`backend/routes/whatsapp.js`) scoped bill counts by
`bills.period_start/period_end` (correct) but scoped `whatsapp_messages` counts (bills sent,
delivered, read, failed, reminders, acknowledgements) by `whatsapp_messages.created_at` — the
actual send date. So a June bill sent/reminded in July counted under July, contradicting the
period-attribution rule used everywhere else. Confirmed live: two payment_reminder_t1 sent
2026-07-31 for BILL-196/BILL-166 (both period_start=2026-06-01) were showing under July.
**Fix:** message counts now join `whatsapp_messages.entity_id` → `bills.id` and are filtered to
bills whose period falls in the queried month (fetch bills for the period first, then
`whatsapp_messages` where `entity_id in (those bill ids)`, no `created_at` filter). Applies to
message_types bill/payment_reminder_t1/t2/supply_cutoff/bill_carryforward/cash_received/
razorpay_received — all of which use the bill id as `entity_id` (`product_sale` uses a
product_sales id and isn't part of this summary). The failures panel and `automation_runs`
("recent runs") intentionally stay scoped by `created_at`/`ran_at` — those are operational logs
of "what broke recently", not revenue figures, so send-date framing is correct there.

## ☠️ CRITICAL CLASS OF BUG: PostgREST silently truncates at 1000 rows
**Read this before writing ANY Supabase query in this repo.**

PostgREST caps a single response at 1000 rows and returns **success with a short array** —
no error, no warning. Truncation is completely invisible. `daily_entries` passed this threshold
in 2026-07 (**a single month is 1044 rows**; lifetime 1160), so *any* month-wide read of it is
now affected. Worse, these queries used `.order('date')`, which makes the cut **deterministic
and always at the END of the month** — so it silently drops the last days of a billing period.

**Rule: use `fetchAllRows()` for any query that can exceed 1000 rows in its range.** Canonical
implementation is exported from `frontend/src/lib/utils.js`; the backend has its own copy in
`backend/lib/billing.js` (CommonJS). It takes a query *factory* and pages via `.range()`:
`fetchAllRows(() => supabase.from('daily_entries').select('*').gte(...))`. It throws on error,
so callers must NOT also destructure/check `error`. Queries narrowed to a single customer or a
single date are safe and intentionally left unpaginated.

Audited and fixed 2026-08-01 across the whole app. **Billing paths (money-critical):**
- `generateAllMonthlyBills` — frontend `lib/bills.js` AND backend `lib/billing.js`.
  **This is the disaster case.** Verified against live prod: a bare select returned 1000 rows
  ending 2026-07-30 / ₹89,580, vs paginated 1044 rows ending 2026-07-31 / ₹93,555. Generating
  July's bills would have **under-billed ₹3,975 across 35 customers**, losing Jul 31 entirely
  and part of Jul 30 — and the dedup `billedCustomers` guard means the short bills would then
  BLOCK any correct regeneration. Caught on 2026-08-01, the very day July bills were due.
- `getMonthlyBillPackages` — frontend + backend (the WhatsApp send queue / PDF builder);
  truncation would have sent PDFs missing the month's final delivery rows.
**Reporting paths:** Dashboard (see below), `Bills.jsx` mismatch detector (would invent a
phantom under-billed gap), `loadCustomerMonthStats` (Customers tab), and all of
`lib/export-data.js` (`exportMonthlyBilling`, `exportCustomerDeliveries`,
`exportButtermilkProduction`, `exportMilkProduction`, `exportProductSales`) — the likely root
cause of the long-standing "export totals contradict dashboard milk revenue" complaint.

Currently-safe row counts (re-check if this resurfaces): cattle_milk_entries 670, expenses 149,
payments 75, product_sales 20, buttermilk_entries 0. `bills` grows ~72/month — it will cross
1000 around late 2027, so paginate any all-time `bills` read before then.

## FIXED BUG (2026-08-01): Dashboard silently truncated daily_entries past 1000 rows
`daily_entries` passed 1000 total rows (1160 as of 2026-07-31). Two Dashboard queries fetched
the **entire table with no filter and no `.range()`** — `supabase.from('daily_entries').select(...)`
for both `rawDailyEntries` (Supply vs Production) and `rawMilkDeliveries` (Daily Deliveries
chart/heatmap + Revenue & Profit milk figure + 6-month Revenue trend). Supabase/PostgREST caps
a single response at 1000 rows by default, and with no `ORDER BY` the cutoff falls wherever the
query planner's scan happens to stop — **not** cleanly by date. Verified live: the truncated
query returned 2026-07-25 only partially (13 of 37 rows), **dropped 2026-07-26/27/28 entirely**,
and returned 2026-07-29 with only 2 of 36 rows — despite all of those days being fully finalized.
This is exactly why the Dashboard's deliveries chart/heatmap disagreed with what Daily Entries
showed as saved: the heatmap would render those days as unsaved/near-empty (dashed grey or a
tiny green box) purely because of client-side pagination, not any real data problem. The bug
shifts to different dates over time as more rows are added past the 1000 mark — it is not
specific to July.
**Fix:** added `fetchAllRows(makeQuery)` in `frontend/src/pages/Dashboard.jsx` — pages through
`.range()` in chunks of 1000 until a short page is returned — and replaced both unbounded
`daily_entries` queries with one paginated fetch (`allDailyEntriesRes`) feeding both
`rawDailyEntries` and `rawMilkDeliveries`. **Any other unbounded (no date-range-filtered) query
added later must use this same pagination helper** once its table can plausibly exceed 1000
rows — checked the rest of the current unbounded queries (cattle_milk_entries 670,
payments 75, product_sales 20, expenses 149, buttermilk_entries 0) and none are currently at
risk, but re-check row counts if this bug resurfaces elsewhere.

## FIXED BUG (2026-08-01): today's `active` flag retroactively shrank past day totals
`frontend/src/pages/DailyEntry.jsx` computed its day summary (`statRows`) over
`customers.filter(c => c.active !== false)` — i.e. **today's** paused status, applied even when
viewing a historical finalized date. Pausing a customer therefore silently reduced every past
day they had delivered on. Confirmed live: 2026-07-27 showed **39.5 L** on Daily Entries vs
**41.5 L** in `daily_entries` / the Dashboard heatmap; the exact 2.0 L gap was Brijdas (0.5),
Nandlal (1.0) and Pragya (0.5), all deactivated after that date. Those customers also rendered
in the "Paused — auto-skipped, not billed" section with no quantities, contradicting the total.
**Rule now:** a customer counts toward a date if `entries[c.id]?.saved` (a real saved
`daily_entries` row for that date — a historical fact that must never change) **OR** they are
currently active (needed while a day is still being planned and nothing is saved yet). Applied
to `statRows`, to the `activeList`/`inactiveList` render split (via `countsForDay`), and to
`pausedCount` (inactive AND not saved that date). Rows for such customers show a "paused now"
badge and an Activate (not Pause) button. Verified: 2026-07-27 now reads 41.5 L / 35 delivering
/ 33 paused.
**General principle: never filter historical per-date views by a customer's CURRENT `active`
flag** — always key off what was saved for that date. `daily_entries` is the immutable record;
`customers.active` is present-tense state.

## FIXED (2026-08-02): duplicate WhatsApp numbers had no guard anywhere
No unique constraint on `customers.whatsapp_no` and no app-level check. Found via this gap:
**Sharma ji (CUS-0129) and Mahendra Sharma (CUS-0130)** — same phone, same address, created
119 SECONDS apart on 2026-07-01 — the same person entered twice. Sharma ji had zero real
history in any table (daily_entries/bills/payments/buttermilk_entries all 0), so it was purely
a duplicate; renamed to `Sharma ji (duplicate — see Mahendra Sharma CUS-0130)`, kept `active:
false`, and tagged via `custom_fields.duplicate_of = 'CUS-0130'` so it's unmistakable and never
gets reactivated by accident. This duplicate record is the most likely reason "Sharma ji" kept
generating phantom entries in the Jul 16/18 incidents above — it should never have existed as a
separate active-seedable customer at all.
Separately, `1234567890` is used as a placeholder by 10 customers (8 paused, but **2 currently
active**: Kiran Dube CUS-0142, Tanushree CUS-0144) — those two can never receive a WhatsApp
send since it's not a real number. Not yet resolved; get their real numbers when possible.
**Fix:** added a duplicate-number check (blocks save, not just a warning) in three places:
`frontend/src/pages/Customers.jsx` `handleSave` (Add/Edit modal, checks against the already-
loaded `customers` list), `frontend/src/pages/CustomerDetail.jsx` `handleSaveEdit` (queries
Supabase directly since this page only holds one customer), and `handleImport` (checks the
whole imported batch both against existing customers AND against itself, rejecting the entire
batch with a full list of conflicts rather than partially importing). No DB-level unique
constraint was added — the guard is app-level only, so a direct SQL insert could still bypass it.

## TRAP: deleting phantom `daily_entries` without fixing `daily_entry_drafts` — they come back
Deleting a bad row from `daily_entries` alone does NOT fix the problem if the same date still
has a `daily_entry_drafts` row with `delivered=true` for that customer — the next unlock+finalize
on that date regenerates it, because `/finalize` rebuilds `daily_entries` from
`saveDraftEntries`/drafts, not from what's already in `daily_entries`. Hit this exactly on
2026-08-02: deleted 19 phantom Jul-18 rows via SQL (see incident below), then the admin
unlocked/re-finalized Jul 16 and Jul 18 repeatedly while manually skipping customers one at a
time (~40 unlock→skip→finalize cycles in `activity_logs`) — every finalize before a given
customer was reached regenerated that customer's phantom row from the stale draft.
**Rule: when deleting bad rows from `daily_entries` directly in SQL, ALWAYS also correct the
matching `daily_entry_drafts` rows for the same customer+date** (`delivered=false,
morning_qty=0, evening_qty=0`) — otherwise the fix is temporary and silently undone by the next
finalize. Also true for any admin-side skip: the UI's "Skip" button already does this correctly
(it's an app-level save), so this trap is SQL-only intervention.

## Convention (2026-08-01): show skipped days as 0, never omit them
A skipped day simply has **no `daily_entries` row**, so any list built straight from the rows
silently makes the month look shorter than it was. Real confusion this caused: Brijdas
(CUS-0077) has 30 July rows × 0.5 L = **15.0 L** — the Customers card was correct — but the
profile listed 30 rows with no total, the user read it as "0.5 × 31 days" and expected 15.5.
Jul 17 was genuinely absent (the day 55 customers were skipped).
Two fixes in `frontend/src/pages/CustomerDetail.jsx`:
1. The delivery table's `<tfoot>` total **used to render only when the customer had buttermilk**
   (`buttermilkTotal.totalQty > 0`). `buttermilk_entries` is empty table-wide, so in practice
   **no customer ever saw a total**. It now always renders, with morning/evening/total sums and
   an "(N of M days delivered)" count.
2. `monthRows` derives one row per calendar day of the month, merging the real entry or filling
   zeros with `delivered: false` (current month stops at today, never lists future dates).
   The table renders it (skipped days greyed, marked "· skipped") and `exportMonthEntries`
   maps the **same** array with a `status` column, so sheet and screen reconcile row-for-row.
   Zero rows contribute nothing, so totals/billing are unchanged.
**Keep display and export driven off one shared array** — they drifted apart before.

## Incident (2026-08-02): Jul 16 & Jul 18 phantom entries, round 2 (see TRAP above)
20 rows removed total: the same 19 Jul-18 customers as before (they'd regenerated — see TRAP),
plus **Sharma ji (CUS-0129)**, found on both Jul 16 and Jul 18 with the identical signature
(exact default qty/rate, no other July deliveries) but not in the user's original 23-name list.
Backup: `_backup_jul_phantom_round2`. This time both `daily_entries` AND `daily_entry_drafts`
were corrected, so it should not regenerate again. Jul 16 now 36 customers/40.0L, Jul 18 now
35 customers/40.5L — both in line with neighbouring days (33–37 range).

## FIXED (2026-08-03): future-dated cattle production inflated Supply vs Production
18 rows in `cattle_milk_entries` dated **2026-08-29/30/31** — inserted 2026-08-01 01:21-01:23
UTC by `yashpal2409@gmail.com`, all 6 cattle, three back-to-back batches ~1 min apart. Made
Dashboard's "Supply vs Production" show **Total Produced 151.5 L** for August when only 2 real
days existed (59.5 L). Root cause: `MilkProduction.jsx`'s date `<input type="date">` had no
upper bound, so the native picker allowed any future date. Same gap existed on
`DailyEntry.jsx` (customer deliveries — worse, since finalizing there creates real billable
`daily_entries` rows for a date that can't exist yet) and `Bills.jsx` cash-payment date (a
payment can't be received in the future). Backed up to `_backup_aug_future_dated_production`,
then deleted; August now correctly reads 59.5 L. Added `max={todayISO()}` to all three date
inputs. Note: `max` is a browser-level deterrent (blocks the native picker), not a hard
server-side guarantee — someone could still type past it in a permissive browser. No backend
validation was added to reject future dates on insert; consider that if this recurs.

## Payment attribution model (intentional)
Bills-page per-method totals and Dashboard revenue attribute money by **bill period**
(`bills.period_start`), NOT by `payments.paid_at`. A June bill paid in July counts toward JUNE.
`paid_at` is retained for records/audit only. This is the user's explicit requirement — do not
"fix" it to payment-date scoping.
