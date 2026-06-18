# FreshMilk Dairy Ledger

Full-stack milk dairy billing app for a small Indian dairy business.

## Setup

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and run the full contents of `supabase/schema.sql`
3. Copy your project URL and anon key

### 2. Backend

```bash
cd backend
cp .env.example .env
# Fill in Razorpay + Supabase credentials
npm start
```

Runs on `http://localhost:3001`

### 3. Frontend

```bash
cd frontend
cp .env.example .env
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_BACKEND_URL
npm run dev
```

Opens on `http://localhost:5173`

## Razorpay Webhook

1. Razorpay Dashboard → Settings → Webhooks
2. URL: `https://your-backend.railway.app/webhook/razorpay`
3. Event: `payment_link.paid`
4. Copy webhook secret → `RAZORPAY_WEBHOOK_SECRET` in backend `.env`

## Features

- Customer ledger with **per-customer daily delivery** (separate morning + evening litres)
- **Total milk production** logging (morning/evening batches at dairy) — shown on dashboard
- PDF bill generation with Razorpay payment link
- WhatsApp deep links for bills and payment confirmations
- Auto-mark bills paid via Razorpay webhook
- Cash payment marking with partial payment support
- **Import customers** from CSV/XLSX (extra columns → custom fields)
- **Export** milk production, customer deliveries, customer list, monthly bill status
- Dashboard with revenue, dues, production charts, P&L
- Expense tracking and payment reminders

### If you already ran the original schema

Run `supabase/migrations/002_milk_production.sql` in Supabase SQL Editor to add the production table.

## Project Structure

```
billingSystem/
├── frontend/     React + Vite + Tailwind
├── backend/      Express (Razorpay webhook + payment links)
└── supabase/     Database schema
```
