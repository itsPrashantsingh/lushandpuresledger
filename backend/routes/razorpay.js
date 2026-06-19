const express = require('express')
const router = express.Router()
const Razorpay = require('razorpay')
const supabase = require('../lib/supabase')
const { markBillPaidFromRazorpay } = require('../lib/mark-paid')

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
})

router.post('/create-link', async (req, res) => {
  const { billId, amount, customerName, customerPhone, description } = req.body

  if (!billId || !amount || !customerName || !customerPhone) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    const phone = String(customerPhone).replace(/\D/g, '').slice(-10)

    const link = await razorpay.paymentLink.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      description: description || `Milk Bill - ${billId}`,
      reference_id: billId,
      customer: {
        name: customerName,
        contact: `+91${phone}`
      },
      notify: {
        sms: true,
        email: false
      },
      reminder_enable: true,
      callback_url: `${process.env.FRONTEND_URL}/payment-success`,
      callback_method: 'get'
    })

    const { error } = await supabase
      .from('bills')
      .update({
        razorpay_link_id: link.id,
        razorpay_short_url: link.short_url
      })
      .eq('id', billId)

    if (error) throw error

    res.json({ success: true, shortUrl: link.short_url, linkId: link.id })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

/** Check Razorpay for payment status and mark bill paid if customer already paid */
router.post('/verify-payment', async (req, res) => {
  const { billId } = req.body
  if (!billId) return res.status(400).json({ error: 'billId required' })

  try {
    const { data: bill, error: billErr } = await supabase
      .from('bills')
      .select('*, customers(*)')
      .eq('id', billId)
      .single()

    if (billErr || !bill) return res.status(404).json({ error: 'Bill not found' })
    if (bill.paid) return res.json({ success: true, alreadyPaid: true, billId })

    if (!bill.razorpay_link_id) {
      return res.status(400).json({ error: 'No Razorpay link on this bill' })
    }

    const link = await razorpay.paymentLink.fetch(bill.razorpay_link_id)

    if (link.status !== 'paid') {
      return res.json({
        success: false,
        status: link.status,
        message: `Payment link status is "${link.status}" — not paid yet on Razorpay`
      })
    }

    let paymentId = link.payments?.[0] || null
    if (!paymentId && link.id) {
      try {
        const payments = await razorpay.paymentLink.fetchAllPayments(link.id)
        paymentId = payments?.items?.[0]?.id || null
      } catch {
        // optional
      }
    }

    const amountPaid = Number(link.amount_paid) / 100
    await markBillPaidFromRazorpay({ billId, paymentId, amountPaid })

    res.json({ success: true, synced: true, billId, amountPaid })
  } catch (err) {
    console.error('verify-payment:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
