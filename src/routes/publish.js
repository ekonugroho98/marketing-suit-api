// ============================================
// Publish + Insights routes — for Social Media Agent
// ============================================
import { db } from '../db.js'
import { decryptToken } from '../crypto.js'
import { publishToPlatform, getPlatformInsights } from '../services/publishers.js'
import { fetchThreadsPostsWithInsights, fetchThreadsAccountClicks, deleteThreadsPost, searchThreads, fetchThreadsMentions, fetchThreadsReplies, fetchThreadsConversation, fetchThreadsProfile } from '../services/threads.js'
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

  // POST /v1/publish/threads-insights — sync Threads posts + insights
  // body: { account_id, limit?, save? }
  app.post(
    '/threads-insights',
    { preHandler: requireScope('analytics:read') },
    async (req) => {
      const b = req.body || {}
      if (!b.account_id) throw badRequest('account_id wajib')
      const limit = Math.min(Math.max(Number(b.limit) || 25, 1), 50)
      const save = Boolean(b.save)

      const acc = await loadAccount(req.user.id, b.account_id)
      if (acc.platform !== 'threads') throw badRequest('Akun bukan Threads')
      const accessToken = decryptToken(acc.access_token_encrypted)

      const posts = await fetchThreadsPostsWithInsights({
        accessToken,
        platformUserId: acc.platform_user_id,
        limit,
      })

      let accountLinkClicks = []
      if (acc.platform_user_id) {
        accountLinkClicks = await fetchThreadsAccountClicks({
          accessToken,
          platformUserId: acc.platform_user_id,
        })
      }

      // Optionally save to threads_post_insights table
      if (save && posts.length) {
        const rows = posts.map((p) => ({
          user_id: req.user.id,
          connected_account_id: acc.id,
          platform_post_id: p.id,
          post_text: p.text ?? null,
          permalink: p.permalink ?? null,
          link_attachment_url: p.link_attachment_url ?? null,
          media_type: p.media_type ?? null,
          metrics: p.metrics,
          fetched_at: new Date().toISOString(),
        }))
        const { error: upErr } = await db
          .from('threads_post_insights')
          .upsert(rows, { onConflict: 'connected_account_id,platform_post_id' })
        if (upErr) throw new Error(`Gagal simpan insights: ${upErr.message}`)
      }

      return {
        accountId: acc.id,
        username: acc.platform_username,
        posts,
        accountLinkClicks,
        fetchedAt: new Date().toISOString(),
      }
    },
  )

  // DELETE /v1/publish/:account_id/:post_id — delete a Threads post
  app.delete(
    '/:account_id/:post_id',
    { preHandler: requireScope('publish:write') },
    async (req) => {
      const acc = await loadAccount(req.user.id, req.params.account_id)
      if (acc.platform !== 'threads') throw badRequest('Akun bukan Threads')
      const accessToken = decryptToken(acc.access_token_encrypted)
      const result = await deleteThreadsPost({
        accessToken,
        postId: req.params.post_id,
      })
      return { success: true, postId: req.params.post_id, ...result }
    },
  )

  // GET /v1/publish/threads-search?account_id=UUID&q=KEYWORD — search Threads
  app.get(
    '/threads-search',
    { preHandler: requireScope('analytics:read') },
    async (req) => {
      const { account_id, q, limit = 25 } = req.query
      if (!account_id) throw badRequest('account_id wajib')
      if (!q) throw badRequest('q (keyword) wajib')
      const acc = await loadAccount(req.user.id, account_id)
      if (acc.platform !== 'threads') throw badRequest('Akun bukan Threads')
      const accessToken = decryptToken(acc.access_token_encrypted)
      return await searchThreads({
        accessToken,
        platformUserId: acc.platform_user_id,
        query: q,
        limit: Math.min(Number(limit) || 25, 100),
      })
    },
  )

  // GET /v1/publish/threads-mentions?account_id=UUID — fetch mentions
  app.get(
    '/threads-mentions',
    { preHandler: requireScope('analytics:read') },
    async (req) => {
      const { account_id, limit = 25 } = req.query
      if (!account_id) throw badRequest('account_id wajib')
      const acc = await loadAccount(req.user.id, account_id)
      if (acc.platform !== 'threads') throw badRequest('Akun bukan Threads')
      const accessToken = decryptToken(acc.access_token_encrypted)
      return await fetchThreadsMentions({
        accessToken,
        limit: Math.min(Number(limit) || 25, 100),
      })
    },
  )

  // GET /v1/publish/threads-replies/:account_id/:post_id — fetch replies to a post
  app.get(
    '/threads-replies/:account_id/:post_id',
    { preHandler: requireScope('analytics:read') },
    async (req) => {
      const acc = await loadAccount(req.user.id, req.params.account_id)
      if (acc.platform !== 'threads') throw badRequest('Akun bukan Threads')
      const accessToken = decryptToken(acc.access_token_encrypted)
      return await fetchThreadsReplies({
        accessToken,
        postId: req.params.post_id,
      })
    },
  )

  // GET /v1/publish/threads-conversation/:account_id/:post_id — fetch full conversation
  app.get(
    '/threads-conversation/:account_id/:post_id',
    { preHandler: requireScope('analytics:read') },
    async (req) => {
      const acc = await loadAccount(req.user.id, req.params.account_id)
      if (acc.platform !== 'threads') throw badRequest('Akun bukan Threads')
      const accessToken = decryptToken(acc.access_token_encrypted)
      return await fetchThreadsConversation({
        accessToken,
        postId: req.params.post_id,
      })
    },
  )

  // GET /v1/publish/threads-profile/:account_id — fetch public profile
  app.get(
    '/threads-profile/:account_id',
    { preHandler: requireScope('accounts:read') },
    async (req) => {
      const acc = await loadAccount(req.user.id, req.params.account_id)
      if (acc.platform !== 'threads') throw badRequest('Akun bukan Threads')
      const accessToken = decryptToken(acc.access_token_encrypted)
      return await fetchThreadsProfile({
        accessToken,
        userId: acc.platform_user_id,
      })
    },
  )
}
