import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { createBill, getPaidAmountForBill, createRazorpayLink, billableEntries, entrySubtotal } from '../lib/bills'
import { openBillPdf } from '../lib/pdf'
import { shareBillOnWhatsApp } from '../lib/whatsapp'
import LoadingOverlay from '../components/LoadingOverlay'
import {
  formatCurrency,
  formatDate,
  currentYearMonth,
  getMonthBounds
} from '../lib/utils'
import { downloadWorkbook, downloadCsv } from '../lib/import-export'

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState(null)
  const [month, setMonth] = useState(currentYearMonth())
  const [entries, setEntries] = useState([])
  const [payments, setPayments] = useState([])
  const [summary, setSummary] = useState({ litres: 0, amount: 0, paid: 0, due: 0 })
  const [currentBill, setCurrentBill] = useState(null)
  const [buttermilkTotal, setButtermilkTotal] = useState({ totalQty: 0, subtotal: 0 })
  const [buttermilkByDate, setButtermilkByDate] = useState({})
  const [loading, setLoading] = useState(true)
  const [actionMsg, setActionMsg] = useState('')
  const [razorpayLoading, setRazorpayLoading] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [editPhoneError, setEditPhoneError] = useState('')

  useEffect(() => {
    if (id) loadAll()
  }, [id, month])

  async function loadAll() {
    setLoading(true)
    const { data: cust, error: custErr } = await supabase.from('customers').select('*').eq('id', id).single()

    if (custErr || !cust) {
      setCustomer(null)
      setLoading(false)
      return
    }

    setCustomer(cust)
    setEditForm({
      name: cust.name,
      whatsapp_no: cust.whatsapp_no,
      address: cust.address || '',
      rate: cust.rate,
      morning_qty: cust.morning_qty,
      evening_qty: cust.evening_qty,
      buttermilk_required: cust.buttermilk_required || false,
      buttermilk_quantity: cust.buttermilk_quantity || 0,
      buttermilk_rate: cust.buttermilk_rate || 0
    })

    const { start, end } = getMonthBounds(month)
    const { data: ents } = await supabase
      .from('daily_entries')
      .select('*')
      .eq('customer_id', id)
      .gte('date', start)
      .lte('date', end)
      .order('date')

    const validEntries = billableEntries(ents || [])
    const litres = validEntries.reduce((s, e) => s + Number(e.total_qty), 0)
    const amount = entrySubtotal(validEntries)
    setEntries(validEntries)

    const { data: bmEnts } = await supabase
      .from('buttermilk_entries')
      .select('date, quantity, rate, amount')
      .eq('customer_id', id)
      .gte('date', start)
      .lte('date', end)
    const bmList = bmEnts || []
    const bmTotal = {
      totalQty: bmList.reduce((s, b) => s + Number(b.quantity), 0),
      subtotal: bmList.reduce((s, b) => s + Number(b.amount), 0)
    }
    setButtermilkTotal(bmTotal)
    const byDate = {}
    for (const b of bmList) byDate[b.date] = { quantity: Number(b.quantity), rate: Number(b.rate), amount: Number(b.amount) }
    setButtermilkByDate(byDate)

    const { data: pays } = await supabase
      .from('payments')
      .select('*, bills(id, period_start, period_end)')
      .eq('customer_id', id)
      .order('paid_at', { ascending: false })

    setPayments(pays || [])

    const { data: bill } = await supabase
      .from('bills')
      .select('*')
      .eq('customer_id', id)
      .eq('period_start', start)
      .eq('period_end', end)
      .maybeSingle()

    setCurrentBill(bill)

    let paid = 0
    let due = amount + bmTotal.subtotal
    if (bill) {
      paid = await getPaidAmountForBill(bill.id)
      due = Math.max(0, Number(bill.total_amount) - paid)
    }

    setSummary({ litres, amount, paid, due })
    setLoading(false)
  }

  function validEntriesForBill() {
    return (entries.length > 0 && entrySubtotal(entries) > 0) || buttermilkTotal.subtotal > 0
  }

  async function handleGenerateBill() {
    if (!validEntriesForBill()) {
      setActionMsg('No deliveries this month — cannot generate bill')
      return
    }
    try {
      const { start, end } = getMonthBounds(month)
      let bill = currentBill
      if (!bill) {
        const bmData = buttermilkTotal.subtotal > 0 ? buttermilkTotal : null
        bill = await createBill(id, start, end, entries, customer, bmData)
        setCurrentBill(bill)
      }
      openBillPdf(customer, entries, bill)
      setActionMsg(`Bill ${bill.id} ready`)
    } catch (err) {
      setActionMsg('Error: ' + err.message)
    }
  }

  async function handleDeleteAndRegenerateBill() {
    if (!currentBill) return
    if (!window.confirm('Delete current bill and regenerate?')) return
    try {
      const { error } = await supabase.from('bills').delete().eq('id', currentBill.id)
      if (error) throw error
      setCurrentBill(null)
      const { start, end } = getMonthBounds(month)
      const bmData = buttermilkTotal.subtotal > 0 ? buttermilkTotal : null
      const newBill = await createBill(id, start, end, entries, customer, bmData)
      setCurrentBill(newBill)
      openBillPdf(customer, entries, newBill)
      setActionMsg(`Bill regenerated: ${newBill.id}`)
    } catch (err) {
      setActionMsg('Error: ' + err.message)
    }
  }

  async function handleCreateRazorpayLink() {
    if (!currentBill) {
      setActionMsg('Generate a bill first')
      return
    }
    setRazorpayLoading(true)
    setActionMsg('')
    try {
      const url = await createRazorpayLink(currentBill, customer)
      setCurrentBill({ ...currentBill, razorpay_short_url: url })
      setActionMsg('Razorpay link created ✓')
    } catch (err) {
      setActionMsg('Razorpay error: ' + (err.response?.data?.error || err.message))
    } finally {
      setRazorpayLoading(false)
    }
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    const digits = (editForm.whatsapp_no || '').replace(/\D/g, '')
    if (digits.length !== 10) {
      setEditPhoneError('WhatsApp number must be exactly 10 digits')
      return
    }
    setEditPhoneError('')
    const { error } = await supabase.from('customers').update({ ...editForm, whatsapp_no: digits }).eq('id', id)
    if (error) { alert(error.message); return }
    setShowEdit(false)
    loadAll()
  }

  async function handleDelete() {
    if (!customer) return
    if (!window.confirm(`Delete "${customer.name}"? All bills, deliveries and payments will be removed.`)) return

    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) { alert(error.message); return }
    navigate('/customers')
  }

  async function handleSendWhatsApp() {
    if (!currentBill) {
      setActionMsg('Generate a bill first')
      return
    }
    try {
      const result = await shareBillOnWhatsApp(customer, entries, currentBill, currentBill.razorpay_short_url)
      if (result.success && !result.cancelled) {
        await supabase.from('bills').update({ sent_at: new Date().toISOString() }).eq('id', currentBill.id)
        setActionMsg(result.attached ? 'Bill sent with PDF attached ✓' : 'PDF downloaded — attach in WhatsApp ✓')
      }
    } catch (err) {
      setActionMsg(err.message)
    }
  }

  function exportMonthEntries(format) {
    const rows = entries.map((e) => {
      const bm = buttermilkByDate[e.date]
      const row = {
        date: e.date,
        morning_litres: Number(e.morning_qty),
        evening_litres: Number(e.evening_qty),
        total_milk_litres: Number(e.total_qty),
        milk_rate: Number(e.rate),
        milk_amount: Number(e.amount)
      }
      if (customer.buttermilk_required) {
        row.buttermilk_litres = bm ? Number(bm.quantity) : 0
        row.buttermilk_rate = bm ? Number(bm.rate) : 0
        row.buttermilk_amount = bm ? Number(bm.amount) : 0
      }
      row.day_total = Number(e.amount) + (bm ? Number(bm.amount) : 0)
      return row
    })
    const safeName = customer.name.replace(/\s+/g, '_')
    const filename = `${safeName}_${month}`
    if (format === 'csv') downloadCsv(`${filename}.csv`, rows)
    else downloadWorkbook(`${filename}.xlsx`, [{ name: 'Deliveries', rows }])
  }

  if (loading) return <p className="text-center text-slate-500">Loading...</p>
  if (!customer) return <p className="text-center text-slate-500">Customer not found. <Link to="/customers" className="text-green-600">Go back</Link></p>

  return (
    <div className="space-y-6">
      {razorpayLoading && (
        <LoadingOverlay
          title="Creating Razorpay payment link…"
          subtitle={`For ${customer.name}`}
        />
      )}
      <Link to="/customers" className="text-sm text-green-600 hover:underline">← Back to Customers</Link>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-mono text-slate-400">{customer.customer_id || '—'}</p>
            <h1 className="text-2xl font-bold text-slate-800">{customer.name}</h1>
            <p className="text-slate-500">+91 {customer.whatsapp_no}</p>
            {customer.address && <p className="text-sm text-slate-500">{customer.address}</p>}
            <p className="mt-1 text-sm text-slate-400">Rate: {formatCurrency(customer.rate)}/L · Morning: {customer.morning_qty}L · Evening: {customer.evening_qty}L</p>
            {customer.buttermilk_required && (
              <p className="mt-1 text-sm text-purple-600">Buttermilk: {customer.buttermilk_quantity}L/day @ {formatCurrency(customer.buttermilk_rate)}/L</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowEdit(true)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-600">Month:</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5"
        />
      </div>

      <div className={`grid grid-cols-2 gap-3 ${buttermilkTotal.totalQty > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <div className="rounded-xl bg-slate-100 p-3 text-center">
          <p className="text-xs text-slate-500">Litres</p>
          <p className="text-xl font-bold">{summary.litres.toFixed(1)}</p>
        </div>
        <div className="rounded-xl bg-slate-100 p-3 text-center">
          <p className="text-xs text-slate-500">Milk Amount</p>
          <p className="text-xl font-bold">{formatCurrency(summary.amount)}</p>
        </div>
        {buttermilkTotal.totalQty > 0 && (
          <div className="rounded-xl bg-purple-50 p-3 text-center">
            <p className="text-xs text-purple-600">Buttermilk</p>
            <p className="text-xl font-bold text-purple-700">{formatCurrency(buttermilkTotal.subtotal)}</p>
            <p className="text-xs text-purple-400">{buttermilkTotal.totalQty.toFixed(1)} L</p>
          </div>
        )}
        <div className="rounded-xl bg-green-50 p-3 text-center">
          <p className="text-xs text-green-600">Paid</p>
          <p className="text-xl font-bold text-green-700">{formatCurrency(summary.paid)}</p>
        </div>
        <div className="rounded-xl bg-red-50 p-3 text-center">
          <p className="text-xs text-red-600">Due</p>
          <p className="text-xl font-bold text-red-700">{formatCurrency(summary.due)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={handleGenerateBill} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
          {currentBill ? 'View Bill PDF' : 'Generate Bill'}
        </button>
        {currentBill && (
          <button onClick={handleDeleteAndRegenerateBill} className="rounded-lg border border-purple-400 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100">
            Regenerate Bill
          </button>
        )}
        <button
          onClick={handleCreateRazorpayLink}
          disabled={razorpayLoading}
          className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          {razorpayLoading ? 'Creating link…' : 'Create Razorpay Link'}
        </button>
        <button onClick={handleSendWhatsApp} className="rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100">
          Send on WhatsApp
        </button>
      </div>

      {actionMsg && <p className="text-sm text-slate-600">{actionMsg}</p>}
      {currentBill && (
        <p className="text-sm text-slate-500">
          Current bill: {currentBill.id} · {formatCurrency(currentBill.total_amount)}
          {currentBill.razorpay_short_url && (
            <> · <a href={currentBill.razorpay_short_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Payment link</a></>
          )}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Daily Entries</h2>
          {entries.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => exportMonthEntries('xlsx')}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                Export Excel
              </button>
              <button
                onClick={() => exportMonthEntries('csv')}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Export CSV
              </button>
            </div>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">No entries this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Morning</th>
                  <th className="pb-2 pr-3">Evening</th>
                  <th className="pb-2 pr-3">Total</th>
                  {customer.buttermilk_required && <th className="pb-2 pr-3 text-purple-600">Buttermilk</th>}
                  <th className="pb-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const bm = buttermilkByDate[e.date]
                  return (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3">{formatDate(e.date)}</td>
                      <td className="py-2 pr-3">{e.morning_qty}L</td>
                      <td className="py-2 pr-3">{e.evening_qty}L</td>
                      <td className="py-2 pr-3">{e.total_qty}L</td>
                      {customer.buttermilk_required && (
                        <td className="py-2 pr-3 text-purple-700">{bm ? `${bm.quantity}L` : '—'}</td>
                      )}
                      <td className="py-2">{formatCurrency(Number(e.amount) + (bm?.amount || 0))}</td>
                    </tr>
                  )
                })}
              </tbody>
              {buttermilkTotal.totalQty > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 font-medium text-slate-700">
                    <td className="pt-2 pr-3">Total</td>
                    <td className="pt-2 pr-3" />
                    <td className="pt-2 pr-3" />
                    <td className="pt-2 pr-3">{summary.litres.toFixed(1)}L</td>
                    <td className="pt-2 pr-3 text-purple-700">{buttermilkTotal.totalQty.toFixed(1)}L</td>
                    <td className="pt-2">{formatCurrency(summary.amount + buttermilkTotal.subtotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">Payment History</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">No payments yet.</p>
        ) : (
          <div className="space-y-3">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center gap-3 border-l-2 border-green-500 pl-3">
                <div>
                  <p className="font-medium text-green-700">{formatCurrency(p.amount)}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(p.paid_at?.slice(0, 10))} · {p.mode.toUpperCase()}
                    {p.bills?.id && ` · ${p.bills.id}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showEdit && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleSaveEdit} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">Edit Customer</h2>
            <div className="space-y-3">
              <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full rounded-lg border px-3 py-2" placeholder="Name" />
              <div>
                <input
                  required
                  type="tel"
                  placeholder="WhatsApp (10 digits)"
                  value={editForm.whatsapp_no}
                  maxLength={10}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 10)
                    setEditForm({ ...editForm, whatsapp_no: v })
                    setEditPhoneError(v.length > 0 && v.length < 10 ? 'Must be 10 digits' : '')
                  }}
                  className={`w-full rounded-lg border px-3 py-2 ${editPhoneError ? 'border-red-400' : ''}`}
                />
                {editPhoneError && <p className="mt-1 text-xs text-red-500">{editPhoneError}</p>}
              </div>
              <input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} className="w-full rounded-lg border px-3 py-2" placeholder="Address" />
              <div className="grid grid-cols-3 gap-2">
                <input type="number" value={editForm.rate} onChange={(e) => setEditForm({ ...editForm, rate: e.target.value })} className="rounded-lg border px-3 py-2" placeholder="Rate ₹/L" />
                <input type="number" step="0.5" value={editForm.morning_qty} onChange={(e) => setEditForm({ ...editForm, morning_qty: e.target.value })} className="rounded-lg border px-3 py-2" placeholder="Morning L" />
                <input type="number" step="0.5" value={editForm.evening_qty} onChange={(e) => setEditForm({ ...editForm, evening_qty: e.target.value })} className="rounded-lg border px-3 py-2" placeholder="Evening L" />
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-purple-800">
                  <input
                    type="checkbox"
                    checked={!!editForm.buttermilk_required}
                    onChange={(e) => setEditForm({ ...editForm, buttermilk_required: e.target.checked })}
                    className="h-4 w-4 accent-purple-600"
                  />
                  Buttermilk Subscription
                </label>
                {editForm.buttermilk_required && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-purple-600">Qty / day (L)</label>
                      <input
                        type="number" step="0.5" min="0"
                        value={editForm.buttermilk_quantity}
                        onChange={(e) => setEditForm({ ...editForm, buttermilk_quantity: e.target.value })}
                        className="w-full rounded-lg border border-purple-200 px-3 py-2"
                        placeholder="e.g. 1"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-purple-600">Rate ₹/L</label>
                      <input
                        type="number" step="0.5" min="0"
                        value={editForm.buttermilk_rate}
                        onChange={(e) => setEditForm({ ...editForm, buttermilk_rate: e.target.value })}
                        className="w-full rounded-lg border border-purple-200 px-3 py-2"
                        placeholder="e.g. 20"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="submit" className="flex-1 rounded-lg bg-green-600 py-2 text-white">Save</button>
              <button type="button" onClick={() => setShowEdit(false)} className="flex-1 rounded-lg border py-2">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
