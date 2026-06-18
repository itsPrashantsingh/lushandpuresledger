import { generateBill } from './pdf'
import { formatAmountPdf, formatPeriod, whatsappLink, cleanPhone } from './utils'
import { getDairyInfo } from './constants'

export function buildBillWhatsAppMessage(customer, bill, razorpayUrl) {
  const dairy = getDairyInfo()
  const period = formatPeriod(bill.period_start, bill.period_end)
  const amount = formatAmountPdf(bill.total_amount)

  let msg = `Hi ${customer.name},\n\n`
  msg += `*Milk Bill — ${period}*\n`
  msg += `Bill No: ${bill.id}\n`
  msg += `Amount: *${amount}*\n`

  if (razorpayUrl) {
    msg += `\n*Pay online here:*\n${razorpayUrl}\n`
  }

  msg += `\n— ${dairy.name}`

  return msg
}

function validatePhone(customer) {
  const phone = cleanPhone(customer?.whatsapp_no)
  if (phone.length < 10) throw new Error(`Invalid phone for ${customer?.name}`)
  return phone
}

/**
 * Share bill on WhatsApp.
 * Mobile: native share sheet attaches PDF automatically.
 * Desktop: downloads PDF + opens WhatsApp (user attaches manually).
 */
export async function shareBillOnWhatsApp(customer, entries, bill, razorpayUrl) {
  validatePhone(customer)
  const message = buildBillWhatsAppMessage(customer, bill, razorpayUrl)
  const doc = generateBill(customer, entries, bill)
  const filename = `${bill.id}-${customer.name.replace(/\s+/g, '_')}.pdf`
  const blob = doc.output('blob')
  const file = new File([blob], filename, { type: 'application/pdf' })

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        title: `Bill ${bill.id}`,
        text: message + '\n\n(Bill PDF attached)',
        files: [file]
      })
      return { method: 'share', success: true, attached: true }
    } catch (err) {
      if (err.name === 'AbortError') return { method: 'share', success: false, cancelled: true }
    }
  }

  doc.save(filename)

  const desktopMsg = isMobile
    ? message + '\n\n📎 Bill PDF — attach from your downloads'
    : message + '\n\n📎 Bill PDF downloaded to your computer — please attach it in WhatsApp before sending'

  window.open(whatsappLink(customer.whatsapp_no, desktopMsg), '_blank')
  return { method: 'download', success: true, attached: false }
}

export function sendReminderWhatsApp(customer, message) {
  validatePhone(customer)
  window.open(whatsappLink(customer.whatsapp_no, message), '_blank')
}
