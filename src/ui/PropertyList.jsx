import { useGame } from '../core/gameState.js'
import PropertyCard from './PropertyCard.jsx'

export default function PropertyList({ onUpgrade, onSellRefi }) {
  const { state } = useGame()

  return (
    <section className="property-list" data-tutorial="portfolio-list">
      <h2 className="section-title">
        Portfolio
        {state.properties.length > 0 && (
          <span className="section-count">{state.properties.length}</span>
        )}
      </h2>

      {state.properties.length === 0 ? (
        <div className="empty-state">
          <p>No properties yet.</p>
          <p className="empty-hint">Use the Invest button below to buy your first property.</p>
        </div>
      ) : (
        <div className="property-grid">
          {state.properties.map(property => (
            <PropertyCard key={property.id} property={property} onUpgrade={onUpgrade} onSellRefi={onSellRefi} />
          ))}
        </div>
      )}
    </section>
  )
}
