import { useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { installUpgrade } from '../core/gameEngine.js'
import { getAvailableUpgrades } from '../systems/eventSystem.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

function buildUpgradeList(property) {
  const available = getAvailableUpgrades(property)
  const units = property.units || 1
  return available.map(template => {
    const rolledCost          = (template.baseCost || 0) + (template.unitCostFactor || 0) * units
    const permanentRentBoost  = (template.rentBoostFlat || 0) + (template.rentBoostPerUnit || 0) * units
    const permanentValueBoost = Math.round(rolledCost * 1.5)
    const roi = rolledCost > 0 && permanentRentBoost > 0 ? (permanentRentBoost / rolledCost) * 100 : 0
    return { template, rolledCost, permanentRentBoost, permanentValueBoost, roi }
  }).sort((a, b) => b.roi - a.roi || a.rolledCost - b.rolledCost)
}

function makeInstance(template, rolledCost, permanentRentBoost, permanentValueBoost) {
  return {
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
}

function UpgradeRow({ upgrade, playerCash, onInstall }) {
  const { template, rolledCost, permanentRentBoost, roi } = upgrade
  const canAfford = playerCash >= rolledCost

  return (
    <li className={`upgrade-row${canAfford ? '' : ' upgrade-row--unaffordable'}`}>
      <div className="upgrade-row-info">
        <span className="upgrade-row-name">{template.upgradeName}</span>
        <span className="upgrade-row-meta">
          <span className="badge badge-upgrade">{template.upgradeCategory}</span>
          {permanentRentBoost > 0
            ? <span className="upgrade-row-roi">+{formatCurrency(permanentRentBoost)}/mo &middot; {roi.toFixed(1)}% ROI</span>
            : <span className="upgrade-row-roi upgrade-row-roi--op">Operational / risk reduction</span>
          }
        </span>
      </div>
      <button
        className={`btn btn-sm upgrade-row-btn${canAfford ? ' btn-success' : ''}`}
        disabled={!canAfford}
        title={canAfford ? `Install for ${formatCurrency(rolledCost)}` : `Need ${formatCurrency(rolledCost - playerCash)} more`}
        onClick={() => onInstall(upgrade)}
      >
        {formatCurrency(rolledCost)}
      </button>
    </li>
  )
}

export default function UpgradeModal({ propertyId, onClose }) {
  const { state, dispatch } = useGame()
  const property = state.properties.find(p => p.id === propertyId)

  const upgrades = useMemo(
    () => property ? buildUpgradeList(property) : [],
    [propertyId, property?.completedUpgrades?.length, property?.units]
  )

  if (!property) return null

  function handleInstall({ template, rolledCost, permanentRentBoost, permanentValueBoost }) {
    dispatch(installUpgrade(propertyId, makeInstance(template, rolledCost, permanentRentBoost, permanentValueBoost)))
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">
              <PropertyIcon emoji={property.icon} image={property.iconImage} inline /> {property.name} — Upgrades
            </h2>
            <p className="modal-subtitle">Cash: <strong>{formatShort(state.cash)}</strong> · Sorted by ROI</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {upgrades.length === 0
            ? <p className="empty-state">No upgrades available for this property yet.</p>
            : (
              <ul className="upgrades-list">
                {upgrades.map(u => (
                  <UpgradeRow
                    key={u.template.upgradeId}
                    upgrade={u}
                    playerCash={state.cash}
                    onInstall={handleInstall}
                  />
                ))}
              </ul>
            )
          }
        </div>
      </div>
    </div>
  )
}
