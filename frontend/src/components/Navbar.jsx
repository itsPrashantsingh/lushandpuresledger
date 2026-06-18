import { NavLink } from 'react-router-dom'
import { DAIRY_NAME } from '../lib/constants'
import { useAuth } from '../lib/auth'

const links = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/daily-entry', label: 'Daily Entry', icon: '🥛' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/bills', label: 'Bills', icon: '🧾' },
  { to: '/expenses', label: 'Expenses', icon: '💸' },
  { to: '/reminders', label: 'Reminders', icon: '🔔' },
  { to: '/import-export', label: 'Import/Export', icon: '📁' },
  { to: '/settings', label: 'Settings', icon: '⚙️' }
]

const navClass = ({ isActive }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-green-600 text-white'
      : 'text-slate-600 hover:bg-slate-100'
  }`

export default function Navbar() {
  const { user, logout } = useAuth()

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // session cleared on next navigation
    }
  }

  return (
    <>
      <aside className="hidden md:fixed md:inset-y-0 md:flex md:w-56 md:flex-col md:border-r md:border-slate-200 md:bg-white md:px-4 md:py-6">
        <h1 className="mb-6 px-2 text-lg font-bold text-green-700">{DAIRY_NAME}</h1>
        <nav className="flex flex-col gap-1">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === '/'} className={navClass}>
              <span>{link.icon}</span>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-slate-200 pt-4">
          <p className="truncate px-2 text-xs text-slate-400">{user?.email}</p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100"
          >
            Sign out
          </button>
        </div>
      </aside>

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-slate-200 bg-white md:hidden">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center py-2 text-[10px] ${
                isActive ? 'text-green-600' : 'text-slate-500'
              }`
            }
          >
            <span className="text-lg">{link.icon}</span>
            <span className="mt-0.5 truncate px-0.5">{link.label.split(' ')[0]}</span>
          </NavLink>
        ))}
      </nav>
    </>
  )
}
