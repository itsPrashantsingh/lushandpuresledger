-- ============================================================
-- 016: Auto-sync Razorpay payments on the daily cron
-- Run in Supabase SQL Editor
-- ============================================================

alter table automation_config add column if not exists razorpay_reconcile_enabled boolean not null default true;
