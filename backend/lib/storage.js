const supabase = require('./supabase')

const BUCKET = 'bill-pdfs'

/** Upload a PDF buffer and return its public URL. */
async function uploadBillPdf(billId, buffer) {
  const path = `bills/${billId}.pdf`
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: true
  })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

module.exports = { uploadBillPdf }
