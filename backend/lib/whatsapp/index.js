const payperwa = require('./payperwa')
const meta = require('./meta-cloud')

const PROVIDERS = { payperwa, meta }

/** Returns the active WhatsApp provider adapter, selected by env WHATSAPP_PROVIDER. */
function getProvider() {
  const key = (process.env.WHATSAPP_PROVIDER || 'payperwa').toLowerCase()
  return PROVIDERS[key] || payperwa
}

module.exports = { getProvider, PROVIDERS }
