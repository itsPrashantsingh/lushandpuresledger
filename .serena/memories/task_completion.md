# Task Completion Checklist

No test suite exists. Gates are lint + build + manual verification.

## Frontend changes
1. `cd frontend && npm run lint` — must pass (ESLint 10 flat config; react-hooks rules are strict about deps).
2. `npm run build` — must succeed; this is the only compile check (no tsc).
3. Manually verify in `npm run dev` if UI/logic changed.

## Backend changes
- No linter/build/tests. Sanity-run `npm start` and hit the affected route (or `/health`). Verify env vars referenced exist in `.env.example`.

## Database changes
- Add a NEW numbered migration file `supabase/migrations/0NN_name.sql` (don't edit old ones or bare `schema.sql` for incremental changes). Use `if not exists` / `add column if not exists` guards (idempotent, matches existing style). Remind the user to run it in the Supabase SQL Editor — there is no auto-runner. If a new table should be audited, add a `log_table_activity('<module>')` trigger (see migration 008) and an RLS policy.

## Don't
- Don't commit/push unless asked. Don't re-run builds just to confirm a Serena symbolic edit applied.
