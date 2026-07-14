// Server-side dairy identity for PDFs. Configure via env on Render; defaults
// mirror the frontend localStorage DEFAULTS (frontend/src/lib/constants.js).
function getDairyInfo() {
  return {
    name: process.env.DAIRY_NAME || 'Lush & Pures',
    phone: process.env.DAIRY_PHONE || '9876543210',
    address: process.env.DAIRY_ADDRESS || 'Your dairy address, City, State - PIN',
    gstin: process.env.DAIRY_GSTIN || '',
    state: process.env.DAIRY_STATE || 'Uttar Pradesh',
    gstRate: Number(process.env.DAIRY_GST_RATE || 0),
    hsnCode: process.env.DAIRY_HSN || '0401'
  }
}

module.exports = { getDairyInfo }
