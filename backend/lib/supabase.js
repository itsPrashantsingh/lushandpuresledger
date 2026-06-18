const { createClient } = require('@supabase/supabase-js')

function normalizeSupabaseUrl(url) {
  if (!url) return url
  return url.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
}

const supabase = createClient(
  normalizeSupabaseUrl(process.env.SUPABASE_URL),
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = supabase
