export type ExplorerView = 'simulator' | 'diagram'

interface ViewModeToggleProps {
  value: ExplorerView
  onChange: (value: ExplorerView) => void
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="view-toggle" role="tablist" aria-label="Main view">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'simulator'}
        className={
          value === 'simulator'
            ? 'view-toggle__seg view-toggle__seg--active'
            : 'view-toggle__seg'
        }
        onClick={() => onChange('simulator')}
      >
        Simulator
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'diagram'}
        className={
          value === 'diagram'
            ? 'view-toggle__seg view-toggle__seg--active'
            : 'view-toggle__seg'
        }
        onClick={() => onChange('diagram')}
      >
        Rules diagram
      </button>
    </div>
  )
}
