import { supabase } from './supabase'
import axios from 'axios'
import { getMonthBounds, getBillStatus } from './utils'
import { calculateGst } from './gst'
import { BACKEND_URL, API_KEY } from './constants'

/** Only entries with actual milk delivered */
export function billableEntries(entries) {
  return (entries || []).filter((e) => Number(e.total_qty) > 0 && Number(e.amount) > 0)
}

export function entrySubtotal(entries) {
  return billableEntries(entries).reduce((s, e) => s + Number(e.amount), 0)
}

export async function generateBillId() {
  const { data, error } = await supabase.rpc('next_bill_id')
  if (error) throw error
  return data
}

export async function createBill(customerId, periodStart, periodEnd, entries, customer = null, buttermilkData = null) {
  const valid = billableEntries(entries)
  const milkSubtotal = entrySubtotal(valid)
  const buttermilkQty = buttermilkData?.totalQty || 0
  const buttermilkSubtotal = buttermilkData?.subtotal || 0

  if (valid.length === 0 && buttermilkSubtotal <= 0) {
    throw new Error('No deliveries with quantity — cannot create bill')
  }
  if (milkSubtotal <= 0 && buttermilkSubtotal <= 0) {
    throw new Error('Bill amount is zero — cannot create bill')
  }

  const totalLitres = valid.reduce((s, e) => s + Number(e.total_qty), 0)
  const combinedSubtotal = milkSubtotal + buttermilkSubtotal
  const gst = calculateGst(combinedSubtotal)
  const billId = await generateBillId()

  const { data, error } = await supabase
    .from('bills')
    .insert({
      id: billId,
      customer_id: customerId,
      period_start: periodStart,
      period_end: periodEnd,
      total_litres: totalLitres,
      subtotal: gst.subtotal,
      cgst: gst.cgst,
      sgst: gst.sgst,
      igst: gst.igst,
      gst_rate: gst.gstRate,
      total_amount: gst.grandTotal,
      buttermilk_total_qty: buttermilkQty,
      buttermilk_subtotal: buttermilkSubtotal
    })
    .select('*, customers(*)')
    .single()

  if (error) throw error
  return { ...data, grandTotal: gst.grandTotal }
}

export async function createRazorpayLink(bill, customer) {
  if (bill.paid) throw new Error('Bill already paid')
  if (Number(bill.total_amount) <= 0) throw new Error('Bill amount is zero')

  const paid = await getPaidAmountForBill(bill.id)
  const balance = Number(bill.total_amount) - paid

  if (balance <= 0) {
    throw new Error('Nothing due on this bill')
  }

  const headers = API_KEY ? { 'x-api-key': API_KEY } : {}
  const res = await axios.post(`${BACKEND_URL}/api/razorpay/create-link`, {
    billId: bill.id,
    amount: balance,
    customerName: customer.name,
    customerPhone: customer.whatsapp_no,
    description: `Milk Bill ${bill.id}`
  }, { headers })

  const { error } = await supabase
    .from('bills')
    .update({
      razorpay_link_id: res.data.linkId,
      razorpay_short_url: res.data.shortUrl
    })
    .eq('id', bill.id)

  if (error) throw error
  return res.data.shortUrl
}

export async function syncRazorpayPayment(billId) {
  const headers = API_KEY ? { 'x-api-key': API_KEY } : {}
  const res = await axios.post(`${BACKEND_URL}/api/razorpay/verify-payment`, { billId }, { headers })
  return res.data
}

/** Public confirm after Razorpay redirect — includes signature params */
export async function confirmRazorpayPayment(payload) {
  const res = await axios.post(`${BACKEND_URL}/api/razorpay/confirm-payment`, payload)
  return res.data
}

/** Check all unpaid Razorpay bills against Razorpay API */
/** Sync Razorpay payment status for unpaid bills. Pass a 'YYYY-MM' month to scope it. */
export async function reconcileRazorpayPayments(month) {
  const headers = API_KEY ? { 'x-api-key': API_KEY } : {}
  const res = await axios.post(`${BACKEND_URL}/api/razorpay/reconcile`, month ? { month } : {}, { headers })
  return res.data
}

export async function wakeBackend() {
  try {
    await axios.get(`${BACKEND_URL}/health`, { timeout: 60000 })
  } catch {
    // ignore
  }
}

