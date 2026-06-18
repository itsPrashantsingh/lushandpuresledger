import { useEffect } from 'react'

export default function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [message, onClose])

  if (!message) return null

  const styles = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-blue-600 text-white'
  }

  return (
    <div className="fixed left-4 right-4 top-4 z-[100] flex justify-center md:left-auto md:right-6 md:top-6">
      <div className={`flex max-w-md items-center gap-3 rounded-xl px-5 py-3 shadow-lg ${styles[type]}`}>
        <span className="text-lg">{type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
        <p className="flex-1 text-sm font-medium">{message}</p>
        <button onClick={onClose} className="opacity-80 hover:opacity-100">✕</button>
      </div>
    </div>
  )
}
