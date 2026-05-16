import { useGame } from '../core/gameState.js'
import { hireStaffRole } from '../core/gameEngine.js'
import {
  getStaffCounts,
  getTotalStaffCount,
  getTotalStaffExpense,
  getCurrentStaffCostByRole,
  getRawStaffCapacity,
  getLeadershipMultiplier,
  getEffectiveStaffCapacity,
  getPropertyBaseWorkload,
  getActiveIssueWorkload,
  getTotalOperationsWorkload,
  getCoverageRatio,
  getStaffStatus,
  canHireStaffRole,
} from '../systems/staffSystem.js'
import { STAFF_ROLES, STAFF_ROLE_ORDER, COVERAGE_STATUSES } from '../data/staffRules.js'
import { formatShort, formatCurrency } from '../utils/formatters.js'
import PropertyIcon from './PropertyIcon.jsx'

function statusClass(status) {
  switch (status) {
    case COVERAGE_STATUSES.COVERED:        return 'staff-status-badge--covered'
    case COVERAGE_STATUSES.STRETCHED:      return 'staff-status-badge--stretched'
    case COVERAGE_STATUSES.OVERLOADED:     return 'staff-status-badge--overloaded'
    case COVERAGE_STATUSES.BREAKDOWN_RISK: return 'staff-status-badge--breakdown'
    default:                                return 'staff-status-badge--none'
  }
}

// ─── Hire card per role ──────────────────────────────────────
function HireRoleCard({ role, state, onHire }) {
  const cfg          = STAFF_ROLES[role]
  const counts       = getStaffCounts(state)
  const currentCount = counts[role] || 0
  const cost         = getCurrentStaffCostByRole(role, state.currentMonth || 1)
  const canHire      = canHireStaffRole(state, role)
  const netAfter     = (state.monthlyIncome || 0)
                       - (state.monthlyExpenses || 0)
                       - getTotalStaffExpense(state)
                       - cost

  return (
    <div className={`hire-role-card${!canHire ? ' hire-role-card--disabled' : ''}`}>
      <div className="hire-role-header">
        <PropertyIcon emoji={cfg.icon} image={cfg.iconImage} className="hire-role-icon" />
        <div className="hire-role-title">
          <div className="hire-role-name">{cfg.label}</div>
          <div className="hire-role-count">Currently hired: {currentCount}</div>
        </div>
        <span className="hire-role-cost">{formatCurrency(cost)}/mo</span>
      </div>

      <p className="hire-role-blurb">{cfg.blurb}</p>
      <ul className="hire-role-bullets">
        <li>{cfg.handles}</li>
        <li>Capacity: <strong>{cfg.baseCapacity}</strong> workload pts</li>
        {cfg.leadershipBonus > 0 && (
          <li>Team efficiency: <strong>+{Math.round(cfg.leadershipBonus * 100)}%</strong></li>
        )}
      </ul>

      <button
        className="btn btn-primary hire-role-btn"
        disabled={!canHire}
        onClick={() => onHire(role)}
      >
        Hire {cfg.label}
      </button>
      {!canHire && (
        <p className="hire-role-disabled-msg">
          Net CF after hire would be {formatCurrency(netAfter)}/mo — insufficient cash flow.
        </p>
      )}
    </div>
  )
}

