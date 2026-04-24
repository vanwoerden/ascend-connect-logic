/**
 * Partial deep match: every key in `pattern` must equal the corresponding part of `value`.
 * Arrays: pattern[i] must match value[i] for each index present in pattern (value may be longer).
 */
export function partialDeepMatch(
  value: unknown,
  pattern: unknown,
): boolean {
  if (pattern === null || pattern === undefined) {
    return value === pattern
  }
  if (typeof pattern !== 'object') {
    return value === pattern
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if (Array.isArray(pattern)) {
    if (!Array.isArray(value)) return false
    if (pattern.length > value.length) return false
    for (let i = 0; i < pattern.length; i++) {
      if (!partialDeepMatch(value[i], pattern[i])) return false
    }
    return true
  }
  const p = pattern as Record<string, unknown>
  const v = value as Record<string, unknown>
  for (const key of Object.keys(p)) {
    if (!(key in v)) return false
    if (!partialDeepMatch(v[key], p[key])) return false
  }
  return true
}
