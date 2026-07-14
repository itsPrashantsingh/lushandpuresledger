import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Toast from '../components/Toast'
import { formatCurrency, whatsappLink, isOverdue } from '../lib/utils'
import { getPaidAmountsForBills } from '../lib/bills'
import { buildReminderMessage } from '../lib/messages'
import { sendTextViaApi } from '../lib/whatsapp-api'
import { Link } from 'react-router-dom'

export default function Reminders() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState(null)
  const [toast, setToast] = useState({ message: '', type: 'success' })
  const [onlyOverdue, setOnlyOverdue] = useState(true)

  useEffect(() => {
    loadOverdue()
  }, [onlyOverdue])

  async function loadOverdue() {
    setLoading(true)
    const { data: bills } = await supabase.from('bills').select('*, customers(*)').eq('paid', false)
    const paidMap = await getPaidAmountsForBills((bills || []).map((b) => b.id))

    const map = {}
    for (const bill of bills || []) {
      const paid = paidMap[bill.id] || 0
      const balance = Number(bill.total_amount) - paid
      if (balance <= 0) continue
      if (onlyOverdue && !isOverdue(bill)) continue

      const cid = bill.customer_id
      if (!map[cid]) {
        map[cid] = { customer: bill.customers, totalDue: 0, razorpayUrl: bill.razorpay_short_url || '', bills: [] }
      }
      map[cid].totalDue += balance
      map[cid].bills.push(bill)
      if (bill.razorpay_short_url) map[cid].razorpayUrl = bill.razorpay_short_url
    }

    setItems(Object.values(map))
    setLoading(false)
  }

  // Primary: send one API reminder per pending bill (each month keeps its own pay link).
  async function sendReminder(item) {
    setSending(true)
    let ok = 0
    let fail = 0
    for (const bill of item.bills) {
      try {
        const res = await sendTextViaApi('payment_reminder_t1', bill.id)
        if (res.ok) ok++
        else fail++
      } catch {
        fail++
      }
    }
    setSending(false)
    if (ok && !fail) setToast({ message: `Reminder sent to ${item.customer.name} (${ok} bill${ok > 1 ? 's' : ''}) ✓`, type: 'success' })
    else if (ok) setToast({ message: `${item.customer.name}: ${ok} sent, ${fail} failed`, type: 'error' })
    else setToast({ message: `${item.customer.name}: send failed — try Manual`, type: 'error' })
  }

  // Fallback: free wa.me, one message with the customer's total due.
  function sendReminderManual(item) {
    const msg = buildReminderMessage(item.customer, item.totalDue, item.razorpayUrl)
    window.open(whatsappLink(item.customer.whatsapp_no, msg), '_blank')
    supabase.from('reminders').insert({ customer_id: item.customer.id, message: msg, sent_at: new Date().toISOString() })
  }

  async function sendAllEligible() {
    if (!items.length) return
    setSending(true)
    let ok = 0
    let fail = 0
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      setProgress({ current: i + 1, total: items.length, name: item.customer.name })
      for (const bill of item.bills) {
        try {
          const res = await sendTextViaApi('payment_reminder_t1', bill.id)
          if (res.ok) ok++
          else fail++
        } catch {
          fail++
        }
      }
    }
    setSending(false)
    setProgress(null)
    setToast({ message: `Reminders sent via API — ${ok} ok${fail ? `, ${fail} failed` : ''}`, type: fail ? 'error' : 'success' })
  }

  return (
    <div className="space-y-4">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      <h1 className="text-2xl font-bold text-slate-800">Payment Reminders</h1>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} className="rounded" />
          Only overdue bills (7+ days past period end)
        </label>
        {items.length > 0 && (
          <button onClick={sendAllEligible} disabled={sending} className="mt-3 w-full rounded-xl bg-amber-500 py-3 font-bold text-white hover:bg-amber-600 disabled:opacity-50 sm:w-auto sm:px-8">
            {sending ? `Sending ${progress?.current}/${progress?.total}...` : `📲 Send All via API (${items.length})`}
          </button>
        )}
        {progress && <p className="mt-2 text-sm text-amber-800">Reminding {progress.name}...</p>}
      </div>

      <p className="text-sm text-slate-500">
        Reminder cadence & carry-forward are automated in <Link to="/whatsapp" className="text-green-600 hover:underline">WhatsApp Automation</Link>.
        Manual message text is in <Link to="/settings" className="text-green-600 hover:underline">Settings → WhatsApp Messages</Link>.
      </p>

      {loading ? (
        <p className="text-center text-slate-500">Loading...</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-green-200 bg-green-50 p-6 text-center text-green-700">No eligible reminders 🎉</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.customer.id} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-4">
              <div>
                <h3 className="font-semibold">{item.customer.name}</h3>
                <p className="font-bold text-red-600">{formatCurrency(item.totalDue)} due</p>
                <p className="text-xs text-slate-400">{item.bills.length} pending bill{item.bills.length > 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => sendReminder(item)} disabled={sending} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">Send</button>
                <button onClick={() => sendReminderManual(item)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Manual</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
