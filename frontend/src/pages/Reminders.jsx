import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Toast from '../components/Toast'
import { formatCurrency, whatsappLink, isOverdue } from '../lib/utils'
import { getPaidAmountsForBills } from '../lib/bills'
import { getSettings } from '../lib/constants'

export default function Reminders() {
  const [items, setItems] = useState([])
  const [template, setTemplate] = useState(
    'Hi {name} bhai, aapka {month} ka milk bill ₹{amount} abhi pending hai.\nPlease pay karo: {razorpayUrl}\n— {dairyName} 🥛'
  )
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

  function fillTemplate(item) {
    const dairy = getSettings()
    const month = new Date().toLocaleDateString('en-IN', { month: 'long' })
    return template
      .replace('{name}', item.customer.name)
      .replace('{month}', month)
      .replace('{amount}', Number(item.totalDue).toLocaleString('en-IN'))
      .replace('{razorpayUrl}', item.razorpayUrl || 'cash/UPI')
      .replace('{dairyName}', dairy.dairyName)
  }

  function sendOne(item) {
    const msg = fillTemplate(item)
    window.open(whatsappLink(item.customer.whatsapp_no, msg), '_blank')
    supabase.from('reminders').insert({ customer_id: item.customer.id, message: msg, sent_at: new Date().toISOString() })
  }

  async function sendAllEligible() {
    if (!items.length) return
    setSending(true)

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      setProgress({ current: i + 1, total: items.length, name: item.customer.name })
      sendOne(item)
      if (i < items.length - 1) await new Promise((r) => setTimeout(r, 2000))
    }

    setSending(false)
    setProgress(null)
    setToast({ message: `Opened WhatsApp for ${items.length} eligible customers`, type: 'success' })
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
            {sending ? `Sending ${progress?.current}/${progress?.total}...` : `📲 Send All Eligible (${items.length})`}
          </button>
        )}
        {progress && <p className="mt-2 text-sm text-amber-800">Opening WhatsApp for {progress.name}...</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Message Template</h2>
        <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={4} className="w-full rounded-lg border px-3 py-2 text-sm" />
        <p className="mt-1 text-xs text-slate-400">{'{name}'} {'{month}'} {'{amount}'} {'{razorpayUrl}'} {'{dairyName}'}</p>
      </div>

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
              </div>
              <button onClick={() => sendOne(item)} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">Send</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
