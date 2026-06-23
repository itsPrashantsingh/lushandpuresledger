import { useState } from 'react'
import { todayISO, currentYearMonth } from '../lib/utils'
import {
  exportMilkProduction,
  exportButtermilkProduction,
  exportCustomerList,
  exportCattleList,
  exportMonthlyBillStatus,
  exportCustomerDeliveries,
  exportProductSales
} from '../lib/export-data'

export default function ImportExport() {
  const [prodStart, setProdStart] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [prodEnd, setProdEnd] = useState(todayISO())
  const [bmStart, setBmStart] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })
  const [bmEnd, setBmEnd] = useState(todayISO())
  const [deliveryStart, setDeliveryStart] = useState(prodStart)
  const [deliveryEnd, setDeliveryEnd] = useState(todayISO())
  const [salesStart, setSalesStart] = useState(prodStart)
  const [salesEnd, setSalesEnd] = useState(todayISO())
  const [billMonth, setBillMonth] = useState(currentYearMonth())
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState('')

  async function runExport(fn, label) {
    setLoading(label)
    setStatus('')
    try {
      const count = await fn()
      setStatus(`${label}: exported ${count} rows ✓`)
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
    setLoading('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Import & Export</h1>
        <p className="text-sm text-slate-500">Download reports as Excel (.xlsx) or CSV</p>
      </div>

      {status && (
        <p className={`rounded-lg px-4 py-2 text-sm ${status.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {status}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">🐄 Cattle Milk Production</h2>
        <p className="mt-1 text-sm text-slate-500">Per-cattle morning/evening litres for a date range</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">From</label>
            <input type="date" value={prodStart} onChange={(e) => setProdStart(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">To</label>
            <input type="date" value={prodEnd} onChange={(e) => setProdEnd(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportMilkProduction(prodStart, prodEnd, 'xlsx'), 'Milk production (Excel)')}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Export Excel
          </button>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportMilkProduction(prodStart, prodEnd, 'csv'), 'Milk production (CSV)')}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-purple-200 bg-purple-50 p-5">
        <h2 className="font-semibold text-slate-800">🥛 Buttermilk Production</h2>
        <p className="mt-1 text-sm text-slate-500">Per-customer buttermilk delivered for a date range — with quantity, rate, and amount</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">From</label>
            <input type="date" value={bmStart} onChange={(e) => setBmStart(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">To</label>
            <input type="date" value={bmEnd} onChange={(e) => setBmEnd(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportButtermilkProduction(bmStart, bmEnd, 'xlsx'), 'Buttermilk production (Excel)')}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            Export Excel
          </button>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportButtermilkProduction(bmStart, bmEnd, 'csv'), 'Buttermilk production (CSV)')}
            className="rounded-lg border border-purple-300 bg-white px-4 py-2 text-sm hover:bg-purple-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">🚚 Customer Deliveries</h2>
        <p className="mt-1 text-sm text-slate-500">Per-customer milk + buttermilk deliveries for a date range — with rate and daily totals</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">From</label>
            <input type="date" value={deliveryStart} onChange={(e) => setDeliveryStart(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">To</label>
            <input type="date" value={deliveryEnd} onChange={(e) => setDeliveryEnd(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportCustomerDeliveries(deliveryStart, deliveryEnd, 'xlsx'), 'Customer deliveries')}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Export Excel
          </button>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportCustomerDeliveries(deliveryStart, deliveryEnd, 'csv'), 'Customer deliveries CSV')}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">🛒 Product Sales</h2>
        <p className="mt-1 text-sm text-slate-500">Other product sales with GST, buyer details, and invoice totals</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">From</label>
            <input type="date" value={salesStart} onChange={(e) => setSalesStart(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">To</label>
            <input type="date" value={salesEnd} onChange={(e) => setSalesEnd(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportProductSales(salesStart, salesEnd, 'xlsx'), 'Product sales')}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Export Excel
          </button>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportProductSales(salesStart, salesEnd, 'csv'), 'Product sales CSV')}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">🐄 Cattle List</h2>
        <p className="mt-1 text-sm text-slate-500">All cattle with name, breed, category</p>
        <div className="mt-4 flex gap-3">
          <button disabled={!!loading} onClick={() => runExport(() => exportCattleList('xlsx'), 'Cattle list')} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            Export Excel
          </button>
          <button disabled={!!loading} onClick={() => runExport(() => exportCattleList('csv'), 'Cattle list CSV')} className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">👥 Customer List</h2>
        <p className="mt-1 text-sm text-slate-500">All customers — name, rate, qty, buttermilk subscription + custom fields. Compatible with re-import.</p>
        <div className="mt-4 flex gap-3">
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportCustomerList('xlsx'), 'Customer list')}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Export Excel
          </button>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportCustomerList('csv'), 'Customer list CSV')}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">🧾 Monthly Bill Status</h2>
        <p className="mt-1 text-sm text-slate-500">Each customer's milk litres, buttermilk litres/amount, total bill, paid, balance, and status for a month</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">Month</label>
            <input type="month" value={billMonth} onChange={(e) => setBillMonth(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" />
          </div>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportMonthlyBillStatus(billMonth, 'xlsx'), 'Bill status')}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Export Excel
          </button>
          <button
            disabled={!!loading}
            onClick={() => runExport(() => exportMonthlyBillStatus(billMonth, 'csv'), 'Bill status CSV')}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>
    </div>
  )
}
