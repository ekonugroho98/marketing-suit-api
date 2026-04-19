# Orientation for AI agents working in this repo

> **Start here if you're an AI (Claude / Cursor / etc.) editing this repo.**
> Full context lives in the main repo's `doc/api-integration.md`. This file is the 60-second version.

## What this is
Standalone **Fastify REST API + MCP server** that lets external agents (Hermes, n8n, Claude Desktop) operate the Karaya Marketing Suite via **API-key auth** instead of user JWT. Deployed to a VPS, talks to the same Supabase database as the web app.

## Related repos
- **Web app (frontend):** [marketing-suit](https://github.com/ekonugroho98/marketing-suit) — React + Vite + Supabase
- **Supabase Edge Functions:** in the main repo under `supabase/functions/`, uses JWT auth. Do not duplicate logic here — but DO port logic cleanly if agents need it (the AI service + Threads publisher are examples of correct ports).

## Golden rules

1. **Every DB query must filter by `user_id`.** The service-role client in `src/db.js` bypasses RLS — no safety net.
2. **Routes stay thin.** Business logic lives in `src/services/*.js` so both REST and MCP can reuse it.
3. **MCP adapter (`mcp/server.js`) calls REST — never talks to DB directly.** Single source of truth.
4. **The AES-256-GCM format in `src/crypto.js` MUST stay identical to `../supabase/functions/_shared/crypto.ts`.** OAuth tokens are written by the web app and read here.
5. **No new deps without need.** We already pay for fastify/helmet/cors/rate-limit/supabase-js/nanoid/mcp-sdk. Check first.

## Common tasks

| I want to... | Do this |
|---|---|
| Add a new endpoint | Edit the relevant `src/routes/<domain>.js`, declare scope with `requireScope(...)`, keep handler thin. Update `mcp/server.js` TOOLS array. Update `README.md`. |
| Wire a new social platform | Add service file, update `services/publishers.js` dispatcher. |
| Add a new AI provider | Extend `services/ai.js`. |
| Change the auth shape | Touch `src/middleware/auth.js` AND the `api_keys` table AND `verify_api_key` RPC atomically. Write a new migration. |
| Provision a key for a user | `npm run create-key -- <user_id> "Name" --scopes=... --rpm=N` |

## File layout (TL;DR)

```
src/
  server.js           ← Fastify entry & route registration
  config.js           ← only place that reads process.env
  db.js               ← Supabase service-role client
  crypto.js           ← AES-256-GCM decrypt + sha256
  middleware/         ← apiKeyAuth + requireScope + errorHandler
  services/           ← ai, threads, publishers (← dispatcher for all platforms)
  routes/             ← one file per domain (brands/products/content/publish/…)
  utils/              ← errors, validate
scripts/create-api-key.mjs
mcp/server.js         ← MCP stdio adapter
```

## Before you ship

- `node --check` passes on touched files
- `npm start` boots cleanly with dummy env (see `../doc/api-integration.md` §13)
- README endpoint table stays in sync
- CHANGELOG entry added (see `CHANGELOG.md`)
