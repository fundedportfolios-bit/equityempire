import { useState, useEffect, useRef } from 'react'
import { useGame } from '../core/gameState.js'
import { setModalOpen, toggleTrivia, openInvestModal, dismissWin, markTutorialSeen, setLeaderboardProfile, setCoachSeen, setEquityHintShown, setPaused } from '../core/gameEngine.js'
import { useMarketRate } from '../hooks/useMarketRate.js'
import { useActivityLogger } from '../hooks/useActivityLogger.js'
import { useLeaderboardSync } from '../hooks/useLeaderboardSync.js'
import { THRESHOLD_1B } from '../data/gameVersion.js'
import { auth } from '../firebase/config.js'
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
import TutorialOverlay from './TutorialOverlay.jsx'
import LeaderboardScreen from './LeaderboardScreen.jsx'
import LeaderboardSignupModal from './LeaderboardSignupModal.jsx'
import LeaderboardTopFiveModal from './LeaderboardTopFiveModal.jsx'
import CoachOverlay           from './CoachOverlay.jsx'
import EquityHintModal        from './EquityHintModal.jsx'
import { getMaxRefiNetCash }  from '../systems/loanSystem.js'
import { PROPERTY_TYPES }     from '../data/propertyTypes.js'

// The Firebase debug panel is a developer diagnostic tool, not part of the
// normal player UI. It renders only during local development, or on the live
// site when ?debug=1 is appended to the URL — never for regular players.
const DEBUG_PANEL_ENABLED =
  import.meta.env.DEV ||
  (typeof window !== 'undefined' &&
   new URLSearchParams(window.location.search).get('debug') === '1')

