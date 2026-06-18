export default function StatCard({ title, value, subtitle, color = 'green' }) {
  const colors = {
    green: 'border-green-500 bg-green-50',
    amber: 'border-amber-500 bg-amber-50',
    red: 'border-red-500 bg-red-50',
    slate: 'border-slate-400 bg-white'
  }

  return (
    <div className={`rounded-xl border-l-4 p-4 shadow-sm ${colors[color] || colors.slate}`}>
      <p className="text-sm text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
    </div>
  )
}
