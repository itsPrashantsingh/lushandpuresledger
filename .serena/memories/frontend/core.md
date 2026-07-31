# Frontend Core (`frontend/src/`)

React 19 SPA, Vite, Tailwind v4. Entry `main.jsx` → `App.jsx`.

## Routing & auth (`App.jsx`)
- `<AuthProvider>` (`lib/auth.jsx`) wraps everything; exposes `useAuth()` → `{user, loading, login, logout}` backed by `supabase.auth`.
- Public routes: `/login`, `/payment-success`. Everything else under `/*` is wrapped by `<ProtectedRoute>` (redirects to /login) + `<AppLayout>` (Navbar + main).
- To add a page: create `pages/X.jsx`, add `<Route>` in `App.jsx`, add a `{to,label,icon}` entry to the `links` array in `components/Navbar.jsx`.

## Pages (`pages/`) — each is a self-contained component fetching its own data via `supabase`
- `Dashboard` — KPIs, revenue/profit (date-range picker + `RangeShifter` month ◀▶), production
  charts (recharts), P&L, dues. Product sales counted in revenue/cash only when `paid=true`.
  **Section order (2026-07 restructure, deliberate):** Revenue & Profit → Daily Deliveries →
  Business Health → Production Analytics → Supply vs Production → Trends (Revenue-vs-Expenses +
  Milk-Production charts) → Payment Intelligence (Top Payers + Overdue) → Unpaid Bills → Recent
  Payments. Every section uses ONE consistent header style —
  `text-sm font-semibold uppercase tracking-wide text-slate-400` inside a bare `<section>` (no
  outer card border on the section itself) — this replaced a prior inconsistency where the first
  5 sections used this small-caps label while Trends/Payment Intelligence/Unpaid Bills/Recent
  Payments used a bigger bold `font-semibold text-slate-700` header instead. Unpaid Bills/Recent
  Payments had their old inner duplicate header removed (the outer section label now covers it);
  Trends/Payment Intelligence keep their per-card sub-titles since each card needs a distinct
  label. Keep new Dashboard sections consistent with this pattern.
  Daily-deliveries section has a **📈 Chart / 🗓️ Calendar toggle** (`deliveryView` state). The
  calendar (`DeliveryCalendar` component, top of Dashboard.jsx) is a month heat-map: green shade
  scales with litres, dashed-grey = no final save that day, tooltip shows litres/amount/customers,
  footer shows "N/M days saved" + month totals + legend. `finalSaved` is inferred from the
  presence of `daily_entries` rows, which is reliable because ONLY the `/finalize` endpoint
  writes that table. Has a **daily-deliveries line chart** (recharts `LineChart`, morning/evening/total L per day of
  a month, `RangeShifter` month nav) fed by `daily_entries` (morning_qty/evening_qty/date) —
  reuses the `rawMilkDeliveries` fetch (extended to select morning/evening) filtered client-side.
