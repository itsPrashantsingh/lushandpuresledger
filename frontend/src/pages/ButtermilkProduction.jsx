import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO, currentYearMonth, getMonthBounds, formatDate } from '../lib/utils'
import Toast from '../components/Toast'

export default function ButtermilkProduction() {
  const [date, setDate] = useState(todayISO())
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [existingEntry, setExistingEntry] = useState(null)
  const [month, setMonth] = useState(currentYearMonth())
  const [history, setHistory] = useState([])
  const [monthTotal, setMonthTotal] = useState(0)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState({ message: '', type: 'success' })

  useEffect(() => { loadEntry() }, [date])
  useEffect(() => { loadHistory() }, [month])

  async function loadEntry() {
    const { data } = await supabase
      .from('buttermilk_production')
      .select('*')
      .eq('date', date)
      .maybeSingle()

    if (data) {
      setExistingEntry(data)
      setQuantity(String(Number(data.quantity)))
      setNotes(data.notes || '')
    } else {
      setExistingEntry(null)
      setQuantity('')
      setNotes('')
    }
  }

  async function loadHistory() {
    setLoading(true)
    const { start, end } = getMonthBounds(month)
    const { data } = await supabase
      .from('buttermilk_production')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false })

    const list = data || []
    setHistory(list)
    setMonthTotal(list.reduce((s, r) => s + Number(r.quantity), 0))
    setLoading(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    const qty = Number(quantity)
    if (!qty || qty < 0) {
      setToast({ message: 'Enter a valid quantity', type: 'error' })
      return
    }
    setSaving(true)
    const row = { date, quantity: qty, notes: notes.trim() || null }
    const { error } = await supabase
      .from('buttermilk_production')
      .upsert(row, { onConflict: 'date' })

    if (error) {
      setToast({ message: error.message, type: 'error' })
    } else {
      setToast({ message: `Saved ${qty} L buttermilk for ${formatDate(date)}`, type: 'success' })
      loadEntry()
      loadHistory()
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this entry?')) return
    await supabase.from('buttermilk_production').delete().eq('id', id)
    loadHistory()
    loadEntry()
  }

  return (
    <div className="space-y-6">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Buttermilk Production</h1>
          <p className="text-sm text-slate-500">Track daily buttermilk produced (independent of milk production)</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5"
        />
      </div>

      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
        <p className="text-sm text-purple-600">Month Total</p>
        <p className="text-3xl font-bold text-purple-800">{monthTotal.toFixed(1)} L</p>
      </div>

      {/* Entry form */}
      <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-slate-800">
          {existingEntry ? 'Update Entry' : 'Add Entry'}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Quantity (Litres)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              placeholder="e.g. 20"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Notes</label>
            <input
              placeholder="Optional notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : existingEntry ? 'Update' : 'Save'}
          </button>
          {existingEntry && (
            <span className="flex items-center text-xs text-slate-400">Updating existing entry for {formatDate(date)}</span>
          )}
        </div>
      </form>

      {/* History */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-slate-800">Production History</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-500">No entries this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Quantity (L)</th>
                  <th className="pb-2 pr-4">Notes</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-3 pr-4">{formatDate(r.date)}</td>
                    <td className="py-3 pr-4 font-semibold text-purple-700">{Number(r.quantity).toFixed(1)} L</td>
                    <td className="py-3 pr-4 text-slate-500">{r.notes || '—'}</td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <button onClick={() => setDate(r.date)} className="text-xs text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => handleDelete(r.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200">
                  <td className="py-2 font-semibold">Total</td>
                  <td className="py-2 font-bold text-purple-700">{monthTotal.toFixed(1)} L</td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
