const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { markBillPaidFromRazorpay } = require('../lib/mark-paid')

async function handlePaymentLinkPaid(linkEntity, paymentEntity) {
  if (!linkEntity?.reference_id) {
    throw new Error('Missing reference_id on payment link')
  }

  const billId = linkEntity.reference_id
  const paymentId =
    paymentEntity?.id ||
    (Array.isArray(linkEntity.payments) ? linkEntity.payments[0] : null) ||
    null

  const amountPaid = Number(linkEntity.amount_paid || linkEntity.amount || 0) / 100

  return markBillPaidFromRazorpay({ billId, paymentId, amountPaid })
}

router.post('/razorpay', async (req, res) => {
  const signature = req.headers['x-razorpay-signature']
  const body = req.body
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET

  if (!secret || secret === 'your_webhook_secret') {
    console.error('RAZORPAY_WEBHOOK_SECRET not configured')
    return res.status(500).json({ error: 'Webhook secret not configured' })
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  if (expectedSig !== signature) {
    console.error('Invalid webhook signature')
    return res.status(400).json({ error: 'Invalid signature' })
  }

  let event
  try {
    event = JSON.parse(body.toString())
  } catch (err) {
    console.error('Invalid webhook JSON:', err.message)
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  try {
    const linkEntity = event.payload?.payment_link?.entity
    const paymentEntity = event.payload?.payment?.entity

    if (event.event === 'payment_link.paid' || linkEntity?.status === 'paid') {
      const result = await handlePaymentLinkPaid(linkEntity, paymentEntity)
      if (result.ok && !result.duplicate && !result.alreadyPaid) {
        console.log(`Bill ${result.billId} marked paid via webhook (${event.event})`)
      }
    } else if (event.event === 'payment.captured' && paymentEntity) {
      const billId = paymentEntity.notes?.bill_id || paymentEntity.description?.match(/BILL-\d+/)?.[0]
      if (billId) {
        await markBillPaidFromRazorpay({
          billId,
          paymentId: paymentEntity.id,
          amountPaid: Number(paymentEntity.amount) / 100
        })
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err.message, event?.event)
    return res.status(500).json({ error: 'Processing failed' })
  }

  res.status(200).json({ received: true })
})

module.exports = router
