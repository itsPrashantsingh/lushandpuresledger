-- ============================================================
-- 014: Email report config (monthly bills emailed to owner)
-- Run in Supabase SQL Editor
-- ============================================================

alter table automation_config add column if not exists email_report_enabled boolean not null default false;
alter table automation_config add column if not exists report_email text;
