import { useEffect } from 'react'
import { setMarketRate } from '../core/gameEngine.js'

const CACHE_KEY = 'equity_empire_pmms'
const FALLBACK  = 0.0678  // 6.78% — updated periodically as market moves

export function useMarketRate(dispatch) {
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)

    // Use cached rate if it's from today
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      if (cached?.date === today && typeof cached.rate === 'number') {
        dispatch(setMarketRate(cached.rate))
        return
      }
    } catch {}

    // Try live fetch from FRED (requires free API key in .env as VITE_FRED_API_KEY)
    const apiKey = import.meta.env.VITE_FRED_API_KEY
    if (!apiKey) {
      dispatch(setMarketRate(FALLBACK))
      return
    }

    fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=MORTGAGE30US&file_type=json&limit=1&sort_order=desc&api_key=${apiKey}`
    )
      .then(r => r.json())
      .then(data => {
        const val = parseFloat(data.observations?.[0]?.value)
        if (isNaN(val) || val <= 0) throw new Error('Invalid rate')
        const rate = val / 100
        localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, rate }))
        dispatch(setMarketRate(rate))
      })
      .catch(() => dispatch(setMarketRate(FALLBACK)))
  }, [])   // run once on mount
}
