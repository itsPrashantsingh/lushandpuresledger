import { supabase } from './supabase'
import { downloadWorkbook, downloadCsv } from './import-export'
import { getMonthBounds, getBillStatus } from './utils'
import { getPaidAmountForBill } from './bills'

export async function exportMilkProduction(startDate, endDate, format = 'xlsx') {
  const { data, error } = await supabase
    .from('milk_production')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')

  if (error) throw error

  const rows = (data || []).map((r) => ({
    date: r.date,
    morning_litres: Number(r.morning_litres),
    evening_litres: Number(r.evening_litres),
    total_litres: Number(r.total_litres),
    notes: r.notes || ''
  }))

  const filename = `milk_production_${startDate}_to_${endDate}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') {
    downloadCsv(filename, rows)
  } else {
    downloadWorkbook(filename, [{ name: 'Production', rows }])
  }
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

  const { data: customers, error: custErr } = await supabase
    .from('customers')
    .select('*')
    .eq('active', true)
    .order('name')

  if (custErr) throw custErr

  const rows = []

  for (const c of customers || []) {
    const { data: entries } = await supabase
      .from('daily_entries')
      .select('total_qty, amount')
      .eq('customer_id', c.id)
      .gte('date', start)
      .lte('date', end)

    const totalLitres = (entries || []).reduce((s, e) => s + Number(e.total_qty), 0)
    const totalAmount = (entries || []).reduce((s, e) => s + Number(e.amount), 0)

    const { data: bills } = await supabase
      .from('bills')
      .select('*')
      .eq('customer_id', c.id)
      .gte('period_start', start)
      .lte('period_end', end)

    let billId = ''
    let paidAmount = 0
    let status = totalAmount > 0 ? 'no_bill' : 'no_delivery'

    if (bills && bills.length > 0) {
      const bill = bills[0]
      billId = bill.id
      paidAmount = await getPaidAmountForBill(bill.id)
      status = getBillStatus(bill, paidAmount)
    }

    const balance = totalAmount - paidAmount

    rows.push({
      customer_name: c.name,
      whatsapp_no: c.whatsapp_no,
      month,
      total_litres: totalLitres.toFixed(1),
      bill_amount: totalAmount,
      bill_id: billId,
      paid_amount: paidAmount,
      balance_due: balance > 0 ? balance : 0,
      status,
      rate: Number(c.rate)
    })
  }

  const filename = `bill_status_${month}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') {
    downloadCsv(filename, rows)
  } else {
    downloadWorkbook(filename, [{ name: 'Bill Status', rows }])
  }
  return rows.length
}

export async function exportCustomerDeliveries(startDate, endDate, format = 'xlsx') {
  const { data, error } = await supabase
    .from('daily_entries')
    .select('date, morning_qty, evening_qty, total_qty, rate, amount, notes, customers(name, whatsapp_no)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')

  if (error) throw error

  const rows = (data || []).map((e) => ({
    date: e.date,
    customer_name: e.customers?.name || '',
    whatsapp_no: e.customers?.whatsapp_no || '',
    morning_litres: Number(e.morning_qty),
    evening_litres: Number(e.evening_qty),
    total_litres: Number(e.total_qty),
    rate: Number(e.rate),
    amount: Number(e.amount),
    notes: e.notes || ''
  }))

  const filename = `customer_deliveries_${startDate}_to_${endDate}.${format === 'csv' ? 'csv' : 'xlsx'}`
  if (format === 'csv') {
    downloadCsv(filename, rows)
  } else {
    downloadWorkbook(filename, [{ name: 'Deliveries', rows }])
  }
  return rows.length
}
