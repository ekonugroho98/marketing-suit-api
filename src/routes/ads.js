// ============================================
// Ads Manager routes — for Ads Agent
// ============================================
import { db } from '../db.js'
import { requireScope } from '../middleware/auth.js'
import { badRequest, notFound } from '../utils/errors.js'
import { parsePagination, requireString } from '../utils/validate.js'

const VALID_PLATFORMS = ['meta', 'tiktok', 'google']
const VALID_OBJECTIVES = ['awareness', 'traffic', 'conversion', 'retargeting']
const VALID_STATUS = ['draft', 'pending_review', 'active', 'paused', 'completed', 'rejected']

export default async function adsRoutes(app) {
  // ── Campaigns ────────────────────────────

  app.get('/campaigns', { preHandler: requireScope('ads:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    let q = db.from('ads_campaigns').select('*').eq('user_id', req.user.id)
    if (req.query.status) q = q.eq('status', req.query.status)
    if (req.query.platform) q = q.eq('platform', req.query.platform)
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  app.get('/campaigns/:id', { preHandler: requireScope('ads:read') }, async (req) => {
    const { data: campaign, error } = await db
      .from('ads_campaigns')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (error) throw error
    if (!campaign) throw notFound('Campaign tidak ditemukan')

    const { data: creatives } = await db
      .from('ad_creatives')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('user_id', req.user.id)

    return { ...campaign, creatives: creatives || [] }
  })

  app.post('/campaigns', { preHandler: requireScope('ads:write') }, async (req) => {
    const b = req.body || {}
    requireString(b.name, 'name', { max: 200 })
    if (!VALID_PLATFORMS.includes(b.platform)) throw badRequest('platform invalid')
    if (!VALID_OBJECTIVES.includes(b.objective)) throw badRequest('objective invalid')

    const { data, error } = await db
      .from('ads_campaigns')
      .insert({
        user_id: req.user.id,
        brand_id: b.brand_id || null,
        platform: b.platform,
        name: b.name,
        objective: b.objective,
        status: b.status || 'draft',
        daily_budget: b.daily_budget,
        total_budget_limit: b.total_budget_limit,
        start_date: b.start_date,
        end_date: b.end_date,
        audience: b.audience || {},
        saved_audience_id: b.saved_audience_id,
      })
      .select()
      .single()
    if (error) throw error
    return data
  })

  app.patch('/campaigns/:id', { preHandler: requireScope('ads:write') }, async (req) => {
    const patch = { ...req.body, updated_at: new Date().toISOString() }
    delete patch.id
    delete patch.user_id
    if (patch.status && !VALID_STATUS.includes(patch.status)) throw badRequest('status invalid')
    const { data, error } = await db
      .from('ads_campaigns')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single()
    if (error) throw error
    if (!data) throw notFound()
    return data
  })

  app.delete('/campaigns/:id', { preHandler: requireScope('ads:write') }, async (req, reply) => {
    const { error } = await db
      .from('ads_campaigns')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    if (error) throw error
    reply.code(204).send()
  })

  // ── Creatives ────────────────────────────

  app.post('/creatives', { preHandler: requireScope('ads:write') }, async (req) => {
    const b = req.body || {}
    if (!b.campaign_id) throw badRequest('campaign_id wajib')
    const { data, error } = await db
      .from('ad_creatives')
      .insert({
        user_id: req.user.id,
        campaign_id: b.campaign_id,
        primary_text: b.primary_text,
        headline: b.headline,
        description: b.description,
        cta_type: b.cta_type || 'LEARN_MORE',
        media_url: b.media_url,
        destination_url: b.destination_url,
        utm_params: b.utm_params || {},
        generation_id: b.generation_id || null,
        status: b.status || 'draft',
      })
      .select()
      .single()
    if (error) throw error
    return data
  })

  app.patch('/creatives/:id', { preHandler: requireScope('ads:write') }, async (req) => {
    const patch = { ...req.body }
    delete patch.id
    delete patch.user_id
    const { data, error } = await db
      .from('ad_creatives')
      .update(patch)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single()
    if (error) throw error
    if (!data) throw notFound()
    return data
  })

  // ── Insights ────────────────────────────

  // GET /v1/ads/insights?days=7
  app.get('/insights', { preHandler: requireScope('ads:read') }, async (req) => {
    const days = Math.min(Number(req.query.days) || 7, 365)
    const { data, error } = await db.rpc('get_ads_overview', {
      p_user_id: req.user.id,
      p_days: days,
    })
    if (error) throw error
    return { overview: Array.isArray(data) ? data[0] : data, days }
  })

  // GET /v1/ads/insights/campaign/:id?from=..&to=..
  app.get(
    '/insights/campaign/:id',
    { preHandler: requireScope('ads:read') },
    async (req) => {
      // ownership gate
      const { data: owned } = await db
        .from('ads_campaigns')
        .select('id')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .maybeSingle()
      if (!owned) throw notFound('Campaign tidak ditemukan')

      let q = db
        .from('ads_insights_daily')
        .select('*')
        .eq('campaign_id', req.params.id)
      if (req.query.from) q = q.gte('date', req.query.from)
      if (req.query.to) q = q.lte('date', req.query.to)
      const { data, error } = await q.order('date', { ascending: true })
      if (error) throw error
      return { data }
    },
  )

  // POST /v1/ads/insights — upsert daily insights (for sync worker / agent)
  app.post('/insights', { preHandler: requireScope('ads:write') }, async (req) => {
    const b = req.body || {}
    if (!b.campaign_id || !b.date) throw badRequest('campaign_id & date wajib')

    const { data: owned } = await db
      .from('ads_campaigns')
      .select('id')
      .eq('id', b.campaign_id)
      .eq('user_id', req.user.id)
      .maybeSingle()
    if (!owned) throw notFound('Campaign tidak ditemukan')

    const { data, error } = await db
      .from('ads_insights_daily')
      .upsert(
        {
          campaign_id: b.campaign_id,
          date: b.date,
          spend: b.spend || 0,
          impressions: b.impressions || 0,
          reach: b.reach || 0,
          clicks: b.clicks || 0,
          ctr: b.ctr || 0,
          cpc: b.cpc || 0,
          conversions: b.conversions || 0,
          conversion_value: b.conversion_value || 0,
          roas: b.roas || 0,
          raw_data: b.raw_data || {},
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'campaign_id,date' },
      )
      .select()
      .single()
    if (error) throw error
    return data
  })

  // ── Competitor Ads (swipe file) ─────────

  app.get('/competitors', { preHandler: requireScope('ads:read') }, async (req) => {
    const { limit, offset } = parsePagination(req.query)
    const { data, error } = await db
      .from('competitor_ads')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    return { data, pagination: { limit, offset } }
  })

  app.post('/competitors', { preHandler: requireScope('ads:write') }, async (req) => {
    const b = req.body || {}
    requireString(b.brand_name, 'brand_name', { max: 200 })
    const { data, error } = await db
      .from('competitor_ads')
      .insert({
        user_id: req.user.id,
        brand_name: b.brand_name,
        ad_text: b.ad_text,
        media_url: b.media_url,
        platform: b.platform,
        ad_library_id: b.ad_library_id,
        ai_analysis: b.ai_analysis,
        tags: b.tags,
        is_favorite: b.is_favorite || false,
      })
      .select()
      .single()
    if (error) throw error
    return data
  })
}
