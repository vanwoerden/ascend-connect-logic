import { useState } from 'react'
import { partialDeepMatch } from '../engine/match'
import { ROOM_OPEN_MATCH_ID } from '../logic/roomNavigation'
import type { Rule, SimulatorState } from '../types'

export interface RuleMatchSummaryProps {
  state: SimulatorState
  matchedRuleId: string | null
  fallbackUsed: boolean
  networkPermissionPrompt?: boolean
  /** When set, appends the resolved screen id from the phone preview. */
  resolvedScreenId?: string
  /** When true, note that the side debug panel’s list still reflects full rule evaluation. */
  mentionDebugRuleList?: boolean
}

export function RuleMatchSummary({
  state,
  matchedRuleId,
  fallbackUsed,
  networkPermissionPrompt = false,
  resolvedScreenId,
  mentionDebugRuleList = false,
}: RuleMatchSummaryProps) {
  return (
    <p
      className={
        resolvedScreenId
          ? 'rule-debug__summary rule-debug__summary--under-stage'
          : 'rule-debug__summary'
      }
    >
      {networkPermissionPrompt && (
        <>
          <strong>Network permission</strong> is <code>unset</code>: rule{' '}
          <code>network_unset</code> is skipped for the phone resolution and an
          allow/deny modal is shown on the next matching screen.
          {mentionDebugRuleList ? (
            <>
              {' '}
              The list in the debug panel still evaluates every rule against the real
              state.
            </>
          ) : null}
          <br />
          <br />
        </>
      )}
      {matchedRuleId === ROOM_OPEN_MATCH_ID && (
        <>
          {state.activeRoomId && (
            <>
              {' '}
              Active: <code>{state.activeRoomId}</code>.
            </>
          )}
        </>
      )}
      {matchedRuleId !== ROOM_OPEN_MATCH_ID && fallbackUsed && (
        <>
          No rule matched — showing fallback.
          {matchedRuleId === null ? '' : ` (unexpected: ${matchedRuleId})`}
        </>
      )}
      {matchedRuleId !== ROOM_OPEN_MATCH_ID && !fallbackUsed && matchedRuleId && (
        <>
          First match: <strong>{matchedRuleId}</strong>
        </>
      )}
      {resolvedScreenId && (
        <>
          {' '}
          <span className="rule-debug__summary-screen">
            → screen <code>{resolvedScreenId}</code>
          </span>
        </>
      )}
    </p>
  )
}

interface RuleDebugProps {
  state: SimulatorState
  rules: Rule[]
  matchedRuleId: string | null
  fallbackUsed: boolean
  networkPermissionPrompt?: boolean
  /** Merge a rule’s `match` into the simulator (factor sentences + phone). */
  onApplyRuleMatch: (rule: Rule) => void
}

export function RuleDebug({
  state,
  rules,
  matchedRuleId,
  fallbackUsed,
  networkPermissionPrompt = false,
  onApplyRuleMatch,
}: RuleDebugProps) {
  const [open, setOpen] = useState(true)
  const stateObj = state as unknown as Record<string, unknown>

  return (
    <div className="rule-debug">
      <button
        type="button"
        className="rule-debug__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Match debug {open ? '▼' : '▶'}
      </button>
      {open && (
        <div className="rule-debug__panel">
          <RuleMatchSummary
            state={state}
            matchedRuleId={matchedRuleId}
            fallbackUsed={fallbackUsed}
            networkPermissionPrompt={networkPermissionPrompt}
            mentionDebugRuleList
          />
          <p className="rule-debug__jump-hint">
            Click a rule id or screen id to apply that rule’s match to the simulator
            (factor sentences and phone update).
          </p>
          <ol className="rule-debug__list">
            {rules.map((rule) => {
              const matches = partialDeepMatch(stateObj, rule.match)
              const navigationActive = matchedRuleId === ROOM_OPEN_MATCH_ID
              const isWinner =
                !navigationActive &&
                Boolean(matchedRuleId && rule.id === matchedRuleId)
              const shadowMatch = matches && !isWinner
              return (
                <li
                  key={rule.id}
                  className={
                    isWinner
                      ? 'rule-debug__item rule-debug__item--winner'
                      : shadowMatch
                        ? 'rule-debug__item rule-debug__item--shadow'
                        : 'rule-debug__item'
                  }
                >
                  <button
                    type="button"
                    className="rule-debug__id-btn"
                    title="Apply this rule’s match to the simulator"
                    onClick={() => onApplyRuleMatch(rule)}
                  >
                    {rule.id}
                  </button>
                  <span className="rule-debug__arrow">→</span>
                  <button
                    type="button"
                    className="rule-debug__screen-btn"
                    title={`Apply match and go to screen ${rule.screenId}`}
                    onClick={() => onApplyRuleMatch(rule)}
                  >
                    {rule.screenId}
                  </button>
                  {isWinner ? (
                    <span className="rule-debug__badge rule-debug__badge--winner">winner</span>
                  ) : matches ? (
                    <span className="rule-debug__badge">matches</span>
                  ) : (
                    <span className="rule-debug__badge rule-debug__badge--no">no</span>
                  )}
                  {rule.notes && (
                    <div className="rule-debug__notes">{rule.notes}</div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
