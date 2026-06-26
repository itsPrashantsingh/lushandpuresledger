import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Toast from '../components/Toast'
import { formatCurrency, formatDate, todayISO, currentYearMonth, getMonthBounds } from '../lib/utils'
import { openProductSaleBillPdf } from '../lib/pdf'
import { shareProductSaleOnWhatsApp } from '../lib/whatsapp'

const EMPTY_PRODUCT = {
  category: '',
  name: '',
  unit: 'kg',
  stock_qty: '',
  price: '',
  gst_rate: '0',
  hsn_code: ''
}

const EMPTY_SALE = {
  product_id: '',
  date: todayISO(),
  buyer_name: '',
  buyer_phone: '',
  buyer_gstin: '',
  quantity: '1',
  payment_mode: 'cash',
  notes: ''
}

function calcSale(quantity, rate, gstRate) {
  const subtotal = Math.round((Number(quantity || 0) * Number(rate || 0)) * 100) / 100
  const gstTotal = Math.round((subtotal * Number(gstRate || 0)) * 100) / 10000
  const half = Math.round((gstTotal / 2) * 100) / 100
  return {
    subtotal,
    cgst: half,
    sgst: half,
    igst: 0,
    total_amount: Math.round((subtotal + gstTotal) * 100) / 100
  }
}

