import JSZip from 'jszip'
import { supabase } from './supabase'
import { downloadWorkbook, downloadCsv } from './import-export'
import { getMonthBounds, getBillStatus, fetchAllRows, formatQty } from './utils'
import { getMonthlyBillPackages } from './bills'
import { generateBill } from './pdf'

export async function exportMilkProduction(startDate, endDate, format = 'xlsx') {
  const data = await fetchAllRows(() => supabase
    .from('cattle_milk_entries')
    .select('date, morning_litres, evening_litres, total_litres, cattle(cattle_id, name, breed, category)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date'))

  const rows = (data || []).map((r) => ({
    cattle_id: r.cattle?.cattle_id || '',
    cattle_name: r.cattle?.name || '',
    breed: r.cattle?.breed || '',
    category: r.cattle?.category || '',
    date: r.date,
    morning_litres: Number(r.morning_litres),
    evening_litres: Number(r.evening_litres),
    total_litres: Number(r.total_litres)
  }))

  const filename = `cattle_milk_production_${startDate}_to_${endDate}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Production', rows }])
  return rows.length
}

export async function exportCattleList(format = 'xlsx') {
  const { data, error } = await supabase.from('cattle').select('*').order('name')
  if (error) throw error

  const rows = (data || []).map((c) => ({
    cattle_id: c.cattle_id || '',
    name: c.name,
    breed: c.breed || '',
    category: c.category,
    active: c.active ? 'yes' : 'no'
  }))

  const filename = `cattle_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Cattle', rows }])
  return rows.length
}

export async function exportCustomerList(format = 'xlsx') {
  const { data, error } = await supabase.from('customers').select('*').order('name')
  if (error) throw error

  const allCustomKeys = new Set()
  ;(data || []).forEach((c) => {
    Object.keys(c.custom_fields || {}).forEach((k) => allCustomKeys.add(k))
  })

  const rows = (data || []).map((c) => {
    const row = {
      customer_id: c.customer_id || '',
      name: c.name,
      whatsapp_no: c.whatsapp_no,
      address: c.address || '',
      rate: Number(c.rate),
      morning_qty: Number(c.morning_qty),
      evening_qty: Number(c.evening_qty),
      buttermilk_required: c.buttermilk_required ? 'yes' : 'no',
      buttermilk_quantity: Number(c.buttermilk_quantity || 0),
      buttermilk_rate: Number(c.buttermilk_rate || 0),
      active: c.active ? 'yes' : 'no'
    }
    allCustomKeys.forEach((k) => {
      row[k] = (c.custom_fields || {})[k] || ''
    })
    return row
  })

  const filename = `customers_${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Customers', rows }])
  return rows.length
}

export async function exportMonthlyBillStatus(month, format = 'xlsx') {
  const { start, end } = getMonthBounds(month)

  // Not filtered by active — a customer paused mid-month can still have a bill or
  // delivery entries for this period, and must not silently disappear from the export
  // (same fix as billing/daily-entry: eligibility comes from actual data, not the flag).
  const [
    { data: allCustomers, error: custErr },
    allEntries,
    { data: allBills }
  ] = await Promise.all([
    supabase.from('customers').select('*'),
    // Paginated: a month of deliveries exceeds PostgREST's 1000-row cap, and a truncated
    // read here silently under-states every exported total.
    fetchAllRows(() => supabase.from('daily_entries').select('customer_id, total_qty, amount').gte('date', start).lte('date', end)),
    supabase.from('bills').select('*').gte('period_start', start).lte('period_end', end)
  ])

  if (custErr) throw custErr

  const billIds = (allBills || []).map((b) => b.id)
  const { data: allPayments } = billIds.length
    ? await supabase.from('payments').select('bill_id, amount').in('bill_id', billIds)
    : { data: [] }

  const customerById = {}
  for (const c of allCustomers || []) customerById[c.id] = c

  const entriesByCustomer = {}
  for (const e of allEntries || []) {
    if (!entriesByCustomer[e.customer_id]) entriesByCustomer[e.customer_id] = []
    entriesByCustomer[e.customer_id].push(e)
  }

  const billsByCustomer = {}
  for (const b of allBills || []) billsByCustomer[b.customer_id] = b

  const paidByBill = {}
  for (const p of allPayments || []) {
    paidByBill[p.bill_id] = (paidByBill[p.bill_id] || 0) + Number(p.amount)
  }
  // Rounded after accumulating — a bill with several partial payments can drift into
  // floating-point noise (e.g. 1234.5600000000002) that would otherwise land in the sheet.
  for (const billId of Object.keys(paidByBill)) paidByBill[billId] = formatQty(paidByBill[billId])

  // One row per customer who has a bill OR a delivery entry this period — this is the
  // union that matches what the Bills tab shows, regardless of current active/paused status.
  const relevantCustomerIds = new Set([...Object.keys(billsByCustomer), ...Object.keys(entriesByCustomer)])

  const rows = [...relevantCustomerIds].map((customerId) => {
    const c = customerById[customerId]
    const entries = entriesByCustomer[customerId] || []
    // Rounded — a month of entries reduced with += drifts into floating-point noise
    // (e.g. 12.100000000000001), which would otherwise be written straight into the sheet.
    const totalLitres = formatQty(entries.reduce((s, e) => s + Number(e.total_qty), 0))
    const totalAmount = formatQty(entries.reduce((s, e) => s + Number(e.amount), 0))

    const bill = billsByCustomer[customerId]
    let billId = ''
    let paidAmount = 0
    let status = totalAmount > 0 ? 'no_bill' : 'no_delivery'
    let buttermilkLitres = 0
    let buttermilkAmount = 0
    let totalBillAmount = totalAmount

    if (bill) {
      billId = bill.id
      paidAmount = paidByBill[bill.id] || 0
      status = getBillStatus(bill, paidAmount)
      buttermilkLitres = Number(bill.buttermilk_total_qty || 0)
      buttermilkAmount = Number(bill.buttermilk_subtotal || 0)
      totalBillAmount = Number(bill.total_amount || 0)
    }

    const balance = formatQty(totalBillAmount - paidAmount)
    return {
      customer_id: c?.customer_id || '',
      customer_name: c?.name || '(deleted customer)',
      whatsapp_no: c?.whatsapp_no || '',
      month,
      customer_status: c?.active !== false ? 'active' : 'paused',
      milk_litres: totalLitres.toFixed(1),
      milk_amount: totalAmount,
      buttermilk_litres: buttermilkLitres,
      buttermilk_amount: buttermilkAmount,
      total_bill_amount: totalBillAmount,
      bill_id: billId,
      paid_amount: paidAmount,
      balance_due: balance > 0 ? balance : 0,
      status,
      milk_rate: Number(c?.rate || 0)
    }
  }).sort((a, b) => a.customer_name.localeCompare(b.customer_name))

  const filename = `bill_status_${month}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Bill Status', rows }])
  return rows.length
}

