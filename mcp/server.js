#!/usr/bin/env node
// ============================================
// Karaya MCP Server (stdio transport)
//
// Exposes the Karaya REST API as MCP tools so Claude Desktop
// or any MCP-capable client (Hermes agent, Cline, etc.) can
// invoke them with function-calling semantics.
//
// Config (env):
//   KARAYA_API_URL   — base URL of the Fastify API (e.g. http://localhost:3001)
//   KARAYA_API_KEY   — Bearer token (kry_live_...)
//
// Claude Desktop config example (claude_desktop_config.json):
// {
//   "mcpServers": {
//     "karaya": {
//       "command": "node",
//       "args": ["/abs/path/to/api/mcp/server.js"],
//       "env": {
//         "KARAYA_API_URL": "https://api.karaya.id",
//         "KARAYA_API_KEY": "kry_live_xxxxx"
//       }
//     }
//   }
// }
// ============================================
import 'dotenv/config'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const BASE = (process.env.KARAYA_API_URL || 'http://localhost:3001').replace(/\/$/, '')
const KEY = process.env.KARAYA_API_KEY
if (!KEY) {
  console.error('[karaya-mcp] KARAYA_API_KEY env var is required')
  process.exit(1)
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text } }
  if (!res.ok) {
    const msg = parsed?.error || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return parsed
}

// ── Tool definitions ────────────────────────────