export default function Sales() {
  const [products, setProducts] = useState([])
  const [sales, setSales] = useState([])
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT)
  const [saleForm, setSaleForm] = useState(EMPTY_SALE)
  const [month, setMonth] = useState(currentYearMonth())
  const [loading, setLoading] = useState(true)
  const [savingProduct, setSavingProduct] = useState(false)
  const [savingSale, setSavingSale] = useState(false)
  const [toast, setToast] = useState({ message: '', type: 'success' })
  const [editingProductId, setEditingProductId] = useState('')
  const [editingSale, setEditingSale] = useState(null)

  const loadProducts = useCallback(async () => {
    const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false })
    setProducts(data || [])
  }, [])

  const loadSales = useCallback(async () => {
    setLoading(true)
    const { start, end } = getMonthBounds(month)
    const { data } = await supabase
      .from('product_sales')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    setSales(data || [])
    setLoading(false)
  }, [month])

  useEffect(() => {
    Promise.resolve().then(loadProducts)
  }, [loadProducts])

  useEffect(() => {
    Promise.resolve().then(loadSales)
  }, [loadSales])

  function selectProduct(id) {
    setSaleForm((prev) => ({
      ...prev,
      product_id: id
    }))
  }

  async function saveProduct(e) {
    e.preventDefault()
    setSavingProduct(true)
    const payload = {
      category: productForm.category.trim(),
      name: productForm.name.trim(),
      unit: productForm.unit.trim() || 'pcs',
      stock_qty: Number(productForm.stock_qty || 0),
      price: Number(productForm.price || 0),
      gst_rate: Number(productForm.gst_rate || 0),
      hsn_code: productForm.hsn_code.trim() || null
    }

    const { error } = editingProductId
      ? await supabase.from('products').update(payload).eq('id', editingProductId)
      : await supabase.from('products').insert(payload)

    setSavingProduct(false)
    if (error) {
      setToast({ message: error.message, type: 'error' })
      return
    }

    setProductForm(EMPTY_PRODUCT)
    setEditingProductId('')
    setToast({ message: editingProductId ? 'Product updated' : 'Product added to master', type: 'success' })
    loadProducts()
  }

  function editProduct(product) {
    setEditingProductId(product.id)
    setProductForm({
      category: product.category || '',
      name: product.name || '',
      unit: product.unit || 'kg',
      stock_qty: String(Number(product.stock_qty || 0)),
      price: String(Number(product.price || 0)),
      gst_rate: String(Number(product.gst_rate || 0)),
      hsn_code: product.hsn_code || ''
    })
  }

  function cancelProductEdit() {
    setEditingProductId('')
    setProductForm(EMPTY_PRODUCT)
  }

  async function toggleProduct(product) {
    const { error } = await supabase.from('products').update({ active: !product.active }).eq('id', product.id)
    if (error) {
      setToast({ message: error.message, type: 'error' })
      return
    }
    loadProducts()
  }

  async function deleteProduct(product) {
    const ok = confirm(`Delete ${product.name}? Old sales bills will remain saved, but this product will disappear from the product dropdown.`)
    if (!ok) return

    const { error } = await supabase.from('products').delete().eq('id', product.id)
    if (error) {
      setToast({ message: error.message, type: 'error' })
      return
    }
    if (editingProductId === product.id) cancelProductEdit()
    setToast({ message: 'Product deleted', type: 'success' })
    loadProducts()
  }

  async function saveSale(e) {
    e.preventDefault()
    const product = products.find((p) => p.id === saleForm.product_id)
    if (!product) {
      setToast({ message: 'Choose a product first', type: 'error' })
      return
    }

    const quantity = Number(saleForm.quantity || 0)
    const oldQuantity = editingSale && editingSale.product_id === product.id ? Number(editingSale.quantity || 0) : 0
    const availableStock = Number(product.stock_qty || 0) + oldQuantity
    if (quantity <= 0) {
      setToast({ message: 'Quantity should be more than zero', type: 'error' })
      return
    }
    if (quantity > availableStock) {
      setToast({ message: `Only ${availableStock} ${product.unit} available for ${product.name}`, type: 'error' })
      return
    }

    setSavingSale(true)
    let invoiceNo = editingSale?.invoice_no
    if (!invoiceNo) {
      const { data, error: invoiceErr } = await supabase.rpc('next_product_sale_invoice_no')
      if (invoiceErr) {
        setSavingSale(false)
        setToast({ message: invoiceErr.message, type: 'error' })
        return
      }
      invoiceNo = data
    }

    const rate = Number(product.price || 0)
    const totals = calcSale(quantity, rate, product.gst_rate)
    const row = {
      product_id: product.id,
      invoice_no: invoiceNo,
      date: saleForm.date,
      buyer_name: saleForm.buyer_name.trim(),
      buyer_phone: saleForm.buyer_phone.trim() || null,
      buyer_gstin: saleForm.buyer_gstin.trim() || null,
      product_name: product.name,
      category: product.category,
      unit: product.unit,
      hsn_code: product.hsn_code,
      quantity,
      rate,
      subtotal: totals.subtotal,
      gst_rate: Number(product.gst_rate || 0),
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      total_amount: totals.total_amount,
      payment_mode: saleForm.payment_mode,
      notes: saleForm.notes.trim() || null,
      paid: saleForm.payment_mode !== 'credit',
      paid_at: saleForm.payment_mode !== 'credit' ? saleForm.date : null
    }

    const { data: savedRows, error } = editingSale
      ? await supabase.from('product_sales').update(row).eq('id', editingSale.id).select('*')
      : await supabase.from('product_sales').insert(row).select('*')
    if (error) {
      setSavingSale(false)
      setToast({ message: error.message, type: 'error' })
      return
    }

    if (editingSale?.product_id && editingSale.product_id !== product.id) {
      const oldProduct = products.find((p) => p.id === editingSale.product_id)
      if (oldProduct) {
        await supabase
          .from('products')
          .update({ stock_qty: Number(oldProduct.stock_qty || 0) + Number(editingSale.quantity || 0) })
          .eq('id', oldProduct.id)
      }
    }

    await supabase
      .from('products')
      .update({ stock_qty: Math.max(0, availableStock - quantity) })
      .eq('id', product.id)

    const savedSale = savedRows?.[0] || row
    setSaleForm({ ...EMPTY_SALE, date: saleForm.date })
    setEditingSale(null)
    setSavingSale(false)
    if (editingSale) {
      openProductSaleBillPdf(savedSale)
      setToast({ message: `Sale updated: ${savedSale.invoice_no}`, type: 'success' })
      loadProducts()
      loadSales()
      return
    }

    if (savedSale.buyer_phone) {
      try {
        const result = await shareProductSaleOnWhatsApp(savedSale)
        if (result.success && !result.cancelled) {
          await supabase.from('product_sales').update({ sent_at: new Date().toISOString() }).eq('id', savedSale.id)
          setToast({ message: result.attached ? 'Sale saved and bill sent with PDF' : 'Sale saved. PDF downloaded — attach it in WhatsApp', type: 'success' })
        } else {
          setToast({ message: `Sale saved: ${savedSale.invoice_no}`, type: 'success' })
        }
      } catch (err) {
        openProductSaleBillPdf(savedSale)
        setToast({ message: `Sale saved, but WhatsApp failed: ${err.message}`, type: 'error' })
      }
    } else {
      openProductSaleBillPdf(savedSale)
      setToast({ message: `Sale saved: ${savedSale.invoice_no}`, type: 'success' })
    }
    loadProducts()
    loadSales()
  }

  function viewSaleBill(sale) {
    openProductSaleBillPdf(sale)
  }

  async function sendSaleBill(sale) {
    try {
      const result = await shareProductSaleOnWhatsApp(sale)
      if (result.success && !result.cancelled) {
        await supabase.from('product_sales').update({ sent_at: new Date().toISOString() }).eq('id', sale.id)
        setToast({ message: result.attached ? 'Bill sent with PDF attached' : 'PDF downloaded — attach it in WhatsApp', type: 'success' })
        loadSales()
      }
    } catch (err) {
      setToast({ message: err.message, type: 'error' })
    }
  }

  function editSale(sale) {
    setEditingSale(sale)
    setSaleForm({
      product_id: sale.product_id || '',
      date: sale.date,
      buyer_name: sale.buyer_name || '',
      buyer_phone: sale.buyer_phone || '',
      buyer_gstin: sale.buyer_gstin || '',
      quantity: String(Number(sale.quantity || 0)),
      payment_mode: sale.payment_mode || 'cash',
      notes: sale.notes || ''
    })
  }

  function cancelSaleEdit() {
    setEditingSale(null)
    setSaleForm({ ...EMPTY_SALE, date: saleForm.date })
  }

  async function deleteSale(sale) {
    const ok = confirm(`Delete sale ${sale.invoice_no}? Stock will be added back to the product.`)
    if (!ok) return

    const { error } = await supabase.from('product_sales').delete().eq('id', sale.id)
    if (error) {
      setToast({ message: error.message, type: 'error' })
      return
    }

    const product = products.find((p) => p.id === sale.product_id)
    if (product) {
      await supabase
        .from('products')
        .update({ stock_qty: Number(product.stock_qty || 0) + Number(sale.quantity || 0) })
        .eq('id', product.id)
    }

    if (editingSale?.id === sale.id) cancelSaleEdit()
    setToast({ message: `Deleted ${sale.invoice_no}`, type: 'success' })
    loadProducts()
    loadSales()
  }

  async function markSalePaid(sale) {
    const { error } = await supabase.from('product_sales').update({ paid: true, paid_at: todayISO() }).eq('id', sale.id)
    if (error) {
      setToast({ message: error.message, type: 'error' })
      return
    }
    setToast({ message: `${sale.invoice_no} marked as paid`, type: 'success' })
    loadSales()
  }

  const activeProducts = products.filter((p) => p.active)
  const selectedProduct = products.find((p) => p.id === saleForm.product_id)
  const preview = useMemo(
    () => calcSale(saleForm.quantity, selectedProduct?.price || 0, selectedProduct?.gst_rate || 0),
    [saleForm.quantity, selectedProduct?.price, selectedProduct?.gst_rate]
  )
  const saleAvailableStock = selectedProduct
    ? Number(selectedProduct.stock_qty || 0) + (editingSale?.product_id === selectedProduct.id ? Number(editingSale.quantity || 0) : 0)
    : 0
  const monthTotal = sales.reduce((s, sale) => s + Number(sale.total_amount), 0)
  const monthTaxable = sales.reduce((s, sale) => s + Number(sale.subtotal), 0)
  const monthGst = sales.reduce((s, sale) => s + Number(sale.cgst) + Number(sale.sgst) + Number(sale.igst), 0)
  const creditPending = sales.filter((s) => s.payment_mode === 'credit' && !s.paid).reduce((s, sale) => s + Number(sale.total_amount), 0)

  return (
    <div className="space-y-6">
      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: '', type: 'success' })} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Sales</h1>
          <p className="text-sm text-slate-500">Product master, market sales, GST invoice and stock tracking</p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-700">Other Product Sales</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{formatCurrency(monthTotal)}</p>
        </div>
        <div className="rounded-xl border-l-4 border-sky-500 bg-sky-50 p-4">
          <p className="text-sm text-sky-700">Taxable Value</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{formatCurrency(monthTaxable)}</p>
        </div>
        <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4">
          <p className="text-sm text-amber-700">GST Collected</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{formatCurrency(monthGst)}</p>
        </div>
        <div className="rounded-xl border-l-4 border-orange-500 bg-orange-50 p-4">
          <p className="text-sm text-orange-700">Credit Pending</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{formatCurrency(creditPending)}</p>
        </div>
      </div>

      <form onSubmit={saveSale} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-800">{editingSale ? `Edit Sale ${editingSale.invoice_no}` : 'Make Sale Entry'}</h2>
          {editingSale && (
            <button type="button" onClick={cancelSaleEdit} className="text-sm text-slate-500 hover:underline">Cancel edit</button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <input type="date" value={saleForm.date} onChange={(e) => setSaleForm({ ...saleForm, date: e.target.value })} className="rounded-lg border px-3 py-2" required />
          <select value={saleForm.product_id} onChange={(e) => selectProduct(e.target.value)} className="rounded-lg border px-3 py-2" required>
            <option value="">Choose product</option>
            {activeProducts.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {formatCurrency(p.price)} / {p.unit} · Stock {Number(p.stock_qty || 0)} {p.unit}</option>
            ))}
          </select>
          <input placeholder="Buyer name" value={saleForm.buyer_name} onChange={(e) => setSaleForm({ ...saleForm, buyer_name: e.target.value })} className="rounded-lg border px-3 py-2" required />
          <input
            type="tel"
            placeholder="Buyer phone (10 digits)"
            maxLength={10}
            value={saleForm.buyer_phone}
            onChange={(e) => setSaleForm({ ...saleForm, buyer_phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
            className="rounded-lg border px-3 py-2"
          />
          <input placeholder="Buyer GSTIN" value={saleForm.buyer_gstin} onChange={(e) => setSaleForm({ ...saleForm, buyer_gstin: e.target.value.toUpperCase() })} className="rounded-lg border px-3 py-2" />
          <div className="relative">
            <input type="number" step="0.001" placeholder="Quantity" value={saleForm.quantity} onChange={(e) => setSaleForm({ ...saleForm, quantity: e.target.value })} className="w-full rounded-lg border px-3 py-2 pr-14" required />
            {selectedProduct && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">{selectedProduct.unit}</span>
            )}
          </div>
          <select value={saleForm.payment_mode} onChange={(e) => setSaleForm({ ...saleForm, payment_mode: e.target.value })} className="rounded-lg border px-3 py-2">
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank</option>
            <option value="credit">Credit</option>
          </select>
        </div>
        <textarea placeholder="Notes" value={saleForm.notes} onChange={(e) => setSaleForm({ ...saleForm, notes: e.target.value })} className="mt-3 w-full rounded-lg border px-3 py-2" rows="2" />

        <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
          <p><span className="text-slate-500">Stock:</span> {selectedProduct ? `${saleAvailableStock} ${selectedProduct.unit}` : '-'}</p>
          <p><span className="text-slate-500">Rate:</span> {selectedProduct ? `${formatCurrency(selectedProduct.price)} / ${selectedProduct.unit}` : '-'}</p>
          <p><span className="text-slate-500">Taxable:</span> {formatCurrency(preview.subtotal)}</p>
          <p className="font-semibold"><span className="text-slate-500">Total:</span> {formatCurrency(preview.total_amount)}</p>
        </div>

        <button type="submit" disabled={savingSale || activeProducts.length === 0} className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
          {savingSale ? 'Saving...' : editingSale ? 'Update Sale' : 'Save Sale & Send WhatsApp'}
        </button>
      </form>

      <form onSubmit={saveProduct} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-800">Production Master</h2>
            <p className="text-xs text-slate-500">Price is per selected unit, for example per kg, per gram, per litre, or per piece.</p>
          </div>
          {editingProductId && (
            <button type="button" onClick={cancelProductEdit} className="text-sm text-slate-500 hover:underline">Cancel edit</button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-7">
          <input placeholder="Category" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })} className="rounded-lg border px-3 py-2" required />
          <input placeholder="Product name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} className="rounded-lg border px-3 py-2 lg:col-span-2" required />
          <select value={productForm.unit} onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })} className="rounded-lg border px-3 py-2" required>
            <option value="kg">kg</option>
            <option value="g">g</option>
            <option value="litre">litre</option>
            <option value="ml">ml</option>
            <option value="pcs">pcs</option>
            <option value="box">box</option>
          </select>
          <div className="relative">
            <input type="number" step="0.001" placeholder="Stock qty" value={productForm.stock_qty} onChange={(e) => setProductForm({ ...productForm, stock_qty: e.target.value })} className="w-full rounded-lg border px-3 py-2 pr-10" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{productForm.unit}</span>
          </div>
          <div className="relative">
            <input type="number" step="0.01" placeholder="Price" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} className="w-full rounded-lg border px-3 py-2 pr-14" required />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹/{productForm.unit}</span>
          </div>
          <input type="number" step="0.01" placeholder="GST %" value={productForm.gst_rate} onChange={(e) => setProductForm({ ...productForm, gst_rate: e.target.value })} className="rounded-lg border px-3 py-2" />
          <input placeholder="HSN" value={productForm.hsn_code} onChange={(e) => setProductForm({ ...productForm, hsn_code: e.target.value })} className="rounded-lg border px-3 py-2" />
        </div>
        <button type="submit" disabled={savingProduct} className="mt-3 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50">
          {savingProduct ? 'Saving...' : editingProductId ? 'Update Product' : 'Add Product'}
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold text-slate-800">Products</h2>
          {products.length === 0 ? (
            <p className="text-sm text-slate-500">Add your first product to start recording market sales.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="pb-2 pr-3">Product</th>
                    <th className="pb-2 pr-3">Stock</th>
                    <th className="pb-2 pr-3">Rate</th>
                    <th className="pb-2 pr-3">GST</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="py-3 pr-3">
                        <p className="font-medium text-slate-800">{p.name}</p>
                        <p className="text-xs text-slate-400">{p.category}{p.hsn_code ? ` · HSN ${p.hsn_code}` : ''}</p>
                      </td>
                      <td className="py-3 pr-3">{Number(p.stock_qty || 0)} {p.unit}</td>
                      <td className="py-3 pr-3">{formatCurrency(p.price)} / {p.unit}</td>
                      <td className="py-3 pr-3">{Number(p.gst_rate)}%</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => editProduct(p)} className="text-xs text-blue-600 hover:underline">Edit</button>
                          <button type="button" onClick={() => toggleProduct(p)} className={`text-xs hover:underline ${p.active ? 'text-amber-600' : 'text-green-600'}`}>
                            {p.active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button type="button" onClick={() => deleteProduct(p)} className="text-xs text-red-600 hover:underline">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-semibold text-slate-800">Sales This Month</h2>
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : sales.length === 0 ? (
            <p className="text-sm text-slate-500">No product sales for this month.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="pb-2 pr-3">Invoice</th>
                    <th className="pb-2 pr-3">Buyer</th>
                    <th className="pb-2 pr-3">Product</th>
                    <th className="pb-2 pr-3">Qty</th>
                    <th className="pb-2 pr-3">Amount</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id} className="border-b border-slate-100">
                      <td className="py-3 pr-3">
                        <p className="font-medium text-slate-800">{sale.invoice_no}</p>
                        <p className="text-xs text-slate-400">{formatDate(sale.date)}</p>
                      </td>
                      <td className="py-3 pr-3">{sale.buyer_name}</td>
                      <td className="py-3 pr-3">{sale.product_name}</td>
                      <td className="py-3 pr-3">{Number(sale.quantity)} {sale.unit}</td>
                      <td className="py-3 pr-3">
                        <p className="font-medium text-green-700">{formatCurrency(sale.total_amount)}</p>
                        {sale.payment_mode === 'credit' && (
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${sale.paid ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            Credit · {sale.paid ? 'Paid' : 'Unpaid'}
                          </span>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          {sale.payment_mode === 'credit' && !sale.paid && (
                            <button type="button" onClick={() => markSalePaid(sale)} className="text-xs font-medium text-green-600 hover:underline">Mark Paid</button>
                          )}
                          <button type="button" onClick={() => editSale(sale)} className="text-xs text-blue-600 hover:underline">Edit</button>
                          <button type="button" onClick={() => viewSaleBill(sale)} className="text-xs text-green-600 hover:underline">Bill</button>
                          <button type="button" onClick={() => sendSaleBill(sale)} className="text-xs text-amber-600 hover:underline">WhatsApp</button>
                          <button type="button" onClick={() => deleteSale(sale)} className="text-xs text-red-600 hover:underline">Delete</button>
                        </div>
                        {sale.sent_at && <p className="mt-1 text-[10px] text-slate-400">sent {formatDate(sale.sent_at.slice(0, 10))}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
