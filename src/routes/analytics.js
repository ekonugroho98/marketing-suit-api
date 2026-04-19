// ============================================
// Analytics routes
// ============================================
import { db } from '../db.js'
import { requireScope } from '../middleware/auth.js'
import { parsePagination } from '../utils/validate.js'

export default async function analyticsRoutes(app) {
  // GET /v1/analytics/content — basic performance list from publish_history
  app.get('/content', { preHandler: requireScope('analytics:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    let q = db
      .from('publish_history')
      .select('id, platform, platform_post_id, published_url, status, published_at, payload')
      .eq('user_id', req.user.id)
      .eq('status', 'published')
    if (req.query.platform) q = q.eq('platform', req.query.platform)
    if (req.query.from) q = q.gte('published_at', req.query.from)
    if (req.query.to) q = q.lte('published_at', req.query.to)
    const { data, error } = await q
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  // GET /v1/analytics/overview — counters across modules
  app.get('/overview', { preHandler: requireScope('analytics:read') }, async (req) => {
    const userId = req.user.id
    const [genCount, pubCount, brandCount, linkCount] = await Promise.all([
      db.from('generation_history').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      db.from('publish_history').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'published'),
      db.from('brands').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      db.from('smart_links').select('*', { count: 'exact', head: true }).eq('user_id', userId),
    ])

    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    const { data: usage } = await db
      .from('usage_monthly')
      .select('generation_count, generation_limit')
      .eq('user_id', userId)
      .eq('month', monthStart.toISOString().slice(0, 10))
      .maybeSingle()

    return {
      totals: {
        generations: genCount.count || 0,
        published_posts: pubCount.count || 0,
        brands: brandCount.count || 0,
        smart_links: linkCount.count || 0,
      },
      usage_this_month: usage || { generation_count: 0, generation_limit: 50 },
    }
  })
}
