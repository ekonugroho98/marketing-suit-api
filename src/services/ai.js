// ============================================
// Multi-provider AI service — Node.js port of
// supabase/functions/generate-content/index.ts
// Supports: Groq, OpenAI, Anthropic, Gemini, OpenRouter, Custom
// ============================================
import { db } from '../db.js'
import { decryptToken } from '../crypto.js'
import { config } from '../config.js'
import { badRequest, serverError, tooMany } from '../utils/errors.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const LEGACY_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
const PRIMARY = 'llama-3.3-70b-versatile'
const FALLBACK = 'llama-3.1-8b-instant'

function monthDate() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

async function checkQuota(userId) {
  const { data, error } = await db
    .from('usage_monthly')
    .select('generation_count, generation_limit')
    .eq('user_id', userId)
    .eq('month', monthDate())
    .maybeSingle()
  if (error) throw serverError('Gagal cek kuota', error.message)
  if (data && data.generation_count >= data.generation_limit) {
    throw tooMany(
      `Kuota AI bulan ini habis (${data.generation_count}/${data.generation_limit}).`,
    )
  }
}

async function incrementUsage(userId) {
  const { error } = await db.rpc('increment_usage', {
    p_user_id: userId,
    p_month: monthDate(),
  })
  if (error) console.error('increment_usage failed:', error.message)
}

// ── Provider call helpers ────────

async function callOpenAICompatible({
  apiBaseUrl,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  jsonMode,
  authHeader = 'Authorization',
  authPrefix = 'Bearer',
}) {
  const base = apiBaseUrl.endsWith('/') ? apiBaseUrl.slice(0, -1) : apiBaseUrl
  const body = { model, messages, temperature, max_tokens: maxTokens }
  if (jsonMode) body.response_format = { type: 'json_object' }

  const headers = { 'Content-Type': 'application/json' }
  headers[authHeader] = authPrefix ? `${authPrefix} ${apiKey}` : apiKey

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw serverError(`AI provider error (${res.status})`, t)
  }
  const data = await res.json()
  return {
    content: data.choices?.[0]?.message?.content || '',
    tokensUsed: data.usage?.total_tokens || 0,
  }
}

async function callAnthropic({ apiKey, model, messages, temperature, maxTokens, jsonMode }) {
  let system = ''
  const userMsgs = []
  for (const m of messages) {
    if (m.role === 'system') system += (system ? '\n\n' : '') + m.content
    else userMsgs.push(m)
  }
  if (jsonMode && system) system += '\n\nIMPORTANT: Respond with valid JSON only.'

  const body = { model, max_tokens: maxTokens, temperature, messages: userMsgs }
  if (system) body.system = system

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw serverError(`Anthropic error (${res.status})`, await res.text())
  const data = await res.json()
  const content = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
  return { content, tokensUsed }
}

async function callGemini({ apiKey, model, messages, temperature, maxTokens, jsonMode }) {
  let system = ''
  let user = ''
  for (const m of messages) {
    if (m.role === 'system') system += (system ? '\n' : '') + m.content
    else user += (user ? '\n\n' : '') + m.content
  }
  const text = system ? `${system}\n\n${user}` : user
  const gen = { temperature, maxOutputTokens: maxTokens }
  if (jsonMode) gen.responseMimeType = 'application/json'

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: gen }),
  })
  if (!res.ok) throw serverError(`Gemini error (${res.status})`, await res.text())
  const data = await res.json()
  const content =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
  const tokensUsed =
    (data.usageMetadata?.promptTokenCount || 0) +
    (data.usageMetadata?.candidatesTokenCount || 0)
  return { content, tokensUsed }
}

// ── Resolve provider/model + user key ────

async function resolveModelConfig({ userId, provider, modelId, customModelId }) {
  if (customModelId) {
    const { data, error } = await db
      .from('user_custom_models')
      .select(
        `id, model_id, supports_json_mode, max_output_tokens,
         config_id,
         user_ai_configs!inner (
           id, provider_id, api_key_encrypted, custom_base_url, is_active,
           ai_providers!inner ( id, name, api_base_url, is_openai_compatible,
             auth_header, auth_prefix, requires_user_key )
         )`,
      )
      .eq('id', customModelId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle()
    if (error || !data) throw badRequest('Custom model tidak ditemukan')
    const cfg = data.user_ai_configs
    if (!cfg.is_active) throw badRequest('Konfigurasi provider custom non-aktif')
    const prov = cfg.ai_providers
    const apiKey = cfg.api_key_encrypted ? decryptToken(cfg.api_key_encrypted) : ''
    return {
      providerId: prov.id,
      modelId: data.model_id,
      apiKey,
      apiBaseUrl: cfg.custom_base_url || prov.api_base_url,
      providerConfig: prov,
      maxOutputTokens: data.max_output_tokens,
      supportsJsonMode: data.supports_json_mode,
    }
  }

  if (modelId) {
    const { data, error } = await db
      .from('ai_models')
      .select(
        `id, model_id, provider_id, max_output_tokens, supports_json_mode,
         ai_providers!inner ( id, name, api_base_url, is_openai_compatible,
           auth_header, auth_prefix, requires_user_key )`,
      )
      .eq('id', modelId)
      .eq('is_active', true)
      .maybeSingle()
    if (error || !data) throw badRequest(`Model '${modelId}' tidak ditemukan`)
    return await attachKey(userId, data.ai_providers, data.model_id, {
      maxOutputTokens: data.max_output_tokens,
      supportsJsonMode: data.supports_json_mode,
    })
  }

  if (provider) {
    const { data: provData, error: pErr } = await db
      .from('ai_providers')
      .select('*')
      .eq('id', provider)
      .eq('is_active', true)
      .maybeSingle()
    if (pErr || !provData) throw badRequest(`Provider '${provider}' tidak ditemukan`)
    const { data: first } = await db
      .from('ai_models')
      .select('id, model_id, max_output_tokens, supports_json_mode')
      .eq('provider_id', provider)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!first) throw badRequest(`Belum ada model aktif untuk provider ${provData.name}`)
    return await attachKey(userId, provData, first.model_id, {
      maxOutputTokens: first.max_output_tokens,
      supportsJsonMode: first.supports_json_mode,
    })
  }

  throw badRequest('provider / modelId / customModelId wajib di-set')
}

