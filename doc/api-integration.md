# Karaya Agent Integration API — Reference

> **Audience:** AI assistants (Claude, Cursor, etc.) & engineers continuing work on `/api`.
> **Scope:** Everything needed to understand, operate, and extend the external REST/MCP API used by VPS agents (Hermes, n8n, MCP clients).
> **Last updated:** 2026-04-16 — initial build (Fastify + MCP adapter).

---

## 1. Purpose

The web app (`src/`) authenticates end-users with Supabase JWT. **Agents on a VPS cannot carry a user JWT.** They need long-lived credentials with scoped permissions. This API layer provides:

- **REST API** at `/api` — Fastify 5, Node 20+, for any HTTP-capable agent (Hermes, n8n, Python/Go scripts).
- **MCP Server** at `/api/mcp` — stdio transport for Claude Desktop / MCP-capable agents.
- **API key auth** — SHA-256 hashed tokens, per-key scopes, per-key rate limits.

Single source of truth: the REST API. MCP tools just call REST endpoints internally — so any behavior change in REST automatically propagates to MCP. Never duplicate business logic in the MCP adapter.

---

## 2. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│  Web App (React + Vite)        ──JWT──▶  Supabase Edge Fns      │
│  src/                                    supabase/functions/    │
│                                                                 │
│  Agents (Hermes / n8n / ...)  ──API key──▶  Fastify API         │
│                                              api/src/           │
│                                                                 │
│  Claude Desktop (MCP)          ──stdio──▶  MCP adapter          │
│                                              api/mcp/           │
│                                                  │              │
│                                                  ▼ HTTP         │
│                                              Fastify API        │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                     ┌─────────────────────────┐
                     │  Supabase (Postgres)    │
                     │  service-role client    │
                     │  bypasses RLS; every    │
                     │  query scoped by        │
                     │  user_id manually.      │
                     └─────────────────────────┘
                                 │
                                 ▼
              Groq / OpenAI / Anthropic / Gemini / ...
              Meta Graph / Threads / Twitter / TikTok / ...
