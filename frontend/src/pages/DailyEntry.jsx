import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO, formatCurrency } from '../lib/utils'
import Toast from '../components/Toast'

function QtyControl({ value, onChange, label, color = 'green' }) {
  const btn = color === 'amber' ? 'bg-amber-500' : 'bg-green-600'

  function step(delta) {
    onChange(Math.max(0, Math.round((Number(value || 0) + delta) * 2) / 2))
  }

  return (
    <div>
      <p className="mb-1 text-center text-[10px] font-medium uppercase text-slate-500">{label}</p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => step(-0.5)} className={`h-9 w-9 shrink-0 rounded-lg ${btn} text-base font-bold text-white`}>−</button>
        <input
          type="number"
          step="0.5"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white text-center text-base font-bold"
        />
        <button type="button" onClick={() => step(0.5)} className={`h-9 w-9 shrink-0 rounded-lg ${btn} text-base font-bold text-white`}>+</button>
      </div>
    </div>
  )
}

export default function DailyEntry() {
  const [date, setDate] = useState(todayISO())
  const [customers, setCustomers] = useState([])
  const [entries, setEntries] = useState({})
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState({ message: '', type: 'success' })
  const [production, setProduction] = useState({ morning_litres: '', evening_litres: '', notes: '' })
  const [dirty, setDirty] = useState(false)

  useEffect(() => { loadData() }, [date])

  async function loadData() {
    const [{ data: custs }, { data: existing }, { data: prod }] = await Promise.all([
      supabase.from('customers').select('*').eq('active', true).order('name'),
      supabase.from('daily_entries').select('*').eq('date', date),
      supabase.from('milk_production').select('*').eq('date', date).maybeSingle()
    ])

    setProduction(prod
      ? { morning_litres: Number(prod.morning_litres), evening_litres: Number(prod.evening_litres), notes: prod.notes || '' }
      : { morning_litres: '', evening_litres: '', notes: '' }
    )

    const entryMap = {}
    ;(custs || []).forEach((c) => {
      const ex = (existing || []).find((e) => e.customer_id === c.id)
      entryMap[c.id] = {
        morning_qty: ex ? Number(ex.morning_qty) : Number(c.morning_qty),
        evening_qty: ex ? Number(ex.evening_qty) : Number(c.evening_qty),
        rate: ex ? Number(ex.rate) : Number(c.rate),
        delivered: ex ? (Number(ex.morning_qty) > 0 || Number(ex.evening_qty) > 0) : true,
        saved: !!ex
      }
    })
    setCustomers(custs || [])
    setEntries(entryMap)
    setDirty(false)
  }

  function markDirty() { setDirty(true) }

  function updateEntry(id, field, value) {
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
    markDirty()
  }

  function updateProduction(field, value) {
    setProduction((prev) => ({ ...prev, [field]: value }))
    markDirty()
  }

  function toggleSkip(id) {
    setEntries((prev) => {
      const e = prev[id]
      const delivered = !e.delivered
      return { ...prev, [id]: { ...e, delivered, morning_qty: delivered ? e.morning_qty : 0, evening_qty: delivered ? e.evening_qty : 0 } }
    })
    markDirty()
  }

  async function saveAll() {
    setSaving(true)
    const errors = []

    const { error: prodErr } = await supabase.from('milk_production').upsert({
      date,
      morning_litres: Number(production.morning_litres) || 0,
      evening_litres: Number(production.evening_litres) || 0,
      notes: production.notes || null
    }, { onConflict: 'date' })
    if (prodErr) errors.push('Production: ' + prodErr.message)

    const rows = customers
      .map((c) => {
        const e = entries[c.id]
        if (!e?.delivered) return null
        const morning = Number(e.morning_qty) || 0
        const evening = Number(e.evening_qty) || 0
        if (!morning && !evening) return null
        return {
          customer_id: c.id,
          date,
          morning_qty: morning,
          evening_qty: evening,
          rate: Number(e.rate)
        }
      })
      .filter(Boolean)

    if (rows.length) {
      const { error: delErr } = await supabase.from('daily_entries').upsert(rows, { onConflict: 'customer_id,date' })
      if (delErr) errors.push('Deliveries: ' + delErr.message)
    }

    // Remove zero-qty rows for skipped customers on this date
    const skippedIds = customers
      .filter((c) => {
        const e = entries[c.id]
        return !e?.delivered || (!Number(e.morning_qty) && !Number(e.evening_qty))
      })
      .map((c) => c.id)

    if (skippedIds.length) {
      await supabase.from('daily_entries').delete().eq('date', date).in('customer_id', skippedIds)
    }

    setSaving(false)

    if (errors.length) {
      setToast({ message: errors.join(' · '), type: 'error' })
    } else {
      const delivered = rows.filter((r) => r.morning_qty || r.evening_qty).length
      const prodTotal = (Number(production.morning_litres) || 0) + (Number(production.evening_litres) || 0)
      setToast({ message: `✓ Saved — ${prodTotal.toFixed(1)} L produced, ${delivered} deliveries`, type: 'success' })
      setDirty(false)
      loadData()
    }
  }

  const filtered = customers.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
  const totalDelivered = customers.reduce((s, c) => {
    const e = entries[c.id]
    if (!e?.delivered) return s
    return s + Number(e.morning_qty) + Number(e.evening_qty)
  }, 0)
  const totalAmount = customers.reduce((s, c) => {
    const e = entries[c.id]
    if (!e?.delivered) return s
    return s + (Number(e.morning_qty) + Number(e.evening_qty)) * Number(e.rate)
  }, 0)
  const prodTotal = (Number(production.morning_litres) || 0) + (Number(production.evening_litres) || 0)

  return (
    <div className="pb-36">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">Daily Entry</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" />
      </div>

      {/* Production — compact */}
      <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
        <p className="mb-2 text-xs font-semibold text-blue-800">🐄 Total Milk Produced</p>
        <div className="grid grid-cols-2 gap-2">
          <QtyControl label="Morning (L)" value={production.morning_litres} onChange={(v) => updateProduction('morning_litres', v)} color="green" />
          <QtyControl label="Evening (L)" value={production.evening_litres} onChange={(v) => updateProduction('evening_litres', v)} color="amber" />
        </div>
        <p className="mt-2 text-center text-sm font-bold text-blue-900">{prodTotal.toFixed(1)} L total</p>
      </div>

      <input
        type="search"
        placeholder="Search customer..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3 w-full rounded-lg border px-4 py-2.5"
      />

      <div className="mb-3 rounded-lg bg-green-600 px-3 py-2 text-center text-sm font-medium text-white">
        {totalDelivered.toFixed(1)} L delivered · {formatCurrency(totalAmount)} · {filtered.length} customers
      </div>

      <div className="space-y-2">
        {filtered.map((c) => {
          const e = entries[c.id] || {}
          return (
            <div key={c.id} className={`rounded-xl border bg-white p-3 ${e.delivered ? 'border-slate-200' : 'border-red-200 bg-red-50'}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800">{c.name}</p>
                  {e.saved && !dirty && <span className="text-[10px] text-green-600">saved ✓</span>}
                </div>
                <button
                  onClick={() => toggleSkip(c.id)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${e.delivered ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                >
                  {e.delivered ? 'Active' : 'Skip'}
                </button>
              </div>
              {e.delivered && (
                <div className="grid grid-cols-2 gap-2">
                  <QtyControl label="☀️ Morning" value={e.morning_qty} onChange={(v) => updateEntry(c.id, 'morning_qty', v)} />
                  <QtyControl label="🌙 Evening" value={e.evening_qty} onChange={(v) => updateEntry(c.id, 'evening_qty', v)} color="amber" />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Sticky save — always visible, no scrolling */}
      <div className="fixed bottom-16 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] backdrop-blur md:bottom-0 md:left-56">
        <button
          onClick={saveAll}
          disabled={saving}
          className={`w-full rounded-xl py-3.5 text-base font-bold text-white shadow-lg disabled:opacity-50 ${
            dirty ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-600 hover:bg-slate-700'
          }`}
        >
          {saving ? 'Saving...' : dirty ? '💾 Save All' : '💾 Save All (up to date)'}
        </button>
      </div>
    </div>
  )
}
