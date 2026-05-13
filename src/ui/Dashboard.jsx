import { useState } from 'react'
import { useGame } from '../core/gameState.js'
import { setModalOpen, toggleTrivia } from '../core/gameEngine.js'
import { useMarketRate } from '../hooks/useMarketRate.js'
import PortfolioSummary from './PortfolioSummary.jsx'
import AlertsPanel from './AlertsPanel.jsx'
import PropertyList from './PropertyList.jsx'
import ActionPanel from './ActionPanel.jsx'
import InvestModal from './InvestModal.jsx'
import UpgradeModal from './UpgradeModal.jsx'
import UpgradeAllModal from './UpgradeAllModal.jsx'
import SellRefiModal from './SellRefiModal.jsx'
import PortfolioRefiModal from './PortfolioRefiModal.jsx'
import StaffPanel from './StaffPanel.jsx'
import TriviaModal from './TriviaModal.jsx'
import WinModal from './WinModal.jsx'
import MilestoneModal from './MilestoneModal.jsx'
import ReportModal from './ReportModal.jsx'

export default function Dashboard({ onSave, onExit }) {
  const { state, dispatch } = useGame()
  const [activeModal,  setActiveModal]  = useState(null)
  const [winDismissed, setWinDismissed] = useState(false)
  const [reportOpen,   setReportOpen]   = useState(false)

  useMarketRate(dispatch)

  function openModal(config) {
    dispatch(setModalOpen(true))
    setActiveModal(config)
  }

  function closeModal() {
    dispatch(setModalOpen(false))
    setActiveModal(null)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="game-title">Equity Empire<span className="game-version">v3.1</span></h1>
        <div className="dashboard-header-actions">
          <button
            className="btn btn-ghost btn-sm report-btn"
            onClick={() => { dispatch(setModalOpen(true)); setReportOpen(true) }}
          >
            Report
          </button>
          <button className="btn btn-ghost btn-sm save-btn" onClick={onSave}>
            Save
          </button>
          {onExit && (
            <button className="btn btn-ghost btn-sm exit-btn" onClick={onExit} title="Save and return to slot selection">
              ← Exit
            </button>
          )}
        </div>
      </header>

      <main className="dashboard-main">
        <PortfolioSummary />
        <AlertsPanel />
        <PropertyList
          onUpgrade={(id) => openModal({ type: 'upgrade', propertyId: id })}
          onSellRefi={(id) => openModal({ type: 'sellRefi', propertyId: id })}
        />
      </main>

      <ActionPanel
        onInvest={() => openModal({ type: 'invest' })}
        onManage={() => openModal({ type: 'upgradeAll' })}
        onRefinance={() => openModal({ type: 'portfolioRefi' })}
        onStaff={() => openModal({ type: 'staff' })}
        onTriviaToggle={() => dispatch(toggleTrivia())}
      />

      {activeModal?.type === 'invest' && (
        <InvestModal onClose={closeModal} />
      )}
      {activeModal?.type === 'upgrade' && (
        <UpgradeModal propertyId={activeModal.propertyId} onClose={closeModal} />
      )}
      {activeModal?.type === 'sellRefi' && (
        <SellRefiModal propertyId={activeModal.propertyId} onClose={closeModal} />
      )}
      {activeModal?.type === 'upgradeAll' && (
        <UpgradeAllModal onClose={closeModal} />
      )}
      {activeModal?.type === 'portfolioRefi' && (
        <PortfolioRefiModal
          onSelectProperty={(id) => openModal({ type: 'sellRefi', propertyId: id })}
          onClose={closeModal}
        />
      )}
      {activeModal?.type === 'staff' && (
        <StaffPanel onClose={closeModal} />
      )}
      {state.activeTriviaQuestion && <TriviaModal />}
      {state.activeMilestone && <MilestoneModal />}
      {state.gameWon && !winDismissed && (
        <WinModal
          onContinue={() => setWinDismissed(true)}
          onExit={onExit}
        />
      )}
      {reportOpen && (
        <ReportModal onClose={() => { dispatch(setModalOpen(false)); setReportOpen(false) }} />
      )}
    </div>
  )
}
