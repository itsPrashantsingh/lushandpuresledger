# WhatsApp Automation Subsystem (updated 2026-07-14)

Automated billing over WhatsApp via a **provider abstraction** (PayPerWA now, Meta Cloud API
later = one adapter + env flip). Both use the same model: approved **templates** + numbered
variables, `wamid` IDs, sent/delivered/read/failed webhooks. Bills sent as **Document-header
templates with a public PDF URL** (PDF hosted in Supabase Storage `bill-pdfs`).

## Backend (`backend/lib/whatsapp/`)
- `index.js` — `getProvider()` from env `WHATSAPP_PROVIDER` (`payperwa`|`meta`).
- `payperwa.js` / `meta-cloud.js` — same interface: `sendTemplate({to, templateName, language,
  variables, documentUrl, filename})`, `getBalance()`, `verifyWebhook(rawBody, sig)`,
  `parseStatusEvent(body)`, `signatureHeader`. PayPerWA document field name is a **best guess**
  (`document_url`) — confirm with PayPerWA support. Meta adapter is a working stub.
- `templates.js` — registry: message type → `{templateName, language, hasDocument,
  buildVariables(ctx)}`. Types: `bill`, `product_sale`, `payment_reminder_t1/t2`,
  `supply_cutoff`, `cash_received`, `razorpay_received`, `bill_carryforward`. Template name
  defaults to the type key, overridable via env `PPW_TPL_<TYPE>`. **8 templates total** need
  Meta approval.
- `send.js` — `sendMessage(type, ctx, {dedupe})`: validates phone, calls provider, **writes a
  `whatsapp_messages` row** (status/wamid/cost/error). `alreadySent(type, entityId)` for dedupe.
- `scheduler.js` — the automation engine: `runCron({force, month})` reads `automation_config`
  and runs, in order: `runRazorpayReconcile()` (independent of scheduler_enabled — gated only by
  its own `razorpay_reconcile_enabled` flag, default true), then on the configured days
  `runGenerate` (→ `billing.generateAllMonthlyBills`), `sendBillsFromItems` (via `buildBillPdfs`
  → server PDF + Storage upload), `runReminders`, `runEmailReport`. Bill generation targets the
  **previous month** by default. Every step records an `automation_runs` row.
- **Reminders are per-bill** (entity_id=bill.id), each with its own overdue clock
  (daysOverdue = today − period_end) — deliberately NOT consolidated per customer (user wants
  each pending month to keep its own Razorpay link). Per bill: escalation ladder (tiers once
  each → `supply_cutoff` once), then **carry-forward** — repeat `bill_carryforward` ("unpaid
  from {month}") every `carryforward_interval_days` (default 7) with that bill's own pay link,
  until paid. Config `carryforward_enabled`/`carryforward_interval_days` (migration 015).

## Cron auth & trigger mechanism
`POST /api/whatsapp/cron` is gated by `CRON_SECRET` env var (falls back to `API_KEY` if unset —
kept as a SEPARATE secret on purpose so the Razorpay-route `API_KEY` guard doesn't leak onto the
frontend, which would otherwise need `VITE_API_KEY` too). **User triggers this daily via an
external free cron service (cron-job.org)** POSTing with header `x-api-key: <CRON_SECRET>` — NOT
via Render's native `type: cron` Blueprint service (that's paid/metered; `render.yaml` still
defines one as an unused alternative). `backend/scripts/cron.js` is a local/CLI equivalent that
calls the same `runCron()`.

## Backend supporting ports (from frontend, for server-side use)
- `lib/billing.js` — ported `createBill`, `createRazorpayLink` (uses `razorpay-sync` razorpay),
  `generateAllMonthlyBills`, `getMonthlyBillPackages`. **`generateAllMonthlyBills` does NOT
  filter customers by `active` status** — it queries ALL customers and decides eligibility
  purely from whether billable `daily_entries`/`buttermilk_entries` exist in the period. This
  was a deliberate bug fix (2026-07-14): filtering by active caused a customer who delivered
  for part of a month then went inactive to be silently skipped from billing entirely. Same fix
  applied to the frontend's `frontend/src/lib/bills.js generateAllMonthlyBills` (used by the
  manual "Generate All Bills" button on the Bills page) — both must stay in sync on this.
