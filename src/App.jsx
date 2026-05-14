import { useState, useEffect, useRef }                  from 'react'
import { onAuthStateChanged }                           from 'firebase/auth'
import { auth }                                         from './firebase/config.js'
import { GameProvider, useGame }                        from './core/gameState.js'
import { startNewGame }                                 from './core/gameEngine.js'
import { getStoredUser, storeUser, clearStoredUser,
         getSlot, setSlot }                             from './auth/saveSlots.js'
import { loadSlotFromFirestore, saveSlotToFirestore,
         testCloudWriteToFirestore }                    from './firebase/firestoreService.js'
import LoginScreen                                      from './ui/LoginScreen.jsx'
import SlotScreen                                       from './ui/SlotScreen.jsx'
import Dashboard                                        from './ui/Dashboard.jsx'

const isCloudUser = (user) => user?.id && user.id !== 'guest'

// ─── GameInSlot ────────────────────────────────────────────────────────────
// Loads or starts a game then renders Dashboard.
// Auto-saves to Firestore after every month advance and property purchase
// (for signed-in users). Guest saves remain localStorage-only.

function GameInSlot({ user, slotIndex, isNew, difficulty, cashFlowGoal, onExit }) {
  const { state, dispatch } = useGame()
  const [ready, setReady]   = useState(false)
  const cloud               = isCloudUser(user)

  // Debug panel state
  const [debugInfo, setDebugInfo] = useState({
    saveMode:    cloud ? 'Firestore' : 'localStorage',
    uid:         user.id,
    slot:        slotIndex,
    lastAttempt: null,
    lastResult:  null,
    lastError:   null,
    lastPath:    null,
  })

  // Auto-save refs
  const autoSaveTimerRef  = useRef(null)
  const hasInitializedRef = useRef(false)

  // ── Load / start game ────────────────────────────────────
  useEffect(() => {
    async function init() {
      const goal = cashFlowGoal || 10000
      console.log('[GameInSlot] init —', { uid: user.id, slotIndex, isNew, cloud, difficulty, goal })

      if (isNew) {
        dispatch(startNewGame(difficulty || 'medium', goal))
      } else if (cloud) {
        try {
          const slot = await loadSlotFromFirestore(user.id, slotIndex)
          if (slot?.state) {
            console.log('[GameInSlot] Loaded cloud save for slot', slotIndex, '— currentMonth:', slot.state.currentMonth)
            dispatch({ type: 'LOAD_GAME', payload: { savedState: slot.state, cashFlowGoal: goal } })
          } else {
            console.log('[GameInSlot] No cloud save found in slot', slotIndex, '— starting new game.')
            dispatch(startNewGame(difficulty || 'medium', goal))
          }
        } catch (e) {
          console.error('[GameInSlot] Cloud load failed — starting new game so play is not blocked. Error:', e)
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
  useEffect(() => {
    if (!ready || !cloud) return
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      return
    }
    clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      console.log('[GameInSlot] Auto-save triggered — month:', state.currentMonth, '| properties:', state.properties.length)
      saveSlotToFirestore(user.id, slotIndex, state)
        .catch(e => console.error('[GameInSlot] Auto-save failed:', e))
    }, 800)
    return () => clearTimeout(autoSaveTimerRef.current)
  }, [state.currentMonth, state.properties.length])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual save (Save button) ────────────────────────────
  async function handleSave() {
    const path = cloud ? `users/${user.id}/saveSlots/slot_${slotIndex}` : 'localStorage'
    console.log('[GameInSlot] Manual save requested — cloud:', cloud, '| uid:', user.id)
    setDebugInfo(prev => ({ ...prev, lastAttempt: new Date().toISOString(), lastPath: path, lastError: null }))
    if (cloud) {
      try {
        await saveSlotToFirestore(user.id, slotIndex, state)
        setDebugInfo(prev => ({ ...prev, lastResult: '✅ SUCCESS' }))
      } catch (e) {
        console.error('[GameInSlot] Manual save failed:', e)
        setDebugInfo(prev => ({ ...prev, lastResult: '❌ FAILED', lastError: `${e.code ?? 'error'}: ${e.message}` }))
        alert(`Cloud save failed: ${e.message}\n\nCheck the console for details.`)
      }
    } else {
      setSlot(user.id, slotIndex, state)
      setDebugInfo(prev => ({ ...prev, lastResult: '✅ localStorage OK' }))
    }
  }

  // ── Exit (saves first) ───────────────────────────────────
  async function handleExit() {
    const path = cloud ? `users/${user.id}/saveSlots/slot_${slotIndex}` : 'localStorage'
    console.log('[GameInSlot] Exit requested — cloud:', cloud, '| uid:', user.id)
    setDebugInfo(prev => ({ ...prev, lastAttempt: new Date().toISOString(), lastPath: path, lastError: null }))
    if (cloud) {
      try {
        await saveSlotToFirestore(user.id, slotIndex, state)
        setDebugInfo(prev => ({ ...prev, lastResult: '✅ SUCCESS (on exit)' }))
      } catch (e) {
        console.error('[GameInSlot] Save on exit failed:', e)
        setDebugInfo(prev => ({ ...prev, lastResult: '❌ FAILED (on exit)', lastError: `${e.code ?? 'error'}: ${e.message}` }))
      }
    } else {
      setSlot(user.id, slotIndex, state)
    }
    onExit()
  }

  // ── Test cloud write (debug) ─────────────────────────────
  async function handleTestWrite() {
    const path = `users/${user.id}/debug/testWrite`
    console.log('[GameInSlot] Test cloud write — uid:', user.id)
    setDebugInfo(prev => ({ ...prev, lastAttempt: new Date().toISOString(), lastPath: path, lastError: null, lastResult: '⏳ writing…' }))
    try {
      const result = await testCloudWriteToFirestore(user.id)
      setDebugInfo(prev => ({ ...prev, lastResult: `✅ TEST SUCCESS → ${result.path}` }))
    } catch (e) {
      setDebugInfo(prev => ({ ...prev, lastResult: '❌ TEST FAILED', lastError: `${e.code ?? 'error'}: ${e.message}` }))
    }
  }

  if (!ready || !state.gameStarted) return (
    <div className="loading-screen">
      <p className="loading-text">Loading…</p>
    </div>
  )

  return (
    <Dashboard
      onSave={handleSave}
      onExit={handleExit}
      slotIndex={slotIndex}
      user={user}
      debugInfo={debugInfo}
      onTestWrite={cloud ? handleTestWrite : null}
    />
  )
}

// ─── AppContent ────────────────────────────────────────────────────────────
// On mount we wait for Firebase Auth to rehydrate (it's async after a page
// reload). Only after onAuthStateChanged has fired at least once do we
// commit to a user value and unblock the rest of the app — otherwise we'd
// hit Firestore with auth.currentUser === null and get a rules denial.

function AppContent() {
  const [user,       setUser]      = useState(() => getStoredUser())
  const [authReady,  setAuthReady] = useState(false)
  const [activeSlot, setActiveSlot] = useState(null)

  useEffect(() => {
    console.log('[Auth] Subscribing to onAuthStateChanged. Initial stored user:', getStoredUser())
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      const stored = getStoredUser()
      console.log('[Auth] onAuthStateChanged fired:', {
        firebaseUser: firebaseUser ? {
          uid:           firebaseUser.uid,
          email:         firebaseUser.email,
          displayName:   firebaseUser.displayName,
          isAnonymous:   firebaseUser.isAnonymous,
          emailVerified: firebaseUser.emailVerified,
        } : null,
        storedUser: stored,
      })

      if (firebaseUser) {
        // Firebase confirms an authenticated user — use the Firebase UID.
        const u = {
          id:      firebaseUser.uid,
          name:    firebaseUser.displayName ?? stored?.name ?? 'User',
          email:   firebaseUser.email,
          picture: firebaseUser.photoURL,
        }
        storeUser(u)
        setUser(u)
        console.log('[Auth] User set from Firebase Auth. uid =', u.id)
      } else if (stored?.id === 'guest') {
        // Guest mode — Firebase auth.currentUser will always be null here.
        console.log('[Auth] No Firebase user; guest mode active.')
        setUser(stored)
      } else if (stored) {
        // Had a stored signed-in user but Firebase Auth says nobody is
        // logged in. The token expired or was revoked — clear the stale
        // localStorage entry so the user gets the login screen.
        console.warn('[Auth] Stored Firebase user but auth.currentUser is null — clearing stale session.')
        clearStoredUser()
        setUser(null)
      } else {
        setUser(null)
      }
      setAuthReady(true)
    })
    return unsub
  }, [])

  function handleLogin(loggedInUser) {
    console.log('[Auth] handleLogin called with:', loggedInUser)
    storeUser(loggedInUser)
    setUser(loggedInUser)
  }

  function handleLogout() {
    console.log('[Auth] handleLogout called')
    clearStoredUser()
    setUser(null)
    setActiveSlot(null)
  }

  // Don't render UI until we know the Firebase Auth state — prevents
  // making Firestore calls before currentUser is populated.
  if (!authReady) return (
    <div className="loading-screen">
      <p className="loading-text">Restoring session…</p>
    </div>
  )

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
