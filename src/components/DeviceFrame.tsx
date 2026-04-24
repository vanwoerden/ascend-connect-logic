import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useRef, useState } from 'react'
import { isDeviceActionVisible } from '../logic/deviceActions'
import {
  getLanDiscoveryBannerIfAny,
  getPartiallyHiddenUnassignedNote,
  getUnassignedHiddenExplainer,
  isDeviceReachableOnLan,
  networkAllowsLanDiscovery,
} from '../logic/deviceLanReachability'
import {
  assignDevicesToRoom,
  deleteRoomById,
  getAssignedDeviceIdsForRoom,
  getOfflineDeviceIds,
  getUnassignedLanDeviceIds,
  isValidAppRoomId,
  isValidNetworkRoomId,
  promoteAppRoomToNetworkOnly,
  replaceRoomAssignment,
  shouldOpenAppNetworkRoomsForAssignment,
  shouldOpenRoomDetail,
} from '../logic/roomNavigation'
import {
  applyCreateRoom,
  canCreateRoom,
  createRoomDisabledReason,
  ensureAtLeastOneAppRoom,
} from '../logic/createRoom'
import type { Screen, ScreenAction, SimulatorState } from '../types'

interface DeviceFrameProps {
  screen: Screen
  state: SimulatorState
  onStateChange: Dispatch<SetStateAction<SimulatorState | null>>
  /** When true, show OS-style allow/deny over the resolved screen (network still `unset`). */
  networkPermissionPrompt?: boolean
  /** Copy for that modal; defaults to Network access / discovery text if missing. */
  permissionsNetworkScreen?: Screen | null
}

type YeetDialogSource =
  | 'assign_room_sheet'
  | 'new_device_sheet'
  | 'settings_room_list'

interface YeetDialogState {
  roomId: string
  incomingIds: readonly string[]
  occupantIds: readonly [string, string]
  source: YeetDialogSource
}

const CREATE_ROOM_NEED_TWO_SELECTED_MSG = 'need 2 devices for each room'

const ASSIGN_PICK_NEED_TWO_MSG =
  'Select exactly two devices to assign to a room.'
const ASSIGN_PICK_ONLY_TWO_MSG =
  'Select only two devices at a time to assign to a room.'

const DEVICES_FOUND_PICK_ZERO_HINT_FALLBACK =
  'Make sure your devices are powered on and connected to the same network as your phone.'

function assignToRoomPickTitle(selectedCount: number): string {
  if (selectedCount === 0) return 'Select exactly two devices first.'
  if (selectedCount === 1)
    return 'Select one more device — two are required to assign to a room.'
  return 'Deselect to exactly two devices to assign to a room.'
}

/** Substitutes `{{count}}` from screens.json; fixes “1 devices” → “1 device”. */
function formatDevicesFoundTitle(template: string, count: number): string {
  const withCount = template.replace(/\{\{count\}\}/g, String(count))
  return withCount.replace(/\b1 devices\b/g, '1 device')
}

/** `no_rooms_network_devices` body: `{{count}}`, `{{devices}}` → device / devices. */
function formatNoRoomsDevicesBody(template: string, count: number): string {
  const devices = count === 1 ? 'device' : 'devices'
  return template
    .replace(/\{\{count\}\}/g, String(count))
    .replace(/\{\{devices\}\}/g, devices)
}

const ROOM_SETUP_BODY_SPLIT = /\n\n+/

function roomSetupBodyParagraphs(body: string): string[] {
  return body
    .split(ROOM_SETUP_BODY_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)
}

function roomSetupActionRank(id: string): number {
  if (id === 'connect_local_network') return 0
  if (id === 'skip_room_setup') return 1
  if (id === 'assign_device') return 2
  if (id === 'remove_device') return 3
  return 9
}

/** Figma: connect to local network — nav + progress (node 9277:34749). */
function RoomSetupFigNav({ navTitle }: { navTitle: string }) {
  return (
    <>
      <div className="device-frame__room-setup-nav">
        <button
          type="button"
          className="device-frame__room-setup-back"
          onClick={() => console.info('room_setup: back')}
        >
          <span className="device-frame__room-setup-back-chevron" aria-hidden>
            ‹
          </span>
          Back
        </button>
        <span className="device-frame__room-setup-nav-title">{navTitle}</span>
      </div>
      <div className="device-frame__room-setup-progress" aria-hidden>
        <div className="device-frame__room-setup-progress-fill" />
      </div>
    </>
  )
}

function RoomSetupQrIllustration() {
  return (
    <figure
      className="device-frame__room-setup-illus device-frame__room-setup-illus--qr"
      aria-hidden
    >
      <div className="device-frame__room-setup-illus-plate">
        <div className="device-frame__room-setup-illus-shell" />
        <div className="device-frame__room-setup-illus-vents" />
        <div className="device-frame__room-setup-illus-qr-slot" />
        <div className="device-frame__room-setup-illus-arrow" />
        <span className="device-frame__room-setup-illus-label">QR code</span>
      </div>
    </figure>
  )
}

function RoomSetupEthernetIllustration() {
  return (
    <figure
      className="device-frame__room-setup-illus device-frame__room-setup-illus--eth"
      aria-hidden
    >
      <div className="device-frame__room-setup-illus-plate device-frame__room-setup-illus-plate--eth">
        <div className="device-frame__room-setup-illus-shell device-frame__room-setup-illus-shell--eth" />
        <div className="device-frame__room-setup-illus-vents device-frame__room-setup-illus-vents--eth" />
        <div className="device-frame__room-setup-illus-rj" />
        <div className="device-frame__room-setup-illus-arrow device-frame__room-setup-illus-arrow--eth" />
        <span className="device-frame__room-setup-illus-label device-frame__room-setup-illus-label--eth">
          Ethernet port
        </span>
      </div>
    </figure>
  )
}

type AppNetworkRoomSection = {
  heading: string
  rooms: readonly { id: string; label: string }[]
  /** When true, room rows use assign-to-app-room rules (full room + selection). */
  allowAssignFromUnassigned?: boolean
}

