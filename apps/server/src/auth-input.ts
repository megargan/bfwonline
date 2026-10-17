const USERNAME = /^[a-z0-9_]{3,24}$/
const CONTROL = /\p{Cc}/u

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const username = value.trim().toLowerCase()
  return USERNAME.test(username) ? username : null
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && [...value].length >= 12 && [...value].length <= 128
}

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string' || CONTROL.test(value)) return null
  const name = value.trim()
  const length = [...name].length
  return length >= 1 && length <= 32 ? name : null
}
