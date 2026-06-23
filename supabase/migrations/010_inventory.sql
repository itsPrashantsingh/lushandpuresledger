-- ============================================================
-- 010: Inventory module
-- Run in Supabase SQL Editor
-- ============================================================

create table if not exists inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

insert into inventory_categories (name) values
  ('Tools'),
  ('Equipment'),
  ('Consumables'),
  ('Containers'),
  ('Machines'),
  ('Maintenance Items')
on conflict (name) do nothing;

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references inventory_categories(id) on delete set null,
  name text not null,
  unit text not null default 'pcs',
  quantity numeric default 0,
  current_quantity numeric default 0,
  purchase_date date,
  purchase_price numeric default 0,
  notes text,
  active boolean default true,
  created_at timestamptz default now()
);

alter table inventory_categories enable row level security;
alter table inventory_items enable row level security;

drop policy if exists "Auth users on inventory_categories" on inventory_categories;
drop policy if exists "Auth users on inventory_items" on inventory_items;

create policy "Auth users on inventory_categories" on inventory_categories
  for all to authenticated using (true) with check (true);

create policy "Auth users on inventory_items" on inventory_items
  for all to authenticated using (true) with check (true);
