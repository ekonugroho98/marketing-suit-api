// ============================================
// Publish + Insights routes — for Social Media Agent
// ============================================
import { db } from '../db.js'
import { decryptToken } from '../crypto.js'
import { publishToPlatform, getPlatformInsights } from '../services/publishers.js'
import { requireScope } from '../middleware/auth.js'
import { badRequest, notFound } from '../utils/errors.js'
import { parsePagination } from '../utils/validate.js'

async function loadAccount(userId, accountId) {
  const { data, error } = await db
    .from('connected_accounts')
    .select('id, platform, platform_user_id, platform_username, access_token_encrypted, status')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw notFound('Akun tidak ditemukan')
  if (data.status !== 'active') {
    throw badRequest(`Akun ${data.platform}/${data.platform_username} status=${data.status}`)
  }
  return data
}

export default async function publishRoutes(app) {
  // POST /v1/publish — single or batch publish
  // body: { items: [{ account_id, caption, media_urls?, hashtags?, reply_to_id? }] }
  app.post('/', { preHandler: requireScope('publish:write') }, async (req) => {
    const body = req.body || {}
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length) throw badRequest('items[] wajib (minimal 1)')

    const results = []
    for (const item of items) {
      const r = { account_id: item.account_id }
      try {
        if (!item.account_id) throw new Error('account_id wajib')
        if (!item.caption && !(item.media_urls || []).length) {
          throw new Error('caption atau media_urls wajib')
        }

        const acc = await loadAccount(req.user.id, item.account_id)
        const accessToken = decryptToken(acc.access_token_encrypted)

        const tagStr = (item.hashtags || []).length
          ? '\n\n' + item.hashtags.map((h) => `#${String(h).replace(/^#/, '')}`).join(' ')
          : ''
        const text = (item.caption || '') + tagStr

        const pub = await publishToPlatform({
          platform: acc.platform,
          accessToken,
          platformUserId: acc.platform_user_id || acc.platform_username,
          text,
          mediaUrls: item.media_urls || [],
          replyToId: item.reply_to_id,
          log: req.log,
        })

        // Only log root posts (non-reply) to publish_history
        if (!item.reply_to_id) {
          await db.from('publish_history').insert({
            user_id: req.user.id,
            content_id: item.content_id || null,
            platform: acc.platform,
            platform_post_id: pub.postId,
            published_url: pub.postUrl,
            status: 'published',
            payload: {
              caption: item.caption,
              media_urls: item.media_urls || [],
              account_id: item.account_id,
            },
            published_at: new Date().toISOString(),
          })
        }

        r.status = 'success'
        r.platform = acc.platform
        r.post_id = pub.postId
        r.post_url = pub.postUrl
      } catch (err) {
        r.status = 'failed'
        r.error = err.message
      }
      results.push(r)
    }

    const hasAnyFail = results.some((r) => r.status === 'failed')
    return { results, partial_failure: hasAnyFail }
  })

  // GET /v1/publish/history
  app.get('/history', { preHandler: requireScope('publish:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    let q = db.from('publish_history').select('*').eq('user_id', req.user.id)
    if (req.query.platform) q = q.eq('platform', req.query.platform)
    if (req.query.status) q = q.eq('status', req.query.status)
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  // GET /v1/publish/:id — status of a single publish record
  app.get('/:id', { preHandler: requireScope('publish:read') }, async (req) => {
    const { data, error } = await db
      .from('publish_history')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw notFound()
    return data
  })

  // GET /v1/publish/insights/:account_id/:post_id — fresh platform metrics
  app.get(
    '/insights/:account_id/:post_id',
    { preHandler: requireScope('analytics:read') },
    async (req) => {
      const acc = await loadAccount(req.user.id, req.params.account_id)
      const accessToken = decryptToken(acc.access_token_encrypted)
      return await getPlatformInsights({
        platform: acc.platform,
        accessToken,
        postId: req.params.post_id,
      })
    },
  )
}
