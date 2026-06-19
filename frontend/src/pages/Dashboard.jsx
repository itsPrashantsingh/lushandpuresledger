import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import StatCard from '../components/StatCard'
import {
  formatCurrency,
  formatDate,
  currentYearMonth,
  getMonthBounds,
  last6Months,
  last30Days,
  isOverdue,
  whatsappLink,
  getBillStatus
} from '../lib/utils'
import { getPaidAmountsForBills, markCashPayment, reconcileRazorpayPayments, wakeBackend } from '../lib/bills'
import { buildPaymentDueMessage, buildCashReceivedMessage } from '../lib/messages'

export default function Dashboard() {
  const [stats, setStats] = useState({
    revenue: 0,
    outstanding: 0,
    milkProduced: 0,
    milkMorning: 0,
    milkEvening: 0,
    milkDelivered: 0,
    netProfit: 0
  })
  const [revenueChart, setRevenueChart] = useState([])
  const [milkChart, setMilkChart] = useState([])
  const [unpaidBills, setUnpaidBills] = useState([])
  const [recentPayments, setRecentPayments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    wakeBackend().then(() => reconcileRazorpayPayments().catch(() => {}))
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    const ym = currentYearMonth()
    const { start, end } = getMonthBounds(ym)

    const [paymentsRes, billsRes, cattleEntriesRes, deliveredRes, expensesRes, allPaymentsRes, allExpensesRes, cattleEntries30Res] =
      await Promise.all([
        supabase.from('payments').select('amount').gte('paid_at', start).lte('paid_at', end + 'T23:59:59'),
        supabase.from('bills').select('*, customers(*)').eq('paid', false),
        supabase.from('cattle_milk_entries').select('morning_litres, evening_litres, total_litres').gte('date', start).lte('date', end),
        supabase.from('daily_entries').select('total_qty').gte('date', start).lte('date', end),
        supabase.from('expenses').select('amount').gte('date', start).lte('date', end),
        supabase.from('payments').select('amount, paid_at'),
        supabase.from('expenses').select('amount, date'),
        supabase.from('cattle_milk_entries').select('date, morning_litres, evening_litres, total_litres').gte('date', last30Days()[0].date)
      ])

    const monthRevenue = (paymentsRes.data || []).reduce((s, p) => s + Number(p.amount), 0)
    const monthExpenses = (expensesRes.data || []).reduce((s, e) => s + Number(e.amount), 0)
    const milkMorning = (cattleEntriesRes.data || []).reduce((s, e) => s + Number(e.morning_litres), 0)
    const milkEvening = (cattleEntriesRes.data || []).reduce((s, e) => s + Number(e.evening_litres), 0)
    const milkProduced = milkMorning + milkEvening
    const milkDelivered = (deliveredRes.data || []).reduce((s, e) => s + Number(e.total_qty), 0)

    const unpaidList = (billsRes.data || []).filter((b) => Number(b.total_amount) > 0)
    const paidMap = await getPaidAmountsForBills(unpaidList.map((b) => b.id))

    const billsWithPaid = unpaidList.map((bill) => ({
      ...bill,
      paidAmount: paidMap[bill.id] || 0
    }))

    const outstanding = billsWithPaid.reduce((s, b) => {
      const status = getBillStatus(b, b.paidAmount)
      if (status === 'paid') return s
      return s + (Number(b.total_amount) - b.paidAmount)
    }, 0)

    setStats({
      revenue: monthRevenue,
      outstanding,
      milkProduced,
      milkMorning,
      milkEvening,
      milkDelivered,
      netProfit: monthRevenue - monthExpenses
    })

    const months = last6Months()
    const revData = months.map((m) => {
      const { start: ms, end: me } = getMonthBounds(m.key)
      const rev = (allPaymentsRes.data || [])
        .filter((p) => p.paid_at >= ms && p.paid_at <= me + 'T23:59:59')
        .reduce((s, p) => s + Number(p.amount), 0)
      const exp = (allExpensesRes.data || [])
        .filter((e) => e.date >= ms && e.date <= me)
        .reduce((s, e) => s + Number(e.amount), 0)
      return { month: m.label, revenue: rev, expenses: exp }
    })
    setRevenueChart(revData)

    const days = last30Days()
    const byDate = {}
    for (const e of cattleEntries30Res.data || []) {
      if (!byDate[e.date]) byDate[e.date] = { morning: 0, evening: 0, total: 0 }
      byDate[e.date].morning += Number(e.morning_litres)
      byDate[e.date].evening += Number(e.evening_litres)
      byDate[e.date].total += Number(e.total_litres)
    }
    const milkData = days.map((d) => ({
      day: d.label,
      morning: byDate[d.date]?.morning || 0,
      evening: byDate[d.date]?.evening || 0,
      total: byDate[d.date]?.total || 0
    }))
    setMilkChart(milkData)

    setUnpaidBills(billsWithPaid.filter((b) => getBillStatus(b, b.paidAmount) !== 'paid'))

    const { data: payments } = await supabase
      .from('payments')
      .select('*, customers(name), bills(id)')
      .order('paid_at', { ascending: false })
      .limit(10)

    setRecentPayments(payments || [])
    setLoading(false)
  }

  async function handleMarkPaid(bill) {
    const balance = Number(bill.total_amount) - bill.paidAmount
    const amount = prompt(`Enter cash amount received (balance: ${formatCurrency(balance)}):`, balance)
    if (!amount) return
    try {
      const { customer, applied } = await markCashPayment(bill, amount, bill.customers)
      const msg = buildCashReceivedMessage(customer, formatCurrency(applied))
      window.open(whatsappLink(customer.whatsapp_no, msg), '_blank')
      loadDashboard()
    } catch (err) {
      alert(err.message)
    }
  }

  function handleReminder(bill) {
    const balance = formatCurrency(Number(bill.total_amount) - (bill.paidAmount || 0))
    const msg = buildPaymentDueMessage(bill.customers, balance, bill.razorpay_short_url)
    window.open(whatsappLink(bill.customers.whatsapp_no, msg), '_blank')
  }

  if (loading) {
    return <div className="py-12 text-center text-slate-500">Loading dashboard...</div>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Revenue (This Month)" value={formatCurrency(stats.revenue)} color="green" />
        <StatCard title="Outstanding" value={formatCurrency(stats.outstanding)} color="red" />
        <StatCard
          title="Milk Produced (L)"
          value={stats.milkProduced.toFixed(1)}
          subtitle={`AM ${stats.milkMorning.toFixed(1)} · PM ${stats.milkEvening.toFixed(1)}`}
          color="slate"
        />
        <StatCard title="Net Profit" value={formatCurrency(stats.netProfit)} color={stats.netProfit >= 0 ? 'green' : 'red'} />
      </div>

      {stats.milkDelivered > 0 && (
        <p className="text-sm text-slate-500">
          Delivered to customers this month: <strong>{stats.milkDelivered.toFixed(1)} L</strong>
          {stats.milkProduced > 0 && ` · Wastage/remaining: ${Math.max(0, stats.milkProduced - stats.milkDelivered).toFixed(1)} L`}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-4 font-semibold text-slate-700">Revenue vs Expenses (6 months)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenueChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Bar dataKey="revenue" fill="#16a34a" name="Revenue" />
              <Bar dataKey="expenses" fill="#dc2626" name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-4 font-semibold text-slate-700">Milk Production — Morning vs Evening (30 days)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={milkChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 9 }} interval={4} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="morning" stackId="a" fill="#3b82f6" name="Morning (L)" />
              <Bar dataKey="evening" stackId="a" fill="#8b5cf6" name="Evening (L)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-semibold text-slate-700">Unpaid Bills</h2>
        {unpaidBills.length === 0 ? (
          <p className="text-sm text-slate-500">All bills paid! 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-4">Customer</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Days Overdue</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {unpaidBills.map((bill) => {
                  const balance = Number(bill.total_amount) - bill.paidAmount
                  const overdueDays = isOverdue(bill)
                    ? Math.floor((new Date() - new Date(bill.period_end + 'T00:00:00')) / 86400000) - 7
                    : 0
                  return (
                    <tr key={bill.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-medium">{bill.customers?.name}</td>
                      <td className="py-3 pr-4">{formatCurrency(balance)}</td>
                      <td className="py-3 pr-4">{overdueDays > 0 ? `${overdueDays} days` : '—'}</td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          <button onClick={() => handleMarkPaid(bill)} className="text-green-600 hover:underline">Mark Paid</button>
                          <button onClick={() => handleReminder(bill)} className="text-amber-600 hover:underline">Reminder</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-semibold text-slate-700">Recent Payments</h2>
        {recentPayments.length === 0 ? (
          <p className="text-sm text-slate-500">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="pb-2 pr-4">Customer</th>
                  <th className="pb-2 pr-4">Bill</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Mode</th>
                  <th className="pb-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-3 pr-4">{p.customers?.name}</td>
                    <td className="py-3 pr-4">{p.bills?.id}</td>
                    <td className="py-3 pr-4 font-medium text-green-700">{formatCurrency(p.amount)}</td>
                    <td className="py-3 pr-4 uppercase">{p.mode}</td>
                    <td className="py-3">{formatDate(p.paid_at?.slice(0, 10))}</td>
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
