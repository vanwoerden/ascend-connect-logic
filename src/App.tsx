import { useEffect, useMemo, useState } from 'react'
import { DeviceFrame } from './components/DeviceFrame'
import { FactorSentences } from './components/FactorSentences'
import { RulesDiagram } from './components/RulesDiagram'
import { RuleDebug, RuleMatchSummary } from './components/RuleDebug'
import type { ExplorerView } from './components/ViewModeToggle'
import { ViewModeToggle } from './components/ViewModeToggle'
import { applyRuleMatchToState } from './engine/applyRuleMatch'
import { resolveScreenWithRoomNavigation } from './engine/resolveWithRoomNavigation'
import { deviceIdFromIndex } from './logic/deviceId'
import { shouldOpenRoomDetail } from './logic/roomNavigation'
import { mergeFactorDefaults } from './state/initialState'
import {
  loadSimulatorFromStorage,
  saveSimulatorState,
} from './state/simulatorStorage'
import type { FactorsConfig, Rule, Screen, SimulatorState } from './types'
import './App.css'

function parseUseCasesFromMd(md: string): string[] {
  const out: string[] = []
  const re = /^\s*-\s+(.+)\s*$/
  for (const line of md.split(/\r?\n/)) {
    const m = re.exec(line)
    if (m) out.push(m[1].trim())
  }
  return out
}

