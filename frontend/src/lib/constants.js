const DEFAULTS = {
  dairyName: 'FreshMilk Dairy',
  dairyPhone: '9876543210',
  dairyUpi: 'freshmilk@upi',
  dairyAddress: 'Your dairy address, City, State - PIN',
  dairyGstin: '',
  dairyState: 'Uttar Pradesh',
  gstRate: 0,
  hsnCode: '0401'
}

export function getSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('dairy_settings') || '{}')
    return { ...DEFAULTS, ...saved }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings) {
  localStorage.setItem('dairy_settings', JSON.stringify({ ...getSettings(), ...settings }))
}

export function getDairyInfo() {
  const s = getSettings()
  return {
    name: s.dairyName,
    phone: s.dairyPhone,
    upi: s.dairyUpi,
    address: s.dairyAddress,
    gstin: s.dairyGstin,
    state: s.dairyState,
    gstRate: Number(s.gstRate) || 0,
    hsnCode: s.hsnCode || '0401'
  }
}

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
export const API_KEY = import.meta.env.VITE_API_KEY || ''

// Legacy exports for existing imports
export const DAIRY_NAME = DEFAULTS.dairyName
export const DAIRY_PHONE = DEFAULTS.dairyPhone
export const DAIRY_UPI = DEFAULTS.dairyUpi
