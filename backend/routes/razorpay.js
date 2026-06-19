const express = require('express')
const router = express.Router()
const supabase = require('../lib/supabase')
const {
  verifyCallbackSignature,
  syncBillFromRazorpay,
  reconcileUnpaidBills,
  razorpay
} = require('../lib/razorpay-sync')

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
      description: description || `Milk Bill ${billId}`,
      reference_id: billId,
      notes: { bill_id: billId },
      customer: {
        name: customerName,
        contact: `+91${phone}`
      },
      notify: { sms: true, email: false },
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
    console.error('create-link:', err)
    res.status(500).json({ error: err.message })
  }
})

/** Public — customer lands here after Razorpay payment redirect */
router.post('/confirm-payment', async (req, res) => {
  const {
    billId,
    razorpay_payment_id,
    razorpay_payment_link_id,
    razorpay_payment_link_reference_id,
    razorpay_payment_link_status,
    razorpay_signature
  } = req.body

  const resolvedBillId = billId || razorpay_payment_link_reference_id
  if (!resolvedBillId) {
    return res.status(400).json({ error: 'billId required' })
  }

  if (razorpay_signature) {
    const valid = verifyCallbackSignature({
      razorpay_payment_id,
      razorpay_payment_link_id,
      razorpay_payment_link_reference_id: resolvedBillId,
      razorpay_payment_link_status,
      razorpay_signature
    })
    if (!valid) {
      console.error('Invalid payment callback signature for', resolvedBillId)
      return res.status(400).json({ error: 'Invalid payment signature' })
    }
  }

  try {
    const result = await syncBillFromRazorpay(resolvedBillId)
    res.json({ success: result.success !== false, ...result })
  } catch (err) {
    console.error('confirm-payment:', err)
    res.status(500).json({ error: err.message })
  }
})

/** Admin — sync one bill */
router.post('/verify-payment', async (req, res) => {
  const { billId } = req.body
  if (!billId) return res.status(400).json({ error: 'billId required' })

  try {
    const result = await syncBillFromRazorpay(billId)
    res.json({ success: result.success !== false, ...result })
  } catch (err) {
    console.error('verify-payment:', err)
    res.status(500).json({ error: err.message })
  }
})

/** Admin — sync all unpaid bills with Razorpay links */
router.post('/reconcile', async (req, res) => {
  try {
    const result = await reconcileUnpaidBills()
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('reconcile:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