```

### Key design decisions (and why)

| Decision | Rationale |
|---|---|
| Separate Fastify app, not more Edge Functions | Edge Functions have 150s max runtime & cold start. Agents need long-running capability (Threads polling), webhooks, worker processes. VPS also gives us `pm2 logs`, easier monitoring, and no cold start. |
| API keys are SHA-256 hashed with only `key_prefix` plaintext | Token breach risk minimized. Users never see full token again after creation. |
| Service-role Supabase client, filtered manually by `user_id` | Lets us bypass RLS for efficiency (no auth round-trip per query) while keeping the same isolation. **Every `.from().eq('user_id', req.user.id)` is mandatory** — omitting it leaks data. |
| Scopes per endpoint instead of role-based | Future-proof: a read-only analytics agent should not be able to publish. Default scope set is reasonable for agents; restrict via `--scopes=` CLI flag. |
| In-memory rate limiter (per API key) | Single-VPS deployment is the baseline. For horizontal scaling, swap `windows` Map in `middleware/auth.js` with Redis. |
| MCP adapter calls REST, doesn't talk to DB | Keeps business logic in one place. MCP is a thin translator. |
| OAuth tokens (social platforms) stored encrypted AES-256-GCM | Shared format with Supabase Edge Functions. Both `api/src/crypto.js` (Node) and `supabase/functions/_shared/crypto.ts` (Deno Web Crypto) must produce/consume identical `base64(iv):base64(ct):base64(tag)` strings. Do not change the format without touching both. |

---

## 3. File map (`api/`)

```
api/
├── package.json              — deps: fastify, @supabase/supabase-js, @modelcontextprotocol/sdk
├── .env.example              — every env var is documented here
├── Dockerfile                — multi-arch Node 20 alpine
├── ecosystem.config.cjs      — PM2 cluster config for VPS
├── README.md                 — user-facing quick start + full endpoint table
│
├── src/
│   ├── server.js             — Fastify entry: plugins, v1 router, error handler
│   ├── config.js             — env parsing + required() guards. ONLY place to read process.env
│   ├── db.js                 — singleton Supabase service-role client
│   ├── crypto.js             — AES-256-GCM decryptToken + sha256Hex
│   │
│   ├── middleware/
│   │   ├── auth.js           — apiKeyAuth preHandler + requireScope factory + rate limiter
│   │   └── error.js          — unified error response shape
│   │
│   ├── services/             — Business logic. Reusable across routes & MCP.
│   │   ├── ai.js             — multi-provider dispatch (Groq/OpenAI/Anthropic/Gemini/OpenRouter/custom)
│   │   ├── threads.js        — Threads container→poll→publish flow
│   │   └── publishers.js     — publishToPlatform() dispatcher (1 case per platform)
│   │
│   ├── routes/               — Fastify plugins, one per domain
│   │   ├── auth.js           — /v1/auth/whoami
│   │   ├── brands.js         — /v1/brands/*
│   │   ├── products.js       — /v1/products/*
│   │   ├── content.js        — /v1/content/{generate,save,history,library}
│   │   ├── accounts.js       — /v1/accounts/*          (read-only, masks tokens)
│   │   ├── publish.js        — /v1/publish + /publish/history + /publish/insights/*
│   │   ├── schedule.js       — /v1/schedule/*          (content_calendar CRUD)
│   │   ├── ads.js            — /v1/ads/{campaigns,creatives,insights,competitors}/*
│   │   ├── analytics.js      — /v1/analytics/{overview,content}
│   │   └── links.js          — /v1/links/*             (smart_links + clicks)
│   │
│   └── utils/
│       ├── errors.js         — HttpError class + badRequest/notFound/...
│       └── validate.js       — requireFields, requireString, parsePagination
│
├── scripts/
│   └── create-api-key.mjs    — CLI: provision a token for a user. Only prints full token ONCE.
│
└── mcp/
    └── server.js             — MCP stdio server; wraps REST API as 16 tools
```

### Related files OUTSIDE `api/`

```
supabase/migrations/017_api_keys.sql     — api_keys table + verify_api_key() RPC
supabase/functions/_shared/crypto.ts     — MUST stay binary-compatible with api/src/crypto.js
```

---

## 4. Auth & authorization flow

### 4.1 Creating a key
```bash
cd api
npm run create-key -- <user_uuid> "Hermes Prod" --rpm=120 --scopes=content:write,publish:write
```
Emits `kry_live_<43-char-base64url>`. **Show once. Never stored plaintext.**

Internals:
1. Generate 32 random bytes → base64url → `kry_live_<rand>`.
2. Compute SHA-256 hex = `key_hash`.
3. Store `(user_id, name, key_prefix, key_hash, scopes[], rate_limit_per_minute)` in `api_keys`.

### 4.2 Per-request auth
In `api/src/middleware/auth.js`:
1. Strip `Bearer ` prefix; reject if not `kry_*`.
2. Hash token with SHA-256 → call RPC `verify_api_key(p_key_hash, p_ip)`.
3. RPC is `SECURITY DEFINER`: atomically selects active key AND updates `last_used_at`/`last_used_ip`. Only `service_role` can invoke it.
4. Reject if expired / revoked / inactive.
5. Enforce `rate_limit_per_minute` via in-memory sliding window.
6. Populate `req.user = { id, api_key_id, scopes }`.

### 4.3 Scope enforcement
Routes declare needed scope via `{ preHandler: requireScope('publish:write') }`. The factory checks `req.user.scopes.includes(scope) || req.user.scopes.includes('*')`.

### 4.4 Scope vocabulary
| Scope | Grants |
|---|---|
| `content:read` / `content:write` | brands, products, generation, calendar, library, links |
| `publish:read` / `publish:write` | publish history & executing publishes |
| `accounts:read` | list connected social accounts (tokens always masked) |
| `ads:read` / `ads:write` | campaigns, creatives, insights, competitor swipe file |
| `analytics:read` | overview, content performance, link clicks, post insights |
| `*` | wildcard, full access |

---

## 5. Data model touched by the API

The API **does not** create new application tables (other than `api_keys`). It reads/writes these existing tables:

| Table | Touched by routes | Ownership column |
|---|---|---|
| `profiles` | auth | `id = req.user.id` |
| `brands` | brands, content (FK) | `user_id` |
| `products` | products, content (FK) | `user_id` |
| `generation_history` | content | `user_id` |
| `saved_content` | content | `user_id` |
| `usage_monthly` | content (quota check + `increment_usage` RPC) | `user_id` |
| `content_calendar` | schedule | `user_id` |
| `connected_accounts` | accounts, publish | `user_id` — token fields are encrypted |
| `publish_history` | publish, analytics | `user_id` |
| `ads_campaigns` | ads | `user_id` |
| `ad_creatives` | ads | `user_id` |
| `ads_insights_daily` | ads | via campaign ownership |
| `competitor_ads` | ads | `user_id` |
| `saved_audiences` | ads | `user_id` |
| `smart_links` | links | `user_id` |
| `link_clicks` | links | via smart_link ownership |
| `api_keys` | CLI + auth middleware | `user_id` |

**Golden rule:** every query MUST filter by `user_id` (or join through an owned row). The service-role client bypasses RLS so we lose database-level protection.

---

## 6. How to add a new endpoint

Example: `GET /v1/brands/:id/insights` returning aggregate stats for a brand.

1. **Decide scope.** Read-only aggregation → `analytics:read`.
2. **Edit route file** `api/src/routes/brands.js` (or the most appropriate domain file):
   ```js
   app.get('/:id/insights', { preHandler: requireScope('analytics:read') }, async (req) => {
     // ownership gate
     const { data: brand } = await db.from('brands')
       .select('id').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle()
     if (!brand) throw notFound('Brand tidak ditemukan')

     // … aggregation query …
     return { /* payload */ }
   })
   ```
3. **If business logic is non-trivial**, extract to `src/services/<domain>.js` and import. Keep route handlers thin.
4. **Update MCP adapter** (`api/mcp/server.js`) by appending to the `TOOLS` array. Input schema uses JSON Schema.
5. **Update `api/README.md`** endpoint table AND this doc's section 9 if the shape is non-obvious.
6. Smoke-test: boot server, hit with curl.

---

## 7. How to wire a new social platform (Instagram example)

Current state: `publishers.js` routes `instagram` → `publishInstagram()` which throws "belum diimplementasi".

Steps:
1. **Service function** in `api/src/services/instagram.js`:
   ```js
   // IG Graph API: create media container → publish
   export async function publishInstagram({ accessToken, platformUserId, text, mediaUrls }) {
     // POST /{ig_user_id}/media  with image_url/video_url/caption
     // returns { id: creation_id }
     // POST /{ig_user_id}/media_publish with creation_id
     // returns { id: media_id }
     return { postId: media_id, postUrl: `https://instagram.com/p/${shortcode}` }
   }
   ```
2. **Wire dispatcher** in `publishers.js`: import and call real function instead of stub.
3. **Insights** — add case in `getPlatformInsights()` calling `/{media_id}/insights` with metrics like `impressions, reach, engagement`.
4. **OAuth** — confirm that `oauth-connect` / `oauth-callback` Edge Functions already obtain IG long-lived tokens and populate `connected_accounts(platform='instagram')`. If not, that's a separate work item in the Edge Functions.
5. Test publish via `/v1/publish` using an `account_id` of an active IG account.

Same pattern for Twitter (`/2/tweets`), TikTok (Content Posting API multi-step upload), Facebook (`/{page-id}/feed`), YouTube (resumable upload).

---

## 8. AI provider service (`services/ai.js`)

This file is a close port of `supabase/functions/generate-content/index.ts`. **Keep them behaviorally identical** — both run the same quota-check logic and provider dispatch.

Flow of `generate()`:
1. Validate inputs (lengths, temperature, maxTokens bounds).
2. `checkQuota(userId)` — reads `usage_monthly`, rejects with 429 if `generation_count >= generation_limit`.
3. Resolve provider:
   - **Legacy flow** (only `model` passed): direct Groq with fallback from `llama-3.3-70b-versatile` → `llama-3.1-8b-instant` on 429.
   - **Multi-provider flow** (`provider`/`modelId`/`customModelId`): lookup via `ai_providers` + `ai_models` + `user_ai_configs` + `user_custom_models`, decrypt user's encrypted API key if `requires_user_key`.
4. Route to `callOpenAICompatible` / `callAnthropic` / `callGemini`.
5. `incrementUsage(userId)` RPC after success.

Response shape: `{ content, tokensUsed, model, provider, fallback? }`.

To add a new provider:
- Add row in `ai_providers` (migration).
- If NOT OpenAI-compatible, add a new `callXxx()` helper and extend the `switch` in `generate()`.
- For user-key providers, ensure user can store their key via `save-ai-config` Edge Function (web app).

---

## 9. Endpoint cheat-sheet (for agent prompts)

```
GET  /v1/auth/whoami              → { user, api_key_id, scopes }

