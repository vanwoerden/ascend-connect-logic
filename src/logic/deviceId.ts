/** Device ids: `6c-` plus exactly five lowercase alphanumeric characters. */
export const DEVICE_ID_PATTERN = /^6c-[0-9a-z]{5}$/

const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Deterministic id for the device at a given index (0-based). */
export function deviceIdFromIndex(index: number): string {
  let x = (index + 1) * 11003 + 90437
  let code = ''
  for (let i = 0; i < 5; i++) {
    code += CHARSET[x % 36]
    x = Math.floor(x / 36) + index * 31 + i * 17
  }
  return `6c-${code}`
}

export function normalizeDeviceId(id: unknown, index: number): string {
  if (typeof id !== 'string') return deviceIdFromIndex(index)
  const lower = id.toLowerCase()
  return DEVICE_ID_PATTERN.test(lower) ? lower : deviceIdFromIndex(index)
}
