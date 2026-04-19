import { HttpError } from '../utils/errors.js'

export function errorHandler(err, req, reply) {
  if (err instanceof HttpError) {
    return reply
      .status(err.status)
      .send({ error: err.message, details: err.details })
  }
  // Supabase postgrest errors
  if (err?.code && err?.message && err?.details !== undefined) {
    req.log.error({ err }, 'Supabase error')
    return reply.status(500).send({ error: err.message, code: err.code })
  }
  req.log.error({ err }, 'Unhandled error')
  return reply.status(500).send({ error: err.message || 'Internal Server Error' })
}
