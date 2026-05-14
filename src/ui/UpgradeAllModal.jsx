import { useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { installUpgrade } from '../core/gameEngine.js'
import { getAvailableUpgrades } from '../systems/eventSystem.js'
import { formatCurrency, formatShort } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

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
  const { template, property, rolledCost, permanentRentBoost, roi } = upgrade
  const canAfford = playerCash >= rolledCost

  return (
    <li className={`upgrade-row${canAfford ? '' : ' upgrade-row--unaffordable'}`}>
      <div className="upgrade-row-info">
        <span className="upgrade-row-name">{template.upgradeName}</span>
        <span className="upgrade-row-meta">
          <span className="upgrade-row-prop"><PropertyIcon emoji={property.icon} image={property.iconImage} templateId={property.templateId} inline /> {property.name}</span>
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

export default function UpgradeAllModal({ onClose }) {
  const { state, dispatch } = useGame()

  const allUpgrades = useMemo(() => {
    const rows = []
    for (const property of state.properties) {
      const units = property.units || 1
      for (const template of getAvailableUpgrades(property)) {
        const rolledCost          = (template.baseCost || 0) + (template.unitCostFactor || 0) * units
        const permanentRentBoost  = (template.rentBoostFlat || 0) + (template.rentBoostPerUnit || 0) * units
        const permanentValueBoost = Math.round(rolledCost * 1.5)
        const roi = rolledCost > 0 && permanentRentBoost > 0 ? (permanentRentBoost / rolledCost) * 100 : 0
        rows.push({ template, property, rolledCost, permanentRentBoost, permanentValueBoost, roi })
      }
    }
    return rows.sort((a, b) => b.roi - a.roi || a.rolledCost - b.rolledCost)
  }, [state.properties.map(p => p.id + (p.completedUpgrades?.length ?? 0)).join()])

  function handleInstall({ template, property, rolledCost, permanentRentBoost, permanentValueBoost }) {
    dispatch(installUpgrade(property.id, makeInstance(template, rolledCost, permanentRentBoost, permanentValueBoost)))
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Portfolio Upgrades</h2>
            <p className="modal-subtitle">
              Cash: <strong>{formatShort(state.cash)}</strong>
              {allUpgrades.length > 0 && <span> · {allUpgrades.length} available · sorted by ROI</span>}
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {allUpgrades.length === 0
            ? <p className="empty-state">No upgrades available across your portfolio yet.</p>
            : (
              <ul className="upgrades-list">
                {allUpgrades.map(u => (
                  <UpgradeRow
                    key={`${u.property.id}-${u.template.upgradeId}`}
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
