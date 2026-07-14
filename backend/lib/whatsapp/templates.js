// Registry mapping app message types to WhatsApp templates.
// templateName defaults to the type key; override per deployment via env
// (e.g. PPW_TPL_BILL=milk_bill) so it matches the name approved in the provider dashboard.

function money(n) {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function tpl(key) {
  const envKey = 'PPW_TPL_' + key.toUpperCase()
  return process.env[envKey] || key
}

// ctx fields used: name, period, month, amount, payUrl, invoice, product, cutoffDays
const REGISTRY = {
  bill: {
    hasDocument: true,
    buildVariables: (c) => [c.name, c.period, money(c.amount), c.payUrl || '']
  },
  product_sale: {
    hasDocument: true,
    buildVariables: (c) => [c.name, c.invoice, c.product, money(c.amount)]
  },
  payment_reminder_t1: {
    hasDocument: false,
    buildVariables: (c) => [c.name, c.month, money(c.amount), c.payUrl || '']
  },
  payment_reminder_t2: {
    hasDocument: false,
    buildVariables: (c) => [c.name, c.month, money(c.amount), c.payUrl || '']
  },
  supply_cutoff: {
    hasDocument: false,
    buildVariables: (c) => [c.name, money(c.amount), String(c.cutoffDays ?? '')]
  },
  bill_carryforward: {
    hasDocument: false,
    buildVariables: (c) => [c.name, c.month, money(c.amount), c.payUrl || '']
  },
  cash_received: {
    hasDocument: false,
    buildVariables: (c) => [c.name, money(c.amount)]
  },
  razorpay_received: {
    hasDocument: false,
    buildVariables: (c) => [c.name, money(c.amount)]
  }
}

/** Resolve a message type to a concrete template spec, or null if unknown. */
function resolveTemplate(type, ctx = {}) {
  const def = REGISTRY[type]
  if (!def) return null
  return {
    templateName: tpl(type),
    language: process.env.PPW_TPL_LANG || 'en',
    hasDocument: def.hasDocument,
    variables: def.buildVariables(ctx)
  }
}

module.exports = { REGISTRY, resolveTemplate, money }
