/**
 * src/components/maps/RoutePolyline.tsx
 *
 * Fetches a real driving route via the Google Maps Directions API and draws
 * it on the DispatchMap.
 *
 * - Completed legs: solid green (#22c55e)
 * - Remaining legs: solid brand blue (#0066FF)
 *
 * Uses suppressPolylines + per-leg Polylines so each leg can be coloured
 * independently.  Coordinates come from Customer.lat / Customer.lng.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import type { RunStop } from '../../types/run'
import type { Customer } from '../../types/customer'

interface RoutePolylineProps {
  stops:     RunStop[]
  customers: Record<string, Customer>
  /** Called once with resolved lat/lng for any stops that had no coordinates. */
  onPositionsResolved?: (positions: Record<string, { lat: number; lng: number }>) => void
}

const COLOR_BRAND     = '#0066FF'
const COLOR_COMPLETED = '#22c55e'

type WaypointEntry = {
  customerId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  location:   any   // { lat, lng } | address string — both accepted by Directions API
  completed:  boolean
  hasCoords:  boolean
}

export function RoutePolyline({ stops, customers, onPositionsResolved }: RoutePolylineProps) {
  const map       = useMap()
  const routesLib = useMapsLibrary('routes')
  const mapsLib   = useMapsLibrary('maps')

  // Keep latest callback in a ref so it doesn't need to be a useEffect dependency
  const resolvedCbRef = useRef(onPositionsResolved)
  useEffect(() => { resolvedCbRef.current = onPositionsResolved }, [onPositionsResolved])

  // Ordered waypoints — use lat/lng when available, address string as fallback
  const waypoints = useMemo<WaypointEntry[]>(() => {
    return [...stops]
      .sort((a, b) => a.order - b.order)
      .map((stop) => {
        const c = customers[stop.customerId]
        if (!c) return null
        if (c.lat && c.lng) {
          return {
            customerId: stop.customerId,
            location:   { lat: c.lat, lng: c.lng },
            completed:  stop.status === 'completed',
            hasCoords:  true,
          }
        }
        // Fall back to address string — Directions API accepts these directly
        const addr = [c.formattedAddress, c.address, c.city, c.state, c.zip]
          .filter(Boolean).join(', ').trim()
        if (!addr) return null
        return {
          customerId: stop.customerId,
          location:   addr,
          completed:  stop.status === 'completed',
          hasCoords:  false,
        }
      })
      .filter(Boolean) as WaypointEntry[]
  }, [stops, customers])

  useEffect(() => {
    if (!map || !routesLib || !mapsLib || waypoints.length < 2) return

    let cancelled = false

    const renderer = new routesLib.DirectionsRenderer({
      map,
      suppressMarkers:   true,
      suppressPolylines: true,
    })

    const svc = new routesLib.DirectionsService()
    svc.route(
      {
        origin:      waypoints[0].location,
        destination: waypoints[waypoints.length - 1].location,
        waypoints:   waypoints.slice(1, -1).map((wp) => ({
          location: wp.location,
          stopover: true,
        })),
        travelMode:        routesLib.TravelMode.DRIVING,
        optimizeWaypoints: false,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result: any, status: any) => {
        if (cancelled || status !== 'OK' || !result) return

        renderer.setDirections(result)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const legs: any[] = result.routes[0]?.legs ?? []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const polylines: any[] = []

        legs.forEach((leg: any, legIndex: number) => {
          const done = waypoints[legIndex]?.completed ?? false
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const path = leg.steps.flatMap((step: any) => step.path ?? [])
          const line = new mapsLib.Polyline({
            path,
            map,
            strokeColor:   done ? COLOR_COMPLETED : COLOR_BRAND,
            strokeWeight:  5,
            strokeOpacity: 0.85,
            zIndex:        done ? 1 : 2,
          })
          polylines.push(line)
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(renderer as any)._ogsPolylines = polylines

        // Pass back resolved positions for stops that used address strings,
        // so their StopMarkers can be placed without a separate geocode call.
        const cb = resolvedCbRef.current
        if (cb) {
          const resolved: Record<string, { lat: number; lng: number }> = {}
          waypoints.forEach((wp, i) => {
            if (wp.hasCoords) return
            // leg[i-1].end_location = position of waypoints[i] for i > 0
            // leg[0].start_location  = position of waypoints[0]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const loc: any = i === 0 ? legs[0]?.start_location : legs[i - 1]?.end_location
            if (!loc) return
            const raw = typeof loc.toJSON === 'function'
              ? loc.toJSON()
              : { lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
                  lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng }
            resolved[wp.customerId] = raw
          })
          if (Object.keys(resolved).length > 0) cb(resolved)
        }
      }
    )

    return () => {
      cancelled = true
      renderer.setMap(null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((renderer as any)._ogsPolylines ?? []).forEach((p: any) => p.setMap(null))
    }
  }, [map, routesLib, mapsLib, waypoints])

  return null
}