// ─── Top-level panel ─────────────────────────────────────────
export default function StaffPanel({ onClose }) {
  const { state, dispatch } = useGame()

  const counts            = getStaffCounts(state)
  const totalStaff        = getTotalStaffCount(state)
  const totalStaffExpense = getTotalStaffExpense(state)
  const rawCap            = getRawStaffCapacity(state)
  const leadership        = getLeadershipMultiplier(state)
  const effectiveCap      = getEffectiveStaffCapacity(state)
  const propWorkload      = getPropertyBaseWorkload(state.properties || [])
  const issueWorkload     = getActiveIssueWorkload(state.properties || [])
  const totalWorkload     = getTotalOperationsWorkload(state)
  const coverageRatio     = getCoverageRatio(state)
  const status            = getStaffStatus(state)

  // Coverage % to display — 200%+ caps visually as 200%, ∞ shows as 100%.
  const coveragePctDisplay = (() => {
    if (!isFinite(coverageRatio)) return totalStaff > 0 ? '100%' : '—'
    if (totalWorkload === 0)      return totalStaff > 0 ? '100%' : '—'
    return `${Math.round(coverageRatio * 100)}%`
  })()

  const isBacklog = [
    COVERAGE_STATUSES.STRETCHED,
    COVERAGE_STATUSES.OVERLOADED,
    COVERAGE_STATUSES.BREAKDOWN_RISK,
  ].includes(status)

  function handleHire(role) {
    dispatch(hireStaffRole(role))
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Staff Management</h2>
            <p className="modal-subtitle">Cash available: {formatShort(state.cash)}</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {/* ── Summary cards ──────────────────────────────────────── */}
          <div className="staff-summary-grid">
            <div className="staff-summary-card">
              <span className="staff-summary-label">Total Staff</span>
              <span className="staff-summary-value">{totalStaff}</span>
            </div>
            <div className="staff-summary-card">
              <span className="staff-summary-label">Monthly Cost</span>
              <span className="staff-summary-value">{totalStaff > 0 ? formatCurrency(totalStaffExpense) : '—'}</span>
            </div>
            <div className="staff-summary-card">
              <span className="staff-summary-label">Effective Capacity</span>
              <span className="staff-summary-value">{effectiveCap}</span>
            </div>
            <div className="staff-summary-card">
              <span className="staff-summary-label">Workload</span>
              <span className="staff-summary-value">{totalWorkload}</span>
            </div>
            <div className="staff-summary-card staff-summary-card--status">
              <span className="staff-summary-label">Coverage</span>
              <span className={`staff-status-badge ${statusClass(status)}`}>
                {status} · {coveragePctDisplay}
              </span>
            </div>
          </div>

          {/* ── Backlog warning ────────────────────────────────────── */}
          {isBacklog && (
            <div className="staff-backlog-warning">
              ⚠ Your operations team is under capacity. Routine issues may age into urgent issues if not resolved.
            </div>
          )}

          {/* ── Workload breakdown ─────────────────────────────────── */}
          <section className="staff-section">
            <h3 className="staff-section-title">Workload Breakdown</h3>
            <div className="staff-workload-grid">
              <div className="staff-workload-row">
                <span>Base property workload</span>
                <span>{propWorkload}</span>
              </div>
              <div className="staff-workload-row">
                <span>Active issue workload</span>
                <span>{issueWorkload}</span>
              </div>
              <div className="staff-workload-row staff-workload-row--total">
                <span>Total operations workload</span>
                <span>{totalWorkload}</span>
              </div>
              <div className="staff-workload-row staff-workload-row--divider" />
              <div className="staff-workload-row">
                <span>Raw staff capacity</span>
                <span>{rawCap}</span>
              </div>
              <div className="staff-workload-row">
                <span>Leadership multiplier</span>
                <span>×{leadership.toFixed(2)}</span>
              </div>
              <div className="staff-workload-row staff-workload-row--total">
                <span>Effective capacity</span>
                <span>{effectiveCap}</span>
              </div>
            </div>
          </section>

          {/* ── Roster ─────────────────────────────────────────────── */}
          <section className="staff-section">
            <h3 className="staff-section-title">Roster</h3>
            <div className="staff-roster-row">
              {STAFF_ROLE_ORDER.map(role => {
                const cfg = STAFF_ROLES[role]
                return (
                  <div key={role} className="staff-roster-chip">
                    <PropertyIcon emoji={cfg.icon} image={cfg.iconImage} className="staff-roster-icon" />
                    <div className="staff-roster-meta">
                      <span className="staff-roster-label">{cfg.label}</span>
                      <span className="staff-roster-count">×{counts[role] || 0}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── Hire role cards ────────────────────────────────────── */}
          <section className="staff-section">
            <h3 className="staff-section-title">Hire</h3>
            <div className="hire-role-grid">
              {STAFF_ROLE_ORDER.map(role => (
                <HireRoleCard key={role} role={role} state={state} onHire={handleHire} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
