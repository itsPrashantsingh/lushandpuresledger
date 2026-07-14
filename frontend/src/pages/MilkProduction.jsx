import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO, formatQty } from '../lib/utils'
import { useAuth } from '../lib/auth'
import Toast from '../components/Toast'
import QtyControl from '../components/QtyControl'

export default function MilkProduction() {
  const { user } = useAuth()
  const [date, setDate] = useState(todayISO())
  const [cattle, setCattle] = useState([])
  const [entries, setEntries] = useState({})
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedInfo, setSavedInfo] = useState(null)
  const [toast, setToast] = useState({ message: '', type: 'success' })

  useEffect(() => { loadData() }, [date])

  async function loadData() {
    const [{ data: list }, { data: existing }] = await Promise.all([
      supabase.from('cattle').select('*').eq('active', true).order('name'),
      supabase.from('cattle_milk_entries').select('*').eq('date', date)
    ])

    const entryMap = {}
    ;(list || []).forEach((c) => {
      const ex = (existing || []).find((e) => e.cattle_id === c.id)
      entryMap[c.id] = {
        morning_litres: ex ? Number(ex.morning_litres) : 0,
        evening_litres: ex ? Number(ex.evening_litres) : 0,
        active: ex ? (Number(ex.morning_litres) > 0 || Number(ex.evening_litres) > 0) : true,
        saved: !!ex
      }
    })

    const stamped = (existing || []).filter((e) => e.updated_at)
    if (stamped.length) {
      const latest = stamped.reduce((a, b) => (new Date(a.updated_at) > new Date(b.updated_at) ? a : b))
      setSavedInfo({ at: latest.updated_at, by: latest.updated_by_email })
    } else {
      setSavedInfo(null)
    }

    setCattle(list || [])
    setEntries(entryMap)
    setDirty(false)
  }

  function updateEntry(id, field, value) {
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
    setDirty(true)
  }

  function toggleSkip(id) {
    setEntries((prev) => {
      const e = prev[id]
      const active = !e.active
      return {
        ...prev,
        [id]: {
          ...e,
          active,
          morning_litres: active ? e.morning_litres : 0,
          evening_litres: active ? e.evening_litres : 0
        }
      }
    })
    setDirty(true)
  }

  async function saveAll() {
    setSaving(true)
    const errors = []

    const rows = cattle
      .map((c) => {
        const e = entries[c.id]
        if (!e?.active) return null
        const morning = Number(e.morning_litres) || 0
        const evening = Number(e.evening_litres) || 0
        if (!morning && !evening) return null
        return {
          cattle_id: c.id,
          date,
          morning_litres: morning,
          evening_litres: evening,
          updated_by_email: user?.email || null,
          updated_at: new Date().toISOString()
        }
      })
      .filter(Boolean)

    if (rows.length) {
      const { error } = await supabase.from('cattle_milk_entries').upsert(rows, { onConflict: 'cattle_id,date' })
      if (error) errors.push(error.message)
    }

    const skippedIds = cattle
      .filter((c) => {
        const e = entries[c.id]
        return !e?.active || (!Number(e.morning_litres) && !Number(e.evening_litres))
      })
      .map((c) => c.id)

    if (skippedIds.length) {
      await supabase.from('cattle_milk_entries').delete().eq('date', date).in('cattle_id', skippedIds)
    }

    setSaving(false)

    if (errors.length) {
      setToast({ message: errors.join(' · '), type: 'error' })
    } else {
      const total = summary.total
      setToast({ message: `✓ Saved ${total.toFixed(1)} L from ${rows.length} cattle`, type: 'success' })
      setDirty(false)
      loadData()
    }
  }

  const filtered = cattle.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.breed || '').toLowerCase().includes(search.toLowerCase())
  )

  const summary = filtered.reduce(
    (acc, c) => {
      const e = entries[c.id]
      if (!e?.active) return acc
      const m = Number(e.morning_litres) || 0
      const ev = Number(e.evening_litres) || 0
      const t = m + ev
      if (!t) return acc

      acc.rows.push({
        id: c.id,
        name: c.name,
        breed: c.breed,
        category: c.category,
        morning: m,
        evening: ev,
        total: t
      })
      acc.morning += m
      acc.evening += ev
      acc.total += t
      if (c.category === 'cow') acc.cow += t
      if (c.category === 'buffalo') acc.buffalo += t
      return acc
    },
    { rows: [], morning: 0, evening: 0, total: 0, cow: 0, buffalo: 0 }
  )

  return (
    <div className="pb-80">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Milk Production</h1>
          <p className="text-xs text-slate-500">Morning & evening litres per cattle</p>
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" />
      </div>

      {cattle.length === 0 ? (
        <p className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-8 text-center text-blue-800">
          No cattle yet. Add cattle in the <strong>Cattle</strong> tab first.
        </p>
      ) : (
        <>
          <input
            type="search"
            placeholder="Search cattle..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-3 w-full rounded-lg border px-4 py-2.5"
          />

          <div className="mb-3 rounded-lg bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white">
            {summary.total.toFixed(1)} L total · ☀️ {summary.morning.toFixed(1)} · 🌙 {summary.evening.toFixed(1)}
          </div>

          {savedInfo && (
            <p className="mb-3 text-center text-xs text-slate-400">
              Last saved {new Date(savedInfo.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              {savedInfo.by ? ` by ${savedInfo.by}` : ''}
            </p>
          )}

          <div className="space-y-2">
            {filtered.map((c) => {
              const e = entries[c.id] || {}
              return (
                <div key={c.id} className={`rounded-xl border bg-white p-3 ${e.active ? 'border-slate-200' : 'border-red-200 bg-red-50'}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-800">{c.name}</p>
                      <p className="text-xs capitalize text-slate-500">{c.category}{c.breed ? ` · ${c.breed}` : ''}</p>
                      {e.saved && !dirty && <span className="text-[10px] text-green-600">saved ✓</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSkip(c.id)}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${e.active ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-600'}`}
                    >
                      {e.active ? 'Active' : 'Skip'}
                    </button>
                  </div>
                  {e.active && (
                    <div className="grid grid-cols-2 gap-2">
                      <QtyControl label="☀️ Morning" value={e.morning_litres} onChange={(v) => updateEntry(c.id, 'morning_litres', v)} />
                      <QtyControl label="🌙 Evening" value={e.evening_litres} onChange={(v) => updateEntry(c.id, 'evening_litres', v)} color="amber" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {summary.rows.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-slate-800">Today&apos;s summary</h2>
          <div className="mb-3 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">Total: <strong>{summary.total.toFixed(1)} L</strong></span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">Cows: <strong>{summary.cow.toFixed(1)} L</strong></span>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">Buffaloes: <strong>{summary.buffalo.toFixed(1)} L</strong></span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Breed</th>
                  <th className="pb-2">☀️</th>
                  <th className="pb-2">🌙</th>
                  <th className="pb-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td className="py-1.5 text-slate-500">{r.breed || '—'}</td>
                    <td className="py-1.5">{formatQty(r.morning)}</td>
                    <td className="py-1.5">{formatQty(r.evening)}</td>
                    <td className="py-1.5 font-semibold">{formatQty(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="fixed bottom-16 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] backdrop-blur md:bottom-0 md:left-56">
        <button
          onClick={saveAll}
          disabled={saving || cattle.length === 0}
          className={`w-full rounded-xl py-3.5 text-base font-bold text-white shadow-lg disabled:opacity-50 ${
            dirty ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-600 hover:bg-slate-700'
          }`}
        >
          {saving ? 'Saving...' : dirty ? '💾 Save Production' : '💾 Saved'}
        </button>
      </div>
    </div>
  )
}
