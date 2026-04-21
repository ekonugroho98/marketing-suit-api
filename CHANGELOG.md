# Karaya API Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). API follows SemVer starting at `v1`.

## [0.1.1] — 2026-04-21

### Fixed
- **threads-search endpoint**: Changed from user-scoped `/{userId}/threads_search` to top-level `/threads_search` endpoint. Meta's Threads API keyword search is not a user edge — the previous path caused 400 errors ('nonexisting field threads_search'). Requires `threads_keyword_search` permission.
- **Token encoding**: URL-encode `accessToken` in container status-check and `getThreadsInsights` fetch calls (consistency fix — other endpoints already encoded correctly).

## [0.1.0] — 2026-04-16

### Added
- Initial Fastify API (Node 20+) with 10 route domains: auth, brands, products, content, accounts, publish, schedule, ads, analytics, links.
- API key authentication: SHA-256 hashed tokens in `api_keys` table, `verify_api_key()` RPC, per-key scopes + rate limit.
- Migration `supabase/migrations/017_api_keys.sql`.
- Multi-provider AI service (`services/ai.js`) — Groq / OpenAI / Anthropic / Gemini / OpenRouter / custom OpenAI-compatible. Ported from `supabase/functions/generate-content/index.ts`.
- Threads publisher (`services/threads.js`) fully wired: create container → poll → publish, with reply-chain support. Ported from `supabase/functions/publish-content/index.ts`.
- Publisher dispatcher (`services/publishers.js`) with scaffolded stubs for Instagram, Twitter/X, TikTok, Facebook, YouTube.
- Threads insights endpoint (`GET /v1/publish/insights/:account_id/:post_id`).
- CLI `scripts/create-api-key.mjs` for token provisioning.
- MCP stdio server (`mcp/server.js`) exposing 16 tools for Claude Desktop / MCP-capable agents.
- Docker (`Dockerfile`) + PM2 (`ecosystem.config.cjs`) deployment options.
- Docs: `api/README.md` (user-facing), `api/AGENTS.md` (AI orientation), `doc/api-integration.md` (full reference).

### Security
- OAuth platform tokens are never returned to clients; `has_token` boolean only.
- `key_prefix` stored for UX, full tokens never recoverable after creation.
- Helmet + per-key rate limit + global `GLOBAL_MAX_RPM` safety net.

### Known limitations
- Instagram / Twitter / TikTok / Facebook / YouTube publish endpoints throw `not_implemented` until wired.
- No automated tests yet — manual smoke test in `doc/api-integration.md` §13.
- In-memory rate limiter does not share state across PM2 cluster workers.
