// Vercel serverless adapter for Fastify
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'

import { config } from '../src/config.js'
import { apiKeyAuth } from '../src/middleware/auth.js'
import { errorHandler } from '../src/middleware/error.js'

import authRoutes from '../src/routes/auth.js'
import brandsRoutes from '../src/routes/brands.js'
import productsRoutes from '../src/routes/products.js'
import contentRoutes from '../src/routes/content.js'
import accountsRoutes from '../src/routes/accounts.js'
import publishRoutes from '../src/routes/publish.js'
import scheduleRoutes from '../src/routes/schedule.js'
import adsRoutes from '../src/routes/ads.js'
import analyticsRoutes from '../src/routes/analytics.js'
import linksRoutes from '../src/routes/links.js'

let app

async function buildApp() {
  if (app) return app

  app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 4 * 1024 * 1024,
  })

  await app.register(helmet, { contentSecurityPolicy: false })

  await app.register(cors, {
    origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
  })

  await app.register(rateLimit, {
    global: true,
    max: config.globalMaxRpm,
    timeWindow: '1 minute',
  })

  app.setErrorHandler(errorHandler)

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }))
  app.get('/', async () => ({
    name: 'Karaya Marketing API',
    version: '0.1.0',
    docs: '/v1',
  }))

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

  await app.ready()
  return app
}

export default async function handler(req, res) {
  const fastify = await buildApp()

  // Vercel parses body automatically, but Content-Length header may not match
  // when unicode characters are involved. We need to let Fastify handle the body
  // without the original Content-Length header.
  const headers = { ...req.headers }
  
  // Remove Content-Length to let Fastify calculate it correctly for the payload
  // This fixes "Request body size did not match Content-Length" with unicode chars
  delete headers['content-length']

  // Use Fastify's built-in inject to handle the request
  const response = await fastify.inject({
    method: req.method,
    url: req.url,
    headers: headers,
    payload: req.body,
  })

  res.writeHead(response.statusCode, response.headers)
  res.end(response.body)
}
