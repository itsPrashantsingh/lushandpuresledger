# Core — FreshMilk Dairy Ledger (billingSystem)

Full-stack milk-dairy billing app for a small Indian dairy ("Lush & Pures"). Monorepo, 3 parts:

- `frontend/` — React 19 + Vite + Tailwind v4 SPA. Talks to Supabase directly for CRUD; talks to backend only for Razorpay + the multi-user delivery lock workflow. See `mem:frontend/core`.
- `backend/` — Node/Express (CommonJS) on Render. Only handles: Razorpay payment links/webhooks/reconcile, the daily-entry lock/unlock/finalize workflow, activity-log reads. See `mem:backend/core`.
- `supabase/` — Postgres schema + numbered migrations. Auth + RLS + data. See `mem:database/schema`.

WhatsApp billing automation (PayPerWA/Meta provider abstraction, scheduler, reminders, email
report, the /whatsapp Automation tab): `mem:whatsapp_automation`.

Deep-dive references:
- Stack, versions, package managers: `mem:tech_stack`
- Dev/build/lint/deploy commands: `mem:suggested_commands`
- Code style & patterns to imitate when adding features: `mem:conventions`
- What to run before calling a task done: `mem:task_completion`

## Project-wide invariants
- **Two data paths.** Frontend uses the Supabase JS client (anon key + user JWT, RLS enforced) for almost all reads/writes. The Express backend is only for logic that needs the service-role key or server secrets (Razorpay, cross-user delivery locking). Don't move plain CRUD to the backend.
- **Auth = Supabase Auth.** Single shared login (email/password). Frontend session JWT is sent as `Authorization: Bearer` to backend; backend verifies via `supabase.auth.getUser(token)` (`backend/lib/auth.js`). Backend uses the **service-role** key (bypasses RLS).
- **RLS is permissive:** every table policy is `for all to authenticated using (true) with check (true)` — it's an internal tool, no per-row ownership. Any logged-in user sees everything.
- **Money model:** accrual revenue = `daily_entries` + `buttermilk_entries` amounts (generated columns). Cash collected = `payments` rows + `product_sales` where `paid=true`. Bills roll up a customer's monthly deliveries.
- **IDs:** bills = `BILL-001` (seq `bill_seq`, RPC `next_bill_id`), sales = `SALE-0001`, cattle = `CTL-0001`, customers = `CUS-0001` (auto-assigned via BEFORE INSERT triggers).
- **Quantities are floats** → always display via `formatQty()`/`formatCurrency()` (`frontend/src/lib/utils.js`) to avoid `4.9499999` artifacts.
- **Dairy settings live in browser localStorage** (`dairy_settings`), NOT the DB — see `getSettings()`/`getDairyInfo()` in `frontend/src/lib/constants.js`. Name, phone, UPI, GSTIN, GST rate, HSN, WhatsApp message templates.
