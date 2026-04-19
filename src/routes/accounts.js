// ============================================
// Connected social accounts — for Social Media Agent
// Tokens are never returned — only masked metadata.
// ============================================
import { db } from '../db.js'
import { requireScope } from '../middleware/auth.js'
import { notFound } from '../utils/errors.js'

function sanitize(row) {
  const { access_token_encrypted, refresh_token_encrypted, ...safe } = row
  return { ...safe, has_token: Boolean(access_token_encrypted) }
}

export default async function accountsRoutes(app) {
  app.get('/', { preHandler: requireScope('accounts:read') }, async (req) => {
    let q = db.from('connected_accounts').select('*').eq('user_id', req.user.id)
    if (req.query.platform) q = q.eq('platform', req.query.platform)
    if (req.query.status) q = q.eq('status', req.query.status)
    const { data, error } = await q.order('connected_at', { ascending: false })
    if (error) throw error
    return { data: (data || []).map(sanitize) }
  })

  app.get('/:id', { preHandler: requireScope('accounts:read') }, async (req) => {
    const { data, error } = await db
      .from('connected_accounts')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw notFound('Akun tidak ditemukan')
    return sanitize(data)
  })
}
