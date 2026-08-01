import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import CustomerCard from '../components/CustomerCard'
import { currentYearMonth, monthLabel, shiftMonth, formatCurrency } from '../lib/utils'
import { loadCustomerMonthStats } from '../lib/bills'
import { parseSpreadsheet, rowsToCustomers, downloadImportTemplate } from '../lib/import-export'

export default function Customers() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [customFields, setCustomFields] = useState([{ key: '', value: '' }])
  const [customerStats, setCustomerStats] = useState({})
  // Restored from ?month=YYYY-MM when returning from a customer profile, so the list comes
  // back to the month you were reviewing instead of jumping to the current one.
  const [month, setMonthState] = useState(() => {
    const fromUrl = searchParams.get('month')
    return /^\d{4}-\d{2}$/.test(fromUrl || '') ? fromUrl : currentYearMonth()
  })
  const [statsMonth, setStatsMonth] = useState(null)
  const [loading, setLoading] = useState(true)

  function setMonth(next) {
    setMonthState(next)
    const params = new URLSearchParams(searchParams)
    params.set('month', next)
    setSearchParams(params, { replace: true })
  }

  const [importMsg, setImportMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const fileRef = useRef(null)

  function emptyForm() {
    return { name: '', whatsapp_no: '', address: '', rate: 83, morning_qty: 0, evening_qty: 0, active: true, buttermilk_required: false, buttermilk_quantity: 0, buttermilk_rate: 0 }
  }

  useEffect(() => {
    loadCustomers()
  }, [])

  // Month stats are loaded separately from the customer list so switching months only
  // refetches the per-month figures, and the cards stay on screen while they update.
  useEffect(() => {
    if (!customers.length) return
    let cancelled = false
    loadCustomerMonthStats(customers, month)
      .then((stats) => { if (!cancelled) { setCustomerStats(stats); setStatsMonth(month) } })
      .catch(() => { if (!cancelled) { setCustomerStats({}); setStatsMonth(month) } })
    return () => { cancelled = true }
  }, [customers, month])

  async function loadCustomers() {
    setLoading(true)
    const { data } = await supabase.from('customers').select('*').order('name')
    setCustomers(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm(emptyForm())
    setCustomFields([{ key: '', value: '' }])
    setShowModal(true)
  }

  async function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportMsg('')

    try {
      const rows = await parseSpreadsheet(file)
      const imported = rowsToCustomers(rows)

      if (!imported.length) {
        setImportMsg('No valid rows found. Need name + 10-digit WhatsApp number.')
        setImporting(false)
        return
      }

      // Duplicate numbers have slipped in via import before (same person entered twice
      // with a placeholder number) — reject the whole batch rather than half-import it,
      // so it's obvious something needs fixing in the sheet before retrying.
      const existingByPhone = new Map(customers.map((c) => [c.whatsapp_no, c]))
      const seenInFile = new Map()
      const problems = []
      for (const c of imported) {
        const existing = existingByPhone.get(c.whatsapp_no)
        if (existing) problems.push(`${c.name} — number already used by ${existing.name} (${existing.customer_id || existing.id})`)
        const dupeInFile = seenInFile.get(c.whatsapp_no)
        if (dupeInFile) problems.push(`${c.name} — same number as ${dupeInFile} elsewhere in this file`)
        seenInFile.set(c.whatsapp_no, c.name)
      }
      if (problems.length) {
        setImportMsg(`Import stopped — duplicate WhatsApp numbers found:\n${problems.join('\n')}`)
        setImporting(false)
        if (fileRef.current) fileRef.current.value = ''
        return
      }

      const { error } = await supabase.from('customers').insert(imported)
      if (error) throw error

      setImportMsg(`Imported ${imported.length} customers ✓`)
      loadCustomers()
    } catch (err) {
      setImportMsg('Import failed: ' + err.message)
    }

    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function openEdit(customer) {
    setEditing(customer)
    setForm({
      name: customer.name,
      whatsapp_no: customer.whatsapp_no,
      address: customer.address || '',
      rate: customer.rate,
      morning_qty: customer.morning_qty,
      evening_qty: customer.evening_qty,
      active: customer.active,
      buttermilk_required: customer.buttermilk_required || false,
      buttermilk_quantity: customer.buttermilk_quantity || 0,
      buttermilk_rate: customer.buttermilk_rate || 0
    })
    const cf = customer.custom_fields || {}
    const pairs = Object.entries(cf).map(([key, value]) => ({ key, value }))
    setCustomFields(pairs.length ? pairs : [{ key: '', value: '' }])
    setShowModal(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    const digits = form.whatsapp_no.replace(/\D/g, '')
    if (digits.length !== 10) {
      setPhoneError('WhatsApp number must be exactly 10 digits')
      return
    }
    // Two customers sharing a number is how a duplicate record slipped in undetected before
    // (same person entered twice, 119s apart) — block it at save time instead.
    const dupe = customers.find((c) => c.whatsapp_no === digits && c.id !== editing?.id)
    if (dupe) {
      setPhoneError(`This number is already used by "${dupe.name}" (${dupe.customer_id || dupe.id})`)
      return
    }
    setPhoneError('')

    const custom_fields = {}
    customFields.forEach(({ key, value }) => {
      if (key.trim()) custom_fields[key.trim()] = value
    })

    const payload = { ...form, whatsapp_no: digits, custom_fields }

    if (editing) {
      const { error } = await supabase.from('customers').update(payload).eq('id', editing.id)
      if (error) { alert(error.message); return }
    } else {
      const { error } = await supabase.from('customers').insert(payload)
      if (error) { alert(error.message); return }
    }

    setShowModal(false)
    loadCustomers()
  }

  async function handleDelete() {
    if (!editing) return
    if (!window.confirm(`Delete "${editing.name}"? All bills, deliveries and payments for this customer will also be removed.`)) return

    const { error } = await supabase.from('customers').delete().eq('id', editing.id)
    if (error) { alert(error.message); return }

    setShowModal(false)
    loadCustomers()
  }

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.whatsapp_no.includes(search)
  )

  // Derived rather than stored, so the flag can never disagree with the loaded stats.
  const statsLoading = statsMonth !== month

  // Roll-up across the customers currently listed, so it agrees with the cards on screen.
  const monthRollup = filtered.reduce(
    (acc, c) => {
      const s = customerStats[c.id]
      if (!s) return acc
      acc.amount += s.monthTotal || 0
      acc.milk += s.milkQty || 0
      acc.buttermilk += s.buttermilkQty || 0
      if ((s.milkQty || 0) > 0 || (s.buttermilkQty || 0) > 0) acc.receiving += 1
      return acc
    },
    { amount: 0, milk: 0, buttermilk: 0, receiving: 0 }
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Customers</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => downloadImportTemplate()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Download Template
          </button>
          <label className="cursor-pointer rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">
            {importing ? 'Importing...' : 'Import CSV/XLSX'}
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} className="hidden" disabled={importing} />
          </label>
          <button
            onClick={openAdd}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            + Add Customer
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <strong>Import columns:</strong> name, whatsapp_no, address, rate, morning_qty, evening_qty.
        Any other column (e.g. flat_no, notes) is saved as a custom field.
      </div>

      {importMsg && (
        <p className={`whitespace-pre-line text-sm ${importMsg.includes('failed') || importMsg.includes('No valid') || importMsg.includes('stopped') ? 'text-red-600' : 'text-green-600'}`}>
          {importMsg}
        </p>
      )}

      <input
        type="search"
        placeholder="Search by name or phone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-4 py-2"
      />

      {/* Month shifter — card figures below are all scoped to this month */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-1 text-sm font-medium">
          <button
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="Previous month"
          >
            ◀
          </button>
          <span className="min-w-[92px] text-center text-slate-800">{monthLabel(month)}</span>
          <button
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={month >= currentYearMonth()}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            aria-label="Next month"
          >
            ▶
          </button>
          {month !== currentYearMonth() && (
            <button
              onClick={() => setMonth(currentYearMonth())}
              className="ml-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              This month
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {statsLoading ? (
            'Updating totals…'
          ) : (
            <>
              <strong className="text-slate-700">{formatCurrency(monthRollup.amount)}</strong>
              {' · '}{monthRollup.milk.toFixed(1)} L milk
              {monthRollup.buttermilk > 0 && ` · ${monthRollup.buttermilk.toFixed(1)} L buttermilk`}
              {' · '}{monthRollup.receiving} receiving
            </>
          )}
        </p>
      </div>

      {loading ? (
        <p className="text-center text-slate-500">Loading...</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CustomerCard
              key={c.id}
              customer={c}
              monthTotal={customerStats[c.id]?.monthTotal || 0}
              status={customerStats[c.id]?.status || 'paid'}
              milkQty={customerStats[c.id]?.milkQty || 0}
              buttermilkQty={customerStats[c.id]?.buttermilkQty || 0}
              monthText={month === currentYearMonth() ? 'this month' : `in ${monthLabel(month)}`}
              month={month}
            />
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleSave} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{editing ? 'Edit Customer' : 'Add Customer'}</h2>

            <div className="space-y-3">
              <input required placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
              <div>
                <input
                  required
                  type="tel"
                  placeholder="WhatsApp Number * (10 digits)"
                  value={form.whatsapp_no}
                  maxLength={10}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 10)
                    setForm({ ...form, whatsapp_no: v })
                    setPhoneError(v.length > 0 && v.length < 10 ? 'Must be 10 digits' : '')
                  }}
                  className={`w-full rounded-lg border px-3 py-2 ${phoneError ? 'border-red-400' : ''}`}
                />
                {phoneError && <p className="mt-1 text-xs text-red-500">{phoneError}</p>}
              </div>
              <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
              <div className="grid grid-cols-3 gap-2">
                <input type="number" placeholder="Rate ₹/L" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="rounded-lg border px-3 py-2" />
                <input type="number" step="0.5" placeholder="Morning L" value={form.morning_qty} onChange={(e) => setForm({ ...form, morning_qty: e.target.value })} className="rounded-lg border px-3 py-2" />
                <input type="number" step="0.5" placeholder="Evening L" value={form.evening_qty} onChange={(e) => setForm({ ...form, evening_qty: e.target.value })} className="rounded-lg border px-3 py-2" />
              </div>

              <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                <label className="flex items-center gap-2 font-medium text-purple-800">
                  <input type="checkbox" checked={form.buttermilk_required} onChange={(e) => setForm({ ...form, buttermilk_required: e.target.checked })} />
                  Buttermilk Subscription
                </label>
                {form.buttermilk_required && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-purple-600">Qty (L/day)</label>
                      <input type="number" step="0.5" min="0" value={form.buttermilk_quantity} onChange={(e) => setForm({ ...form, buttermilk_quantity: e.target.value })} className="mt-1 w-full rounded-lg border border-purple-200 px-3 py-2" />
                    </div>
                    <div>
                      <label className="text-xs text-purple-600">Rate ₹/L</label>
                      <input type="number" step="0.5" min="0" value={form.buttermilk_rate} onChange={(e) => setForm({ ...form, buttermilk_rate: e.target.value })} className="mt-1 w-full rounded-lg border border-purple-200 px-3 py-2" />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-600">Custom Fields</p>
                {customFields.map((cf, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <input placeholder="Key" value={cf.key} onChange={(e) => {
                      const next = [...customFields]
                      next[i].key = e.target.value
                      setCustomFields(next)
                    }} className="flex-1 rounded-lg border px-2 py-1 text-sm" />
                    <input placeholder="Value" value={cf.value} onChange={(e) => {
                      const next = [...customFields]
                      next[i].value = e.target.value
                      setCustomFields(next)
                    }} className="flex-1 rounded-lg border px-2 py-1 text-sm" />
                  </div>
                ))}
                <button type="button" onClick={() => setCustomFields([...customFields, { key: '', value: '' }])} className="text-sm text-green-600">+ Add field</button>
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <button type="submit" className="flex-1 rounded-lg bg-green-600 py-2 font-medium text-white">Save</button>
              <button type="button" onClick={() => setShowModal(false)} className="flex-1 rounded-lg border py-2">Cancel</button>
            </div>

            {editing && (
              <button type="button" onClick={handleDelete} className="mt-3 w-full rounded-lg border border-red-300 py-2 text-sm text-red-600 hover:bg-red-50">
                Delete customer
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  )
}
