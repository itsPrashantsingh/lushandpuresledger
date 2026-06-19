# Dairy Ledger — Deployment Guide

## Architecture

| Service | Host | Cost |
|---------|------|------|
| **Frontend** | Vercel | Free |
| **Backend** | Render (recommended) | Free tier |
| **Database** | Supabase | Free tier |

---

## Before you deploy

### 1. Run all SQL in Supabase (SQL Editor)

In order:
1. `supabase/schema.sql` (skip if DB already exists)
2. `supabase/migrations/002_milk_production.sql`
3. `supabase/migrations/003_gst.sql`
4. `supabase/migrations/004_bill_constraints.sql`
5. `supabase/migrations/005_auth_rls.sql`
6. `supabase/migrations/006_cattle.sql`

### 2. Code on GitHub

| Repo | Purpose |
|------|---------|
| **lushandpuresledger** | **Vercel deploys from this repo** |
| DairyLedger | Backup copy (optional) |

After code changes, push to the Vercel repo:

```bash
git add .
/usr/bin/git commit -m "Your message"
git push vercel main
```

If `vercel` remote is missing:

```bash
git remote add vercel https://github.com/itsPrashantsingh/lushandpuresledger.git
git push vercel main
```

---

## Deploy backend — Render (free, no trial)

Render’s **free web service** does not expire after 30 days (unlike Railway’s trial).

**Trade-off:** The service **sleeps after ~15 minutes** of no traffic. The first request after sleep takes **30–60 seconds** to wake up.

**Keep backend awake (recommended):** Use a free uptime monitor (e.g. [UptimeRobot](https://uptimerobot.com)) to ping `https://YOUR-RENDER-URL/health` every 5 minutes — helps webhooks arrive instantly.

### Payment automation (built-in)

Payments are confirmed through **4 layers** (no manual action needed):

1. **Razorpay webhook** → `payment_link.paid` marks bill paid
2. **Customer redirect** → `/payment-success` verifies signature + syncs (5 retries)
3. **Auto-reconcile** → opening Bills or Dashboard checks all unpaid Razorpay bills
4. **Manual sync** → "Sync Razorpay Payment" button on each bill (backup)

### Steps

1. Go to [render.com](https://render.com) → Sign up with GitHub
2. **New** → **Web Service** → connect `itsPrashantsingh/lushandpuresledger` (or `DairyLedger` if you prefer one repo)
3. Settings:

| Setting | Value |
|---------|--------|
| **Name** | `dairy-ledger-api` |
| **Region** | Singapore (closest to India) |
| **Root Directory** | `backend` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

4. Add environment variables:

| Variable | Value |
|----------|--------|
| `RAZORPAY_KEY_ID` | From Razorpay dashboard |
| `RAZORPAY_KEY_SECRET` | From Razorpay dashboard |
| `RAZORPAY_WEBHOOK_SECRET` | After creating webhook (below) |
| `SUPABASE_URL` | `https://xxx.supabase.co` (no `/rest/v1/`) |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → service_role key |
| `FRONTEND_URL` | Your Vercel URL (set after frontend deploy) |
| `API_KEY` | Long random secret you generate |

5. Click **Create Web Service**
6. You get a URL like `https://dairy-ledger-api.onrender.com`
7. Test: `https://YOUR-URL.onrender.com/health` → `{"ok":true}`

> **Tip:** Open `/health` once before generating bills — wakes the server so Razorpay links are fast.

### Razorpay webhook

1. Razorpay Dashboard → Settings → Webhooks → **Add New Webhook**
2. URL: `https://YOUR-RENDER-URL.onrender.com/webhook/razorpay`
3. Event: **`payment_link.paid`**
4. Copy secret → `RAZORPAY_WEBHOOK_SECRET` on Render → **Manual Deploy**

---

## Deploy frontend — Vercel (free)

1. [vercel.com](https://vercel.com) → project connected to **`lushandpuresledger`**
2. **Root Directory:** `frontend`
3. Build: `npm run build` → Output: `dist`
4. Environment variables:

| Variable | Value |
|----------|--------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_BACKEND_URL` | Your Render URL (e.g. `https://dairy-ledger-api.onrender.com`) |
| `VITE_API_KEY` | Same as backend `API_KEY` |

5. Deploy → note your URL (e.g. `https://dairy-ledger.vercel.app`)

### Update backend CORS

On Render → Environment → set `FRONTEND_URL` to your exact Vercel URL → **Manual Deploy**.

---

## Other backend options

| Platform | Cost | Notes |
|----------|------|--------|
| **Render** | Free forever | Sleeps when idle; best default |
| **Fly.io** | ~$5/mo credit free | Stays awake; [fly.io](https://fly.io) |
| **Railway** | Paid after trial | $5/mo hobby plan |
| **Oracle Cloud** | Always-free VM | More setup; never sleeps |

For a small dairy (~50 customers), **Render free is enough**.

---

## Admin login (one-time Supabase setup)

The app uses **Supabase Auth** — single admin email + password.

### 1. Supabase Dashboard → Authentication

1. **Providers** → Email → keep enabled
2. **Sign In / Providers** → turn **OFF** “Allow new users to sign up” (so random people cannot register)
3. **Users** → **Add user** → enter your admin email + password

### 2. Run RLS migration (SQL Editor)

Paste and run `supabase/migrations/005_auth_rls.sql` — blocks anonymous access to all tables.

### 3. Vercel env var

Add:

| Variable | Value |
|----------|--------|
| `VITE_ADMIN_EMAIL` | Same email as the admin user you created |

Redeploy Vercel after adding the variable.

### What stays public

- `/login` — login page only
- `/payment-success` — Razorpay redirect (no dairy data)
- Backend webhook — uses service key, not browser auth

---

## Auto redeploy?

| Change | Redeploys automatically? |
|--------|--------------------------|
| Push code to GitHub `main` on **lushandpuresledger** | **Yes** — Vercel redeploys automatically |
| New Vercel env var | **Yes** — trigger redeploy in Vercel dashboard |
| Supabase SQL migration | **No** — run `005_auth_rls.sql` manually once in SQL Editor |
| Create admin user in Supabase | **No** — one-time in dashboard |

---

## Post-deploy checklist

- [ ] `https://YOUR-BACKEND/health` returns OK
- [ ] Frontend loads and shows customers
- [ ] Settings: dairy name, GSTIN, address
- [ ] Generate test bill + Razorpay link (test mode)
- [ ] Razorpay webhook logs show 200
- [ ] Payment marks bill as paid in app

---

## Switch to live Razorpay

1. Razorpay Dashboard → **Live Mode**
2. New Live API keys → update on Render
3. New Live webhook → same Render URL

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bill/Razorpay very slow (60s) | Render was asleep — hit `/health` first, or wait |
| CORS error | `FRONTEND_URL` must exactly match Vercel URL |
| Invalid Supabase URL | No `/rest/v1/` suffix |
| Webhook not marking paid | URL must be `https://...onrender.com/webhook/razorpay` |
| 401 on create-link | `VITE_API_KEY` must match backend `API_KEY` |
