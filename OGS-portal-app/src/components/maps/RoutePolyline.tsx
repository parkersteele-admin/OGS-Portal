/**
 * src/components/maps/RoutePolyline.tsx
 *
 * Fetches a real driving route via the Google Maps Directions API and draws
 * it on the DispatchMap.
 *
 * - Completed legs: solid green (#22c55e)
 * - Remaining legs: solid brand orange (#E87722)
 *
 * Uses suppressPolylines + per-leg Polylines so each leg can be coloured
 * independently.  Coordinates come from Customer.lat / Customer.lng.
 */

import { useEffect, useMemo } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import type { RunStop } from '../../types/run'
import type { Customer } from '../../types/customer'

interface RoutePolylineProps {
  stops:     RunStop[]
  customers: Record<string, Customer>
}

const COLOR_BRAND     = '#E87722'
const COLOR_COMPLETED = '#22c55e'

export function RoutePolyline({ stops, customers }: RoutePolylineProps) {
  const map       = useMap()
  const routesLib = useMapsLibrary('routes')
  const mapsLib   = useMapsLibrary('maps')

  // Ordered waypoints enriched with completion status
  const waypoints = useMemo(() => {
    return [...stops]
      .sort((a, b) => a.order - b.order)
      .map((stop) => {
        const c = customers[stop.customerId]
        if (!c?.lat || !c?.lng) return null
        return { lat: c.lat, lng: c.lng, completed: stop.status === 'completed' }
      })
      .filter(Boolean) as Array<{ lat: number; lng: number; completed: boolean }>
  }, [stops, customers])

  useEffect(() => {
    if (!map || !routesLib || !mapsLib || waypoints.length < 2) return

    let cancelled = false

    // Renderer just handles the Directions response; we draw our own polylines.
    const renderer = new routesLib.DirectionsRenderer({
      map,
      suppressMarkers:   true,
      suppressPolylines: true,   // we colour each leg ourselves
    })

    const svc = new routesLib.DirectionsService()
    svc.route(
      {
        origin:      { lat: waypoints[0].lat, lng: waypoints[0].lng },
        destination: { lat: waypoints[waypoints.length - 1].lat, lng: waypoints[waypoints.length - 1].lng },
        waypoints:   waypoints.slice(1, -1).map((loc) => ({
          location: { lat: loc.lat, lng: loc.lng },
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
          // A leg is "done" when the *origin* waypoint is completed
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

        // Store for cleanup
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(renderer as any)._ogsPolylines = polylines
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
