// ============================================
// Karaya API — Fastify entry point
// ============================================
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

import { config } from './config.js'
import { apiKeyAuth } from './middleware/auth.js'
import { errorHandler } from './middleware/error.js'

import authRoutes from './routes/auth.js'
import brandsRoutes from './routes/brands.js'
import productsRoutes from './routes/products.js'
import contentRoutes from './routes/content.js'
import accountsRoutes from './routes/accounts.js'
import publishRoutes from './routes/publish.js'
import scheduleRoutes from './routes/schedule.js'
import adsRoutes from './routes/ads.js'
import analyticsRoutes from './routes/analytics.js'
import linksRoutes from './routes/links.js'

const app = Fastify({
  logger: {
    level: config.logLevel,
    transport:
      config.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  trustProxy: true,
  bodyLimit: 4 * 1024 * 1024, // 4 MB
})

await app.register(helmet, { contentSecurityPolicy: false })

await app.register(cors, {
  origin:
    config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
})

// Global rate-limit safety net (per-key limits enforced in auth middleware)
await app.register(rateLimit, {
  global: true,
  max: config.globalMaxRpm,
  timeWindow: '1 minute',
})

app.setErrorHandler(errorHandler)

// ── Public endpoints ─────
app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }))
app.get('/', async () => ({
  name: 'Karaya Marketing API',
  version: '0.1.0',
  docs: '/v1',
}))

// ── v1 endpoints (all behind API key auth) ─────
await app.register(
  async (v1) => {
    v1.addHook('preHandler', apiKeyAuth)

    await v1.register(authRoutes, { prefix: '/auth' })
    await v1.register(brandsRoutes, { prefix: '/brands' })
    await v1.register(productsRoutes, { prefix: '/products' })
    await v1.register(contentRoutes, { prefix: '/content' })
    await v1.register(accountsRoutes, { prefix: '/accounts' })
    await v1.register(publishRoutes, { prefix: '/publish' })
    await v1.register(scheduleRoutes, { prefix: '/schedule' })
    await v1.register(adsRoutes, { prefix: '/ads' })
    await v1.register(analyticsRoutes, { prefix: '/analytics' })
    await v1.register(linksRoutes, { prefix: '/links' })
  },
  { prefix: '/v1' },
)

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`Karaya API listening on ${config.host}:${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