const TOOLS = [
  {
    name: 'whoami',
    description: 'Verifikasi API key dan ambil profil user + scopes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => api('GET', '/v1/auth/whoami'),
  },
  {
    name: 'list_brands',
    description: 'Ambil daftar brand milik user.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    handler: (a) => api('GET', `/v1/brands?limit=${a.limit || 20}`),
  },
  {
    name: 'get_brand',
    description: 'Detail brand tertentu (brand voice, tone, target audience).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: (a) => api('GET', `/v1/brands/${a.id}`),
  },
  {
    name: 'list_products',
    description: 'Daftar produk (optional filter by brand_id).',
    inputSchema: {
      type: 'object',
      properties: { brand_id: { type: 'string' }, limit: { type: 'number' } },
    },
    handler: (a) => {
      const q = new URLSearchParams()
      if (a.brand_id) q.set('brand_id', a.brand_id)
      if (a.limit) q.set('limit', a.limit)
      return api('GET', `/v1/products?${q}`)
    },
  },
  {
    name: 'generate_content',
    description:
      'Generate konten AI (caption, carousel, ad copy, thread, dll). Kirim systemPrompt + userPrompt. Opsional type/platform/pillar untuk logging.',
    inputSchema: {
      type: 'object',
      properties: {
        systemPrompt: { type: 'string' },
        userPrompt: { type: 'string' },
        temperature: { type: 'number' },
        maxTokens: { type: 'number' },
        provider: { type: 'string', description: 'groq|openai|anthropic|google|openrouter|custom' },
        modelId: { type: 'string' },
        type: { type: 'string', enum: ['caption','carousel','ad_copy','thread','repurpose','video_script','hashtags'] },
        platform: { type: 'string' },
        pillar: { type: 'string' },
        brand_id: { type: 'string' },
        product_id: { type: 'string' },
      },
      required: ['systemPrompt', 'userPrompt'],
    },
    handler: (a) => api('POST', '/v1/content/generate', a),
  },
  {
    name: 'save_content',
    description: 'Simpan hasil generate ke library.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        content: { type: 'string' },
        title: { type: 'string' },
        brand_id: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        generation_id: { type: 'string' },
      },
      required: ['type', 'content'],
    },
    handler: (a) => api('POST', '/v1/content/save', a),
  },
  {
    name: 'list_accounts',
    description: 'List akun sosmed yang sudah terhubung (Threads/IG/TikTok/...).',
    inputSchema: {
      type: 'object',
      properties: { platform: { type: 'string' }, status: { type: 'string' } },
    },
    handler: (a) => {
      const q = new URLSearchParams()
      if (a.platform) q.set('platform', a.platform)
      if (a.status) q.set('status', a.status)
      return api('GET', `/v1/accounts?${q}`)
    },
  },
  {
    name: 'publish',
    description:
      'Publish konten ke 1+ akun. items: [{ account_id, caption, media_urls?, hashtags?, reply_to_id? }].',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              account_id: { type: 'string' },
              caption: { type: 'string' },
              media_urls: { type: 'array', items: { type: 'string' } },
              hashtags: { type: 'array', items: { type: 'string' } },
              reply_to_id: { type: 'string' },
              content_id: { type: 'string' },
            },
            required: ['account_id'],
          },
        },
      },
      required: ['items'],
    },
    handler: (a) => api('POST', '/v1/publish', a),
  },
  {
    name: 'schedule_content',
    description: 'Buat entri content_calendar (draft/scheduled).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        type: { type: 'string' },
        platform: { type: 'string' },
        pillar: { type: 'string' },
        brand_id: { type: 'string' },
        scheduled_date: { type: 'string' },
        scheduled_time: { type: 'string' },
        status: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
        media_urls: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'type', 'platform', 'brand_id'],
    },
    handler: (a) => api('POST', '/v1/schedule', a),
  },
  {
    name: 'list_scheduled',
    description: 'List konten yang terjadwal (filter by date range / status).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        status: { type: 'string' },
        platform: { type: 'string' },
      },
    },
    handler: (a) => {
      const q = new URLSearchParams(a)
      return api('GET', `/v1/schedule?${q}`)
    },
  },
  {
    name: 'list_ads_campaigns',
    description: 'List ads campaigns.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string' }, platform: { type: 'string' } },
    },
    handler: (a) => {
      const q = new URLSearchParams(a)
      return api('GET', `/v1/ads/campaigns?${q}`)
    },
  },
  {
    name: 'create_ads_campaign',
    description: 'Buat ads campaign baru.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        platform: { type: 'string', enum: ['meta', 'tiktok', 'google'] },
        objective: { type: 'string', enum: ['awareness', 'traffic', 'conversion', 'retargeting'] },
        daily_budget: { type: 'number' },
        brand_id: { type: 'string' },
        audience: { type: 'object' },
      },
      required: ['name', 'platform', 'objective'],
    },
    handler: (a) => api('POST', '/v1/ads/campaigns', a),
  },
  {
    name: 'update_ads_campaign',
    description: 'Update status/budget campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        daily_budget: { type: 'number' },
      },
      required: ['id'],
    },
    handler: (a) => {
      const { id, ...patch } = a
      return api('PATCH', `/v1/ads/campaigns/${id}`, patch)
    },
  },
  {
    name: 'ads_overview',
    description: 'Ringkasan ads (spend, CTR, CPC, ROAS) untuk N hari terakhir.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number' } },
    },
    handler: (a) => api('GET', `/v1/ads/insights?days=${a.days || 7}`),
  },
  {
    name: 'analytics_overview',
    description: 'Ringkasan total: generations, published posts, brands, links, kuota bulan ini.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => api('GET', '/v1/analytics/overview'),
  },
  {
    name: 'create_smart_link',
    description: 'Buat smart link (short URL + UTM).',
    inputSchema: {
      type: 'object',
      properties: {
        destination_url: { type: 'string' },
        slug: { type: 'string' },
        title: { type: 'string' },
        utm_source: { type: 'string' },
        utm_medium: { type: 'string' },
        utm_campaign: { type: 'string' },
        brand_id: { type: 'string' },
      },
      required: ['destination_url'],
    },
    handler: (a) => api('POST', '/v1/links', a),
  },
]

// ── MCP server wiring ───────────────────────────

const server = new Server(
  { name: 'karaya', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({
    name, description, inputSchema,
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name)
  if (!tool) throw new Error(`Tool '${req.params.name}' tidak dikenali`)
  try {
    const result = await tool.handler(req.params.arguments || {})
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${err.message}` }],
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('[karaya-mcp] Ready')
