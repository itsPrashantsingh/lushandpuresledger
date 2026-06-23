-- Drop the per-row trigger on daily_entries.
-- The backend already logs delivery workflow events (unlocked/locked/finalized)
-- via activity_logs with full user context. This trigger fires once per customer
-- row on every finalize upsert using the service role key, producing dozens of
-- "Unknown user / Updated delivery" spam entries.

drop trigger if exists log_daily_entries_activity on daily_entries;

-- Also clean up the historical noise from the existing spam logs.
-- Removes the raw row-level "deliveries_update" / "deliveries_insert" entries
-- that came from the trigger (they have no user_id and say "update"/"insert"
-- in details.operation). Keep the meaningful backend-logged events
-- (daily_entry_unlocked, daily_entry_locked, daily_entry_finalized).

delete from activity_logs
where entity_type = 'deliveries'
  and action in ('deliveries_insert', 'deliveries_update', 'deliveries_delete')
  and user_id is null;
