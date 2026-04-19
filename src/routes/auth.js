// GET /v1/auth/whoami — verify API key & return user context
import { db } from '../db.js'

export default async function authRoutes(app) {
  app.get('/whoami', async (req) => {
    const { data: profile } = await db
      .from('profiles')
      .select('id, full_name, avatar_url, subscription_tier, onboarding_completed')
      .eq('id', req.user.id)
      .maybeSingle()

    return {
      user: profile || { id: req.user.id },
      api_key_id: req.user.api_key_id,
      scopes: req.user.scopes,
    }
  })
}
