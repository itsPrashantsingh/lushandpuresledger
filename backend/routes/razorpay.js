const express = require('express')
const router = express.Router()
const Razorpay = require('razorpay')
const supabase = require('../lib/supabase')

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

module.exports = router
