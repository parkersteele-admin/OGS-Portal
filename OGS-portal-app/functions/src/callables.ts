/**
 * functions/src/callables.ts
 *
 * generateInvoicePdf — Callable: builds a PDF invoice and stores it in Firebase Storage
 * optimizeRoute      — Callable: calls Google Maps Routes API to reorder run stops
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { db, FieldValue, adminAuth } from './admin'
import { GOOGLE_MAPS_KEY, SENDGRID_API_KEY, requireSecret } from './config'
import { performGeocode } from './triggers/geocodeCustomer'
import { generateInvoicePdf as generatePdf } from './pdf/generateInvoicePdf'
import { generateQuotePdf as generateQuotePdfCore } from './pdf/generateQuotePdf'
import { sendEmail } from './email/sendEmail'

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

// ── generateQuotePdf ──────────────────────────────────────────────────────────

/**
 * Generates a branded PDF for the given quote, uploads it to Storage, and
 * (when the quote is in 'sent' status) emails it to the recipient with an
 * inline download link.
 *
 * Access: admin or sales.
 *
 * Input:  { quoteId: string }
 * Output: { url: string }
 */
export const generateQuotePdf = onCall(
  { secrets: [SENDGRID_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.')
    }

    const callerRole = request.auth.token.role as string
    if (!['admin', 'sales'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Only admin/sales can generate quotes.')
    }

    const data = request.data as Record<string, unknown>
    if (typeof data.quoteId !== 'string' || !data.quoteId) {
      throw new HttpsError('invalid-argument', 'quoteId must be a non-empty string.')
    }

    const quoteSnap = await db.collection('quotes').doc(data.quoteId).get()
    if (!quoteSnap.exists) {
      throw new HttpsError('not-found', `Quote ${data.quoteId} not found.`)
    }

    let url: string
    try {
      url = await generateQuotePdfCore(data.quoteId)
    } catch (err) {
      console.error(`generateQuotePdf callable [${data.quoteId}]:`, err)
      throw new HttpsError('internal', 'PDF generation failed.')
    }

    // ── Email the PDF when the quote has been sent ────────────────────────
    const quote      = quoteSnap.data()!
    const isSent     = (quote.status as string) === 'sent'
    const quoteNum   = (quote.quoteNumber as string) || data.quoteId
    const validUntil = quote.validUntil
      ? (() => {
          const d = typeof quote.validUntil === 'object' && 'toDate' in quote.validUntil
            ? (quote.validUntil as { toDate(): Date }).toDate()
            : new Date(quote.validUntil as string)
          return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        })()
      : ''

    if (isSent) {
      // Resolve recipient email from customer or lead
      let recipientEmail = ''
      let recipientName  = 'Valued Customer'

      if (quote.customerId) {
        const cSnap = await db.collection('customers').doc(quote.customerId as string).get()
        if (cSnap.exists) {
          const c = cSnap.data()!
          recipientEmail = (c.email as string) || ''
          recipientName  = (c.name  as string) || recipientName
        }
      } else if (quote.leadId) {
        const lSnap = await db.collection('leads').doc(quote.leadId as string).get()
        if (lSnap.exists) {
          const l = lSnap.data()!
          recipientEmail = (l.email as string) || ''
          recipientName  = (l.name  as string) || (l.company as string) || recipientName
        }
      }

      if (recipientEmail) {
        try {
          requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')
          const total      = `$${((quote.total as number) ?? 0).toFixed(2)}`
          const validLine  = validUntil ? `<p style="margin:0 0 8px">This quote is valid until <strong>${validUntil}</strong>.</p>` : ''
          const portalLink = `https://app.ogsportal.com/portal/quotes/${data.quoteId}`

          await sendEmail({
            to:      recipientEmail,
            subject: `Quote #${quoteNum} from Ohio Gas Supply`,
            html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
  <div style="background:#E87722;padding:24px 32px 16px">
    <h1 style="margin:0;color:#fff;font-size:22px">Ohio Gas Supply Co.</h1>
    <p style="margin:6px 0 0;color:#ffe0c0;font-size:13px">Propane &amp; Natural Gas Delivery</p>
  </div>
  <div style="padding:28px 32px 24px;border:1px solid #e8e8e8;border-top:none">
    <p style="margin:0 0 16px">Dear ${recipientName},</p>
    <p style="margin:0 0 16px">
      Thank you for your interest in Ohio Gas Supply. Please find your quote details below.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
      <tr style="background:#f5f5f5">
        <td style="padding:8px 12px;font-weight:bold">Quote #</td>
        <td style="padding:8px 12px">${quoteNum}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold">Total</td>
        <td style="padding:8px 12px;color:#E87722;font-weight:bold">${total}</td>
      </tr>
      ${validUntil ? `<tr style="background:#f5f5f5"><td style="padding:8px 12px;font-weight:bold">Valid Until</td><td style="padding:8px 12px">${validUntil}</td></tr>` : ''}
    </table>
    ${validLine}
    <table style="border-collapse:collapse;margin:0 0 20px">
      <tr>
        <td style="padding-right:12px">
          <a href="${portalLink}" clicktracking="off" style="display:inline-block;background:#E87722;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px">Accept This Quote</a>
        </td>
        <td>
          <a href="${url}" clicktracking="off" style="display:inline-block;background:#fff;color:#E87722;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;border:2px solid #E87722">View PDF</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#666">
      Click <strong>Accept This Quote</strong> to confirm your pricing and unlock ordering through your portal.
      You can also reply to this email or call us at <strong>1-800-OGS-FUEL</strong>.
    </p>
  </div>
  <div style="padding:14px 32px;background:#f9f9f9;border:1px solid #e8e8e8;border-top:none;text-align:center;font-size:11px;color:#aaa">
    Ohio Gas Supply Co. &nbsp;·&nbsp; ohiogassupply.com &nbsp;·&nbsp; 1-800-OGS-FUEL
  </div>
</div>`,
          })
          console.log(`generateQuotePdf: quote email sent to ${recipientEmail}`)
        } catch (emailErr) {
          // Log but don't fail the callable — the PDF URL is the primary output
          console.warn('generateQuotePdf: email send failed —', emailErr)
        }
      } else {
        console.warn(`generateQuotePdf: no recipient email found for quote ${data.quoteId}`)
      }
    }

    return { url }
  },
)

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

// ── backfillGeocodeCustomers ───────────────────────────────────────────────────

/**
 * One-time admin callable: geocodes all customers missing lat/lng.
 * Safe to call multiple times — skips already-geocoded customers.
 *
 * Access: admin only
 * Output: { processed: number, skipped: number, failed: number }
 */
export const backfillGeocodeCustomers = onCall(
  { secrets: [GOOGLE_MAPS_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
    if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.')

    const snap = await db.collection('customers').get()
    let processed = 0, skipped = 0, failed = 0

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>
      if (data['lat'] && data['lng'] && data['geocodeStatus'] === 'ok') {
        skipped++
        continue
      }
      try {
        await performGeocode(doc.id, data)
        processed++
      } catch {
        failed++
      }
    }

    console.log(`backfillGeocodeCustomers: processed=${processed} skipped=${skipped} failed=${failed}`)
    return { processed, skipped, failed }
  },
)


// ── backfillMissingLeads ───────────────────────────────────────────────────────

/**
 * One-time admin callable: creates a leads/{companyId} doc for every customer
 * that lacks one (e.g. accounts that signed up before the trigger was fixed).
 *
 * Safe to call multiple times — skips customers that already have a lead doc.
 *
 * Access: admin only
 * Output: { created: number, skipped: number }
 */
// ── respondToQuote ────────────────────────────────────────────────────────────

/**
 * Allows a portal customer to accept or decline a quote that has been sent
 * to them by OGS sales.
 *
 * When accepted the customer's per-product pricing subcollection is updated
 * with the quoted prices (same logic as the staff-side acceptQuote service).
 *
 * Access: any portal customer role (customer, owner, manager, billing, delivery, viewer).
 *
 * Input:  { quoteId: string, response: 'accepted' | 'declined' }
 * Output: { success: true }
 */
export const respondToQuote = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.')
  }

  const callerRole = request.auth.token.role as string
  const portalRoles = ['customer', 'owner', 'manager', 'billing', 'delivery', 'viewer']
  if (!portalRoles.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only portal customers can respond to quotes.')
  }

  const data = request.data as Record<string, unknown>
  if (typeof data.quoteId !== 'string' || !data.quoteId) {
    throw new HttpsError('invalid-argument', 'quoteId must be a non-empty string.')
  }
  if (data.response !== 'accepted' && data.response !== 'declined') {
    throw new HttpsError('invalid-argument', 'response must be "accepted" or "declined".')
  }

  const quoteSnap = await db.collection('quotes').doc(data.quoteId).get()
  if (!quoteSnap.exists) {
    throw new HttpsError('not-found', 'Quote not found.')
  }

  const quote           = quoteSnap.data()!
  const callerCompanyId = request.auth.token.companyId as string | undefined
  if (!callerCompanyId || quote.customerId !== callerCompanyId) {
    throw new HttpsError('permission-denied', 'You are not authorised to respond to this quote.')
  }

  if (quote.status !== 'sent') {
    throw new HttpsError(
      'failed-precondition',
      `This quote has already been ${quote.status as string}.`,
    )
  }

  const now = FieldValue.serverTimestamp()

  if (data.response === 'accepted') {
    await db.collection('quotes').doc(data.quoteId).update({
      status:     'accepted',
      acceptedAt: now,
      updatedAt:  now,
    })

    // Apply quoted prices to customer's productPricing subcollection
    const lineItems = (quote.lineItems ?? []) as Array<{ productId: string; unitPrice: number }>
    const eligible  = lineItems.filter(
      (i) => i.productId && i.productId !== 'delivery' && i.productId !== 'rental' && i.unitPrice > 0,
    )
    if (eligible.length > 0) {
      const batch = db.batch()
      for (const item of eligible) {
        const ref = db
          .collection('customers')
          .doc(quote.customerId as string)
          .collection('productPricing')
          .doc(item.productId)
        batch.set(ref, {
          productId: item.productId,
          price:     item.unitPrice,
          source:    'quote',
          quoteId:   data.quoteId,
          setBy:     request.auth.uid,
          setAt:     now,
        })
      }
      await batch.commit()
    }
  } else {
    await db.collection('quotes').doc(data.quoteId).update({
      status:    'declined',
      updatedAt: now,
    })

    // Notify the sales rep who created the quote
    try {
      const createdBy = quote.createdBy as string | undefined
      if (createdBy) {
        const repAuthUser = await adminAuth.getUser(createdBy).catch(() => null)
        const repEmail    = repAuthUser?.email
        if (repEmail) {
          requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY')
          const quoteNum  = (quote.quoteNumber as string) || (data.quoteId as string)
          const total     = `$${((quote.total as number) ?? 0).toFixed(2)}`

          // Resolve the customer / lead name for context
          let entityName = 'the customer'
          if (quote.customerId) {
            const cSnap = await db.collection('customers').doc(quote.customerId as string).get()
            if (cSnap.exists) entityName = (cSnap.data()!.name as string) || entityName
          } else if (quote.leadId) {
            const lSnap = await db.collection('leads').doc(quote.leadId as string).get()
            if (lSnap.exists) {
              const l = lSnap.data()!
              entityName = (l.company as string) || (l.name as string) || entityName
            }
          }

          const quoteLink = `https://app.ogsportal.com/crm/quotes/${data.quoteId}`

          await sendEmail({
            to:      repEmail,
            subject: `Quote #${quoteNum} was declined by ${entityName}`,
            html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
  <div style="background:#E87722;padding:24px 32px 16px">
    <h1 style="margin:0;color:#fff;font-size:20px">Ohio Gas Supply Co.</h1>
    <p style="margin:6px 0 0;color:#ffe0c0;font-size:13px">CRM Notification</p>
  </div>
  <div style="padding:28px 32px 24px;border:1px solid #e8e8e8;border-top:none">
    <p style="margin:0 0 16px;font-size:15px">
      <strong>${entityName}</strong> has <strong style="color:#dc2626">declined</strong> Quote #${quoteNum} (${total}).
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">
      You can revise the quote and re-send it — the quote editor allows edits directly on a declined quote.
    </p>
    <a href="${quoteLink}" clicktracking="off"
       style="display:inline-block;background:#E87722;color:#fff;padding:11px 26px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">
      Open Quote in CRM
    </a>
  </div>
  <div style="padding:12px 32px;background:#f9f9f9;border:1px solid #e8e8e8;border-top:none;text-align:center;font-size:11px;color:#aaa">
    Ohio Gas Supply Co. &nbsp;·&nbsp; ohiogassupply.com
  </div>
</div>`,
          })
          console.log(`[respondToQuote] decline notification sent to ${repEmail} for quote ${data.quoteId as string}`)
        }
      }
    } catch (notifyErr) {
      // Non-fatal — the decline is already saved
      console.warn('[respondToQuote] failed to send decline notification —', notifyErr)
    }
  }

  console.log(`[respondToQuote] quote=${data.quoteId} response=${data.response as string} by=${request.auth.uid}`)
  return { success: true }
})


// ── backfillMissingLeads ───────────────────────────────────────────────────────

export const backfillMissingLeads = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.')
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.')

  const customersSnap = await db.collection('customers').get()
  let created = 0
  let skipped = 0

  for (const doc of customersSnap.docs) {
    const leadRef  = db.collection('leads').doc(doc.id)
    const leadSnap = await leadRef.get()
    if (leadSnap.exists) {
      skipped++
      continue
    }

    const data        = doc.data() as Record<string, unknown>
    const companyName = (data['companyName'] as string | null) ?? (data['name'] as string | null) ?? 'Unknown'
    const contactName = (data['billingContactName'] as string | null) ?? companyName
    const email       = (data['billingEmail'] as string | null) ?? ''
    const phone       = (data['phone'] as string | null) ?? ''
    const now         = FieldValue.serverTimestamp()

    await leadRef.set({
      name:           contactName,
      email,
      phone,
      company:        companyName,
      status:         'pending_setup',
      source:         'Website',
      isWebSignup:    true,
      companyId:      doc.id,
      assignedTo:     null,
      estimatedValue: null,
      notes:          '',
      createdAt:      now,
      updatedAt:      now,
    })
    created++
  }

  console.log(`backfillMissingLeads: created=${created} skipped=${skipped}`)
  return { created, skipped }
})

