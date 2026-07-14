// Ported from frontend/src/lib/gst.js
const { getDairyInfo } = require('./dairy')

function calculateGst(subtotal, gstRate = null) {
  const rate = gstRate ?? getDairyInfo().gstRate
  const taxable = Number(subtotal) || 0
  const gstTotal = Math.round(taxable * rate) / 100
  const half = Math.round(gstTotal * 100) / 200

  return {
    subtotal: taxable,
    gstRate: rate,
    cgst: half,
    sgst: half,
    igst: 0,
    gstTotal,
    grandTotal: Math.round((taxable + gstTotal) * 100) / 100
  }
}

function amountInWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  function twoDigit(n) {
    if (n < 20) return ones[n]
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
  }

  function convert(n) {
    if (n === 0) return 'Zero'
    let words = ''
    if (n >= 10000000) { words += convert(Math.floor(n / 10000000)) + ' Crore '; n %= 10000000 }
    if (n >= 100000) { words += convert(Math.floor(n / 100000)) + ' Lakh '; n %= 100000 }
    if (n >= 1000) { words += convert(Math.floor(n / 1000)) + ' Thousand '; n %= 1000 }
    if (n >= 100) { words += ones[Math.floor(n / 100)] + ' Hundred '; n %= 100 }
    if (n > 0) words += twoDigit(n)
    return words.trim()
  }

  const rupees = Math.floor(amount)
  const paise = Math.round((amount - rupees) * 100)
  let result = convert(rupees) + ' Rupees'
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise'
  return result + ' Only'
}

module.exports = { calculateGst, amountInWords }