/**
 * Every bill PDF for a month, zipped into one download. Same PDF layout each customer's
 * bill already uses (generateBill in ./pdf) — this just batches all of them client-side
 * instead of opening/downloading one at a time, and mirrors the zip-instead-of-many-
 * attachments fix already applied to the monthly email report (backend/lib/email/bill-report.js).
 */
export async function exportAllBillsZip(month) {
  const packages = await getMonthlyBillPackages(month)
  if (!packages.length) return 0

  const zip = new JSZip()
  const usedNames = new Set()
  for (const pkg of packages) {
    const doc = generateBill(pkg.customer, pkg.entries, pkg.bill)
    const safeName = (pkg.customer?.name || 'customer').trim().replace(/\s+/g, '_')
    const phone = pkg.customer?.whatsapp_no || ''
    let filename = `${safeName}${phone ? `_${phone}` : ''}.pdf`
    // Two customers can share a name (or, rarely, both be missing a saved number) —
    // fall back to the bill id so one file never silently overwrites another in the zip.
    if (usedNames.has(filename)) filename = `${safeName}${phone ? `_${phone}` : ''}_${pkg.bill.id}.pdf`
    usedNames.add(filename)
    zip.file(filename, doc.output('arraybuffer'))
  }
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })

  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bills_${month}.zip`
  a.click()
  URL.revokeObjectURL(url)

  return packages.length
}

export async function exportButtermilkProduction(startDate, endDate, format = 'xlsx') {
  const data = await fetchAllRows(() => supabase
    .from('buttermilk_entries')
    .select('date, quantity, rate, amount, customers(customer_id, name, whatsapp_no)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date'))

  const rows = (data || []).map((b) => ({
    customer_id: b.customers?.customer_id || '',
    customer_name: b.customers?.name || '',
    whatsapp_no: b.customers?.whatsapp_no || '',
    date: b.date,
    quantity_litres: Number(b.quantity),
    rate: Number(b.rate),
    amount: Number(b.amount)
  }))

  const filename = `buttermilk_production_${startDate}_to_${endDate}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Buttermilk', rows }])
  return rows.length
}

