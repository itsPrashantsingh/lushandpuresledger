import { Link } from 'react-router-dom'
import { formatCurrency } from '../lib/utils'

export default function CustomerCard({ customer, monthTotal, status }) {
  const badge = {
    paid: 'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    due: 'bg-red-100 text-red-700',
    unpaid: 'bg-red-100 text-red-700'
  }

  return (
    <Link
      to={`/customers/${customer.id}`}
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
        <span className="ml-1 text-sm font-normal text-slate-400">this month</span>
      </p>
      {customer.buttermilk_required && (
        <p className="mt-1 text-xs text-purple-600">+ Buttermilk {customer.buttermilk_quantity}L/day</p>
      )}
    </Link>
  )
}
