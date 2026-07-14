-- ============================================================
-- 015: Carry-forward reminders (repeat unpaid bills each cycle)
-- Run in Supabase SQL Editor
-- ============================================================

-- After a bill's escalation ladder finishes, keep reminding with a
-- "unpaid from {month}" message every N days until it is paid.
alter table automation_config add column if not exists carryforward_enabled boolean not null default true;
alter table automation_config add column if not exists carryforward_interval_days int not null default 7;
