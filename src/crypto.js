// ============================================
// AES-256-GCM token decryption
// Matches the format written by supabase/functions/_shared/crypto.ts:
//   base64(iv):base64(ciphertext):base64(tag)
// ============================================
import crypto from 'node:crypto'
import { config } from './config.js'

function hexToBuf(hex) {
  const cleaned = hex.replace(/\s+/g, '')
  if (cleaned.length % 2 !== 0) throw new Error('Invalid hex key')
  return Buffer.from(cleaned, 'hex')
}

export function decryptToken(encrypted, key = config.tokenEncryptionKey) {
  if (!encrypted) throw new Error('Empty ciphertext')
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY not configured')

  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid token format (expected iv:ciphertext:tag)')
  }
  const iv = Buffer.from(parts[0], 'base64')
  const ct = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')

  const keyBuf = hexToBuf(key)
  if (keyBuf.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars)')
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(ct), decipher.final()])
  return dec.toString('utf8')
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}
