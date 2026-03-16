/**
 * src/components/maps/RoutePolyline.tsx
 *
 * Draws the delivery route on the DispatchMap.
 *
 * Segments are rendered as two overlapping polylines per segment:
 *  - Completed segments: solid green (#22c55e)
 *  - Remaining segments: dashed gray (#9ca3af)
 *
 * Coordinates come from Customer.lat / Customer.lng.  Stops without a
 * geocoded customer are silently skipped — the line simply jumps over them.
 *
 * Updates in real-time because DispatchMap re-renders whenever the stops
 * or customers props change (driven by Firestore onSnapshot in the parent).
 */

import { useMemo } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { useEffect } from 'react'
import type { RunStop } from '../../types/run'
import type { Customer } from '../../types/customer'

interface RoutePolylineProps {
  stops: RunStop[]
  customers: Record<string, Customer>
}

// Colours
const COLOR_COMPLETED = '#22c55e'
const COLOR_REMAINING = '#9ca3af'

export function RoutePolyline({ stops, customers }: RoutePolylineProps) {
  const map          = useMap()
  const mapsCore     = useMapsLibrary('maps')

  // Build an ordered array of { latLng, completed } per stop.
  const segments = useMemo(() => {
    const sorted = [...stops].sort((a, b) => a.order - b.order)
    return sorted
      .map((stop) => {
        const customer = customers[stop.customerId]
        if (!customer?.lat || !customer?.lng) return null
        return {
          lat:       customer.lat,
          lng:       customer.lng,
          completed: stop.status === 'completed',
        }
      })
      .filter(Boolean) as Array<{ lat: number; lng: number; completed: boolean }>
  }, [stops, customers])

  useEffect(() => {
    if (!map || !mapsCore || segments.length < 2) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const polylines: any[] = []

    for (let i = 0; i < segments.length - 1; i++) {
      const from = segments[i]
      const to   = segments[i + 1]
      // A segment is "completed" when the starting stop is completed.
      const done = from.completed

      const line = new mapsCore.Polyline({
        path:          [from, to],
        map,
        strokeColor:   done ? COLOR_COMPLETED : COLOR_REMAINING,
        strokeOpacity: done ? 1   : 0,            // hide the stroke for dashed segments
        strokeWeight:  3,
        icons: done ? [] : [
          {
            icon: {
              path:         'M 0,-1 0,1',          // vertical dash
              strokeOpacity: 1,
              strokeColor:  COLOR_REMAINING,
              scale:         3,
            },
            offset: '0',
            repeat: '16px',
          },
        ],
        zIndex: done ? 2 : 1,
      })

      polylines.push(line)
    }

    return () => {
      polylines.forEach((p) => p.setMap(null))
    }
  }, [map, mapsCore, segments])

  // This component renders nothing — it works entirely via the Maps SDK effect.
  return null
}
