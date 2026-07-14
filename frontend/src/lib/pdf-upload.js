import { supabase } from './supabase'
import { getBillPdfBlob, generateProductSaleBill } from './pdf'

const BUCKET = 'bill-pdfs'

async function uploadBlob(path, blob) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'application/pdf',
    upsert: true
  })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/** Generate a bill PDF, upload it, persist bills.pdf_url, return the public URL. */
export async function uploadBillPdf(customer, entries, bill) {
  const blob = getBillPdfBlob(customer, entries, bill)
  const url = await uploadBlob(`bills/${bill.id}.pdf`, blob)
  await supabase.from('bills').update({ pdf_url: url }).eq('id', bill.id)
  return url
}

/** Generate a product-sale PDF, upload it, persist product_sales.pdf_url, return the public URL. */
export async function uploadSalePdf(sale) {
  const blob = generateProductSaleBill(sale).output('blob')
  const url = await uploadBlob(`sales/${sale.invoice_no}.pdf`, blob)
  await supabase.from('product_sales').update({ pdf_url: url }).eq('id', sale.id)
  return url
}
