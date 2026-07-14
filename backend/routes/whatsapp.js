const express = require('express')
const supabase = require('../lib/supabase')
const { requireUser } = require('../lib/auth')
const { getProvider } = require('../lib/whatsapp')
const { sendMessage } = require('../lib/whatsapp/send')

const router = express.Router()

function monthBounds(month) {
  const [y, m] = String(month).split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const last = new Date(y, m, 0).getDate()
  const end = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
  return { start, end }
}

async function getPaidAmount(billId) {
  const { data } = await supabase.from('payments').select('amount').eq('bill_id', billId)
  return (data || []).reduce((s, p) => s + Number(p.amount), 0)
}

/**
 * Build the template context for a message type from the referenced entity.
 * Body may override amount / to / documentUrl (e.g. for acknowledgements).
 */
async function buildContext(type, entityId, overrides = {}, sentByEmail) {
  if (type === 'product_sale') {
    const { data: sale } = await supabase.from('product_sales').select('*').eq('id', entityId).single()
    if (!sale) throw new Error('Sale not found')
    return {
      to: overrides.to || sale.buyer_phone,
      customerId: null,
      entityId: sale.id,
      name: sale.buyer_name,
      invoice: sale.invoice_no,
      product: sale.product_name,
      amount: overrides.amount ?? sale.total_amount,
      documentUrl: overrides.documentUrl || sale.pdf_url || null,
      filename: `${sale.invoice_no}.pdf`,
      sentByEmail
    }
  }

  // All other types are bill-centric
  const { data: bill } = await supabase.from('bills').select('*, customers(*)').eq('id', entityId).single()
  if (!bill) throw new Error('Bill not found')
  const customer = bill.customers || {}
  const paid = await getPaidAmount(bill.id)
  const balance = Number(bill.total_amount) - paid
  const monthName = new Date(bill.period_start + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long' })

  return {
    to: overrides.to || customer.whatsapp_no,
    customerId: bill.customer_id,
    entityId: bill.id,
    name: customer.name,
    period: `${bill.period_start} to ${bill.period_end}`,
    month: monthName,
    amount: overrides.amount ?? (type === 'bill' ? bill.total_amount : balance),
    payUrl: overrides.payUrl || bill.razorpay_short_url || '',
    documentUrl: overrides.documentUrl || bill.pdf_url || null,
    filename: `${bill.id}.pdf`,
    cutoffDays: overrides.cutoffDays,
    sentByEmail
  }
}

// ── Scheduler tick (API-key gated, no user) — engine wired in Phase 5 ──
function cronAuth(req, res, next) {
  // Dedicated cron secret (isolated from the Razorpay API_KEY); falls back to API_KEY.
  const key = process.env.CRON_SECRET || process.env.API_KEY
  if (key && req.headers['x-api-key'] !== key) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

router.post('/cron', cronAuth, async (req, res, next) => {
  try {
    const { runCron } = require('../lib/whatsapp/scheduler')
    const result = await runCron(req.body || {})
    res.json({ success: true, ...result })
  } catch (err) {
    next(err)
  }
})

// ── Everything below requires an authenticated user ──────────
router.use(requireUser)

router.get('/balance', async (req, res, next) => {
  try {
    const result = await getProvider().getBalance()
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.post('/send', async (req, res, next) => {
  try {
    const { type, entityId, ...overrides } = req.body
    if (!type || !entityId) return res.status(400).json({ error: 'type and entityId are required' })
    const ctx = await buildContext(type, entityId, overrides, req.user.email)
    const result = await sendMessage(type, ctx)
    if (type === 'bill' && result.ok) {
      await supabase.from('bills').update({ sent_at: new Date().toISOString() }).eq('id', entityId)
    }
    if (type === 'product_sale' && result.ok) {
      await supabase.from('product_sales').update({ sent_at: new Date().toISOString() }).eq('id', entityId)
    }
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.get('/config', async (req, res, next) => {
  try {
    const { data } = await supabase.from('automation_config').select('*').eq('id', 1).single()
    res.json({ config: data })
  } catch (err) {
    next(err)
  }
})

router.put('/config', async (req, res, next) => {
  try {
    const allowed = [
      'bill_generation_day', 'bill_send_day', 'scheduler_enabled', 'reminders_enabled',
      'cash_ack_enabled', 'razorpay_ack_enabled', 'reminder_tiers', 'cutoff_days',
      'email_report_enabled', 'report_email', 'carryforward_enabled', 'carryforward_interval_days',
      'razorpay_reconcile_enabled'
    ]
    const patch = { updated_at: new Date().toISOString(), updated_by_email: req.user.email }
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k]
    const { data, error } = await supabase.from('automation_config').update(patch).eq('id', 1).select('*').single()
    if (error) throw error
    res.json({ config: data })
  } catch (err) {
    next(err)
  }
})

router.post('/email-report', async (req, res, next) => {
  try {
    const month = req.body.month || new Date().toISOString().slice(0, 7)
    const { data: config } = await supabase.from('automation_config').select('report_email').eq('id', 1).single()
    const to = req.body.to || config?.report_email
    const { runEmailReport } = require('../lib/whatsapp/scheduler')
    const result = await runEmailReport(month, to)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.get('/summary', async (req, res, next) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7)
    const { start, end } = monthBounds(month)
    const startTs = `${start}T00:00:00`
    const endTs = `${end}T23:59:59`

    const [billsRes, msgsRes, failuresRes, runRes, balance] = await Promise.all([
      supabase.from('bills').select('id, total_amount, sent_at').gte('period_start', start).lte('period_end', end),
      supabase.from('whatsapp_messages').select('message_type, status').gte('created_at', startTs).lte('created_at', endTs),
      supabase.from('whatsapp_messages').select('id, to_phone, message_type, error, created_at, customers(name, customer_id)').in('status', ['failed', 'invalid_number']).gte('created_at', startTs).lte('created_at', endTs).order('created_at', { ascending: false }).limit(50),
      supabase.from('automation_runs').select('*').order('ran_at', { ascending: false }).limit(5),
      getProvider().getBalance()
    ])

    const bills = billsRes.data || []
    const msgs = msgsRes.data || []
    const count = (pred) => msgs.filter(pred).length

    res.json({
      month,
      bills: { generated: bills.length, amount: bills.reduce((s, b) => s + Number(b.total_amount || 0), 0), sent: bills.filter((b) => b.sent_at).length },
      messages: {
        billsSent: count((m) => m.message_type === 'bill' && ['sent', 'delivered', 'read'].includes(m.status)),
        delivered: count((m) => m.status === 'delivered'),
        read: count((m) => m.status === 'read'),
        failed: count((m) => m.status === 'failed' || m.status === 'invalid_number'),
        reminders: count((m) => m.message_type.startsWith('payment_reminder') || m.message_type === 'supply_cutoff'),
        acknowledgements: count((m) => m.message_type === 'cash_received' || m.message_type === 'razorpay_received')
      },
      failures: failuresRes.data || [],
      recentRuns: runRes.data || [],
      balance
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
