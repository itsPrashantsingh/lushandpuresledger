import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return children
}
