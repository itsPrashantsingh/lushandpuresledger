-- Run this in Supabase SQL Editor if you already created the database earlier

create table if not exists milk_production (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  morning_litres numeric default 0,
  evening_litres numeric default 0,
  total_litres numeric generated always as (morning_litres + evening_litres) stored,
  notes text,
  created_at timestamptz default now()
);

alter table milk_production enable row level security;

create policy "Allow all on milk_production" on milk_production for all using (true) with check (true);
