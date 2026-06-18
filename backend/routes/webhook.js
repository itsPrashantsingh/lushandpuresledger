const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const supabase = require('../lib/supabase')

router.post('/razorpay', async (req, res) => {
  const signature = req.headers['x-razorpay-signature']
  const body = req.body
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  if (expectedSig !== signature) {
    console.error('Invalid webhook signature')
    return res.status(400).json({ error: 'Invalid signature' })
  }

  const event = JSON.parse(body.toString())

  if (event.event === 'payment_link.paid') {
    const entity = event.payload.payment_link.entity
    const billId = entity.reference_id
    const paymentId = event.payload.payment.entity.id
    const amountPaid = entity.amount_paid / 100

    // Idempotency — skip duplicate webhook deliveries
    const { data: existing } = await supabase
      .from('payments')
      .select('id')
      .eq('razorpay_payment_id', paymentId)
      .maybeSingle()

    if (existing) {
      console.log(`Duplicate webhook for payment ${paymentId}, skipping`)
      return res.status(200).json({ received: true, duplicate: true })
    }

    const { data: bill, error } = await supabase
      .from('bills')
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        payment_mode: 'upi'
      })
      .eq('id', billId)
      .select('*, customers(*)')
      .single()

    if (error) {
      console.error('Supabase error:', error)
      return res.status(500).json({ error: 'DB update failed' })
    }

    await supabase.from('payments').insert({
      bill_id: billId,
      customer_id: bill.customer_id,
      amount: amountPaid,
      mode: 'upi',
      razorpay_payment_id: paymentId
    })

    console.log(`Bill ${billId} marked paid for ${bill.customers?.name}`)
  }

  res.status(200).json({ received: true })
})

module.exports = router
