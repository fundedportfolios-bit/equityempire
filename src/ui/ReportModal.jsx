import { useState } from 'react'
import { useGame } from '../core/gameState.js'
import { submitReportRequest } from '../core/gameEngine.js'

// The full detailed report will be delivered via email once the delivery
// pipeline is connected. For now this modal collects the player's name,
// email, optional cash-flow goal, and consent. The actual report payload
// is built reducer-side via reportingSystem.createReportPayload and stashed
// in state.reporting.reportRequests for later replay/inspection.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ReportModal({ onClose }) {
  const { state, dispatch } = useGame()

  const initialGoal = state.reporting?.playerGoals?.desiredMonthlyCashFlow
                      ?? state.cashFlowGoal
                      ?? ''

  const [name,              setName]              = useState('')
  const [email,             setEmail]             = useState('')
  const [desiredCF,         setDesiredCF]         = useState(String(initialGoal || ''))
  const [consentEmail,      setConsentEmail]      = useState(true)
  const [consentFollowUp,   setConsentFollowUp]   = useState(false)
  const [errors,            setErrors]            = useState({})
  const [submitted,         setSubmitted]         = useState(false)

  function validate() {
    const next = {}
    if (!name.trim())                          next.name = 'Please enter your name.'
    if (!email.trim() || !EMAIL_RE.test(email)) next.email = 'Please enter a valid email.'
    if (!consentEmail)                         next.consentEmail = 'You must agree to receive the report email.'
    if (desiredCF && Number.isNaN(Number(desiredCF))) next.desiredCF = 'Enter a number.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(e) {
    e?.preventDefault?.()
    if (!validate()) return
    const goalNum = desiredCF ? Number(desiredCF) : null
    dispatch(submitReportRequest({
      name:                    name.trim(),
      email:                   email.trim(),
      desiredMonthlyCashFlow:  goalNum,
      consentToEmailReport:    consentEmail,
      consentToFollowUp:       consentFollowUp,
    }))
    setSubmitted(true)
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="win-overlay report-overlay" onClick={handleOverlayClick}>
      <div className="win-modal report-modal report-request-modal">
        <button className="modal-close-btn report-close-btn" onClick={onClose} aria-label="Close">×</button>

        {!submitted ? (
          <>
            <h1 className="win-title report-title">Get Your Gameplay Report</h1>
            <p className="report-request-body">
              Enter your name and email and we'll prepare a detailed report showing
              how you built your portfolio, grew cash flow, used debt, hit milestones,
              and scaled your original cash.
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
                />
                {errors.email && <span className="report-form-error">{errors.email}</span>}
              </div>

              <div className="report-form-row">
                <label htmlFor="rpt-cf" className="report-form-label">
                  Desired monthly cash flow goal <span className="report-form-hint">(optional)</span>
                </label>
                <input
                  id="rpt-cf"
                  type="number"
                  inputMode="numeric"
                  className="report-form-input"
                  value={desiredCF}
                  onChange={(e) => setDesiredCF(e.target.value)}
                  placeholder="10000"
                />
                {errors.desiredCF && <span className="report-form-error">{errors.desiredCF}</span>}
              </div>

              <div className="report-form-row report-form-row--checkbox">
                <label className="report-form-checkbox">
                  <input
                    type="checkbox"
                    checked={consentEmail}
                    onChange={(e) => setConsentEmail(e.target.checked)}
                  />
                  <span>Send me my gameplay report by email *</span>
                </label>
                {errors.consentEmail && <span className="report-form-error">{errors.consentEmail}</span>}
              </div>

              <div className="report-form-row report-form-row--checkbox">
                <label className="report-form-checkbox">
                  <input
                    type="checkbox"
                    checked={consentFollowUp}
                    onChange={(e) => setConsentFollowUp(e.target.checked)}
                  />
                  <span>Send me occasional real estate investing resources</span>
                </label>
              </div>

              <div className="win-actions report-request-actions">
                <button type="button" className="win-btn-share" onClick={onClose}>Cancel</button>
                <button type="submit" className="win-btn-continue">Send My Report</button>
              </div>
            </form>

            <p className="report-form-disclaimer">
              Email delivery is coming soon. We'll save your report data now and
              send it as soon as the delivery system is connected.
            </p>
          </>
        ) : (
          <>
            <div className="win-confetti-row">📬 ✅</div>
            <h1 className="win-title report-title">Report Request Saved</h1>
            <p className="report-request-body">
              Thanks, <strong>{name}</strong>. We've saved your gameplay snapshot.
              Email delivery will be connected next, and your full report will
              be sent to <strong>{email}</strong>.
            </p>
            <div className="win-actions">
              <button className="win-btn-continue" onClick={onClose}>Resume Game</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
