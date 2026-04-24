import { Fragment } from 'react'
import { deviceIdFromIndex } from '../logic/deviceId'
import { getAssignedDeviceIdsForRoom } from '../logic/roomNavigation'
import type {
  DeviceLanTransport,
  DeviceStatus,
  PermissionValue,
  SimulatorDevice,
  SimulatorState,
} from '../types'

const PERMISSIONS: (keyof SimulatorState['permissions'])[] = [
  'network',
  'bluetooth',
  'camera',
]
const PERMISSION_LABELS: Record<keyof SimulatorState['permissions'], string> = {
  bluetooth: 'Bluetooth',
  camera: 'Camera',
  network: 'Network',
}
const PERMISSION_VALUES: PermissionValue[] = ['unset', 'granted', 'denied']
const DEVICE_STATUSES: DeviceStatus[] = ['offline', 'unassigned', 'assigned']

interface SimulatorPanelProps {
  state: SimulatorState
  onChange: (next: SimulatorState) => void
}

function clampDeviceCount(n: number) {
  return Math.max(0, Math.min(10, Math.floor(n)))
}

function makeDevice(index: number): SimulatorDevice {
  return {
    id: deviceIdFromIndex(index),
    status: 'unassigned',
    lanTransport: 'wifi',
  }
}

export function SimulatorPanel({ state, onChange }: SimulatorPanelProps) {
  const roomOptions =
    state.appRoomCount > 0
      ? Array.from({ length: state.appRoomCount }, (_, i) => ({
          value: `room-${i + 1}`,
          label:
            state.appRoomNames[i] ??
            `Room ${i + 1} (${`room-${i + 1}`})`,
        }))
      : []

  const setPermission = (
    key: keyof SimulatorState['permissions'],
    value: PermissionValue,
  ) => {
    onChange({
      ...state,
      permissions: { ...state.permissions, [key]: value },
    })
  }

  const setDeviceCount = (count: number) => {
    const n = clampDeviceCount(count)
    const nextDevices = [...state.devices]
    while (nextDevices.length < n) {
      nextDevices.push(makeDevice(nextDevices.length))
    }
    nextDevices.length = n
    onChange({ ...state, devices: nextDevices })
  }

  const updateDevice = (index: number, patch: Partial<SimulatorDevice>) => {
    const devices = state.devices.map((d, i) =>
      i === index ? { ...d, ...patch } : d,
    )
    if (patch.status && patch.status !== 'assigned') {
      devices[index] = { ...devices[index], assignedRoomId: undefined }
    }
    onChange({ ...state, devices })
  }

  const setAppRoomCount = (n: number) => {
    const c = clampDeviceCount(n)
    const names = [...state.appRoomNames]
    while (names.length < c) names.push(`Room ${names.length + 1}`)
    names.length = c
    onChange({
      ...state,
      appRoomCount: c,
      appRoomNames: names,
      devices: state.devices.map((d) => {
        if (d.status !== 'assigned' || !d.assignedRoomId) return d
        const num = parseInt(d.assignedRoomId.replace(/^room-/, ''), 10)
        if (!Number.isFinite(num) || num > c || num < 1) {
          return { ...d, status: 'unassigned' as const, assignedRoomId: undefined }
        }
        return d
      }),
    })
  }

  return (
    <div className="sim-panel">
      <h2 className="sim-panel__heading">Factors</h2>

      <fieldset className="sim-panel__fieldset">
        <legend>Logged in</legend>
        <label className="sim-panel__check">
          <input
            type="checkbox"
            checked={state.loggedIn}
            onChange={(e) =>
              onChange({ ...state, loggedIn: e.target.checked })
            }
          />
          loggedIn
        </label>
      </fieldset>

      {state.wifiConnected ? (
      <fieldset className="sim-panel__fieldset">
        <legend>Permissions</legend>
        {PERMISSIONS.map((key) => (
          <div key={key} className="sim-panel__perm">
            <span className="sim-panel__perm-label">{PERMISSION_LABELS[key]}</span>
            <div className="sim-panel__tri">
              {PERMISSION_VALUES.map((v) => (
                <label key={v} className="sim-panel__radio">
                  <input
                    type="radio"
                    name={`perm-${key}`}
                    checked={state.permissions[key] === v}
                    onChange={() => setPermission(key, v)}
                  />
                  {v}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
      ) : null}

      <fieldset className="sim-panel__fieldset">
        <legend>Connectivity</legend>
        <label className="sim-panel__check">
          <input
            type="checkbox"
            checked={state.wifiConnected}
            onChange={(e) =>
              onChange({ ...state, wifiConnected: e.target.checked })
            }
          />
          Wi‑Fi connected
        </label>
      </fieldset>

      {state.loggedIn && state.wifiConnected ? (
        <>
      <fieldset className="sim-panel__fieldset">
        <legend>Rooms</legend>
        <label className="sim-panel__num">
          Rooms in app (0–10)
          <input
            type="number"
            min={0}
            max={10}
            value={state.appRoomCount}
            onChange={(e) => setAppRoomCount(Number(e.target.value))}
          />
        </label>
        <label className="sim-panel__num">
          Network-only rooms (not in app list)
          <input
            type="number"
            min={0}
            max={10}
            value={state.networkOnlyRoomCount}
            onChange={(e) => {
              const c = clampDeviceCount(Number(e.target.value))
              const names = [...state.networkRoomNames]
              while (names.length < c) {
                names.push(`LAN room ${names.length + 1}`)
              }
              names.length = c
              onChange({
                ...state,
                networkOnlyRoomCount: c,
                networkRoomNames: names,
              })
            }}
          />
        </label>
        {state.networkOnlyRoomCount > 0 && (
          <div className="sim-panel__names">
            <div className="sim-panel__names-label">
              Network-only room labels (shown in mock screen)
            </div>
            {state.networkRoomNames.map((name, i) => (
              <label key={i} className="sim-panel__text">
                {`lan-${i + 1}`}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    const networkRoomNames = [...state.networkRoomNames]
                    networkRoomNames[i] = e.target.value
                    onChange({ ...state, networkRoomNames })
                  }}
                />
              </label>
            ))}
          </div>
        )}
        {state.appRoomCount > 0 && (
          <div className="sim-panel__names">
            <div className="sim-panel__names-label">App room labels (optional)</div>
            {state.appRoomNames.map((name, i) => (
              <label key={i} className="sim-panel__text">
                {`room-${i + 1}`}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    const appRoomNames = [...state.appRoomNames]
                    appRoomNames[i] = e.target.value
                    onChange({ ...state, appRoomNames })
                  }}
                />
              </label>
            ))}
          </div>
        )}
        <p className="sim-panel__hint">
          “No / one / many” for the user is driven by <code>appRoomCount</code> in
          rules.
        </p>
        {state.activeRoomId && (
          <p className="sim-panel__hint">
            Opened on device: <code>{state.activeRoomId}</code>
            {(() => {
              const inRoom = getAssignedDeviceIdsForRoom(
                state,
                state.activeRoomId,
              )
              return inRoom.length > 0 ? (
                <>
                  {' '}
                  — assigned:{' '}
                  {inRoom.map((id, i) => (
                    <Fragment key={id}>
                      {i > 0 ? ', ' : null}
                      <code>{id}</code>
                    </Fragment>
                  ))}
                </>
              ) : (
                <> — no devices assigned to this room</>
              )
            })()}
            . Use Back to all rooms in the preview to clear.
          </p>
        )}
      </fieldset>

      <fieldset className="sim-panel__fieldset">
        <legend>Devices (max 10)</legend>
        <label className="sim-panel__num">
          Count
          <input
            type="number"
            min={0}
            max={10}
            value={state.devices.length}
            onChange={(e) => setDeviceCount(Number(e.target.value))}
          />
        </label>
        <ul className="sim-panel__devices">
          {state.devices.map((d, i) => (
            <li key={d.id} className="sim-panel__device-row">
              <span className="sim-panel__device-id">{d.id}</span>
              <select
                value={d.status}
                onChange={(e) =>
                  updateDevice(i, { status: e.target.value as DeviceStatus })
                }
                aria-label={`${d.id} status`}
              >
                {DEVICE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {d.status === 'assigned' && (
                <select
                  value={d.assignedRoomId ?? ''}
                  onChange={(e) =>
                    updateDevice(i, { assignedRoomId: e.target.value || undefined })
                  }
                  aria-label={`${d.id} room`}
                  disabled={roomOptions.length === 0}
                >
                  <option value="">Pick room…</option>
                  {roomOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
              <span className="sim-panel__lan-label">LAN</span>
              <select
                value={d.lanTransport === 'ethernet' ? 'ethernet' : 'wifi'}
                onChange={(e) =>
                  updateDevice(i, {
                    lanTransport: e.target.value as DeviceLanTransport,
                  })
                }
                aria-label={`${d.id} LAN path (Wi‑Fi or Ethernet)`}
              >
                <option value="wifi">Wi‑Fi</option>
                <option value="ethernet">Ethernet (speaker)</option>
              </select>
            </li>
          ))}
        </ul>
      </fieldset>
        </>
      ) : state.loggedIn && !state.wifiConnected ? (
        <p className="sim-panel__hint">
          Wi‑Fi is off: other factors stay hidden. Turn on <strong>Wi‑Fi connected</strong>{' '}
          above, or use <strong>Retry</strong> on the No Wi‑Fi screen in the preview.
        </p>
      ) : !state.loggedIn && !state.wifiConnected ? (
        <p className="sim-panel__hint">
          Turn on <strong>Wi‑Fi connected</strong> above to simulate a connection before
          signing in.
        </p>
      ) : (
        <p className="sim-panel__hint">
          Enable <strong>loggedIn</strong> to configure rooms and devices. They stay
          hidden on the phone preview until you are signed in.
        </p>
      )}
    </div>
  )
}
