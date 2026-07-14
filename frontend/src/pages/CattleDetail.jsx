import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, formatQty, currentYearMonth, getMonthBounds } from '../lib/utils'

export default function CattleDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [cattle, setCattle] = useState(null)
  const [month, setMonth] = useState(currentYearMonth())
  const [entries, setEntries] = useState([])
  const [summary, setSummary] = useState({ morning: 0, evening: 0, total: 0, days: 0 })
  const [loading, setLoading] = useState(true)
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState(null)

  useEffect(() => {
    if (id) loadAll()
  }, [id, month])

  async function loadAll() {
    setLoading(true)
    const { data: item, error } = await supabase.from('cattle').select('*').eq('id', id).single()

    if (error || !item) {
      setCattle(null)
      setLoading(false)
      return
    }

    setCattle(item)
    setEditForm({
      name: item.name,
      breed: item.breed || '',
      category: item.category,
      active: item.active
    })

    const { start, end } = getMonthBounds(month)
    const { data: ents } = await supabase
      .from('cattle_milk_entries')
      .select('*')
      .eq('cattle_id', id)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false })

    const list = ents || []
    const morning = list.reduce((s, e) => s + Number(e.morning_litres), 0)
    const evening = list.reduce((s, e) => s + Number(e.evening_litres), 0)

    setEntries(list)
    setSummary({
      morning,
      evening,
      total: morning + evening,
      days: list.filter((e) => Number(e.total_litres) > 0).length
    })
    setLoading(false)
  }

  async function handleSaveEdit(e) {
    e.preventDefault()
    const { error } = await supabase.from('cattle').update({
      ...editForm,
      breed: editForm.breed || null
    }).eq('id', id)

    if (error) { alert(error.message); return }
    setShowEdit(false)
    loadAll()
  }

  async function handleDelete() {
    if (!cattle) return
    if (!window.confirm(`Delete "${cattle.name}" and all its milk records?`)) return

    const { error } = await supabase.from('cattle').delete().eq('id', id)
    if (error) { alert(error.message); return }
    navigate('/cattle')
  }

  if (loading) return <p className="text-center text-slate-500">Loading...</p>
  if (!cattle) return <p className="text-center text-slate-500">Cattle not found. <Link to="/cattle" className="text-blue-600">Go back</Link></p>

  const avgPerDay = summary.days > 0 ? summary.total / summary.days : 0

  return (
    <div className="space-y-6">
      <Link to="/cattle" className="text-sm text-blue-600 hover:underline">← Back to Cattle</Link>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-mono text-slate-400">{cattle.cattle_id || '—'}</p>
            <h1 className="text-2xl font-bold text-slate-800">{cattle.name}</h1>
            <p className="capitalize text-slate-500">{cattle.category}{cattle.breed ? ` · ${cattle.breed}` : ''}</p>
            {!cattle.active && <p className="mt-1 text-sm text-red-500">Inactive</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowEdit(true)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Edit</button>
            <button onClick={handleDelete} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">Delete</button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-500">Month</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Month total</p>
          <p className="text-xl font-bold text-blue-700">{summary.total.toFixed(1)} L</p>
        </div>
        <div className="rounded-xl border bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Morning</p>
          <p className="text-xl font-bold">{summary.morning.toFixed(1)} L</p>
        </div>
        <div className="rounded-xl border bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Evening</p>
          <p className="text-xl font-bold">{summary.evening.toFixed(1)} L</p>
        </div>
        <div className="rounded-xl border bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Avg / day</p>
          <p className="text-xl font-bold">{avgPerDay.toFixed(1)} L</p>
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-semibold text-slate-700">Daily records</h2>
        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">No entries this month</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Morning</th>
                  <th className="px-4 py-2">Evening</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2">Saved by</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{formatDate(e.date)}</td>
                    <td className="px-4 py-2">{formatQty(e.morning_litres)} L</td>
                    <td className="px-4 py-2">{formatQty(e.evening_litres)} L</td>
                    <td className="px-4 py-2 font-medium">{formatQty(e.total_litres)} L</td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {e.updated_by_email || '—'}
                      {e.updated_at && <span className="block">{new Date(e.updated_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleSaveEdit} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">Edit Cattle</h2>
            <div className="space-y-3">
              <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full rounded-lg border px-3 py-2" placeholder="Name" />
              <input value={editForm.breed} onChange={(e) => setEditForm({ ...editForm, breed: e.target.value })} className="w-full rounded-lg border px-3 py-2" placeholder="Breed" />
              <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-full rounded-lg border px-3 py-2">
                <option value="cow">Cow</option>
                <option value="buffalo">Buffalo</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="mt-6 flex gap-2">
              <button type="submit" className="flex-1 rounded-lg bg-blue-600 py-2 text-white">Save</button>
              <button type="button" onClick={() => setShowEdit(false)} className="flex-1 rounded-lg border py-2">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
