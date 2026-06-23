import { supabase } from './supabase'
import { downloadWorkbook, downloadCsv } from './import-export'
import { getMonthBounds, getBillStatus } from './utils'

export async function exportMilkProduction(startDate, endDate, format = 'xlsx') {
  const { data, error } = await supabase
    .from('cattle_milk_entries')
    .select('date, morning_litres, evening_litres, total_litres, cattle(name, breed, category)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')

  if (error) throw error

  const rows = (data || []).map((r) => ({
    date: r.date,
    cattle_name: r.cattle?.name || '',
    breed: r.cattle?.breed || '',
    category: r.cattle?.category || '',
    morning_litres: Number(r.morning_litres),
    evening_litres: Number(r.evening_litres),
    total_litres: Number(r.total_litres)
  }))

  const filename = `cattle_milk_production_${startDate}_to_${endDate}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') {
    downloadCsv(filename, rows)
  } else {
    downloadWorkbook(filename, [{ name: 'Production', rows }])
  }
  return rows.length
}

export async function exportCattleList(format = 'xlsx') {
  const { data, error } = await supabase.from('cattle').select('*').order('name')
  if (error) throw error

  const rows = (data || []).map((c) => ({
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
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('name')

  if (error) throw error

  const allCustomKeys = new Set()
  ;(data || []).forEach((c) => {
    Object.keys(c.custom_fields || {}).forEach((k) => allCustomKeys.add(k))
  })

  const rows = (data || []).map((c) => {
    const row = {
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
  if (format === 'csv') {
    downloadCsv(filename, rows)
  } else {
    downloadWorkbook(filename, [{ name: 'Customers', rows }])
  }
  return rows.length
}

export async function exportMonthlyBillStatus(month, format = 'xlsx') {
  const { start, end } = getMonthBounds(month)

  const [
    { data: customers, error: custErr },
    { data: allEntries },
    { data: allBills }
  ] = await Promise.all([
    supabase.from('customers').select('*').eq('active', true).order('name'),
    supabase.from('daily_entries').select('customer_id, total_qty, amount').gte('date', start).lte('date', end),
    supabase.from('bills').select('*').gte('period_start', start).lte('period_end', end)
  ])

  if (custErr) throw custErr

  const billIds = (allBills || []).map((b) => b.id)
  const { data: allPayments } = billIds.length
    ? await supabase.from('payments').select('bill_id, amount').in('bill_id', billIds)
    : { data: [] }

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

  const rows = (customers || []).map((c) => {
    const entries = entriesByCustomer[c.id] || []
    const totalLitres = entries.reduce((s, e) => s + Number(e.total_qty), 0)
    const totalAmount = entries.reduce((s, e) => s + Number(e.amount), 0)

    const bill = billsByCustomer[c.id]
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

    const balance = totalBillAmount - paidAmount
    return {
      customer_name: c.name,
      whatsapp_no: c.whatsapp_no,
      month,
      milk_litres: totalLitres.toFixed(1),
      milk_amount: totalAmount,
      buttermilk_litres: buttermilkLitres,
      buttermilk_amount: buttermilkAmount,
      total_bill_amount: totalBillAmount,
      bill_id: billId,
      paid_amount: paidAmount,
      balance_due: balance > 0 ? balance : 0,
      status,
      milk_rate: Number(c.rate)
    }
  })

  const filename = `bill_status_${month}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Bill Status', rows }])
  return rows.length
}

export async function exportButtermilkProduction(startDate, endDate, format = 'xlsx') {
  const { data, error } = await supabase
    .from('buttermilk_entries')
    .select('date, quantity, rate, amount, customers(name, whatsapp_no)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')

  if (error) throw error

  const rows = (data || []).map((b) => ({
    date: b.date,
    customer_name: b.customers?.name || '',
    whatsapp_no: b.customers?.whatsapp_no || '',
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
  const [{ data: milkData, error }, { data: bmData }] = await Promise.all([
    supabase
      .from('daily_entries')
      .select('morning_qty, evening_qty, total_qty, rate, amount, customer_id, customers(name, whatsapp_no)')
      .gte('date', startDate)
      .lte('date', endDate),
    supabase
      .from('buttermilk_entries')
      .select('customer_id, quantity, amount')
      .gte('date', startDate)
      .lte('date', endDate)
  ])

  if (error) throw error

  // Aggregate milk entries per customer
  const milkByCustomer = {}
  for (const e of milkData || []) {
    if (!milkByCustomer[e.customer_id]) {
      milkByCustomer[e.customer_id] = {
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

  // Aggregate buttermilk entries per customer
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
    const milkAmount = m?.milk_amount || 0
    const bmAmount = bm?.amount || 0
    const bmQty = bm?.qty || 0
    return {
      customer_name: m?.name || '',
      whatsapp_no: m?.whatsapp_no || '',
      morning_litres: m?.morning_litres || 0,
      evening_litres: m?.evening_litres || 0,
      total_milk_litres: m?.total_milk_litres || 0,
      milk_rate: m ? ([...m.rates].length === 1 ? [...m.rates][0] : 'mixed') : '',
      milk_amount: milkAmount,
      buttermilk_litres: bmQty,
      buttermilk_rate: bmQty > 0 ? (bmAmount / bmQty).toFixed(2) : 0,
      buttermilk_amount: bmAmount,
      total_amount: milkAmount + bmAmount
    }
  }).sort((a, b) => a.customer_name.localeCompare(b.customer_name))

  const filename = `customer_deliveries_${startDate}_to_${endDate}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') downloadCsv(filename, rows)
  else downloadWorkbook(filename, [{ name: 'Deliveries', rows }])
  return rows.length
}

export async function exportProductSales(startDate, endDate, format = 'xlsx') {
  const { data, error } = await supabase
    .from('product_sales')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')

  if (error) throw error

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
  if (format === 'csv') {
    downloadCsv(filename, rows)
  } else {
    downloadWorkbook(filename, [{ name: 'Product Sales', rows }])
  }
  return rows.length
}
