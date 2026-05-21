import { useState, useEffect } from 'react'
import {
  validateUsername, checkUsernameAvailability,
  reserveUsername, getUserExistingUsernames, makeFreshProfile,
} from '../systems/leaderboardSystem.js'

// Username signup for a save slot opting into the leaderboard.
// Props:
//   uid        — the signed-in Firebase uid (required; guests can't reach here)
//   onConfirm  — (profile) => void  — receives a fresh leaderboardProfile
//   onClose    — () => void
//
// On confirm: validates the name, checks availability, reserves it under this
// uid, then hands a fresh profile back to the caller (which dispatches it +
// runs the backfill sync).

export default function LeaderboardSignupModal({ uid, onConfirm, onClose }) {
  const [existing,   setExisting]   = useState([])   // usernames this uid already owns
  const [mode,       setMode]       = useState('new') // 'new' | 'existing'
  const [chosenExisting, setChosenExisting] = useState('')
  const [username,   setUsername]   = useState('')
  const [error,      setError]      = useState('')
  const [busy,       setBusy]       = useState(false)

  useEffect(() => {
    let cancelled = false
    getUserExistingUsernames(uid).then(list => {
      if (cancelled) return
      setExisting(list)
      if (list.length > 0) { setMode('existing'); setChosenExisting(list[0]) }
    })
    return () => { cancelled = true }
  }, [uid])

  async function handleConfirm() {
    setError('')
    // Path A — reuse an existing username this uid already reserved.
    if (mode === 'existing' && chosenExisting) {
      const v = validateUsername(chosenExisting)
      if (!v.ok) { setError(v.error); return }
      setBusy(true)
      try {
        await reserveUsername(v.usernameLower, v.value, uid)  // re-confirm ownership
        onConfirm(makeFreshProfile({ username: v.value, usernameLower: v.usernameLower }))
      } catch (e) {
        setError('Could not join the leaderboard. Please try again.')
        console.warn('[leaderboard] join failed:', e?.message)
        setBusy(false)
      }
      return
    }

    // Path B — claim a new username.
    const v = validateUsername(username)
    if (!v.ok) { setError(v.error); return }
    setBusy(true)
    try {
      const avail = await checkUsernameAvailability(v.usernameLower, uid)
      if (!avail.available) {
        setError('That username is already taken. Please choose another.')
        setBusy(false)
        return
      }
      await reserveUsername(v.usernameLower, v.value, uid)
      onConfirm(makeFreshProfile({ username: v.value, usernameLower: v.usernameLower }))
    } catch (e) {
      setError('Could not join the leaderboard. Please try again.')
      console.warn('[leaderboard] join failed:', e?.message)
      setBusy(false)
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-sheet lb-signup-sheet">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">🏆 Join the Leaderboard</h2>
            <p className="modal-subtitle">Pick a public username for this save</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          <p className="lb-signup-body">
            Your username is shown publicly on the leaderboard. Your real name and
            email are never shown. This save will then track automatically toward
            Fastest to $1B, Fastest to $10B, and Biggest Empire Ever.
          </p>

          {existing.length > 0 && (
            <div className="lb-signup-mode">
              <label className="report-form-checkbox">
                <input type="radio" name="lb-mode" checked={mode === 'existing'}
                  onChange={() => setMode('existing')} />
                <span>Use one of my usernames</span>
              </label>
              {mode === 'existing' && (
                <select
                  className="report-form-input lb-signup-existing-select"
                  value={chosenExisting}
                  onChange={e => setChosenExisting(e.target.value)}
                >
                  {existing.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              )}
              <label className="report-form-checkbox">
                <input type="radio" name="lb-mode" checked={mode === 'new'}
                  onChange={() => setMode('new')} />
                <span>Choose a different username for this run</span>
              </label>
            </div>
          )}

          {mode === 'new' && (
            <div className="report-form-row">
              <label htmlFor="lb-username" className="report-form-label">Public username *</label>
              <input
                id="lb-username"
                type="text"
                className="report-form-input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="3–20 characters"
                maxLength={20}
                autoComplete="off"
              />
              <span className="report-form-hint">Letters, numbers, spaces, and underscores.</span>
            </div>
          )}

          {error && <p className="report-form-error">{error}</p>}

          <div className="win-actions report-request-actions">
            <button className="win-btn-share" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="win-btn-continue" onClick={handleConfirm} disabled={busy}>
              {busy ? 'Joining…' : 'Join Leaderboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
