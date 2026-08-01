import { Link } from 'react-router-dom'
import { formatCurrency } from '../lib/utils'

export default function CustomerCard({ customer, monthTotal, status, milkQty = 0, buttermilkQty = 0, monthText = 'this month', month }) {
  const badge = {
    paid: 'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    due: 'bg-red-100 text-red-700',
    unpaid: 'bg-red-100 text-red-700'
  }

  return (
    <Link
      // Carry the selected month into the profile so it opens on the month you were
      // looking at, instead of resetting to the current one.
      to={month ? `/customers/${customer.id}?month=${month}` : `/customers/${customer.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-green-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-mono text-slate-400">{customer.customer_id || '—'}</p>
          <h3 className="font-semibold text-slate-800">{customer.name}</h3>
          <p className="text-sm text-slate-500">+91 {customer.whatsapp_no}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${badge[status] || badge.due}`}>
          {status === 'unpaid' ? 'Due' : status}
        </span>
      </div>
      <p className="mt-3 text-lg font-bold text-slate-700">
        {formatCurrency(monthTotal)}
        <span className="ml-1 text-sm font-normal text-slate-400">{monthText}</span>
      </p>
      {/* Quantities actually received in the selected month — 0 L means nothing was
          delivered, which reads differently from a customer who simply has no bill yet. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-slate-600">🥛 {milkQty.toFixed(1)} L milk</span>
        {buttermilkQty > 0 && (
          <span className="font-medium text-purple-600">🧉 {buttermilkQty.toFixed(1)} L buttermilk</span>
        )}
      </div>
      {customer.buttermilk_required && buttermilkQty === 0 && (
        <p className="mt-1 text-xs text-purple-400">Subscribed · {customer.buttermilk_quantity}L/day</p>
      )}
    </Link>
  )
}
