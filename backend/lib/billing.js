// Server-side bill generation — ported from frontend/src/lib/bills.js.
const supabase = require('./supabase')
const { calculateGst } = require('./gst')
const { getMonthBounds } = require('./format')
const { razorpay } = require('./razorpay-sync')

function billableEntries(entries) {
  return (entries || []).filter((e) => Number(e.total_qty) > 0 && Number(e.amount) > 0)
}

function entrySubtotal(entries) {
  return billableEntries(entries).reduce((s, e) => s + Number(e.amount), 0)
}

async function generateBillId() {
  const { data, error } = await supabase.rpc('next_bill_id')
  if (error) throw error
  return data
}

async function getPaidAmountForBill(billId) {
  const { data } = await supabase.from('payments').select('amount').eq('bill_id', billId)
  return (data || []).reduce((s, p) => s + Number(p.amount), 0)
}

async function createBill(customerId, periodStart, periodEnd, entries, buttermilkData = null) {
  const valid = billableEntries(entries)
  const milkSubtotal = entrySubtotal(valid)
  const buttermilkQty = buttermilkData?.totalQty || 0
  const buttermilkSubtotal = buttermilkData?.subtotal || 0

  if (valid.length === 0 && buttermilkSubtotal <= 0) throw new Error('No deliveries with quantity')
  if (milkSubtotal <= 0 && buttermilkSubtotal <= 0) throw new Error('Bill amount is zero')

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
  return data
}

/** Create a Razorpay payment link for a bill and store it. */
async function createRazorpayLink(bill, customer) {
  if (bill.paid) throw new Error('Bill already paid')
  const paid = await getPaidAmountForBill(bill.id)
  const balance = Number(bill.total_amount) - paid
  if (balance <= 0) throw new Error('Nothing due')

  const phone = String(customer.whatsapp_no || '').replace(/\D/g, '').slice(-10)
  const link = await razorpay.paymentLink.create({
    amount: Math.round(balance * 100),
    currency: 'INR',
    description: `Milk Bill ${bill.id}`,
    reference_id: bill.id,
    notes: { bill_id: bill.id },
    customer: { name: customer.name, contact: `+91${phone}` },
    notify: { sms: false, email: false },
    reminder_enable: true,
    callback_url: `${process.env.FRONTEND_URL}/payment-success`,
    callback_method: 'get'
  })

  const { error } = await supabase
    .from('bills')
    .update({ razorpay_link_id: link.id, razorpay_short_url: link.short_url })
    .eq('id', bill.id)
  if (error) throw error
  return link.short_url
}

/** Generate all bills for a month (idempotent — skips already-billed customers). */
async function generateAllMonthlyBills(month, { withRazorpay = true } = {}) {
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
  const results = { created: [], skipped: [], noDelivery: [], zeroAmount: [], razorpay: [], errors: [] }

  const eligible = []
  for (const customer of customers || []) {
    if (billedCustomers.has(customer.id)) { results.skipped.push(customer.name); continue }
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

  for (const { customer, entries, buttermilkData } of eligible) {
    try {
      const bill = await createBill(customer.id, start, end, entries, buttermilkData)
      results.created.push(bill.id)
      if (withRazorpay && Number(bill.total_amount) > 0) {
        try {
          await createRazorpayLink(bill, customer)
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

/** Bills for the month with their billable entries (for PDF generation). */
async function getMonthlyBillPackages(month) {
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
    entries: billableEntries((entries || []).filter((e) => e.customer_id === bill.customer_id))
  }))
}

module.exports = {
  billableEntries, entrySubtotal, createBill, createRazorpayLink,
  generateAllMonthlyBills, getMonthlyBillPackages, getPaidAmountForBill
}
