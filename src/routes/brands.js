import { db } from '../db.js'
import { requireScope } from '../middleware/auth.js'
import { notFound, badRequest } from '../utils/errors.js'
import { parsePagination, requireString } from '../utils/validate.js'

export default async function brandsRoutes(app) {
  app.get('/', { preHandler: requireScope('content:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    const { data, error } = await db
      .from('brands')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  app.get('/:id', { preHandler: requireScope('content:read') }, async (req) => {
    const { data, error } = await db
      .from('brands')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw notFound('Brand tidak ditemukan')
    return data
  })

  app.post('/', { preHandler: requireScope('content:write') }, async (req) => {
    const b = req.body || {}
    requireString(b.name, 'name', { max: 120 })
    const { data, error } = await db
      .from('brands')
      .insert({
        user_id: req.user.id,
        name: b.name,
        niche: b.niche,
        description: b.description,
        target_audience: b.target_audience,
        tone: b.tone,
        favorite_words: b.favorite_words,
        avoided_words: b.avoided_words,
        primary_color: b.primary_color,
        secondary_color: b.secondary_color,
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
    const { data, error } = await db
      .from('brands')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single()
    if (error) throw error
    if (!data) throw notFound('Brand tidak ditemukan')
    return data
  })

  app.delete('/:id', { preHandler: requireScope('content:write') }, async (req, reply) => {
    const { error } = await db
      .from('brands')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    if (error) throw error
    reply.code(204).send()
  })

  // Products nested under brand
  app.get('/:id/products', { preHandler: requireScope('content:read') }, async (req) => {
    const { data, error } = await db
      .from('products')
      .select('*')
      .eq('brand_id', req.params.id)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return { data }
  })
}
