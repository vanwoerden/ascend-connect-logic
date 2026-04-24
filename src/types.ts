/**
 * Contract for the logic explorer. Edit simulator defaults in public/config/factors.json,
 * screen copy in public/config/screens.json, and routing in public/config/rules.json.
 */

export type PermissionValue = 'unset' | 'granted' | 'denied'

export type DeviceStatus = 'offline' | 'unassigned' | 'assigned'

/** How the speaker reaches the LAN for discovery/control in the simulator. */
export type DeviceLanTransport = 'wifi' | 'ethernet'

export interface SimulatorDevice {
  /** Lowercase `6c-` + five [0-9a-z] characters (see `logic/deviceId.ts`). */
  id: string
  status: DeviceStatus
  /** When status is assigned, which app room id (e.g. room-1). */
  assignedRoomId?: string
  /**
   * How the speaker reaches the LAN (Wi‑Fi vs wired). Used for copy and rules;
   * discovery still requires the phone to be on Wi‑Fi in this simulator. Defaults to Wi‑Fi.
   */
  lanTransport?: DeviceLanTransport
}

export interface SimulatorState {
  permissions: {
    bluetooth: PermissionValue
    camera: PermissionValue
    network: PermissionValue
  }
  wifiConnected: boolean
  /** Rooms created in the app (source of truth for “no / one / many”). */
  appRoomCount: number
  /** Rooms visible on the network that are not in the app’s list. */
  networkOnlyRoomCount: number
  /** Labels for the mock list of network-only rooms (length matches networkOnlyRoomCount when non-zero). */
  networkRoomNames: string[]
  /** Optional labels for mock body text; length may differ from counts. */
  appRoomNames: string[]
  /** Room opened from the in-app list (`room-1` …); only honored if that room has assigned devices. */
  activeRoomId: string | null
  /**
   * When true, DeviceFrame opens Settings to “App & network rooms” once, then clears.
   * Not persisted (stripped in saveSimulatorState).
   */
  pendingOpenSettingsNetworkRooms?: boolean
  loggedIn: boolean
  devices: SimulatorDevice[]
}

export interface ScreenAction {
  id: string
  label: string
  description?: string
}

export interface Screen {
  id: string
  title: string
  /** Optional centered nav title (e.g. room setup from Figma). */
  navTitle?: string
  body: string
  /** Shown on `devices_found_pick` / `room_setup` when zero reachable unassigned devices (see DeviceFrame). */
  bodyZeroDevices?: string
  actions: ScreenAction[]
}

export interface Rule {
  id: string
  /** Partial state slice; first ordered rule where this matches wins. */
  match: Record<string, unknown>
  screenId: string
  notes?: string
}

/** Loaded factors.json shape: metadata + default state fields. */
export interface FactorsConfig {
  defaults: Partial<Omit<SimulatorState, 'permissions' | 'devices'>> & {
    permissions?: Partial<SimulatorState['permissions']>
    devices?: Partial<SimulatorDevice>[]
  }
}

export interface RulesConfig {
  rules: Rule[]
  fallbackScreenId: string
}

export interface ScreensConfig {
  screens: Screen[]
}

export interface ResolutionResult {
  screen: Screen
  matchedRuleId: string | null
  fallbackUsed: boolean
  /**
   * When true, `network` is still `unset`, the `network_unset` rule is skipped for
   * resolution, and the phone shows an allow/deny modal on the next matching screen.
   */
  networkPermissionPrompt?: boolean
}
