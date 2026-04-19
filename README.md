# Karaya Marketing API

REST API + MCP adapter untuk integrasi **Karaya Marketing Suite** dengan external agents (Hermes, n8n, Claude Desktop, custom scripts, dll). Di-host independen dari web app utama — bisa di VPS, Docker, atau serverless.

- **Framework:** Fastify 5 (Node.js 20+)
- **Auth:** Bearer API key (SHA-256 hashed di DB)
- **Data source:** Supabase PostgreSQL (service-role client)
- **AI:** Groq / OpenAI / Anthropic / Gemini / OpenRouter / Custom OpenAI-compatible
- **Publish:** Threads (fully wired), IG/Twitter/TikTok/FB/YouTube (scaffolded, belum wired)
- **MCP:** stdio server di `mcp/server.js` (untuk Claude Desktop / MCP-capable clients)

---

## Quick start

```bash
cd api
cp .env.example .env        # isi SUPABASE_URL, SERVICE_ROLE_KEY, TOKEN_ENCRYPTION_KEY, GROQ_API_KEY
npm install

# 1. Apply migrasi api_keys ke Supabase (sekali saja)
#    (supabase link → supabase db push), atau eksekusi manual:
#    supabase/migrations/017_api_keys.sql

# 2. Provision API key untuk user existing
npm run create-key -- <user_uuid> "Hermes Agent" --rpm=120
# Output: kry_live_xxxxxxxxxxxxxxxxxxxxxx  (SIMPAN SEKARANG)

# 3. Jalankan server
npm run dev                 # development
npm start                   # production
```

### Verifikasi:
```bash
curl -H "Authorization: Bearer kry_live_xxx..." http://localhost:3001/v1/auth/whoami
```

---

## Auth

Setiap request ke `/v1/*` harus membawa header:
```
Authorization: Bearer kry_live_<random>
```

- Token disimpan **hanya sebagai SHA-256 hash** di table `api_keys`.
- Scope dicek per-endpoint (lihat kolom "Scope" di tabel endpoint).
- Rate limit per key (default **60 req/min**, bisa diatur via `--rpm=` saat create).
- Global safety net: `GLOBAL_MAX_RPM` env (default 600).

### Scopes yang tersedia
| Scope | Untuk |
|---|---|
| `content:read` | baca brands/products/history/library/schedule |
| `content:write` | generate, save, create/update brands/products/schedule/links |
| `publish:read` | publish_history, publish status |
| `publish:write` | publish ke platform |
| `accounts:read` | list connected social accounts |
| `ads:read` | campaigns, creatives, insights |
| `ads:write` | create/update campaigns, upsert insights |
| `analytics:read` | overview, content analytics, link clicks |
| `*` | semua scope |

---

## Endpoint reference

Base URL: `https://your-api.example.com` (atau `http://localhost:3001`)
Prefix: `/v1`

### Auth
| Method | Path | Scope | Keterangan |
|---|---|---|---|
| GET | `/v1/auth/whoami` | — | Verify API key + profile |

### Brands & Products
| Method | Path | Scope |
|---|---|---|
| GET | `/v1/brands` | `content:read` |
| GET | `/v1/brands/:id` | `content:read` |
| POST | `/v1/brands` | `content:write` |
| PATCH | `/v1/brands/:id` | `content:write` |
| DELETE | `/v1/brands/:id` | `content:write` |
| GET | `/v1/brands/:id/products` | `content:read` |
| GET | `/v1/products` | `content:read` |
| GET | `/v1/products/:id` | `content:read` |
| POST | `/v1/products` | `content:write` |
| PATCH | `/v1/products/:id` | `content:write` |
| DELETE | `/v1/products/:id` | `content:write` |

### Content (AI Generation)
| Method | Path | Scope |
|---|---|---|
| POST | `/v1/content/generate` | `content:write` |
| GET | `/v1/content/history` | `content:read` |
| GET | `/v1/content/history/:id` | `content:read` |
| POST | `/v1/content/save` | `content:write` |
| GET | `/v1/content/library` | `content:read` |

