import { isDeviceReachableOnLan } from './deviceLanReachability'
import type { SimulatorDevice, SimulatorState } from '../types'

/** Shown in rule debug / diagram when screen comes from room list tap (not rules.json). */
export const ROOM_OPEN_MATCH_ID = '__room_open__'

export function isValidAppRoomId(state: SimulatorState, roomId: string): boolean {
  const m = /^room-(\d+)$/.exec(roomId)
  if (!m) return false
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) && n >= 1 && n <= state.appRoomCount
}

/** Network-only rooms in the simulator (`lan-1` …). */
export function isValidNetworkRoomId(
  state: SimulatorState,
  roomId: string,
): boolean {
  const m = /^lan-(\d+)$/.exec(roomId)
  if (!m) return false
  const n = Number.parseInt(m[1], 10)
  return (
    Number.isFinite(n) &&
    n >= 1 &&
    n <= state.networkOnlyRoomCount
  )
}

export function roomHasAssignedDevices(
  state: SimulatorState,
  roomId: string,
): boolean {
  return state.devices.some(
    (d) => d.status === 'assigned' && d.assignedRoomId === roomId,
  )
}

export function getAssignedDeviceIdsForRoom(
  state: SimulatorState,
  roomId: string,
): string[] {
  return state.devices
    .filter((d) => d.status === 'assigned' && d.assignedRoomId === roomId)
    .map((d) => d.id)
}

/** Devices on the LAN not assigned to any room (same notion as create-room’s minimum pair). */
export function getUnassignedLanDeviceIds(state: SimulatorState): string[] {
  return state.devices
    .filter(
      (d) => d.status === 'unassigned' && isDeviceReachableOnLan(state, d),
    )
    .map((d) => d.id)
}

export function getOfflineDeviceIds(state: SimulatorState): string[] {
  return state.devices
    .filter((d) => d.status === 'offline')
    .map((d) => d.id)
}

export function assignDevicesToRoom(
  state: SimulatorState,
  deviceIds: readonly string[],
  roomId: string,
): SimulatorState {
  const ids = new Set(deviceIds)
  return {
    ...state,
    devices: state.devices.map((d) =>
      ids.has(d.id) && d.status === 'unassigned'
        ? { ...d, status: 'assigned' as const, assignedRoomId: roomId }
        : d,
    ),
  }
}

/** Remove one assigned device from a room, then assign the given unassigned ids into that room. */
export function replaceRoomAssignment(
  state: SimulatorState,
  roomId: string,
  removeDeviceId: string,
  addUnassignedDeviceIds: readonly string[],
): SimulatorState {
  const add = new Set(addUnassignedDeviceIds)
  return {
    ...state,
    devices: state.devices.map((d) => {
      if (
        d.id === removeDeviceId &&
        d.status === 'assigned' &&
        d.assignedRoomId === roomId
      ) {
        return {
          ...d,
          status: 'unassigned' as const,
          assignedRoomId: undefined,
        }
      }
      if (add.has(d.id) && d.status === 'unassigned') {
        return { ...d, status: 'assigned' as const, assignedRoomId: roomId }
      }
      return d
    }),
  }
}

export function shouldOpenRoomDetail(state: SimulatorState): boolean {
  if (!state.loggedIn) return false
  if (!state.wifiConnected) return false
  const id = state.activeRoomId
  if (!id) return false
  return isValidAppRoomId(state, id) || isValidNetworkRoomId(state, id)
}

/** Move devices from app `room-k` into new `lan-*`, compact higher `room-*` ids. */
function mapDeviceAfterPromoteAppRoomToNetwork(
  d: SimulatorDevice,
  k: number,
  newLanId: string,
): SimulatorDevice {
  if (d.status !== 'assigned' || !d.assignedRoomId) return d
  const rm = /^room-(\d+)$/.exec(d.assignedRoomId)
  if (!rm) return d
  const j = Number(rm[1])
  if (j === k) {
    return { ...d, assignedRoomId: newLanId }
  }
  if (j > k) {
    return { ...d, assignedRoomId: `room-${j - 1}` }
  }
  return d
}

function mapDeviceAfterRoomDelete(
  d: SimulatorDevice,
  prefix: 'room' | 'lan',
  deletedIndex: number,
): SimulatorDevice {
  if (d.status !== 'assigned' || !d.assignedRoomId) return d
  const re = prefix === 'room' ? /^room-(\d+)$/ : /^lan-(\d+)$/
  const m = re.exec(d.assignedRoomId)
  if (!m) return d
  const j = Number(m[1])
  if (j === deletedIndex) {
    return { ...d, status: 'unassigned' as const, assignedRoomId: undefined }
  }
  if (j > deletedIndex) {
    return { ...d, assignedRoomId: `${prefix}-${j - 1}` }
  }
  return d
}

function remapActiveRoomIdAfterDelete(
  activeRoomId: string | null,
  prefix: 'room' | 'lan',
  k: number,
): string | null {
  if (!activeRoomId) return null
  const re = prefix === 'room' ? /^room-(\d+)$/ : /^lan-(\d+)$/
  const m = re.exec(activeRoomId)
  if (!m) return activeRoomId
  const j = Number(m[1])
  if (j === k) return null
  if (j > k) return `${prefix}-${j - 1}`
  return activeRoomId
}

