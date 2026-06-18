import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import CustomerCard from '../components/CustomerCard'
import { currentYearMonth } from '../lib/utils'
import { loadCustomerMonthStats } from '../lib/bills'
import { parseSpreadsheet, rowsToCustomers, downloadImportTemplate } from '../lib/import-export'

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [customFields, setCustomFields] = useState([{ key: '', value: '' }])
  const [customerStats, setCustomerStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [importMsg, setImportMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

  function emptyForm() {
    return { name: '', whatsapp_no: '', address: '', rate: 83, morning_qty: 0, evening_qty: 0, active: true }
  }

  useEffect(() => {
    loadCustomers()
  }, [])

  async function loadCustomers() {
    setLoading(true)
    const { data } = await supabase.from('customers').select('*').order('name')
    const stats = await loadCustomerMonthStats(data || [], currentYearMonth())
    setCustomers(data || [])
    setCustomerStats(stats)
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
      const customers = rowsToCustomers(rows)

      if (!customers.length) {
        setImportMsg('No valid rows found. Need name + 10-digit WhatsApp number.')
        setImporting(false)
        return
      }

      const { error } = await supabase.from('customers').insert(customers)
      if (error) throw error

      setImportMsg(`Imported ${customers.length} customers ✓`)
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
      active: customer.active
    })
    const cf = customer.custom_fields || {}
    const pairs = Object.entries(cf).map(([key, value]) => ({ key, value }))
    setCustomFields(pairs.length ? pairs : [{ key: '', value: '' }])
    setShowModal(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    const custom_fields = {}
    customFields.forEach(({ key, value }) => {
      if (key.trim()) custom_fields[key.trim()] = value
    })

    const payload = { ...form, custom_fields }

    if (editing) {
      await supabase.from('customers').update(payload).eq('id', editing.id)
    } else {
      await supabase.from('customers').insert(payload)
    }

    setShowModal(false)
    loadCustomers()
  }

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.whatsapp_no.includes(search)
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
        <p className={`text-sm ${importMsg.includes('failed') || importMsg.includes('No valid') ? 'text-red-600' : 'text-green-600'}`}>
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
              <input required placeholder="WhatsApp Number *" value={form.whatsapp_no} onChange={(e) => setForm({ ...form, whatsapp_no: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
              <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
              <div className="grid grid-cols-3 gap-2">
                <input type="number" placeholder="Rate ₹/L" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} className="rounded-lg border px-3 py-2" />
                <input type="number" step="0.5" placeholder="Morning L" value={form.morning_qty} onChange={(e) => setForm({ ...form, morning_qty: e.target.value })} className="rounded-lg border px-3 py-2" />
                <input type="number" step="0.5" placeholder="Evening L" value={form.evening_qty} onChange={(e) => setForm({ ...form, evening_qty: e.target.value })} className="rounded-lg border px-3 py-2" />
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
          </form>
        </div>
      )}
    </div>
  )
}
