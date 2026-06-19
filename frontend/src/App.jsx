import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import ProtectedRoute from './components/ProtectedRoute'
import Navbar from './components/Navbar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Cattle from './pages/Cattle'
import CattleDetail from './pages/CattleDetail'
import MilkProduction from './pages/MilkProduction'
import DailyEntry from './pages/DailyEntry'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import Bills from './pages/Bills'
import Expenses from './pages/Expenses'
import Reminders from './pages/Reminders'
import ImportExport from './pages/ImportExport'
import Settings from './pages/Settings'
import PaymentSuccess from './pages/PaymentSuccess'

function AppLayout({ children }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:ml-56 md:pb-8 md:pt-8">
        {children}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/payment-success" element={<PaymentSuccess />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/milk-production" element={<MilkProduction />} />
                    <Route path="/cattle" element={<Cattle />} />
                    <Route path="/cattle/:id" element={<CattleDetail />} />
                    <Route path="/daily-entry" element={<DailyEntry />} />
                    <Route path="/customers" element={<Customers />} />
                    <Route path="/customers/:id" element={<CustomerDetail />} />
                    <Route path="/bills" element={<Bills />} />
                    <Route path="/expenses" element={<Expenses />} />
                    <Route path="/reminders" element={<Reminders />} />
                    <Route path="/import-export" element={<ImportExport />} />
                    <Route path="/settings" element={<Settings />} />
                  </Routes>
                </AppLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
