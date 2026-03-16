/**
 * src/utils/navigation.ts
 *
 * Cross-platform navigation deep-link helpers for the driver stop view.
 *
 * Strategy:
 *   iOS           → Google Maps app via comgooglemaps:// (falls back to browser)
 *   Android       → Google Maps app via intent:// scheme
 *   Desktop/other → Standard maps.google.com dir link
 */

/** Returns true when running on an iOS device (iPhone / iPad). */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/** Returns true when running on an Android device. */
export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent)
}

/**
 * Opens turn-by-turn Google Maps navigation to the given coordinates.
 *
 * - iOS:     tries `comgooglemaps://` deep link first; falls back automatically
 *            if the app is not installed (browser intercepts unresolved schemes).
 * - Android: uses the `geo:` intent URI which the OS routes to Maps.
 * - Other:   opens `https://www.google.com/maps/dir/` in the current tab.
 *
 * @param lat    Destination latitude
 * @param lng    Destination longitude
 * @param label  Optional destination label shown in Google Maps
 */
export function openGoogleMapsNavigation(
  lat: number,
  lng: number,
  label?: string,
): void {
  const destination = `${lat},${lng}`
  const encodedLabel = label ? encodeURIComponent(label) : ''

  if (isIOS()) {
    // comgooglemaps:// deep link — navigates directly in the Maps app.
    // Falls back to the browser URL silently if Google Maps is not installed.
    const gmapsApp =
      `comgooglemaps://?daddr=${destination}` +
      (encodedLabel ? `&directionsmode=driving` : `&directionsmode=driving`)
    window.location.href = gmapsApp

    // After a short delay, if the app hasn't opened, fall back to browser.
    setTimeout(() => {
      const fallback =
        `https://maps.google.com/?q=${destination}` +
        (encodedLabel ? `&label=${encodedLabel}` : '')
      window.open(fallback, '_blank', 'noopener,noreferrer')
    }, 600)
    return
  }

  if (isAndroid()) {
    // geo: URI — Android resolves this to the default maps app.
    const geoUri = `geo:${destination}?q=${destination}` +
      (encodedLabel ? `(${encodedLabel})` : '')
    window.location.href = geoUri
    return
  }

  // Desktop / other: open directions in a new tab
  const url =
    `https://www.google.com/maps/dir/?api=1&destination=${destination}` +
    (encodedLabel ? `&destination_place_id=` : '')
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Opens Apple Maps navigation to the given coordinates.
 * Only meaningful on iOS; no-ops silently on other platforms.
 *
 * @param lat  Destination latitude
 * @param lng  Destination longitude
 */
export function openAppleMapsNavigation(lat: number, lng: number): void {
  const destination = `${lat},${lng}`
  // maps:// deep link is handled by Apple Maps on iOS/macOS
  window.location.href = `maps://maps.apple.com/?daddr=${destination}`
}

/**
 * Builds the Google Static Maps API URL for a thumbnail preview.
 *
 * @param lat     Centre latitude
 * @param lng     Centre longitude
 * @param apiKey  Client-side Maps JS API key (HTTP referrer restricted)
 * @param width   Image width in pixels (default 320)
 * @param height  Image height in pixels (default 160)
 */
export function staticMapThumbnailUrl(
  lat: number,
  lng: number,
  apiKey: string,
  width = 320,
  height = 160,
): string {
  const center  = `${lat},${lng}`
  const marker  = `color:orange|${center}`
  return (
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${center}` +
    `&zoom=15` +
    `&size=${width}x${height}` +
    `&scale=2` +
    `&markers=${encodeURIComponent(marker)}` +
    `&key=${apiKey}`
  )
}
