# Database Schema (Supabase Postgres)

**Verified live 2026-07-04** against project `Billing` (id `pvqxgghvzhhdidpdekos`, org xyokgtvbvmmmrerzznyi, region ap-northeast-1, PG17) — all 19 tables + the ALTER-added columns below confirmed present. (Second project `itsPrashantsingh's Project` is INACTIVE, ignore it.)

Base: `supabase/schema.sql`. Incremental: `supabase/migrations/00X_*.sql` (run manually, in order). All tables have RLS enabled with a single permissive policy `for all to authenticated using (true) with check (true)`.

## Tables (current, after all migrations)
- `customers` — id(uuid), customer_id(text `CUS-000N`, auto trigger), name, whatsapp_no, address, gstin, rate(def 83), morning_qty, evening_qty, buttermilk_required(bool), buttermilk_quantity, buttermilk_rate, custom_fields(jsonb), active, created_at.
- `daily_entries` — customer_id, date, morning_qty, evening_qty, **total_qty = generated(morning+evening)**, rate, **amount = generated(total*rate)**, notes; unique(customer_id,date).
- `buttermilk_entries` — customer_id, date, quantity, rate, **amount = generated(qty*rate)**; unique(customer_id,date).
- `milk_production` — date(unique), morning/evening/total_litres. LEGACY, empty in prod (0 rows); use `cattle_milk_entries`.
- `buttermilk_production` — date(unique), quantity.
- `cattle` — id, cattle_id(text `CTL-000N`, auto trigger), name(unique), breed, category check('cow','buffalo'), custom_fields, active.
- `cattle_milk_entries` — cattle_id, date, morning/evening/**total_litres(generated)**; unique(cattle_id,date). Active production table.
- `bills` — **id is text** (`BILL-00N`), customer_id, period_start/end, total_litres, subtotal, cgst/sgst/igst, gst_rate, total_amount, paid(bool), paid_at, payment_mode, razorpay_link_id, razorpay_short_url, sent_at, buttermilk_total_qty, buttermilk_subtotal; unique(customer_id,period_start,period_end).
- `payments` — bill_id(text→bills), customer_id, amount, mode, razorpay_payment_id, notes, paid_at(timestamptz). Cash-collected ledger.
- `product_sales` — product_id, invoice_no(text `SALE-000N`, unique), date, buyer_name/phone/gstin, product_name, category, unit, hsn_code, quantity, rate, subtotal, gst_rate, cgst/sgst/igst, total_amount, payment_mode(def 'cash'; also 'credit'), **paid(bool def true)**, **paid_at(date)**, notes, sent_at. paid/paid_at added via ALTER (not in bare schema.sql) — confirmed live.
- `products` — category, name, unit, stock_qty, price, gst_rate, hsn_code, active.
- `expenses` — date, category(text; FK-by-name to expense_categories), amount, note.
- `expense_categories` — name(unique), archived, sort_order. Seeded (Feed, Veterinary, Salary, ...).
- `inventory_categories` — name(unique). Seeded (Tools, Equipment, ...).
- `inventory_items` — category_id, name, unit, quantity(purchase), current_quantity, **in_use_quantity(added via ALTER, confirmed live, def 0)**, purchase_date, purchase_price, notes, active. Available = current - in_use.
- `reminders` — customer_id, message, sent_at.
- `daily_entry_sessions` — date(pk), status('locked'|'unlocked'|'finalized'), unlocked/locked/finalized _by/_email/_at. Delivery workflow state.
- `daily_entry_drafts` — customer_id, date, morning/evening_qty, rate, delivered, updated_by/_email/_at; unique(customer_id,date). Staging before finalize.
- `activity_logs` — user_id, user_email, action, entity_type, entity_id, entity_date, details(jsonb: module, table, operation, changedFields, before, after), created_at. Indexed on created_at/user_id/(entity_type,entity_date).

## WhatsApp automation tables (migration 013/014)
- `whatsapp_messages` — provider, wamid, to_phone, customer_id, message_type, entity_id
  (bill id text / sale id), template_name, status (queued|sent|delivered|read|failed|invalid_number),
  cost, error, sent_by_email, created/updated_at. Message audit + dedupe + delivery status.
- `automation_config` — single row id=1: bill_generation_day, bill_send_day, scheduler_enabled,
  reminders_enabled, cash_ack_enabled, razorpay_ack_enabled, reminder_tiers(jsonb
  [{days,template,label}]), cutoff_days, email_report_enabled, report_email,
  carryforward_enabled, carryforward_interval_days (migration 015),
  razorpay_reconcile_enabled (migration 016, default true).
- `automation_runs` — run_type (generate|send|reminders|email), ran_at, counts(jsonb), errors(jsonb).
- Added columns: `bills.pdf_url`, `product_sales.pdf_url`, `cattle_milk_entries.updated_by_email`
  + `updated_at` (saver traceability), `customers.whatsapp_opted_in`.
- Storage bucket `bill-pdfs` (public read) holds generated bill/sale PDFs.
See `mem:whatsapp_automation`.

## Sequences & RPC functions
- Sequences: `bill_seq`, `product_sale_seq`, `cattle_seq`, `customer_seq`.
- RPCs (callable from frontend `supabase.rpc(...)`): `next_bill_id()`→`BILL-00N`, `next_product_sale_invoice_no()`→`SALE-000N`, `next_cattle_id()`, `next_customer_id()`.
- BEFORE-INSERT triggers auto-assign cattle_id/customer_id when null.

## Activity-log triggers
- `log_table_activity(module)` trigger fn (SECURITY DEFINER) on customers, milk_production, cattle, cattle_milk_entries, bills, payments, expenses, products, product_sales, buttermilk_entries, buttermilk_production. Captures before/after + changedFields.
- Migration 012 **dropped** the `daily_entries` row trigger (was spam) — delivery audit comes from backend `logActivity` instead.

## Migration index (`supabase/migrations/`)
002 milk_production · 003 gst (bill gst cols + customer gstin) · 004 bill_constraints · 005 auth_rls · 006 cattle · 007 product_sales · 008 delivery_workflow_logs (sessions/drafts/activity_logs + triggers) · 009 ids_categories (cattle_id/customer_id seqs + expense_categories) · 010 inventory · 011
buttermilk · 012 fix_delivery_trigger · 013 whatsapp_automation (whatsapp_messages,
automation_config, automation_runs, bills.pdf_url, product_sales.pdf_url,
cattle_milk_entries.updated_by_email/updated_at, customers.whatsapp_opted_in, bill-pdfs bucket)
· 014 automation_email_report (email_report_enabled, report_email) · 015
carryforward_reminders (carryforward_enabled, carryforward_interval_days) · 016
razorpay_auto_reconcile (razorpay_reconcile_enabled).
