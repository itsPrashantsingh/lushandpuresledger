import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, todayISO } from '../lib/utils'

const EMPTY_ITEM = {
  category_id: '',
  name: '',
  unit: 'pcs',
  quantity: '',
  current_quantity: '',
  purchase_date: todayISO(),
  purchase_price: '',
  notes: ''
}

export default function Inventory() {
  const [categories, setCategories] = useState([])
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showItemModal, setShowItemModal] = useState(false)
  const [showCatModal, setShowCatModal] = useState(false)
  const [itemForm, setItemForm] = useState(EMPTY_ITEM)
  const [editingItem, setEditingItem] = useState(null)
  const [catForm, setCatForm] = useState({ name: '' })
  const [editingCat, setEditingCat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from('inventory_categories').select('*').order('name'),
      supabase.from('inventory_items').select('*, inventory_categories(name)').eq('active', true).order('name')
    ])
    setCategories(cats || [])
    setItems(its || [])
    setLoading(false)
  }

  function openAdd() {
    setEditingItem(null)
    setItemForm({ ...EMPTY_ITEM, purchase_date: todayISO() })
    setShowItemModal(true)
  }

  function openEdit(item) {
    setEditingItem(item)
    setItemForm({
      category_id: item.category_id || '',
      name: item.name,
      unit: item.unit,
      quantity: String(item.quantity),
      current_quantity: String(item.current_quantity),
      purchase_date: item.purchase_date || todayISO(),
      purchase_price: String(item.purchase_price || ''),
      notes: item.notes || ''
    })
    setShowItemModal(true)
  }

  async function saveItem(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      category_id: itemForm.category_id || null,
      name: itemForm.name.trim(),
      unit: itemForm.unit.trim() || 'pcs',
      quantity: Number(itemForm.quantity) || 0,
      current_quantity: Number(itemForm.current_quantity) || 0,
      purchase_date: itemForm.purchase_date || null,
      purchase_price: Number(itemForm.purchase_price) || 0,
      notes: itemForm.notes.trim() || null
    }

    const { error } = editingItem
      ? await supabase.from('inventory_items').update(payload).eq('id', editingItem.id)
      : await supabase.from('inventory_items').insert(payload)

    setSaving(false)
    if (error) { setMsg('Error: ' + error.message); return }
    setShowItemModal(false)
    setMsg(editingItem ? 'Item updated' : 'Item added')
    loadAll()
  }

  async function deleteItem(item) {
    if (!confirm(`Archive "${item.name}"?`)) return
    await supabase.from('inventory_items').update({ active: false }).eq('id', item.id)
    loadAll()
  }

  function openAddCat() {
    setEditingCat(null)
    setCatForm({ name: '' })
    setShowCatModal(true)
  }

  function openEditCat(cat) {
    setEditingCat(cat)
    setCatForm({ name: cat.name })
    setShowCatModal(true)
  }

  async function saveCat(e) {
    e.preventDefault()
    const name = catForm.name.trim()
    if (!name) return
    if (editingCat) {
      await supabase.from('inventory_categories').update({ name }).eq('id', editingCat.id)
    } else {
      await supabase.from('inventory_categories').insert({ name })
    }
    setShowCatModal(false)
    loadAll()
  }

  async function deleteCat(cat) {
    if (!confirm(`Delete category "${cat.name}"? Items in this category will be uncategorized.`)) return
    await supabase.from('inventory_categories').delete().eq('id', cat.id)
    loadAll()
  }

  const filtered = items.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = !filterCat || item.category_id === filterCat
    return matchSearch && matchCat
  })

  const totalValue = filtered.reduce((s, i) => s + Number(i.purchase_price || 0) * Number(i.quantity || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Inventory</h1>
        <div className="flex flex-wrap gap-2">
          <button onClick={openAddCat} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Manage Categories
          </button>
          <button onClick={openAdd} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
            + Add Item
          </button>
        </div>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-xs text-slate-500">Total Items</p>
          <p className="text-xl font-bold text-slate-800">{items.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-xs text-slate-500">Categories</p>
          <p className="text-xl font-bold text-slate-800">{categories.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="text-xs text-slate-500">Total Purchase Value</p>
          <p className="text-xl font-bold text-slate-800">{formatCurrency(totalValue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2"
        />
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Item list */}
      {loading ? (
        <p className="text-center text-slate-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No inventory items yet. Click <strong>+ Add Item</strong> to start.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Purchase Qty</th>
                <th className="px-4 py-3">Current Qty</th>
                <th className="px-4 py-3">Purchase Price</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{item.name}</p>
                    {item.notes && <p className="text-xs text-slate-400">{item.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{item.inventory_categories?.name || '—'}</td>
                  <td className="px-4 py-3">{Number(item.quantity)} {item.unit}</td>
                  <td className="px-4 py-3">
                    <span className={`font-medium ${Number(item.current_quantity) <= 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {Number(item.current_quantity)} {item.unit}
                    </span>
                  </td>
                  <td className="px-4 py-3">{formatCurrency(item.purchase_price)}</td>
                  <td className="px-4 py-3">{item.purchase_date ? formatDate(item.purchase_date) : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(item)} className="text-xs text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => deleteItem(item)} className="text-xs text-red-500 hover:underline">Archive</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit item modal */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveItem} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{editingItem ? 'Edit Item' : 'Add Inventory Item'}</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">Category</label>
                <select value={itemForm.category_id} onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })} className="w-full rounded-lg border px-3 py-2">
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Item Name *</label>
                <input required placeholder="e.g. Milk Can 40L" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Unit</label>
                  <select value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} className="w-full rounded-lg border px-3 py-2">
                    <option value="pcs">pcs</option>
                    <option value="kg">kg</option>
                    <option value="litre">litre</option>
                    <option value="box">box</option>
                    <option value="set">set</option>
                    <option value="metre">metre</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Purchase Qty</label>
                  <input type="number" min="0" step="0.1" placeholder="0" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Current Qty</label>
                  <input type="number" min="0" step="0.1" placeholder="0" value={itemForm.current_quantity} onChange={(e) => setItemForm({ ...itemForm, current_quantity: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Purchase Price ₹</label>
                  <input type="number" min="0" step="0.01" placeholder="0" value={itemForm.purchase_price} onChange={(e) => setItemForm({ ...itemForm, purchase_price: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Purchase Date</label>
                <input type="date" value={itemForm.purchase_date} onChange={(e) => setItemForm({ ...itemForm, purchase_date: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Notes</label>
                <textarea placeholder="Optional notes" value={itemForm.notes} onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })} className="w-full rounded-lg border px-3 py-2" rows="2" />
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-green-600 py-2 font-medium text-white disabled:opacity-50">{saving ? 'Saving...' : editingItem ? 'Update' : 'Add Item'}</button>
              <button type="button" onClick={() => setShowItemModal(false)} className="flex-1 rounded-lg border py-2">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Category modal */}
      {showCatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Inventory Categories</h2>
              <button onClick={() => setShowCatModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={saveCat} className="mb-4 flex gap-2">
              <input
                placeholder={editingCat ? 'Rename category' : 'New category name'}
                value={catForm.name}
                onChange={(e) => setCatForm({ name: e.target.value })}
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                required
              />
              <button type="submit" className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white">
                {editingCat ? 'Rename' : 'Add'}
              </button>
              {editingCat && (
                <button type="button" onClick={() => { setEditingCat(null); setCatForm({ name: '' }) }} className="rounded-lg border px-3 py-2 text-sm">Cancel</button>
              )}
            </form>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <span className="text-sm font-medium">{cat.name}</span>
                  <div className="flex gap-2">
                    <button onClick={() => openEditCat(cat)} className="text-xs text-blue-600 hover:underline">Rename</button>
                    <button onClick={() => deleteCat(cat)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
