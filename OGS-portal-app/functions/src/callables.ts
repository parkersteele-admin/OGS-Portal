/**
 * functions/src/callables.ts
 *
 * generateInvoicePdf — Callable: builds a PDF invoice and stores it in Firebase Storage
 * optimizeRoute      — Callable: calls Google Maps Routes API to reorder run stops
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db } from './admin'
import { GOOGLE_MAPS_KEY, requireSecret } from './config'
import { generateInvoicePdf as generatePdf } from './pdf/generateInvoicePdf'

// ── generateInvoicePdf ────────────────────────────────────────────────────────

/**
 * Generates a PDF for the given invoice, uploads it to:
 *   ogs-portal/customers/{customerId}/invoices/{invoiceId}.pdf
 *
 * Updates the invoice document with `pdfUrl` (a 7-day signed URL).
 *
 * Access: admin, dispatch, or the owning customer.
 *
 * Input:  { invoiceId: string }
 * Output: { url: string }
 */
export const generateInvoicePdf = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }

  const data = request.data as Record<string, unknown>
  if (typeof data.invoiceId !== 'string' || !data.invoiceId) {
    throw new HttpsError('invalid-argument', 'invoiceId must be a non-empty string.')
  }

  // Authorization: owner, admin, or dispatch
  const invoiceSnap = await db.collection('invoices').doc(data.invoiceId).get()
  if (!invoiceSnap.exists) {
    throw new HttpsError('not-found', `Invoice ${data.invoiceId} not found.`)
  }

  const invoice    = invoiceSnap.data()!
  const callerRole = request.auth.token.role as string
  const isOwner    = request.auth.token.customerId === invoice.customerId

  if (!isOwner && !['admin', 'dispatch'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'You are not authorised to access this invoice.')
  }

  try {
    const url = await generatePdf(data.invoiceId)
    return { url }
  } catch (err) {
    console.error(`generateInvoicePdf callable [${data.invoiceId}]:`, err)
    throw new HttpsError('internal', 'PDF generation failed.')
  }
})

// ── optimizeRoute ─────────────────────────────────────────────────────────────

/**
 * Calls the Google Maps Routes API with `optimizeWaypointOrder: true` to find
 * the most efficient stop sequence for a run.
 *
 * Updates each stop's `order` field in Firestore with the optimised index.
 *
 * Access: admin and dispatch only.
 *
 * Input:  { runId: string }
 * Output: { optimizedOrder: number[] }   — original stop indices in new order
 */
export const optimizeRoute = onCall(
  { secrets: [GOOGLE_MAPS_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }
    const callerRole = request.auth.token.role as string
    if (!['admin', 'dispatch'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Only admin/dispatch can optimise routes.')
    }

    const data = request.data as Record<string, unknown>
    if (typeof data.runId !== 'string' || !data.runId) {
      throw new HttpsError('invalid-argument', 'runId must be a non-empty string.')
    }

    const stopsSnap = await db
      .collection(`runs/${data.runId}/stops`)
      .orderBy('order')
      .get()

    if (stopsSnap.size < 2) {
      throw new HttpsError('failed-precondition', 'A run must have at least 2 stops to optimise.')
    }

    if (stopsSnap.size > 25) {
      // Google Maps Routes API intermediates limit
      throw new HttpsError('failed-precondition', 'Routes API supports at most 25 waypoints.')
    }

    const stops = stopsSnap.docs.map((d) => d.data() as Record<string, unknown>)

    // Build waypoint list: first stop = origin, last = destination, rest = intermediates
    const toWaypoint = (address: unknown) => ({
      address: { addressQuery: { query: address as string } },
    })

    const origin       = toWaypoint(stops[0].address)
    const destination  = toWaypoint(stops[stops.length - 1].address)
    const intermediates = stops.slice(1, -1).map((s) => toWaypoint(s.address))

    const mapsKey = requireSecret(GOOGLE_MAPS_KEY.value(), 'GOOGLE_MAPS_SERVER_KEY')

    const mapsRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'X-Goog-Api-Key':     mapsKey,
        'X-Goog-FieldMask':   'routes.optimizedIntermediateWaypointIndex',
      },
      body: JSON.stringify({
        origin,
        destination,
        intermediates,
        travelMode:             'DRIVE',
        optimizeWaypointOrder:   true,
        routingPreference:       'TRAFFIC_AWARE',
      }),
    })

    if (!mapsRes.ok) {
      console.error('Google Maps Routes API error:', await mapsRes.text())
      throw new HttpsError('internal', 'Google Maps route optimisation failed.')
    }

    const mapsData = await mapsRes.json() as {
      routes?: { optimizedIntermediateWaypointIndex?: number[] }[]
    }

    const optimizedIntermediates =
      mapsData.routes?.[0]?.optimizedIntermediateWaypointIndex ?? []

    // Build full optimised index list: origin (0) + reordered intermediates + destination
    const originIdx      = 0
    const destIdx        = stops.length - 1
    const intermediateOriginalIndices = stops
      .slice(1, -1)
      .map((_, i) => i + 1) // original indices for middle stops

    const optimizedOrder: number[] = [
      originIdx,
      ...optimizedIntermediates.map((i) => intermediateOriginalIndices[i]),
      destIdx,
    ]

    // Write the new `order` values back to Firestore
    const batch = db.batch()
    optimizedOrder.forEach((originalIdx, newPosition) => {
      batch.update(stopsSnap.docs[originalIdx].ref, { order: newPosition })
    })
    await batch.commit()

    return { optimizedOrder }
  },
)