async function attachKey(userId, providerConfig, modelId, extras) {
  let apiKey = ''
  if (providerConfig.requires_user_key) {
    const { data: uc } = await db
      .from('user_ai_configs')
      .select('api_key_encrypted, custom_base_url, is_active')
      .eq('user_id', userId)
      .eq('provider_id', providerConfig.id)
      .eq('is_active', true)
      .maybeSingle()
    if (!uc?.api_key_encrypted) {
      throw badRequest(
        `API key untuk provider ${providerConfig.name} belum dikonfigurasi`,
      )
    }
    apiKey = decryptToken(uc.api_key_encrypted)
  } else if (providerConfig.id === 'groq') {
    apiKey = config.groqApiKey
    if (!apiKey) throw serverError('GROQ_API_KEY tidak di-set di server')
  }
  return {
    providerId: providerConfig.id,
    modelId,
    apiKey,
    apiBaseUrl: providerConfig.api_base_url,
    providerConfig,
    ...extras,
  }
}

// ── Main entry ────

export async function generate({
  userId,
  systemPrompt,
  userPrompt,
  temperature = 0.8,
  maxTokens = 2000,
  model,        // legacy Groq flow
  provider,
  modelId,
  customModelId,
  jsonMode = true,
}) {
  if (!systemPrompt || !userPrompt) throw badRequest('systemPrompt & userPrompt wajib')
  if (systemPrompt.length > 10000) throw badRequest('systemPrompt max 10000 char')
  if (userPrompt.length > 60000) throw badRequest('userPrompt max 60000 char')
  if (temperature < 0 || temperature > 2) throw badRequest('temperature 0-2')
  if (maxTokens < 1 || maxTokens > 65536) throw badRequest('maxTokens 1-65536')

  await checkQuota(userId)

  const isMultiProvider = Boolean(provider || modelId || customModelId)
  let content, tokensUsed, usedModel, usedProvider, didFallback = false

  if (isMultiProvider) {
    const r = await resolveModelConfig({ userId, provider, modelId, customModelId })
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]
    const cappedTokens = r.maxOutputTokens
      ? Math.min(maxTokens, r.maxOutputTokens)
      : maxTokens
    const useJson = jsonMode && r.supportsJsonMode

    let result
    switch (r.providerId) {
      case 'anthropic':
        result = await callAnthropic({
          apiKey: r.apiKey, model: r.modelId, messages,
          temperature, maxTokens: cappedTokens, jsonMode: useJson,
        })
        break
      case 'google':
        result = await callGemini({
          apiKey: r.apiKey, model: r.modelId, messages,
          temperature, maxTokens: cappedTokens, jsonMode: useJson,
        })
        break
      default:
        result = await callOpenAICompatible({
          apiBaseUrl: r.apiBaseUrl,
          apiKey: r.apiKey, model: r.modelId, messages,
          temperature, maxTokens: cappedTokens, jsonMode: useJson,
          authHeader: r.providerConfig.auth_header,
          authPrefix: r.providerConfig.auth_prefix,
        })
    }
    content = result.content
    tokensUsed = result.tokensUsed
    usedModel = r.modelId
    usedProvider = r.providerId
  } else {
    // Legacy Groq flow
    if (!config.groqApiKey) throw serverError('GROQ_API_KEY not configured')
    if (model && !LEGACY_MODELS.includes(model)) throw badRequest('model tidak valid')
    const requested = model || PRIMARY
    usedProvider = 'groq'

    const callGroq = async (m) =>
      fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.groqApiKey}`,
        },
        body: JSON.stringify({
          model: m,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
      })

    let res = await callGroq(requested)
    usedModel = requested
    if (res.status === 429 && requested === PRIMARY) {
      res = await callGroq(FALLBACK)
      usedModel = FALLBACK
      didFallback = true
    }
    if (!res.ok) {
      throw serverError(`Groq API error ${res.status}`, await res.text())
    }
    const data = await res.json()
    content = data.choices[0].message.content
    tokensUsed = data.usage?.total_tokens || 0
  }

  await incrementUsage(userId)
  return { content, tokensUsed, model: usedModel, provider: usedProvider, fallback: didFallback }
}
