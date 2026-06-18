import { useState } from 'react'
import { todayISO, currentYearMonth } from '../lib/utils'
import {
  exportMilkProduction,
  exportCustomerList,
  exportMonthlyBillStatus,
  exportCustomerDeliveries
} from '../lib/export-data'

export default function ImportExport() {
  const [prodStart, setProdStart] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [prodEnd, setProdEnd] = useState(todayISO())
  const [deliveryStart, setDeliveryStart] = useState(prodStart)
  const [deliveryEnd, setDeliveryEnd] = useState(todayISO())
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
        <h2 className="font-semibold text-slate-800">🥛 Milk Production</h2>
        <p className="mt-1 text-sm text-slate-500">Total dairy production (morning + evening litres per day)</p>
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

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">🚚 Customer Deliveries</h2>
        <p className="mt-1 text-sm text-slate-500">Per-customer morning/evening milk taken for a date range</p>
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
        <h2 className="font-semibold text-slate-800">👥 Customer List</h2>
        <p className="mt-1 text-sm text-slate-500">All customers with main fields + custom fields as columns</p>
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
        <p className="mt-1 text-sm text-slate-500">Each customer's litres, bill amount, paid, balance, and status for a month</p>
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
