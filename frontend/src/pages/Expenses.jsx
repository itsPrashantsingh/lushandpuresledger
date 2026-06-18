import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { supabase } from '../lib/supabase'
import { formatCurrency, currentYearMonth, getMonthBounds, todayISO } from '../lib/utils'

const CATEGORIES = ['feed', 'salary', 'medicine', 'transport', 'other']
const COLORS = ['#16a34a', '#3b82f6', '#d97706', '#8b5cf6', '#64748b']

export default function Expenses() {
  const [month, setMonth] = useState(currentYearMonth())
  const [expenses, setExpenses] = useState([])
  const [form, setForm] = useState({ date: todayISO(), category: 'feed', amount: '', note: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadExpenses()
  }, [month])

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
    await supabase.from('expenses').insert({
      date: form.date,
      category: form.category,
      amount: Number(form.amount),
      note: form.note
    })
    setForm({ date: todayISO(), category: 'feed', amount: '', note: '' })
    loadExpenses()
  }

  async function handleDelete(id) {
    if (confirm('Delete this expense?')) {
      await supabase.from('expenses').delete().eq('id', id)
      loadExpenses()
    }
  }

  const monthTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)

  const categoryData = CATEGORIES.map((cat) => ({
    name: cat.charAt(0).toUpperCase() + cat.slice(1),
    value: expenses.filter((e) => e.category === cat).reduce((s, e) => s + Number(e.amount), 0)
  })).filter((d) => d.value > 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Expenses</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5"
        />
      </div>

      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">Monthly Total</p>
        <p className="text-3xl font-bold text-red-700">{formatCurrency(monthTotal)}</p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">Add Expense</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-lg border px-3 py-2" required />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="rounded-lg border px-3 py-2">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
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
                    <td className="py-3 pr-4 capitalize">{e.category}</td>
                    <td className="py-3 pr-4 font-medium text-red-600">{formatCurrency(e.amount)}</td>
                    <td className="py-3 pr-4 text-slate-500">{e.note}</td>
                    <td className="py-3">
                      <button onClick={() => handleDelete(e.id)} className="text-red-500 hover:underline text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
