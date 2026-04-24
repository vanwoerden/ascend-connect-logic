/** Flatten rule `match` JSON into dotted paths for display and path collection. */
export function flattenMatch(
  obj: unknown,
  prefix = '',
): { path: string; value: string }[] {
  if (obj === null) {
    return [{ path: prefix || 'null', value: 'null' }]
  }
  if (typeof obj !== 'boolean' && typeof obj !== 'number' && typeof obj !== 'string') {
    /* continue */
  } else {
    const path = prefix || 'value'
    const value =
      typeof obj === 'string'
        ? obj
        : typeof obj === 'boolean'
          ? obj
            ? 'true'
            : 'false'
          : String(obj)
    return [{ path, value }]
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return [{ path: prefix || '[]', value: '(empty array)' }]
    }
    return obj.flatMap((item, i) =>
      flattenMatch(item, `${prefix}[${i}]`),
    )
  }

  const entries = Object.entries(obj as Record<string, unknown>)
  if (entries.length === 0) {
    return [{ path: prefix || '{}', value: '(empty)' }]
  }

  return entries.flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k
    if (Array.isArray(v)) {
      return flattenMatch(v, p)
    }
    if (v !== null && typeof v === 'object') {
      return flattenMatch(v, p)
    }
    const value =
      typeof v === 'string'
        ? v
        : typeof v === 'boolean'
          ? v
            ? 'true'
            : 'false'
          : v === null
            ? 'null'
            : String(v)
    return [{ path: p, value }]
  })
}

/** Unique state paths referenced across all rule matches (approximation of “factors in use”). */
export function collectMatchPaths(rules: { match: Record<string, unknown> }[]): string[] {
  const set = new Set<string>()
  for (const r of rules) {
    for (const { path } of flattenMatch(r.match)) {
      set.add(path)
    }
  }
  return [...set].sort()
}
