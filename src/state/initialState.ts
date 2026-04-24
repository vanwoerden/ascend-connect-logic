import { normalizeDeviceId } from '../logic/deviceId'
import {
  isValidAppRoomId,
  isValidNetworkRoomId,
} from '../logic/roomNavigation'
import type {
  DeviceLanTransport,
  DeviceStatus,
  FactorsConfig,
  PermissionValue,
  SimulatorDevice,
  SimulatorState,
} from '../types'

function clamp10(n: number) {
  return Math.max(0, Math.min(10, Math.floor(Number(n) || 0)))
}

function perm(x: unknown): PermissionValue {
  return x === 'unset' || x === 'granted' || x === 'denied' ? x : 'unset'
}

function reviveDevice(d: unknown, i: number): SimulatorDevice {
  if (!d || typeof d !== 'object') {
    return { id: normalizeDeviceId(undefined, i), status: 'unassigned' }
  }
  const o = d as Record<string, unknown>
  const id = normalizeDeviceId(o.id, i)
  const st = o.status
  const status: DeviceStatus =
    st === 'offline' || st === 'unassigned' || st === 'assigned' ? st : 'unassigned'
  let assignedRoomId =
    typeof o.assignedRoomId === 'string' ? o.assignedRoomId : undefined
  if (status !== 'assigned') assignedRoomId = undefined
  if (status === 'assigned' && !assignedRoomId) {
    return { id, status: 'unassigned' }
  }
  const lt = o.lanTransport
  const lanTransport: DeviceLanTransport | undefined =
    lt === 'ethernet' || lt === 'wifi' ? lt : undefined
  return { id, status, assignedRoomId, lanTransport }
}

/** Coerce counts, name arrays, devices, and permissions after JSON load or factor merge. */
export function normalizeSimulatorState(s: SimulatorState): SimulatorState {
  const appRoomCount = clamp10(s.appRoomCount)
  const networkOnlyRoomCount = clamp10(s.networkOnlyRoomCount)

  const appRoomNames = Array.isArray(s.appRoomNames) ? [...s.appRoomNames] : []
  while (appRoomNames.length < appRoomCount) {
    appRoomNames.push(`Room ${appRoomNames.length + 1}`)
  }
  appRoomNames.length = appRoomCount

  const networkRoomNames = Array.isArray(s.networkRoomNames)
    ? [...s.networkRoomNames]
    : []
  while (networkRoomNames.length < networkOnlyRoomCount) {
    networkRoomNames.push(`LAN room ${networkRoomNames.length + 1}`)
  }
  networkRoomNames.length = networkOnlyRoomCount

  const devices = (Array.isArray(s.devices) ? s.devices : [])
    .slice(0, 10)
    .map((d, i) => reviveDevice(d, i))

  const activeRoomIdCandidate =
    typeof s.activeRoomId === 'string' && s.activeRoomId.length > 0
      ? s.activeRoomId
      : null

  const out: SimulatorState = {
    permissions: {
      bluetooth: perm(s.permissions?.bluetooth),
      camera: perm(s.permissions?.camera),
      network: perm(s.permissions?.network),
    },
    wifiConnected: Boolean(s.wifiConnected),
    appRoomCount,
    networkOnlyRoomCount,
    networkRoomNames,
    appRoomNames,
    activeRoomId: activeRoomIdCandidate,
    loggedIn: Boolean(s.loggedIn),
    devices,
  }

  if (
    out.activeRoomId &&
    !isValidAppRoomId(out, out.activeRoomId) &&
    !isValidNetworkRoomId(out, out.activeRoomId)
  ) {
    return { ...out, activeRoomId: null }
  }
  return out
}

const emptyState = (): SimulatorState => ({
  permissions: {
    bluetooth: 'unset',
    camera: 'unset',
    network: 'unset',
  },
  wifiConnected: true,
  appRoomCount: 0,
  networkOnlyRoomCount: 0,
  networkRoomNames: [],
  appRoomNames: [],
  activeRoomId: null,
  loggedIn: false,
  devices: [],
})

export function mergeFactorDefaults(factors: FactorsConfig | null): SimulatorState {
  const base = emptyState()
  if (!factors?.defaults) return base
  const d = factors.defaults
  const merged = {
    ...base,
    ...d,
    permissions: {
      ...base.permissions,
      ...d.permissions,
    },
    appRoomNames: Array.isArray(d.appRoomNames) ? [...d.appRoomNames] : base.appRoomNames,
    networkRoomNames: Array.isArray(d.networkRoomNames)
      ? [...d.networkRoomNames]
      : base.networkRoomNames,
    devices: Array.isArray(d.devices)
      ? d.devices.map((dev, i) => ({
          id: normalizeDeviceId(dev?.id, i),
          status: dev.status ?? 'unassigned',
          assignedRoomId: dev.assignedRoomId,
          lanTransport:
            dev.lanTransport === 'ethernet' || dev.lanTransport === 'wifi'
              ? dev.lanTransport
              : undefined,
        }))
      : base.devices,
  } satisfies SimulatorState

  return normalizeSimulatorState(merged)
}
