const express = require('express')
const supabase = require('../lib/supabase')
const { requireUser } = require('../lib/auth')
const { logActivity } = require('../lib/activity-log')

const router = express.Router()

router.use(requireUser)

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '')
}

function normalizeEntry(entry, customer) {
  const morning = Math.max(0, Number(entry?.morning_qty) || 0)
  const evening = Math.max(0, Number(entry?.evening_qty) || 0)
  return {
    customer_id: customer.id,
    date: entry.date,
    morning_qty: morning,
    evening_qty: evening,
    rate: Number(entry?.rate ?? customer.rate) || 0,
    delivered: entry?.delivered !== false && (morning > 0 || evening > 0)
  }
}

function entryChangedFromDefault(entry, customer) {
  const defaultMorning = Number(customer.morning_qty) || 0
  const defaultEvening = Number(customer.evening_qty) || 0
  const defaultRate = Number(customer.rate) || 0
  return (
    Number(entry.morning_qty) !== defaultMorning ||
    Number(entry.evening_qty) !== defaultEvening ||
    Number(entry.rate) !== defaultRate ||
    entry.delivered === false
  )
}

async function loadCustomers() {
  // All customers, active first — inactive ones are still listed (auto-skipped, sorted
  // to the bottom by the frontend) so staff can quickly reactivate them without leaving
  // the daily entry screen, instead of manually skipping them every single day.
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('active', { ascending: false })
    .order('name')

  if (error) throw error
  return data || []
}

async function loadDeliveryState(date) {
  const customers = await loadCustomers()
  const customerById = new Map(customers.map((customer) => [customer.id, customer]))

  const [{ data: session, error: sessionErr }, { data: drafts, error: draftsErr }, { data: finals, error: finalsErr }] = await Promise.all([
    supabase.from('daily_entry_sessions').select('*').eq('date', date).maybeSingle(),
    supabase.from('daily_entry_drafts').select('*').eq('date', date),
    supabase.from('daily_entries').select('*').eq('date', date)
  ])

  if (sessionErr) throw sessionErr
  if (draftsErr) throw draftsErr
  if (finalsErr) throw finalsErr

  const draftByCustomer = new Map((drafts || []).map((entry) => [entry.customer_id, entry]))
  const finalByCustomer = new Map((finals || []).map((entry) => [entry.customer_id, entry]))
  const preferFinal = session?.status === 'finalized' && !drafts?.length

  const entries = customers.map((customer) => {
    const source = preferFinal ? finalByCustomer.get(customer.id) : draftByCustomer.get(customer.id) || finalByCustomer.get(customer.id)
    // No draft/final yet: default to delivered for active customers, auto-skipped for
    // inactive ones — no manual daily "Skip" click needed while a customer is paused.
    const defaultDelivered = customer.active !== false
    const delivered = source
      ? source.delivered !== false && (Number(source.morning_qty) > 0 || Number(source.evening_qty) > 0)
      : defaultDelivered

    return {
      customer_id: customer.id,
      morning_qty: source ? Number(source.morning_qty) : (defaultDelivered ? Number(customer.morning_qty) : 0),
      evening_qty: source ? Number(source.evening_qty) : (defaultDelivered ? Number(customer.evening_qty) : 0),
      rate: source ? Number(source.rate) : Number(customer.rate),
      delivered,
      saved: finalByCustomer.has(customer.id),
      custom: source ? entryChangedFromDefault({ ...source, delivered }, customer) : false
    }
  })

  return {
    customers,
    entries,
    session: session || { date, status: 'locked' },
    hasDrafts: Boolean(drafts?.length),
    hasFinalEntries: Boolean(finals?.length)
  }
}

async function seedDraftsIfNeeded(date, user) {
  const { data: existing, error: existingErr } = await supabase
    .from('daily_entry_drafts')
    .select('id')
    .eq('date', date)
    .limit(1)

  if (existingErr) throw existingErr
  if (existing?.length) return

  const customers = await loadCustomers()
  const { data: finals, error: finalsErr } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('date', date)

  if (finalsErr) throw finalsErr
  const finalByCustomer = new Map((finals || []).map((entry) => [entry.customer_id, entry]))

  const rows = customers.map((customer) => {
    const final = finalByCustomer.get(customer.id)
    // Inactive customers with no existing final entry seed as skipped (0/0) — a paused
    // customer should never be auto-delivered just because unlock ran for a new day.
    const useDefault = Boolean(final) || customer.active !== false
    const morning = final ? Number(final.morning_qty) : (useDefault ? Number(customer.morning_qty) : 0)
    const evening = final ? Number(final.evening_qty) : (useDefault ? Number(customer.evening_qty) : 0)
    return {
      customer_id: customer.id,
      date,
      morning_qty: morning,
      evening_qty: evening,
      rate: final ? Number(final.rate) : Number(customer.rate),
      delivered: morning > 0 || evening > 0,
      updated_by: user.id,
      updated_by_email: user.email,
      updated_at: new Date().toISOString()
    }
  })

  if (!rows.length) return
  const { error } = await supabase
    .from('daily_entry_drafts')
    .upsert(rows, { onConflict: 'customer_id,date' })

  if (error) throw error
}

