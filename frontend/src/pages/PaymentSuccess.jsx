import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { confirmRazorpayPayment } from '../lib/bills'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export default function PaymentSuccess() {
  const [params] = useSearchParams()
  const [status, setStatus] = useState('syncing')
  const [message, setMessage] = useState('Confirming your payment...')

  const billId = params.get('razorpay_payment_link_reference_id')
  const linkStatus = params.get('razorpay_payment_link_status')
  const paymentId = params.get('razorpay_payment_id')
  const linkId = params.get('razorpay_payment_link_id')
  const signature = params.get('razorpay_signature')

  useEffect(() => {
    async function confirmWithRetries() {
      if (!billId) {
        setStatus('done')
        setMessage('Payment received. Thank you!')
        return
      }

      const callbackPayload = {
        billId,
        razorpay_payment_id: paymentId,
        razorpay_payment_link_id: linkId,
        razorpay_payment_link_reference_id: billId,
        razorpay_payment_link_status: linkStatus,
        razorpay_signature: signature
      }

      const maxAttempts = 5
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const result = await confirmRazorpayPayment(callbackPayload)

          if (result.success && (result.synced || result.alreadyPaid)) {
            setStatus('done')
            setMessage('Payment confirmed! Your bill has been marked paid.')
            return
          }

          if (linkStatus === 'paid' && attempt < maxAttempts) {
            setMessage(`Confirming payment... (attempt ${attempt}/${maxAttempts})`)
            await sleep(2000)
            continue
          }

          setStatus('pending')
          setMessage(result.message || 'Payment received — your bill will update shortly.')
          return
        } catch {
          if (attempt < maxAttempts) {
            setMessage(`Confirming payment... (attempt ${attempt}/${maxAttempts})`)
            await sleep(2000)
          }
        }
      }

      setStatus('pending')
      setMessage('Payment received on Razorpay. Open the dairy portal — it will sync automatically.')
    }

    confirmWithRetries()
  }, [billId, linkStatus, paymentId, linkId, signature])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-4xl">{status === 'syncing' ? '⏳' : status === 'done' ? '✅' : '🔄'}</p>
        <h1 className="mt-4 text-2xl font-bold text-green-700">Payment Successful!</h1>
        <p className="mt-2 text-slate-600">{message}</p>
        {billId && <p className="mt-2 text-xs text-slate-400">Bill: {billId}</p>}
        <Link to="/login" className="mt-6 inline-block text-sm text-green-600 hover:underline">
          Back to dairy portal →
        </Link>
      </div>
    </div>
  )
}
