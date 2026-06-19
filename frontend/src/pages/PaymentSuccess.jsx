import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { syncRazorpayPayment } from '../lib/bills'

export default function PaymentSuccess() {
  const [params] = useSearchParams()
  const [status, setStatus] = useState('syncing')
  const [message, setMessage] = useState('Confirming your payment...')

  const billId = params.get('razorpay_payment_link_reference_id')
  const linkStatus = params.get('razorpay_payment_link_status')

  useEffect(() => {
    async function confirm() {
      if (!billId) {
        setStatus('done')
        setMessage('Payment received. Thank you!')
        return
      }

      if (linkStatus && linkStatus !== 'paid') {
        setStatus('pending')
        setMessage(`Payment status: ${linkStatus}. We will update your bill when payment clears.`)
        return
      }

      try {
        const result = await syncRazorpayPayment(billId, { publicConfirm: true })
        if (result.success && (result.synced || result.alreadyPaid)) {
          setStatus('done')
          setMessage('Payment confirmed! Your bill has been marked paid.')
        } else {
          setStatus('pending')
          setMessage(result.message || 'Payment received — bill will update shortly.')
        }
      } catch (err) {
        setStatus('pending')
        setMessage('Payment received on Razorpay. Bill will update automatically.')
      }
    }

    confirm()
  }, [billId, linkStatus])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-4xl">{status === 'syncing' ? '⏳' : '✅'}</p>
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
