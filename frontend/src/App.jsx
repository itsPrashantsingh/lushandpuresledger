import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Dashboard from './pages/Dashboard'
import DailyEntry from './pages/DailyEntry'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import Bills from './pages/Bills'
import Expenses from './pages/Expenses'
import Reminders from './pages/Reminders'
import ImportExport from './pages/ImportExport'
import Settings from './pages/Settings'

function PaymentSuccess() {
  return (
    <div className="py-12 text-center">
      <p className="text-4xl">✅</p>
      <h1 className="mt-4 text-2xl font-bold text-green-700">Payment Successful!</h1>
      <p className="mt-2 text-slate-500">Thank you for your payment.</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <Navbar />
        <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:ml-56 md:pb-8 md:pt-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/daily-entry" element={<DailyEntry />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/bills" element={<Bills />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/reminders" element={<Reminders />} />
            <Route path="/import-export" element={<ImportExport />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