async function saveDraftEntries(date, submittedEntries, user) {
  const customers = await loadCustomers()
  const submittedByCustomer = new Map((submittedEntries || []).map((entry) => [entry.customer_id, entry]))

  const rows = customers.map((customer) => {
    const submitted = submittedByCustomer.get(customer.id) || {}
    const normalized = normalizeEntry({ ...submitted, date }, customer)
    return {
      ...normalized,
      updated_by: user.id,
      updated_by_email: user.email,
      updated_at: new Date().toISOString()
    }
  })

  if (!rows.length) return { rows: [], customers }

  const { error } = await supabase
    .from('daily_entry_drafts')
    .upsert(rows, { onConflict: 'customer_id,date' })

  if (error) throw error
  return { rows, customers }
}

router.get('/', async (req, res, next) => {
  try {
    const { date } = req.query
    if (!isIsoDate(date)) return res.status(400).json({ error: 'Valid date is required' })

    const state = await loadDeliveryState(date)
    res.json(state)
  } catch (err) {
    next(err)
  }
})

router.post('/unlock', async (req, res, next) => {
  try {
    const { date } = req.body
    if (!isIsoDate(date)) return res.status(400).json({ error: 'Valid date is required' })

    await seedDraftsIfNeeded(date, req.user)

    const now = new Date().toISOString()
    const { error } = await supabase.from('daily_entry_sessions').upsert({
      date,
      status: 'unlocked',
      unlocked_by: req.user.id,
      unlocked_by_email: req.user.email,
      unlocked_at: now,
      updated_at: now
    }, { onConflict: 'date' })

    if (error) throw error

    await logActivity(req.user, 'daily_entry_unlocked', 'deliveries', {
      entityId: date,
      entityDate: date,
      details: { date }
    })

    const state = await loadDeliveryState(date)
    res.json(state)
  } catch (err) {
    next(err)
  }
})

router.post('/lock', async (req, res, next) => {
  try {
    const { date, entries } = req.body
    if (!isIsoDate(date)) return res.status(400).json({ error: 'Valid date is required' })
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'Entries array is required' })

    const { rows, customers } = await saveDraftEntries(date, entries, req.user)
    const customerById = new Map(customers.map((customer) => [customer.id, customer]))
    const customRows = rows.filter((row) => entryChangedFromDefault(row, customerById.get(row.customer_id)))
    const now = new Date().toISOString()

    const { error } = await supabase.from('daily_entry_sessions').upsert({
      date,
      status: 'locked',
      locked_by: req.user.id,
      locked_by_email: req.user.email,
      locked_at: now,
      updated_at: now
    }, { onConflict: 'date' })

    if (error) throw error

    await logActivity(req.user, 'daily_entry_locked', 'deliveries', {
      entityId: date,
      entityDate: date,
      details: {
        date,
        totalCustomers: rows.length,
        customCustomers: customRows.length,
        deliveredCustomers: rows.filter((row) => row.delivered).length,
        totalLitres: rows.reduce((sum, row) => sum + Number(row.morning_qty) + Number(row.evening_qty), 0)
      }
    })

    const state = await loadDeliveryState(date)
    res.json(state)
  } catch (err) {
    next(err)
  }
})

router.post('/finalize', async (req, res, next) => {
  try {
    const { date, entries } = req.body
    if (!isIsoDate(date)) return res.status(400).json({ error: 'Valid date is required' })
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'Entries array is required' })

    const { rows } = await saveDraftEntries(date, entries, req.user)
    const deliveredRows = rows
      .filter((row) => row.delivered && (Number(row.morning_qty) > 0 || Number(row.evening_qty) > 0))
      .map((row) => ({
        customer_id: row.customer_id,
        date,
        morning_qty: Number(row.morning_qty) || 0,
        evening_qty: Number(row.evening_qty) || 0,
        rate: Number(row.rate) || 0
      }))

    if (deliveredRows.length) {
      const { error: upsertErr } = await supabase
        .from('daily_entries')
        .upsert(deliveredRows, { onConflict: 'customer_id,date' })
      if (upsertErr) throw upsertErr
    }

    const skippedIds = rows
      .filter((row) => !row.delivered || (!Number(row.morning_qty) && !Number(row.evening_qty)))
      .map((row) => row.customer_id)

    if (skippedIds.length) {
      const { error: deleteErr } = await supabase
        .from('daily_entries')
        .delete()
        .eq('date', date)
        .in('customer_id', skippedIds)
      if (deleteErr) throw deleteErr
    }

    const now = new Date().toISOString()
    const { error } = await supabase.from('daily_entry_sessions').upsert({
      date,
      status: 'finalized',
      finalized_by: req.user.id,
      finalized_by_email: req.user.email,
      finalized_at: now,
      updated_at: now
    }, { onConflict: 'date' })

    if (error) throw error

    await logActivity(req.user, 'daily_entry_finalized', 'deliveries', {
      entityId: date,
      entityDate: date,
      details: {
        date,
        deliveredCustomers: deliveredRows.length,
        skippedCustomers: skippedIds.length,
        totalLitres: deliveredRows.reduce((sum, row) => sum + Number(row.morning_qty) + Number(row.evening_qty), 0)
      }
    })

    const state = await loadDeliveryState(date)
    res.json(state)
  } catch (err) {
    next(err)
  }
})

module.exports = router