function AppNetworkRoomsSectionedList({
  state,
  sections,
  onPickRoom,
  selectedUnassignedIds,
  onToggleUnassignedDevice,
  emptyMessage = 'No app or network rooms in this preview.',
}: {
  state: SimulatorState
  sections: AppNetworkRoomSection[]
  onPickRoom: (roomId: string) => void
  selectedUnassignedIds: readonly string[]
  onToggleUnassignedDevice: (deviceId: string) => void
  emptyMessage?: string
}) {
  const unassignedOnLan = state.devices.filter(
    (d) => d.status === 'unassigned' && isDeviceReachableOnLan(state, d),
  )
  const unassignedHiddenExplainer = getUnassignedHiddenExplainer(state)
  const partiallyHiddenUnassignedNote =
    getPartiallyHiddenUnassignedNote(state)
  const assignPickCount = selectedUnassignedIds.length

  return (
    <>
      {sections.length === 0 ? (
        <p className="device-frame__settings-empty">{emptyMessage}</p>
      ) : (
        sections.map((section) => (
          <section
            key={section.heading}
            className="device-frame__settings-room-section"
            aria-label={section.heading}
          >
            <h3 className="device-frame__settings-room-section-title">
              {section.heading}
            </h3>
            <ul className="device-frame__settings-network-room-list">
              {section.rooms.map((room) => {
                const ids = getAssignedDeviceIdsForRoom(state, room.id)
                const allowAssign = section.allowAssignFromUnassigned ?? false
                const cap = Math.max(0, 2 - ids.length)
                const tooManySelectedForRoom =
                  allowAssign &&
                  assignPickCount > 0 &&
                  ids.length < 2 &&
                  assignPickCount > cap
                const assignDisabled =
                  allowAssign &&
                  assignPickCount > 0 &&
                  ((ids.length >= 2 && assignPickCount !== 1) ||
                    tooManySelectedForRoom)
                const roomBtnClass = [
                  'device-frame__settings-network-room-block',
                  'device-frame__settings-network-room-block--clickable',
                  assignDisabled
                    ? 'device-frame__settings-network-room-block--assign-disabled'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <li
                    key={room.id}
                    className="device-frame__settings-network-room-item"
                  >
                    <button
                      type="button"
                      className={roomBtnClass}
                      disabled={assignDisabled}
                      title={
                        assignDisabled
                          ? ids.length >= 2
                            ? 'This room is full — select one device above, then tap here to swap one out'
                            : `This room has room for ${cap} more speaker${cap === 1 ? '' : 's'} — deselect extra devices`
                          : undefined
                      }
                      onClick={() => onPickRoom(room.id)}
                    >
                      <div className="device-frame__settings-network-room-head">
                        <span className="device-frame__settings-network-room-name">
                          {room.label}
                        </span>
                        <code className="device-frame__settings-network-room-id">
                          {room.id}
                        </code>
                      </div>
                      {ids.length === 0 ? (
                        <p className="device-frame__settings-network-room-empty">
                          No devices assigned to this room in the preview.
                        </p>
                      ) : (
                        <ul className="device-frame__settings-network-device-list">
                          {ids.map((id) => (
                            <li key={id}>
                              <code className="device-frame__settings-network-device-id">
                                {id}
                              </code>
                            </li>
                          ))}
                        </ul>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
      {unassignedHiddenExplainer ? (
        <section
          className="device-frame__settings-room-section device-frame__settings-unassigned-section"
          aria-label="Unassigned devices"
        >
          <h3 className="device-frame__settings-room-section-title">
            Unassigned devices
          </h3>
          <p className="device-frame__settings-unassigned-blocked">
            {unassignedHiddenExplainer}
          </p>
        </section>
      ) : unassignedOnLan.length > 0 ? (
        <section
          className="device-frame__settings-room-section device-frame__settings-unassigned-section"
          aria-label="Unassigned devices"
        >
          <h3 className="device-frame__settings-room-section-title">
            Unassigned devices
          </h3>
          <p className="device-frame__settings-unassigned-lead">
            On the network, not in a room. Tap to select, then tap an app room
            below to assign.
          </p>
          <ul className="device-frame__settings-unassigned-device-list">
            {unassignedOnLan.map((d) => {
              const selected = selectedUnassignedIds.includes(d.id)
              return (
                <li key={d.id} className="device-frame__settings-unassigned-device-item">
                  <button
                    type="button"
                    className={
                      selected
                        ? 'device-frame__settings-unassigned-device-select device-frame__settings-unassigned-device-select--selected'
                        : 'device-frame__settings-unassigned-device-select'
                    }
                    aria-pressed={selected}
                    onClick={() => onToggleUnassignedDevice(d.id)}
                  >
                    <code className="device-frame__settings-unassigned-device-id">
                      {d.id}
                    </code>
                    <span className="device-frame__settings-unassigned-device-hint">
                      {selected ? 'Selected' : 'Tap to select'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {partiallyHiddenUnassignedNote ? (
            <p className="device-frame__settings-unassigned-partial">
              {partiallyHiddenUnassignedNote}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

function PlusInCircleIcon() {
  return (
    <svg
      className="device-frame__no-rooms-create-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M8 3.5v9M3.5 8h9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function EllipsisVerticalIcon() {
  return (
    <svg
      className="device-frame__room-overflow-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  )
}

function SettingsGearIcon() {
  return (
    <svg
      className="device-frame__settings-gear-svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

export function DeviceFrame({
  screen,
  state,
  onStateChange,
  networkPermissionPrompt = false,
  permissionsNetworkScreen,
}: DeviceFrameProps) {
  const networkPermTitle =
    permissionsNetworkScreen?.title?.trim() || 'Network access'
  const networkPermBody =
    permissionsNetworkScreen?.body?.trim() ||
    'The app needs network permission to discover rooms and detect devices on the network.'
  const unassignedDevices = state.devices.filter(
    (d) => d.status === 'unassigned' && isDeviceReachableOnLan(state, d),
  )
  const isNoRoomsNetworkDevicesScreen = screen.id === 'no_rooms_network_devices'
  const isRoomDevicePickScreen =
    screen.id === 'devices_found_pick' ||
    screen.id === 'room_setup' ||
    isNoRoomsNetworkDevicesScreen
  const canDetectOnLan = state.permissions.network === 'granted'
  const lanDiscoveryOk = networkAllowsLanDiscovery(state)
  const showUnassignedCards =
    lanDiscoveryOk && unassignedDevices.length > 0
  const unassignedHiddenExplainerMain = getUnassignedHiddenExplainer(state)
  const partiallyHiddenUnassignedNoteMain =
    getPartiallyHiddenUnassignedNote(state)
  const lanDiscoveryBanner = getLanDiscoveryBannerIfAny(state, {
    suppressNetworkBannerBecauseModal: networkPermissionPrompt,
  })
  const lanDiscoveryBannerEl =
    lanDiscoveryBanner && state.loggedIn ? (
      <div
        className={
          lanDiscoveryBanner.variant === 'need_network'
            ? 'device-frame__discovery-banner device-frame__discovery-banner--network'
            : 'device-frame__discovery-banner device-frame__discovery-banner--wifi-gated'
        }
        role="status"
      >
        {lanDiscoveryBanner.body}
      </div>
    ) : null

  const networkCount = state.networkOnlyRoomCount
  const showNetworkRooms =
    state.loggedIn &&
    state.wifiConnected &&
    canDetectOnLan &&
    networkCount > 0
  const networkLabels = Array.from({ length: networkCount }, (_, i) => {
    const named = state.networkRoomNames[i]?.trim()
    return named || `Network room ${i + 1}`
  })

  const appRoomCount = state.appRoomCount
  const showAppRooms = state.loggedIn && state.wifiConnected && appRoomCount > 0
  const appRoomItems = Array.from({ length: appRoomCount }, (_, i) => {
    const id = `room-${i + 1}`
    const named = state.appRoomNames[i]?.trim()
    return { id, label: named || `Room ${i + 1}` }
  })

  const networkRoomItems = Array.from({ length: networkCount }, (_, i) => ({
    id: `lan-${i + 1}`,
    label: networkLabels[i] ?? `Network room ${i + 1}`,
  }))

  const roomLabelForId = (roomId: string) =>
    appRoomItems.find((r) => r.id === roomId)?.label ??
    networkRoomItems.find((r) => r.id === roomId)?.label ??
    roomId

  const showRoomInteriorSwitcher =
    state.loggedIn &&
    screen.id === 'room_interior' &&
    shouldOpenRoomDetail(state)

  const interiorBaselineUnassignedRef = useRef<Set<string>>(new Set())
  const interiorEnteredRef = useRef(false)
  const lastInteriorRoomRef = useRef<string | null>(null)
  /** When true, next room_interior sync skips auto-picking the sole room (user chose "All rooms"). */
  const skipInteriorAutoRoomRef = useRef(false)
  const [newDeviceSheetIds, setNewDeviceSheetIds] = useState<string[] | null>(
    null,
  )
  const [selectedUnassignedIds, setSelectedUnassignedIds] = useState<string[]>(
    [],
  )
  const [assignRoomSheetIds, setAssignRoomSheetIds] = useState<string[] | null>(
    null,
  )
  const [yeetDialog, setYeetDialog] = useState<YeetDialogState | null>(null)
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const [settingsDrawerView, setSettingsDrawerView] = useState<
    'root' | 'networkRooms'
  >('root')
  const [roomOverflowOpen, setRoomOverflowOpen] = useState(false)
  const roomOverflowRef = useRef<HTMLDivElement>(null)
  /**
   * After we auto-open App & network rooms for empty-room + unassigned, don’t reopen
   * on every close until the condition clears (or pending flag opened the drawer once).
   */
  const appNetworkRoomsAutoShownRef = useRef(false)

  const showRoomOverflowMenu =
    screen.id === 'room_interior' && Boolean(state.activeRoomId)

  const closeSettingsDrawer = () => {
    setSettingsDrawerOpen(false)
    setSettingsDrawerView('root')
  }

  const openAppNetworkForAssignment =
    shouldOpenAppNetworkRoomsForAssignment(state)

  useEffect(() => {
    if (!state.pendingOpenSettingsNetworkRooms) return
    setSettingsDrawerOpen(true)
    setSettingsDrawerView('networkRooms')
    appNetworkRoomsAutoShownRef.current = true
    onStateChange((prev) =>
      prev
        ? { ...prev, pendingOpenSettingsNetworkRooms: undefined }
        : prev,
    )
  }, [state.pendingOpenSettingsNetworkRooms, onStateChange])

  useEffect(() => {
    if (!openAppNetworkForAssignment) {
      appNetworkRoomsAutoShownRef.current = false
      return
    }
    if (settingsDrawerOpen) return
    if (appNetworkRoomsAutoShownRef.current) return

    appNetworkRoomsAutoShownRef.current = true
    setSettingsDrawerOpen(true)
    setSettingsDrawerView('networkRooms')
  }, [openAppNetworkForAssignment, settingsDrawerOpen])

  useEffect(() => {
    if (!settingsDrawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsDrawerOpen(false)
        setSettingsDrawerView('root')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsDrawerOpen])

  useEffect(() => {
    if (!roomOverflowOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRoomOverflowOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [roomOverflowOpen])

  useEffect(() => {
    if (!roomOverflowOpen) return
    const onMouse = (e: MouseEvent) => {
      const el = roomOverflowRef.current
      if (el && !el.contains(e.target as Node)) setRoomOverflowOpen(false)
    }
    document.addEventListener('mousedown', onMouse)
    return () => document.removeEventListener('mousedown', onMouse)
  }, [roomOverflowOpen])

  useEffect(() => {
    setRoomOverflowOpen(false)
  }, [screen.id, state.activeRoomId])

  useEffect(() => {
    setSelectedUnassignedIds((prev) => {
      const valid = new Set(
        state.devices
          .filter((d) => d.status === 'unassigned')
          .map((d) => d.id),
      )
      const next = prev.filter((id) => valid.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [state.devices])

  useEffect(() => {
    if (screen.id !== 'room_interior') return
    onStateChange((prev) => {
      if (!prev || !prev.loggedIn) return prev
      const id = prev.activeRoomId
      if (skipInteriorAutoRoomRef.current) {
        skipInteriorAutoRoomRef.current = false
        if (!id) return prev
      }
      if (
        id &&
        (isValidAppRoomId(prev, id) || isValidNetworkRoomId(prev, id))
      ) {
        return prev
      }
      const items = Array.from({ length: prev.appRoomCount }, (_, i) => {
        const rid = `room-${i + 1}`
        const named = prev.appRoomNames[i]?.trim()
        return { id: rid, label: named || `Room ${i + 1}` }
      })
      const available = items.filter(
        (r) => getAssignedDeviceIdsForRoom(prev, r.id).length > 0,
      )
      if (available.length === 0) return prev
      if (!id) {
        if (available.length === 1) {
          return { ...prev, activeRoomId: available[0].id }
        }
        return prev
      }
      return { ...prev, activeRoomId: available[0].id }
    })
  }, [
    screen.id,
    state.loggedIn,
    state.appRoomCount,
    state.appRoomNames,
    state.devices,
    onStateChange,
  ])

  useEffect(() => {
    if (!showRoomInteriorSwitcher || !state.activeRoomId) {
      lastInteriorRoomRef.current = null
      interiorEnteredRef.current = false
      interiorBaselineUnassignedRef.current = new Set()
      setNewDeviceSheetIds(null)
      return
    }

    if (lastInteriorRoomRef.current !== state.activeRoomId) {
      lastInteriorRoomRef.current = state.activeRoomId
      interiorEnteredRef.current = false
      setNewDeviceSheetIds(null)
    }

    const currentIds = getUnassignedLanDeviceIds(state)
    const currentSet = new Set(currentIds)

    if (!interiorEnteredRef.current) {
      interiorBaselineUnassignedRef.current = currentSet
      interiorEnteredRef.current = true
      return
    }

    const newcomers = currentIds.filter(
      (id) => !interiorBaselineUnassignedRef.current.has(id),
    )
    interiorBaselineUnassignedRef.current = currentSet

    if (newcomers.length > 0) {
      setNewDeviceSheetIds((prev) => {
        const merged = [...(prev ?? []), ...newcomers]
        return [...new Set(merged)]
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gated by showRoomInteriorSwitcher + devices
  }, [showRoomInteriorSwitcher, state.activeRoomId, state.devices])

  useEffect(() => {
    setNewDeviceSheetIds((prev) => {
      if (!prev?.length) return prev
      const next = prev.filter((id) =>
        state.devices.some((d) => d.id === id && d.status === 'unassigned'),
      )
      return next.length === prev.length ? prev : next.length ? next : null
    })
  }, [state.devices])

  const visibleActions = screen.actions.filter((a) =>
    isDeviceActionVisible(a.id, state),
  )

  const assignRoomTitle = state.activeRoomId
    ? roomLabelForId(state.activeRoomId)
    : 'this room'

  const assignNewDeviceToActiveRoom = (deviceId: string) => {
    const roomId = state.activeRoomId
    if (!roomId) return
    const occupants = getAssignedDeviceIdsForRoom(state, roomId)
    if (occupants.length === 2) {
      setYeetDialog({
        roomId,
        incomingIds: [deviceId],
        occupantIds: [occupants[0], occupants[1]],
        source: 'new_device_sheet',
      })
      setNewDeviceSheetIds(null)
      return
    }
    onStateChange((prev) => {
      if (!prev) return prev
      const room = prev.activeRoomId
      if (!room) return prev
      return {
        ...prev,
        devices: prev.devices.map((d) =>
          d.id === deviceId
            ? {
                ...d,
                status: 'assigned' as const,
                assignedRoomId: room,
              }
            : d,
        ),
      }
    })
    setNewDeviceSheetIds((prev) => {
      if (!prev) return null
      const next = prev.filter((id) => id !== deviceId)
      return next.length ? next : null
    })
  }

  const dismissNewDeviceSheet = () => setNewDeviceSheetIds(null)

  const completeYeet = (evictDeviceId: string) => {
    if (!yeetDialog) return
    const { roomId, incomingIds, source } = yeetDialog
    onStateChange((prev) =>
      prev ? replaceRoomAssignment(prev, roomId, evictDeviceId, incomingIds) : prev,
    )
    setYeetDialog(null)
    if (source === 'assign_room_sheet') {
      setAssignRoomSheetIds(null)
      setSelectedUnassignedIds([])
    }
    if (source === 'new_device_sheet') {
      setNewDeviceSheetIds((prev) => {
        if (!prev) return null
        const drop = new Set(incomingIds)
        const next = prev.filter((id) => !drop.has(id))
        return next.length ? next : null
      })
    }
    if (source === 'settings_room_list') {
      setSelectedUnassignedIds([])
    }
  }

  const closeYeetDialog = () => setYeetDialog(null)

  useEffect(() => {
    setAssignRoomSheetIds(null)
    setYeetDialog(null)
  }, [screen.id])

  const toggleUnassignedSelect = (id: string) => {
    setSelectedUnassignedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const closeAssignRoomSheet = () => {
    setYeetDialog(null)
    setAssignRoomSheetIds(null)
  }

  const maybeAssignToRoomAndClose = (roomId: string) => {
    const ids = assignRoomSheetIds
    if (!ids?.length) return
    const occupants = getAssignedDeviceIdsForRoom(state, roomId)
    if (occupants.length === 2 && ids.length === 1) {
      setYeetDialog({
        roomId,
        incomingIds: [...ids],
        occupantIds: [occupants[0], occupants[1]],
        source: 'assign_room_sheet',
      })
      setAssignRoomSheetIds(null)
      return
    }
    if (occupants.length >= 2) return
    onStateChange((prev) => {
      if (!prev) return prev
      return assignDevicesToRoom(prev, ids, roomId)
    })
    setAssignRoomSheetIds(null)
    setSelectedUnassignedIds([])
  }

  const applyCreateRoomAndAssign = () => {
    const ids = assignRoomSheetIds
    if (!ids?.length) return
    if (ids.length === 1) {
      window.alert(CREATE_ROOM_NEED_TWO_SELECTED_MSG)
      return
    }
    onStateChange((prev) => {
      if (!prev || !canCreateRoom(prev)) return prev
      const created = applyCreateRoom(prev)
      const newRoomId = `room-${created.appRoomCount}`
      return assignDevicesToRoom(created, ids, newRoomId)
    })
    setAssignRoomSheetIds(null)
    setSelectedUnassignedIds([])
  }

  const runAssignDeviceAction = () => {
    const ids = [...selectedUnassignedIds]
    if (ids.length === 0) return
    if (isRoomDevicePickScreen && ids.length !== 2) {
      window.alert(
        ids.length < 2 ? ASSIGN_PICK_NEED_TWO_MSG : ASSIGN_PICK_ONLY_TWO_MSG,
      )
      return
    }
    if (state.appRoomCount === 0) {
      onStateChange((prev) => {
        if (!prev) return prev
        return assignDevicesToRoom(
          ensureAtLeastOneAppRoom(prev),
          ids,
          'room-1',
        )
      })
      setSelectedUnassignedIds([])
      return
    }
    setAssignRoomSheetIds(ids)
  }

  const assignSheetRoomLabel = (roomId: string) =>
    appRoomItems.find((r) => r.id === roomId)?.label ?? roomId

  const assignSheetPickCount = assignRoomSheetIds?.length ?? 0
  const assignSheetRows =
    appRoomCount > 0
      ? appRoomItems.map((r) => {
          const count = getAssignedDeviceIdsForRoom(state, r.id).length
          const disabled =
            (count >= 2 && assignSheetPickCount !== 1) || count > 2
          const meta =
            count === 0
              ? 'No devices yet'
              : count === 1
                ? '1 device in room'
                : count === 2
                  ? assignSheetPickCount === 1
                    ? 'Full — swap one speaker to add'
                    : 'Full — select one device to add'
                  : `${count} devices in room`
          return {
            id: r.id,
            label: assignSheetRoomLabel(r.id),
            count,
            disabled,
            meta,
          }
        })
      : []

  const assignedInActiveRoom = state.activeRoomId
    ? getAssignedDeviceIdsForRoom(state, state.activeRoomId)
    : []
  const showSingleDeviceRoomWarning =
    showRoomInteriorSwitcher && assignedInActiveRoom.length === 1
  const missingDeviceIds = showSingleDeviceRoomWarning
    ? getOfflineDeviceIds(state)
    : []

  const detectableUnassignedCount = unassignedDevices.length
  const showDevicesFoundPickZeroHint =
    isRoomDevicePickScreen &&
    detectableUnassignedCount === 0 &&
    lanDiscoveryOk
  const phoneScreenTitle =
    screen.id === 'devices_found_pick'
      ? formatDevicesFoundTitle(screen.title, detectableUnassignedCount)
      : isNoRoomsNetworkDevicesScreen
        ? screen.title.trim()
        : screen.title
  const roomSetupNetworkLine =
    screen.id === 'room_setup' && detectableUnassignedCount > 0
      ? formatDevicesFoundTitle(
          '{{count}} on your network',
          detectableUnassignedCount,
        )
      : null

  const onNetworkSpeakersCount = state.devices.filter(
    (d) => d.status !== 'offline',
  ).length
  const settingsRoomsSummary = [
    onNetworkSpeakersCount === 1
      ? '1 device'
      : `${onNetworkSpeakersCount} devices`,
    appRoomCount === 1 ? '1 app room' : `${appRoomCount} app rooms`,
    networkCount === 1
      ? '1 network room'
      : `${networkCount} network rooms`,
  ].join(' · ')

  const settingsRoomSections: AppNetworkRoomSection[] = [
    ...(appRoomCount > 0
      ? [
          {
            heading: 'Your rooms (app)',
            rooms: appRoomItems,
            allowAssignFromUnassigned: true,
          },
        ]
      : []),
    ...(networkCount > 0
      ? [{ heading: 'On the network', rooms: networkRoomItems }]
      : []),
  ]

  const pickRoomFromSettingsList = (roomId: string) => {
    closeSettingsDrawer()
    onStateChange({ ...state, activeRoomId: roomId })
  }

  const handleSettingsRoomPick = (roomId: string) => {
    if (!isValidAppRoomId(state, roomId)) {
      pickRoomFromSettingsList(roomId)
      return
    }
    const ids = [...selectedUnassignedIds]
    if (ids.length === 0) {
      pickRoomFromSettingsList(roomId)
      return
    }
    const occupants = getAssignedDeviceIdsForRoom(state, roomId)
    if (occupants.length >= 2) {
      if (ids.length === 1) {
        setYeetDialog({
          roomId,
          incomingIds: ids,
          occupantIds: [occupants[0], occupants[1]],
          source: 'settings_room_list',
        })
      }
      return
    }
    const space = 2 - occupants.length
    if (ids.length > space) {
      window.alert(
        space === 0
          ? 'This room is full. Select one device to swap, or pick another room.'
          : `This room can only take ${space} more speaker${space === 1 ? '' : 's'}. Deselect extra devices or choose another room.`,
      )
      return
    }
    onStateChange((prev) =>
      prev ? assignDevicesToRoom(prev, ids, roomId) : prev,
    )
    setSelectedUnassignedIds([])
  }

  const activeRoomIsAppRoom = Boolean(
    state.activeRoomId && isValidAppRoomId(state, state.activeRoomId),
  )

  const removeActiveAppRoomFromList = () => {
    const rid = state.activeRoomId
    if (!rid || !isValidAppRoomId(state, rid)) return
    if (state.networkOnlyRoomCount >= 10) {
      window.alert(
        'This simulator supports at most 10 network-only rooms. Remove a LAN-only room in Settings first.',
      )
      return
    }
    setRoomOverflowOpen(false)
    onStateChange((prev) =>
      prev ? promoteAppRoomToNetworkOnly(prev, rid) : prev,
    )
  }

  const deleteActiveRoom = () => {
    const rid = state.activeRoomId
    if (!rid) return
    setRoomOverflowOpen(false)
    onStateChange((prev) => (prev ? deleteRoomById(prev, rid) : prev))
  }

  const roomSetupParas =
    screen.id === 'room_setup' ? roomSetupBodyParagraphs(screen.body) : []

  const barActions =
    screen.id === 'room_setup'
      ? [...visibleActions].sort(
          (a, b) => roomSetupActionRank(a.id) - roomSetupActionRank(b.id),
        )
      : visibleActions

  const scrollToUnassignedDevices = () => {
    document
      .querySelector('.device-frame__devices-on-network')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const renderActionButton = (a: ScreenAction, i: number) => {
    const isCreateRoom = a.id === 'create_room'
    const createBlocked = isCreateRoom && !canCreateRoom(state)
    const createRoomOneSelected =
      isCreateRoom && selectedUnassignedIds.length === 1
    const isAssignDevice = a.id === 'assign_device'
    const assignPickCount = selectedUnassignedIds.length
    const assignBlocked = isAssignDevice && assignPickCount === 0
    const assignPickNeedsExactlyTwo =
      isAssignDevice &&
      isRoomDevicePickScreen &&
      assignPickCount > 0 &&
      assignPickCount !== 2
    const title =
      (createRoomOneSelected ? CREATE_ROOM_NEED_TWO_SELECTED_MSG : null) ??
      (isCreateRoom && createBlocked ? createRoomDisabledReason(state) : null) ??
      (assignPickNeedsExactlyTwo ? assignToRoomPickTitle(assignPickCount) : null) ??
      (assignBlocked ? 'Select one or more devices above first' : null) ??
      a.description ??
      undefined
    const btnClass = [
      'device-frame__action',
      screen.id === 'room_setup' && a.id === 'connect_local_network'
        ? 'device-frame__action--rs-primary'
        : null,
      screen.id === 'room_setup' && a.id === 'skip_room_setup'
        ? 'device-frame__action--rs-secondary'
        : null,
      screen.id === 'room_setup' &&
      (a.id === 'assign_device' || a.id === 'remove_device')
        ? 'device-frame__action--rs-row'
        : null,
      isNoRoomsNetworkDevicesScreen &&
      (a.id === 'assign_device' || a.id === 'remove_device')
        ? 'device-frame__action--rs-row'
        : null,
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <button
        key={`${a.id}-${i}`}
        type="button"
        className={btnClass}
        disabled={Boolean((isCreateRoom && createBlocked) || assignBlocked)}
        title={title}
        onClick={() => {
          if (a.id === 'connect_local_network') {
            scrollToUnassignedDevices()
            return
          }
          if (a.id === 'skip_room_setup') {
            console.info('skip_room_setup')
            return
          }
          if (isCreateRoom) {
            if (createRoomOneSelected) {
              window.alert(CREATE_ROOM_NEED_TWO_SELECTED_MSG)
              return
            }
            if (canCreateRoom(state)) {
              onStateChange(applyCreateRoom(state))
            }
            return
          }
          if (isAssignDevice) {
            if (assignPickCount === 0) return
            if (isRoomDevicePickScreen && assignPickCount !== 2) {
              window.alert(
                assignPickCount < 2
                  ? ASSIGN_PICK_NEED_TWO_MSG
                  : ASSIGN_PICK_ONLY_TWO_MSG,
              )
              return
            }
            runAssignDeviceAction()
            return
          }
          if (a.id === 'back_to_list') {
            onStateChange({ ...state, activeRoomId: null })
            return
          }
          if (a.id === 'see_all_rooms') {
            setSettingsDrawerOpen(true)
            setSettingsDrawerView('networkRooms')
            return
          }
          if (a.id === 'retry') {
            onStateChange({ ...state, wifiConnected: true })
            return
          }
          console.info('action', a.id, a.label)
        }}
      >
        {a.label}
      </button>
    )
  }

  const deviceFrameActionBar =
    visibleActions.length === 0 ? null : screen.id === 'room_setup' ? (
      <div
        className="device-frame__actions device-frame__actions--room-setup"
        role="group"
        aria-label="Actions"
      >
        {barActions
          .filter(
            (a) => a.id === 'connect_local_network' || a.id === 'skip_room_setup',
          )
          .map((a, i) => renderActionButton(a, i))}
        {barActions.some(
          (a) => a.id === 'assign_device' || a.id === 'remove_device',
        ) ? (
          <div className="device-frame__actions-row">
            {barActions
              .filter(
                (a) =>
                  a.id === 'assign_device' || a.id === 'remove_device',
              )
              .map((a, i) => renderActionButton(a, i + 10))}
          </div>
        ) : null}
      </div>
    ) : isNoRoomsNetworkDevicesScreen ? (
      <div
        className="device-frame__actions device-frame__actions--no-rooms-net"
        role="group"
        aria-label="Actions"
      >
        <div className="device-frame__actions-row">
          {barActions
            .filter(
              (a) => a.id === 'assign_device' || a.id === 'remove_device',
            )
            .map((a, i) => renderActionButton(a, i))}
        </div>
      </div>
    ) : (
      <div className="device-frame__actions" role="group" aria-label="Actions">
        {barActions.map((a, i) => renderActionButton(a, i))}
      </div>
    )

  return (
    <div className="device-frame">
      <div className="device-frame__bezel">
        <div className="device-frame__screen">
          <div className="device-frame__island" aria-hidden />
          <div className="device-frame__status-row">
            <span className="device-frame__time">9:41</span>
            <div className="device-frame__status-row-trailing">
              {showRoomOverflowMenu ? (
                <div
                  className="device-frame__room-overflow-wrap"
                  ref={roomOverflowRef}
                >
                  <button
                    type="button"
                    className="device-frame__room-overflow-btn"
                    aria-label="Room options"
                    aria-expanded={roomOverflowOpen}
                    aria-haspopup="menu"
                    onClick={() => setRoomOverflowOpen((o) => !o)}
                  >
                    <EllipsisVerticalIcon />
                  </button>
                  {roomOverflowOpen ? (
                    <div
                      className="device-frame__room-overflow-menu"
                      role="menu"
                    >
                      {activeRoomIsAppRoom ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="device-frame__room-overflow-menu-item"
                          onClick={removeActiveAppRoomFromList}
                        >
                          Remove from list
                        </button>
                      ) : null}
                      <button
                        type="button"
                        role="menuitem"
                        className="device-frame__room-overflow-menu-item"
                        onClick={deleteActiveRoom}
                      >
                        Delete room
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                className="device-frame__settings-gear"
                aria-label="Open settings"
                aria-expanded={settingsDrawerOpen}
                onClick={() => {
                  setSettingsDrawerOpen((wasOpen) => {
                    if (wasOpen) {
                      setSettingsDrawerView('root')
                      return false
                    }
                    setSettingsDrawerView('root')
                    return true
                  })
                }}
              >
                <SettingsGearIcon />
              </button>
              <div className="device-frame__status-icons" aria-hidden>
                <span className="device-frame__cell" />
                <span className="device-frame__battery" />
              </div>
            </div>
          </div>
          <div className="device-frame__content">
            {lanDiscoveryBannerEl}
            {showRoomInteriorSwitcher ? (
              <>
                <div className="device-frame__room-interior">
                <label
                  htmlFor="device-frame-room-switch"
                  className="device-frame__room-switch-label"
                >
                  Room
                </label>
                <select
                  id="device-frame-room-switch"
                  className="device-frame__room-switch"
                  value={state.activeRoomId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '') {
                      skipInteriorAutoRoomRef.current = true
                      setSettingsDrawerOpen(true)
                      setSettingsDrawerView('networkRooms')
                      onStateChange({
                        ...state,
                        activeRoomId: null,
                      })
                      return
                    }
                    onStateChange({
                      ...state,
                      activeRoomId: v,
                    })
                  }}
                >
                  <option value="">All rooms</option>
                  {appRoomCount > 0 && (
                    <optgroup label="In this app">
                      {appRoomItems.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label} ({r.id})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {networkCount > 0 && (
                    <optgroup label="On the network">
                      {networkRoomItems.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label} ({r.id})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {state.activeRoomId ? (
                  <div
                    className="device-frame__room-interior-assigned"
                    aria-label={`Devices in ${roomLabelForId(state.activeRoomId)}`}
                  >
                    <h3 className="device-frame__room-interior-assigned-heading">
                      Devices in this room
                    </h3>
                    <div className="device-frame__room-interior-chip-row">
                      {assignedInActiveRoom.length > 0 ? (
                        assignedInActiveRoom.map((did) => (
                          <code
                            key={did}
                            className="device-frame__app-room-device-chip"
                          >
                            {did}
                          </code>
                        ))
                      ) : (
                        <span className="device-frame__app-room-none">
                          No devices assigned
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}
                {showSingleDeviceRoomWarning &&
                  missingDeviceIds.length > 0 && (
                  <div
                    className="device-frame__room-warning"
                    role="status"
                    aria-live="polite"
                  >
                    {missingDeviceIds.map((id) => (
                      <p key={id} className="device-frame__room-warning-entry">
                        <code className="device-frame__room-warning-code">{id}</code>
                        <span className="device-frame__room-warning-kicker">
                          {' '}(L) is offline. Make sure it’s powered on and connected to the same network as your phone.
                        </span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
              {deviceFrameActionBar}
              </>
            ) : (
              <>
                {screen.id === 'room_setup' ? (
                  <div className="device-frame__room-setup-figma">
                    <RoomSetupFigNav
                      navTitle={
                        screen.navTitle?.trim() || 'Connect your device'
                      }
                    />
                    <h2 className="device-frame__room-setup-headline">
                      {phoneScreenTitle}
                    </h2>
                    {roomSetupParas[0] ? (
                      <p className="device-frame__room-setup-lead">
                        {roomSetupParas[0]}
                      </p>
                    ) : null}
                    <RoomSetupQrIllustration />
                    {roomSetupParas[1] ? (
                      <p className="device-frame__room-setup-lead">
                        {roomSetupParas[1]}
                      </p>
                    ) : null}
                    <RoomSetupEthernetIllustration />
                    <p className="device-frame__room-setup-tail-hint">
                      When speakers appear below, select two, then tap Assign to
                      room.
                    </p>
                  </div>
                ) : isNoRoomsNetworkDevicesScreen ? (
                  <div className="device-frame__no-rooms-net">
                    <p
                      className="device-frame__no-rooms-nav-center"
                      role="status"
                    >
                      {screen.navTitle?.trim() || 'No rooms'}
                    </p>
                    <h2 className="device-frame__no-rooms-headline">
                      {phoneScreenTitle}
                    </h2>
                    <p className="device-frame__no-rooms-lead">
                      {formatNoRoomsDevicesBody(
                        screen.body,
                        unassignedDevices.length,
                      )}
                    </p>
                    <div className="device-frame__no-rooms-panel">
                      <div className="device-frame__no-rooms-device-grid">
                        {unassignedDevices.map((d) => {
                          const selected = selectedUnassignedIds.includes(d.id)
                          return (
                            <button
                              key={d.id}
                              type="button"
                              className={
                                selected
                                  ? 'device-frame__no-rooms-tile device-frame__no-rooms-tile--selected'
                                  : 'device-frame__no-rooms-tile'
                              }
                              aria-pressed={selected}
                              onClick={() => toggleUnassignedSelect(d.id)}
                            >
                              <div
                                className="device-frame__no-rooms-tile-avatar"
                                aria-hidden
                              />
                              <div className="device-frame__no-rooms-tile-copy">
                                <span className="device-frame__no-rooms-tile-brand">
                                  Dutch &amp; Dutch
                                </span>
                                <span className="device-frame__no-rooms-tile-id">
                                  {d.id}
                                </span>
                                <span className="device-frame__no-rooms-tile-status">
                                  Not set up
                                </span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                      <button
                        type="button"
                        className="device-frame__no-rooms-create"
                        disabled={
                          !canCreateRoom(state) ||
                          (selectedUnassignedIds.length === 1 &&
                            unassignedDevices.length >= 2)
                        }
                        title={
                          selectedUnassignedIds.length === 1
                            ? CREATE_ROOM_NEED_TWO_SELECTED_MSG
                            : !canCreateRoom(state)
                              ? createRoomDisabledReason(state) ?? undefined
                              : undefined
                        }
                        onClick={() => {
                          if (
                            selectedUnassignedIds.length === 1 &&
                            unassignedDevices.length >= 2
                          ) {
                            window.alert(CREATE_ROOM_NEED_TWO_SELECTED_MSG)
                            return
                          }
                          if (canCreateRoom(state)) {
                            onStateChange(applyCreateRoom(state))
                          }
                        }}
                      >
                        <PlusInCircleIcon />
                        <span>
                          {visibleActions.find((a) => a.id === 'create_room')
                            ?.label ?? 'Create a new room'}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <h2 className="device-frame__title">{phoneScreenTitle}</h2>
                )}
                {roomSetupNetworkLine ? (
                  <p className="device-frame__room-setup-network-line device-frame__room-setup-network-line--after-figma">
                    {roomSetupNetworkLine}
                  </p>
                ) : null}
                {showDevicesFoundPickZeroHint && !isNoRoomsNetworkDevicesScreen ? (
                  <p className="device-frame__body-hint">
                    {screen.bodyZeroDevices?.trim() ||
                      DEVICES_FOUND_PICK_ZERO_HINT_FALLBACK}
                  </p>
                ) : null}
                {screen.id !== 'room_setup' && !isNoRoomsNetworkDevicesScreen ? (
                  <div className="device-frame__body">{screen.body}</div>
                ) : null}
                {showAppRooms && (
                  <section
                    className="device-frame__app-rooms"
                    aria-label="Rooms in this app"
                  >
                    <h3 className="device-frame__subsection-title">Your rooms</h3>
                    <ul className="device-frame__app-room-list">
                      {appRoomItems.map((r) => {
                        const assignedIds = getAssignedDeviceIdsForRoom(
                          state,
                          r.id,
                        )
                        const hasAssigned = assignedIds.length > 0
                        const isOpen = state.activeRoomId === r.id
                        return (
                          <li key={r.id} className="device-frame__app-room-item-wrap">
                            <button
                              type="button"
                              className={
                                isOpen
                                  ? 'device-frame__app-room-btn device-frame__app-room-btn--open'
                                  : 'device-frame__app-room-btn'
                              }
                              disabled={!hasAssigned}
                              title={
                                hasAssigned
                                  ? isOpen
                                    ? 'Currently open'
                                    : 'Open this room'
                                  : 'Assign at least one device to this room to open it'
                              }
                              onClick={() => {
                                if (hasAssigned) {
                                  onStateChange({ ...state, activeRoomId: r.id })
                                }
                              }}
                            >
                              <div className="device-frame__app-room-btn-main">
                                <span className="device-frame__app-room-label">
                                  {r.label}
                                </span>
                                <code className="device-frame__app-room-id">
                                  {r.id}
                                </code>
                              </div>
                              <div className="device-frame__app-room-devices">
                                {assignedIds.length > 0 ? (
                                  assignedIds.map((did) => (
                                    <code
                                      key={did}
                                      className="device-frame__app-room-device-chip"
                                    >
                                      {did}
                                    </code>
                                  ))
                                ) : (
                                  <span className="device-frame__app-room-none">
                                    No devices assigned
                                  </span>
                                )}
                              </div>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}
                {showUnassignedCards && !isNoRoomsNetworkDevicesScreen && (
                  <section
                    className="device-frame__devices-on-network"
                    aria-label="Unassigned devices on the network"
                  >
                    <h3 className="device-frame__subsection-title">
                      Devices on the network
                    </h3>
                    <p className="device-frame__devices-lead">
                      Detected, not assigned to a room
                    </p>
                    <ul className="device-frame__device-cards">
                      {unassignedDevices.map((d) => {
                        const selected = selectedUnassignedIds.includes(d.id)
                        return (
                          <li key={d.id} className="device-frame__device-card-wrap">
                            <button
                              type="button"
                              className={
                                selected
                                  ? 'device-frame__device-card device-frame__device-card--selectable device-frame__device-card--selected'
                                  : 'device-frame__device-card device-frame__device-card--selectable'
                              }
                              aria-pressed={selected}
                              onClick={() => toggleUnassignedSelect(d.id)}
                            >
                              <div className="device-frame__device-card-id">
                                {d.id}
                              </div>
                              <div className="device-frame__device-card-meta">
                                Unassigned · tap to select
                              </div>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                    {partiallyHiddenUnassignedNoteMain ? (
                      <p className="device-frame__devices-on-network-partial">
                        {partiallyHiddenUnassignedNoteMain}
                      </p>
                    ) : null}
                  </section>
                )}
                {state.loggedIn &&
                unassignedHiddenExplainerMain &&
                !showUnassignedCards ? (
                  <section
                    className="device-frame__devices-on-network device-frame__devices-on-network--explainer-only"
                    aria-label="Unassigned devices on the network"
                  >
                    <h3 className="device-frame__subsection-title">
                      Devices on the network
                    </h3>
                    <p className="device-frame__devices-on-network-explainer">
                      {unassignedHiddenExplainerMain}
                    </p>
                  </section>
                ) : null}
                {showNetworkRooms && (
                  <section
                    className="device-frame__network-rooms"
                    aria-label="Other rooms on the network"
                  >
                    <h3 className="device-frame__subsection-title">
                      Other rooms on the network
                    </h3>
                    <ul className="device-frame__network-list">
                      {networkLabels.map((label, i) => (
                        <li key={i}>{label}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {deviceFrameActionBar}
              </>
            )}
          </div>
          {assignRoomSheetIds && assignRoomSheetIds.length > 0 && (
            <>
              <button
                type="button"
                className="device-frame__sheet-backdrop"
                aria-label="Dismiss"
                onClick={closeAssignRoomSheet}
              />
              <div
                className="device-frame__sheet device-frame__sheet--assign-room"
                role="dialog"
                aria-modal="true"
                aria-labelledby="device-frame-assign-room-sheet-title"
              >
                <div className="device-frame__sheet-grabber" aria-hidden />
                <h3
                  className="device-frame__sheet-title"
                  id="device-frame-assign-room-sheet-title"
                >
                  Assign to room
                </h3>
                <p className="device-frame__sheet-sub">
                  {assignRoomSheetIds.map((id) => (
                    <code key={id} className="device-frame__sheet-device-id">
                      {id}
                    </code>
                  ))}
                </p>
                <ul className="device-frame__sheet-list device-frame__sheet-list--rooms">
                  {assignSheetRows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="device-frame__sheet-room-row"
                        disabled={r.disabled}
                        title={
                          r.disabled
                            ? r.count >= 2
                              ? 'Select exactly one new device to swap into a full room'
                              : undefined
                            : undefined
                        }
                        onClick={() => maybeAssignToRoomAndClose(r.id)}
                      >
                        <span className="device-frame__sheet-room-name">
                          {r.label}
                        </span>
                        <span className="device-frame__sheet-room-meta">
                          {r.meta}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="device-frame__sheet-add-room"
                  disabled={
                    !canCreateRoom(state) ||
                    (assignRoomSheetIds?.length ?? 0) === 1
                  }
                  title={
                    (assignRoomSheetIds?.length ?? 0) === 1
                      ? CREATE_ROOM_NEED_TWO_SELECTED_MSG
                      : canCreateRoom(state)
                        ? undefined
                        : createRoomDisabledReason(state) ?? undefined
                  }
                  onClick={() => applyCreateRoomAndAssign()}
                >
                  + Add new room
                </button>
                <button
                  type="button"
                  className="device-frame__sheet-dismiss"
                  onClick={closeAssignRoomSheet}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          {yeetDialog && (
            <>
              <button
                type="button"
                className="device-frame__sheet-backdrop device-frame__sheet-backdrop--overlay"
                aria-label="Dismiss"
                onClick={closeYeetDialog}
              />
              <div
                className="device-frame__sheet device-frame__sheet--overlay device-frame__sheet--assign-room"
                role="dialog"
                aria-modal="true"
                aria-labelledby="device-frame-remove-from-room-title"
              >
                <div className="device-frame__sheet-grabber" aria-hidden />
                <h3
                  className="device-frame__sheet-title"
                  id="device-frame-remove-from-room-title"
                >
                  This room is full
                </h3>
                <p className="device-frame__sheet-sub device-frame__sheet-sub--remove-prompt">
                  <strong>{roomLabelForId(yeetDialog.roomId)}</strong> already has two
                  devices. Which of the currently assigned devices do you want to
                  remove?
                </p>
                <ul className="device-frame__sheet-list device-frame__sheet-list--rooms">
                  {yeetDialog.occupantIds.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        className="device-frame__sheet-room-row"
                        onClick={() => completeYeet(id)}
                      >
                        <span className="device-frame__sheet-room-name">
                          <code className="device-frame__sheet-device-id">{id}</code>
                        </span>
                        <span className="device-frame__sheet-room-meta">
                          Remove from room
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="device-frame__sheet-dismiss"
                  onClick={closeYeetDialog}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          {showRoomInteriorSwitcher &&
            newDeviceSheetIds &&
            newDeviceSheetIds.length > 0 && (
              <>
                <button
                  type="button"
                  className="device-frame__sheet-backdrop"
                  aria-label="Dismiss"
                  onClick={dismissNewDeviceSheet}
                />
                <div
                  className="device-frame__sheet"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="device-frame-new-device-sheet-title"
                >
                  <div className="device-frame__sheet-grabber" aria-hidden />
                  <h3
                    className="device-frame__sheet-title"
                    id="device-frame-new-device-sheet-title"
                  >
                    New device on the network
                  </h3>
                  <ul className="device-frame__sheet-list">
                    {newDeviceSheetIds.map((id) => (
                      <li key={id} className="device-frame__sheet-item">
                        <code className="device-frame__sheet-device-id">{id}</code>
                        <button
                          type="button"
                          className="device-frame__sheet-primary"
                          onClick={() => assignNewDeviceToActiveRoom(id)}
                        >
                          Assign to {assignRoomTitle}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="device-frame__sheet-dismiss"
                    onClick={dismissNewDeviceSheet}
                  >
                    Not now
                  </button>
                </div>
              </>
            )}
          {settingsDrawerOpen && (
            <div
              className="device-frame__settings-drawer-host"
              role="presentation"
            >
              <button
                type="button"
                className="device-frame__settings-drawer-backdrop"
                aria-label="Close settings"
                onClick={closeSettingsDrawer}
              />
              <div
                className="device-frame__settings-drawer-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="device-frame-settings-drawer-title"
              >
                {settingsDrawerView === 'root' ? (
                  <>
                    <div className="device-frame__settings-drawer-header">
                      <h2
                        className="device-frame__settings-drawer-title"
                        id="device-frame-settings-drawer-title"
                      >
                        Settings
                      </h2>
                      <button
                        type="button"
                        className="device-frame__settings-drawer-icon-btn"
                        aria-label="Close settings"
                        onClick={closeSettingsDrawer}
                      >
                        ×
                      </button>
                    </div>
                    <div className="device-frame__settings-drawer-body">
                      <button
                        type="button"
                        className="device-frame__settings-network-card"
                        onClick={() => setSettingsDrawerView('networkRooms')}
                      >
                        <span className="device-frame__settings-network-card-title">
                          Rooms
                        </span>
                        <span className="device-frame__settings-network-card-meta">
                          {settingsRoomsSummary}
                        </span>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="device-frame__settings-drawer-header">
                      <button
                        type="button"
                        className="device-frame__settings-drawer-back"
                        onClick={() => setSettingsDrawerView('root')}
                      >
                        ‹ Back
                      </button>
                      <button
                        type="button"
                        className="device-frame__settings-drawer-icon-btn"
                        aria-label="Close settings"
                        onClick={closeSettingsDrawer}
                      >
                        ×
                      </button>
                    </div>
                    <h2
                      className="device-frame__settings-drawer-screen-title"
                      id="device-frame-settings-drawer-title"
                    >
                      App &amp; network rooms
                    </h2>
                    <div className="device-frame__settings-drawer-body device-frame__settings-drawer-body--scroll device-frame__settings-drawer-body--rooms-list">
                      <AppNetworkRoomsSectionedList
                        state={state}
                        sections={settingsRoomSections}
                        onPickRoom={handleSettingsRoomPick}
                        selectedUnassignedIds={selectedUnassignedIds}
                        onToggleUnassignedDevice={toggleUnassignedSelect}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {networkPermissionPrompt && (
            <>
              <div className="device-frame__perm-modal-backdrop" aria-hidden />
              <div
                className="device-frame__perm-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="device-frame-network-perm-title"
              >
                <h2
                  className="device-frame__perm-modal-title"
                  id="device-frame-network-perm-title"
                >
                  {networkPermTitle}
                </h2>
                <p className="device-frame__perm-modal-body">{networkPermBody}</p>
                <div className="device-frame__perm-modal-actions">
                  <button
                    type="button"
                    className="device-frame__perm-modal-btn device-frame__perm-modal-btn--secondary"
                    onClick={() =>
                      onStateChange({
                        ...state,
                        permissions: { ...state.permissions, network: 'denied' },
                      })
                    }
                  >
                    Don&apos;t allow
                  </button>
                  <button
                    type="button"
                    className="device-frame__perm-modal-btn device-frame__perm-modal-btn--primary"
                    onClick={() =>
                      onStateChange({
                        ...state,
                        permissions: { ...state.permissions, network: 'granted' },
                      })
                    }
                  >
                    Allow
                  </button>
                </div>
              </div>
            </>
          )}
          <div className="device-frame__home-bar" aria-hidden />
        </div>
      </div>
    </div>
  )
}
