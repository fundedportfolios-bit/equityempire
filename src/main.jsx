import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
// Side-effect imports: expose debug helpers in the dev console
import './debug/incomeCalibration.js'
import './debug/valuationDebug.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
