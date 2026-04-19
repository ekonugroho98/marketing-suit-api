// ============================================
// Content Generator routes — for Content Agent
// ============================================
import { db } from '../db.js'
import { generate } from '../services/ai.js'
import { requireScope } from '../middleware/auth.js'
import { badRequest, notFound } from '../utils/errors.js'
import { parsePagination, requireString } from '../utils/validate.js'

const GEN_TYPES = [
  'caption', 'carousel', 'ad_copy', 'thread',
  'repurpose', 'video_script', 'hashtags',
]

export default async function contentRoutes(app) {
  // POST /v1/content/generate — raw AI generation with prompt pair.
  // Content agent biasanya sudah menyiapkan prompt, kita cuma eksekusi.
  app.post('/generate', { preHandler: requireScope('content:write') }, async (req) => {
    const b = req.body || {}
    const result = await generate({
      userId: req.user.id,
      systemPrompt: b.systemPrompt,
      userPrompt: b.userPrompt,
      temperature: b.temperature ?? 0.8,
      maxTokens: b.maxTokens ?? 2000,
      model: b.model,
      provider: b.provider,
      modelId: b.modelId,
      customModelId: b.customModelId,
      jsonMode: b.jsonMode ?? false,
    })

    // Optionally log to generation_history if type provided
    let historyId = null
    if (b.type) {
      if (!GEN_TYPES.includes(b.type)) throw badRequest(`type invalid. allowed: ${GEN_TYPES.join(', ')}`)
      let outputJson
      try { outputJson = JSON.parse(result.content) } catch { outputJson = { raw: result.content } }
      const { data: hist } = await db
        .from('generation_history')
        .insert({
          user_id: req.user.id,
          brand_id: b.brand_id || null,
          product_id: b.product_id || null,
          type: b.type,
          platform: b.platform || null,
          pillar: b.pillar || null,
          input_params: { systemPrompt: b.systemPrompt?.slice(0, 500), userPrompt: b.userPrompt?.slice(0, 500), provider: result.provider },
          output: outputJson,
          model: result.model,
          tokens_used: result.tokensUsed,
        })
        .select('id')
        .single()
      historyId = hist?.id
    }

    return { ...result, generation_id: historyId }
  })

  // GET /v1/content/history — list past generations
  app.get('/history', { preHandler: requireScope('content:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    let q = db.from('generation_history').select('*').eq('user_id', req.user.id)
    if (req.query.type) q = q.eq('type', req.query.type)
    if (req.query.brand_id) q = q.eq('brand_id', req.query.brand_id)
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  app.get('/history/:id', { preHandler: requireScope('content:read') }, async (req) => {
    const { data, error } = await db
      .from('generation_history')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (error) throw error
    if (!data) throw notFound()
    return data
  })

  // POST /v1/content/save — save to library
  app.post('/save', { preHandler: requireScope('content:write') }, async (req) => {
    const b = req.body || {}
    requireString(b.content, 'content', { max: 20000 })
    if (!b.type) throw badRequest('type wajib')
    const { data, error } = await db
      .from('saved_content')
      .insert({
        user_id: req.user.id,
        brand_id: b.brand_id || null,
        generation_id: b.generation_id || null,
        type: b.type,
        title: b.title,
        content: b.content,
        metadata: b.metadata || {},
        tags: b.tags || [],
        is_favorite: b.is_favorite || false,
      })
      .select()
      .single()
    if (error) throw error
    return data
  })

  // GET /v1/content/library
  app.get('/library', { preHandler: requireScope('content:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    let q = db.from('saved_content').select('*').eq('user_id', req.user.id)
    if (req.query.type) q = q.eq('type', req.query.type)
    if (req.query.is_favorite === 'true') q = q.eq('is_favorite', true)
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })
}
