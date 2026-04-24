import { isDeviceReachableOnLan } from './deviceLanReachability'
import type { SimulatorState } from '../types'

export function unassignedDeviceCount(state: SimulatorState): number {
  return state.devices.filter(
    (d) => d.status === 'unassigned' && isDeviceReachableOnLan(state, d),
  ).length
}

/** Show “Assign to room” whenever at least one device is unassigned (picker + sheet handle the rest). */
export function isAssignDeviceActionVisible(state: SimulatorState): boolean {
  return unassignedDeviceCount(state) >= 1
}

/** “Remove device” only applies to devices that are in a room. */
export function isRemoveDeviceActionVisible(state: SimulatorState): boolean {
  return state.devices.some((d) => d.status === 'assigned')
}

export function isDeviceActionVisible(
  actionId: string,
  state: SimulatorState,
): boolean {
  if (actionId === 'assign_device') return isAssignDeviceActionVisible(state)
  if (actionId === 'remove_device') return isRemoveDeviceActionVisible(state)
  return true
}
