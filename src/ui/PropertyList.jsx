import { useMemo } from 'react'
import { useGame } from '../core/gameState.js'
import PropertyCard from './PropertyCard.jsx'

export default function PropertyList({ onUpgrade, onSellRefi }) {
  const { state } = useGame()

  // Sort by months owned ascending so newest properties (lowest monthsOwned)
  // surface at the top of the list. Stable secondary sort by id keeps ties
  // consistent across renders.
  const sorted = useMemo(() => {
    return [...state.properties].sort((a, b) => {
      const ma = a.monthsOwned ?? 0
      const mb = b.monthsOwned ?? 0
      if (ma !== mb) return ma - mb
      return (a.id || '').localeCompare(b.id || '')
    })
  }, [state.properties])

  return (
    <section className="property-list" data-tutorial="portfolio-list">
      <h2 className="section-title">
        Portfolio
        {sorted.length > 0 && (
          <span className="section-count">{sorted.length}</span>
        )}
      </h2>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No properties yet.</p>
          <p className="empty-hint">Use the Invest button below to buy your first property.</p>
        </div>
      ) : (
        <div className="property-grid">
          {sorted.map(property => (
            <PropertyCard key={property.id} property={property} onUpgrade={onUpgrade} onSellRefi={onSellRefi} />
          ))}
        </div>
      )}
    </section>
  )
}
