import { badRequest } from './errors.js'

export function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj[f] === undefined || obj[f] === null || obj[f] === '') {
      throw badRequest(`Field '${f}' wajib diisi`)
    }
  }
}

export function requireString(value, name, { max = 10000, min = 1 } = {}) {
  if (typeof value !== 'string') throw badRequest(`${name} harus string`)
  if (value.length < min) throw badRequest(`${name} minimal ${min} karakter`)
  if (value.length > max) throw badRequest(`${name} maksimal ${max} karakter`)
}

export function clampInt(value, { min, max, field }) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw badRequest(`${field} harus integer`)
  if (n < min || n > max) throw badRequest(`${field} harus antara ${min}-${max}`)
  return n
}

export function parsePagination(query) {
  const limit = Math.min(Number(query.limit) || 20, 100)
  const offset = Math.max(Number(query.offset) || 0, 0)
  return { limit, offset }
}
