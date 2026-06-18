import { useState } from 'react'
import { shareBillOnWhatsApp } from '../lib/whatsapp'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/utils'

/**
 * Guided one-by-one WhatsApp send queue.
 * On mobile each step opens share sheet with PDF auto-attached.
 */
export default function WhatsAppSendQueue({ packages, onClose, onComplete }) {
  const [index, setIndex] = useState(0)
  const [sent, setSent] = useState(0)
  const [skipped, setSkipped] = useState(0)

  if (!packages?.length) return null

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
        <p className="text-xs font-medium text-slate-500">
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
