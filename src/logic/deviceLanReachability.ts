import type {
  DeviceLanTransport,
  SimulatorDevice,
  SimulatorState,
} from '../types'

export function getEffectiveLanTransport(d: SimulatorDevice): DeviceLanTransport {
  return d.lanTransport === 'ethernet' ? 'ethernet' : 'wifi'
}

/**
 * Whether the app can discover / control this device on the LAN.
 * The simulator only models the phone on Wi‑Fi; `lanTransport` is metadata for the speaker.
 * Wi‑Fi path speakers are only considered detectable when network, Bluetooth, and camera
 * are all granted (Ethernet-only speakers skip the Bluetooth/camera gate).
 */
export function isDeviceReachableOnLan(
  state: SimulatorState,
  d: SimulatorDevice,
): boolean {
  if (d.status === 'offline') return false
  if (!state.wifiConnected) return false
  if (state.permissions.network !== 'granted') return false

  if (getEffectiveLanTransport(d) === 'wifi') {
    return (
      state.permissions.bluetooth === 'granted' &&
      state.permissions.camera === 'granted'
    )
  }
  return true
}

/** Phone is in a state where Ethernet-path LAN discovery could work (Wi‑Fi + network granted + logged in). */
export function networkAllowsLanDiscovery(state: SimulatorState): boolean {
  return (
    state.loggedIn &&
    state.wifiConnected &&
    state.permissions.network === 'granted'
  )
}

/** Wi‑Fi transport speakers are discoverable (requires Bluetooth + Camera in this simulator). */
export function wifiSpeakerDiscoveryAllowed(
  state: SimulatorState,
): boolean {
  if (!networkAllowsLanDiscovery(state)) return false
  return (
    state.permissions.bluetooth === 'granted' &&
    state.permissions.camera === 'granted'
  )
}

/**
 * Unassigned devices that are not currently reachable on the LAN (permissions, Wi‑Fi, etc.).
 * Offline devices use `status: offline`, not `unassigned`, in normal data.
 */
export function countUnassignedNotReachableDueToPermissions(
  state: SimulatorState,
): number {
  return state.devices.filter(
    (d) => d.status === 'unassigned' && !isDeviceReachableOnLan(state, d),
  ).length
}

export function hasAnyReachableUnassigned(state: SimulatorState): boolean {
  return state.devices.some(
    (d) => d.status === 'unassigned' && isDeviceReachableOnLan(state, d),
  )
}

export function hasAnyReachableAssigned(state: SimulatorState): boolean {
  return state.devices.some(
    (d) => d.status === 'assigned' && isDeviceReachableOnLan(state, d),
  )
}

/** Any non-offline device that uses Wi‑Fi to reach the LAN (subject to the BT/Camera gate). */
export function hasAnyWifiTransportDeviceOnLan(
  state: SimulatorState,
): boolean {
  return state.devices.some(
    (d) => d.status !== 'offline' && getEffectiveLanTransport(d) === 'wifi',
  )
}

export type LanDiscoveryBanner = {
  variant: 'need_network' | 'wifi_speakers_gated'
  body: string
}

/**
 * Strip to show when LAN discovery is blocked or only partial (Ethernet may still work).
 * Omit the network variant while the OS network prompt is open to avoid duplicate copy.
 */
export function getLanDiscoveryBannerIfAny(
  state: SimulatorState,
  options?: { suppressNetworkBannerBecauseModal?: boolean },
): LanDiscoveryBanner | null {
  if (!state.loggedIn || !state.wifiConnected) return null

  if (state.permissions.network !== 'granted') {
    if (options?.suppressNetworkBannerBecauseModal) return null
    return {
      variant: 'need_network',
      body: 'This app can’t detect devices on your network until network access is allowed. Use the system prompt or change the permission in Settings.',
    }
  }

  if (
    !wifiSpeakerDiscoveryAllowed(state) &&
    hasAnyWifiTransportDeviceOnLan(state)
  ) {
    return {
      variant: 'wifi_speakers_gated',
      body: '',
    }
  }

  return null
}

/** When unassigned devices exist in state but none are listed as reachable. */
export function getUnassignedHiddenExplainer(
  state: SimulatorState,
): string | null {
  const unassigned = state.devices.filter((d) => d.status === 'unassigned')
  if (unassigned.length === 0) return null
  if (unassigned.some((d) => isDeviceReachableOnLan(state, d))) return null

  if (!networkAllowsLanDiscovery(state)) {
    return 'Unassigned devices aren’t listed until you’re on Wi‑Fi with network access allowed.'
  }

  return 'Unassigned Wi‑Fi speakers are hidden until Bluetooth and Camera are allowed. Ethernet speakers only need network access and can appear here.'
}

/** Some unassigned devices are listed and some are hidden by the Wi‑Fi discovery gate. */
export function getPartiallyHiddenUnassignedNote(
  state: SimulatorState,
): string | null {
  if (!networkAllowsLanDiscovery(state)) return null
  if (wifiSpeakerDiscoveryAllowed(state)) return null

  const unassigned = state.devices.filter((d) => d.status === 'unassigned')
  const hidden = unassigned.filter((d) => !isDeviceReachableOnLan(state, d))
  const shown = unassigned.filter((d) => isDeviceReachableOnLan(state, d))
  if (hidden.length === 0 || shown.length === 0) return null

  return 'Some unassigned Wi‑Fi speakers aren’t listed until Bluetooth and Camera are allowed.'
}