**POST `/v1/content/generate`** body:
```json
{
  "systemPrompt": "Kamu adalah copywriter untuk brand premium Indonesia...",
  "userPrompt": "Buat 3 caption Instagram untuk produk X dengan pillar awareness",
  "temperature": 0.8,
  "maxTokens": 2000,
  "provider": "groq",
  "type": "caption",
  "platform": "instagram",
  "pillar": "awareness",
  "brand_id": "uuid",
  "product_id": "uuid"
}
```
Response:
```json
{
  "content": "...",
  "tokensUsed": 1234,
  "model": "llama-3.3-70b-versatile",
  "provider": "groq",
  "generation_id": "uuid"
}
```

### Social Accounts
| Method | Path | Scope |
|---|---|---|
| GET | `/v1/accounts` | `accounts:read` |
| GET | `/v1/accounts/:id` | `accounts:read` |

### Publish
| Method | Path | Scope |
|---|---|---|
| POST | `/v1/publish` | `publish:write` |
| GET | `/v1/publish/history` | `publish:read` |
| GET | `/v1/publish/:id` | `publish:read` |
| DELETE | `/v1/publish/:account_id/:post_id` | `publish:write` |
| GET | `/v1/publish/insights/:account_id/:post_id` | `analytics:read` |
| POST | `/v1/publish/threads-insights` | `analytics:read` |
| GET | `/v1/publish/threads-search?account_id=UUID&q=KEYWORD&limit=25` | `analytics:read` |
| GET | `/v1/publish/threads-mentions?account_id=UUID&limit=25` | `analytics:read` |
| GET | `/v1/publish/threads-replies/:account_id/:post_id` | `analytics:read` |
| GET | `/v1/publish/threads-conversation/:account_id/:post_id` | `analytics:read` |
| GET | `/v1/publish/threads-profile/:account_id` | `accounts:read` |

**POST `/v1/publish`** body:
```json
{
  "items": [
    {
      "account_id": "uuid",
      "caption": "Halo dunia!",
      "media_urls": ["https://.../image.jpg"],
      "hashtags": ["marketing", "creator"],
      "reply_to_id": null,
      "content_id": "uuid-optional"
    }
  ]
}
```
Response: `{ results: [...], partial_failure: bool }` dengan `{ status: 'success'|'failed', post_id, post_url, error? }`.

**POST `/v1/publish/threads-insights`** body:
```json
{
  "account_id": "uuid",
  "limit": 25,
  "save": true
}
```
Response: `{ accountId, username, posts: [{ id, text, timestamp, permalink, metrics: { views, likes, replies, reposts, quotes } }], accountLinkClicks: [{ link_url, value }], fetchedAt }`.

### Schedule (Content Calendar)
| Method | Path | Scope |
|---|---|---|
| GET | `/v1/schedule?from=&to=&status=&platform=&brand_id=` | `content:read` |
| GET | `/v1/schedule/:id` | `content:read` |
| POST | `/v1/schedule` | `content:write` |
| PATCH | `/v1/schedule/:id` | `content:write` |
| DELETE | `/v1/schedule/:id` | `content:write` |

### Ads
| Method | Path | Scope |
|---|---|---|
| GET | `/v1/ads/campaigns` | `ads:read` |
| GET | `/v1/ads/campaigns/:id` | `ads:read` |
| POST | `/v1/ads/campaigns` | `ads:write` |
| PATCH | `/v1/ads/campaigns/:id` | `ads:write` |
| DELETE | `/v1/ads/campaigns/:id` | `ads:write` |
| POST | `/v1/ads/creatives` | `ads:write` |
| PATCH | `/v1/ads/creatives/:id` | `ads:write` |
| GET | `/v1/ads/insights?days=7` | `ads:read` |
| GET | `/v1/ads/insights/campaign/:id?from=&to=` | `ads:read` |
| POST | `/v1/ads/insights` | `ads:write` (upsert daily metrics) |
| GET | `/v1/ads/competitors` | `ads:read` |
| POST | `/v1/ads/competitors` | `ads:write` |