export async function exportCustomerDeliveries(startDate, endDate, format = 'xlsx') {
  const [milkData, bmData] = await Promise.all([
    fetchAllRows(() => supabase
      .from('daily_entries')
      .select('morning_qty, evening_qty, total_qty, rate, amount, customer_id, customers(customer_id, name, whatsapp_no)')
      .gte('date', startDate)
      .lte('date', endDate)),
    fetchAllRows(() => supabase
      .from('buttermilk_entries')
      .select('customer_id, quantity, amount')
      .gte('date', startDate)
      .lte('date', endDate))
  ])

  const milkByCustomer = {}
  for (const e of milkData || []) {
    if (!milkByCustomer[e.customer_id]) {
      milkByCustomer[e.customer_id] = {
        customer_id: e.customers?.customer_id || '',
        name: e.customers?.name || '',
        whatsapp_no: e.customers?.whatsapp_no || '',
        morning_litres: 0, evening_litres: 0, total_milk_litres: 0, milk_amount: 0,
        rates: new Set()
      }
    }
    const m = milkByCustomer[e.customer_id]
    m.morning_litres += Number(e.morning_qty)
    m.evening_litres += Number(e.evening_qty)
    m.total_milk_litres += Number(e.total_qty)
    m.milk_amount += Number(e.amount)
    m.rates.add(Number(e.rate))
  }

  const bmByCustomer = {}
  for (const b of bmData || []) {
    if (!bmByCustomer[b.customer_id]) bmByCustomer[b.customer_id] = { qty: 0, amount: 0 }
    bmByCustomer[b.customer_id].qty += Number(b.quantity)
    bmByCustomer[b.customer_id].amount += Number(b.amount)
  }

  const allCustomerIds = new Set([...Object.keys(milkByCustomer), ...Object.keys(bmByCustomer)])
  const rows = [...allCustomerIds].map((cid) => {
    const m = milkByCustomer[cid]
    const bm = bmByCustomer[cid]
    // Rounded — a month of += accumulation drifts into floating-point noise (e.g.
    // 12.100000000000001), which would otherwise land as-is in the exported sheet.
    const milkAmount = formatQty(m?.milk_amount || 0)
    const bmAmount = formatQty(bm?.amount || 0)
    const bmQty = formatQty(bm?.qty || 0)
    return {
      customer_id: m?.customer_id || '',
      customer_name: m?.name || '',
      whatsapp_no: m?.whatsapp_no || '',
      morning_litres: formatQty(m?.morning_litres || 0),
      evening_litres: formatQty(m?.evening_litres || 0),
      total_milk_litres: formatQty(m?.total_milk_litres || 0),
      milk_rate: m ? ([...m.rates].length === 1 ? [...m.rates][0] : 'mixed') : '',
      milk_amount: milkAmount,
      buttermilk_litres: bmQty,
      buttermilk_rate: bmQty > 0 ? (bmAmount / bmQty).toFixed(2) : 0,
      buttermilk_amount: bmAmount,
      total_amount: formatQty(milkAmount + bmAmount)
    }
  }).sort((a, b) => a.customer_name.localeCompare(b.customer_name))

  const filename = `customer_deliveries_${startDate}_to_${endDate}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Deliveries', rows }])
  return rows.length
}

export async function exportProductSales(startDate, endDate, format = 'xlsx') {
  const data = await fetchAllRows(() => supabase
    .from('product_sales')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date'))

  const rows = (data || []).map((sale) => ({
    date: sale.date,
    invoice_no: sale.invoice_no,
    buyer_name: sale.buyer_name,
    buyer_phone: sale.buyer_phone || '',
    buyer_gstin: sale.buyer_gstin || '',
    product_name: sale.product_name,
    category: sale.category || '',
    hsn_code: sale.hsn_code || '',
    quantity: Number(sale.quantity),
    unit: sale.unit,
    rate_per_unit: Number(sale.rate),
    taxable_amount: Number(sale.subtotal),
    gst_rate: Number(sale.gst_rate),
    cgst: Number(sale.cgst || 0),
    sgst: Number(sale.sgst || 0),
    igst: Number(sale.igst || 0),
    total_amount: Number(sale.total_amount),
    payment_mode: sale.payment_mode || '',
    sent_at: sale.sent_at || '',
    notes: sale.notes || ''
  }))

  const filename = `product_sales_${startDate}_to_${endDate}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Product Sales', rows }])
  return rows.length
}
