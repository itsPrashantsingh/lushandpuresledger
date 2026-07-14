import { useState } from 'react'
import { shareBillOnWhatsApp } from '../lib/whatsapp'
import { sendBillViaApi } from '../lib/whatsapp-api'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'

/**
 * WhatsApp send queue. Two modes:
 *  - Auto-send all via the API (no WhatsApp app, PDF attached server-side).
 *  - Guided one-by-one wa.me fallback (free, manual attach).
 */
export default function WhatsAppSendQueue({ packages, onClose, onComplete }) {
  const [index, setIndex] = useState(0)
  const [sent, setSent] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [auto, setAuto] = useState({ running: false, done: 0, sent: 0, failed: 0 })

  if (!packages?.length) return null

  async function autoSendAll() {
    setAuto({ running: true, done: 0, sent: 0, failed: 0 })
    let ok = 0
    let fail = 0
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i]
      try {
        const res = await sendBillViaApi(pkg.customer, pkg.entries, pkg.bill)
        if (res.ok) ok++
        else fail++
      } catch {
        fail++
      }
      setAuto({ running: true, done: i + 1, sent: ok, failed: fail })
    }
    onComplete?.({ sent: ok, skipped: fail, total: packages.length })
    onClose()
  }

  const current = packages[index]
  const isLast = index >= packages.length - 1

  async function sendCurrent() {
    const result = await shareBillOnWhatsApp(
      current.customer,
      current.entries,
      current.bill,
      current.razorpayUrl
    )

    if (result.success && !result.cancelled) {
      await supabase.from('bills').update({ sent_at: new Date().toISOString() }).eq('id', current.bill.id)
      setSent((s) => s + 1)
    } else if (result.cancelled) {
      setSkipped((s) => s + 1)
    }

    if (isLast) {
      onComplete?.({ sent: sent + (result.success && !result.cancelled ? 1 : 0), skipped, total: packages.length })
      onClose()
    } else {
      setIndex((i) => i + 1)
    }
  }

  function skipCurrent() {
    setSkipped((s) => s + 1)
    if (isLast) {
      onComplete?.({ sent, skipped: skipped + 1, total: packages.length })
      onClose()
    } else {
      setIndex((i) => i + 1)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {/* Auto-send all via API */}
        <div className="mb-4 rounded-xl border-2 border-green-200 bg-green-50 p-3">
          <p className="text-sm font-semibold text-green-900">⚡ Auto-send all {packages.length} bills</p>
          <p className="mt-0.5 text-xs text-green-700">Via WhatsApp API — PDF attached, no app needed.</p>
          {auto.running ? (
            <p className="mt-2 text-sm font-medium text-slate-700">
              Sending {auto.done}/{packages.length} · {auto.sent} sent · {auto.failed} failed…
            </p>
          ) : (
            <button onClick={autoSendAll} className="mt-2 w-full rounded-lg bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700">
              Auto-send all now
            </button>
          )}
        </div>

        <p className="text-center text-xs text-slate-400">— or send manually one by one —</p>

        <p className="mt-3 text-xs font-medium text-slate-500">
          Send bill {index + 1} of {packages.length}
        </p>
        <h2 className="mt-1 text-xl font-bold text-slate-800">{current.customer?.name}</h2>
        <p className="text-lg font-semibold text-green-700">{formatCurrency(current.bill.total_amount)}</p>
        {current.bill.razorpay_short_url && (
          <p className="mt-1 truncate text-xs text-blue-600">Payment link included in message</p>
        )}

        <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium">📱 On phone:</p>
          <p>Tap Send — PDF attaches automatically via share sheet.</p>
          <p className="mt-2 font-medium">💻 On computer:</p>
          <p>PDF downloads → attach it in the WhatsApp chat that opens.</p>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={sendCurrent} className="flex-1 rounded-xl bg-green-600 py-3 font-bold text-white hover:bg-green-700">
            {isLast ? 'Send & Finish' : 'Send & Next →'}
          </button>
          <button onClick={skipCurrent} className="rounded-xl border px-4 py-3 text-sm text-slate-600 hover:bg-slate-50">
            Skip
          </button>
        </div>
        <button onClick={onClose} className="mt-3 w-full text-center text-sm text-slate-400 hover:text-slate-600">
          Cancel queue
        </button>
      </div>
    </div>
  )
}
