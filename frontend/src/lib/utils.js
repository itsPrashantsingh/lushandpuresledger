export function formatCurrency(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/** Plain Rs. format for PDF — avoids broken ₹ glyph in jsPDF */
export function formatAmountPdf(amount) {
  const n = Number(amount || 0)
  return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatQtyPdf(qty) {
  const n = Number(qty || 0)
  return n.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
}

export function formatRatePdf(rate) {
  const n = Number(rate || 0)
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''))
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Short date for bill table: 01-Apr-25 */
export function formatDateBill(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''))
  const day = String(d.getDate()).padStart(2, '0')
  const mon = d.toLocaleDateString('en-IN', { month: 'short' })
  const yr = String(d.getFullYear()).slice(-2)
  return `${day}-${mon}-${yr}`
}

export function formatPeriod(start, end) {
  return `${formatDate(start)} to ${formatDate(end)}`
}

export function getMonthBounds(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number)
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function daysOverdue(periodEnd) {
  const end = new Date(periodEnd + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.floor((now - end) / (1000 * 60 * 60 * 24))
  return diff > 7 ? diff - 7 : 0
}

export function isOverdue(bill) {
  if (bill.paid) return false
  const end = new Date(bill.period_end + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.floor((now - end) / (1000 * 60 * 60 * 24))
  return diff > 7
}

export function getBillStatus(bill, paidAmount = 0) {
  const total = Number(bill.total_amount)
  const paid = Number(paidAmount)
  if (bill.paid || paid >= total) return 'paid'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

export function statusBadgeClass(status) {
  if (status === 'paid') return 'bg-green-100 text-green-700'
  if (status === 'partial') return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

export function cleanPhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10)
}

export function whatsappLink(phone, message) {
  return `https://wa.me/91${cleanPhone(phone)}?text=${encodeURIComponent(message)}`
}

export function last6Months() {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
    })
  }
  return months
}

export function last30Days() {
  const days = []
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    })
  }
  return days
}
