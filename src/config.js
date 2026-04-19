import 'dotenv/config'

function required(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env: ${name}`)
  return v
}

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim()),
  globalMaxRpm: Number(process.env.GLOBAL_MAX_RPM || 600),
}
