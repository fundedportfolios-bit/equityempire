import { useGame } from '../core/gameState.js'
import { resolveEvent } from '../core/gameEngine.js'
import { formatCurrency } from '../utils/formatters.js'

const ABBREV = {
  'Single Long-Term Rental':  'Single LTR',
  'Single Short-Term Rental': 'Single STR',
  'Small Multifamily':        'Small MF',
  'Fix and Flip':             'Fix & Flip',
  'Micro Resort':             'Micro Resort',
  'Apartment Building':       'Apt Building',
  'Apartment Complex':        'Apt Complex',
}

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 }

const PRIORITY_ALERT_CLASS = {
  Critical: 'alert-critical',
  High:     'alert-high',
  Medium:   'alert-medium',
  Low:      'alert-low',
}

const PRIORITY_ICONS = {
  Critical: '🔴',
  High:     '🟡',
  Medium:   '🟢',
  Low:      'ℹ',
}

export default function AlertsPanel() {
  const { state, dispatch } = useGame()

  // Build numbered labels by acquisition order per property type
  const nameCounters = {}
  const propertyLabels = state.properties.map(p => {
    nameCounters[p.name] = (nameCounters[p.name] || 0) + 1
    return { id: p.id, label: `${ABBREV[p.name] ?? p.name} ${nameCounters[p.name]}` }
  })
  const labelById = Object.fromEntries(propertyLabels.map(l => [l.id, l.label]))

  // Flatten all activeEvents across properties
  const rows = []
  for (const prop of state.properties) {
    for (const ev of (prop.activeEvents || [])) {
      rows.push({ event: ev, propertyId: prop.id, label: labelById[prop.id] })
    }
  }
  rows.sort((a, b) =>
    (PRIORITY_ORDER[a.event.priority] ?? 99) - (PRIORITY_ORDER[b.event.priority] ?? 99)
  )

  if (rows.length === 0) {
    return (
      <section className="alerts-panel">
        <h2 className="section-title">Alerts</h2>
        <p className="empty-state">No active issues — you're in good shape.</p>
      </section>
    )
  }

  return (
    <section className="alerts-panel">
      <h2 className="section-title">Alerts</h2>
      <ul className="alerts-list">
        {rows.map(({ event, propertyId, label }) => {
          const canAfford  = state.cash >= event.rolledCost
          const alertClass = PRIORITY_ALERT_CLASS[event.priority] ?? 'alert-low'
          return (
            <li key={event.instanceId} className={`alert-item ${alertClass}`}>
              <span className="alert-icon">{PRIORITY_ICONS[event.priority] ?? 'ℹ'}</span>
              <span className="alert-message">
                <strong>{label}</strong> — {event.name}
                {event.rolledCost > event.originalCost && (
                  <span className="alert-escalated"> ↑</span>
                )}
              </span>
              <button
                className={`alert-resolve-btn${canAfford ? '' : ' alert-resolve-btn--disabled'}`}
                disabled={!canAfford}
                title={canAfford
                  ? `Resolve for ${formatCurrency(event.rolledCost)}`
                  : `Need ${formatCurrency(event.rolledCost - state.cash)} more`}
                onClick={() => dispatch(resolveEvent(propertyId, event.instanceId))}
              >
                {formatCurrency(event.rolledCost)}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
