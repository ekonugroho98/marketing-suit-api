import { db } from '../db.js'
import { requireScope } from '../middleware/auth.js'
import { notFound, badRequest } from '../utils/errors.js'
import { parsePagination, requireString } from '../utils/validate.js'

export default async function productsRoutes(app) {
  app.get('/', { preHandler: requireScope('content:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    let q = db.from('products').select('*').eq('user_id', req.user.id)
    if (req.query.brand_id) q = q.eq('brand_id', req.query.brand_id)
    if (req.query.is_active !== undefined) {
      q = q.eq('is_active', req.query.is_active === 'true')
    }
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  app.get('/:id', { preHandler: requireScope('content:read') }, async (req) => {
    const { data, error } = await db
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw notFound('Produk tidak ditemukan')
    return data
  })

  app.post('/', { preHandler: requireScope('content:write') }, async (req) => {
    const b = req.body || {}
    requireString(b.name, 'name', { max: 200 })
    if (!b.brand_id) throw badRequest('brand_id wajib')
    const { data, error } = await db
      .from('products')
      .insert({
        user_id: req.user.id,
        brand_id: b.brand_id,
        name: b.name,
        description: b.description,
        price: b.price ?? 0,
        currency: b.currency || 'IDR',
        link: b.link,
        usp: b.usp,
        features: b.features,
        images: b.images,
        is_active: b.is_active ?? true,
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
      .from('products')
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
      .from('products')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    if (error) throw error
    reply.code(204).send()
  })
}
