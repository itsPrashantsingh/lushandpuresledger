# Suggested Commands

npm is the package manager (package-lock.json in both `frontend/` and `backend/`).

## Frontend (`cd frontend`)
- `npm install` — deps
- `npm run dev` — Vite dev server → http://localhost:5173
- `npm run build` — production build (also the real typecheck/compile gate; no tsc)
- `npm run lint` — ESLint over the project
- `npm run preview` — serve built output

## Backend (`cd backend`)
- `npm install`
- `npm start` (== `npm run dev`, both `node server.js`) → http://localhost:3001
- No tests, no linter, no build.

## Database
- No CLI migration runner configured. Apply `supabase/migrations/00X_*.sql` manually in the Supabase SQL Editor, in numeric order. `supabase/schema.sql` is the base (fresh install).

## Env setup
- `cp frontend/.env.example frontend/.env` and `cp backend/.env.example backend/.env`, then fill values.

## Serena memory upkeep
- `serena memories check` (from project root) — verify `mem:` references after renames/deletes.

## Darwin note
- Standard macOS/zsh. BSD `sed`/`date` differ from GNU; prefer node one-liners for date math.