### Analytics
| Method | Path | Scope |
|---|---|---|
| GET | `/v1/analytics/overview` | `analytics:read` |
| GET | `/v1/analytics/content?platform=&from=&to=` | `analytics:read` |

### Smart Links
| Method | Path | Scope |
|---|---|---|
| GET | `/v1/links` | `analytics:read` |
| GET | `/v1/links/:id` | `analytics:read` |
| POST | `/v1/links` | `content:write` |
| PATCH | `/v1/links/:id` | `content:write` |
| DELETE | `/v1/links/:id` | `content:write` |
| GET | `/v1/links/:id/clicks` | `analytics:read` |

---

## Error format

Semua error JSON:
```json
{ "error": "Pesan yang user-friendly", "details": "optional raw error" }
```
Status codes: `400` validation, `401` auth, `403` scope, `404` not found, `409` conflict, `429` rate limit, `500` internal, `502` upstream AI/platform error.

---

## Deployment (VPS)

### Opsi A: Docker
```bash
cd api
docker build -t karaya-api .
docker run -d --name karaya-api \
  --env-file .env \
  -p 3001:3001 --restart unless-stopped \
  karaya-api
```

### Opsi B: PM2 (native Node)
```bash
npm install -g pm2
npm install --omit=dev
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Reverse proxy (Nginx)
```nginx
location /v1/ {
  proxy_pass http://127.0.0.1:3001;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 120s;
}
```

---

## MCP Server (Claude Desktop / MCP clients)

File: `mcp/server.js` — stdio transport, wrap REST API sebagai MCP tools.

### Claude Desktop `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "karaya": {
      "command": "node",
      "args": ["/abs/path/marketing-tools/api/mcp/server.js"],
      "env": {
        "KARAYA_API_URL": "https://api.karaya.id",
        "KARAYA_API_KEY": "kry_live_xxxxxxxx"
      }
    }
  }
}
```

### Tools yang diekspos
`whoami`, `list_brands`, `get_brand`, `list_products`, `generate_content`, `save_content`, `list_accounts`, `publish`, `schedule_content`, `list_scheduled`, `list_ads_campaigns`, `create_ads_campaign`, `update_ads_campaign`, `ads_overview`, `analytics_overview`, `create_smart_link`.

---

## Contoh pemakaian dengan Hermes Agent (HTTP)

```javascript
// Hermes Agent tool definition
{
  "name": "karaya_generate_caption",
  "type": "http",
  "method": "POST",
  "url": "https://api.karaya.id/v1/content/generate",
  "headers": {
    "Authorization": "Bearer kry_live_xxxxx",
    "Content-Type": "application/json"
  }
}
```

Atau cukup simple Node.js:
```javascript
const res = await fetch('https://api.karaya.id/v1/publish', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.KARAYA_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    items: [{
      account_id: 'uuid',
      caption: 'Post dari agent!',
    }],
  }),
})
console.log(await res.json())
```

---

## Platform publish — status implementasi

| Platform | Status | Keterangan |
|---|---|---|
| Threads | ✅ Fully wired | Container + status poll + publish |
| Instagram | ⏳ Scaffold | Tinggal wire Graph API `/{ig_user_id}/media` |
| Twitter/X | ⏳ Scaffold | Tinggal wire `/2/tweets` |
| TikTok | ⏳ Scaffold | Content Posting API video init + chunk upload |
| Facebook | ⏳ Scaffold | `/{page-id}/feed` |
| YouTube | ⏳ Scaffold | Data API v3 resumable upload |

Tinggal implementasi di `src/services/publishers.js` — signature sudah siap.

---

## Security checklist

- [x] API token di-hash sebelum simpan (SHA-256)
- [x] OAuth platform tokens di-decrypt on-the-fly dari `connected_accounts.access_token_encrypted`
- [x] Per-key rate limit + global rate limit
- [x] Helmet headers
- [x] Trust proxy (honor X-Forwarded-For dari Nginx/Cloudflare)
- [x] Error handler — tidak expose stack trace di production
- [ ] Monitoring: hubungkan log Pino ke Datadog/Loki jika perlu
