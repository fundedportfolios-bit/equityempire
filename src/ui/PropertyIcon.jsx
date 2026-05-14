import { useState } from 'react'

// Renders a property/staff icon. If `image` is provided AND loads successfully,
// shows the PNG. Otherwise (no image given, or the image 404s) falls back to
// the emoji glyph. The wrapper preserves any existing class so call sites can
// keep using their layout classes.
//
// Usage:
//   <PropertyIcon emoji={property.icon} image={property.iconImage} className="ptc-icon" />
//   <PropertyIcon emoji="👤" image="/icons/staff.png" className="ptc-icon" inline />

export default function PropertyIcon({ emoji, image, className = '', inline = false, alt = '' }) {
  const [failed, setFailed] = useState(false)

  if (image && !failed) {
    return (
      <img
        src={image}
        alt={alt || emoji || ''}
        className={`prop-icon-img${inline ? ' prop-icon-img--inline' : ''} ${className}`}
        onError={() => setFailed(true)}
        draggable="false"
      />
    )
  }
  return <span className={className}>{emoji}</span>
}
