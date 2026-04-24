import type { SimulatorState } from '../types'
import { normalizeSimulatorState } from './initialState'

const STORAGE_KEY = 'ascend-connect-logic:simulator-state-v1'

export function loadSimulatorFromStorage(
  factorDefaults: SimulatorState,
): SimulatorState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return factorDefaults
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return factorDefaults
    const p = parsed as Record<string, unknown>
    const permIn =
      typeof p.permissions === 'object' && p.permissions !== null
        ? (p.permissions as Record<string, unknown>)
        : {}

    const merged: SimulatorState = {
      ...factorDefaults,
      ...(p as Partial<SimulatorState>),
      permissions: {
        ...factorDefaults.permissions,
        ...permIn,
      } as SimulatorState['permissions'],
      devices: Array.isArray(p.devices) ? (p.devices as SimulatorState['devices']) : factorDefaults.devices,
      appRoomNames: Array.isArray(p.appRoomNames)
        ? (p.appRoomNames as string[])
        : factorDefaults.appRoomNames,
      networkRoomNames: Array.isArray(p.networkRoomNames)
        ? (p.networkRoomNames as string[])
        : factorDefaults.networkRoomNames,
    }

    return normalizeSimulatorState(merged)
  } catch {
    return factorDefaults
  }
}

export function saveSimulatorState(state: SimulatorState): void {
  try {
    const persistable = { ...state }
    delete persistable.pendingOpenSettingsNetworkRooms
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable))
  } catch {
    // quota / private mode — ignore
  }
}
