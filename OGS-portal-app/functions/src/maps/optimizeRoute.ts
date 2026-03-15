/**
 * functions/src/maps/optimizeRoute.ts
 *
 * Callable: optimizeOrderRoute
 *
 * Pre-run route planning tool.  Takes a list of order IDs and a start
 * location (truck depot or driver home), then:
 *
 *  1. Fetches each Order from Firestore and resolves the Customer lat/lng
 *  2. Filters out orders whose customers are not yet geocoded
 *  3. Calls the Google Maps Routes API with optimizeWaypointOrder: true
 *  4. Returns the optimised stop order with per-leg distance + duration
 *
 * The frontend (dispatch) uses the response to build the Run and its
 * RunStop documents in the correct sequence.
 *
 * Access: admin and dispatch only
 *
 * Input:
 * {
 *   orderIds:      string[]       // Firestore order doc IDs
 *   startLocation: { lat: number, lng: number }  // depot / driver start
 *   date:          string         // ISO date string, used for traffic model
 * }
 *
 * Output:
 * {
 *   optimizedOrderIds:       string[]
 *   totalDistanceMiles:      number
 *   estimatedDurationMinutes: number
 *   legs: { orderId: string, distanceMiles: number, durationMinutes: number }[]
 *   skippedOrderIds: string[]   // orders dropped due to missing geocode
 * }
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db } from '../admin'
import { GOOGLE_MAPS_KEY, requireSecret } from '../config'

// ── Types ──────────────────────────────────────────────────────────────────────

interface LatLng {
  lat: number
  lng: number
}

interface OptimizeRouteInput {
  orderIds:      string[]
  startLocation: LatLng
  date:          string
}

interface RouteLeg {
  orderId:         string
  distanceMiles:   number
  durationMinutes: number
}

interface OptimizeRouteOutput {
  optimizedOrderIds:        string[]
  totalDistanceMiles:       number
  estimatedDurationMinutes: number
  legs:                     RouteLeg[]
  skippedOrderIds:          string[]
}

// ── Routes API shape (minimal — only what we unmarshal) ───────────────────────

interface RoutesApiLeg {
  distanceMeters?:   number
  duration?:         string   // e.g. "1234s"
  staticDuration?:   string
}

interface RoutesApiRoute {
  optimizedIntermediateWaypointIndex?: number[]
  legs?:                               RoutesApiLeg[]
}

interface RoutesApiResponse {
  routes?: RoutesApiRoute[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function metersToMiles(meters: number): number {
  return Math.round((meters / 1609.344) * 10) / 10
}

function durationStringToMinutes(duration: string | undefined): number {
  if (!duration) return 0
  // Format from Routes API: "1234s"
  const seconds = parseInt(duration.replace('s', ''), 10)
  return isNaN(seconds) ? 0 : Math.round(seconds / 60)
}

function latLngWaypoint(loc: LatLng) {
  return {
    location: {
      latLng: { latitude: loc.lat, longitude: loc.lng },
    },
  }
}

function validateInput(data: Record<string, unknown>): OptimizeRouteInput {
  if (!Array.isArray(data.orderIds) || data.orderIds.length === 0) {
    throw new HttpsError('invalid-argument', 'orderIds must be a non-empty array.')
  }
  if (data.orderIds.length > 25) {
    throw new HttpsError(
      'invalid-argument',
      'The Routes API supports at most 25 waypoints per request.',
    )
  }
  const start = data.startLocation as Record<string, unknown> | undefined
  if (
    !start ||
    typeof start.lat !== 'number' ||
    typeof start.lng !== 'number'
  ) {
    throw new HttpsError(
      'invalid-argument',
      'startLocation must be { lat: number, lng: number }.',
    )
  }
  if (typeof data.date !== 'string' || !data.date) {
    throw new HttpsError('invalid-argument', 'date must be a non-empty ISO date string.')
  }
  return {
    orderIds:      data.orderIds as string[],
    startLocation: { lat: start.lat as number, lng: start.lng as number },
    date:          data.date as string,
  }
}

// ── Callable ───────────────────────────────────────────────────────────────────

export const optimizeOrderRoute = onCall(
  { secrets: [GOOGLE_MAPS_KEY] },
  async (request): Promise<OptimizeRouteOutput> => {

    // ── Auth + role check ────────────────────────────────────────────────────
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }
    const callerRole = request.auth.token.role as string | undefined
    if (!callerRole || !['admin', 'dispatch'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Only admin or dispatch can optimise routes.')
    }

    const input = validateInput(request.data as Record<string, unknown>)

    // ── Step 1: Fetch orders + customer geocoords ────────────────────────────

    // Firestore getAll accepts DocumentReference[], not plain strings
    const orderRefs = input.orderIds.map((id) => db.collection('orders').doc(id))
    const orderSnaps = await db.getAll(...orderRefs)

    interface OrderWithLocation {
      orderId:    string
      customerId: string
      latLng:     LatLng
    }

    const validOrders: OrderWithLocation[] = []
    const skippedOrderIds: string[]         = []

    for (const snap of orderSnaps) {
      if (!snap.exists) {
        console.warn(`optimizeOrderRoute: order ${snap.id} not found — skipping`)
        skippedOrderIds.push(snap.id)
        continue
      }

      const order      = snap.data() as Record<string, unknown>
      const customerId = order.customerId as string | undefined

      if (!customerId) {
        console.warn(`optimizeOrderRoute: order ${snap.id} has no customerId — skipping`)
        skippedOrderIds.push(snap.id)
        continue
      }

      const customerSnap = await db.collection('customers').doc(customerId).get()
      if (!customerSnap.exists) {
        console.warn(`optimizeOrderRoute: customer ${customerId} not found — skipping order ${snap.id}`)
        skippedOrderIds.push(snap.id)
        continue
      }

      const customer = customerSnap.data() as Record<string, unknown>
      const lat      = customer.lat as number | undefined
      const lng      = customer.lng as number | undefined

      if (lat == null || lng == null || customer.geocodeStatus !== 'ok') {
        console.warn(
          `optimizeOrderRoute: customer ${customerId} not geocoded ` +
          `(status: ${customer.geocodeStatus as string}) — skipping order ${snap.id}`,
        )
        skippedOrderIds.push(snap.id)
        continue
      }

      validOrders.push({ orderId: snap.id, customerId, latLng: { lat, lng } })
    }

    if (validOrders.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'None of the provided orders have geocoded customer addresses.',
      )
    }

    // With only one stop there is nothing to optimise — return it as-is
    if (validOrders.length === 1) {
      return {
        optimizedOrderIds:        [validOrders[0].orderId],
        totalDistanceMiles:       0,
        estimatedDurationMinutes: 0,
        legs:                     [{ orderId: validOrders[0].orderId, distanceMiles: 0, durationMinutes: 0 }],
        skippedOrderIds,
      }
    }

    // ── Step 2: Call Google Maps Routes API ──────────────────────────────────

    const mapsKey = requireSecret(GOOGLE_MAPS_KEY.value(), 'GOOGLE_MAPS_SERVER_KEY')

    // Origin and destination are the depot (start/end same point).
    // Intermediates are all customer locations.
    const origin      = latLngWaypoint(input.startLocation)
    const destination = latLngWaypoint(input.startLocation)
    const intermediates = validOrders.map((o) => latLngWaypoint(o.latLng))

    const routesBody = {
      origin,
      destination,
      intermediates,
      travelMode:            'DRIVE',
      optimizeWaypointOrder:  true,
      routingPreference:      'TRAFFIC_AWARE',
    }

    const mapsRes = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Goog-Api-Key':   mapsKey,
          // Request only the fields we need to minimise billing units
          'X-Goog-FieldMask': [
            'routes.optimizedIntermediateWaypointIndex',
            'routes.legs.distanceMeters',
            'routes.legs.duration',
            'routes.legs.staticDuration',
          ].join(','),
        },
        body: JSON.stringify(routesBody),
      },
    )

    if (!mapsRes.ok) {
      const errText = await mapsRes.text()
      console.error('optimizeOrderRoute: Routes API error —', errText)
      throw new HttpsError('internal', `Google Maps Routes API returned ${mapsRes.status}.`)
    }

    const mapsData = (await mapsRes.json()) as RoutesApiResponse
    const route    = mapsData.routes?.[0]

    if (!route) {
      throw new HttpsError('internal', 'Routes API returned no routes.')
    }

    // ── Step 3: Process response ─────────────────────────────────────────────

    // optimizedIntermediateWaypointIndex maps new position → original index in `intermediates`
    const optimizedIntermediateIndices = route.optimizedIntermediateWaypointIndex ?? []

    // Build the full ordered list: [depot-leg, ...intermediate legs, depot-return leg]
    // Legs array from the API: [depot→stop_0, stop_0→stop_1, ..., last_stop→depot]
    const orderedOrders: OrderWithLocation[] = optimizedIntermediateIndices.map(
      (origIdx) => validOrders[origIdx],
    )

    const legs: RouteLeg[] = orderedOrders.map((order, i) => {
      // Leg index is 0-based; leg[0] = depot→first stop, leg[N-1] = last stop→depot
      const apiLeg = route.legs?.[i]
      return {
        orderId:         order.orderId,
        distanceMiles:   metersToMiles(apiLeg?.distanceMeters ?? 0),
        durationMinutes: durationStringToMinutes(apiLeg?.duration ?? apiLeg?.staticDuration),
      }
    })

    const totalDistanceMiles       = legs.reduce((s, l) => s + l.distanceMiles,    0)
    const estimatedDurationMinutes = legs.reduce((s, l) => s + l.durationMinutes,  0)

    // ── Step 4: Return ───────────────────────────────────────────────────────
    const result: OptimizeRouteOutput = {
      optimizedOrderIds:        orderedOrders.map((o) => o.orderId),
      totalDistanceMiles:       Math.round(totalDistanceMiles     * 10) / 10,
      estimatedDurationMinutes: Math.round(estimatedDurationMinutes),
      legs,
      skippedOrderIds,
    }

    console.log(
      `optimizeOrderRoute: ${orderedOrders.length} stops, ` +
      `${result.totalDistanceMiles} miles, ${result.estimatedDurationMinutes} min` +
      (skippedOrderIds.length ? ` (skipped ${skippedOrderIds.length})` : ''),
    )

    return result
  },
)
