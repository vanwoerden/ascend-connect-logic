import {
  Fragment,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { getEffectiveLanTransport } from '../logic/deviceLanReachability'
import type {
  DeviceLanTransport,
  SimulatorDevice,
  SimulatorState,
} from '../types'

function joinEnglish(parts: string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

/** Shown after “{id} is ” so room rows read “… is in Name (room-1).” */
function deviceRoomInClauseLabel(
  state: SimulatorState,
  roomId: string,
): string {
  const m = /^room-(\d+)$/.exec(roomId)
  if (!m) return `in ${roomId}`
  const idx = parseInt(m[1], 10) - 1
  const name = state.appRoomNames[idx]?.trim()
  if (name) return `in ${name} (${roomId})`
  return `in ${roomId}`
}

const UNASSIGNED_VAL = '__unassigned__'
const OFFLINE_VAL = '__offline__'

function selectWidthStyle(label: string, minChars = 8): CSSProperties {
  return {
    width: `${Math.max(minChars, label.length + 1)}ch`,
  }
}

function permissionLabel(
  value: SimulatorState['permissions'][keyof SimulatorState['permissions']],
): string {
  if (value === 'granted') return 'allowed'
  if (value === 'denied') return 'not allowed'
  return 'not set yet'
}

function devicePlacementSelectValue(d: SimulatorDevice): string {
  if (d.status === 'offline') return OFFLINE_VAL
  if (d.status === 'unassigned') return UNASSIGNED_VAL
  return d.assignedRoomId ?? UNASSIGNED_VAL
}

function devicePlacementLabel(
  d: SimulatorDevice,
  roomOpts: { value: string; label: string }[],
): string {
  const value = devicePlacementSelectValue(d)
  if (value === UNASSIGNED_VAL) return 'unassigned'
  if (value === OFFLINE_VAL) return 'offline'
  return roomOpts.find((r) => r.value === value)?.label ?? value
}

function deviceCountSummary(devices: SimulatorDevice[]): string {
  const n = devices.length
  if (n === 0) return ''
  let assigned = 0
  let unassigned = 0
  let offline = 0
  for (const d of devices) {
    if (d.status === 'assigned') assigned += 1
    else if (d.status === 'unassigned') unassigned += 1
    else offline += 1
  }
  const parts: string[] = []
  if (assigned > 0) parts.push(`${assigned} assigned`)
  if (unassigned > 0) parts.push(`${unassigned} unassigned`)
  if (offline > 0) parts.push(`${offline} offline`)
  if (parts.length === 0) return ''
  return `—${joinEnglish(parts)}`
}

export interface FactorSentencesProps {
  simState: SimulatorState
  setSimState: Dispatch<SetStateAction<SimulatorState | null>>
  setPermission: (
    key: keyof SimulatorState['permissions'],
    value: SimulatorState['permissions'][keyof SimulatorState['permissions']],
  ) => void
  setCount: (
    key: 'appRoomCount' | 'networkOnlyRoomCount',
    raw: number,
  ) => void
  setAppRoomName: (index: number, value: string) => void
  setNetworkRoomName: (index: number, value: string) => void
  setDeviceCount: (raw: number) => void
}

export function FactorSentences({
  simState,
  setSimState,
  setPermission,
  setCount,
  setAppRoomName,
  setNetworkRoomName,
  setDeviceCount,
}: FactorSentencesProps) {
  const devices = simState.devices
  const deviceSummary = deviceCountSummary(devices)
  /** Permissions, rooms, devices in the first sentence — only when Wi‑Fi is on. */
  const showLoggedInExtras =
    simState.loggedIn && simState.wifiConnected

  const appRoomOptions =
    simState.appRoomCount > 0
      ? Array.from({ length: simState.appRoomCount }, (_, i) => ({
          value: `room-${i + 1}`,
          label: deviceRoomInClauseLabel(simState, `room-${i + 1}`),
        }))
      : []

  const setDevicePlacement = (index: number, value: string) => {
    setSimState((prev) => {
      if (!prev) return prev
      const next = prev.devices.map((d, i) => {
        if (i !== index) return d
        if (value === UNASSIGNED_VAL) {
          return { ...d, status: 'unassigned' as const, assignedRoomId: undefined }
        }
        if (value === OFFLINE_VAL) {
          return { ...d, status: 'offline' as const, assignedRoomId: undefined }
        }
        return {
          ...d,
          status: 'assigned' as const,
          assignedRoomId: value,
        }
      })
      return { ...prev, devices: next }
    })
  }

  const setDeviceLanTransport = (index: number, value: DeviceLanTransport) => {
    setSimState((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        devices: prev.devices.map((d, i) =>
          i === index ? { ...d, lanTransport: value } : d,
        ),
      }
    })
  }

  return (
    <div className="app__sentences" aria-label="Quick factor controls">
      <p className="app__sentence">
        I am{' '}
        <button
          type="button"
          className="app__token app__token--binary"
          onClick={() =>
            setSimState((prev) =>
              prev ? { ...prev, loggedIn: !prev.loggedIn } : prev,
            )
          }
        >
          {simState.loggedIn ? 'logged in' : 'logged out'}
        </button>
        {simState.loggedIn ? (
          <>
            ,{' '}
            <button
              type="button"
              className="app__token app__token--binary"
              onClick={() =>
                setSimState((prev) =>
                  prev ? { ...prev, wifiConnected: !prev.wifiConnected } : prev,
                )
              }
            >
              {simState.wifiConnected ? 'I have wifi' : "I don't have wifi"}
            </button>
          </>
        ) : null}
        .
      </p>
      {showLoggedInExtras ? (
        <div
          className="app__sentence app__sentence-stack app__sentence-stack--permissions"
          role="group"
          aria-label="Permissions"
        >
          <div className="app__stack-row">
            <span>Network access is</span>
            <select
              className="app__token app__token--select"
              value={simState.permissions.network}
              style={selectWidthStyle(permissionLabel(simState.permissions.network))}
              onChange={(e) =>
                setPermission(
                  'network',
                  e.target.value as SimulatorState['permissions']['network'],
                )
              }
              aria-label="Network permission"
            >
              <option value="granted">allowed</option>
              <option value="denied">not allowed</option>
              <option value="unset">not set yet</option>
            </select>
          </div>
          <div className="app__stack-row">
            <span>Bluetooth is</span>
            <select
              className="app__token app__token--select"
              value={simState.permissions.bluetooth}
              style={selectWidthStyle(permissionLabel(simState.permissions.bluetooth))}
              onChange={(e) =>
                setPermission(
                  'bluetooth',
                  e.target.value as SimulatorState['permissions']['bluetooth'],
                )
              }
              aria-label="Bluetooth permission"
            >
              <option value="granted">allowed</option>
              <option value="denied">not allowed</option>
              <option value="unset">not set yet</option>
            </select>
          </div>
          <div className="app__stack-row">
            <span>Camera access is</span>
            <select
              className="app__token app__token--select"
              value={simState.permissions.camera}
              style={selectWidthStyle(permissionLabel(simState.permissions.camera))}
              onChange={(e) =>
                setPermission(
                  'camera',
                  e.target.value as SimulatorState['permissions']['camera'],
                )
              }
              aria-label="Camera permission"
            >
              <option value="granted">allowed</option>
              <option value="denied">not allowed</option>
              <option value="unset">not set yet</option>
            </select>
            {'.'}
          </div>
        </div>
      ) : null}
      {showLoggedInExtras ? (
        <>
          <div
            className="app__sentence app__sentence-stack app__sentence-stack--counts"
            role="group"
            aria-label="Rooms and devices"
          >
            <span className="app__counts-lead">I have</span>
            <input
              type="number"
              className="app__token app__token--num app__token--num--stack"
              min={0}
              max={10}
              aria-label="Rooms in app"
              value={simState.appRoomCount}
              onChange={(e) =>
                setCount('appRoomCount', Number(e.target.value))
              }
            />
            <span>
              app room{simState.appRoomCount === 1 ? '' : 's'}
            </span>
            <span className="app__counts-lead-spacer" aria-hidden="true" />
            <input
              type="number"
              className="app__token app__token--num app__token--num--stack"
              min={0}
              max={10}
              aria-label="Network-only rooms"
              value={simState.networkOnlyRoomCount}
              onChange={(e) =>
                setCount('networkOnlyRoomCount', Number(e.target.value))
              }
            />
            <span>
              network only room{simState.networkOnlyRoomCount === 1 ? '' : 's'}
            </span>
            <span className="app__counts-lead-spacer" aria-hidden="true" />
            <input
              type="number"
              className="app__token app__token--num app__token--num--stack"
              min={0}
              max={10}
              aria-label="Device count"
              value={simState.devices.length}
              onChange={(e) => setDeviceCount(Number(e.target.value))}
            />
            <span>
              device{simState.devices.length === 1 ? '' : 's'}
              {deviceSummary}.
            </span>
            {devices.map((d, index) => {
              const roomOpts =
                d.status === 'assigned' &&
                d.assignedRoomId &&
                !appRoomOptions.some((o) => o.value === d.assignedRoomId)
                  ? [
                      ...appRoomOptions,
                      {
                        value: d.assignedRoomId,
                        label: deviceRoomInClauseLabel(
                          simState,
                          d.assignedRoomId,
                        ),
                      },
                    ]
                  : appRoomOptions

              return (
                <Fragment key={d.id}>
                  <span
                    className="app__counts-lead-spacer app__counts-lead-spacer--device"
                    aria-hidden="true"
                  />
                  <span
                    className="app__counts-input-spacer"
                    aria-hidden="true"
                  />
                  <div className="app__device-row">
                    <span className="app__device-id">{d.id}</span>
                    {' is '}
                    <select
                      className="app__token app__token--select app__token--select--device-room"
                      value={devicePlacementSelectValue(d)}
                      style={selectWidthStyle(devicePlacementLabel(d, roomOpts), 10)}
                      onChange={(e) =>
                        setDevicePlacement(index, e.target.value)
                      }
                      aria-label={`${d.id} room or status`}
                    >
                      <option value={UNASSIGNED_VAL}>unassigned</option>
                      <option value={OFFLINE_VAL}>offline</option>
                      {roomOpts.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    {'. connected via '}
                    <select
                      className="app__token app__token--select app__token--select--device-lan"
                      value={getEffectiveLanTransport(d)}
                      style={selectWidthStyle(
                        getEffectiveLanTransport(d) === 'wifi'
                          ? 'Wi‑Fi'
                          : 'Ethernet',
                        8,
                      )}
                      onChange={(e) =>
                        setDeviceLanTransport(
                          index,
                          e.target.value as DeviceLanTransport,
                        )
                      }
                      aria-label={`${d.id} LAN path (Wi‑Fi or Ethernet)`}
                    >
                      <option value="wifi">Wi‑Fi</option>
                      <option value="ethernet">Ethernet</option>
                    </select>
                    {'.'}
                  </div>
                </Fragment>
              )
            })}
          </div>
          {(simState.appRoomCount > 0 || simState.networkOnlyRoomCount > 0) && (
            <div
              className="app__sentence app__sentence-stack app__sentence-stack--room-labels"
              role="group"
              aria-label="Room labels"
            >
              {simState.appRoomCount > 0 && (
                <div className="app__room-label-block">
                  <span className="app__room-label-heading">App room labels:</span>
                  <div className="app__room-label-inputs">
                    {simState.appRoomNames.map((name, i) => (
                      <input
                        key={`app-name-${i}`}
                        type="text"
                        className="app__token app__token--text"
                        aria-label={`App room ${i + 1} label (room-${i + 1})`}
                        value={name}
                        onChange={(e) => setAppRoomName(i, e.target.value)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {simState.networkOnlyRoomCount > 0 && (
                <div className="app__room-label-block">
                  <span className="app__room-label-heading">
                    Network-only labels:
                  </span>
                  <div className="app__room-label-inputs">
                    {simState.networkRoomNames.map((name, i) => (
                      <input
                        key={`net-name-${i}`}
                        type="text"
                        className="app__token app__token--text"
                        aria-label={`Network-only room ${i + 1} label (lan-${i + 1})`}
                        value={name}
                        onChange={(e) => setNetworkRoomName(i, e.target.value)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
