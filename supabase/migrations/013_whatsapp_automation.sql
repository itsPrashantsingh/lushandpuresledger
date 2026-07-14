-- ============================================================
-- 013: WhatsApp automation subsystem
-- Run in Supabase SQL Editor
-- ============================================================

-- ── Message log (audit + idempotency + delivery status) ──────
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'payperwa',
  wamid text,
  to_phone text,
  customer_id uuid references customers(id) on delete set null,
  message_type text not null,          -- bill | payment_reminder_t1 | ... | cash_received | razorpay_received | product_sale
  entity_id text,                      -- bill id (text) or product_sale id (uuid) as text
  template_name text,
  status text not null default 'queued', -- queued | sent | delivered | read | failed | invalid_number
  cost numeric default 0,
  error text,
  sent_by_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists whatsapp_messages_wamid_idx on whatsapp_messages(wamid);
create index if not exists whatsapp_messages_entity_idx on whatsapp_messages(message_type, entity_id);
create index if not exists whatsapp_messages_status_idx on whatsapp_messages(status);
create index if not exists whatsapp_messages_created_idx on whatsapp_messages(created_at desc);

-- ── Automation configuration (single row, read by the cron) ──
create table if not exists automation_config (
  id int primary key default 1 check (id = 1),
  bill_generation_day int not null default 1 check (bill_generation_day between 1 and 28),
  bill_send_day int not null default 2 check (bill_send_day between 1 and 28),
  scheduler_enabled boolean not null default false,
  reminders_enabled boolean not null default false,
  cash_ack_enabled boolean not null default true,
  razorpay_ack_enabled boolean not null default true,
  reminder_tiers jsonb not null default '[
    {"days": 7,  "template": "payment_reminder_t1", "label": "First reminder"},
    {"days": 15, "template": "payment_reminder_t2", "label": "Second reminder"}
  ]'::jsonb,
  cutoff_days int not null default 20,
  updated_at timestamptz default now(),
  updated_by_email text
);

insert into automation_config (id) values (1) on conflict (id) do nothing;

-- ── Scheduler run history (health view) ─────────────────────
create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,              -- generate | send | reminders | cron
  ran_at timestamptz default now(),
  counts jsonb default '{}',
  errors jsonb default '[]'
);

create index if not exists automation_runs_ran_at_idx on automation_runs(ran_at desc);

-- ── Column additions ─────────────────────────────────────────
alter table bills add column if not exists pdf_url text;
alter table product_sales add column if not exists pdf_url text;
alter table cattle_milk_entries add column if not exists updated_by_email text;
alter table cattle_milk_entries add column if not exists updated_at timestamptz;
alter table customers add column if not exists whatsapp_opted_in boolean default true;

-- ── RLS ──────────────────────────────────────────────────────
alter table whatsapp_messages enable row level security;
alter table automation_config enable row level security;
alter table automation_runs enable row level security;

drop policy if exists "Auth users on whatsapp_messages" on whatsapp_messages;
drop policy if exists "Auth users on automation_config" on automation_config;
drop policy if exists "Auth users on automation_runs" on automation_runs;

create policy "Auth users on whatsapp_messages" on whatsapp_messages
  for all to authenticated using (true) with check (true);
create policy "Auth users on automation_config" on automation_config
  for all to authenticated using (true) with check (true);
create policy "Auth users on automation_runs" on automation_runs
  for all to authenticated using (true) with check (true);

-- ── Storage bucket for public bill PDFs ─────────────────────
insert into storage.buckets (id, name, public)
values ('bill-pdfs', 'bill-pdfs', true)
on conflict (id) do nothing;

drop policy if exists "Public read bill-pdfs" on storage.objects;
create policy "Public read bill-pdfs" on storage.objects
  for select using (bucket_id = 'bill-pdfs');

drop policy if exists "Auth write bill-pdfs" on storage.objects;
create policy "Auth write bill-pdfs" on storage.objects
  for insert to authenticated with check (bucket_id = 'bill-pdfs');

drop policy if exists "Auth update bill-pdfs" on storage.objects;
create policy "Auth update bill-pdfs" on storage.objects
  for update to authenticated using (bucket_id = 'bill-pdfs');
