import { useState, useEffect } from 'react'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { GameProvider, useGame } from './core/gameState.js'
import { startNewGame } from './core/gameEngine.js'
import { getStoredUser, storeUser, clearStoredUser, getSlot, setSlot } from './auth/saveSlots.js'
import LoginScreen from './ui/LoginScreen.jsx'
import SlotScreen from './ui/SlotScreen.jsx'
import Dashboard from './ui/Dashboard.jsx'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

// Sits inside GameProvider — loads or starts the game then renders Dashboard
function GameInSlot({ user, slotIndex, isNew, difficulty, cashFlowGoal, onExit }) {
  const { state, dispatch } = useGame()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const goal = cashFlowGoal || 10000
    if (isNew) {
      dispatch(startNewGame(difficulty || 'medium', goal))
    } else {
      const slot = getSlot(user.id, slotIndex)
      if (slot?.state) {
        dispatch({ type: 'LOAD_GAME', payload: { savedState: slot.state, cashFlowGoal: goal } })
      } else {
        dispatch(startNewGame(difficulty || 'medium', goal))
      }
    }
    setReady(true)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || !state.gameStarted) return (
    <div className="loading-screen">
      <p className="loading-text">Loading…</p>
    </div>
  )

  function handleSave() {
    setSlot(user.id, slotIndex, state)
  }

  function handleExit() {
    setSlot(user.id, slotIndex, state)  // auto-save on exit
    onExit()
  }

  return <Dashboard onSave={handleSave} onExit={handleExit} slotIndex={slotIndex} />
}

function AppContent() {
  const [user,       setUser]       = useState(() => getStoredUser())
  const [activeSlot, setActiveSlot] = useState(null)  // { slotIndex, isNew, difficulty }

  function handleLogin(googleUser) {
    storeUser(googleUser)
    setUser(googleUser)
  }

  function handleLogout() {
    clearStoredUser()
    setUser(null)
    setActiveSlot(null)
  }

  if (!user) return <LoginScreen onLogin={handleLogin} />

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

export default function App() {
  // If no Client ID configured, still render — LoginScreen shows setup instructions
  if (!GOOGLE_CLIENT_ID) {
    return (
      <GoogleOAuthProvider clientId="placeholder">
        <AppContent />
      </GoogleOAuthProvider>
    )
  }
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AppContent />
    </GoogleOAuthProvider>
  )
}
