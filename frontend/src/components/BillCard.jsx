import { formatCurrency, formatPeriod, formatDate, statusBadgeClass, getBillStatus } from '../lib/utils'

export default function BillCard({
  bill,
  paidAmount = 0,
  onMarkCashPaid,
  onSendReminder,
  onViewPdf,
  onSyncRazorpay,
  syncing = false
}) {
  const status = getBillStatus(bill, paidAmount)
  const balance = Number(bill.total_amount) - paidAmount
  const overdue = !bill.paid && status !== 'paid' && (() => {
    const end = new Date(bill.period_end + 'T00:00:00')
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return Math.floor((now - end) / (1000 * 60 * 60 * 24)) > 7
  })()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">{bill.customers?.name || 'Customer'}</h3>
          {bill.customers?.customer_id && <p className="text-xs font-mono text-slate-400">{bill.customers.customer_id}</p>}
          <p className="text-sm text-slate-500">{bill.id} · {formatPeriod(bill.period_start, bill.period_end)}</p>
          {Number(bill.buttermilk_subtotal) > 0 && (
            <p className="text-xs text-purple-600">+ Buttermilk {formatCurrency(bill.buttermilk_subtotal)}</p>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(status)}`}>
          {status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        <span className="font-bold text-slate-800">{formatCurrency(bill.total_amount)}</span>
        {status === 'partial' && (
          <span className="text-amber-600">Balance: {formatCurrency(balance)}</span>
        )}
        {overdue && <span className="text-red-600 font-medium">Overdue</span>}
        {bill.paid && bill.paid_at && (
          <span className="text-green-600">
            Paid {formatDate(bill.paid_at.slice(0, 10))} · {bill.payment_mode?.toUpperCase()}
          </span>
        )}
      </div>

      {status !== 'paid' && (
        <div className="mt-4 flex flex-wrap gap-2">
          {bill.razorpay_link_id && (
            <button
              onClick={() => onSyncRazorpay?.(bill)}
              disabled={syncing}
              className="rounded-lg border border-blue-400 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            >
              {syncing ? 'Checking...' : 'Sync Razorpay Payment'}
            </button>
          )}
          <button
            onClick={() => onMarkCashPaid?.(bill)}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
          >
            Mark Cash Paid
          </button>
          <button
            onClick={() => onSendReminder?.(bill)}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
          >
            Send Reminder
          </button>
          <button
            onClick={() => onViewPdf?.(bill)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            View Bill PDF
          </button>
        </div>
      )}

      {status === 'paid' && (
        <div className="mt-4">
          <button
            onClick={() => onViewPdf?.(bill)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            View Bill PDF
          </button>
        </div>
      )}
    </div>
  )
}
