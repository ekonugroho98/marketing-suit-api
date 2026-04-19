import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'

// Service-role Supabase client. Bypasses RLS — always scope queries
// explicitly with .eq('user_id', req.user.id).
export const db = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
