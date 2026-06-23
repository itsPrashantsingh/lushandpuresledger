-- ============================================================
-- 009: Auto-increment cattle_id, customer_id + expense categories
-- Run in Supabase SQL Editor
-- ============================================================

-- ── Cattle ID ────────────────────────────────────────────────
create sequence if not exists cattle_seq start 1;

alter table cattle add column if not exists cattle_id text unique;

create or replace function next_cattle_id()
returns text language plpgsql as $$
declare seq_val bigint;
begin
  select nextval('cattle_seq') into seq_val;
  return 'CTL-' || lpad(seq_val::text, 4, '0');
end; $$;

create or replace function assign_cattle_id()
returns trigger language plpgsql as $$
begin
  if NEW.cattle_id is null then
    NEW.cattle_id := next_cattle_id();
  end if;
  return NEW;
end; $$;

drop trigger if exists cattle_before_insert on cattle;
create trigger cattle_before_insert
  before insert on cattle
  for each row execute function assign_cattle_id();

-- Backfill existing cattle (order by created_at for consistency)
do $$
declare r record;
begin
  for r in select id from cattle where cattle_id is null order by created_at loop
    update cattle set cattle_id = next_cattle_id() where id = r.id;
  end loop;
end; $$;

grant execute on function next_cattle_id() to authenticated, service_role;

-- ── Customer ID ───────────────────────────────────────────────
create sequence if not exists customer_seq start 1;

alter table customers add column if not exists customer_id text unique;

create or replace function next_customer_id()
returns text language plpgsql as $$
declare seq_val bigint;
begin
  select nextval('customer_seq') into seq_val;
  return 'CUS-' || lpad(seq_val::text, 4, '0');
end; $$;

create or replace function assign_customer_id()
returns trigger language plpgsql as $$
begin
  if NEW.customer_id is null then
    NEW.customer_id := next_customer_id();
  end if;
  return NEW;
end; $$;

drop trigger if exists customers_before_insert on customers;
create trigger customers_before_insert
  before insert on customers
  for each row execute function assign_customer_id();

-- Backfill existing customers
do $$
declare r record;
begin
  for r in select id from customers where customer_id is null order by created_at loop
    update customers set customer_id = next_customer_id() where id = r.id;
  end loop;
end; $$;

grant execute on function next_customer_id() to authenticated, service_role;

-- ── Expense Category Master ───────────────────────────────────
create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  archived boolean default false,
  sort_order int default 0,
  created_at timestamptz default now()
);

insert into expense_categories (name, sort_order) values
  ('Feed', 1),
  ('Veterinary', 2),
  ('Salary', 3),
  ('Transport', 4),
  ('Electricity', 5),
  ('Maintenance', 6),
  ('Equipment', 7),
  ('Miscellaneous', 8)
on conflict (name) do nothing;

alter table expense_categories enable row level security;

drop policy if exists "Auth users on expense_categories" on expense_categories;
create policy "Auth users on expense_categories" on expense_categories
  for all to authenticated using (true) with check (true);

-- Migrate old hardcoded categories to new proper-case names
update expenses set category = 'Feed'          where lower(category) = 'feed';
update expenses set category = 'Veterinary'    where lower(category) in ('medicine', 'veterinary', 'vet');
update expenses set category = 'Salary'        where lower(category) = 'salary';
update expenses set category = 'Transport'     where lower(category) = 'transport';
update expenses set category = 'Electricity'   where lower(category) = 'electricity';
update expenses set category = 'Maintenance'   where lower(category) = 'maintenance';
update expenses set category = 'Equipment'     where lower(category) in ('equipment', 'tools');
-- Anything else goes to Miscellaneous
update expenses set category = 'Miscellaneous'
  where category not in (
    'Feed','Veterinary','Salary','Transport',
    'Electricity','Maintenance','Equipment','Miscellaneous'
  );
