import { useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { resolveEvent, installUpgrade } from '../core/gameEngine.js'
import { getAvailableUpgrades } from '../systems/eventSystem.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

const PRIORITY_CLASS = {
  Critical: 'badge-priority-critical',
  High:     'badge-priority-high',
  Medium:   'badge-priority-medium',
  Low:      'badge-priority-low',
}

function EventCard({ event, playerCash, onResolve }) {
  const canAfford = playerCash >= event.rolledCost
  const escalated = event.rolledCost > event.originalCost
  return (
    <div className={`event-card${canAfford ? '' : ' event-card--unaffordable'}`}>
      <div className="event-card-header">
        <div className="event-card-title-row">
          <span className="event-name">{event.name}</span>
          <span className={`badge ${PRIORITY_CLASS[event.priority] ?? ''}`}>{event.priority}</span>
        </div>
        <span className="event-category">
          {escalated && <span className="escalated-flag">↑ escalated · </span>}
          {event.category}
        </span>
      </div>
      <div className="event-cost-row">
        <span className="event-cost-label">Cost</span>
        <span className={`event-cost-value${escalated ? ' escalated' : ''}`}>
          {formatCurrency(event.rolledCost)}
        </span>
      </div>
      {!canAfford && (
        <p className="event-deficit">Need {formatCurrency(event.rolledCost - playerCash)} more</p>
      )}
      <button
        className="btn btn-primary btn-sm event-resolve-btn"
        disabled={!canAfford}
        onClick={() => onResolve(event.instanceId)}
      >
        {canAfford ? `Resolve — ${formatCurrency(event.rolledCost)}` : 'Not enough cash'}
      </button>
    </div>
  )
}

function UpgradeCard({ template, rolledCost, permanentRentBoost, permanentValueBoost, playerCash, onInstall }) {
  const canAfford = playerCash >= rolledCost
  return (
    <div className={`upgrade-card${canAfford ? '' : ' upgrade-card--unaffordable'}`}>
      <div className="event-card-header">
        <div className="event-card-title-row">
          <span className="event-name">{template.upgradeName}</span>
          <span className="badge badge-upgrade">{template.upgradeCategory}</span>
        </div>
        <span className="event-category">{template.educationalPurpose ?? template.upgradeCategory}</span>
      </div>
      <div className="upgrade-effects">
        {permanentRentBoost > 0 && (
          <span className="upgrade-effect positive">+{formatCurrency(permanentRentBoost)}/mo income</span>
        )}
        {permanentValueBoost > 0 && (
          <span className="upgrade-effect positive">+{formatShort(permanentValueBoost)} value</span>
        )}
        {permanentRentBoost === 0 && permanentValueBoost === 0 && (
          <span className="upgrade-effect">Risk reduction / operational improvement</span>
        )}
      </div>
      <div className="event-cost-row">
        <span className="event-cost-label">Installation Cost</span>
        <span className="event-cost-value">{formatCurrency(rolledCost)}</span>
      </div>
      {!canAfford && (
        <p className="event-deficit">Need {formatCurrency(rolledCost - playerCash)} more</p>
      )}
      <button
        className="btn btn-success btn-sm event-resolve-btn"
        disabled={!canAfford}
        onClick={() => onInstall({ template, rolledCost, permanentRentBoost, permanentValueBoost })}
      >
        {canAfford ? `Install — ${formatCurrency(rolledCost)}` : 'Not enough cash'}
      </button>
    </div>
  )
}

function PropertySection({ property, playerCash, dispatch }) {
  const availableUpgrades = useMemo(
    () => getAvailableUpgrades(property),
    [property.id, property.completedUpgrades?.length]
  )

  const displayedUpgrades = useMemo(() => {
    if (availableUpgrades.length === 0) return []
    const units = property.units || 1
    const withCosts = availableUpgrades.map(template => {
      const rolledCost          = (template.baseCost || 0) + (template.unitCostFactor || 0) * units
      const permanentRentBoost  = (template.rentBoostFlat || 0) + (template.rentBoostPerUnit || 0) * units
      const permanentValueBoost = Math.round(rolledCost * 1.5)
      return { template, rolledCost, permanentRentBoost, permanentValueBoost }
    }).sort((a, b) => a.rolledCost - b.rolledCost)

    const affordable   = withCosts.filter(u => u.rolledCost <= playerCash)
    const unaffordable = withCosts.filter(u => u.rolledCost > playerCash)
    const selected     = affordable.slice(0, 2)
    if (selected.length < 2) selected.push(...unaffordable.slice(0, 2 - selected.length))
    return selected
  }, [property.id, availableUpgrades.length, property.units])

  const activeIssues = property.activeEvents || []
  if (activeIssues.length === 0 && displayedUpgrades.length === 0) return null

  function handleInstall({ template, rolledCost, permanentRentBoost, permanentValueBoost }) {
    dispatch(installUpgrade(property.id, {
      instanceId:          `upg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sourceId:            template.upgradeId,
      category:            'upgrade',
      name:                template.upgradeName,
      priority:            template.priority,
      rolledCost,
      originalCost:        rolledCost,
      permanentRentBoost,
      permanentValueBoost,
      monthSpawned:        0,
      monthsActive:        0,
    }))
  }

  return (
    <section className="manage-all-prop-section">
      <h3 className="manage-all-prop-header">
        <span><PropertyIcon emoji={property.icon} image={property.iconImage} templateId={property.templateId} inline /> {property.name}</span>
        {activeIssues.length > 0 && (
          <span className="manage-all-issue-count">{activeIssues.length} issue{activeIssues.length !== 1 ? 's' : ''}</span>
        )}
      </h3>

      {activeIssues.length > 0 && (
        <div className="manage-all-cards">
          {activeIssues.map(event => (
            <EventCard
              key={event.instanceId}
              event={event}
              playerCash={playerCash}
              onResolve={(instanceId) => dispatch(resolveEvent(property.id, instanceId))}
            />
          ))}
        </div>
      )}

      {displayedUpgrades.length > 0 && (
        <>
          <h4 className="manage-all-upgrades-title">Upgrade Opportunities</h4>
          <div className="manage-all-cards">
            {displayedUpgrades.map(({ template, rolledCost, permanentRentBoost, permanentValueBoost }) => (
              <UpgradeCard
                key={template.upgradeId}
                template={template}
                rolledCost={rolledCost}
                permanentRentBoost={permanentRentBoost}
                permanentValueBoost={permanentValueBoost}
                playerCash={playerCash}
                onInstall={handleInstall}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default function ManageAllModal({ onClose }) {
  const { state, dispatch } = useGame()

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  const totalIssues = state.properties.reduce((n, p) => n + (p.activeEvents?.length || 0), 0)

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Portfolio Management</h2>
            <p className="modal-subtitle">
              Available cash: <strong>{formatShort(state.cash)}</strong>
              {totalIssues > 0 && <span className="manage-all-total-issues"> · {totalIssues} active issue{totalIssues !== 1 ? 's' : ''}</span>}
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {state.properties.length === 0 ? (
            <p className="empty-state">No properties in your portfolio yet.</p>
          ) : (
            state.properties.map(property => (
              <PropertySection
                key={property.id}
                property={property}
                playerCash={state.cash}
                dispatch={dispatch}
              />
            ))
          )}
          {state.properties.length > 0 && totalIssues === 0 && (
            <div className="manage-empty">
              <p>No active issues across your portfolio.</p>
              <p className="empty-hint">Check individual properties for upgrade opportunities.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
