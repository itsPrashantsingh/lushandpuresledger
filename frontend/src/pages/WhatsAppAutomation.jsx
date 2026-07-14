import { useCallback, useEffect, useState } from 'react'
import Toast from '../components/Toast'
import { formatCurrency, currentYearMonth } from '../lib/utils'
import {
  getAutomationConfig,
  updateAutomationConfig,
  getWhatsappSummary,
  emailBillsReport
} from '../lib/whatsapp-api'

const REMINDER_TEMPLATES = [
  { value: 'payment_reminder_t1', label: 'Reminder 1 (gentle)' },
  { value: 'payment_reminder_t2', label: 'Reminder 2 (firm)' },
  { value: 'supply_cutoff', label: 'Supply cut-off warning' }
]

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-green-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

function Stat({ label, value, color = 'slate' }) {
  const colors = {
    slate: 'text-slate-800', green: 'text-green-700', blue: 'text-blue-700',
    amber: 'text-amber-700', red: 'text-red-700', violet: 'text-violet-700'
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${colors[color]}`}>{value}</p>
    </div>
  )
}

export default function WhatsAppAutomation() {
  const [config, setConfig] = useState(null)
  const [summary, setSummary] = useState(null)
  const [month, setMonth] = useState(currentYearMonth())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [toast, setToast] = useState({ message: '', type: 'success' })

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getWhatsappSummary(month))
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message, type: 'error' })
    }
  }, [month])

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        setConfig(await getAutomationConfig())
      } catch (err) {
        setToast({ message: err.response?.data?.error || err.message || 'Backend unreachable', type: 'error' })
      }
      setLoading(false)
    })()
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])

  function patch(field, value) {
    setConfig((c) => ({ ...c, [field]: value }))
  }

  function updateTier(i, field, value) {
    setConfig((c) => {
      const tiers = [...(c.reminder_tiers || [])]
      tiers[i] = { ...tiers[i], [field]: field === 'days' ? Number(value) : value }
      return { ...c, reminder_tiers: tiers }
    })
  }
  function addTier() {
    setConfig((c) => ({ ...c, reminder_tiers: [...(c.reminder_tiers || []), { days: 7, template: 'payment_reminder_t1', label: 'Reminder' }] }))
  }
  function removeTier(i) {
    setConfig((c) => ({ ...c, reminder_tiers: (c.reminder_tiers || []).filter((_, idx) => idx !== i) }))
  }

  async function save() {
    setSaving(true)
    try {
      const saved = await updateAutomationConfig(config)
      setConfig(saved)
      setToast({ message: 'Automation settings saved', type: 'success' })
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message, type: 'error' })
    }
    setSaving(false)
  }

  async function emailNow() {
    setEmailing(true)
    try {
      const res = await emailBillsReport(month)
      setToast({ message: res.ok ? `Emailed ${res.count || ''} bills to ${res.to}` : (res.error || 'Email failed'), type: res.ok ? 'success' : 'error' })
      loadSummary()
    } catch (err) {
      setToast({ message: err.response?.data?.error || err.message, type: 'error' })
    }
    setEmailing(false)
  }

  if (loading) return <div className="py-12 text-center text-slate-500">Loading automation…</div>
  if (!config) return <div className="py-12 text-center text-red-500">Could not load automation config. Is the backend running?</div>

  const bal = summary?.balance
  const m = summary?.messages || {}

  return (
    <div className="space-y-5 pb-8">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">WhatsApp Automation</h1>
          <p className="text-sm text-slate-500">Schedule bills, reminders & acknowledgements — all via the API</p>
        </div>
        <div className="flex items-center gap-2">
          {bal && bal.balance != null && (
            <span className="rounded-full bg-green-100 px-3 py-1.5 text-sm font-semibold text-green-800">
              Wallet: {formatCurrency(bal.balance)}
            </span>
          )}
          {bal && bal.balance == null && (
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800" title={bal.error}>
              Wallet: n/a
            </span>
          )}
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border px-3 py-1.5 text-sm" />
        </div>
      </div>

      {/* ── Health summary ─────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">This month</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Bills generated" value={summary?.bills?.generated ?? '—'} color="slate" />
          <Stat label="Bills sent" value={m.billsSent ?? '—'} color="green" />
          <Stat label="Delivered" value={m.delivered ?? '—'} color="blue" />
          <Stat label="Read" value={m.read ?? '—'} color="violet" />
          <Stat label="Reminders" value={m.reminders ?? '—'} color="amber" />
          <Stat label="Failed" value={m.failed ?? '—'} color="red" />
        </div>
      </section>

      {/* ── Razorpay auto-sync ──────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <Toggle
          checked={config.razorpay_reconcile_enabled}
          onChange={(v) => patch('razorpay_reconcile_enabled', v)}
          label="Auto-sync Razorpay payments"
          hint="Runs with the daily cron — checks every unpaid bill with a Razorpay link and marks it paid if collected. No manual sync needed once the cron is running."
        />
      </section>

      {/* ── Bill scheduler ─────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <Toggle
          checked={config.scheduler_enabled}
          onChange={(v) => patch('scheduler_enabled', v)}
          label="Auto-generate & send bills"
          hint="Runs on the days below each month"
        />
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-slate-500">Generate bills on day</span>
            <input type="number" min="1" max="28" value={config.bill_generation_day}
              onChange={(e) => patch('bill_generation_day', Number(e.target.value))}
              className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="text-slate-500">Send bills on day</span>
            <input type="number" min="1" max="28" value={config.bill_send_day}
              onChange={(e) => patch('bill_send_day', Number(e.target.value))}
              className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
        </div>
      </section>

      {/* ── Reminders ──────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <Toggle
          checked={config.reminders_enabled}
          onChange={(v) => patch('reminders_enabled', v)}
          label="Auto payment reminders"
          hint="Tiered reminders based on days overdue (7-day grace after period end)"
        />
        <div className="mt-3 space-y-2">
          {(config.reminder_tiers || []).map((tier, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2">
              <span className="text-xs text-slate-500">After</span>
              <input type="number" min="1" value={tier.days} onChange={(e) => updateTier(i, 'days', e.target.value)}
                className="w-16 rounded border px-2 py-1 text-sm" />
              <span className="text-xs text-slate-500">days →</span>
              <select value={tier.template} onChange={(e) => updateTier(i, 'template', e.target.value)}
                className="rounded border px-2 py-1 text-sm">
                {REMINDER_TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input value={tier.label || ''} onChange={(e) => updateTier(i, 'label', e.target.value)}
                placeholder="Label" className="flex-1 rounded border px-2 py-1 text-sm" />
              <button type="button" onClick={() => removeTier(i)} className="text-xs text-red-600 hover:underline">Remove</button>
            </div>
          ))}
          <button type="button" onClick={addTier} className="text-sm text-green-600 hover:underline">+ Add reminder tier</button>
        </div>
        <label className="mt-3 block text-sm">
          <span className="text-slate-500">Supply cut-off after (days overdue)</span>
          <input type="number" min="1" value={config.cutoff_days}
            onChange={(e) => patch('cutoff_days', Number(e.target.value))}
            className="mt-1 w-32 rounded-lg border px-3 py-2" />
        </label>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <Toggle
            checked={config.carryforward_enabled}
            onChange={(v) => patch('carryforward_enabled', v)}
            label="Carry forward unpaid months"
            hint="After the ladder ends, keep reminding “unpaid from {month}” with that month's pay link, until paid"
          />
          <label className="mt-2 block text-sm">
            <span className="text-slate-500">Repeat every (days)</span>
            <input type="number" min="1" value={config.carryforward_interval_days ?? 7}
              onChange={(e) => patch('carryforward_interval_days', Number(e.target.value))}
              className="mt-1 w-32 rounded-lg border px-3 py-2" />
          </label>
        </div>
      </section>

      {/* ── Acknowledgements ───────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Payment acknowledgements</h2>
        <Toggle checked={config.cash_ack_enabled} onChange={(v) => patch('cash_ack_enabled', v)}
          label="Auto-send on cash payment" hint="Sends a confirmation when a cash payment is recorded" />
        <Toggle checked={config.razorpay_ack_enabled} onChange={(v) => patch('razorpay_ack_enabled', v)}
          label="Auto-send on Razorpay payment" hint="Sends a confirmation when a Razorpay payment syncs" />
      </section>

      {/* ── Email report ───────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <Toggle checked={config.email_report_enabled} onChange={(v) => patch('email_report_enabled', v)}
          label="Email month's bills to me" hint="Emails every generated bill PDF to the address below when bills are sent" />
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex-1 text-sm">
            <span className="text-slate-500">Recipient email</span>
            <input type="email" value={config.report_email || ''} onChange={(e) => patch('report_email', e.target.value)}
              placeholder="you@example.com" className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
          <button type="button" onClick={emailNow} disabled={emailing}
            className="rounded-lg border-2 border-blue-400 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50">
            {emailing ? 'Emailing…' : `Email ${month} bills now`}
          </button>
        </div>
      </section>

      {/* ── Failures panel ─────────────────────────────── */}
      {summary?.failures?.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-red-700">Delivery problems this month ({summary.failures.length})</h2>
          <div className="space-y-1">
            {summary.failures.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-800">{f.customers?.name || f.to_phone || 'Unknown'}</span>
                  <span className="ml-2 text-xs text-slate-400">{f.message_type}</span>
                </span>
                <span className="text-xs text-red-600">{f.error || 'Failed / invalid number'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Recent automation runs ─────────────────────── */}
      {summary?.recentRuns?.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent automation runs</h2>
          <div className="space-y-1 text-sm">
            {summary.recentRuns.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <span className="font-medium capitalize text-slate-700">{r.run_type.replace(/_/g, ' ')}</span>
                <span className="text-xs text-slate-500">{JSON.stringify(r.counts)}</span>
                <span className="text-xs text-slate-400">{new Date(r.ran_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Save bar */}
      <div className="sticky bottom-16 z-30 md:bottom-0">
        <button onClick={save} disabled={saving}
          className="w-full rounded-xl bg-green-600 py-3 text-sm font-bold text-white shadow-lg hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Automation Settings'}
        </button>
      </div>
    </div>
  )
}
