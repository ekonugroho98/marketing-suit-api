// ============================================
// Smart Links (short URL + UTM tracking) routes
// ============================================
import { db } from '../db.js'
import { customAlphabet } from 'nanoid'
import { requireScope } from '../middleware/auth.js'
import { badRequest, notFound, conflict } from '../utils/errors.js'
import { parsePagination, requireString } from '../utils/validate.js'

const genSlug = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 7)

export default async function linksRoutes(app) {
  app.get('/', { preHandler: requireScope('analytics:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    let q = db.from('smart_links').select('*').eq('user_id', req.user.id)
    if (req.query.brand_id) q = q.eq('brand_id', req.query.brand_id)
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  app.get('/:id', { preHandler: requireScope('analytics:read') }, async (req) => {
    const { data, error } = await db
      .from('smart_links')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw notFound()
    return data
  })

  app.post('/', { preHandler: requireScope('content:write') }, async (req) => {
    const b = req.body || {}
    requireString(b.destination_url, 'destination_url', { max: 2000 })
    let slug = (b.slug || '').trim().toLowerCase()
    if (!slug) slug = genSlug()
    if (!/^[a-z0-9-]{3,50}$/.test(slug)) {
      throw badRequest('slug harus 3-50 karakter alfanumerik/dash')
    }

    const { data: existing } = await db
      .from('smart_links')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (existing) throw conflict(`Slug '${slug}' sudah digunakan`)

    const { data, error } = await db
      .from('smart_links')
      .insert({
        user_id: req.user.id,
        brand_id: b.brand_id || null,
        slug,
        destination_url: b.destination_url,
        title: b.title,
        utm_source: b.utm_source,
        utm_medium: b.utm_medium,
        utm_campaign: b.utm_campaign,
        utm_term: b.utm_term,
        utm_content: b.utm_content,
        is_active: b.is_active ?? true,
      })
      .select()
      .single()
    if (error) throw error
    return data
  })

  app.patch('/:id', { preHandler: requireScope('content:write') }, async (req) => {
    const patch = { ...req.body }
    delete patch.id
    delete patch.user_id
    delete patch.slug // slug is immutable once set
    const { data, error } = await db
      .from('smart_links')
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
      .from('smart_links')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    if (error) throw error
    reply.code(204).send()
  })

  // GET /v1/links/:id/clicks — click analytics
  app.get('/:id/clicks', { preHandler: requireScope('analytics:read') }, async (req) => {
    // verify ownership
    const { data: link } = await db
      .from('smart_links')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (!link) throw notFound()

    const { limit, offset } = parsePagination(req.query)
    const { data, error } = await db
      .from('link_clicks')
      .select('*')
      .eq('link_id', req.params.id)
      .order('clicked_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })
}