/** At least one app room exists and none have assigned devices. */
export function allAppRoomsExistButAllEmpty(state: SimulatorState): boolean {
  if (state.appRoomCount < 1) return false
  for (let i = 1; i <= state.appRoomCount; i++) {
    if (getAssignedDeviceIdsForRoom(state, `room-${i}`).length > 0) {
      return false
    }
  }
  return true
}

/** At least one app room exists with zero assigned speakers. */
export function hasEmptyAppRoom(state: SimulatorState): boolean {
  if (state.appRoomCount < 1) return false
  for (let i = 1; i <= state.appRoomCount; i++) {
    if (getAssignedDeviceIdsForRoom(state, `room-${i}`).length === 0) {
      return true
    }
  }
  return false
}

/**
 * Empty app room(s) plus reachable unassigned devices — show App & network rooms
 * so the user can assign into an app room.
 */
export function shouldOpenAppNetworkRoomsForAssignment(
  state: SimulatorState,
): boolean {
  if (!state.loggedIn) return false
  if (!hasEmptyAppRoom(state)) return false
  return state.devices.some(
    (d) => d.status === 'unassigned' && isDeviceReachableOnLan(state, d),
  )
}

/**
 * After deleting an app room: first `room-*` (ascending) with assigned devices, else null.
 */
function pickActiveRoomIdAfterAppRoomDelete(
  next: SimulatorState,
): string | null {
  for (let i = 1; i <= next.appRoomCount; i++) {
    const id = `room-${i}`
    if (getAssignedDeviceIdsForRoom(next, id).length > 0) return id
  }
  return null
}

export function deleteAppRoomAtIndex(
  state: SimulatorState,
  k: number,
): SimulatorState {
  if (k < 1 || k > state.appRoomCount) return state
  const newCount = state.appRoomCount - 1
  const newNames = state.appRoomNames.filter((_, i) => i !== k - 1)
  const devices = state.devices.map((d) =>
    mapDeviceAfterRoomDelete(d, 'room', k),
  )
  const next: SimulatorState = {
    ...state,
    appRoomCount: newCount,
    appRoomNames: newNames,
    devices,
  }
  const activeRoomId = pickActiveRoomIdAfterAppRoomDelete(next)
  const openSettings =
    activeRoomId === null &&
    next.appRoomCount >= 1 &&
    allAppRoomsExistButAllEmpty(next)
  return {
    ...next,
    activeRoomId,
    pendingOpenSettingsNetworkRooms: openSettings ? true : undefined,
  }
}

export function deleteNetworkRoomAtIndex(
  state: SimulatorState,
  k: number,
): SimulatorState {
  if (k < 1 || k > state.networkOnlyRoomCount) return state
  const newCount = state.networkOnlyRoomCount - 1
  const newNames = state.networkRoomNames.filter((_, i) => i !== k - 1)
  const devices = state.devices.map((d) =>
    mapDeviceAfterRoomDelete(d, 'lan', k),
  )
  return {
    ...state,
    networkOnlyRoomCount: newCount,
    networkRoomNames: newNames,
    devices,
    activeRoomId: remapActiveRoomIdAfterDelete(state.activeRoomId, 'lan', k),
  }
}

/** Removes an app (`room-*`) or network-only (`lan-*`) room and compacts higher indices. */
const MAX_ROOM_BUCKETS = 10

/**
 * Removes one app room from the in-app list and appends it as a LAN-only room.
 * Assignments in that room move to the new `lan-*` id; higher `room-*` indices compact.
 * No-op if the simulator already has the maximum number of network-only rooms.
 */
export function promoteAppRoomToNetworkOnly(
  state: SimulatorState,
  roomId: string,
): SimulatorState {
  const appM = /^room-(\d+)$/.exec(roomId)
  if (!appM) return state
  const k = Number(appM[1])
  if (!isValidAppRoomId(state, roomId)) return state
  if (state.networkOnlyRoomCount >= MAX_ROOM_BUCKETS) return state

  const M = state.networkOnlyRoomCount
  const newLanId = `lan-${M + 1}`
  const roomName =
    state.appRoomNames[k - 1]?.trim() || `Room ${k}`

  const devices = state.devices.map((d) =>
    mapDeviceAfterPromoteAppRoomToNetwork(d, k, newLanId),
  )

  const newAppCount = state.appRoomCount - 1
  const newAppNames = state.appRoomNames.filter((_, i) => i !== k - 1)

  let activeRoomId: string | null = state.activeRoomId
  if (activeRoomId === roomId) {
    activeRoomId = newLanId
  } else if (activeRoomId) {
    const r2 = /^room-(\d+)$/.exec(activeRoomId)
    if (r2) {
      const j = Number(r2[1])
      if (j > k) activeRoomId = `room-${j - 1}`
    }
  }

  return {
    ...state,
    appRoomCount: newAppCount,
    appRoomNames: newAppNames,
    networkOnlyRoomCount: M + 1,
    networkRoomNames: [...state.networkRoomNames, roomName],
    devices,
    activeRoomId,
  }
}

export function deleteRoomById(
  state: SimulatorState,
  roomId: string,
): SimulatorState {
  const appM = /^room-(\d+)$/.exec(roomId)
  if (appM) {
    const k = Number(appM[1])
    if (!isValidAppRoomId(state, roomId)) return state
    return deleteAppRoomAtIndex(state, k)
  }
  const lanM = /^lan-(\d+)$/.exec(roomId)
  if (lanM) {
    const k = Number(lanM[1])
    if (!isValidNetworkRoomId(state, roomId)) return state
    return deleteNetworkRoomAtIndex(state, k)
  }
  return state
}
