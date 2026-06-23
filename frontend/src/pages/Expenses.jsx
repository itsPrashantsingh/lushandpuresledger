import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { formatCurrency, currentYearMonth, getMonthBounds, todayISO } from '../lib/utils'

const COLORS = ['#16a34a', '#3b82f6', '#d97706', '#8b5cf6', '#64748b', '#ef4444', '#0891b2', '#a16207']

export default function Expenses() {
  const [month, setMonth] = useState(currentYearMonth())
  const [expenses, setExpenses] = useState([])
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState({ date: todayISO(), category: '', amount: '', note: '' })
  const [loading, setLoading] = useState(true)
  const [showCatModal, setShowCatModal] = useState(false)
  const [catForm, setCatForm] = useState({ name: '' })
  const [editingCat, setEditingCat] = useState(null)

  useEffect(() => { loadCategories() }, [])
  useEffect(() => { loadExpenses() }, [month])

  async function loadCategories() {
    const { data } = await supabase
      .from('expense_categories')
      .select('*')
      .eq('archived', false)
      .order('sort_order')
    const cats = data || []
    setCategories(cats)
    if (cats.length && !form.category) {
      setForm((f) => ({ ...f, category: cats[0].name }))
    }
  }

  async function loadExpenses() {
    setLoading(true)
    const { start, end } = getMonthBounds(month)
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false })
    setExpenses(data || [])
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.category) return
    await supabase.from('expenses').insert({
      date: form.date,
      category: form.category,
      amount: Number(form.amount),
      note: form.note
    })
    setForm((f) => ({ ...f, amount: '', note: '' }))
    loadExpenses()
  }

  async function handleDelete(id) {
    if (confirm('Delete this expense?')) {
      await supabase.from('expenses').delete().eq('id', id)
      loadExpenses()
    }
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
      await supabase.from('expense_categories').update({ name }).eq('id', editingCat.id)
      await supabase.from('expenses').update({ category: name }).eq('category', editingCat.name)
    } else {
      await supabase.from('expense_categories').insert({ name, sort_order: categories.length + 1 })
    }
    setShowCatModal(false)
    loadCategories()
  }

  async function archiveCat(cat) {
    if (!confirm(`Archive "${cat.name}"? Existing expenses keep this category label.`)) return
    await supabase.from('expense_categories').update({ archived: true }).eq('id', cat.id)
    loadCategories()
  }

  const monthTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)

  const categoryData = categories
    .map((cat) => ({
      name: cat.name,
      value: expenses.filter((e) => e.category === cat.name).reduce((s, e) => s + Number(e.amount), 0)
    }))
    .filter((d) => d.value > 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Expenses</h1>
        <div className="flex gap-2">
          <button
            onClick={openAddCat}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Manage Categories
          </button>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5"
          />
        </div>
      </div>

      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">Monthly Total</p>
        <p className="text-3xl font-bold text-red-700">{formatCurrency(monthTotal)}</p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">Add Expense</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-lg border px-3 py-2" required />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-lg border px-3 py-2" required>
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
          <input type="number" placeholder="Amount ₹" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-lg border px-3 py-2" required />
          <input placeholder="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="rounded-lg border px-3 py-2" />
        </div>
        <button type="submit" className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
          Add Expense
        </button>
      </form>

      {categoryData.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-4 font-semibold">Category Breakdown</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                {categoryData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">Expenses List</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : expenses.length === 0 ? (
          <p className="text-sm text-slate-500">No expenses this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Category</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Note</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100">
                    <td className="py-3 pr-4">{e.date}</td>
                    <td className="py-3 pr-4">{e.category}</td>
                    <td className="py-3 pr-4 font-medium text-red-600">{formatCurrency(e.amount)}</td>
                    <td className="py-3 pr-4 text-slate-500">{e.note}</td>
                    <td className="py-3">
                      <button onClick={() => handleDelete(e.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Category management modal */}
      {showCatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Expense Categories</h2>
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

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <span className="text-sm font-medium">{cat.name}</span>
                  <div className="flex gap-2">
                    <button onClick={() => openEditCat(cat)} className="text-xs text-blue-600 hover:underline">Rename</button>
                    <button onClick={() => archiveCat(cat)} className="text-xs text-red-500 hover:underline">Archive</button>
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
