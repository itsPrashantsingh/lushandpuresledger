import { createClient } from '@supabase/supabase-js'

function normalizeSupabaseUrl(url) {
  if (!url) return url
  return url.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
}

export const supabase = createClient(
  normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL),
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