GET  /v1/brands                   → list brands
GET  /v1/brands/:id               → brand voice + tone + target audience
GET  /v1/brands/:id/products      → products under a brand
POST /v1/brands                   → create
PATCH/DELETE supported

GET  /v1/products[?brand_id=&is_active=]
POST /v1/products                 → body: { brand_id, name, description?, price?, usp?, features?, link? }

POST /v1/content/generate         → core AI entry
  body: { systemPrompt, userPrompt, provider?, modelId?, customModelId?,
          temperature?, maxTokens?, jsonMode?, type?, platform?, pillar?,
          brand_id?, product_id? }
  resp: { content, tokensUsed, model, provider, fallback?, generation_id? }

POST /v1/content/save             → body: { type, content, title?, tags?, brand_id?, generation_id? }
GET  /v1/content/history[?type=&brand_id=]
GET  /v1/content/library[?type=&is_favorite=]

GET  /v1/accounts[?platform=&status=]
GET  /v1/accounts/:id             → masked; has_token boolean

POST /v1/publish
  body: { items: [{ account_id, caption?, media_urls?, hashtags?, reply_to_id?, content_id? }] }
  resp: { results: [{ status, post_id, post_url, error? }], partial_failure }
GET  /v1/publish/history[?platform=&status=]
GET  /v1/publish/:id              → single record
GET  /v1/publish/insights/:account_id/:post_id
POST /v1/publish/threads-insights
  body: { account_id, limit?, save? }
  resp: { accountId, username, posts: [{ id, text, metrics, permalink }], accountLinkClicks, fetchedAt }