// ─── FirebaseDebugPanel ────────────────────────────────────
function FirebaseDebugPanel({ user, slotIndex, debugInfo, onTestWrite, leaderboard }) {
  const [open, setOpen] = useState(false)
  const cu = auth.currentUser

  return (
    <div className="debug-panel">
      <button className="debug-panel-toggle" onClick={() => setOpen(o => !o)}>
        🛠 Firebase Debug {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="debug-panel-body">
          <div className="debug-row"><span className="debug-key">Auth Status</span><span className="debug-val">{cu ? `✅ Signed in` : '❌ No auth.currentUser'}</span></div>
          <div className="debug-row"><span className="debug-key">Firebase UID (auth)</span><span className="debug-val debug-mono">{cu?.uid ?? '—'}</span></div>
          <div className="debug-row"><span className="debug-key">User ID (app)</span><span className="debug-val debug-mono">{user?.id ?? '—'}</span></div>
          <div className="debug-row"><span className="debug-key">UID Match</span><span className="debug-val">{cu?.uid === user?.id ? '✅ match' : `⚠ MISMATCH (auth=${cu?.uid ?? 'null'} app=${user?.id})`}</span></div>
          <div className="debug-row"><span className="debug-key">Save Mode</span><span className="debug-val">{debugInfo.saveMode}</span></div>
          <div className="debug-row"><span className="debug-key">Selected Slot</span><span className="debug-val">{slotIndex ?? debugInfo.slot}</span></div>
          <div className="debug-row"><span className="debug-key">Firestore Path</span><span className="debug-val debug-mono">{debugInfo.lastPath ?? `users/${user?.id}/saveSlots/slot_${slotIndex}`}</span></div>
          <div className="debug-row"><span className="debug-key">Last Save Attempt</span><span className="debug-val">{debugInfo.lastAttempt ?? '—'}</span></div>
          <div className="debug-row"><span className="debug-key">Last Save Result</span><span className="debug-val">{debugInfo.lastResult ?? '—'}</span></div>
          {debugInfo.lastError && (
            <div className="debug-row debug-row--error"><span className="debug-key">Last Error</span><span className="debug-val debug-mono">{debugInfo.lastError}</span></div>
          )}
          {leaderboard && (
            <>
              <div className="debug-row"><span className="debug-key">Leaderboard</span><span className="debug-val">{leaderboard.profile?.leaderboardEnabled ? `✅ joined as "${leaderboard.profile.publicUsername}"` : '— not joined'}</span></div>
              <div className="debug-row"><span className="debug-key">Run ID</span><span className="debug-val debug-mono">{leaderboard.runId ?? '—'}</span></div>
              {leaderboard.profile?.leaderboardEnabled && (
                <div className="debug-row"><span className="debug-key">LB Submitted</span><span className="debug-val debug-mono">{JSON.stringify(leaderboard.profile.lastSubmitted || {})}</span></div>
              )}
            </>
          )}
          {onTestWrite && (
            <button className="debug-test-btn" onClick={onTestWrite}>
              Test Cloud Write
            </button>
          )}
          {!onTestWrite && (
            <p className="debug-note">Guest mode — using localStorage only</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Dashboard ─────────────────────────────────────────────
export default function Dashboard({ onSave, onExit, slotIndex, user, debugInfo, onTestWrite }) {
  const { state, dispatch } = useGame()
  const [activeModal,    setActiveModal]    = useState(null)
  const [winDismissed,   setWinDismissed]   = useState(false)
  const [reportOpen,     setReportOpen]     = useState(false)
  const [tutorialOpen,   setTutorialOpen]   = useState(false)
  const [tutorialAuto,   setTutorialAuto]   = useState(false)  // distinguishes auto-launch from manual ? click
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [signupOpen,      setSignupOpen]      = useState(false)
  const lbPromptedRef = useRef(false)  // session flag — only prompt to join once

  // ─── Easy-mode first-purchase coach + cross-mode equity hint ──
  // coachStep: null | 'force_invest_click' | 'force_purchase' | 'force_upgrade'
  // Forced immediately on tutorial close so no other UI (Report, etc.) can
  // sneak in between "tutorial done" and "coach active".
  const [coachStep,      setCoachStep]      = useState(null)
  const [equityHintOpen, setEquityHintOpen] = useState(false)

  useMarketRate(dispatch)
  // Fire-and-forget gameplay activity events to /api/logGameActivity.
  // Failures swallowed — never blocks rendering or dispatches anything.
  useActivityLogger(state)

  // ─── Leaderboard ──────────────────────────────────────────────
  // Leaderboard identity = signed-in Firebase uid (guests can't join).
  const isSignedIn = !!user && user.id && user.id !== 'guest'
  const lbCtx = { uid: isSignedIn ? user.id : null, saveSlotIndex: slotIndex }
  // Auto-tracking + Top-5 popup for a joined run.
  const { topFive, dismissTopFive } = useLeaderboardSync(state, dispatch, lbCtx)

  // In-game join prompt — once per session, when a signed-in player crosses
  // $1B in a run that hasn't opted into the leaderboard yet.
  useEffect(() => {
    if (lbPromptedRef.current) return
    if (!isSignedIn) return
    if (state.leaderboardProfile?.leaderboardEnabled) return
    if ((state.portfolioValue || 0) >= THRESHOLD_1B) {
      lbPromptedRef.current = true
      setSignupOpen(true)
      dispatch(setModalOpen(true))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.portfolioValue])

  function openLeaderboard() {
    dispatch(setModalOpen(true))
    setLeaderboardOpen(true)
  }
  function closeLeaderboard() {
    setLeaderboardOpen(false)
    dispatch(setModalOpen(false))
  }
  // Signup confirmed → store the profile; useLeaderboardSync detects the
  // newly-enabled profile and runs a forced backfill sync automatically.
  function handleJoinConfirm(profile) {
    dispatch(setLeaderboardProfile(profile))
    setSignupOpen(false)
    dispatch(setModalOpen(false))
  }
  function closeSignup() {
    setSignupOpen(false)
    dispatch(setModalOpen(false))
  }

  // ─── Easy-mode coach — start trigger ──────────────────────────
  // Only on Easy, only on the first run through this slot (matches the
  // tutorialSeen gate). Activates the forced Invest stage the moment the
  // tutorial closes / is skipped — no grace window, because a window let
  // the player open Report (or any other modal) and then get trapped
  // underneath the CoachOverlay when it appeared.
  useEffect(() => {
    if (coachStep !== null) return
    if (state.coachSeen) return
    if (state.difficulty !== 'easy') return
    if (!state.tutorialSeen) return
    if (state.properties.length > 0) return
    setCoachStep('force_invest_click')
    dispatch(setPaused(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tutorialSeen, state.coachSeen, state.difficulty, state.properties.length, coachStep])

  // After the forced purchase lands, advance to the forced-upgrade stage
  // and auto-open the upgrade modal for the newly purchased property.
  useEffect(() => {
    if (coachStep !== 'force_purchase') return
    if (state.properties.length < 1) return
    const newProp = state.properties[0]
    setCoachStep('force_upgrade')
    setActiveModal({ type: 'upgrade', propertyId: newProp.id })
    dispatch(setModalOpen(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachStep, state.properties.length])

  // Coach completion: any upgrade installed closes the loop — flip
  // coachSeen, unpause, close the modal.
  useEffect(() => {
    if (coachStep !== 'force_upgrade') return
    const totalUpgrades = state.properties.reduce(
      (n, p) => n + (p.completedUpgrades?.length || 0), 0,
    )
    if (totalUpgrades < 1) return
    setCoachStep(null)
    dispatch(setCoachSeen())
    dispatch(setPaused(false))
    dispatch(setModalOpen(false))
    setActiveModal(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachStep, state.properties])

  // ─── Cross-mode equity-hint popup ─────────────────────────────
  // Fires once when any owned property's max cash-out refi nets ≥ its
  // original down payment — i.e. the player could refi out everything
  // they put down and redeploy it. Click anywhere to dismiss.
  useEffect(() => {
    if (state.equityHintShown) return
    if (equityHintOpen) return
    if (state.properties.length === 0) return
    const ready = state.properties.some(p => {
      const tpl = PROPERTY_TYPES.find(t => t.id === p.templateId)
      const dpp = (tpl?.downPaymentPercent || 25) / 100
      const downPaymentPaid = (p.purchasePrice || 0) * dpp
      const netCash = getMaxRefiNetCash(p, state)
      return netCash > 0 && netCash >= downPaymentPaid
    })
    if (ready) {
      setEquityHintOpen(true)
      dispatch(setModalOpen(true))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.properties, state.equityHintShown, state.marketInterestRate])

  function dismissEquityHint() {
    setEquityHintOpen(false)
    dispatch(setModalOpen(false))
    dispatch(setEquityHintShown())
  }

  // Invest click — wraps the existing open so the coach can observe and
  // advance from the forced-pointer stage into the forced-purchase stage.
  function handleInvestClick() {
    if (coachStep === 'force_invest_click') {
      setCoachStep('force_purchase')
    }
    dispatch(openInvestModal())
    setActiveModal({ type: 'invest' })
  }

  // Auto-launch the tutorial on the first render of a brand-new game
  // (i.e. when state.tutorialSeen is false AND the player hasn't built
  // anything yet — portfolioValue > $1 means this is an in-progress game
  // that just didn't get tutorialSeen flipped, so skip the auto-launch).
  // The ? button still allows manual replay.
  useEffect(() => {
    if (!state.tutorialSeen && (state.portfolioValue ?? 0) <= 1 && !tutorialOpen) {
      setTutorialAuto(true)
      setTutorialOpen(true)
      dispatch(setModalOpen(true))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openTutorialManual() {
    setTutorialAuto(false)
    setTutorialOpen(true)
    dispatch(setModalOpen(true))
  }

  function closeTutorial(seen) {
    setTutorialOpen(false)
    if (seen && !state.tutorialSeen) dispatch(markTutorialSeen())
    dispatch(setModalOpen(false))
  }

  function openModal(config) {
    dispatch(setModalOpen(true))
    setActiveModal(config)
  }

  function closeModal() {
    // During the Easy-mode coach, modal close is driven by the state machine,
    // not the user — block stray close attempts (overlay click, Esc, etc.).
    if (coachStep === 'force_purchase' || coachStep === 'force_upgrade') return
    dispatch(setModalOpen(false))
    setActiveModal(null)
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="game-title">Equity Empire<span className="game-version">v4.0</span></h1>
        <div className="dashboard-header-actions">
          <button
            className="hdr-btn"
            onClick={openTutorialManual}
            aria-label="Help / Tutorial"
            title="Replay tutorial"
          >
            <span className="hdr-btn-icon">?</span>
          </button>
          <button
            className="hdr-btn"
            onClick={openLeaderboard}
            aria-label="Leaderboard"
            title="Leaderboard"
          >
            <span className="hdr-btn-icon">🏆</span>
          </button>
          <button
            className="hdr-btn"
            onClick={() => { dispatch(setModalOpen(true)); setReportOpen(true) }}
            aria-label="Report"
            title="Report"
            data-tutorial="action-report"
          >
            <span className="hdr-btn-icon">📋</span>
            <span className="hdr-btn-text">Report</span>
          </button>
          <button
            className="hdr-btn"
            onClick={() => document.documentElement.requestFullscreen?.()}
            aria-label="Fullscreen"
            title="Fullscreen"
          >
            <span className="hdr-btn-icon">⛶</span>
          </button>
          <button className="hdr-btn" onClick={onSave} aria-label="Save" title="Save">
            <span className="hdr-btn-icon">💾</span>
            <span className="hdr-btn-text">Save</span>
          </button>
          {onExit && (
            <button className="hdr-btn" onClick={onExit} aria-label="Exit" title="Save and return to slot selection">
              <span className="hdr-btn-icon">✕</span>
              <span className="hdr-btn-text">Exit</span>
            </button>
          )}
        </div>
      </header>

      <ActionPanel
        onInvest={handleInvestClick}
        onManage={() => openModal({ type: 'upgradeAll' })}
        onRefinance={() => openModal({ type: 'portfolioRefi' })}
        onStaff={() => openModal({ type: 'staff' })}
        onTriviaToggle={() => dispatch(toggleTrivia())}
      />

      <main className="dashboard-main">
        <PortfolioSummary />
        <AlertsPanel />
        <PropertyList
          onUpgrade={(id) => openModal({ type: 'upgrade', propertyId: id })}
          onSellRefi={(id) => openModal({ type: 'sellRefi', propertyId: id })}
        />
      </main>

      {activeModal?.type === 'invest' && (
        <InvestModal forceMode={coachStep === 'force_purchase'} onClose={closeModal} />
      )}
      {activeModal?.type === 'upgrade' && (
        <UpgradeModal
          propertyId={activeModal.propertyId}
          forceMode={coachStep === 'force_upgrade'}
          onClose={closeModal}
        />
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
          onContinue={() => { dispatch(dismissWin()); setWinDismissed(true) }}
          onExit={onExit}
        />
      )}
      {reportOpen && (
        <ReportModal onClose={() => { dispatch(setModalOpen(false)); setReportOpen(false) }} />
      )}
      {tutorialOpen && (
        <TutorialOverlay onClose={closeTutorial} showWelcome={tutorialAuto || true} />
      )}
      {leaderboardOpen && (
        <LeaderboardScreen currentRunId={state.runId} onClose={closeLeaderboard} />
      )}
      {signupOpen && isSignedIn && (
        <LeaderboardSignupModal
          uid={user.id}
          onConfirm={handleJoinConfirm}
          onClose={closeSignup}
        />
      )}
      {topFive && (
        <LeaderboardTopFiveModal
          boardType={topFive.boardType}
          rank={topFive.rank}
          onClose={dismissTopFive}
        />
      )}
      {coachStep === 'force_invest_click' && (
        <CoachOverlay
          target="action-invest"
          message="Tap Invest to make your first property purchase."
        />
      )}
      {equityHintOpen && (
        <EquityHintModal onDismiss={dismissEquityHint} />
      )}

      {debugInfo && DEBUG_PANEL_ENABLED && (
        <FirebaseDebugPanel
          user={user}
          slotIndex={slotIndex}
          debugInfo={debugInfo}
          onTestWrite={onTestWrite}
          leaderboard={{ profile: state.leaderboardProfile, runId: state.runId }}
        />
      )}
    </div>
  )
}
