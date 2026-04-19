import { db } from '../db.js'
import { sha256Hex } from '../crypto.js'
import { unauthorized, forbidden, tooMany } from '../utils/errors.js'

// ── In-memory sliding-window rate limiter, per API key ──
// Good enough for a single-instance VPS. For multi-instance,
// swap for Redis.
const windows = new Map() // key_id -> { startedAt, count }

function hitRateLimit(keyId, limitPerMinute) {
  const now = Date.now()
  const cur = windows.get(keyId)
  if (!cur || now - cur.startedAt > 60_000) {
    windows.set(keyId, { startedAt: now, count: 1 })
    return { ok: true, remaining: limitPerMinute - 1, resetAt: now + 60_000 }
  }
  cur.count += 1
  if (cur.count > limitPerMinute) {
    return { ok: false, remaining: 0, resetAt: cur.startedAt + 60_000 }
  }
  return {
    ok: true,
    remaining: limitPerMinute - cur.count,
    resetAt: cur.startedAt + 60_000,
  }
}

// Fastify preHandler — verifies `Authorization: Bearer <token>`.
// Populates req.user = { id, api_key_id, scopes }.
export async function apiKeyAuth(req, reply) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : ''

  if (!token || !token.startsWith('kry_')) {
    throw unauthorized('API key tidak valid. Gunakan header Authorization: Bearer kry_...')
  }

  const keyHash = sha256Hex(token)
  const ip =
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.ip ||
    null

  const { data, error } = await db.rpc('verify_api_key', {
    p_key_hash: keyHash,
    p_ip: ip,
  })

  if (error) {
    req.log.error({ error }, 'verify_api_key RPC error')
    throw unauthorized('Gagal verifikasi API key')
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw unauthorized('API key tidak aktif atau sudah kadaluarsa')

  const rate = hitRateLimit(row.id, row.rate_limit_per_minute || 60)
  reply.header('X-RateLimit-Limit', row.rate_limit_per_minute)
  reply.header('X-RateLimit-Remaining', rate.remaining)
  reply.header('X-RateLimit-Reset', Math.floor(rate.resetAt / 1000))
  if (!rate.ok) {
    throw tooMany(
      `Rate limit ${row.rate_limit_per_minute}/min terlampaui. Coba lagi dalam beberapa detik.`,
    )
  }

  req.user = {
    id: row.user_id,
    api_key_id: row.id,
    scopes: row.scopes || [],
  }
}

// Factory: requires a specific scope (e.g. 'publish:write').
export function requireScope(scope) {
  return async (req) => {
    if (!req.user) throw unauthorized()
    if (!req.user.scopes.includes(scope) && !req.user.scopes.includes('*')) {
      throw forbidden(`Scope '${scope}' dibutuhkan`)
    }
  }
}