export async function getPaidAmountForBill(billId) {
  const { data } = await supabase
    .from('payments')
    .select('amount')
    .eq('bill_id', billId)

  return (data || []).reduce((s, p) => s + Number(p.amount), 0)
}

export async function getPaidAmountsForBills(billIds) {
  if (!billIds.length) return {}
  const { data } = await supabase
    .from('payments')
    .select('bill_id, amount')
    .in('bill_id', billIds)

  const map = {}
  ;(data || []).forEach((p) => {
    map[p.bill_id] = (map[p.bill_id] || 0) + Number(p.amount)
  })
  return map
}

export async function markCashPayment(bill, amount, customer, paidAt = null) {
  const numAmount = Number(amount)
  if (!numAmount || numAmount <= 0) throw new Error('Enter a valid amount')

  const paidSoFar = await getPaidAmountForBill(bill.id)
  const balance = Number(bill.total_amount) - paidSoFar
  if (balance <= 0) throw new Error('Bill is already fully paid')

  const applied = Math.min(numAmount, balance)
  const newTotal = paidSoFar + applied
  const fullyPaid = newTotal >= Number(bill.total_amount)
  const paymentTimestamp = paidAt ? new Date(paidAt).toISOString() : new Date().toISOString()

  const { error: payErr } = await supabase.from('payments').insert({
    bill_id: bill.id,
    customer_id: bill.customer_id,
    amount: applied,
    mode: 'cash',
    paid_at: paymentTimestamp
  })
  if (payErr) throw payErr

  if (fullyPaid) {
    const { error: billErr } = await supabase
      .from('bills')
      .update({
        paid: true,
        paid_at: paymentTimestamp,
        payment_mode: paidSoFar > 0 ? bill.payment_mode : 'cash'
      })
      .eq('id', bill.id)
    if (billErr) throw billErr
  }

  return { fullyPaid, newTotal, applied, customer }
}

export async function generateAllMonthlyBills(month, { withRazorpay = true, onProgress } = {}) {
  const { start, end } = getMonthBounds(month)

  // Not filtered by active — a customer paused mid-month must still be billed for the
  // days they were active. Eligibility is decided purely by whether they have billable
  // entries in this period (see the hasMilk/hasButtermilk check below).
  const [{ data: customers }, { data: existingBills }, { data: allEntries }, { data: allButtermilk }] = await Promise.all([
    supabase.from('customers').select('*').order('name'),
    supabase.from('bills').select('customer_id').gte('period_start', start).lte('period_end', end),
    supabase.from('daily_entries').select('*').gte('date', start).lte('date', end).order('date'),
    supabase.from('buttermilk_entries').select('customer_id, quantity, rate, amount').gte('date', start).lte('date', end)
  ])

  const buttermilkByCustomer = {}
  for (const b of allButtermilk || []) {
    if (!buttermilkByCustomer[b.customer_id]) buttermilkByCustomer[b.customer_id] = { totalQty: 0, subtotal: 0 }
    buttermilkByCustomer[b.customer_id].totalQty += Number(b.quantity)
    buttermilkByCustomer[b.customer_id].subtotal += Number(b.amount)
  }

  const billedCustomers = new Set((existingBills || []).map((b) => b.customer_id))
  const results = {
    created: [],
    skipped: [],
    noDelivery: [],
    zeroAmount: [],
    razorpay: [],
    errors: []
  }

  const eligible = []
  for (const customer of customers || []) {
    if (billedCustomers.has(customer.id)) {
      results.skipped.push(customer.name)
      continue
    }
    const entries = billableEntries((allEntries || []).filter((e) => e.customer_id === customer.id))
    const bm = buttermilkByCustomer[customer.id] || null
    const hasMilk = entries.length > 0 && entrySubtotal(entries) > 0
    const hasButtermilk = bm && bm.subtotal > 0

    if (!hasMilk && !hasButtermilk) {
      if (!entries.length && !hasButtermilk) results.noDelivery.push(customer.name)
      else results.zeroAmount.push(customer.name)
      continue
    }
    eligible.push({ customer, entries, buttermilkData: bm })
  }

  let i = 0
  for (const { customer, entries, buttermilkData } of eligible) {
    i++
    onProgress?.({ step: 'bill', current: i, total: eligible.length, name: customer.name })
    try {
      const bill = await createBill(customer.id, start, end, entries, customer, buttermilkData)
      results.created.push(bill)

      if (withRazorpay && Number(bill.total_amount) > 0) {
        try {
          onProgress?.({ step: 'razorpay', current: i, total: eligible.length, name: customer.name })
          const url = await createRazorpayLink(bill, customer)
          bill.razorpay_short_url = url
          results.razorpay.push(bill.id)
        } catch (err) {
          results.errors.push({ customer: customer.name, error: 'Razorpay: ' + err.message })
        }
      }
    } catch (err) {
      results.errors.push({ customer: customer.name, error: err.message })
    }
  }

  return results
}