GET  /v1/schedule[?from=&to=&status=&platform=&brand_id=]
POST /v1/schedule                 → body: { title, type, platform, brand_id, scheduled_date?, ... }
PATCH/DELETE supported

GET  /v1/ads/campaigns[?status=&platform=]
GET  /v1/ads/campaigns/:id        → includes creatives[]
POST /v1/ads/campaigns            → { name, platform, objective, daily_budget?, brand_id?, audience? }
PATCH/DELETE supported
POST /v1/ads/creatives            → { campaign_id, primary_text?, headline?, cta_type?, media_url? }
PATCH supported
GET  /v1/ads/insights?days=N              → rollup: spend, CTR, CPC, ROAS, conversions, revenue
GET  /v1/ads/insights/campaign/:id[?from=&to=]
POST /v1/ads/insights             → upsert daily metrics (sync worker / agent)
GET  /v1/ads/competitors
POST /v1/ads/competitors

GET  /v1/analytics/overview       → totals + this-month usage
GET  /v1/analytics/content[?platform=&from=&to=]

GET  /v1/links[?brand_id=]
POST /v1/links                    → { destination_url, slug?, utm_*? }
GET  /v1/links/:id/clicks
PATCH/DELETE supported
```

Errors: always `{ error: string, details?: any }` with HTTP status 400/401/403/404/409/429/500/502.

---

## 10. MCP adapter (`api/mcp/server.js`)

Thin wrapper over REST. Uses `@modelcontextprotocol/sdk` stdio transport.

Config in Claude Desktop or any MCP client:
```json
{
  "mcpServers": {
    "karaya": {
      "command": "node",
      "args": ["/abs/path/api/mcp/server.js"],
      "env": {
        "KARAYA_API_URL": "https://api.karaya.id",
        "KARAYA_API_KEY": "kry_live_xxxxxxxx"
      }
    }
  }
}
```

Current tools (16): `whoami`, `list_brands`, `get_brand`, `list_products`, `generate_content`, `save_content`, `list_accounts`, `publish`, `schedule_content`, `list_scheduled`, `list_ads_campaigns`, `create_ads_campaign`, `update_ads_campaign`, `ads_overview`, `analytics_overview`, `create_smart_link`.

Adding a tool:
```js
{
  name: 'my_tool',
  description: 'Clear one-liner; the LLM reads this to decide.',
  inputSchema: { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] },
  handler: (args) => api('POST', '/v1/my-endpoint', args),
}
```

---

## 11. Deployment runbook (VPS)

### First-time setup on a fresh Ubuntu VPS
```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone (or rsync) the repo; install only api/ deps
cd /opt && git clone <repo> karaya && cd karaya/api
npm install --omit=dev
cp .env.example .env && nano .env   # fill all required vars

