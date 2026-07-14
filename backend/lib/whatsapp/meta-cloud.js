// Meta WhatsApp Cloud API adapter — same interface as payperwa.js.
// Stub for now; fill when migrating off PayPerWA. See plan "Meta Cloud API migration".
const crypto = require('crypto')

const GRAPH = 'https://graph.facebook.com/v20.0'
const PHONE_ID = process.env.META_PHONE_NUMBER_ID || ''
const TOKEN = process.env.META_ACCESS_TOKEN || ''
const APP_SECRET = process.env.META_APP_SECRET || ''

function isConfigured() {
  return Boolean(PHONE_ID && TOKEN)
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  const last10 = digits.slice(-10)
  return last10.length === 10 ? `91${last10}` : ''
}

/**
 * Map the shared interface to Meta's /messages payload.
 * Header document + body text parameters.
 */
async function sendTemplate({ to, templateName, language = 'en', variables = [], documentUrl, filename }) {
  if (!isConfigured()) {
    return { ok: false, status: 'failed', error: 'Meta Cloud API not configured' }
  }
  const phone = normalizePhone(to)
  if (!phone) return { ok: false, status: 'invalid_number', invalid: true, error: `Invalid phone: ${to}` }

  const components = []
  if (documentUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'document', document: { link: documentUrl, filename: filename || 'bill.pdf' } }]
    })
  }
  if (variables.length) {
    components.push({
      type: 'body',
      parameters: variables.map((v) => ({ type: 'text', text: String(v) }))
    })
  }

  const body = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: { name: templateName, language: { code: language }, components }
  }

  try {
    const res = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.error) {
      const error = json?.error?.message || `HTTP ${res.status}`
      const invalid = /recipient|phone|not.*whatsapp/i.test(error)
      return { ok: false, status: invalid ? 'invalid_number' : 'failed', invalid, error }
    }
    return { ok: true, wamid: json.messages?.[0]?.id || null, status: 'sent', cost: 0 }
  } catch (err) {
    return { ok: false, status: 'failed', error: err.message }
  }
}

// Meta bills you directly (no wallet).
async function getBalance() {
  return { balance: null, currency: 'INR', error: 'Not applicable for Meta Cloud API' }
}

// Meta signs webhooks with X-Hub-Signature-256 = 'sha256=' + HMAC(app secret, rawBody).
function verifyWebhook(rawBody, signature) {
  if (!APP_SECRET || !signature) return false
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '')
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))
  } catch {
    return false
  }
}

function parseStatusEvent(body) {
  const status = body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]
  return {
    wamid: status?.id || null,
    status: status?.status || null,
    recipient: status?.recipient_id || null
  }
}

module.exports = {
  name: 'meta',
  isConfigured,
  sendTemplate,
  getBalance,
  verifyWebhook,
  parseStatusEvent,
  signatureHeader: 'x-hub-signature-256'
}
