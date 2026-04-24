import { partialDeepMatch } from './match'
import type { ResolutionResult, Rule, Screen, SimulatorState } from '../types'

export function resolveScreen(
  state: SimulatorState,
  rules: Rule[],
  screensById: Map<string, Screen>,
  fallbackScreenId: string,
): ResolutionResult {
  const stateObj = state as unknown as Record<string, unknown>
  for (const rule of rules) {
    if (!partialDeepMatch(stateObj, rule.match)) continue
    const screen = screensById.get(rule.screenId)
    if (screen) {
      return {
        screen,
        matchedRuleId: rule.id,
        fallbackUsed: false,
      }
    }
  }
  const fallback = screensById.get(fallbackScreenId)
  if (fallback) {
    return {
      screen: fallback,
      matchedRuleId: null,
      fallbackUsed: true,
    }
  }
  const first = screensById.values().next().value as Screen | undefined
  if (first) {
    return {
      screen: first,
      matchedRuleId: null,
      fallbackUsed: true,
    }
  }
  return {
    screen: {
      id: 'empty',
      title: 'No screens',
      body: 'Load screens.json',
      actions: [],
    },
    matchedRuleId: null,
    fallbackUsed: true,
  }
}
