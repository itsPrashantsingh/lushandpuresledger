const supabase = require('../supabase')
const { getProvider } = require('./index')
const { resolveTemplate } = require('./templates')

/** True if a successful (non-failed) message of this type already exists for the entity. */
async function alreadySent(messageType, entityId) {
  if (!entityId) return false
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id')
    .eq('message_type', messageType)
    .eq('entity_id', String(entityId))
    .in('status', ['queued', 'sent', 'delivered', 'read'])
    .limit(1)
  return Boolean(data?.length)
}

async function logMessage(row) {
  const { data } = await supabase.from('whatsapp_messages').insert(row).select('*').single()
  return data
}

/**
 * Send one templated WhatsApp message and record it.
 * @param {string} type   message type (key in templates registry)
 * @param {object} ctx    { to, customerId, entityId, documentUrl, filename, sentByEmail, ...templateVars }
 * @param {object} opts   { dedupe }
 * @returns {Promise<{ok, status, wamid, error, skipped}>}
 */
async function sendMessage(type, ctx = {}, opts = {}) {
  const provider = getProvider()
  const spec = resolveTemplate(type, ctx)
  if (!spec) {
    return { ok: false, status: 'failed', error: `Unknown message type: ${type}` }
  }

  if (opts.dedupe && (await alreadySent(type, ctx.entityId))) {
    return { ok: true, skipped: true, status: 'duplicate' }
  }

  const base = {
    provider: provider.name,
    to_phone: ctx.to || null,
    customer_id: ctx.customerId || null,
    message_type: type,
    entity_id: ctx.entityId ? String(ctx.entityId) : null,
    template_name: spec.templateName,
    sent_by_email: ctx.sentByEmail || null
  }

  const result = await provider.sendTemplate({
    to: ctx.to,
    templateName: spec.templateName,
    language: spec.language,
    variables: spec.variables,
    documentUrl: spec.hasDocument ? ctx.documentUrl : undefined,
    filename: ctx.filename
  })

  await logMessage({
    ...base,
    wamid: result.wamid || null,
    status: result.status || (result.ok ? 'sent' : 'failed'),
    cost: result.cost || 0,
    error: result.error || null
  })

  return {
    ok: result.ok,
    status: result.status || (result.ok ? 'sent' : 'failed'),
    wamid: result.wamid || null,
    error: result.error || null
  }
}

module.exports = { sendMessage, alreadySent }
