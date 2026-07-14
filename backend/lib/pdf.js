// Server-side bill PDF generation — ported from frontend/src/lib/pdf.js.
// jsPDF + jspdf-autotable run in Node; output as a Buffer for email/upload.
const { jsPDF } = require('jspdf')
const autoTableMod = require('jspdf-autotable')
const autoTable = autoTableMod.default || autoTableMod
const { getDairyInfo } = require('./dairy')
const { amountInWords } = require('./gst')
const { formatDate, formatPeriod, formatAmountPdf, formatQtyPdf, formatRatePdf } = require('./format')

const MARGIN = 14
const INK = [30, 41, 59]
const LINE = [203, 213, 225]

function drawBox(doc, x, y, w, h) {
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.3)
  doc.rect(x, y, w, h)
}

function generateBill(customer, entries, bill) {
  const dairy = getDairyInfo()
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentW = pageWidth - MARGIN * 2

  const milkSubtotal = entries.reduce((s, e) => s + Number(e.amount), 0)
  const buttermilkQty = Number(bill.buttermilk_total_qty || 0)
  const buttermilkSubtotal = Number(bill.buttermilk_subtotal || 0)
  const subtotal = Number(bill.subtotal ?? bill.total_amount)
  const cgst = Number(bill.cgst ?? 0)
  const sgst = Number(bill.sgst ?? 0)
  const gstRate = Number(bill.gst_rate ?? dairy.gstRate)
  const grandTotal = Number(bill.total_amount)
  const invoiceDate = formatDate(new Date().toISOString().slice(0, 10))

  let y = MARGIN
  drawBox(doc, MARGIN, y, contentW, 38)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...INK)
  doc.text(dairy.name, MARGIN + 4, y + 10)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  const headerLines = [dairy.address, `Ph: ${dairy.phone}`, dairy.gstin ? `GSTIN: ${dairy.gstin}` : null].filter(Boolean)
  headerLines.forEach((line, i) => doc.text(line, MARGIN + 4, y + 17 + i * 4.5))

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('TAX INVOICE', pageWidth - MARGIN - 4, y + 10, { align: 'right' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`Invoice No: ${bill.id}`, pageWidth - MARGIN - 4, y + 17, { align: 'right' })
  doc.text(`Date: ${invoiceDate}`, pageWidth - MARGIN - 4, y + 22, { align: 'right' })
  doc.text(`Period: ${formatPeriod(bill.period_start, bill.period_end)}`, pageWidth - MARGIN - 4, y + 27, { align: 'right' })
  if (dairy.state) doc.text(`Place of Supply: ${dairy.state}`, pageWidth - MARGIN - 4, y + 32, { align: 'right' })

  y += 44

  drawBox(doc, MARGIN, y, contentW, 22)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('PARTY NAME & ADDRESS', MARGIN + 4, y + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(customer.name, MARGIN + 4, y + 12)
  const partyLine = [customer.address, `Mob: ${customer.whatsapp_no}`, customer.gstin ? `GSTIN: ${customer.gstin}` : null].filter(Boolean).join('  |  ')
  doc.setFontSize(8)
  doc.text(partyLine, MARGIN + 4, y + 17, { maxWidth: contentW - 8 })

  y += 28

  const totalMorning = entries.reduce((s, e) => s + Number(e.morning_qty), 0)
  const totalEvening = entries.reduce((s, e) => s + Number(e.evening_qty), 0)
  const milkLitres = entries.reduce((s, e) => s + Number(e.total_qty), 0)
  const grandTableTotal = milkSubtotal + buttermilkSubtotal

  const uniqueRates = [...new Set(entries.map((e) => Number(e.rate)))]
  const milkRateDisplay = uniqueRates.length === 1 ? formatRatePdf(uniqueRates[0]) : '(mixed)'

  const tableBody = []
  if (entries.length > 0) {
    tableBody.push(['1', 'Fresh Cow Milk', formatQtyPdf(totalMorning), formatQtyPdf(totalEvening), formatQtyPdf(milkLitres), milkRateDisplay, formatAmountPdf(milkSubtotal)])
  }
  if (buttermilkQty > 0 && buttermilkSubtotal > 0) {
    const bmRate = buttermilkSubtotal / buttermilkQty
    tableBody.push([String(tableBody.length + 1), 'Buttermilk', '', '', formatQtyPdf(buttermilkQty), formatRatePdf(bmRate), formatAmountPdf(buttermilkSubtotal)])
  }

  autoTable(doc, {
    startY: y,
    head: [['#', 'Particulars', 'Morn (L)', 'Eve (L)', 'Qty (L)', 'Rate', 'Amount']],
    body: tableBody,
    foot: [['', 'Total', '', '', '', '', formatAmountPdf(grandTableTotal)]],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, lineColor: LINE, lineWidth: 0.2, textColor: INK },
    headStyles: { fillColor: [248, 250, 252], textColor: INK, fontStyle: 'bold', halign: 'center' },
    footStyles: { fillColor: [248, 250, 252], textColor: INK, fontStyle: 'bold' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { halign: 'left' },
      2: { halign: 'right', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 20 },
      5: { halign: 'right', cellWidth: 18 },
      6: { halign: 'right', cellWidth: 30 }
    },
    margin: { left: MARGIN, right: MARGIN }
  })

  y = doc.lastAutoTable.finalY + 6

  const summaryX = pageWidth - MARGIN - 72
  const summaryW = 72
  const summaryRows = [['Taxable Amount', formatAmountPdf(subtotal)]]
  if (gstRate > 0) {
    summaryRows.push([`CGST @ ${(gstRate / 2).toFixed(2)}%`, formatAmountPdf(cgst)])
    summaryRows.push([`SGST @ ${(gstRate / 2).toFixed(2)}%`, formatAmountPdf(sgst)])
  } else {
    summaryRows.push(['GST', 'Nil / Exempt'])
  }
  summaryRows.push(['Grand Total', formatAmountPdf(grandTotal)])

  const summaryH = 6 + summaryRows.length * 7
  drawBox(doc, summaryX, y, summaryW, summaryH)
  doc.setFontSize(8)
  summaryRows.forEach(([label, val], i) => {
    const rowY = y + 5 + i * 7
    doc.setFont('helvetica', i === summaryRows.length - 1 ? 'bold' : 'normal')
    doc.text(label, summaryX + 3, rowY)
    doc.text(val, summaryX + summaryW - 3, rowY, { align: 'right' })
  })

  y += summaryH + 6

  drawBox(doc, MARGIN, y, contentW, 12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Amount Chargeable (in words):', MARGIN + 4, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.text(amountInWords(grandTotal), MARGIN + 4, y + 10)

  y += 18

  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text('Payment link is sent separately on WhatsApp. Cash payment accepted on delivery.', MARGIN, y)
  doc.text('This is a computer-generated tax invoice.', pageWidth / 2, y + 5, { align: 'center' })
  doc.setTextColor(...INK)
  return doc
}

function billPdfBuffer(customer, entries, bill) {
  return Buffer.from(generateBill(customer, entries, bill).output('arraybuffer'))
}

module.exports = { generateBill, billPdfBuffer }
