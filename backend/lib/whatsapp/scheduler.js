const supabase = require('../supabase')
const { sendMessage } = require('./send')
const { generateAllMonthlyBills, getMonthlyBillPackages, getPaidAmountForBill } = require('../billing')
const { billPdfBuffer } = require('../pdf')
const { uploadBillPdf } = require('../storage')
const { sendBillsReport } = require('../email/bill-report')
const { reconcileUnpaidBills } = require('../razorpay-sync')

async function getConfig() {
  const { data } = await supabase.from('automation_config').select('*').eq('id', 1).single()
  return data || {}
}

function prevMonth(d = new Date()) {
  const dt = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

async function recordRun(runType, counts, errors = []) {
  await supabase.from('automation_runs').insert({ run_type: runType, counts, errors })
}

async function runGenerate(month) {
  const results = await generateAllMonthlyBills(month, { withRazorpay: true })
  const counts = {
    month,
    created: results.created.length,
    skipped: results.skipped.length,
    razorpay: results.razorpay.length,
    noDelivery: results.noDelivery.length
  }
  await recordRun('generate', counts, results.errors)
  return counts
}

/** Generate + upload every bill PDF for the month; returns items with buffers + public URLs. */
async function buildBillPdfs(month) {
  const packages = await getMonthlyBillPackages(month)
  const items = []
  for (const pkg of packages) {
    const pdfBuffer = billPdfBuffer(pkg.customer, pkg.entries, pkg.bill)
    let publicUrl = pkg.bill.pdf_url || null
    try {
      publicUrl = await uploadBillPdf(pkg.bill.id, pdfBuffer)
      await supabase.from('bills').update({ pdf_url: publicUrl }).eq('id', pkg.bill.id)
    } catch (e) {
      // keep the buffer for email even if the upload/host step fails
    }
    items.push({ bill: pkg.bill, customer: pkg.customer, pdfBuffer, filename: `${pkg.bill.id}.pdf`, publicUrl })
  }
  return items
}

/** Send unsent, unpaid bills for the month via WhatsApp (PDF attached). */
async function sendBillsFromItems(items) {
  let sent = 0
  let failed = 0
  const errors = []
  for (const it of items) {
    if (it.bill.paid || it.bill.sent_at) continue
    const res = await sendMessage('bill', {
      to: it.customer.whatsapp_no,
      customerId: it.bill.customer_id,
      entityId: it.bill.id,
      name: it.customer.name,
      period: `${it.bill.period_start} to ${it.bill.period_end}`,
      amount: it.bill.total_amount,
      payUrl: it.bill.razorpay_short_url || '',
      documentUrl: it.publicUrl,
      filename: it.filename
    }, { dedupe: true })
    if (res.ok) {
      sent++
      await supabase.from('bills').update({ sent_at: new Date().toISOString() }).eq('id', it.bill.id)
    } else if (!res.skipped) {
      failed++
      errors.push({ bill: it.bill.id, error: res.error })
    }
  }
  await recordRun('send', { sent, failed }, errors)
  return { sent, failed }
}

/**
 * Reminders for overdue unpaid bills. Each bill runs its own escalation ladder
 * (tiers once each, then supply cut-off once). After the ladder finishes, the bill
 * flips into a repeating "unpaid from {month}" carry-forward reminder every
 * carryforward_interval_days, using that bill's own payment link, until it is paid.
 * All state is per-bill (entity_id), so multiple pending months are handled independently.
 */
async function runReminders(config) {
  const tiers = [...(config.reminder_tiers || [])].sort((a, b) => a.days - b.days)
  const cutoffDays = Number(config.cutoff_days || 0)
  const maxTierDay = tiers.reduce((m, t) => Math.max(m, Number(t.days) || 0), 0)
  const ladderEnd = Math.max(cutoffDays, maxTierDay)
  const cfEnabled = config.carryforward_enabled !== false
  const cfIntervalMs = (Number(config.carryforward_interval_days) || 7) * 86400000

  const { data: bills } = await supabase.from('bills').select('*, customers(*)').eq('paid', false).gt('total_amount', 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let sent = 0
  let carried = 0
  const errors = []

  for (const bill of bills || []) {
    if (!bill.customers) continue
    const end = new Date(bill.period_end + 'T00:00:00')
    const daysOverdue = Math.floor((today - end) / 86400000)

    const paid = await getPaidAmountForBill(bill.id)
    const balance = Number(bill.total_amount) - paid
    if (balance <= 0) continue

    const monthName = new Date(bill.period_start + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    const ctx = {
      to: bill.customers.whatsapp_no, customerId: bill.customer_id, entityId: bill.id,
      name: bill.customers.name, month: monthName, amount: balance, payUrl: bill.razorpay_short_url || ''
    }
    let sentSomething = false

    // 1) Escalation ladder — highest due tier not already sent (once each)
    const dueTiers = tiers.filter((t) => daysOverdue >= t.days)
    let chosen = null
    for (let i = dueTiers.length - 1; i >= 0; i--) {
      const { data: exists } = await supabase
        .from('whatsapp_messages').select('id')
        .eq('message_type', dueTiers[i].template).eq('entity_id', bill.id)
        .in('status', ['queued', 'sent', 'delivered', 'read']).limit(1)
      if (!exists?.length) { chosen = dueTiers[i]; break }
    }
    if (chosen) {
      const res = await sendMessage(chosen.template, ctx, { dedupe: true })
      if (res.ok && !res.skipped) { sent++; sentSomething = true }
      else if (!res.ok) errors.push({ bill: bill.id, error: res.error })
    }

    // 2) Supply cut-off (once)
    if (cutoffDays && daysOverdue >= cutoffDays) {
      const res = await sendMessage('supply_cutoff', { ...ctx, cutoffDays }, { dedupe: true })
      if (res.ok && !res.skipped) { sent++; sentSomething = true }
      else if (!res.ok) errors.push({ bill: bill.id, error: res.error })
    }

    // 3) Carry-forward — after the ladder is done, repeat every cfInterval days until paid
    if (cfEnabled && ladderEnd > 0 && daysOverdue >= ladderEnd && !sentSomething) {
      const { data: lastCf } = await supabase
        .from('whatsapp_messages').select('created_at')
        .eq('message_type', 'bill_carryforward').eq('entity_id', bill.id)
        .in('status', ['queued', 'sent', 'delivered', 'read'])
        .order('created_at', { ascending: false }).limit(1)
      const due = !lastCf?.length || (today - new Date(lastCf[0].created_at)) >= cfIntervalMs
      if (due) {
        const res = await sendMessage('bill_carryforward', ctx)
        if (res.ok) { sent++; carried++ }
        else errors.push({ bill: bill.id, error: res.error })
      }
    }
  }

  await recordRun('reminders', { sent, carried }, errors)
  return { sent, carried }
}

/** Auto-sync all unpaid bills with a Razorpay link against the Razorpay API (marks paid + logs). */
async function runRazorpayReconcile() {
  const result = await reconcileUnpaidBills()
  await recordRun('razorpay_reconcile', { checked: result.checked, synced: result.synced.length }, result.errors)
  return result
}

/** Email all of a month's bills (every PDF attached) to the configured address. */
async function runEmailReport(month, to, prebuiltItems = null) {
  if (!to) return { ok: false, error: 'No recipient email configured' }
  const items = prebuiltItems || (await buildBillPdfs(month))
  if (!items.length) return { ok: false, error: `No bills for ${month}` }
  const res = await sendBillsReport({ to, month, items })
  await recordRun('email', { month, count: items.length, ok: res.ok }, res.ok ? [] : [{ error: res.error }])
  return { ...res, count: items.length, to }
}

/** Daily scheduler tick — decides what to run based on the config + today's date. */
async function runCron({ force, month } = {}) {
  const config = await getConfig()
  const day = new Date().getDate()
  const targetMonth = month || prevMonth()
  const results = { targetMonth }

  // Independent of the WhatsApp scheduler — syncs Razorpay payment status daily so
  // manual "sync" clicks aren't needed once the cron is running.
  if (config.razorpay_reconcile_enabled !== false || force === 'razorpay_reconcile') {
    results.razorpayReconcile = await runRazorpayReconcile()
  }

  if (config.scheduler_enabled && (day === config.bill_generation_day || force === 'generate')) {
    results.generate = await runGenerate(targetMonth)
  }

  if (config.scheduler_enabled && (day === config.bill_send_day || force === 'send')) {
    const items = await buildBillPdfs(targetMonth)
    results.send = await sendBillsFromItems(items)
    if (config.email_report_enabled && config.report_email) {
      results.email = await runEmailReport(targetMonth, config.report_email, items)
    }
  }

  if (config.reminders_enabled || force === 'reminders') {
    results.reminders = await runReminders(config)
  }

  return results
}

module.exports = { runCron, runGenerate, sendBillsFromItems, runReminders, runEmailReport, runRazorpayReconcile, buildBillPdfs, getConfig }