export default function App() {
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [screens, setScreens] = useState<Screen[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [fallbackScreenId, setFallbackScreenId] = useState('unknown')
  const [simState, setSimState] = useState<SimulatorState | null>(null)
  const [viewMode, setViewMode] = useState<ExplorerView>('simulator')
  const [useCases, setUseCases] = useState<string[]>([])
  const [selectedUseCase, setSelectedUseCase] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [fRes, sRes, rRes, uRes] = await Promise.all([
          fetch('/config/factors.json'),
          fetch('/config/screens.json'),
          fetch('/config/rules.json'),
          fetch('/use_cases.md'),
        ])
        if (!fRes.ok || !sRes.ok || !rRes.ok) {
          throw new Error('Failed to load config JSON')
        }
        const factors = (await fRes.json()) as FactorsConfig
        const screensJson = (await sRes.json()) as { screens: Screen[] }
        const rulesJson = (await rRes.json()) as {
          rules: Rule[]
          fallbackScreenId?: string
        }
        let parsedUseCases: string[] = []
        if (uRes.ok) {
          parsedUseCases = parseUseCasesFromMd(await uRes.text())
        } else {
          console.warn('Failed to load /use_cases.md')
        }
        if (cancelled) return
        setUseCases(parsedUseCases)
        setScreens(screensJson.screens)
        setRules(rulesJson.rules)
        setFallbackScreenId(rulesJson.fallbackScreenId ?? 'unknown')
        const defaults = mergeFactorDefaults(factors)
        setSimState(loadSimulatorFromStorage(defaults))
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!simState) return
    saveSimulatorState(simState)
  }, [simState])

  useEffect(() => {
    if (!simState?.activeRoomId) return
    if (!shouldOpenRoomDetail(simState)) {
      setSimState((s) => (s?.activeRoomId ? { ...s, activeRoomId: null } : s))
    }
  }, [simState])

  const screensById = useMemo(
    () => new Map(screens.map((s) => [s.id, s])),
    [screens],
  )

  const resolution = useMemo(() => {
    if (!simState) return null
    return resolveScreenWithRoomNavigation(
      simState,
      rules,
      screensById,
      fallbackScreenId,
    )
  }, [simState, rules, screensById, fallbackScreenId])

  if (loading) {
    return (
      <div className="app app--center">
        <p>Loading config…</p>
      </div>
    )
  }

  if (loadError || !simState) {
    return (
      <div className="app app--center">
        <p className="app__error">{loadError ?? 'No state'}</p>
      </div>
    )
  }

  if (!resolution) {
    return (
      <div className="app app--center">
        <p>Could not resolve screen.</p>
      </div>
    )
  }

  const setPermission = (
    key: keyof SimulatorState['permissions'],
    value: SimulatorState['permissions'][keyof SimulatorState['permissions']],
  ) => {
    setSimState((prev) =>
      prev ? { ...prev, permissions: { ...prev.permissions, [key]: value } } : prev,
    )
  }

  const setCount = (
    key: 'appRoomCount' | 'networkOnlyRoomCount',
    raw: number,
  ) => {
    const n = Math.max(0, Math.min(10, Math.floor(raw)))
    setSimState((prev) => {
      if (!prev) return prev
      if (key === 'appRoomCount') {
        const names = [...prev.appRoomNames]
        while (names.length < n) names.push(`Room ${names.length + 1}`)
        names.length = n
        const devices = prev.devices.map((d) => {
          if (d.status !== 'assigned' || !d.assignedRoomId) return d
          const num = parseInt(d.assignedRoomId.replace(/^room-/, ''), 10)
          if (!Number.isFinite(num) || num > n || num < 1) {
            return { ...d, status: 'unassigned' as const, assignedRoomId: undefined }
          }
          return d
        })
        return {
          ...prev,
          appRoomCount: n,
          appRoomNames: names,
          devices,
        }
      }
      const names = [...prev.networkRoomNames]
      while (names.length < n) names.push(`LAN room ${names.length + 1}`)
      names.length = n
      return {
        ...prev,
        networkOnlyRoomCount: n,
        networkRoomNames: names,
      }
    })
  }

  const setAppRoomName = (index: number, value: string) => {
    setSimState((prev) => {
      if (!prev) return prev
      const appRoomNames = [...prev.appRoomNames]
      appRoomNames[index] = value
      return { ...prev, appRoomNames }
    })
  }

  const setNetworkRoomName = (index: number, value: string) => {
    setSimState((prev) => {
      if (!prev) return prev
      const networkRoomNames = [...prev.networkRoomNames]
      networkRoomNames[index] = value
      return { ...prev, networkRoomNames }
    })
  }

  const setDeviceCount = (raw: number) => {
    const n = Math.max(0, Math.min(10, Math.floor(raw)))
    setSimState((prev) => {
      if (!prev) return prev
      const devices = [...prev.devices]
      while (devices.length < n) {
        devices.push({
          id: deviceIdFromIndex(devices.length),
          status: 'unassigned',
          lanTransport: 'wifi',
        })
      }
      devices.length = n
      return { ...prev, devices }
    })
  }

  const factorSentenceProps = {
    simState,
    setSimState,
    setPermission,
    setCount,
    setAppRoomName,
    setNetworkRoomName,
    setDeviceCount,
  }

  const applyRuleMatch = (rule: Rule) => {
    setSimState((prev) =>
      prev ? applyRuleMatchToState(prev, rule.match) : prev,
    )
  }

  return (
    <div className="app">
      <header className="app__use-cases-bar">
        <label className="app__use-cases-label" htmlFor="app-use-case-select">
          Use case
        </label>
        <select
          id="app-use-case-select"
          className="app__use-case-select"
          value={selectedUseCase}
          onChange={(e) => setSelectedUseCase(e.target.value)}
        >
          <option value="">— Select a use case —</option>
          {useCases.map((uc) => (
            <option key={uc} value={uc}>
              {uc}
            </option>
          ))}
        </select>
      </header>
      <div
        className={[
          'app__grid',
          viewMode === 'diagram' ? 'app__grid--diagram' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {viewMode === 'simulator' ? (
          <>
            <div className="app__simulator-main">
              <div className="app__sentences-column">
                <FactorSentences {...factorSentenceProps} />
              </div>
              <div className="app__stage">
                <DeviceFrame
                  screen={resolution.screen}
                  state={simState}
                  onStateChange={setSimState}
                  networkPermissionPrompt={
                    resolution.networkPermissionPrompt ?? false
                  }
                  permissionsNetworkScreen={screensById.get(
                    'permissions_network',
                  )}
                />
                <div
                  className="app__stage-match"
                  aria-label="Current rules.json match for the phone"
                >
                  <RuleMatchSummary
                    state={simState}
                    matchedRuleId={resolution.matchedRuleId}
                    fallbackUsed={resolution.fallbackUsed}
                    networkPermissionPrompt={
                      resolution.networkPermissionPrompt ?? false
                    }
                    resolvedScreenId={resolution.screen.id}
                  />
                </div>
              </div>
            </div>
            <aside
              className="app__debug-aside"
              aria-label="Rule match debug"
            >
              <div className="app__debug-aside__body" id="app-rule-debug-panel">
                <RuleDebug
                  state={simState}
                  rules={rules}
                  matchedRuleId={resolution.matchedRuleId}
                  fallbackUsed={resolution.fallbackUsed}
                  networkPermissionPrompt={
                    resolution.networkPermissionPrompt ?? false
                  }
                  onApplyRuleMatch={applyRuleMatch}
                />
              </div>
            </aside>
          </>
        ) : (
          <div className="app__diagram-stack">
            <div className="app__diagram-lead">
              <FactorSentences {...factorSentenceProps} />
            </div>
            <div className="app__diagram-main">
              <RulesDiagram
                rules={rules}
                fallbackScreenId={fallbackScreenId}
                screensById={screensById}
                matchedRuleId={resolution.matchedRuleId}
                fallbackUsed={resolution.fallbackUsed}
                activeRoomId={simState.activeRoomId}
                networkPermissionPrompt={
                  resolution.networkPermissionPrompt ?? false
                }
              />
            </div>
          </div>
        )}
      </div>
      <footer className="app__footer" aria-label="View mode">
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </footer>
    </div>
  )
}
