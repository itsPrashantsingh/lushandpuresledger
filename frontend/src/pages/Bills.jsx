import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import BillCard from '../components/BillCard'
import Toast from '../components/Toast'
import {
  getPaidAmountsForBills,
  markCashPayment,
  generateAllMonthlyBills,
  ensureRazorpayForUnpaidBills,
  getMonthlyBillPackages,
  formatGenerationSummary,
  billableEntries,
  syncRazorpayPayment,
  reconcileRazorpayPayments,
  wakeBackend
} from '../lib/bills'
import { openBillPdf } from '../lib/pdf'
import { shareBillOnWhatsApp } from '../lib/whatsapp'
import { sendBillViaApi, sendTextViaApi } from '../lib/whatsapp-api'
import WhatsAppSendQueue from '../components/WhatsAppSendQueue'
import LoadingOverlay from '../components/LoadingOverlay'
import { getBillStatus, formatCurrency, whatsappLink, currentYearMonth, formatDate } from '../lib/utils'
import { buildPaymentDueMessage } from '../lib/messages'

export default function Bills() {
  const [bills, setBills] = useState([])
  const [paidMap, setPaidMap] = useState({})
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [month, setMonth] = useState(currentYearMonth())
  const [loading, setLoading] = useState(true)
  const [cashModal, setCashModal] = useState(null)
  const [cashAmount, setCashAmount] = useState('')
  const [cashPaidAt, setCashPaidAt] = useState('')
  const [savingCash, setSavingCash] = useState(false)
  const [running, setRunning] = useState('')
  const [progress, setProgress] = useState(null)
  const [toast, setToast] = useState({ message: '', type: 'success' })
  const [sendQueue, setSendQueue] = useState(null)
  const [genSummary, setGenSummary] = useState(null)
  const [syncingBillId, setSyncingBillId] = useState('')

  useEffect(() => { loadBills() }, [month])

  async function autoReconcile() {
    try {
      await wakeBackend()
      const result = await reconcileRazorpayPayments()
      if (result.synced?.length > 0) {
        setToast({ message: `Auto-synced ${result.synced.length} Razorpay payment(s) ✓`, type: 'success' })
        loadBills()
      }
    } catch {
      // silent — backend may be waking up
    }
  }

  async function loadBills() {
    setLoading(true)
    const ym = month
    const start = `${ym}-01`
    const [y, m] = ym.split('-').map(Number)
    const end = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

    const { data } = await supabase
      .from('bills')
      .select('*, customers(*)')
      .gte('period_start', start)
      .lte('period_end', end)
      .order('created_at', { ascending: false })

    const pmap = await getPaidAmountsForBills((data || []).map((b) => b.id))
    setBills(data || [])
    setPaidMap(pmap)
    setLoading(false)

    const hasPendingRazorpay = (data || []).some((b) => !b.paid && b.razorpay_link_id)
    if (hasPendingRazorpay) autoReconcile()
  }

  async function runGenerateAll() {
    setRunning('generate')
    try {
      await wakeBackend()
      const results = await generateAllMonthlyBills(month, {
        withRazorpay: true,
        onProgress: (p) => setProgress(p)
      })
      setGenSummary(results)
      setToast({
        message: formatGenerationSummary(results),
        type: results.errors?.length ? 'info' : 'success'
      })
      loadBills()
    } catch (err) {
      setToast({ message: err.message, type: 'error' })
    }
    setRunning('')
    setProgress(null)
  }

  async function runSyncRazorpay() {
    setRunning('sync')
    try {
      await wakeBackend()
      const result = await reconcileRazorpayPayments(month)
      setToast({
        message: result.synced?.length
          ? `Synced ${result.synced.length} of ${result.checked} Razorpay payment(s) ✓`
          : `Checked ${result.checked || 0} bill(s) — nothing new to sync`,
        type: 'success'
      })
      loadBills()
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message, type: 'error' })
    }
    setRunning('')
  }

  async function runRazorpayAll() {
    setRunning('razorpay')
    try {
      await wakeBackend()
      const results = await ensureRazorpayForUnpaidBills(month, (p) => setProgress(p))
      const ok = results.filter((r) => r.url).length
      setToast({ message: `Created ${ok} Razorpay payment links`, type: 'success' })
      loadBills()
    } catch (err) {
      setToast({ message: err.message, type: 'error' })
    }
    setRunning('')
    setProgress(null)
  }

  async function runSendAllBills() {
    const packages = await getMonthlyBillPackages(month)
    const unpaid = packages.filter((pkg) => {
      const paid = paidMap[pkg.bill.id] || 0
      const hasMilk = pkg.entries.length > 0
      const hasButtermilk = Number(pkg.bill.buttermilk_subtotal) > 0
      return getBillStatus(pkg.bill, paid) !== 'paid' && (hasMilk || hasButtermilk)
    })

    if (!unpaid.length) {
      setToast({ message: 'No unpaid bills to send', type: 'info' })
      return
    }

    setSendQueue(unpaid)
  }

  function filteredBills() {
    const q = search.trim().toLowerCase()
    return bills.filter((b) => {
      const status = getBillStatus(b, paidMap[b.id] || 0)
      if (tab !== 'all' && status !== tab) return false
      if (!q) return true
      const name = (b.customers?.name || '').toLowerCase()
      const cid = (b.customers?.customer_id || '').toLowerCase()
      const bid = (b.id || '').toLowerCase()
      return name.includes(q) || cid.includes(q) || bid.includes(q)
    })
  }

  function openCashModal(bill) {
    setCashModal(bill)
    setCashAmount(String(Number(bill.total_amount) - (paidMap[bill.id] || 0)))
    setCashPaidAt(bill.period_end)
  }

  async function confirmCashPayment() {
    if (!cashModal || !cashAmount || savingCash) return
    setSavingCash(true)
    try {
      const { applied } = await markCashPayment(cashModal, cashAmount, cashModal.customers, cashPaidAt)
      const billId = cashModal.id
      setCashModal(null)
      loadBills()
      // API-only acknowledgement — always surface the result, never silently swallow it.
      try {
        const res = await sendTextViaApi('cash_received', billId, { amount: applied })
        setToast({ message: res.ok ? 'Cash recorded · WhatsApp ack sent ✓' : `Cash recorded (ack failed: ${res.error || 'unknown error'})`, type: res.ok ? 'success' : 'error' })
      } catch (err) {
        setToast({ message: `Cash recorded (ack failed: ${err.response?.data?.error || err.message})`, type: 'error' })
      }
    } catch (err) {
      setToast({ message: err.message, type: 'error' })
    } finally {
      setSavingCash(false)
    }
  }

  async function handleSyncRazorpay(bill) {
    setSyncingBillId(bill.id)
    try {
      const result = await syncRazorpayPayment(bill.id)
      if (result.success && (result.synced || result.alreadyPaid)) {
        setToast({ message: `Bill ${bill.id} marked paid ✓`, type: 'success' })
        loadBills()
      } else {
        setToast({ message: result.message || 'Not paid on Razorpay yet', type: 'info' })
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message, type: 'error' })
    }
    setSyncingBillId('')
  }

  // API-only — on failure, show an error toast and stop. Use "Manual" for the free wa.me fallback.
  async function handleReminder(bill) {
    try {
      const res = await sendTextViaApi('payment_reminder_t1', bill.id)
      setToast({ message: res.ok ? 'Reminder sent on WhatsApp ✓' : `Reminder failed: ${res.error || 'unknown error'} — use Manual`, type: res.ok ? 'success' : 'error' })
    } catch (err) {
      setToast({ message: `Reminder failed: ${err.response?.data?.error || err.message} — use Manual`, type: 'error' })
    }
  }

  // Manual fallback — free wa.me deep link, always available, never automatic.
  function handleReminderManual(bill) {
    const balance = formatCurrency(Number(bill.total_amount) - (paidMap[bill.id] || 0))
    const msg = buildPaymentDueMessage(bill.customers, balance, bill.razorpay_short_url)
    window.open(whatsappLink(bill.customers.whatsapp_no, msg), '_blank')
  }

  async function handleViewPdf(bill) {
    const { data: entries } = await supabase.from('daily_entries').select('*').eq('customer_id', bill.customer_id).gte('date', bill.period_start).lte('date', bill.period_end).order('date')
    openBillPdf(bill.customers, entries || [], bill)
  }

  async function handleSendBill(bill) {
    const { data: entries } = await supabase.from('daily_entries').select('*').eq('customer_id', bill.customer_id).gte('date', bill.period_start).lte('date', bill.period_end).order('date')
    const valid = billableEntries(entries || [])
    setToast({ message: `Sending ${bill.id}…`, type: 'success' })
    try {
      const res = await sendBillViaApi(bill.customers, valid, bill)
      if (res.ok) {
        setToast({ message: 'Bill sent on WhatsApp with PDF ✓', type: 'success' })
        loadBills()
      } else {
        setToast({ message: res.error || 'WhatsApp send failed — use Manual', type: 'error' })
      }
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message, type: 'error' })
    }
  }

  // wa.me fallback (free, manual attach)
  async function handleSendBillManual(bill) {
    const { data: entries } = await supabase.from('daily_entries').select('*').eq('customer_id', bill.customer_id).gte('date', bill.period_start).lte('date', bill.period_end).order('date')
    const valid = billableEntries(entries || [])
    const result = await shareBillOnWhatsApp(bill.customers, valid, bill, bill.razorpay_short_url)
    if (result.success && !result.cancelled) {
      await supabase.from('bills').update({ sent_at: new Date().toISOString() }).eq('id', bill.id)
      setToast({ message: result.attached ? 'Bill sent with PDF attached' : 'PDF downloaded — attach in WhatsApp', type: 'success' })
    }
  }

  const tabs = [{ key: 'all', label: 'All' }, { key: 'paid', label: 'Paid' }, { key: 'unpaid', label: 'Unpaid' }, { key: 'partial', label: 'Partial' }]

  function progressSubtitle() {
    if (!progress) return 'Please wait…'
    const action = progress.step === 'razorpay' ? 'Creating Razorpay link' : 'Generating bill'
    return `${action} for ${progress.name} (${progress.current}/${progress.total})`
  }

  const overlayTitle = running === 'razorpay'
    ? 'Creating Razorpay payment links…'
    : running === 'generate'
      ? 'Generating bills & payment links…'
      : ''

  return (
    <div className="space-y-4">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      {(running === 'generate' || running === 'razorpay') && (
        <LoadingOverlay title={overlayTitle} subtitle={progressSubtitle()} />
      )}

      <h1 className="text-2xl font-bold text-slate-800">Bills</h1>

      <div className="rounded-xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-white p-4">
        <h2 className="font-bold text-green-900">⚡ Monthly Automation</h2>
        <p className="mt-1 text-sm text-green-700">One-click workflow — no need to open each customer</p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-slate-500">Month</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 block rounded-lg border px-3 py-2" />
          </div>
        </div>

        {/* Main 2-step workflow */}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button onClick={runGenerateAll} disabled={!!running} className="rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50">
            {running === 'generate' ? 'Working...' : '1️⃣ Generate All Bills + Razorpay'}
          </button>
          <button onClick={runSendAllBills} disabled={!!running} className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50">
            {running === 'send' ? 'Sending...' : '2️⃣ Send All Bills (PDF + WhatsApp)'}
          </button>
        </div>

        {/* Razorpay repair/maintenance utilities — not part of the numbered flow above */}
        <div className="mt-3 border-t border-green-100 pt-3">
          <p className="mb-2 text-xs font-medium text-slate-500">Razorpay utilities — use only if needed</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button onClick={runRazorpayAll} disabled={!!running} title="Only creates links for bills that don't have one yet (e.g. step 1 failed for some customers)" className="rounded-xl border-2 border-blue-400 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-50">
              {running === 'razorpay' ? 'Working...' : '🔁 Retry Missing Razorpay Links'}
            </button>
            <button onClick={runSyncRazorpay} disabled={!!running} title="Check Razorpay for payments received this month and mark those bills paid" className="rounded-xl border-2 border-emerald-400 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50">
              {running === 'sync' ? 'Syncing...' : '🔄 Sync Razorpay Payments'}
            </button>
          </div>
        </div>

        {progress && (
          <p className="mt-3 text-sm text-slate-600 sr-only">
            {progressSubtitle()}
          </p>
        )}

        <p className="mt-3 text-xs text-slate-500">
          Step 3 opens a guided queue — one customer at a time. On phone, PDF attaches automatically.
        </p>

        {genSummary && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <p className="font-medium text-slate-700">Last generation summary</p>
            <p className="mt-1 text-slate-600">{formatGenerationSummary(genSummary)}</p>
            {genSummary.noDelivery?.length > 0 && (
              <p className="mt-1 text-xs text-slate-400">No delivery: {genSummary.noDelivery.slice(0, 5).join(', ')}{genSummary.noDelivery.length > 5 ? '...' : ''}</p>
            )}
            {genSummary.errors?.length > 0 && (
              <p className="mt-1 text-xs text-red-500">{genSummary.errors.map((e) => `${e.customer}: ${e.error}`).join('; ')}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <input
        type="search"
        placeholder="Search customer, ID or bill no…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg border px-4 py-2.5"
      />

      {loading ? (
        <p className="text-center text-slate-500">Loading...</p>
      ) : filteredBills().length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No bills for {month}. Click <strong>Generate All Bills</strong> above.
        </p>
      ) : (
        <div className="space-y-3">
          {filteredBills().map((bill) => (
            <div key={bill.id}>
              <BillCard bill={bill} paidAmount={paidMap[bill.id] || 0} onMarkCashPaid={openCashModal} onSendReminder={handleReminder} onSendReminderManual={handleReminderManual} onViewPdf={handleViewPdf} onSyncRazorpay={handleSyncRazorpay} syncing={syncingBillId === bill.id} />
              <div className="mt-1 flex items-center gap-3">
                <button onClick={() => handleSendBill(bill)} className="text-sm font-medium text-green-600 hover:underline">
                  📲 Send bill on WhatsApp
                </button>
                <button onClick={() => handleSendBillManual(bill)} className="text-xs text-slate-400 hover:underline">
                  Manual
                </button>
                {bill.sent_at && <span className="text-xs text-slate-400">sent {formatDate(bill.sent_at.slice(0, 10))}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {sendQueue && (
        <WhatsAppSendQueue
          packages={sendQueue}
          onClose={() => setSendQueue(null)}
          onComplete={({ sent, total }) => {
            setToast({ message: `Sent ${sent} of ${total} bills`, type: 'success' })
            loadBills()
          }}
        />
      )}

      {cashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">Mark Cash Paid</h2>
            <p className="text-sm text-slate-500">{cashModal.customers?.name} · {cashModal.id}</p>
            <label className="mt-4 block text-xs text-slate-500">Amount</label>
            <input type="number" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
            <label className="mt-3 block text-xs text-slate-500">Payment Date</label>
            <input type="date" value={cashPaidAt} onChange={(e) => setCashPaidAt(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" />
            <div className="mt-4 flex gap-2">
              <button onClick={confirmCashPayment} disabled={savingCash} className="flex-1 rounded-lg bg-green-600 py-2 text-white disabled:opacity-50">{savingCash ? 'Saving…' : 'Confirm'}</button>
              <button onClick={() => setCashModal(null)} disabled={savingCash} className="flex-1 rounded-lg border py-2 disabled:opacity-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
