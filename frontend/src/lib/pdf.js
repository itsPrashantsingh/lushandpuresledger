import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getDairyInfo } from './constants'
import { amountInWords } from './gst'
import { formatDate, formatDateBill, formatPeriod, formatAmountPdf, formatQtyPdf, formatRatePdf } from './utils'

const MARGIN = 14
const INK = [30, 41, 59]
const LINE = [203, 213, 225]

function drawBox(doc, x, y, w, h) {
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.3)
  doc.rect(x, y, w, h)
}

/** PDF bill only — no payment link / UPI (those go in WhatsApp message) */
export function generateBill(customer, entries, bill) {
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

  // ── Header box (Tally style) ──
  let y = MARGIN
  drawBox(doc, MARGIN, y, contentW, 38)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...INK)
  doc.text(dairy.name, MARGIN + 4, y + 10)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  const headerLines = [
    dairy.address,
    `Ph: ${dairy.phone}`,
    dairy.gstin ? `GSTIN: ${dairy.gstin}` : null
  ].filter(Boolean)
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

  // ── Party details box ──
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

  // ── Line items (Tally column layout) ──
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

  const tableFooter = [['', 'Total', '', '', '', '', formatAmountPdf(grandTableTotal)]]

  autoTable(doc, {
    startY: y,
    head: [['#', 'Particulars', 'Morn (L)', 'Eve (L)', 'Qty (L)', 'Rate', 'Amount']],
    body: tableBody,
    foot: tableFooter,
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

  y = doc.lastAutoTable.finalY + 4

  y += 2

  // ── Summary box (right-aligned, Tally style) ──
  const summaryX = pageWidth - MARGIN - 72
  const summaryW = 72
  const summaryRows = [
    ['Taxable Amount', formatAmountPdf(subtotal)]
  ]
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

  // ── Amount in words ──
  drawBox(doc, MARGIN, y, contentW, 12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Amount Chargeable (in words):', MARGIN + 4, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.text(amountInWords(grandTotal), MARGIN + 4, y + 10)

  y += 18

  // ── Footer note (no UPI / no Razorpay on PDF) ──
  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text('Payment link is sent separately on WhatsApp. Cash payment accepted on delivery.', MARGIN, y)
  doc.text('This is a computer-generated tax invoice.', pageWidth / 2, y + 5, { align: 'center' })

  doc.setTextColor(...INK)
  return doc
}

export function openBillPdf(customer, entries, bill) {
  const doc = generateBill(customer, entries, bill)
  window.open(doc.output('bloburl'), '_blank')
}

export function downloadBillPdf(customer, entries, bill) {
  const doc = generateBill(customer, entries, bill)
  doc.save(`${bill.id}-${customer.name.replace(/\s+/g, '_')}.pdf`)
}

export function getBillPdfBlob(customer, entries, bill) {
  const doc = generateBill(customer, entries, bill)
  return doc.output('blob')
}

export function generateProductSaleBill(sale) {
  const dairy = getDairyInfo()
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentW = pageWidth - MARGIN * 2
  let y = MARGIN

  const subtotal = Number(sale.subtotal || 0)
  const cgst = Number(sale.cgst || 0)
  const sgst = Number(sale.sgst || 0)
  const gstRate = Number(sale.gst_rate || 0)
  const grandTotal = Number(sale.total_amount || 0)

  drawBox(doc, MARGIN, y, contentW, 38)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...INK)
  doc.text(dairy.name, MARGIN + 4, y + 10)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  ;[dairy.address, `Ph: ${dairy.phone}`, dairy.gstin ? `GSTIN: ${dairy.gstin}` : null]
    .filter(Boolean)
    .forEach((line, i) => doc.text(line, MARGIN + 4, y + 17 + i * 4.5))

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(gstRate > 0 ? 'TAX INVOICE' : 'SALE INVOICE', pageWidth - MARGIN - 4, y + 10, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`Invoice No: ${sale.invoice_no}`, pageWidth - MARGIN - 4, y + 17, { align: 'right' })
  doc.text(`Date: ${formatDate(sale.date)}`, pageWidth - MARGIN - 4, y + 22, { align: 'right' })
  if (dairy.state) doc.text(`Place of Supply: ${dairy.state}`, pageWidth - MARGIN - 4, y + 27, { align: 'right' })

  y += 44
  drawBox(doc, MARGIN, y, contentW, 22)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('BILL TO', MARGIN + 4, y + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(sale.buyer_name, MARGIN + 4, y + 12)
  const buyerLine = [sale.buyer_phone ? `Mob: ${sale.buyer_phone}` : null, sale.buyer_gstin ? `GSTIN: ${sale.buyer_gstin}` : null].filter(Boolean).join('  |  ')
  doc.setFontSize(8)
  if (buyerLine) doc.text(buyerLine, MARGIN + 4, y + 17)

  y += 28
  autoTable(doc, {
    startY: y,
    head: [['#', 'Product', 'HSN', 'Qty', 'Unit', `Rate (per ${sale.unit || 'unit'})`, 'Taxable', 'GST %', 'Amount']],
    body: [[
      '1',
      sale.product_name,
      sale.hsn_code || '',
      formatQtyPdf(sale.quantity),
      sale.unit,
      formatRatePdf(sale.rate),
      formatAmountPdf(subtotal),
      gstRate.toFixed(2),
      formatAmountPdf(grandTotal)
    ]],
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: LINE,
      lineWidth: 0.2,
      textColor: INK
    },
    headStyles: {
      fillColor: [248, 250, 252],
      textColor: INK,
      fontStyle: 'bold',
      halign: 'center'
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      2: { halign: 'center', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 16 },
      4: { halign: 'center', cellWidth: 16 },
      5: { halign: 'right', cellWidth: 18 },
      6: { halign: 'right', cellWidth: 24 },
      7: { halign: 'right', cellWidth: 16 },
      8: { halign: 'right', cellWidth: 26 }
    },
    margin: { left: MARGIN, right: MARGIN }
  })

  y = doc.lastAutoTable.finalY + 6
  const summaryX = pageWidth - MARGIN - 72
  const summaryW = 72
  const rows = [['Taxable Amount', formatAmountPdf(subtotal)]]
  if (gstRate > 0) {
    rows.push([`CGST @ ${(gstRate / 2).toFixed(2)}%`, formatAmountPdf(cgst)])
    rows.push([`SGST @ ${(gstRate / 2).toFixed(2)}%`, formatAmountPdf(sgst)])
  } else {
    rows.push(['GST', 'Nil / Exempt'])
  }
  rows.push(['Grand Total', formatAmountPdf(grandTotal)])

  drawBox(doc, summaryX, y, summaryW, 6 + rows.length * 7)
  doc.setFontSize(8)
  rows.forEach(([label, val], i) => {
    const rowY = y + 5 + i * 7
    doc.setFont('helvetica', i === rows.length - 1 ? 'bold' : 'normal')
    doc.text(label, summaryX + 3, rowY)
    doc.text(val, summaryX + summaryW - 3, rowY, { align: 'right' })
  })

  y += 6 + rows.length * 7 + 6
  drawBox(doc, MARGIN, y, contentW, 12)
  doc.setFont('helvetica', 'bold')
  doc.text('Amount Chargeable (in words):', MARGIN + 4, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.text(amountInWords(grandTotal), MARGIN + 4, y + 10)

  doc.setFontSize(7.5)
  doc.setTextColor(100, 116, 139)
  doc.text('This is a computer-generated invoice.', pageWidth / 2, y + 20, { align: 'center' })

  doc.setTextColor(...INK)
  return doc
}

export function openProductSaleBillPdf(sale) {
  const doc = generateProductSaleBill(sale)
  window.open(doc.output('bloburl'), '_blank')
}
