/**
 * src/components/driver/NavigateButton.tsx
 *
 * Large navigation CTA used on the driver stop detail screen.
 *
 * Shows:
 *   - Static map thumbnail (Google Static Maps API)
 *   - "Navigate to stop" primary button
 *   - Customer name + formatted address below the button
 *   - iOS / Android platform-aware navigation links
 *
 * When lat/lng are unavailable the button is disabled and only the
 * street address is shown (driver can still copy/paste it).
 */

import { useState } from 'react'
import { GOOGLE_MAPS_API_KEY, hasUsableGoogleMapsKey } from '../../lib/env'
import {
  openGoogleMapsNavigation,
  openAppleMapsNavigation,
  staticMapThumbnailUrl,
  isIOS,
} from '../../utils/navigation'
import { formatAddress } from '../../utils/addressUtils'

const COLOR_BRAND   = '#0066FF'
const COLOR_WHITE   = '#ffffff'
const COLOR_BORDER  = '#e5e7eb'
const COLOR_TEXT_2  = '#6b7280'
const COLOR_DISABLED_BG = '#f3f4f6'
const COLOR_DISABLED_TEXT = '#9ca3af'

export interface NavigateButtonProps {
  customerName: string
  address:      string
  city:         string
  state:        string
  zip:          string
  lat?:         number
  lng?:         number
}

export function NavigateButton({
  customerName,
  address,
  city,
  state,
  zip,
  lat,
  lng,
}: NavigateButtonProps) {
  const hasCoords  = lat != null && lng != null
  const apiKey     = GOOGLE_MAPS_API_KEY
  const hasApiKey  = hasUsableGoogleMapsKey

  const [imgError, setImgError] = useState(false)

  const thumbnailUrl =
    hasCoords && hasApiKey && !imgError
      ? staticMapThumbnailUrl(lat!, lng!, apiKey)
      : null

  const formattedAddr = formatAddress({ address, city, state: state || 'OH', zip })

  function handleNavigate() {
    if (!hasCoords) return
    openGoogleMapsNavigation(lat!, lng!, customerName)
  }

  function handleAppleMaps() {
    if (!hasCoords) return
    openAppleMapsNavigation(lat!, lng!)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Static map thumbnail */}
      {thumbnailUrl ? (
        <div
          style={{
            width: '100%',
            height: 160,
            borderRadius: '10px 10px 0 0',
            overflow: 'hidden',
            border: `1px solid ${COLOR_BORDER}`,
            borderBottom: 'none',
            background: '#f9fafb',
          }}
        >
          <img
            src={thumbnailUrl}
            alt={`Map preview for ${formattedAddr}`}
            width="100%"
            height="160"
            style={{ objectFit: 'cover', display: 'block' }}
            onError={() => setImgError(true)}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      ) : (
        /* Placeholder when no thumbnail available */
        <div
          style={{
            width: '100%',
            height: 80,
            borderRadius: '10px 10px 0 0',
            border: `1px solid ${COLOR_BORDER}`,
            borderBottom: 'none',
            background: '#f9fafb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
              fill={hasCoords ? COLOR_BORDER : '#d1d5db'}
            />
            <circle cx="12" cy="9" r="2.5" fill={COLOR_WHITE}/>
          </svg>
        </div>
      )}

      {/* Navigation card */}
      <div
        style={{
          border: `1px solid ${COLOR_BORDER}`,
          borderRadius: thumbnailUrl || !hasCoords ? '0 0 10px 10px' : 10,
          padding: '16px',
          background: COLOR_WHITE,
        }}
      >
        {/* Primary navigate button */}
        <button
          onClick={handleNavigate}
          disabled={!hasCoords}
          aria-label={`Navigate to ${customerName}`}
          style={{
            width: '100%',
            padding: '14px 20px',
            borderRadius: 8,
            border: 'none',
            cursor: hasCoords ? 'pointer' : 'not-allowed',
            background: hasCoords ? COLOR_BRAND : COLOR_DISABLED_BG,
            color: hasCoords ? COLOR_WHITE : COLOR_DISABLED_TEXT,
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.01em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'opacity 0.15s',
          }}
        >
          {/* Navigation arrow icon */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 11l19-9-9 19-2-8-8-2z"
              fill={hasCoords ? COLOR_WHITE : COLOR_DISABLED_TEXT}
            />
          </svg>
          Navigate to stop
        </button>

        {/* Customer name + address */}
        <div style={{ marginTop: 12 }}>
          <p style={{
            margin: 0,
            fontWeight: 600,
            fontSize: 14,
            color: '#111827',
            lineHeight: 1.4,
          }}>
            {customerName}
          </p>
          <p style={{
            margin: '3px 0 0',
            fontSize: 13,
            color: COLOR_TEXT_2,
            lineHeight: 1.5,
          }}>
            {formattedAddr}
          </p>
          {!hasCoords && (
            <p style={{
              margin: '6px 0 0',
              fontSize: 12,
              color: '#ef4444',
            }}>
              Location not geocoded — tap address to copy
            </p>
          )}
        </div>

        {/* iOS Apple Maps fallback link */}
        {isIOS() && hasCoords && (
          <button
            onClick={handleAppleMaps}
            style={{
              marginTop: 10,
              width: '100%',
              padding: '10px',
              borderRadius: 7,
              border: `1px solid ${COLOR_BORDER}`,
              background: COLOR_WHITE,
              cursor: 'pointer',
              fontSize: 13,
              color: '#374151',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {/* Apple Maps icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                fill="#3b82f6"
              />
              <circle cx="12" cy="9" r="2.5" fill={COLOR_WHITE}/>
            </svg>
            Open in Apple Maps
          </button>
        )}
      </div>
    </div>
  )
}