- `lib/pdf.js` — ported `generateBill` → `billPdfBuffer()` (jsPDF runs in Node; verified).
- `lib/gst.js`, `lib/format.js`, `lib/dairy.js` — GST calc, PDF formatters, dairy identity from
  env (`DAIRY_NAME/ADDRESS/PHONE/GSTIN/STATE`; defaults mirror frontend localStorage).
- `lib/storage.js` — `uploadBillPdf(billId, buffer)` → public URL in `bill-pdfs` bucket.
- `lib/mark-paid.js` — fires `sendMessage('razorpay_received', …)` when
  `automation_config.razorpay_ack_enabled`.
- `lib/razorpay-sync.js reconcileUnpaidBills({periodStart, periodEnd} = {})` — optional period
  scope added 2026-07-14 (backward compatible; no args = check all unpaid bills, as before).
  Used unscoped by the daily cron's `runRazorpayReconcile()`, and scoped-to-a-month by the manual
  "🔄 Sync Razorpay Payments" button on the Bills page (`POST /api/razorpay/reconcile` accepts
  optional body `{month: 'YYYY-MM'}`).

## Daily delivery entry — inactive customers (`backend/routes/daily-entry.js`, 2026-07-14)
Same root bug as billing: `loadCustomers()` used to filter `.eq('active', true)`, hiding paused
customers from the daily list entirely (and, via the billing bug above, from partial-month bills
too). Now fixed:
- `loadCustomers()` fetches ALL customers, ordered active-first then name.
- `loadDeliveryState()` / `seedDraftsIfNeeded()`: when no draft/final entry exists yet for a date,
  an **inactive** customer defaults to `delivered=false, qty=0` automatically (no manual daily
  "Skip" click needed) — an **active** customer still defaults to their usual qty/delivered=true.
  Historical final/draft entries are never overridden by this default.
- Frontend `pages/DailyEntry.jsx` renders two sections: active customers (normal qty controls +
  a new "Pause" button beside "Skip" — Skip is for today only, Pause sets
  `customers.active=false` directly via supabase, durable) and a **"Paused" section at the
  bottom** (simplified rows, just an "Activate" button). Buttermilk subscription list/count
  excludes paused customers.
- Pausing a customer (`setCustomerActive(id, false)`) patches `customers`/`entries` state
  LOCALLY (no reload) and zeros today's entry immediately, so a day already unlocked with real
  draft quantities doesn't survive the pause — this closes an edge case where Pause-after-unlock
  wouldn't retroactively clear that day's pending draft. Reactivating still reloads from the
  server (safe, no unsaved state to protect). If today's session is currently LOCKED, staff must
  Unlock then Lock/Save Final again for the zeroed value to persist (same as any other edit).

## Email report (`backend/lib/email/`)
- `index.js` — nodemailer SMTP (`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`; Hostinger). `sendMail`,
  `verifyConnection`, `isConfigured`.
- `bill-report.js` — `sendBillsReport({to, month, items})`: HTML summary table + **every bill
  PDF attached**. Recipient + on/off from `automation_config.report_email` /
  `email_report_enabled`.

## Routes (`backend/routes/whatsapp.js`, mounted `/api/whatsapp`)
- `POST /cron` (CRON_SECRET/API_KEY gated) → `scheduler.runCron`. `POST /send` (authed) →
  `sendMessage` by type+entityId (builds ctx from the bill/sale). `GET /balance`, `GET /config`,
  `PUT /config` (allowed fields include `razorpay_reconcile_enabled`, `carryforward_enabled`,
  `carryforward_interval_days`), `GET /summary?month=` (also returns `recentRuns` — last 5
  `automation_runs`, now rendered in the tab), `POST /email-report`.
- Status webhook: `POST /webhook/whatsapp` (+ GET for Meta hub.challenge) in `routes/webhook.js`
  (raw body) → verify signature → update `whatsapp_messages.status`.

