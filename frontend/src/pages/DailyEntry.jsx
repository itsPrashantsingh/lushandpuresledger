import { useCallback, useEffect, useState } from 'react'
import { todayISO, maxDailyEntryDateISO, formatCurrency } from '../lib/utils'
import Toast from '../components/Toast'
import QtyControl from '../components/QtyControl'
import { apiGet, apiPost } from '../lib/api'
import { supabase } from '../lib/supabase'

export default function DailyEntry() {
  const [date, setDate] = useState(todayISO())
  const [customers, setCustomers] = useState([])
  const [entries, setEntries] = useState({})
  const [buttermilkEntries, setButtermilkEntries] = useState({})
  const [session, setSession] = useState({ status: 'locked' })
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState({ message: '', type: 'success' })
  const [dirty, setDirty] = useState(false)

  const applyServerState = useCallback((data) => {
    const entryMap = {}
    ;(data.entries || []).forEach((entry) => {
      entryMap[entry.customer_id] = {
        morning_qty: Number(entry.morning_qty),
        evening_qty: Number(entry.evening_qty),
        rate: Number(entry.rate),
        delivered: entry.delivered !== false,
        saved: !!entry.saved,
        custom: !!entry.custom
      }
    })
    setCustomers(data.customers || [])
    setEntries(entryMap)
    setSession(data.session || { status: 'locked' })
    setDirty(false)
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await apiGet(`/api/daily-entry?date=${date}`)
      applyServerState(data)

      const subscribedIds = (data.customers || []).filter((c) => c.buttermilk_required && c.active !== false).map((c) => c.id)
      if (subscribedIds.length) {
        const { data: bmData } = await supabase
          .from('buttermilk_entries')
          .select('customer_id, quantity, rate')
          .eq('date', date)
          .in('customer_id', subscribedIds)
        const customersById = {}
        for (const c of data.customers || []) customersById[c.id] = c
        const bmMap = {}
        for (const cid of subscribedIds) {
          const existing = (bmData || []).find((b) => b.customer_id === cid)
          const c = customersById[cid]
          bmMap[cid] = {
            quantity: existing ? Number(existing.quantity) : Number(c?.buttermilk_quantity || 0),
            rate: existing ? Number(existing.rate) : Number(c?.buttermilk_rate || 0)
          }
        }
        setButtermilkEntries(bmMap)
      } else {
        setButtermilkEntries({})
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message || 'Could not load deliveries', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [applyServerState, date])

  useEffect(() => {
    const timer = setTimeout(() => { loadData() }, 0)
    return () => clearTimeout(timer)
  }, [loadData])

  function markDirty() { setDirty(true) }

  function updateEntry(id, field, value) {
    if (isLocked) return
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
    markDirty()
  }

  function updateButtermilk(id, value) {
    if (isLocked) return
    setButtermilkEntries((prev) => ({ ...prev, [id]: { ...prev[id], quantity: value } }))
    markDirty()
  }

  function toggleSkip(id) {
    if (isLocked) return
    setEntries((prev) => {
      const e = prev[id]
      const delivered = !e.delivered
      return { ...prev, [id]: { ...e, delivered, morning_qty: delivered ? e.morning_qty : 0, evening_qty: delivered ? e.evening_qty : 0 } }
    })
    markDirty()
  }

  function buildPayload() {
    return customers.map((c) => {
      const e = entries[c.id] || {}
      return {
        customer_id: c.id,
        morning_qty: Number(e.morning_qty) || 0,
        evening_qty: Number(e.evening_qty) || 0,
        rate: Number(e.rate ?? c.rate) || 0,
        delivered: e.delivered !== false
      }
    })
  }

  async function saveButtermilkEntries() {
    const rows = []
    for (const c of customers) {
      if (!c.buttermilk_required) continue
      const bm = buttermilkEntries[c.id]
      if (!bm) continue
      const qty = Number(bm.quantity) || 0
      if (qty > 0) {
        rows.push({ customer_id: c.id, date, quantity: qty, rate: Number(bm.rate) || Number(c.buttermilk_rate) || 0 })
      }
    }
    if (rows.length) {
      await supabase.from('buttermilk_entries').upsert(rows, { onConflict: 'customer_id,date' })
    }
  }

  async function setCustomerActive(customerId, active) {
    const { error } = await supabase.from('customers').update({ active }).eq('id', customerId)
    if (error) {
      setToast({ message: error.message, type: 'error' })
      return
    }

    if (!active) {
      // Pausing: patch the customer + zero today's entry LOCALLY instead of
      // reloading from the server. If today's date was already unlocked (draft
      // has real quantities), a reload would show those stale values again —
      // this makes the pause take effect on the currently-viewed day immediately,
      // so the very next Lock/Save Final correctly excludes it from billing.
      setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, active: false } : c)))
      setEntries((prev) => ({ ...prev, [customerId]: { ...prev[customerId], delivered: false, morning_qty: 0, evening_qty: 0 } }))
      markDirty()
      setToast({ message: 'Customer paused — today\'s entry cleared, auto-skipped daily. Click Lock/Save Final to persist.', type: 'success' })
    } else {
      // Reactivating: safe to reload — no unsaved edits to protect, and this
      // gets the customer's normal default qty back for the current date.
      setToast({ message: 'Customer activated', type: 'success' })
      loadData()
    }
  }

  async function unlockEntries() {
    setSaving(true)
    try {
      const { data } = await apiPost('/api/daily-entry/unlock', { date })
      applyServerState(data)
      setToast({ message: 'Entries unlocked for editing', type: 'success' })
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message || 'Could not unlock entries', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function lockEntries() {
    setSaving(true)
    try {
      const payload = buildPayload()
      const { data } = await apiPost('/api/daily-entry/lock', { date, entries: payload })
      applyServerState(data)
      setToast({ message: 'Entries locked and logged', type: 'success' })
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message || 'Could not lock entries', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function finalizeEntries() {
    setSaving(true)
    try {
      const payload = buildPayload()
      await saveButtermilkEntries()
      const { data } = await apiPost('/api/daily-entry/finalize', { date, entries: payload })
      applyServerState(data)
      const delivered = payload.filter((entry) => entry.delivered && (entry.morning_qty || entry.evening_qty)).length
      setToast({ message: `Final delivery saved for ${delivered} customers`, type: 'success' })
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message || 'Could not save final delivery', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || (c.whatsapp_no || '').includes(q)
  })
  // A customer with a saved entry for this date belongs in the main list even if paused today —
  // otherwise a past day's deliveries would sit in the "auto-skipped, not billed" section while
  // still counting toward the day's total. Keeps the list consistent with the stats below.
  const countsForDay = (c) => entries[c.id]?.saved || c.active !== false
  const activeList = filtered.filter(countsForDay)                 // search-filtered, for rendering
  const inactiveList = filtered.filter((c) => !countsForDay(c))
  const isLocked = session.status !== 'unlocked'
  const isFinalized = session.status === 'finalized'
  const statusText = isFinalized ? 'Final saved' : isLocked ? 'Locked' : 'Unlocked'
  const statusClass = isFinalized ? 'bg-blue-100 text-blue-700' : isLocked ? 'bg-slate-800 text-white' : 'bg-amber-100 text-amber-800'

  // Summary stats are INDEPENDENT of the search box, so totals reflect the whole day.
  // A row counts if it has a SAVED final entry for this date (`e.saved`) — a historical fact
  // that must never change — or if the customer is currently active (needed while a day is
  // still being planned and nothing is saved yet). Filtering purely on today's `active` flag
  // would let pausing a customer now retroactively shrink an already-finalized past day:
  // e.g. 2026-07-27 read 39.5 L on this page vs 41.5 L in the DB/heatmap, because Brijdas,
  // Nandlal and Pragya delivered 2.0 L that day and were deactivated afterwards.
  const statRows = customers
    .filter((c) => entries[c.id]?.saved || c.active !== false)
    .map((c) => ({ c, e: entries[c.id] || {} }))
  const isRowDelivered = (e) => e.delivered && (Number(e.morning_qty) + Number(e.evening_qty)) > 0
  const deliveredRows = statRows.filter(({ e }) => isRowDelivered(e))
  const totalDelivered = deliveredRows.reduce((s, { e }) => s + Number(e.morning_qty) + Number(e.evening_qty), 0)
  const totalAmount = deliveredRows.reduce((s, { e }) => s + (Number(e.morning_qty) + Number(e.evening_qty)) * Number(e.rate), 0)
  const deliveredCount = deliveredRows.length
  const skippedCount = statRows.length - deliveredCount
  // "custom" = a delivered customer whose qty/rate differs from their saved default (skips/pauses excluded)
  const customCount = statRows.filter(({ c, e }) => isRowDelivered(e) && (
    Number(e.morning_qty) !== Number(c.morning_qty) ||
    Number(e.evening_qty) !== Number(c.evening_qty) ||
    Number(e.rate) !== Number(c.rate)
  )).length
  const activeCount = statRows.length
  // Paused = inactive AND no saved entry for this date. Someone who delivered on this date and
  // was deactivated later was not paused *that day*, so they belong in the delivered count above.
  const pausedCount = customers.filter((c) => c.active === false && !entries[c.id]?.saved).length
  const buttermilkSubscribers = statRows.filter(({ c }) => c.buttermilk_required).length

  return (
    <div className="pb-36">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Customer Deliveries</h1>
          <p className="text-xs text-slate-500">Locked plan, custom changes, and final delivery</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>{statusText}</span>
          {/* max allows up to 7 days ahead — customers with known upcoming quantities get
              entered and locked early — but still blocks further-out future dates, which is
              how 92L of impossible cattle-production data got entered by mistake. */}
          <input type="date" value={date} max={maxDailyEntryDateISO()} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" />
        </div>
      </div>

      {isFinalized && session.finalized_at && (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          🔒 Final saved on {new Date(session.finalized_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          {session.finalized_by_email ? ` by ${session.finalized_by_email}` : ''} — locked. Tap <strong>Unlock</strong> to edit.
        </div>
      )}
      {session.status === 'locked' && session.locked_at && !isFinalized && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Locked on {new Date(session.locked_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          {session.locked_by_email ? ` by ${session.locked_by_email}` : ''}
        </div>
      )}

      <input
        type="search"
        placeholder="Search customer or phone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3 w-full rounded-lg border px-4 py-2.5"
      />

      <div className="mb-3 rounded-lg bg-green-600 px-3 py-2 text-center text-sm font-medium text-white">
        {totalDelivered.toFixed(1)} L {isFinalized ? 'delivered' : 'planned'} · {formatCurrency(totalAmount)}
        <span className="block text-xs font-normal text-green-50">
          {deliveredCount} delivering · {skippedCount} skipped · {customCount} custom · {activeCount} active
          {buttermilkSubscribers > 0 && ` · ${buttermilkSubscribers} buttermilk`}
          {pausedCount > 0 && ` · ${pausedCount} paused`}
        </span>
      </div>

      {loading && <p className="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500">Loading deliveries...</p>}

      <div className="space-y-2">
        {!loading && activeList.map((c) => {
          const e = entries[c.id] || {}
          const rowCustom = e.delivered === false ||
            Number(e.morning_qty) !== Number(c.morning_qty) ||
            Number(e.evening_qty) !== Number(c.evening_qty) ||
            Number(e.rate) !== Number(c.rate)
          return (
            <div key={c.id} className={`rounded-xl border bg-white p-3 ${e.delivered ? 'border-slate-200' : 'border-red-200 bg-red-50'}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800">{c.name}</p>
                  {c.customer_id && <p className="text-xs font-mono text-slate-400">{c.customer_id}</p>}
                  <div className="flex gap-2 text-[10px]">
                    {e.saved && <span className="text-green-600">final saved</span>}
                    {c.active === false && <span className="text-slate-400">paused now</span>}
                    {rowCustom && <span className="text-amber-600">custom</span>}
                    {c.buttermilk_required && <span className="text-purple-600">+buttermilk</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => toggleSkip(c.id)}
                    disabled={isLocked}
                    title="Skip for today only"
                    className={`rounded-full px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${e.delivered ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
                  >
                    {e.delivered ? 'Active' : 'Skip'}
                  </button>
                  <button
                    onClick={() => setCustomerActive(c.id, c.active === false)}
                    title={c.active === false
                      ? 'Currently paused — reactivate this customer'
                      : 'Pause this customer — auto-skipped every day until reactivated'}
                    className="rounded-full px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    {c.active === false ? 'Activate' : 'Pause'}
                  </button>
                </div>
              </div>
              {e.delivered && (
                <div className="grid grid-cols-2 gap-2">
                  <QtyControl label="Morning" value={e.morning_qty} disabled={isLocked} onChange={(v) => updateEntry(c.id, 'morning_qty', v)} />
                  <QtyControl label="Evening" value={e.evening_qty} disabled={isLocked} onChange={(v) => updateEntry(c.id, 'evening_qty', v)} color="amber" />
                </div>
              )}
              {c.buttermilk_required && buttermilkEntries[c.id] && (
                <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50 p-2">
                  <QtyControl
                    label={`Buttermilk (L) @ ₹${buttermilkEntries[c.id].rate}/L`}
                    value={buttermilkEntries[c.id].quantity}
                    disabled={isLocked}
                    onChange={(v) => updateButtermilk(c.id, v)}
                    color="amber"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!loading && inactiveList.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Paused ({inactiveList.length}) — auto-skipped, not billed
          </p>
          <div className="space-y-1.5">
            {inactiveList.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 opacity-75">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-500">{c.name}</p>
                  {c.customer_id && <p className="text-xs font-mono text-slate-400">{c.customer_id}</p>}
                </div>
                <button
                  onClick={() => setCustomerActive(c.id, true)}
                  className="shrink-0 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-200"
                >
                  Activate
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="fixed bottom-16 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] backdrop-blur md:bottom-0 md:left-56">
        <div className="mx-auto flex max-w-6xl gap-2">
          {isLocked ? (
            <button
              type="button"
              onClick={unlockEntries}
              disabled={saving || loading}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-3 text-sm font-bold text-slate-700 shadow-sm disabled:opacity-50"
            >
              {saving ? 'Working...' : 'Unlock'}
            </button>
          ) : (
            <button
              type="button"
              onClick={lockEntries}
              disabled={saving || loading}
              className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-50"
            >
              {saving ? 'Working...' : dirty ? 'Lock Changes' : 'Lock'}
            </button>
          )}
          <button
            type="button"
            onClick={finalizeEntries}
            disabled={saving || loading}
            className="flex-1 rounded-xl bg-green-600 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-50"
          >
            {saving ? 'Saving...' : isFinalized ? 'Final Saved' : 'Save Final'}
          </button>
        </div>
      </div>
    </div>
  )
}
