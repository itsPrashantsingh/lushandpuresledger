const crypto = require('crypto')

const BASE_URL = process.env.PAYPERWA_BASE_URL || 'https://payperwa.com/api/v1'
const API_KEY = process.env.PAYPERWA_API_KEY || ''
const CHANNEL_ID = process.env.PAYPERWA_CHANNEL_ID || ''
const WEBHOOK_SECRET = process.env.PAYPERWA_WEBHOOK_SECRET || ''

function isConfigured() {
  return Boolean(API_KEY)
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  const last10 = digits.slice(-10)
  return last10.length === 10 ? `91${last10}` : ''
}

function headers() {
  const h = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
  if (CHANNEL_ID) h['X-Channel-Id'] = CHANNEL_ID
  return h
}

/**
 * Send an approved template message.
 * @returns {Promise<{ok, wamid, status, cost, error, invalid}>}
 */
async function sendTemplate({ to, templateName, language = 'en', variables = [], documentUrl, filename }) {
  if (!isConfigured()) {
    return { ok: false, status: 'failed', error: 'PayPerWA not configured (PAYPERWA_API_KEY missing)' }
  }

  const phone = normalizePhone(to)
  if (!phone) {
    return { ok: false, status: 'invalid_number', invalid: true, error: `Invalid phone: ${to}` }
  }

  const body = {
    to: phone,
    template_name: templateName,
    language,
    variables
  }

  // Document-header template: PayPerWA accepts a publicly accessible PDF URL.
  // NOTE: exact field name to confirm with PayPerWA support; kept isolated here.
  if (documentUrl) {
    body.document_url = documentUrl
    if (filename) body.document_filename = filename
  }

  let res, json
  try {
    res = await fetch(`${BASE_URL}/messages/send`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body)
    })
    json = await res.json().catch(() => ({}))
  } catch (err) {
    return { ok: false, status: 'failed', error: `Network error: ${err.message}` }
  }

  if (!res.ok || json?.success === false) {
    const error = json?.error || `HTTP ${res.status}`
    // 400 on a bad/non-WhatsApp number → surface as invalid_number
    const invalid = res.status === 400 && /phone|number|recipient|not.*whatsapp/i.test(error)
    return { ok: false, status: invalid ? 'invalid_number' : 'failed', invalid, error }
  }

  const data = json.data || {}
  return {
    ok: true,
    wamid: data.message_id || null,
    status: data.status || 'sent',
    cost: Number(data.cost?.total || 0)
  }
}

async function getBalance() {
  if (!isConfigured()) return { balance: null, currency: 'INR', error: 'PayPerWA not configured' }
  try {
    const res = await fetch(`${BASE_URL}/balance`, { headers: headers() })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) {
      return { balance: null, currency: 'INR', error: json?.error || `HTTP ${res.status}` }
    }
    return { balance: Number(json.data?.balance ?? 0), currency: json.data?.currency || 'INR' }
  } catch (err) {
    return { balance: null, currency: 'INR', error: err.message }
  }
}

/** Verify webhook signature (HMAC-SHA256 over the raw request body). */
function verifyWebhook(rawBody, signature) {
  if (!WEBHOOK_SECRET || !signature) return false
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '')
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))
  } catch {
    return false
  }
}

/** Extract normalized status fields from a webhook body. */
function parseStatusEvent(body) {
  return {
    wamid: body?.message_id || null,
    status: body?.status || null,
    recipient: body?.recipient || null
  }
}

module.exports = {
  name: 'payperwa',
  isConfigured,
  sendTemplate,
  getBalance,
  verifyWebhook,
  parseStatusEvent,
  signatureHeader: 'x-payperwa-signature'
}
