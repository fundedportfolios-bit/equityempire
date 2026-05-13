import { useGame } from '../core/gameState.js'
import { hireStaff } from '../core/gameEngine.js'
import {
  calcCurrentStaffCost,
  calcStaffCapacity,
  calcStaffExpense,
  getStaffStatus,
  canHireStaff,
} from '../systems/staffSystem.js'
import { formatShort, formatCurrency } from '../utils/formatters.js'

export default function StaffPanel({ onClose }) {
  const { state, dispatch } = useGame()

  const { staffCount = 0, staffExpense = 0, currentMonth, monthlyIncome, monthlyExpenses, portfolioValue } = state
  const costPerMember  = calcCurrentStaffCost(currentMonth)
  const capacity       = calcStaffCapacity(staffCount)
  const staffStatus    = getStaffStatus(staffCount, portfolioValue)
  const canHire        = canHireStaff(monthlyIncome, monthlyExpenses, staffExpense, currentMonth)
  const netCFAfterHire = monthlyIncome - monthlyExpenses - calcStaffExpense(staffCount + 1, currentMonth)

  function handleHire() {
    dispatch(hireStaff())
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Staff Management</h2>
            <p className="modal-subtitle">Cash available: {formatShort(state.cash)}</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="staff-stats-strip">
            <div className="staff-stat">
              <span className="staff-stat-label">Staff Count</span>
              <span className="staff-stat-value">{staffCount}</span>
            </div>
            <div className="staff-stat">
              <span className="staff-stat-label">Monthly Cost</span>
              <span className="staff-stat-value">{staffCount > 0 ? formatCurrency(staffExpense) : '—'}</span>
            </div>
            <div className="staff-stat">
              <span className="staff-stat-label">Capacity</span>
              <span className="staff-stat-value">{staffCount > 0 ? formatShort(capacity) : '—'}</span>
            </div>
          </div>

          <div className="staff-status-row">
            <span className="staff-status-label">
              Portfolio {formatShort(portfolioValue)} vs capacity {staffCount > 0 ? formatShort(capacity) : 'none'}
            </span>
            <span className={`staff-status-badge staff-status-badge--${staffStatus.toLowerCase().replace(' ', '-')}`}>
              {staffStatus}
            </span>
          </div>

          <div className="staff-hire-section">
            <div className="staff-hire-detail">
              <span className="staff-hire-label">Cost per member</span>
              <span className="staff-hire-value">{formatCurrency(costPerMember)}/mo</span>
            </div>
            <div className="staff-hire-detail">
              <span className="staff-hire-label">Net CF after hiring</span>
              <span className={`staff-hire-value ${netCFAfterHire >= 0 ? 'positive' : 'negative'}`}>
                {netCFAfterHire >= 0 ? '+' : ''}{formatCurrency(netCFAfterHire)}/mo
              </span>
            </div>
            <button
              className="btn btn-primary staff-hire-btn"
              disabled={!canHire}
              onClick={handleHire}
            >
              Hire Staff Member
            </button>
            {!canHire && (
              <p className="staff-hire-reason">
                Insufficient cash flow — net CF after hiring would be {formatCurrency(netCFAfterHire)}/mo
              </p>
            )}
          </div>

          <p className="staff-blurb">
            Each staff member automatically resolves eligible maintenance events (immediate bills and
            scheduled maintenance) during monthly processing — no cash deduction beyond their salary.
            One staff member can handle up to {formatShort(3_000_000)} in portfolio value. When
            overloaded, Critical and High priority issues are handled first.
          </p>
        </div>
      </div>
    </div>
  )
}
