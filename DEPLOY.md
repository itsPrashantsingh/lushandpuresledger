# Dairy Ledger — Deployment Guide

## Architecture

| Service | Host | Purpose |
|---------|------|---------|
| **Frontend** | Vercel | React app |
| **Backend** | Railway or Render | Razorpay links + webhooks |
| **Database** | Supabase | Already hosted |

---

## Before you deploy

### 1. Run all SQL in Supabase (SQL Editor)

In order:
1. `supabase/schema.sql` (skip if DB already exists)
2. `supabase/migrations/002_milk_production.sql`
3. `supabase/migrations/003_gst.sql`
4. `supabase/migrations/004_bill_constraints.sql`

### 2. Push code to GitHub

```bash
cd billingSystem
git init
git add .
git commit -m "Initial dairy ledger app"
# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USER/billingSystem.git
git push -u origin main
```

Do **not** commit `.env` files (they are in `.gitignore`).

---

## Deploy backend (Railway — recommended)

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Set **Root Directory** to `backend`
3. Start command: `npm start`
4. Add environment variables:

| Variable | Value |
|----------|--------|
| `RAZORPAY_KEY_ID` | From Razorpay dashboard |
| `RAZORPAY_KEY_SECRET` | From Razorpay dashboard |
| `RAZORPAY_WEBHOOK_SECRET` | From Razorpay webhooks (step below) |
| `SUPABASE_URL` | `https://xxx.supabase.co` (no `/rest/v1/`) |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → service_role key |
| `FRONTEND_URL` | Your Vercel URL (set after frontend deploy) |
| `API_KEY` | Random secret string you generate |

5. Railway gives you a URL like `https://billing-backend-production.up.railway.app`
6. Test: open `https://YOUR-BACKEND-URL/health` → should show `{"ok":true}`

### Razorpay webhook (production)

1. Razorpay Dashboard → Settings → Webhooks → Add
2. URL: `https://YOUR-BACKEND-URL/webhook/razorpay`
3. Event: `payment_link.paid`
4. Copy webhook secret → `RAZORPAY_WEBHOOK_SECRET` in Railway

---

## Deploy frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) → Add New Project → Import GitHub repo
2. Set **Root Directory** to `frontend`
3. Framework: Vite (auto-detected)
4. Build command: `npm run build`
5. Output directory: `dist`
6. Environment variables:

| Variable | Value |
|----------|--------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_BACKEND_URL` | Your Railway backend URL |
| `VITE_API_KEY` | Same as backend `API_KEY` |

7. Deploy → you get `https://your-app.vercel.app`

### Update backend CORS

Go back to Railway → set `FRONTEND_URL` to your Vercel URL → redeploy backend.

---

## Deploy backend (Render — alternative)

1. [render.com](https://render.com) → New → Web Service → connect repo
2. Root Directory: `backend`
3. Build: `npm install`
4. Start: `npm start`
5. Same env vars as Railway above

---

## Post-deploy checklist

- [ ] `https://YOUR-BACKEND/health` returns OK
- [ ] Frontend loads and shows customers
- [ ] Settings page: fill dairy name, GSTIN, address
- [ ] Generate one test bill + Razorpay link (test mode)
- [ ] Razorpay webhook shows 200 in dashboard logs
- [ ] WhatsApp send works on phone (PDF auto-attach)

---

## Switch to live Razorpay

When ready for real payments:
1. Razorpay Dashboard → switch to **Live Mode**
2. Generate **Live** API keys
3. Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` on Railway
4. Create new **Live** webhook with same backend URL

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| CORS error on bill generate | `FRONTEND_URL` on backend must exactly match Vercel URL |
| Invalid Supabase URL | No `/rest/v1/` suffix |
| Razorpay link fails | Backend running? `VITE_BACKEND_URL` correct? |
| Webhook not marking paid | Webhook URL must be public HTTPS, not localhost |
| 401 on create-link | `VITE_API_KEY` must match backend `API_KEY` |
