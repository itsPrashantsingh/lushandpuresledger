import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { getSettings, saveSettings } from '../lib/constants'

export default function Settings() {
  const [form, setForm] = useState(getSettings())
  const [saved, setSaved] = useState(false)

  function handleSave(e) {
    e.preventDefault()
    saveSettings(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Business Settings</h1>
        <p className="text-sm text-slate-500">Used on GST invoices and bills</p>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <input required placeholder="Dairy Name" value={form.dairyName} onChange={(e) => setForm({ ...form, dairyName: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
        <input required placeholder="Phone" value={form.dairyPhone} onChange={(e) => setForm({ ...form, dairyPhone: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
        <input placeholder="UPI ID" value={form.dairyUpi} onChange={(e) => setForm({ ...form, dairyUpi: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
        <textarea placeholder="Full Address (for invoice)" value={form.dairyAddress} onChange={(e) => setForm({ ...form, dairyAddress: e.target.value })} className="w-full rounded-lg border px-3 py-2" rows={2} />
        <input placeholder="GSTIN (15 chars)" value={form.dairyGstin} onChange={(e) => setForm({ ...form, dairyGstin: e.target.value.toUpperCase() })} className="w-full rounded-lg border px-3 py-2" maxLength={15} />
        <input placeholder="State (Place of Supply)" value={form.dairyState} onChange={(e) => setForm({ ...form, dairyState: e.target.value })} className="w-full rounded-lg border px-3 py-2" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500">GST Rate % (0 = exempt milk)</label>
            <input type="number" step="0.01" value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </div>
          <div>
            <label className="text-xs text-slate-500">HSN Code</label>
            <input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </div>
        </div>

        <button type="submit" className="w-full rounded-lg bg-green-600 py-2.5 font-medium text-white hover:bg-green-700">
          Save Settings
        </button>
        {saved && <p className="text-center text-sm text-green-600">Settings saved ✓</p>}
      </form>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">How Razorpay works</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-blue-800">
          <li>Generate monthly bills (Bills page → one click)</li>
          <li>App calls your backend → Razorpay creates a payment link per bill</li>
          <li>Link is saved on the bill and embedded in PDF + WhatsApp</li>
          <li>Customer pays → Razorpay webhook marks bill paid automatically</li>
        </ol>
        <p className="mt-2 text-xs text-blue-600">Backend must be running with Razorpay keys in backend/.env</p>
      </div>
    </div>
  )
}
