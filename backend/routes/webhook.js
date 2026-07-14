const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { processWebhookEvent } = require('../lib/razorpay-sync')
const supabase = require('../lib/supabase')
const { getProvider } = require('../lib/whatsapp')

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

  const eventName = event.event
  console.log(`Webhook received: ${eventName}`)

  try {
    const result = await processWebhookEvent(event)

    if (result?.billId && !result.duplicate && !result.alreadyPaid && !result.ignored) {
      console.log(`Bill ${result.billId} marked paid via webhook (${eventName})`)
    }
  } catch (err) {
    console.error(`Webhook ${eventName} error:`, err.message)

    // Bill not found — don't retry forever
    if (err.message?.includes('not found')) {
      return res.status(200).json({ received: true, skipped: true })
    }

    // Transient DB/API error — Razorpay will retry
    return res.status(500).json({ error: 'Processing failed' })
  }

  res.status(200).json({ received: true })
})

// ── WhatsApp delivery-status webhook (provider-aware) ──────────
// GET is used by Meta for the hub.challenge subscription handshake.
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (mode === 'subscribe' && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge)
  }
  return res.sendStatus(403)
})

router.post('/whatsapp', async (req, res) => {
  const provider = getProvider()
  const signature = req.headers[provider.signatureHeader]

  if (!provider.verifyWebhook(req.body, signature)) {
    console.error('Invalid WhatsApp webhook signature')
    return res.status(401).json({ error: 'Invalid signature' })
  }

  let event
  try {
    event = JSON.parse(req.body.toString())
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  try {
    const { wamid, status } = provider.parseStatusEvent(event)
    if (wamid && status) {
      await supabase
        .from('whatsapp_messages')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('wamid', wamid)
    }
  } catch (err) {
    console.error('WhatsApp webhook error:', err.message)
    return res.status(500).json({ error: 'Processing failed' })
  }

  res.status(200).json({ received: true })
})

module.exports = router