export async function ensureRazorpayForUnpaidBills(month, onProgress) {
  const { start, end } = getMonthBounds(month)
  const { data: bills } = await supabase
    .from('bills')
    .select('*, customers(*)')
    .gte('period_start', start)
    .lte('period_end', end)
    .eq('paid', false)
    .gt('total_amount', 0)
    .is('razorpay_short_url', null)

  const results = []
  let i = 0
  for (const bill of bills || []) {
    i++
    onProgress?.({ step: 'razorpay', current: i, total: bills.length, name: bill.customers?.name })
    try {
      const url = await createRazorpayLink(bill, bill.customers)
      results.push({ billId: bill.id, url })
    } catch (err) {
      results.push({ billId: bill.id, error: err.message })
    }
  }
  return results
}

export async function getMonthlyBillPackages(month) {
  const { start, end } = getMonthBounds(month)
  const { data: bills } = await supabase
    .from('bills')
    .select('*, customers(*)')
    .gte('period_start', start)
    .lte('period_end', end)
    .gt('total_amount', 0)

  if (!bills?.length) return []

  const { data: entries } = await supabase
    .from('daily_entries')
    .select('*')
    .gte('date', start)
    .lte('date', end)
    .order('date')

  return bills.map((bill) => ({
    bill,
    customer: bill.customers,
    entries: billableEntries((entries || []).filter((e) => e.customer_id === bill.customer_id)),
    razorpayUrl: bill.razorpay_short_url
  }))
}

export async function loadCustomerMonthStats(customers, month) {
  const { start, end } = getMonthBounds(month)
  const ids = customers.map((c) => c.id)
  if (!ids.length) return {}

  const [{ data: entries }, { data: bills }] = await Promise.all([
    supabase.from('daily_entries').select('customer_id, amount, total_qty').in('customer_id', ids).gte('date', start).lte('date', end),
    supabase.from('bills').select('*').in('customer_id', ids).gte('period_start', start).lte('period_end', end)
  ])

  const paidMap = await getPaidAmountsForBills((bills || []).map((b) => b.id))

  const entryTotals = {}
  ;(entries || []).forEach((e) => {
    if (Number(e.total_qty) <= 0) return
    entryTotals[e.customer_id] = (entryTotals[e.customer_id] || 0) + Number(e.amount)
  })

  const billsByCustomer = {}
  ;(bills || []).forEach((b) => {
    billsByCustomer[b.customer_id] = b
  })

  const stats = {}
  customers.forEach((c) => {
    const monthTotal = entryTotals[c.id] || 0
    const bill = billsByCustomer[c.id]
    let status = 'paid'

    if (bill) {
      const paid = paidMap[bill.id] || 0
      status = getBillStatus(bill, paid)
      if (status === 'unpaid') status = 'due'
    } else if (monthTotal > 0) {
      status = 'due'
    }

    stats[c.id] = { monthTotal, status }
  })

  return stats
}

export function formatGenerationSummary(results) {
  const parts = []
  if (results.created?.length) parts.push(`${results.created.length} bills created`)
  if (results.razorpay?.length) parts.push(`${results.razorpay.length} payment links`)
  if (results.skipped?.length) parts.push(`${results.skipped.length} already billed`)
  if (results.noDelivery?.length) parts.push(`${results.noDelivery.length} no delivery`)
  if (results.zeroAmount?.length) parts.push(`${results.zeroAmount.length} zero amount`)
  if (results.errors?.length) parts.push(`${results.errors.length} errors`)
  return parts.join(' · ') || 'Nothing to generate'
}
