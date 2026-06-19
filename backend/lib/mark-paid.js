const supabase = require('./supabase')

async function markBillPaidFromRazorpay({ billId, paymentId, amountPaid, mode = 'upi' }) {
  if (paymentId) {
    const { data: existing } = await supabase
      .from('payments')
      .select('id')
      .eq('razorpay_payment_id', paymentId)
      .maybeSingle()

    if (existing) {
      return { ok: true, duplicate: true, billId }
    }
  }

  const { data: bill, error } = await supabase
    .from('bills')
    .update({
      paid: true,
      paid_at: new Date().toISOString(),
      payment_mode: mode
    })
    .eq('id', billId)
    .select('*, customers(*)')
    .single()

  if (error) throw error

  await supabase.from('payments').insert({
    bill_id: billId,
    customer_id: bill.customer_id,
    amount: amountPaid,
    mode,
    razorpay_payment_id: paymentId || null
  })

  return { ok: true, bill, billId }
}

module.exports = { markBillPaidFromRazorpay }
