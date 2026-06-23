import { Link } from 'react-router-dom'

const categoryStyle = {
  cow: 'bg-amber-100 text-amber-800',
  buffalo: 'bg-slate-200 text-slate-700'
}

export default function CattleCard({ cattle, monthLitres }) {
  return (
    <Link
      to={`/cattle/${cattle.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-mono text-slate-400">{cattle.cattle_id || '—'}</p>
          <h3 className="font-semibold text-slate-800">{cattle.name}</h3>
          <p className="text-sm text-slate-500">{cattle.breed || '—'}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${categoryStyle[cattle.category] || ''}`}>
          {cattle.category}
        </span>
      </div>
      <p className="mt-3 text-lg font-bold text-slate-700">
        {monthLitres.toFixed(1)} L
        <span className="ml-1 text-sm font-normal text-slate-400">this month</span>
      </p>
      {!cattle.active && <p className="mt-1 text-xs text-red-500">Inactive</p>}
    </Link>
  )
}
