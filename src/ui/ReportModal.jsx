import { useState } from 'react'
import { useGame } from '../core/gameState.js'
import { createReportPayload } from '../systems/reportingSystem.js'
import { auth } from '../firebase/config.js'
import { logActivity, logSnapshot } from '../services/logGameActivity.js'

// Player-facing detailed-report request form. The player enters a name +
// email and a contact preference (radio, default = report only). On submit
// we build the structured payload from current game state and POST it to
// /api/sendReport, which emails the detailed report to the player (and a
// lead notification to the owner ONLY when requestSupport is chosen).
//
// The player never sees raw payload JSON, backend logs, or the internal
// owner address.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ReportModal({ onClose }) {
  const { state } = useGame()

  const [name,    setName]    = useState('')
  const [email,   setEmail]   = useState('')
  const [pref,    setPref]    = useState('reportOnly') // default per spec
  const [errors,  setErrors]  = useState({})
  const [status,  setStatus]  = useState('idle')       // idle | sending | sent | error
  const [sendErr, setSendErr] = useState('')

  function validate() {
    const next = {}
    if (!name.trim())                              next.name  = 'Please enter your name.'
    if (!email.trim() || !EMAIL_RE.test(email))    next.email = 'Please enter a valid email.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e) {
    e?.preventDefault?.()
    if (status === 'sending') return
    if (!validate()) return

    setStatus('sending')
    setSendErr('')

    const payload = createReportPayload(state, {})
    // Ready for future Firestore lead storage (backend persists when set up).
    payload.firebaseUid = auth?.currentUser?.uid || null

    try {
      const res = await fetch('/api/sendReport', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          player:            { name: name.trim(), email: email.trim() },
          contactPreference: pref,
          payload,
        }),
      })
      const data = await res.json().catch(() => ({ ok: false }))
      if (data?.ok) {
        setStatus('sent')
        // Fire activity events (fire-and-forget; never blocks the success UI).
        const supportFlag = pref === 'requestSupport'
        logActivity('report_requested', {
          state,
          playerName:        name.trim(),
          playerEmail:       email.trim(),
          contactPreference: pref,
          requestedSupport:  supportFlag,
        })
        if (supportFlag) {
          logActivity('support_requested', {
            state,
            playerName:        name.trim(),
            playerEmail:       email.trim(),
            contactPreference: pref,
            requestedSupport:  true,
          })
        }
        logSnapshot(state, { force: true })
      } else {
        setStatus('error')
        setSendErr(data?.error || 'Something went wrong. Please try again.')
      }
    } catch {
      setStatus('error')
      setSendErr('Could not reach the report service. Please try again.')
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="win-overlay report-overlay" onClick={handleOverlayClick}>
      <div className="win-modal report-modal report-request-modal">
        <button className="modal-close-btn report-close-btn" onClick={onClose} aria-label="Close">×</button>

        {status === 'sent' ? (
          <>
            <div className="win-confetti-row">📬 ✅</div>
            <h1 className="win-title report-title">Report On The Way</h1>
            <p className="report-request-body">
              Your detailed report is on the way. Try checking your spam if you
              don't see it soon.
            </p>
            {pref === 'requestSupport' && (
              <p className="report-request-body">
                Since you asked for help applying this to real world investing,
                someone from Funded Portfolios may follow up.
              </p>
            )}
            <div className="win-actions">
              <button className="win-btn-continue" onClick={onClose}>Resume Game</button>
            </div>
          </>
        ) : (
          <>
            <h1 className="win-title report-title">Request Detailed Report</h1>
            <p className="report-request-body">
              This feature sends you a detailed summary of your game results,
              including portfolio growth, cash flow, milestones, property moves,
              refinances, upgrades, and staffing choices.
            </p>
            <p className="report-request-notice">
              Your email will only be used to send this report unless you
              explicitly ask for follow up below. No spam. No surprise sales emails.
            </p>

            <form className="report-request-form" onSubmit={handleSubmit} noValidate>
              <div className="report-form-row">
                <label htmlFor="rpt-name" className="report-form-label">Name *</label>
                <input
                  id="rpt-name"
                  type="text"
                  className="report-form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  placeholder="Your name"
                  disabled={status === 'sending'}
                />
                {errors.name && <span className="report-form-error">{errors.name}</span>}
              </div>

              <div className="report-form-row">
                <label htmlFor="rpt-email" className="report-form-label">Email *</label>
                <input
                  id="rpt-email"
                  type="email"
                  className="report-form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  disabled={status === 'sending'}
                />
                {errors.email && <span className="report-form-error">{errors.email}</span>}
              </div>

              <div className="report-form-row">
                <span className="report-form-label">Contact preference</span>
                <label className="report-form-radio">
                  <input
                    type="radio"
                    name="contactPreference"
                    value="reportOnly"
                    checked={pref === 'reportOnly'}
                    onChange={() => setPref('reportOnly')}
                    disabled={status === 'sending'}
                  />
                  <span>I don't need investing help. But I'll take a free report!</span>
                </label>
                <label className="report-form-radio">
                  <input
                    type="radio"
                    name="contactPreference"
                    value="requestSupport"
                    checked={pref === 'requestSupport'}
                    onChange={() => setPref('requestSupport')}
                    disabled={status === 'sending'}
                  />
                  <span>I'm building a portfolio and have real questions. Somebody email me, please.</span>
                </label>
              </div>

              {status === 'error' && (
                <p className="report-form-error report-form-error--block">{sendErr}</p>
              )}

              <div className="win-actions report-request-actions">
                <button
                  type="button"
                  className="win-btn-share"
                  onClick={onClose}
                  disabled={status === 'sending'}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="win-btn-continue"
                  disabled={status === 'sending'}
                >
                  {status === 'sending' ? 'Sending…' : 'Send My Report'}
                </button>
              </div>
            </form>

            <p className="report-form-disclaimer">
              <strong>Important disclaimer:</strong> Equity Empire is a game and
              educational tool. Your report is based on gameplay results and is
              not investment, tax, legal, or lending advice.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
