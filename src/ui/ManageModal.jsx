import { useState, useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { resolveEvent, installUpgrade } from '../core/gameEngine.js'
import { getAvailableUpgrades } from '../systems/eventSystem.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'

const PRIORITY_CLASS = {
  Critical: 'badge-priority-critical',
  High:     'badge-priority-high',
  Medium:   'badge-priority-medium',
  Low:      'badge-priority-low',
}

const CATEGORY_LABELS = {
  randomEvent:          'Random Event',
  preventiveMaintenance: 'Scheduled Maintenance',
  startupAction:        'Startup Action',
  upgrade:              'Upgrade',
}

function frequencyLabel(months) {
  if (!months) return null
  if (months === 1)  return 'Monthly'
  if (months === 3)  return 'Quarterly'
  if (months === 6)  return 'Semi-Annual'
  if (months === 12) return 'Annual'
  if (months === 24) return 'Every 2 Years'
  return `Every ${months} months`
}

function EventCard({ event, property, playerCash, onResolve }) {
  const canAfford = playerCash >= event.rolledCost
  const deficit   = event.rolledCost - playerCash
  const escalated = event.rolledCost > event.originalCost
  const freq      = frequencyLabel(event.frequencyMonths)

  return (
    <div className={`event-card${!canAfford ? ' event-card--unaffordable' : ''}`}>
      <div className="event-card-header">
        <div className="event-card-title-row">
          <span className="event-name">{event.name}</span>
          <span className={`badge ${PRIORITY_CLASS[event.priority] ?? ''}`}>
            {event.priority}
          </span>
        </div>
        <span className="event-category">
          {CATEGORY_LABELS[event.category] ?? event.category}
          {freq && <span className="event-frequency"> · {freq}</span>}
        </span>
      </div>

      <div className="event-cost-row">
        <span className="event-cost-label">Estimated Cost</span>
        <span className={`event-cost-value${escalated ? ' escalated' : ''}`}>
          {formatCurrency(event.rolledCost)}
          {escalated && <span className="escalated-flag"> ↑ escalated</span>}
        </span>
      </div>

      {!canAfford && (
        <p className="event-deficit">Need {formatCurrency(deficit)} more to resolve this.</p>
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
  const deficit   = rolledCost - playerCash

  function handleInstall() {
    const upgradeInstance = {
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
    }
    onInstall(upgradeInstance)
  }

  return (
    <div className={`upgrade-card${!canAfford ? ' upgrade-card--unaffordable' : ''}`}>
      <div className="event-card-header">
        <div className="event-card-title-row">
          <span className="event-name">{template.upgradeName}</span>
          <span className="badge badge-upgrade">{template.upgradeCategory}</span>
        </div>
        <span className="event-category">{template.educationalPurpose ?? template.upgradeCategory}</span>
      </div>

      <div className="upgrade-effects">
        {permanentRentBoost > 0 && (
          <span className="upgrade-effect positive">
            +{formatCurrency(permanentRentBoost)}/mo income
          </span>
        )}
        {permanentValueBoost > 0 && (
          <span className="upgrade-effect positive">
            +{formatShort(permanentValueBoost)} value
          </span>
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
        <p className="event-deficit">Need {formatCurrency(deficit)} more to install this.</p>
      )}

      <button
        className="btn btn-success btn-sm event-resolve-btn"
        disabled={!canAfford}
        onClick={handleInstall}
      >
        {canAfford ? `Install — ${formatCurrency(rolledCost)}` : 'Not enough cash'}
      </button>
    </div>
  )
}

export default function ManageModal({ propertyId, onClose }) {
  const { state, dispatch } = useGame()
  const property = state.properties.find(p => p.id === propertyId)

  const availableUpgrades = useMemo(
    () => property ? getAvailableUpgrades(property) : [],
    [propertyId, property?.completedUpgrades?.length]
  )

  // Compute deterministic costs for all available upgrades; sort by cost; pick 2 to show
  const displayedUpgrades = useMemo(() => {
    if (!property || availableUpgrades.length === 0) return []
    const units = property.units || 1
    const withCosts = availableUpgrades.map(template => {
      const rolledCost         = (template.baseCost || 0) + (template.unitCostFactor || 0) * units
      const permanentRentBoost  = (template.rentBoostFlat || 0) + (template.rentBoostPerUnit || 0) * units
      const permanentValueBoost = Math.round(rolledCost * 1.5)
      return { template, rolledCost, permanentRentBoost, permanentValueBoost }
    }).sort((a, b) => a.rolledCost - b.rolledCost)

    // Take up to 2 affordable; if fewer than 2 affordable, pad with cheapest unaffordable
    const affordable   = withCosts.filter(u => u.rolledCost <= state.cash)
    const unaffordable = withCosts.filter(u => u.rolledCost >  state.cash)
    const selected     = affordable.slice(0, 2)
    if (selected.length < 2) selected.push(...unaffordable.slice(0, 2 - selected.length))
    return selected
  }, [propertyId, availableUpgrades.length, property?.units])

  if (!property) return null

  const activeIssues = (property.activeEvents || [])

  function handleResolve(instanceId) {
    dispatch(resolveEvent(propertyId, instanceId))
  }

  function handleInstallUpgrade(upgradeInstance) {
    dispatch(installUpgrade(propertyId, upgradeInstance))
    onClose()
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  const hasIssues   = activeIssues.length > 0
  const hasUpgrades = displayedUpgrades.length > 0

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">
              {property.icon} {property.name}
            </h2>
            <p className="modal-subtitle">
              Available cash: <strong>{formatShort(state.cash)}</strong>
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {!hasIssues && !hasUpgrades && (
            <div className="manage-empty">
              <p>No active issues and no upgrades available yet.</p>
              <p className="empty-hint">Advance months to see maintenance and events appear.</p>
            </div>
          )}

          {hasIssues && (
            <section className="manage-section">
              <h3 className="manage-section-title">
                Active Issues
                <span className="section-count">{activeIssues.length}</span>
              </h3>
              {activeIssues.map(event => (
                <EventCard
                  key={event.instanceId}
                  event={event}
                  property={property}
                  playerCash={state.cash}
                  onResolve={handleResolve}
                />
              ))}
            </section>
          )}

          {hasUpgrades && (
            <section className="manage-section">
              <h3 className="manage-section-title">Upgrade Opportunities</h3>
              {displayedUpgrades.map(({ template, rolledCost, permanentRentBoost, permanentValueBoost }) => (
                <UpgradeCard
                  key={template.upgradeId}
                  template={template}
                  rolledCost={rolledCost}
                  permanentRentBoost={permanentRentBoost}
                  permanentValueBoost={permanentValueBoost}
                  playerCash={state.cash}
                  onInstall={handleInstallUpgrade}
                />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
