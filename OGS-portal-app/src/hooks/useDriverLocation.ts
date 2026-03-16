/**
 * src/hooks/useDriverLocation.ts
 *
 * Tracks a driver's current position for the dispatch map.
 *
 * Current implementation (Phase 1):
 *   Uses the lat/lng of the driver's most recently completed (or arrived) stop
 *   as a position proxy.  This surfaces meaningful movement on the map today
 *   without requiring any device integration.
 *
 * Future implementation (Phase 2 — GPS tracking):
 *   Replace the return value with a live geolocation stream from the driver's
 *   device.  The public API of this hook stays the same so DispatchMap.tsx
 *   needs zero changes when GPS is added.
 *
 *   Example Phase 2 implementation sketch (do NOT enable yet):
 *
 *     useEffect(() => {
 *       if (!navigator.geolocation) return
 *       const watchId = navigator.geolocation.watchPosition(
 *         (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
 *         (err) => console.warn('Geolocation error', err),
 *         { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
 *       )
 *       return () => navigator.geolocation.clearWatch(watchId)
 *     }, [])
 */

import { useMemo } from 'react'
import type { RunStop } from '../types/run'
import type { Customer } from '../types/customer'

export interface DriverPosition {
  lat: number
  lng: number
  /** Source of the position: 'gps' in Phase 2, 'stop-proxy' in Phase 1. */
  source: 'gps' | 'stop-proxy'
  /** RunStop that was used as the position proxy, if source === 'stop-proxy'. */
  proxyStop?: RunStop
}

/**
 * Returns the driver's best-known current position.
 *
 * @param stops       All RunStop records for the active run, in order.
 * @param customers   Customer records keyed by customer ID (to resolve lat/lng).
 */
export function useDriverLocation(
  stops: RunStop[],
  customers: Record<string, Customer>,
): DriverPosition | null {
  return useMemo(() => {
    if (!stops.length) return null

    // Find the last stop that has been completed or arrived at.
    // Fall back to the first pending stop so something is always shown.
    const activeStop =
      [...stops]
        .reverse()
        .find((s) => s.status === 'completed' || s.status === 'arrived') ??
      stops.find((s) => s.status === 'pending')

    if (!activeStop) return null

    const customer = customers[activeStop.customerId]
    if (!customer?.lat || !customer?.lng) return null

    return {
      lat:       customer.lat,
      lng:       customer.lng,
      source:    'stop-proxy',
      proxyStop: activeStop,
    }
  }, [stops, customers])
}
