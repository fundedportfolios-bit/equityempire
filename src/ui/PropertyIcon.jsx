import { useState } from 'react'
import { PROPERTY_TYPES } from '../data/propertyTypes.js'

// Renders a property/staff icon. Resolution order:
//   1. If `image` is passed and loads → show the PNG.
//   2. If `templateId` is passed, look up the template and use its iconImage / icon.
//   3. Fallback to the `emoji` glyph.
//
// templateId fallback exists because properties saved before iconImage was
// added to the data model won't have it on their instance — looking up by
// templateId guarantees the current image still shows.
//
// Usage:
//   <PropertyIcon image={property.iconImage} templateId={property.templateId} emoji={property.icon} className="ptc-icon" />
//   <PropertyIcon emoji="👤" image="/icons/staff.png" className="ptc-icon" />

export default function PropertyIcon({ emoji, image, templateId, className = '', inline = false, alt = '' }) {
  const [failed, setFailed] = useState(false)

  let resolvedImage = image
  let resolvedEmoji = emoji
  if ((!resolvedImage || !resolvedEmoji) && templateId) {
    const template = PROPERTY_TYPES.find(t => t.id === templateId)
    if (!resolvedImage) resolvedImage = template?.iconImage
    if (!resolvedEmoji) resolvedEmoji = template?.icon
  }

  if (resolvedImage && !failed) {
    return (
      <img
        src={resolvedImage}
        alt={alt || resolvedEmoji || ''}
        className={`prop-icon-img${inline ? ' prop-icon-img--inline' : ''} ${className}`}
        onError={() => setFailed(true)}
        draggable="false"
      />
    )
  }
  return <span className={className}>{resolvedEmoji}</span>
}
