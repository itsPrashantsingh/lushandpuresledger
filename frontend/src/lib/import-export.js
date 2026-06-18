import * as XLSX from 'xlsx'

const MAIN_FIELDS = {
  name: ['name', 'customer', 'customer_name', 'customer name'],
  whatsapp_no: ['whatsapp', 'whatsapp_no', 'phone', 'mobile', 'contact', 'number'],
  address: ['address', 'addr', 'location'],
  rate: ['rate', 'price', 'rate_per_litre', 'rate per litre', 'price_per_litre'],
  morning_qty: ['morning_qty', 'morning', 'morning_l', 'morning litres', 'morning_qty_l'],
  evening_qty: ['evening_qty', 'evening', 'evening_l', 'evening litres', 'evening_qty_l']
}

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase().replace(/\s+/g, '_')
}

function matchMainField(header) {
  const norm = normalizeKey(header)
  for (const [field, aliases] of Object.entries(MAIN_FIELDS)) {
    if (aliases.includes(norm) || norm === field) return field
  }
  return null
}

export function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

export function rowsToCustomers(rows) {
  if (!rows.length) return []

  const headers = Object.keys(rows[0])
  const headerMap = {}
  headers.forEach((h) => {
    const field = matchMainField(h)
    if (field) headerMap[h] = field
  })

  return rows
    .map((row) => {
      const customer = {
        name: '',
        whatsapp_no: '',
        address: '',
        rate: 83,
        morning_qty: 0,
        evening_qty: 0,
        custom_fields: {},
        active: true
      }

      Object.entries(row).forEach(([header, value]) => {
        const field = headerMap[header]
        const strVal = value === null || value === undefined ? '' : String(value).trim()
        if (!strVal) return

        if (field) {
          if (field === 'rate' || field === 'morning_qty' || field === 'evening_qty') {
            customer[field] = Number(strVal) || 0
          } else {
            customer[field] = strVal
          }
        } else if (header.trim()) {
          customer.custom_fields[header.trim()] = strVal
        }
      })

      customer.whatsapp_no = customer.whatsapp_no.replace(/\D/g, '').slice(-10)
      return customer
    })
    .filter((c) => c.name && c.whatsapp_no.length >= 10)
}

export function downloadWorkbook(filename, sheets) {
  const wb = XLSX.utils.book_new()
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  })
  XLSX.writeFile(wb, filename)
}

export function downloadCsv(filename, rows) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const IMPORT_TEMPLATE_HEADERS = [
  'name',
  'whatsapp_no',
  'address',
  'rate',
  'morning_qty',
  'evening_qty',
  'flat_no',
  'notes'
]

export function downloadImportTemplate() {
  downloadWorkbook('customer_import_template.xlsx', [{
    name: 'Sample',
    rows: [{
      name: 'Ramesh Kumar',
      whatsapp_no: '9876543210',
      address: 'Sector 12, Noida',
      rate: 83,
      morning_qty: 1,
      evening_qty: 1,
      flat_no: 'B-204',
      notes: 'Ring bell twice'
    }]
  }])
}
