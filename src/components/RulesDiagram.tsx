import { collectMatchPaths, flattenMatch } from '../diagram/formatRuleMatch'
import { ROOM_OPEN_MATCH_ID } from '../logic/roomNavigation'
import type { Rule, Screen } from '../types'

interface RulesDiagramProps {
  rules: Rule[]
  fallbackScreenId: string
  screensById: Map<string, Screen>
  matchedRuleId: string | null
  fallbackUsed: boolean
  activeRoomId: string | null
  networkPermissionPrompt?: boolean
}

export function RulesDiagram({
  rules,
  fallbackScreenId,
  screensById,
  matchedRuleId,
  fallbackUsed,
  activeRoomId,
  networkPermissionPrompt = false,
}: RulesDiagramProps) {
  const factorPaths = collectMatchPaths(rules)
  const fallbackTitle =
    screensById.get(fallbackScreenId)?.title ?? fallbackScreenId

  return (
    <div className="rules-diagram">
      <div className="rules-diagram__header">
        <h2 className="rules-diagram__title">Routing from rules.json</h2>
        <p className="rules-diagram__lead">
          Rules are tested <strong>in order</strong>. The first rule whose{' '}
          <code>match</code> object is fully satisfied by the simulator state wins.
          If none match, the fallback screen is shown.
        </p>
        {matchedRuleId === ROOM_OPEN_MATCH_ID && (
          <p className="rules-diagram__nav-callout" role="status">
            Right now the <strong>phone view</strong> shows <strong>room detail</strong>{' '}
            because you opened{' '}
            {activeRoomId ? <code>{activeRoomId}</code> : 'a room'} from the device
            list. That overrides the ordered rules until you use Back to all rooms
            (and only while Wi‑Fi is on).
          </p>
        )}
        {networkPermissionPrompt && (
          <p className="rules-diagram__nav-callout" role="status">
            <strong>Network permission</strong> is <code>unset</code>: the phone skips the{' '}
            <code>network_unset</code> rule, uses the next matching rule for the screen,
            and shows an <strong>allow/deny modal</strong> on top until you choose.
          </p>
        )}
      </div>

      <section className="rules-diagram__factors" aria-labelledby="factors-heading">
        <h3 id="factors-heading" className="rules-diagram__section-title">
          State paths referenced in matches
        </h3>
        <p className="rules-diagram__factors-hint">
          These correspond to toggles in the factors panel and fields in{' '}
          <code>SimulatorState</code>.
        </p>
        <ul className="rules-diagram__chip-list">
          {factorPaths.map((path) => (
            <li key={path} className="rules-diagram__chip">
              <code>{path}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="rules-diagram__flow" aria-label="Ordered rules">
        <h3 className="rules-diagram__section-title">Decision flow</h3>
        <ol className="rules-diagram__steps">
          <li className="rules-diagram__start">
            <span className="rules-diagram__start-label">Start</span>
            <span className="rules-diagram__start-meta">Evaluate state</span>
          </li>

          {rules.map((rule, idx) => {
            const rows = flattenMatch(rule.match)
            const screenTitle =
              screensById.get(rule.screenId)?.title ?? rule.screenId
            const navigationLocks = matchedRuleId === ROOM_OPEN_MATCH_ID
            const isWinner =
              !navigationLocks && matchedRuleId === rule.id

            return (
              <li key={rule.id} className="rules-diagram__step-wrap">
                <div className="rules-diagram__connector" aria-hidden>
                  <span className="rules-diagram__connector-label">
                    {idx === 0
                      ? 'First candidate'
                      : 'No prior match · try next'}
                  </span>
                </div>
                <div
                  className={
                    isWinner
                      ? 'rules-diagram__step rules-diagram__step--current'
                      : 'rules-diagram__step'
                  }
                >
                  <div className="rules-diagram__step-head">
                    <span className="rules-diagram__step-num">{idx + 1}</span>
                    <span className="rules-diagram__step-id">{rule.id}</span>
                    {isWinner && (
                      <span className="rules-diagram__step-badge">current</span>
                    )}
                  </div>
                  <div className="rules-diagram__match">
                    <div className="rules-diagram__match-title">Match</div>
                    <ul className="rules-diagram__match-rows">
                      {rows.map((row) => (
                        <li key={row.path} className="rules-diagram__match-row">
                          <code className="rules-diagram__match-path">
                            {row.path}
                          </code>
                          <span className="rules-diagram__match-eq">=</span>
                          <span className="rules-diagram__match-val">
                            {row.value}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rules-diagram__arrow" aria-hidden>
                    <span className="rules-diagram__arrow-shaft" />
                    <span className="rules-diagram__arrow-head">→</span>
                  </div>
                  <div className="rules-diagram__screen">
                    <div className="rules-diagram__screen-label">Screen</div>
                    <div className="rules-diagram__screen-id">{rule.screenId}</div>
                    <div className="rules-diagram__screen-title">{screenTitle}</div>
                  </div>
                  {rule.notes && (
                    <p className="rules-diagram__notes">{rule.notes}</p>
                  )}
                </div>
              </li>
            )
          })}

          <li className="rules-diagram__step-wrap">
            <div className="rules-diagram__connector" aria-hidden>
              <span className="rules-diagram__connector-label">
                no rule matched
              </span>
            </div>
            <div
              className={
                fallbackUsed
                  ? 'rules-diagram__fallback rules-diagram__fallback--current'
                  : 'rules-diagram__fallback'
              }
            >
              <div className="rules-diagram__step-head">
                <span className="rules-diagram__step-num">—</span>
                <span className="rules-diagram__step-id">fallback</span>
                {fallbackUsed && (
                  <span className="rules-diagram__step-badge">current</span>
                )}
              </div>
              <p className="rules-diagram__fallback-body">
                Show screen <code>{fallbackScreenId}</code>
                {fallbackTitle !== fallbackScreenId && (
                  <>
                    {' '}
                    <span className="rules-diagram__fallback-meta">
                      ({fallbackTitle})
                    </span>
                  </>
                )}
              </p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  )
}