- `Cattle` / `CattleDetail` — cattle master + per-cattle daily milk (`cattle_milk_entries`).
- `MilkProduction` — total production analytics per cattle. `ButtermilkProduction` — buttermilk produced.
- `DailyEntry` — the delivery lock/unlock/finalize UI; calls backend `/api/daily-entry` via `apiGet`/`apiPost` (NOT direct supabase). See `mem:backend/core`.
- `Customers` / `CustomerDetail` — customer master (rate, morning/evening qty, buttermilk fields, `custom_fields` jsonb pills + editor).
- `Bills` — monthly bill generation, Razorpay link, PDF, WhatsApp send, mark-paid. Core logic in
  `lib/bills.js`. Mark-cash modal has a **Cash vs QR** sub-type (`markCashPayment(bill, amt,
  customer, paidAt, mode)` — mode='cash'|'qr'; Razorpay webhook uses mode='upi'). Shows
  **per-method collected totals** (Cash / QR / Payment Link) for the month's paid bills as
  clickable filter cards. Payment modes rendered via `utils.paymentModeLabel` (upi → "Payment
  Link"). `bills.payment_mode`/`payments.mode` are free-text — no migration needed for 'qr'.
  Mark-cash modal also has a **"Send WhatsApp acknowledgement" checkbox** (default seeded from
  `automation_config.cash_ack_enabled` via `getAutomationConfig()`, overridable per payment) —
  shows an amber hint when the payment date is backdated. Dashboard's quick "Mark Paid" instead
  uses a `window.confirm()` before sending the ack (lighter-weight, matches its prompt()-based
  flow). **Important:** `cash_ack_enabled` in the Automation tab was previously a dead toggle —
  it was stored but never actually checked before sending; this is the only place it's now read
  (as a UI default, not a hard gate — the user can still override per-payment).
- `Sales` — direct product-sale invoices (`product_sales`); supports `credit` payment_mode (`paid=false`) + "Mark Paid".
- `Expenses` (categories from `expense_categories`), `Inventory` (items/categories, tracks `current_quantity` vs `in_use_quantity`), `Reminders`, `ImportExport`, `ActivityLogs` (reads backend `/api/logs`), `Settings` (edits localStorage dairy settings), `PaymentSuccess` (Razorpay redirect landing).

## lib/ helpers (reuse these)
- `supabase.js` — the shared client (anon key + normalized URL).
- `api.js` — `apiGet`/`apiPost`/`authHeaders` (attach supabase JWT bearer) for ALL backend calls.
- `constants.js` — `getSettings`/`saveSettings`/`getDairyInfo` (localStorage `dairy_settings`), `BACKEND_URL`, `API_KEY`, message-template defaults.
- `utils.js` — `formatQty`, `formatCurrency`, `formatDate`, `getMonthBounds`, `currentYearMonth`, `todayISO`, `isOverdue`, `getBillStatus`, `statusBadgeClass`, `paymentModeLabel` (cash/qr/upi→Payment Link),
  `cleanPhone`, `whatsappLink`, `last6Months`, `last30Days`, PDF-specific formatters.
- `bills.js` — `createBill`, `generateBillId` (rpc), `createRazorpayLink`, `confirmRazorpayPayment`, `markCashPayment`, `getPaidAmountForBill(s)`, `generateAllMonthlyBills`, `getMonthlyBillPackages`, `loadCustomerMonthStats`, `ensureRazorpayForUnpaidBills`, `reconcileRazorpayPayments`, `wakeBackend`.
- `gst.js` — `calculateGst(subtotal)` → {subtotal,cgst,sgst,igst,gstRate,grandTotal}; `amountInWords`.
- `messages.js` — WhatsApp templates (`buildBillWhatsAppMessage`, `buildReminderMessage`, `buildProductSaleWhatsAppMessage`, etc.) + `MESSAGE_*` constants/placeholders.
- `whatsapp.js` — `shareBillOnWhatsApp`, `shareProductSaleOnWhatsApp`, `sendReminderWhatsApp`,
  `validatePhone`. All "Manual" fallback buttons route through here → always `window.open(wa.me
  link)`, never `navigator.share`. (2026-07 fix: the two file-attach functions used to try
  `navigator.share({files})` first on devices where `canShare` returns true — but the OS share
  sheet cannot target a specific WhatsApp contact, forcing the user to manually pick the chat,
  which is exactly the "Manual" button's one job to avoid. Removed that branch entirely; PDF is
  now always downloaded + the correct chat opened via `wa.me`, attach is a manual step.)
- `pdf.js` — jsPDF bill generation (`generateBill`, `openBillPdf`, `downloadBillPdf`, `generateProductSaleBill`, ...).
- `import-export.js` — xlsx/CSV customer & cattle import (field matching, templates). `export-data.js` — xlsx exporters (deliveries, production, customer list, monthly bill status, sales, buttermilk).
  `exportMonthlyBillStatus` (2026-07 fix): was built from `customers.eq('active', true)` only —
  same root bug as billing/daily-entry, so a paused customer's bill/entries for the period were
  silently dropped from the export while still showing in the Bills tab (which queries `bills`
  directly with no active filter), causing a real mismatch the user caught. Rewritten to build
  rows from the UNION of customer IDs present in `bills` OR `daily_entries` for the period
  (regardless of active), joined back to `customers` for display — matches the Bills tab's
  result set. Added a `customer_status` column ('active'|'paused') to the export for visibility.

## Components (`components/`)
`Navbar`, `ProtectedRoute`, `Toast`, `LoadingOverlay`, `StatCard`, `BillCard`, `CustomerCard`, `CattleCard`, `QtyControl` (qty stepper, rounds input), `WhatsAppSendQueue` (batch WhatsApp send UI).
