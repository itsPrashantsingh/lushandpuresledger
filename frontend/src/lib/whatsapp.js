import { generateBill, generateProductSaleBill } from './pdf'
import { whatsappLink, cleanPhone } from './utils'
import { buildBillWhatsAppMessage, buildProductSaleWhatsAppMessage } from './messages'

function validatePhone(customer) {
  const phone = cleanPhone(customer?.whatsapp_no)
  if (phone.length < 10) throw new Error(`Invalid phone for ${customer?.name}`)
  return phone
}

/**
 * Share bill on WhatsApp — always via wa.me, targeting the customer's exact chat.
 * Downloads the PDF; the user attaches it manually in the chat that opens.
 */
export async function shareBillOnWhatsApp(customer, entries, bill, razorpayUrl) {
  validatePhone(customer)
  const message = buildBillWhatsAppMessage(customer, bill, razorpayUrl)
  const doc = generateBill(customer, entries, bill)
  const filename = `${bill.id}-${customer.name.replace(/\s+/g, '_')}.pdf`

  // Always open the customer's exact WhatsApp chat via wa.me — the OS share sheet
  // (navigator.share with files) cannot target a specific contact, so using it here
  // would force manually picking the chat, defeating the point of this fallback.
  doc.save(filename)
  window.open(whatsappLink(customer.whatsapp_no, message), '_blank')
  return { method: 'download', success: true, attached: false }
}

export function sendReminderWhatsApp(customer, message) {
  validatePhone(customer)
  window.open(whatsappLink(customer.whatsapp_no, message), '_blank')
}

export async function shareProductSaleOnWhatsApp(sale) {
  const phone = cleanPhone(sale?.buyer_phone)
  if (phone.length < 10) throw new Error(`Invalid phone for ${sale?.buyer_name}`)

  const message = buildProductSaleWhatsAppMessage(sale)
  const doc = generateProductSaleBill(sale)
  const filename = `${sale.invoice_no}-${sale.buyer_name.replace(/\s+/g, '_')}.pdf`

  // Always open the customer's exact WhatsApp chat via wa.me — see shareBillOnWhatsApp.
  doc.save(filename)
  window.open(whatsappLink(phone, message), '_blank')
  return { method: 'download', success: true, attached: false }
}

export { buildBillWhatsAppMessage } from './messages'
