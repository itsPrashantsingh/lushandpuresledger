const crypto = require('crypto')
const Razorpay = require('razorpay')
const supabase = require('./supabase')
const { markBillPaidFromRazorpay } = require('./mark-paid')

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
})

/** Verify Razorpay payment-link redirect signature (callback URL params) */
function verifyCallbackSignature(params) {
  const {
    razorpay_payment_id: paymentId,
    razorpay_payment_link_id: linkId,
    razorpay_payment_link_reference_id: referenceId,
    razorpay_payment_link_status: status,
    razorpay_signature: signature
  } = params

  if (!signature || !linkId || !referenceId || !status || !paymentId) return false

  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) return false

  const payload = `${linkId}|${referenceId}|${status}|${paymentId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return expected === signature
}

async function fetchPaymentIdFromLink(link) {
  if (link.payments?.[0]) return link.payments[0]
  try {
    const payments = await razorpay.paymentLink.fetchAllPayments(link.id)
    return payments?.items?.[0]?.id || null
  } catch {
    return null
  }
}

/**
 * Check Razorpay API and mark bill paid if link status is paid.
 * Returns { success, synced, alreadyPaid, status, billId, amountPaid, message }
 */
async function syncBillFromRazorpay(billId) {
  const { data: bill, error: billErr } = await supabase
    .from('bills')
    .select('id, paid, razorpay_link_id, total_amount')
    .eq('id', billId)
    .single()

  if (billErr || !bill) {
    return { success: false, error: 'Bill not found', billId }
  }

  if (bill.paid) {
    return { success: true, alreadyPaid: true, billId }
  }

  if (!bill.razorpay_link_id) {
    return { success: false, error: 'No Razorpay link on this bill', billId }
  }

  const link = await razorpay.paymentLink.fetch(bill.razorpay_link_id)

  if (link.status !== 'paid') {
    return {
      success: false,
      status: link.status,
      billId,
      message: `Razorpay link status is "${link.status}"`
    }
  }

  const paymentId = await fetchPaymentIdFromLink(link)
  const amountPaid = Number(link.amount_paid || link.amount || 0) / 100

  const result = await markBillPaidFromRazorpay({ billId, paymentId, amountPaid })

  return {
    success: true,
    synced: !result.duplicate && !result.alreadyPaid,
    alreadyPaid: result.alreadyPaid,
    duplicate: result.duplicate,
    billId,
    amountPaid: amountPaid || Number(bill.total_amount)
  }
}

/** Sync all unpaid bills that have a Razorpay link. Optionally scoped to a billing period. */
async function reconcileUnpaidBills({ periodStart, periodEnd } = {}) {
  let query = supabase
    .from('bills')
    .select('id')
    .eq('paid', false)
    .not('razorpay_link_id', 'is', null)

  if (periodStart) query = query.gte('period_start', periodStart)
  if (periodEnd) query = query.lte('period_end', periodEnd)

  const { data: bills } = await query

  const synced = []
  const errors = []

  for (const bill of bills || []) {
    try {
      const result = await syncBillFromRazorpay(bill.id)
      if (result.synced) synced.push(bill.id)
    } catch (err) {
      errors.push({ billId: bill.id, error: err.message })
    }
  }

  return { checked: (bills || []).length, synced, errors }
}

async function processWebhookEvent(event) {
  const linkEntity = event.payload?.payment_link?.entity
  const paymentEntity = event.payload?.payment?.entity
  const eventName = event.event

  if (
    eventName === 'payment_link.paid' ||
    eventName === 'payment_link.partially_paid' ||
    linkEntity?.status === 'paid'
  ) {
    if (!linkEntity?.reference_id) {
      throw new Error('Webhook missing reference_id')
    }

    const billId = linkEntity.reference_id
    const paymentId =
      paymentEntity?.id ||
      (Array.isArray(linkEntity.payments) ? linkEntity.payments[0] : null) ||
      null

    const amountPaid = Number(linkEntity.amount_paid || linkEntity.amount || 0) / 100

    return markBillPaidFromRazorpay({ billId, paymentId, amountPaid })
  }

  if (eventName === 'payment.captured' && paymentEntity) {
    const billId =
      paymentEntity.notes?.bill_id ||
      paymentEntity.description?.match(/BILL-\d+/)?.[0]

    if (billId) {
      return markBillPaidFromRazorpay({
        billId,
        paymentId: paymentEntity.id,
        amountPaid: Number(paymentEntity.amount) / 100
      })
    }
  }

  return { ok: true, ignored: true }
}

module.exports = {
  razorpay,
  verifyCallbackSignature,
  syncBillFromRazorpay,
  reconcileUnpaidBills,
  processWebhookEvent
}
