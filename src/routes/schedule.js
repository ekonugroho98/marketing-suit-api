// ============================================
// Content Calendar / Schedule routes
// ============================================
import { db } from '../db.js'
import { requireScope } from '../middleware/auth.js'
import { badRequest, notFound } from '../utils/errors.js'
import { parsePagination, requireString } from '../utils/validate.js'

const VALID_TYPES = ['caption', 'carousel', 'thread', 'ad_copy', 'reels', 'story', 'video']
const VALID_PLATFORMS = ['instagram', 'threads', 'tiktok', 'twitter', 'youtube', 'facebook']
const VALID_PILLARS = ['awareness', 'showcase', 'education', 'social_proof']
const VALID_STATUS = ['draft', 'approved', 'scheduled', 'published', 'failed']

export default async function scheduleRoutes(app) {
  // GET /v1/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
  app.get('/', { preHandler: requireScope('content:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    let q = db.from('content_calendar').select('*').eq('user_id', req.user.id)
    if (req.query.from) q = q.gte('scheduled_date', req.query.from)
    if (req.query.to) q = q.lte('scheduled_date', req.query.to)
    if (req.query.status) q = q.eq('status', req.query.status)
    if (req.query.platform) q = q.eq('platform', req.query.platform)
    if (req.query.brand_id) q = q.eq('brand_id', req.query.brand_id)
    const { data, error } = await q
      .order('scheduled_date', { ascending: true })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  app.get('/:id', { preHandler: requireScope('content:read') }, async (req) => {
    const { data, error } = await db
      .from('content_calendar')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw notFound()
    return data
  })

  // POST /v1/schedule — create scheduled content
  app.post('/', { preHandler: requireScope('content:write') }, async (req) => {
    const b = req.body || {}
    requireString(b.title, 'title', { max: 500 })
    if (!b.brand_id) throw badRequest('brand_id wajib')
    if (!VALID_TYPES.includes(b.type)) throw badRequest(`type harus: ${VALID_TYPES.join(', ')}`)
    if (!VALID_PLATFORMS.includes(b.platform)) throw badRequest(`platform harus: ${VALID_PLATFORMS.join(', ')}`)
    if (b.pillar && !VALID_PILLARS.includes(b.pillar)) throw badRequest('pillar invalid')
    if (b.status && !VALID_STATUS.includes(b.status)) throw badRequest('status invalid')

    const { data, error } = await db
      .from('content_calendar')
      .insert({
        user_id: req.user.id,
        brand_id: b.brand_id,
        generation_id: b.generation_id || null,
        title: b.title,
        body: b.body,
        type: b.type,
        platform: b.platform,
        pillar: b.pillar,
        scheduled_date: b.scheduled_date,
        scheduled_time: b.scheduled_time,
        status: b.status || 'scheduled',
        hashtags: b.hashtags,
        media_urls: b.media_urls,
        notes: b.notes,
      })
      .select()
      .single()
    if (error) throw error
    return data
  })

  app.patch('/:id', { preHandler: requireScope('content:write') }, async (req) => {
    const patch = { ...req.body, updated_at: new Date().toISOString() }
    delete patch.id
    delete patch.user_id
    if (patch.status && !VALID_STATUS.includes(patch.status)) throw badRequest('status invalid')
    const { data, error } = await db
      .from('content_calendar')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single()
    if (error) throw error
    if (!data) throw notFound()
    return data
  })

  app.delete('/:id', { preHandler: requireScope('content:write') }, async (req, reply) => {
    const { error } = await db
      .from('content_calendar')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    if (error) throw error
    reply.code(204).send()
  })
}
