import {
  allAppRoomsExistButAllEmpty,
  ROOM_OPEN_MATCH_ID,
  shouldOpenRoomDetail,
} from '../logic/roomNavigation'
import type { ResolutionResult, Rule, Screen, SimulatorState } from '../types'
import { resolveScreen } from './resolveScreen'

/**
 * Room list navigation overrides JSON rule order when a room with devices is open.
 * Only while Wi‑Fi is on — otherwise rules (e.g. `no_wifi`) control the screen.
 */
/** Defer this rule while `network` is unset so the next match drives the screen (modal on top). */
const NETWORK_UNSET_RULE_ID = 'network_unset'

/** Prefer room shell over `devices_need_attention` when app rooms exist but are all empty. */
export const ROOM_EMPTY_APP_UNASSIGNED_MATCH_ID = '__empty_app_rooms_unassigned__'

const DEVICES_UNASSIGNED_RULE_ID = 'devices_unassigned'

export function resolveScreenWithRoomNavigation(
  state: SimulatorState,
  rules: Rule[],
  screensById: Map<string, Screen>,
  fallbackScreenId: string,
): ResolutionResult {
  const networkPermissionPrompt =
    state.loggedIn && state.permissions.network === 'unset'

  if (shouldOpenRoomDetail(state)) {
    const interior = screensById.get('room_interior')
    if (interior) {
      return {
        screen: interior,
        matchedRuleId: ROOM_OPEN_MATCH_ID,
        fallbackUsed: false,
        networkPermissionPrompt,
      }
    }
  }

  const rulesForDisplay = networkPermissionPrompt
    ? rules.filter((r) => r.id !== NETWORK_UNSET_RULE_ID)
    : rules
  const resolved = resolveScreen(
    state,
    rulesForDisplay,
    screensById,
    fallbackScreenId,
  )
  if (
    resolved.matchedRuleId === DEVICES_UNASSIGNED_RULE_ID &&
    allAppRoomsExistButAllEmpty(state)
  ) {
    const interior = screensById.get('room_interior')
    if (interior) {
      return {
        screen: interior,
        matchedRuleId: ROOM_EMPTY_APP_UNASSIGNED_MATCH_ID,
        fallbackUsed: false,
        networkPermissionPrompt,
      }
    }
  }
  return { ...resolved, networkPermissionPrompt }
}
