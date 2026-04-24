import { deviceIdFromIndex } from '../logic/deviceId'
import { normalizeSimulatorState } from '../state/initialState'
import type { SimulatorDevice, SimulatorState } from '../types'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Merges a rule's `match` object into the current simulator state so factor
 * sentences and the phone preview reflect that scenario.
 */
export function applyRuleMatchToState(
  state: SimulatorState,
  match: Record<string, unknown>,
): SimulatorState {
  const next: SimulatorState = {
    ...state,
    permissions: { ...state.permissions },
    devices: [...state.devices],
    appRoomNames: [...state.appRoomNames],
    networkRoomNames: [...state.networkRoomNames],
  }

  for (const [key, value] of Object.entries(match)) {
    if (value === undefined) continue

    if (key === 'permissions' && isPlainObject(value)) {
      next.permissions = {
        ...next.permissions,
        ...value,
      } as SimulatorState['permissions']
      continue
    }

    if (key === 'devices' && Array.isArray(value)) {
      const patches = value as unknown[]
      for (let i = 0; i < patches.length; i++) {
        const patch = patches[i]
        if (!isPlainObject(patch)) continue
        while (next.devices.length <= i) {
          next.devices.push({
            id: deviceIdFromIndex(next.devices.length),
            status: 'unassigned',
            lanTransport: 'wifi',
          })
        }
        const cur = next.devices[i]
        next.devices[i] = { ...cur, ...patch } as SimulatorDevice
      }
      continue
    }

    if (key === 'appRoomNames' && Array.isArray(value)) {
      next.appRoomNames = value.map((x) => String(x))
      continue
    }

    if (key === 'networkRoomNames' && Array.isArray(value)) {
      next.networkRoomNames = value.map((x) => String(x))
      continue
    }

    if (key === 'loggedIn') {
      next.loggedIn = Boolean(value)
      if (!next.loggedIn) next.activeRoomId = null
      continue
    }

    if (key === 'wifiConnected') {
      next.wifiConnected = Boolean(value)
      continue
    }

    if (key === 'appRoomCount' && typeof value === 'number') {
      next.appRoomCount = value
      continue
    }

    if (key === 'networkOnlyRoomCount' && typeof value === 'number') {
      next.networkOnlyRoomCount = value
      continue
    }

    if (key === 'activeRoomId') {
      next.activeRoomId =
        value === null || value === undefined
          ? null
          : typeof value === 'string'
            ? value
            : null
      continue
    }

    ;(next as unknown as Record<string, unknown>)[key] = value
  }

  return normalizeSimulatorState(next)
}