## Frontend
- Page `pages/WhatsAppAutomation.jsx` (nav `/whatsapp` 💬): config (gen/send day, reminder tiers,
  carry-forward interval, cutoff), independent toggles (scheduler / reminders / cash-ack /
  razorpay-ack / email report / **razorpay auto-sync**), monthly health summary
  (generated/sent/delivered/read/reminders/failed + wallet balance), failures panel, **recent
  automation runs panel**, manual "Email this month's bills" button.
- `lib/whatsapp-api.js` — `sendViaApi`, `sendBillViaApi`, `sendSaleViaApi`, `sendTextViaApi`,
  config/summary/balance/email helpers. `lib/pdf-upload.js` — uploads jsPDF blob to `bill-pdfs`,
  persists `bills.pdf_url`/`product_sales.pdf_url`.
- Manual send buttons use the **API** (Bills, Sales "Send Bill", CustomerDetail, Dashboard
  reminder/ack, Reminders page, `WhatsAppSendQueue` "Auto-send all") — **every one of these keeps
  an explicit "Manual" wa.me fallback button alongside**, per the user's explicit instruction to
  never remove the free manual option.
- **Strict rule enforced everywhere (2026-07-14 audit + fix):** an API-driven send button ONLY
  calls the API; on failure it shows an error toast and stops — it must NEVER silently fall back
  to wa.me or silently swallow the error. Manual is always a separate, explicitly-clicked button.
  Found and fixed two violations of this: `Dashboard.jsx handleReminder` and `Bills.jsx
  handleReminder` used to auto-open wa.me on API failure with no toast; `Dashboard.jsx
  handleMarkPaid`'s cash-ack used to silently swallow send failures (`catch {}` with a comment).
  Both now toast success/failure explicitly and have a separate `*Manual` handler + button
  (`BillCard.jsx` gained an `onSendReminderManual` prop). Dashboard.jsx also gained a real
  `Toast` import + `toast` state (it had none before — the original fix attempt would have
  silently no-op'd via `setToast?.()` on an undefined function, which was itself caught and
  corrected before shipping).
- Bills page automation panel restructured: the numbered 1️⃣/2️⃣ workflow is now just
  Generate→Send; "Add Razorpay Links" (renamed "🔁 Retry Missing Razorpay Links" — only touches
  bills missing a link, via `.is('razorpay_short_url', null)`) and "🔄 Sync Razorpay Payments"
  are demoted to a separate "Razorpay utilities — use only if needed" row, since they're
  repair/retry actions, not sequential steps.
- Bills page has a 4th automation button: "🔄 Sync Razorpay Payments" — scoped to the currently
  selected month via `reconcileRazorpayPayments(month)`.

## Config/env & prerequisites
- Env: `WHATSAPP_PROVIDER`, `PAYPERWA_API_KEY/BASE_URL/CHANNEL_ID/WEBHOOK_SECRET`, `CRON_SECRET`,
  `SMTP_*`, `DAIRY_*`, Meta placeholders. In git-ignored `backend/.env`; placeholders in
  `.env.example`; `render.yaml` lists them (sync:false).
- **Blocked on the user:** PayPerWA account + WABA + funded wallet + 8 templates Meta-approved
  (bill, product_sale [Document header], payment_reminder_t1/t2, supply_cutoff, cash_received,
  razorpay_received, bill_carryforward). Until `PAYPERWA_API_KEY` is set, sends return
  `ok:false` and log `failed` rows (visible in the tab's failures panel).
- **Security:** SMTP password was shared in plaintext chat — recommend rotation.
- **Nothing committed yet** as of 2026-07-14 — everything is in the working tree by design so
  the user controls deploy timing to the live portal.

## DB migrations (all applied live to project `Billing`, pvqxgghvzhhdidpdekos)
013 whatsapp_messages/automation_config/automation_runs + bills.pdf_url etc. · 014
email_report_enabled/report_email · 015 carryforward_enabled/carryforward_interval_days · 016
razorpay_reconcile_enabled.
