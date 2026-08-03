const JSZip = require('jszip')
const { sendMail } = require('./index')

function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function monthLabel(month) {
  // month = 'YYYY-MM'
  const [y, m] = String(month).split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function buildReportHtml(month, items) {
  const total = items.reduce((s, it) => s + Number(it.bill.total_amount || 0), 0)
  const rows = items.map((it) => {
    const b = it.bill
    const status = b.paid ? 'Paid' : 'Unpaid'
    const color = b.paid ? '#16a34a' : '#dc2626'
    return `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${b.customers?.name || ''}${b.customers?.customer_id ? ` <span style="color:#94a3b8">(${b.customers.customer_id})</span>` : ''}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace">${b.id}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${money(b.total_amount)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${color};font-weight:600">${status}</td>
    </tr>`
  }).join('')

  return `<div style="font-family:Arial,sans-serif;color:#1e293b">
    <h2 style="color:#15803d">Bills for ${monthLabel(month)}</h2>
    <p>${items.length} bill(s) generated · Total <strong>${money(total)}</strong>. All bill PDFs are attached as a single zip file.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead>
        <tr style="text-align:left;color:#64748b">
          <th style="padding:6px 10px;border-bottom:2px solid #ddd">Customer</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd">Bill No</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd;text-align:right">Amount</th>
          <th style="padding:6px 10px;border-bottom:2px solid #ddd">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px">Automated report from your dairy billing system.</p>
  </div>`
}

/**
 * Email the month's bills to the owner as ONE zip attachment.
 *
 * Previously every bill PDF was attached separately — with 70+ bills that's 70+ MIME
 * parts in one SMTP message, which was timing out against Hostinger's server. Zipping
 * them into a single attachment sends one file instead.
 * @param {object} p { to, month, items:[{ bill, pdfBuffer(Buffer), filename }] }
 */
async function sendBillsReport({ to, month, items }) {
  if (!to) return { ok: false, error: 'No recipient email configured' }
  if (!items?.length) return { ok: false, error: 'No bills to email' }

  const withPdf = items.filter((it) => it.pdfBuffer)

  const zip = new JSZip()
  for (const it of withPdf) {
    zip.file(it.filename || `${it.bill.id}.pdf`, it.pdfBuffer)
  }
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  return sendMail({
    to,
    subject: `Bills for ${monthLabel(month)} — ${items.length} bill(s)`,
    html: buildReportHtml(month, items),
    attachments: [{
      filename: `bills_${month}.zip`,
      content: zipBuffer,
      contentType: 'application/zip'
    }]
  })
}

module.exports = { sendBillsReport, buildReportHtml }
