import { apiGet, apiPost, apiPut } from './api'
import { uploadBillPdf, uploadSalePdf } from './pdf-upload'

/**
 * Send a WhatsApp message via the backend provider (PayPerWA now, Meta later).
 * type: bill | product_sale | payment_reminder_t1 | payment_reminder_t2 |
 *       supply_cutoff | cash_received | razorpay_received
 * payload: { entityId, amount?, payUrl?, documentUrl?, to?, cutoffDays? }
 */
export async function sendViaApi(type, payload) {
  const { data } = await apiPost('/api/whatsapp/send', { type, ...payload })
  return data
}

/** Upload the bill PDF then send it via the API (PDF attached). */
export async function sendBillViaApi(customer, entries, bill) {
  const documentUrl = await uploadBillPdf(customer, entries, bill)
  return sendViaApi('bill', { entityId: bill.id, documentUrl })
}

/** Upload the sale PDF then send it via the API (PDF attached). */
export async function sendSaleViaApi(sale) {
  const documentUrl = await uploadSalePdf(sale)
  return sendViaApi('product_sale', { entityId: sale.id, documentUrl })
}

/** Send a payment reminder / cash acknowledgement etc. via the API (no PDF). */
export async function sendTextViaApi(type, entityId, extra = {}) {
  return sendViaApi(type, { entityId, ...extra })
}

export async function getAutomationConfig() {
  const { data } = await apiGet('/api/whatsapp/config')
  return data.config
}

export async function updateAutomationConfig(patch) {
  const { data } = await apiPut('/api/whatsapp/config', patch)
  return data.config
}

export async function getWhatsappSummary(month) {
  const { data } = await apiGet(`/api/whatsapp/summary?month=${month}`)
  return data
}

export async function getWhatsappBalance() {
  const { data } = await apiGet('/api/whatsapp/balance')
  return data
}

/** Manually email this month's generated bills (every PDF attached) to the configured address. */
export async function emailBillsReport(month) {
  const { data } = await apiPost('/api/whatsapp/email-report', { month })
  return data
}
