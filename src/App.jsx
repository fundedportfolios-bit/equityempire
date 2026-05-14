import { useState, useEffect, useRef }                  from 'react'
import { GameProvider, useGame }                         from './core/gameState.js'
import { startNewGame }                                  from './core/gameEngine.js'
import { getStoredUser, storeUser, clearStoredUser,
         getSlot, setSlot }                              from './auth/saveSlots.js'
import { loadSlotFromFirestore, saveSlotToFirestore }    from './firebase/firestoreService.js'
import LoginScreen                                       from './ui/LoginScreen.jsx'
import SlotScreen                                        from './ui/SlotScreen.jsx'
import Dashboard                                         from './ui/Dashboard.jsx'

const isCloudUser = (user) => user?.id && user.id !== 'guest'

// ─── GameInSlot ────────────────────────────────────────────────────────────
// Loads or starts a game then renders Dashboard.
// Auto-saves to Firestore after every month advance and property purchase
// (for signed-in users). Guest saves remain localStorage-only.

function GameInSlot({ user, slotIndex, isNew, difficulty, cashFlowGoal, onExit }) {
  const { state, dispatch } = useGame()
  const [ready, setReady]   = useState(false)
  const cloud               = isCloudUser(user)

  // Auto-save refs
  const autoSaveTimerRef  = useRef(null)
  const hasInitializedRef = useRef(false)   // skip the first trigger on mount

  // ── Load / start game ────────────────────────────────────
  useEffect(() => {
    async function init() {
      const goal = cashFlowGoal || 10000
      if (isNew) {
        dispatch(startNewGame(difficulty || 'medium', goal))
      } else if (cloud) {
        // Load from Firestore; fall back to startNewGame if empty
        const slot = await loadSlotFromFirestore(user.id, slotIndex)
        if (slot?.state) {
          dispatch({ type: 'LOAD_GAME', payload: { savedState: slot.state, cashFlowGoal: goal } })
        } else {
          dispatch(startNewGame(difficulty || 'medium', goal))
        }
      } else {
        // Guest — local storage
        const slot = getSlot(user.id, slotIndex)
        if (slot?.state) {
          dispatch({ type: 'LOAD_GAME', payload: { savedState: slot.state, cashFlowGoal: goal } })
        } else {
          dispatch(startNewGame(difficulty || 'medium', goal))
        }
      }
      setReady(true)
    }
    init()
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save on month advance or property acquisition ───
  // state.currentMonth rises on ADVANCE_MONTH
  // state.properties.length rises on BUY_PROPERTY
  // We skip the very first fire (initialization) with hasInitializedRef.
  useEffect(() => {
    if (!ready || !cloud) return
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      return
    }
    // Debounce: wait 800 ms in case multiple triggers fire in quick succession
    clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveSlotToFirestore(user.id, slotIndex, state).catch(console.error)
    }, 800)
    return () => clearTimeout(autoSaveTimerRef.current)
  }, [state.currentMonth, state.properties.length])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual save (Save button) ────────────────────────────
  async function handleSave() {
    if (cloud) {
      await saveSlotToFirestore(user.id, slotIndex, state)
    } else {
      setSlot(user.id, slotIndex, state)
    }
  }

  // ── Exit (saves first) ───────────────────────────────────
  async function handleExit() {
    if (cloud) {
      await saveSlotToFirestore(user.id, slotIndex, state)
    } else {
      setSlot(user.id, slotIndex, state)
    }
    onExit()
  }

  if (!ready || !state.gameStarted) return (
    <div className="loading-screen">
      <p className="loading-text">Loading…</p>
    </div>
  )

  return <Dashboard onSave={handleSave} onExit={handleExit} slotIndex={slotIndex} />
}

// ─── AppContent ────────────────────────────────────────────────────────────

function AppContent() {
  const [user,        setUser]       = useState(() => getStoredUser())
  const [activeSlot,  setActiveSlot] = useState(null)

  function handleLogin(firebaseUser) {
    // Store minimal user info locally so the app remembers who is logged in on reload
    storeUser(firebaseUser)
    setUser(firebaseUser)
  }

  function handleLogout() {
    clearStoredUser()
    setUser(null)
    setActiveSlot(null)
  }

  if (!user)       return <LoginScreen onLogin={handleLogin} />
  if (!activeSlot) return (
    <SlotScreen
      user={user}
      onSelectSlot={setActiveSlot}
      onLogout={handleLogout}
    />
  )

  return (
    <GameProvider key={activeSlot.slotIndex}>
      <GameInSlot
        user={user}
        slotIndex={activeSlot.slotIndex}
        isNew={activeSlot.isNew}
        difficulty={activeSlot.difficulty}
        cashFlowGoal={activeSlot.cashFlowGoal}
        onExit={() => setActiveSlot(null)}
      />
    </GameProvider>
  )
}

// ─── App ───────────────────────────────────────────────────────────────────

export default function App() {
  return <AppContent />
}
