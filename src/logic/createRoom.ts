import {
  getEffectiveLanTransport,
  isDeviceReachableOnLan,
} from './deviceLanReachability'
import type { SimulatorState } from '../types'

const MAX_APP_ROOMS = 10

/**
 * In the simulator, “detected and not in any room” is represented as `unassigned`
 * and reachable on the LAN (phone Wi‑Fi/Ethernet matches the device’s `lanTransport`).
 * `offline` devices are not treated as available for this gate.
 * Wi‑Fi transport devices also require Bluetooth and camera to be granted.
 */
export function countUnassignedDetectedDevices(state: SimulatorState): number {
  return state.devices.filter(
    (d) => d.status === 'unassigned' && isDeviceReachableOnLan(state, d),
  ).length
}

export function canCreateRoom(state: SimulatorState): boolean {
  if (state.appRoomCount >= MAX_APP_ROOMS) return false
  if (state.permissions.network !== 'granted') return false
  if (!state.wifiConnected) return false
  return countUnassignedDetectedDevices(state) >= 2
}

export function createRoomDisabledReason(state: SimulatorState): string | null {
  if (state.appRoomCount >= MAX_APP_ROOMS) {
    return 'Maximum number of app rooms (10) reached.'
  }
  if (state.permissions.network !== 'granted') {
    return 'Network permission is required to detect devices on the LAN.'
  }
  if (!state.wifiConnected) {
    return 'Connect to Wi‑Fi to detect devices on the network.'
  }
  const hasUnassignedWifiSpeaker = state.devices.some(
    (d) =>
      d.status === 'unassigned' && getEffectiveLanTransport(d) === 'wifi',
  )
  if (
    hasUnassignedWifiSpeaker &&
    (state.permissions.bluetooth !== 'granted' ||
      state.permissions.camera !== 'granted')
  ) {
    return 'Bluetooth and camera must both be allowed to detect Wi‑Fi speakers on the network.'
  }
  const n = countUnassignedDetectedDevices(state)
  if (n < 2) {
    return `Create room needs at least 2 speakers detected on the LAN (unassigned, while your phone has Wi‑Fi). You have ${n}.`
  }
  return null
}

export function applyCreateRoom(state: SimulatorState): SimulatorState {
  if (!canCreateRoom(state)) return state
  const n = state.appRoomCount + 1
  return {
    ...state,
    appRoomCount: n,
    appRoomNames: [...state.appRoomNames, `Room ${n}`],
  }
}

/** First app room for assign flow when `appRoomCount` is still 0 (does not require two devices). */
export function ensureAtLeastOneAppRoom(state: SimulatorState): SimulatorState {
  if (state.appRoomCount >= 1) return state
  const name = state.appRoomNames[0]?.trim() || 'Room 1'
  return {
    ...state,
    appRoomCount: 1,
    appRoomNames: [name],
  }
}
