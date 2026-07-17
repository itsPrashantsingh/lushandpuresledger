# Frontend Core (`frontend/src/`)

React 19 SPA, Vite, Tailwind v4. Entry `main.jsx` → `App.jsx`.

## Routing & auth (`App.jsx`)
- `<AuthProvider>` (`lib/auth.jsx`) wraps everything; exposes `useAuth()` → `{user, loading, login, logout}` backed by `supabase.auth`.
- Public routes: `/login`, `/payment-success`. Everything else under `/*` is wrapped by `<ProtectedRoute>` (redirects to /login) + `<AppLayout>` (Navbar + main).
- To add a page: create `pages/X.jsx`, add `<Route>` in `App.jsx`, add a `{to,label,icon}` entry to the `links` array in `components/Navbar.jsx`.

## Pages (`pages/`) — each is a self-contained component fetching its own data via `supabase`
- `Dashboard` — KPIs, revenue/profit (date-range picker + `RangeShifter` month ◀▶), production
  charts (recharts), P&L, dues. Product sales counted in revenue/cash only when `paid=true`.
  Has a **daily-deliveries line chart** (recharts `LineChart`, morning/evening/total L per day of
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
- `whatsapp.js` — `shareBillOnWhatsApp`, `shareProductSaleOnWhatsApp`, `sendReminderWhatsApp`, `validatePhone` (opens wa.me links).
- `pdf.js` — jsPDF bill generation (`generateBill`, `openBillPdf`, `downloadBillPdf`, `generateProductSaleBill`, ...).
- `import-export.js` — xlsx/CSV customer & cattle import (field matching, templates). `export-data.js` — xlsx exporters (deliveries, production, customer list, monthly bill status, sales, buttermilk).

## Components (`components/`)
`Navbar`, `ProtectedRoute`, `Toast`, `LoadingOverlay`, `StatCard`, `BillCard`, `CustomerCard`, `CattleCard`, `QtyControl` (qty stepper, rounds input), `WhatsAppSendQueue` (batch WhatsApp send UI).
