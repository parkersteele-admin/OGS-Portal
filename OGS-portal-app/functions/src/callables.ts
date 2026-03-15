/**
 * functions/src/callables.ts
 *
 * generateInvoicePdf — Callable: builds a PDF invoice and stores it in Firebase Storage
 * optimizeRoute      — Callable: calls Google Maps Routes API to reorder run stops
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import PDFDocument from 'pdfkit'
import { db, storage, FieldValue } from './admin'
import { GOOGLE_MAPS_KEY, requireSecret } from './config'

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

  // ── Fetch customer for billing address ──────────────────────────────────
  const customerSnap = await db.collection('customers').doc(invoice.customerId as string).get()
  const customer     = customerSnap.exists ? customerSnap.data()! : {}

  // ── Build PDF in memory ─────────────────────────────────────────────────
  const pdfBuffer = await buildInvoicePdf(invoice, customer)

  // ── Upload to Firebase Storage ──────────────────────────────────────────
  const bucket     = storage.bucket()
  const storagePath = `ogs-portal/customers/${invoice.customerId as string}/invoices/${data.invoiceId}.pdf`
  const fileRef    = bucket.file(storagePath)

  await fileRef.save(pdfBuffer, {
    contentType: 'application/pdf',
    metadata: {
      cacheControl: 'private, max-age=0',
      metadata: {
        invoiceId:  data.invoiceId,
        customerId: invoice.customerId as string,
      },
    },
  })

  // Signed URL valid for 7 days
  const expiresAt    = Date.now() + 7 * 24 * 60 * 60 * 1000
  const [signedUrl]  = await fileRef.getSignedUrl({ action: 'read', expires: expiresAt })

  // Persist the signed URL (for convenience; regenerate when needed)
  await invoiceSnap.ref.update({
    pdfUrl:    signedUrl,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { url: signedUrl }
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

// ── PDF builder ───────────────────────────────────────────────────────────────

function buildInvoicePdf(
  invoice:  Record<string, unknown>,
  customer: Record<string, unknown>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 50, size: 'LETTER' })
    const chunks: Buffer[] = []

    doc.on('data',  (c: Buffer) => chunks.push(c))
    doc.on('end',   ()          => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const PAGE_WIDTH = 612
    const COL_RIGHT  = PAGE_WIDTH - 50

    // ── Header ───────────────────────────────────────────────────────────────
    doc.fontSize(22).font('Helvetica-Bold').text('OGS PORTAL', 50, 50)
    doc.fontSize(9).font('Helvetica').fillColor('#666666')
      .text('Open Gas Supply Portal', 50, 80)
      .text('support@ogsportal.com', 50, 92)
    doc.fillColor('#000000')

    // ── Invoice meta (right-aligned) ─────────────────────────────────────────
    doc.fontSize(28).font('Helvetica-Bold')
      .text('INVOICE', 0, 50, { align: 'right', width: COL_RIGHT })
    doc.fontSize(9).font('Helvetica')
      .text(`#${invoice.invoiceNumber as string}`, 0, 90, { align: 'right', width: COL_RIGHT })
      .text(`Status: ${(invoice.status as string).toUpperCase()}`, 0, 102, { align: 'right', width: COL_RIGHT })

    // ── Bill to ──────────────────────────────────────────────────────────────
    doc.moveTo(50, 140).lineTo(COL_RIGHT, 140).strokeColor('#cccccc').stroke()
    doc.strokeColor('#000000').moveDown(0.5)

    doc.fontSize(9).font('Helvetica-Bold').text('BILL TO', 50, 155)
    doc.font('Helvetica').fontSize(10)
      .text(customer.name   as string ?? '', 50, 168)
      .text(customer.email  as string ?? '', 50, 180)

    // Issued / Due
    doc.fontSize(9).font('Helvetica-Bold').text('ISSUED', 380, 155)
    doc.font('Helvetica').text(
      invoice.issuedAt ? new Date((invoice.issuedAt as {toDate():Date}).toDate()).toLocaleDateString() : '—',
      380, 168,
    )
    doc.font('Helvetica-Bold').text('DUE', 470, 155)
    doc.font('Helvetica').text(
      invoice.dueAt ? new Date((invoice.dueAt as {toDate():Date}).toDate()).toLocaleDateString() : '—',
      470, 168,
    )

    // ── Line items table ─────────────────────────────────────────────────────
    const tableTop = 230

    doc.moveTo(50, tableTop).lineTo(COL_RIGHT, tableTop).strokeColor('#333333').stroke()
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333')
    doc.text('DESCRIPTION', 50, tableTop + 6)
    doc.text('QTY',  360, tableTop + 6, { width: 60,  align: 'right' })
    doc.text('RATE', 425, tableTop + 6, { width: 70,  align: 'right' })
    doc.text('TOTAL',495, tableTop + 6, { width: 65,  align: 'right' })
    doc.moveTo(50, tableTop + 20).lineTo(COL_RIGHT, tableTop + 20).strokeColor('#cccccc').stroke()

    doc.fillColor('#000000').font('Helvetica').fontSize(9)
    let rowY = tableTop + 30

    const lineItems = (invoice.lineItems as Array<{
      description: string; quantity: number; unitPrice: number; total: number
    }>) ?? []

    for (const item of lineItems) {
      doc.text(item.description, 50, rowY, { width: 300 })
      doc.text(String(item.quantity),         360, rowY, { width: 60,  align: 'right' })
      doc.text(`$${item.unitPrice.toFixed(2)}`,425, rowY, { width: 70,  align: 'right' })
      doc.text(`$${item.total.toFixed(2)}`,    495, rowY, { width: 65,  align: 'right' })
      rowY += 18
    }

    // ── Totals ───────────────────────────────────────────────────────────────
    rowY += 8
    doc.moveTo(350, rowY).lineTo(COL_RIGHT, rowY).strokeColor('#cccccc').stroke()
    rowY += 10

    const subtotal = invoice.subtotal    as number ?? 0
    const tax      = invoice.taxAmount   as number ?? 0
    const total    = invoice.totalAmount as number ?? 0

    doc.fontSize(9).font('Helvetica')
      .text('Subtotal',          350, rowY,      { width: 140, align: 'right' })
      .text(`$${subtotal.toFixed(2)}`, 495, rowY, { width: 65,  align: 'right' })
    rowY += 14
    doc.text('Tax',              350, rowY,      { width: 140, align: 'right' })
      .text(`$${tax.toFixed(2)}`,      495, rowY, { width: 65,  align: 'right' })
    rowY += 14

    doc.moveTo(350, rowY).lineTo(COL_RIGHT, rowY).strokeColor('#333333').stroke()
    rowY += 10

    doc.fontSize(11).font('Helvetica-Bold')
      .text('Total Due',         350, rowY,      { width: 140, align: 'right' })
      .text(`$${total.toFixed(2)}`,   495, rowY, { width: 65,  align: 'right' })

    doc.end()
  })
}
