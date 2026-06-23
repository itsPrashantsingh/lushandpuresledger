-- ============================================================
-- 011: Buttermilk subscription system
-- Run in Supabase SQL Editor
-- ============================================================

-- ── Customer subscription fields ─────────────────────────────
alter table customers add column if not exists buttermilk_required boolean default false;
alter table customers add column if not exists buttermilk_quantity numeric default 0;
alter table customers add column if not exists buttermilk_rate numeric default 0;

-- ── Daily buttermilk delivery per customer (single qty, not morning/evening) ──
create table if not exists buttermilk_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  date date not null,
  quantity numeric default 0 check (quantity >= 0),
  rate numeric not null default 0,
  amount numeric generated always as (quantity * rate) stored,
  notes text,
  created_at timestamptz default now(),
  unique(customer_id, date)
);

-- ── Buttermilk production (independent — no cattle linkage) ──
create table if not exists buttermilk_production (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  quantity numeric default 0 check (quantity >= 0),
  notes text,
  created_at timestamptz default now()
);

-- ── Extend bills for buttermilk totals ───────────────────────
-- buttermilk_total_qty: total litres delivered this month
-- buttermilk_subtotal: qty × rate (rate stored on customer, so we record subtotal)
alter table bills add column if not exists buttermilk_total_qty numeric default 0;
alter table bills add column if not exists buttermilk_subtotal numeric default 0;

alter table buttermilk_entries enable row level security;
alter table buttermilk_production enable row level security;

drop policy if exists "Auth users on buttermilk_entries" on buttermilk_entries;
drop policy if exists "Auth users on buttermilk_production" on buttermilk_production;

create policy "Auth users on buttermilk_entries" on buttermilk_entries
  for all to authenticated using (true) with check (true);

create policy "Auth users on buttermilk_production" on buttermilk_production
  for all to authenticated using (true) with check (true);

-- Activity log triggers
drop trigger if exists log_buttermilk_entries_activity on buttermilk_entries;
create trigger log_buttermilk_entries_activity
  after insert or update or delete on buttermilk_entries
  for each row execute function log_table_activity('buttermilk');

drop trigger if exists log_buttermilk_production_activity on buttermilk_production;
create trigger log_buttermilk_production_activity
  after insert or update or delete on buttermilk_production
  for each row execute function log_table_activity('buttermilk_production');
