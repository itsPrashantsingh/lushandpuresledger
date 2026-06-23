import * as XLSX from 'xlsx'

const MAIN_FIELDS = {
  name: ['name', 'customer', 'customer_name', 'customer name'],
  whatsapp_no: ['whatsapp', 'whatsapp_no', 'phone', 'mobile', 'contact', 'number'],
  address: ['address', 'addr', 'location'],
  rate: ['rate', 'price', 'rate_per_litre', 'rate per litre', 'price_per_litre'],
  morning_qty: ['morning_qty', 'morning', 'morning_l', 'morning litres', 'morning_qty_l'],
  evening_qty: ['evening_qty', 'evening', 'evening_l', 'evening litres', 'evening_qty_l'],
  buttermilk_required: ['buttermilk_required', 'buttermilk', 'bm_required'],
  buttermilk_quantity: ['buttermilk_quantity', 'bm_qty', 'buttermilk_qty'],
  buttermilk_rate: ['buttermilk_rate', 'bm_rate']
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
        buttermilk_required: false,
        buttermilk_quantity: 0,
        buttermilk_rate: 0,
        custom_fields: {},
        active: true
      }

      Object.entries(row).forEach(([header, value]) => {
        const field = headerMap[header]
        const strVal = value === null || value === undefined ? '' : String(value).trim()
        if (!strVal) return

        if (field) {
          if (['rate', 'morning_qty', 'evening_qty', 'buttermilk_quantity', 'buttermilk_rate'].includes(field)) {
            customer[field] = Number(strVal) || 0
          } else if (field === 'buttermilk_required') {
            customer[field] = ['yes', 'true', '1', 'y'].includes(strVal.toLowerCase())
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
  'buttermilk_required',
  'buttermilk_quantity',
  'buttermilk_rate',
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
      buttermilk_required: 'no',
      buttermilk_quantity: 0,
      buttermilk_rate: 0,
      flat_no: 'B-204',
      notes: 'Ring bell twice'
    }, {
      name: 'Suresh Sharma',
      whatsapp_no: '9988776655',
      address: 'Main Market',
      rate: 80,
      morning_qty: 2,
      evening_qty: 1,
      buttermilk_required: 'yes',
      buttermilk_quantity: 1,
      buttermilk_rate: 20,
      flat_no: '',
      notes: ''
    }]
  }])
}

const CATTLE_FIELDS = {
  name: ['name', 'cattle', 'cattle_name', 'cattle name'],
  breed: ['breed', 'type'],
  category: ['category', 'animal', 'animal_type', 'cow_buffalo']
}

function matchCattleField(header) {
  const norm = normalizeKey(header)
  for (const [field, aliases] of Object.entries(CATTLE_FIELDS)) {
    if (aliases.includes(norm) || norm === field) return field
  }
  return null
}

function normalizeCategory(val) {
  const v = String(val || '').trim().toLowerCase()
  if (v === 'cow' || v === 'cows' || v === 'gaay' || v === 'gai') return 'cow'
  if (v === 'buffalo' || v === 'buffaloes' || v === 'bhains' || v === 'bhainsa') return 'buffalo'
  return v === 'cow' || v === 'buffalo' ? v : ''
}

export function rowsToCattle(rows) {
  if (!rows.length) return []

  const headers = Object.keys(rows[0])
  const headerMap = {}
  headers.forEach((h) => {
    const field = matchCattleField(h)
    if (field) headerMap[h] = field
  })

  return rows
    .map((row) => {
      const cattle = {
        name: '',
        breed: '',
        category: '',
        custom_fields: {},
        active: true
      }

      Object.entries(row).forEach(([header, value]) => {
        const field = headerMap[header]
        const strVal = value === null || value === undefined ? '' : String(value).trim()
        if (!strVal) return

        if (field === 'category') {
          cattle.category = normalizeCategory(strVal)
        } else if (field) {
          cattle[field] = strVal
        } else if (header.trim()) {
          cattle.custom_fields[header.trim()] = strVal
        }
      })

      return cattle
    })
    .filter((c) => c.name && (c.category === 'cow' || c.category === 'buffalo'))
}

export function downloadCattleImportTemplate() {
  downloadWorkbook('cattle_import_template.xlsx', [{
    name: 'Sample',
    rows: [{
      name: 'Gauri',
      breed: 'Sahiwal',
      category: 'cow',
      notes: 'Healthy'
    }, {
      name: 'Lakshmi',
      breed: 'Murrah',
      category: 'buffalo'
    }]
  }])
}
