# Tech Stack

## Frontend (`frontend/`)
- React 19, react-dom 19, react-router-dom 7 (SPA, `BrowserRouter` in `src/App.jsx`).
- Vite 8 (`vite.config.js`), ESM (`"type": "module"`).
- Tailwind CSS v4 via `@tailwindcss/vite` plugin (no tailwind.config.js; single import in `src/index.css`). Utility classes only, green-600 brand accent.
- Supabase JS client `@supabase/supabase-js` v2.
- axios (backend calls), recharts (dashboard charts), jspdf + jspdf-autotable (bill PDFs), xlsx (CSV/XLSX import-export).
- ESLint 10 flat config (`eslint.config.js`) + react-hooks + react-refresh plugins.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BACKEND_URL`, optional `VITE_API_KEY`.

## Backend (`backend/`)
- Node.js + Express **5**, CommonJS (`require`, `"type": "commonjs"`).
- `@supabase/supabase-js` v2 with **service-role** key (`backend/lib/supabase.js`).
- `razorpay` SDK v2, `cors`, `dotenv`.
- No test/lint tooling, no build step — `node server.js`.
- Env (`backend/.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `FRONTEND_URL` (comma-sep CORS allowlist), `PORT` (default 3001), optional `API_KEY`.

## Database
- Supabase Postgres. Schema in `supabase/schema.sql` + `supabase/migrations/00X_*.sql` (run manually in SQL Editor, numbered order).

## Deploy
- Frontend → Vercel (`frontend/vercel.json`, root `vercel.json`). Backend → Render (`backend/render.yaml`). See `DEPLOY.md`.
