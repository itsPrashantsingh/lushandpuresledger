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
  getBillStatus,
  todayISO
} from '../lib/utils'
import { getPaidAmountsForBills, markCashPayment, reconcileRazorpayPayments, wakeBackend } from '../lib/bills'
import { buildPaymentDueMessage, buildCashReceivedMessage } from '../lib/messages'

export default function Dashboard() {
  const [stats, setStats] = useState({
    revenue: 0, milkRevenue: 0, productRevenue: 0, outstanding: 0,
    milkProduced: 0, milkMorning: 0, milkEvening: 0, milkDelivered: 0,
    netProfit: 0, activeCustomers: 0, activeCattle: 0,
    collectionEfficiency: 0, productionEfficiency: 0
  })
  const [revenueFrom, setRevenueFrom] = useState(() => getMonthBounds(currentYearMonth()).start)
  const [revenueTo, setRevenueTo] = useState(todayISO)
  const [revenueBreakdown, setRevenueBreakdown] = useState({ milk: 0, buttermilk: 0, products: 0, total: 0, expenses: 0, netProfit: 0, cashCollected: 0, outstanding: 0 })
  const [rawMilkDeliveries, setRawMilkDeliveries] = useState([])
  const [rawBmDeliveries, setRawBmDeliveries] = useState([])
  const [rawProductSalesAll, setRawProductSalesAll] = useState([])
  const [rawExpensesAll, setRawExpensesAll] = useState([])
  const [rawPaymentsAll, setRawPaymentsAll] = useState([])
  const [milkChartCattle, setMilkChartCattle] = useState('total')
  const [rawMilkChart30, setRawMilkChart30] = useState([])
  const [productionKpis, setProductionKpis] = useState({
    today: 0, thisMonth: 0, last30: 0, lifetime: 0
  })
  const [supplyVsProduction, setSupplyVsProduction] = useState({
    produced: 0, supplied: 0, surplus: 0, utilization: 0
  })
  const [svpRange, setSvpRange] = useState('alltime')
  const [rawCattleEntries, setRawCattleEntries] = useState([])
  const [rawDailyEntries, setRawDailyEntries] = useState([])
  const [cattle, setCattle] = useState([])
  const [selectedCattle, setSelectedCattle] = useState('total')
  const [cattleKpis, setCattleKpis] = useState({ today: 0, thisMonth: 0, last30: 0, lifetime: 0 })
  const [revenueChart, setRevenueChart] = useState([])
  const [milkChart, setMilkChart] = useState([])
  const [unpaidBills, setUnpaidBills] = useState([])
  const [recentPayments, setRecentPayments] = useState([])
  const [topPayers, setTopPayers] = useState([])
  const [overdueCustomers, setOverdueCustomers] = useState([])
  const [loading, setLoading] = useState(true)

  async function loadDashboard() {
    setLoading(true)
    const ym = currentYearMonth()
    const { start, end } = getMonthBounds(ym)
    const today = todayISO()

    const [
      paymentsRes, productSalesRes, billsRes, cattleEntriesRes, deliveredRes,
      expensesRes, allPaymentsRes, allProductSalesRes, allExpensesRes,
      cattleEntries30Res, activeCustomersRes, activeCattleRes,
      allCattleEntriesRes, allDeliveredRes, cattleListRes,
      allMilkDeliveriesRes, allBmDeliveriesRes
    ] = await Promise.all([
      supabase.from('payments').select('amount').gte('paid_at', start).lte('paid_at', end + 'T23:59:59'),
      supabase.from('product_sales').select('total_amount').gte('date', start).lte('date', end).eq('paid', true),
      supabase.from('bills').select('*, customers(*)').eq('paid', false),
      supabase.from('cattle_milk_entries').select('morning_litres, evening_litres, total_litres').gte('date', start).lte('date', end),
      supabase.from('daily_entries').select('total_qty').gte('date', start).lte('date', end),
      supabase.from('expenses').select('amount').gte('date', start).lte('date', end),
      supabase.from('payments').select('amount, paid_at'),
      supabase.from('product_sales').select('total_amount, date').eq('paid', true),
      supabase.from('expenses').select('amount, date'),
      supabase.from('cattle_milk_entries').select('date, morning_litres, evening_litres, total_litres, cattle_id').gte('date', last30Days()[0].date),
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('cattle').select('id', { count: 'exact', head: true }).eq('active', true),
      supabase.from('cattle_milk_entries').select('total_litres, date, cattle_id'),
      supabase.from('daily_entries').select('total_qty, date'),
      supabase.from('cattle').select('id, name, cattle_id').eq('active', true).order('name'),
      supabase.from('daily_entries').select('amount, date'),
      supabase.from('buttermilk_entries').select('amount, date')
    ])

    const milkRevenue = (paymentsRes.data || []).reduce((s, p) => s + Number(p.amount), 0)
    const productRevenue = (productSalesRes.data || []).reduce((s, p) => s + Number(p.total_amount), 0)
    const monthRevenue = milkRevenue + productRevenue
    const monthExpenses = (expensesRes.data || []).reduce((s, e) => s + Number(e.amount), 0)
    const milkMorning = (cattleEntriesRes.data || []).reduce((s, e) => s + Number(e.morning_litres), 0)
    const milkEvening = (cattleEntriesRes.data || []).reduce((s, e) => s + Number(e.evening_litres), 0)
    const milkProduced = milkMorning + milkEvening
    const milkDelivered = (deliveredRes.data || []).reduce((s, e) => s + Number(e.total_qty), 0)

    const unpaidList = (billsRes.data || []).filter((b) => Number(b.total_amount) > 0)
    const paidMap = await getPaidAmountsForBills(unpaidList.map((b) => b.id))
    const billsWithPaid = unpaidList.map((bill) => ({ ...bill, paidAmount: paidMap[bill.id] || 0 }))
    const outstanding = billsWithPaid.reduce((s, b) => {
      const status = getBillStatus(b, b.paidAmount)
      if (status === 'paid') return s
      return s + (Number(b.total_amount) - b.paidAmount)
    }, 0)

    // Collection efficiency: paid this month / total billed this month
    const { data: monthBills } = await supabase.from('bills').select('id, total_amount').gte('period_start', start).lte('period_end', end)
    const monthBilledTotal = (monthBills || []).reduce((s, b) => s + Number(b.total_amount), 0)
    const monthPaidMap = await getPaidAmountsForBills((monthBills || []).map((b) => b.id))
    const monthCollected = Object.values(monthPaidMap).reduce((s, v) => s + v, 0)
    const collectionEfficiency = monthBilledTotal > 0 ? Math.round((monthCollected / monthBilledTotal) * 100) : 0

    // Production efficiency: supplied / produced
    const productionEfficiency = milkProduced > 0 ? Math.round((milkDelivered / milkProduced) * 100) : 0

    setStats({
      revenue: monthRevenue, milkRevenue, productRevenue, outstanding,
      milkProduced, milkMorning, milkEvening, milkDelivered,
      netProfit: monthRevenue - monthExpenses,
      activeCustomers: activeCustomersRes.count || 0,
      activeCattle: activeCattleRes.count || 0,
      collectionEfficiency, productionEfficiency
    })

    // Store raw SVP data — recomputed in useEffect when svpRange changes
    setRawCattleEntries(allCattleEntriesRes.data || [])
    setRawDailyEntries(allDeliveredRes.data || [])

    // Store raw revenue data — recomputed in useEffect when date range changes
    setRawMilkDeliveries(allMilkDeliveriesRes.data || [])
    setRawBmDeliveries(allBmDeliveriesRes.data || [])
    setRawProductSalesAll(allProductSalesRes.data || [])
    setRawExpensesAll(allExpensesRes.data || [])
    setRawPaymentsAll(allPaymentsRes.data || [])

    // Cattle list for filter
    setCattle(cattleListRes.data || [])

    // Raw 30-day entries for milk chart (filtered per-cattle in useEffect)
    setRawMilkChart30(cattleEntries30Res.data || [])

    // Production KPIs (total / all cattle)
    const allEntries = allCattleEntriesRes.data || []
    const todayTotal = allEntries.filter((e) => e.date === today).reduce((s, e) => s + Number(e.total_litres), 0)
    const monthTotal = allEntries.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + Number(e.total_litres), 0)
    const last30Total = (cattleEntries30Res.data || []).reduce((s, e) => s + Number(e.total_litres), 0)
    const lifetimeTotal = allEntries.reduce((s, e) => s + Number(e.total_litres), 0)
    setProductionKpis({ today: todayTotal, thisMonth: monthTotal, last30: last30Total, lifetime: lifetimeTotal })

    // Revenue chart
    const months = last6Months()
    const revData = months.map((m) => {
      const { start: ms, end: me } = getMonthBounds(m.key)
      const milkRev = (allPaymentsRes.data || []).filter((p) => p.paid_at >= ms && p.paid_at <= me + 'T23:59:59').reduce((s, p) => s + Number(p.amount), 0)
      const productRev = (allProductSalesRes.data || []).filter((p) => p.date >= ms && p.date <= me).reduce((s, p) => s + Number(p.total_amount), 0)
      const exp = (allExpensesRes.data || []).filter((e) => e.date >= ms && e.date <= me).reduce((s, e) => s + Number(e.amount), 0)
      return { month: m.label, revenue: milkRev + productRev, milkRevenue: milkRev, productRevenue: productRev, expenses: exp }
    })
    setRevenueChart(revData)

    setUnpaidBills(billsWithPaid.filter((b) => getBillStatus(b, b.paidAmount) !== 'paid'))

    const { data: payments } = await supabase.from('payments').select('*, customers(name), bills(id)').order('paid_at', { ascending: false }).limit(10)
    setRecentPayments(payments || [])

    // Payment intelligence — top payers & overdue
    const { data: allBills } = await supabase.from('bills').select('*, customers(name, whatsapp_no, customer_id)').gte('period_start', last6Months()[0].key + '-01')
    if (allBills?.length) {
      const billIds = allBills.map((b) => b.id)
      const pmap = await getPaidAmountsForBills(billIds)

      const customerMap = {}
      for (const b of allBills) {
        if (!b.customers) continue
        const cid = b.customer_id
        if (!customerMap[cid]) customerMap[cid] = { name: b.customers.name, customer_id: b.customers.customer_id, onTime: 0, total: 0, outstanding: 0, overdueCount: 0, overdueDays: [] }
        const paid = pmap[b.id] || 0
        const due = Number(b.total_amount) - paid
        customerMap[cid].total++
        if (paid >= Number(b.total_amount)) {
          customerMap[cid].onTime++
        } else if (isOverdue(b)) {
          customerMap[cid].overdueCount++
          customerMap[cid].outstanding += due
          const days = Math.floor((new Date() - new Date(b.period_end + 'T00:00:00')) / 86400000) - 7
          customerMap[cid].overdueDays.push(Math.max(0, days))
        }
      }

      const entries = Object.values(customerMap)
      const top = entries.filter((c) => c.total > 0).sort((a, b) => (b.onTime / b.total) - (a.onTime / a.total) || b.onTime - a.onTime).slice(0, 5)
      const overdue = entries.filter((c) => c.overdueCount > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, 8)
      setTopPayers(top)
      setOverdueCustomers(overdue)
    }

    setLoading(false)
  }

  useEffect(() => {
    wakeBackend().then(() => reconcileRazorpayPayments().catch(() => {}))
    Promise.resolve().then(loadDashboard)
  }, [])

  // Per-cattle KPIs when filter changes
  useEffect(() => {
    if (selectedCattle === 'total') {
      setCattleKpis(productionKpis)
      return
    }
    async function loadCattleKpis() {
      const today = todayISO()
      const ym = currentYearMonth()
      const { start, end } = getMonthBounds(ym)
      const last30Start = last30Days()[0].date

      const [todayRes, monthRes, last30Res, lifetimeRes] = await Promise.all([
        supabase.from('cattle_milk_entries').select('total_litres').eq('cattle_id', selectedCattle).eq('date', today),
        supabase.from('cattle_milk_entries').select('total_litres').eq('cattle_id', selectedCattle).gte('date', start).lte('date', end),
        supabase.from('cattle_milk_entries').select('total_litres').eq('cattle_id', selectedCattle).gte('date', last30Start),
        supabase.from('cattle_milk_entries').select('total_litres').eq('cattle_id', selectedCattle)
      ])

      const sum = (arr) => (arr || []).reduce((s, e) => s + Number(e.total_litres), 0)
      setCattleKpis({
        today: sum(todayRes.data),
        thisMonth: sum(monthRes.data),
        last30: sum(last30Res.data),
        lifetime: sum(lifetimeRes.data)
      })
    }
    loadCattleKpis()
  }, [selectedCattle, productionKpis])

  // Recompute revenue breakdown whenever date range or raw data changes
  useEffect(() => {
    if (!revenueFrom || !revenueTo) return
    const milk = rawMilkDeliveries.filter((e) => e.date >= revenueFrom && e.date <= revenueTo).reduce((s, e) => s + Number(e.amount), 0)
    const buttermilk = rawBmDeliveries.filter((e) => e.date >= revenueFrom && e.date <= revenueTo).reduce((s, e) => s + Number(e.amount), 0)
    const products = rawProductSalesAll.filter((e) => e.date >= revenueFrom && e.date <= revenueTo).reduce((s, e) => s + Number(e.total_amount), 0)
    const expenses = rawExpensesAll.filter((e) => e.date >= revenueFrom && e.date <= revenueTo).reduce((s, e) => s + Number(e.amount), 0)
    const billPayments = rawPaymentsAll.filter((e) => e.paid_at >= revenueFrom && e.paid_at <= revenueTo + 'T23:59:59').reduce((s, e) => s + Number(e.amount), 0)
    const cashCollected = billPayments + products
    const total = milk + buttermilk + products
    const outstanding = Math.max(0, milk + buttermilk - billPayments)
    setRevenueBreakdown({ milk, buttermilk, products, total, expenses, netProfit: total - expenses, cashCollected, outstanding })
  }, [revenueFrom, revenueTo, rawMilkDeliveries, rawBmDeliveries, rawProductSalesAll, rawExpensesAll, rawPaymentsAll])

  // Recompute milk chart whenever cattle filter or raw data changes
  useEffect(() => {
    const days = last30Days()
    const entries = milkChartCattle === 'total'
      ? rawMilkChart30
      : rawMilkChart30.filter((e) => e.cattle_id === milkChartCattle)
    const byDate = {}
    for (const e of entries) {
      if (!byDate[e.date]) byDate[e.date] = { morning: 0, evening: 0, total: 0 }
      byDate[e.date].morning += Number(e.morning_litres)
      byDate[e.date].evening += Number(e.evening_litres)
      byDate[e.date].total += Number(e.total_litres)
    }
    setMilkChart(days.map((d) => ({ day: d.label, morning: byDate[d.date]?.morning || 0, evening: byDate[d.date]?.evening || 0, total: byDate[d.date]?.total || 0 })))
  }, [milkChartCattle, rawMilkChart30])

  // Recompute supply vs production whenever range or raw data changes
  useEffect(() => {
    if (!rawCattleEntries.length && !rawDailyEntries.length) return
    const ym = currentYearMonth()
    const { start, end } = getMonthBounds(ym)
    const sixMonthsStart = last6Months()[0].key + '-01'

    const cattle = svpRange === 'month'
      ? rawCattleEntries.filter((e) => e.date >= start && e.date <= end)
      : svpRange === '6months'
        ? rawCattleEntries.filter((e) => e.date >= sixMonthsStart)
        : rawCattleEntries

    const delivered = svpRange === 'month'
      ? rawDailyEntries.filter((e) => e.date >= start && e.date <= end)
      : svpRange === '6months'
        ? rawDailyEntries.filter((e) => e.date >= sixMonthsStart)
        : rawDailyEntries

    const produced = cattle.reduce((s, e) => s + Number(e.total_litres), 0)
    const supplied = delivered.reduce((s, e) => s + Number(e.total_qty), 0)
    const surplus = produced - supplied
    setSupplyVsProduction({
      produced, supplied, surplus,
      utilization: produced > 0 ? Math.round((supplied / produced) * 100) : 0
    })
  }, [svpRange, rawCattleEntries, rawDailyEntries])

  async function handleMarkPaid(bill) {
    const balance = Number(bill.total_amount) - bill.paidAmount
    const amount = prompt(`Enter cash amount received (balance: ${formatCurrency(balance)}):`, balance)
    if (!amount) return
    try {
      const { customer, applied } = await markCashPayment(bill, amount, bill.customers)
      const msg = buildCashReceivedMessage(customer, formatCurrency(applied))
      window.open(whatsappLink(customer.whatsapp_no, msg), '_blank')
      loadDashboard()
    } catch (err) { alert(err.message) }
  }

  function handleReminder(bill) {
    const balance = formatCurrency(Number(bill.total_amount) - (bill.paidAmount || 0))
    const msg = buildPaymentDueMessage(bill.customers, balance, bill.razorpay_short_url)
    window.open(whatsappLink(bill.customers.whatsapp_no, msg), '_blank')
  }

  if (loading) return <div className="py-12 text-center text-slate-500">Loading dashboard...</div>

  const activeCattleName = selectedCattle === 'total' ? null : cattle.find((c) => c.id === selectedCattle)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>

      {/* ── Revenue & Profit ──────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Revenue & Profit</h2>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={revenueFrom}
              onChange={(e) => setRevenueFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={revenueTo}
              onChange={(e) => setRevenueTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-slate-700"
            />
          </div>
        </div>
        {/* Row 1 — key KPIs */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className={`rounded-xl border p-4 ${revenueBreakdown.netProfit >= 0 ? 'border-emerald-300 bg-emerald-600' : 'border-red-300 bg-red-600'}`}>
            <p className="text-xs font-medium text-white/70">Net Profit</p>
            <p className="mt-1 text-xl font-bold text-white">{formatCurrency(revenueBreakdown.netProfit)}</p>
            <p className="mt-1 text-[10px] text-white/50">Total Revenue − Expenses</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-medium text-slate-500">Total Revenue</p>
            <p className="mt-1 text-xl font-bold text-slate-800">{formatCurrency(revenueBreakdown.total)}</p>
            <p className="mt-1 text-[10px] text-slate-400">Milk + Buttermilk + Products</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs font-medium text-blue-600">Cash Collected</p>
            <p className="mt-1 text-xl font-bold text-blue-800">{formatCurrency(revenueBreakdown.cashCollected)}</p>
            <p className="mt-1 text-[10px] text-blue-400">Bill Payments + Product Sales</p>
          </div>
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-xs font-medium text-orange-600">Outstanding</p>
            <p className="mt-1 text-xl font-bold text-orange-800">{formatCurrency(revenueBreakdown.outstanding)}</p>
            <p className="mt-1 text-[10px] text-orange-400">Milk + BM Delivered − Collected</p>
          </div>
        </div>

        {/* Row 2 — breakdown */}
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-3">
            <p className="text-xs font-medium text-green-600">Milk Revenue</p>
            <p className="mt-1 text-lg font-bold text-green-800">{formatCurrency(revenueBreakdown.milk)}</p>
            <p className="mt-1 text-[10px] text-green-400">Σ daily_entries.amount</p>
          </div>
          <div className="rounded-xl border border-purple-200 bg-purple-50 p-3">
            <p className="text-xs font-medium text-purple-600">Buttermilk Revenue</p>
            <p className="mt-1 text-lg font-bold text-purple-800">{formatCurrency(revenueBreakdown.buttermilk)}</p>
            <p className="mt-1 text-[10px] text-purple-400">Σ buttermilk_entries.amount</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-600">Product Sales</p>
            <p className="mt-1 text-lg font-bold text-amber-800">{formatCurrency(revenueBreakdown.products)}</p>
            <p className="mt-1 text-[10px] text-amber-400">Σ product_sales.total_amount</p>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-medium text-red-500">Expenses</p>
            <p className="mt-1 text-lg font-bold text-red-800">{formatCurrency(revenueBreakdown.expenses)}</p>
            <p className="mt-1 text-[10px] text-red-400">Σ expenses.amount</p>
          </div>
        </div>
      </section>

      {/* ── Business Health ────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Business Health</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard title="Active Customers" value={stats.activeCustomers} color="green" />
          <StatCard title="Active Cattle" value={stats.activeCattle} color="slate" />
          <StatCard title="Collection Efficiency" value={`${stats.collectionEfficiency}%`} subtitle="Paid vs billed this month" color={stats.collectionEfficiency >= 80 ? 'green' : stats.collectionEfficiency >= 50 ? 'amber' : 'red'} />
          <StatCard title="Production Efficiency" value={`${stats.productionEfficiency}%`} subtitle="Supplied vs produced this month" color={stats.productionEfficiency >= 80 ? 'green' : 'amber'} />
        </div>
      </section>

      {/* ── Production Analytics ──────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Production Analytics</h2>
          <select
            value={selectedCattle}
            onChange={(e) => setSelectedCattle(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          >
            <option value="total">Total Production</option>
            {cattle.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.cattle_id ? ` (${c.cattle_id})` : ''}</option>
            ))}
          </select>
        </div>
        {activeCattleName && (
          <p className="mb-2 text-xs text-slate-500">Showing: {activeCattleName.name} {activeCattleName.cattle_id ? `· ${activeCattleName.cattle_id}` : ''}</p>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-center">
            <p className="text-xs text-blue-600">Today</p>
            <p className="mt-1 text-2xl font-bold text-blue-800">{cattleKpis.today.toFixed(1)} L</p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center">
            <p className="text-xs text-indigo-600">This Month</p>
            <p className="mt-1 text-2xl font-bold text-indigo-800">{cattleKpis.thisMonth.toFixed(1)} L</p>
          </div>
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-center">
            <p className="text-xs text-violet-600">Last 30 Days</p>
            <p className="mt-1 text-2xl font-bold text-violet-800">{cattleKpis.last30.toFixed(1)} L</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <p className="text-xs text-slate-500">Lifetime Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{cattleKpis.lifetime.toFixed(1)} L</p>
          </div>
        </div>
      </section>

      {/* ── Supply vs Production ──────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Supply vs Production
          </h2>
          <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden text-xs font-medium">
            {[['month', 'This Month'], ['6months', '6 Months'], ['alltime', 'All Time']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setSvpRange(val)}
                className={`px-3 py-1.5 transition-colors ${svpRange === val ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs text-blue-600">Total Produced</p>
            <p className="mt-1 text-xl font-bold text-blue-800">{supplyVsProduction.produced.toFixed(1)} L</p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-xs text-green-600">Total Supplied</p>
            <p className="mt-1 text-xl font-bold text-green-800">{supplyVsProduction.supplied.toFixed(1)} L</p>
          </div>
          <div className={`rounded-xl border p-4 ${supplyVsProduction.surplus >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
            <p className={`text-xs ${supplyVsProduction.surplus >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {supplyVsProduction.surplus >= 0 ? 'Surplus' : 'Shortage'}
            </p>
            <p className={`mt-1 text-xl font-bold ${supplyVsProduction.surplus >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
              {Math.abs(supplyVsProduction.surplus).toFixed(1)} L
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs text-amber-600">Utilization</p>
            <p className="mt-1 text-xl font-bold text-amber-800">{supplyVsProduction.utilization}%</p>
          </div>
        </div>
      </section>

      {/* ── Charts ────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-4 font-semibold text-slate-700">Revenue vs Expenses (6 months)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenueChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Bar dataKey="milkRevenue" stackId="revenue" fill="#16a34a" name="Milk Revenue" />
              <Bar dataKey="productRevenue" stackId="revenue" fill="#d97706" name="Other Sales" />
              <Bar dataKey="expenses" fill="#dc2626" name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-700">Milk Production — AM vs PM (30 days)</h2>
            <select
              value={milkChartCattle}
              onChange={(e) => setMilkChartCattle(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              <option value="total">All Cattle</option>
              {cattle.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.cattle_id ? ` (${c.cattle_id})` : ''}</option>
              ))}
            </select>
          </div>
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

      {/* ── Customer Payment Intelligence ─────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold text-slate-700">Top Paying Customers</h2>
          {topPayers.length === 0 ? (
            <p className="text-sm text-slate-500">No billing data available.</p>
          ) : (
            <div className="space-y-2">
              {topPayers.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <div>
                    <p className="font-medium text-slate-800">{c.name}</p>
                    {c.customer_id && <p className="text-xs font-mono text-slate-400">{c.customer_id}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-green-700">{c.onTime}/{c.total} on time</p>
                    <p className="text-xs text-slate-400">{Math.round((c.onTime / c.total) * 100)}% consistency</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold text-slate-700">Overdue Customers</h2>
          {overdueCustomers.length === 0 ? (
            <p className="text-sm text-green-600">No overdue customers.</p>
          ) : (
            <div className="space-y-2">
              {overdueCustomers.map((c, i) => {
                const avgDays = c.overdueDays.length ? Math.round(c.overdueDays.reduce((a, b) => a + b, 0) / c.overdueDays.length) : 0
                return (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                    <div>
                      <p className="font-medium text-slate-800">{c.name}</p>
                      {c.customer_id && <p className="text-xs font-mono text-slate-400">{c.customer_id}</p>}
                      <p className="text-xs text-red-500">{c.overdueCount} bill{c.overdueCount > 1 ? 's' : ''} overdue · avg {avgDays} days</p>
                    </div>
                    <p className="font-semibold text-red-700">{formatCurrency(c.outstanding)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Unpaid Bills ──────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-4 font-semibold text-slate-700">Unpaid Bills</h2>
        {unpaidBills.length === 0 ? (
          <p className="text-sm text-slate-500">All bills paid!</p>
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
                  const overdueDays = isOverdue(bill) ? Math.floor((new Date() - new Date(bill.period_end + 'T00:00:00')) / 86400000) - 7 : 0
                  return (
                    <tr key={bill.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4">
                        <p className="font-medium">{bill.customers?.name}</p>
                        <p className="text-xs font-mono text-slate-400">{bill.customers?.customer_id}</p>
                      </td>
                      <td className="py-3 pr-4">{formatCurrency(balance)}</td>
                      <td className="py-3 pr-4">{overdueDays > 0 ? <span className="text-red-600">{overdueDays} days</span> : '—'}</td>
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

      {/* ── Recent Payments ───────────────────────────────────── */}
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
