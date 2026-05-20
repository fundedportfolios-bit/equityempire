import { useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import { installUpgrade, installUpgradesBatch } from '../core/gameEngine.js'
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

  // Build the row list, then split into "affordable now" and "saving for"
  // groups so the player immediately sees what they can act on, with the
  // still-out-of-reach ones below (scrollable in the modal body).
  const { allUpgrades, affordableUpgrades, lockedUpgrades } = useMemo(() => {
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
    const byRoi = (a, b) => b.roi - a.roi || a.rolledCost - b.rolledCost
    const affordable = rows.filter(r => state.cash >= r.rolledCost).sort(byRoi)
    const locked     = rows.filter(r => state.cash <  r.rolledCost).sort(byRoi)
    return { allUpgrades: [...affordable, ...locked], affordableUpgrades: affordable, lockedUpgrades: locked }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.cash, state.properties.map(p => p.id + (p.completedUpgrades?.length ?? 0)).join()])

  function handleInstall({ template, property, rolledCost, permanentRentBoost, permanentValueBoost }) {
    dispatch(installUpgrade(property.id, makeInstance(template, rolledCost, permanentRentBoost, permanentValueBoost)))
  }

  // Group upgrades by property so we can fire one INSTALL_UPGRADES_BATCH
  // per property (the existing batch reducer is keyed to a single propertyId).
  const totalCost      = allUpgrades.reduce((s, u) => s + u.rolledCost, 0)
  const totalRentBoost = allUpgrades.reduce((s, u) => s + (u.permanentRentBoost || 0), 0)
  const canBuyAll      = allUpgrades.length > 0 && state.cash >= totalCost
  const buyAllShortfall = totalCost - state.cash

  function handleBuyAll() {
    if (!canBuyAll) return
    const byProp = new Map()
    for (const u of allUpgrades) {
      const arr = byProp.get(u.property.id) || []
      arr.push(makeInstance(u.template, u.rolledCost, u.permanentRentBoost, u.permanentValueBoost))
      byProp.set(u.property.id, arr)
    }
    for (const [propId, instances] of byProp.entries()) {
      dispatch(installUpgradesBatch(propId, instances))
    }
    onClose()
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
              {allUpgrades.length > 0 && (
                <span> · {affordableUpgrades.length} affordable / {lockedUpgrades.length} saving · sorted by ROI</span>
              )}
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {allUpgrades.length === 0
            ? <p className="empty-state">No upgrades available across your portfolio yet.</p>
            : (
              <>
                <div className="upgrade-buy-all-bar">
                  <div className="upgrade-buy-all-summary">
                    <span className="upgrade-buy-all-label">Install all {allUpgrades.length} portfolio upgrades</span>
                    {totalRentBoost > 0 && (
                      <span className="upgrade-buy-all-roi">+{formatCurrency(totalRentBoost)}/mo</span>
                    )}
                  </div>
                  <button
                    className={`btn btn-sm upgrade-buy-all-btn${canBuyAll ? ' btn-success' : ''}`}
                    disabled={!canBuyAll}
                    title={canBuyAll
                      ? `Install all ${allUpgrades.length} upgrades for ${formatCurrency(totalCost)}`
                      : `Need ${formatCurrency(buyAllShortfall)} more`}
                    onClick={handleBuyAll}
                  >
                    BUY ALL · {formatCurrency(totalCost)}
                  </button>
                </div>
                {affordableUpgrades.length > 0 && (
                  <ul className="upgrades-list">
                    {affordableUpgrades.map(u => (
                      <UpgradeRow
                        key={`${u.property.id}-${u.template.upgradeId}`}
                        upgrade={u}
                        playerCash={state.cash}
                        onInstall={handleInstall}
                      />
                    ))}
                  </ul>
                )}
                {lockedUpgrades.length > 0 && (
                  <>
                    <div className="upgrades-divider">
                      <span className="upgrades-divider-label">Saving For</span>
                      <span className="upgrades-divider-count">{lockedUpgrades.length} more — scroll to view</span>
                    </div>
                    <ul className="upgrades-list">
                      {lockedUpgrades.map(u => (
                        <UpgradeRow
                          key={`${u.property.id}-${u.template.upgradeId}`}
                          upgrade={u}
                          playerCash={state.cash}
                          onInstall={handleInstall}
                        />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )
          }
        </div>
      </div>
    </div>
  )
}
