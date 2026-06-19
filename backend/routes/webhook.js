const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { markBillPaidFromRazorpay } = require('../lib/mark-paid')

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
    if (event.event === 'payment_link.paid') {
      const linkEntity = event.payload?.payment_link?.entity
      const paymentEntity = event.payload?.payment?.entity

      if (!linkEntity?.reference_id) {
        console.error('Webhook missing reference_id', JSON.stringify(event.payload))
        return res.status(400).json({ error: 'Missing bill reference' })
      }

      const billId = linkEntity.reference_id
      const paymentId = paymentEntity?.id || linkEntity.payments?.[0] || null
      const amountPaid = Number(linkEntity.amount_paid) / 100

      const result = await markBillPaidFromRazorpay({ billId, paymentId, amountPaid })
      if (!result.duplicate) {
        console.log(`Bill ${billId} marked paid via webhook`)
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err.message)
    return res.status(500).json({ error: 'Processing failed' })
  }

  res.status(200).json({ received: true })
})

module.exports = router
