import { GoogleLogin } from '@react-oauth/google'
import { decodeGoogleJwt } from '../auth/saveSlots.js'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

export default function LoginScreen({ onLogin }) {
  function handleSuccess(response) {
    const payload = decodeGoogleJwt(response.credential)
    if (!payload) return
    onLogin({ id: payload.sub, name: payload.name, email: payload.email, picture: payload.picture })
  }

  function handleGuest() {
    onLogin({ id: 'guest', name: 'Guest', email: null, picture: null })
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Equity Empire<span className="game-version">v3.1</span></h1>
        <p className="login-tagline">
          Build a real estate portfolio from the ground up.<br />
          Balance cash flow, debt, equity, and opportunity.
        </p>

        <div className="login-divider" />

        {CLIENT_ID ? (
          <div className="login-google-wrap">
            <p className="login-prompt">Sign in to save your progress</p>
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => {}}
              theme="filled_black"
              shape="pill"
              text="signin_with"
            />
          </div>
        ) : (
          <div className="login-setup-notice">
            <p className="login-setup-title">Google login not configured</p>
            <p className="login-setup-body">
              Add <code>VITE_GOOGLE_CLIENT_ID=your_client_id</code> to a <code>.env</code> file
              in the project root, then restart the dev server. Create a Client ID at{' '}
              <strong>console.cloud.google.com</strong> → APIs &amp; Services → Credentials.
            </p>
          </div>
        )}

        <div className="login-guest-section">
          <button className="btn btn-ghost login-guest-btn" onClick={handleGuest}>
            Play as Guest
          </button>
          <p className="login-guest-warning">
            ⚠ Guest progress is stored only in this browser. Clearing your browser data,
            switching devices, or using a private window will erase your saves.
          </p>
        </div>
      </div>
    </div>
  )
}
