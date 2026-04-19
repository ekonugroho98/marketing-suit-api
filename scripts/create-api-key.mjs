#!/usr/bin/env node
// ============================================
// CLI: Provision API key for a user
//
// Usage:
//   node scripts/create-api-key.mjs <user_id> [name] [--scopes=a,b,c] [--rpm=60]
//
// The full token is printed ONCE. Store it securely — only the
// SHA-256 hash + prefix is kept in the database.
// ============================================
import 'dotenv/config'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function parseArgs(argv) {
  const args = { flags: {}, positional: [] }
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      args.flags[k] = v ?? true
    } else {
      args.positional.push(a)
    }
  }
  return args
}

function genToken(env = 'live') {
  // 32 bytes random → base64url, ~43 chars
  const rand = crypto.randomBytes(32).toString('base64url')
  return `kry_${env}_${rand}`
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

const DEFAULT_SCOPES = [
  'content:read','content:write',
  'publish:read','publish:write',
  'ads:read','ads:write',
  'analytics:read','accounts:read',
]

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [userId, name = 'Agent key'] = positional

  if (!userId) {
    console.error('Usage: create-api-key <user_id> [name] [--scopes=a,b] [--rpm=60] [--env=live|test] [--expires=ISO8601]')
    process.exit(1)
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY harus di-set di .env')
    process.exit(1)
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  // Verify user exists
  const { data: profile } = await db
    .from('profiles')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle()
  if (!profile) {
    console.error(`User ${userId} tidak ditemukan di table profiles`)
    process.exit(1)
  }

  const env = flags.env || 'live'
  const token = genToken(env)
  const tokenHash = sha256Hex(token)
  const prefix = token.slice(0, 12) // "kry_live_abc"

  const scopes = flags.scopes
    ? String(flags.scopes).split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SCOPES
  const rpm = flags.rpm ? Number(flags.rpm) : 60
  const expiresAt = flags.expires || null

  const { data, error } = await db
    .from('api_keys')
    .insert({
      user_id: userId,
      name,
      key_prefix: prefix,
      key_hash: tokenHash,
      scopes,
      rate_limit_per_minute: rpm,
      expires_at: expiresAt,
    })
    .select('id, name, key_prefix, scopes, rate_limit_per_minute, expires_at')
    .single()

  if (error) {
    console.error('Gagal membuat API key:', error.message)
    process.exit(1)
  }

  console.log('\n✅ API key berhasil dibuat\n')
  console.log(`  User:       ${profile.full_name} (${profile.id})`)
  console.log(`  Key id:     ${data.id}`)
  console.log(`  Name:       ${data.name}`)
  console.log(`  Prefix:     ${data.key_prefix}`)
  console.log(`  Scopes:     ${data.scopes.join(', ')}`)
  console.log(`  Rate limit: ${data.rate_limit_per_minute} req/min`)
  if (data.expires_at) console.log(`  Expires:    ${data.expires_at}`)
  console.log('\n─────────────────────────────────────────')
  console.log('  TOKEN (SIMPAN SEKARANG — tidak bisa dilihat lagi):')
  console.log(`  ${token}`)
  console.log('─────────────────────────────────────────\n')
  console.log('  Usage:')
  console.log(`    curl -H "Authorization: Bearer ${token}" \\`)
  console.log(`         https://your-api.example.com/v1/auth/whoami\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
