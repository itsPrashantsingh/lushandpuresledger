// Formatting + date helpers ported from frontend/src/lib/utils.js (PDF-relevant subset).

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + (String(dateStr).length === 10 ? 'T00:00:00' : ''))
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatPeriod(start, end) {
  return `${formatDate(start)} to ${formatDate(end)}`
}

function formatAmountPdf(amount) {
  const n = Number(amount || 0)
  return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatQtyPdf(qty) {
  const n = Number(qty || 0)
  return n.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
}

function formatRatePdf(rate) {
  const n = Number(rate || 0)
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getMonthBounds(yearMonth) {
  const [year, month] = String(yearMonth).split('-').map(Number)
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

module.exports = { formatDate, formatPeriod, formatAmountPdf, formatQtyPdf, formatRatePdf, getMonthBounds, todayISO }