# Apply DB migration (from local machine with supabase-cli linked)
supabase db push

# PM2
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup

# Nginx (optional: TLS via certbot)
sudo apt install -y nginx
# Copy the nginx block from api/README.md into /etc/nginx/sites-available/karaya
```

### Docker alternative
```bash
docker build -t karaya-api ./api
docker run -d --name karaya-api --env-file ./api/.env -p 3001:3001 \
  --restart unless-stopped karaya-api
```

### Health + logs
- `GET /health` → `{ ok: true, ts }` (no auth, use for uptime monitors).
- `pm2 logs karaya-api` or `docker logs -f karaya-api`.
- Pino JSON logs in production; `pino-pretty` in dev.

### Rotating a key
No "rotate" endpoint yet — just:
1. Create new key via CLI.
2. Swap agent config to new token.
3. `UPDATE api_keys SET revoked_at = NOW(), is_active=false WHERE id = ...`.

---

## 12. Known gotchas / future work

| Gotcha | Mitigation |
|---|---|
| `TOKEN_ENCRYPTION_KEY` MUST match the one used by Edge Functions (hex 64 chars). Wrong key → can't decrypt OAuth tokens → every publish fails. | Keep both deployments reading the same secret manager entry. |
| Service-role client bypasses RLS. | Every query must `.eq('user_id', req.user.id)`. Grep for `from(` during code review. |
| In-memory rate limiter doesn't work across multiple PM2 cluster workers. | For true global rate limit across workers, move the `windows` Map to Redis. Current per-worker limits are acceptable for low-volume. |
| Threads container polling is synchronous (up to 30s). | Long requests are OK on VPS but would time out on Edge Functions. Keep this logic here. |
| MCP adapter currently uses a single API key from env. | For multi-user MCP (one install, many users), add a header-based user selector or one env per user. |
| No webhook endpoints yet. | When adding, mount under `/v1/webhooks/` and skip `apiKeyAuth` — use HMAC signature verification instead. |
| No background worker for `publish_queue` retries. | When implementing, run as a separate PM2 app (not inside Fastify) to avoid blocking the request loop. |

---

## 13. Testing strategy (recommended when adding features)

No test framework is wired yet — the priority was shipping the API. When you touch this code:

1. **Smoke test:** `SUPABASE_URL=https://dummy SUPABASE_SERVICE_ROLE_KEY=dummy node src/server.js`. Hit `/health` and a 401 path.
2. **Integration test:** hit against a staging Supabase with a seeded user + API key. Exercise at minimum:
   - create brand → create product → generate content → save → list history
   - create scheduled post → patch status → list by date range
   - publish to a test Threads account → get insights
3. When wiring a new platform, test reply chains (pass `reply_to_id`) and media attachments.

Before adding a test framework, prefer `node:test` (stdlib) + `undici` for HTTP — zero new deps.

---

## 14. Security review checklist (before prod)

- [ ] `ALLOWED_ORIGINS` set to real web app domain in production (not `*`)
- [ ] TLS terminated in front of the API (Nginx+certbot or Cloudflare)
- [ ] Firewall: only 443 + 22 open; API listens on 127.0.0.1 behind Nginx
- [ ] `.env` has `chmod 600`
- [ ] Rotate `TOKEN_ENCRYPTION_KEY` strategy documented (requires re-encrypting `connected_accounts.access_token_encrypted`)
- [ ] API keys have reasonable expiry set (`--expires=2026-12-31T23:59:59Z`)
- [ ] Dependabot / renovate on `api/package.json`
- [ ] Log aggregation configured (Datadog / Loki / Papertrail)
- [ ] Supabase `service_role` key only present in API env and Edge Functions secrets
