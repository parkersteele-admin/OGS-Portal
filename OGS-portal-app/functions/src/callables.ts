/**
 * functions/src/callables.ts
 *
 * generateInvoicePdf — Callable: builds a PDF invoice and stores it in Firebase Storage
 * optimizeRoute      — Callable: calls Google Maps Routes API to reorder run stops
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue, adminAuth } from './admin';
import { GOOGLE_MAPS_KEY, SENDGRID_API_KEY, requireSecret } from './config';
import { performGeocode } from './triggers/geocodeCustomer';
import { generateInvoicePdf as generatePdf } from './pdf/generateInvoicePdf';
import { generateQuotePdf as generateQuotePdfCore } from './pdf/generateQuotePdf';
import { getCompanySettings } from './pdf/companySettings';
import { sendEmail } from './email/sendEmail';
import { normalizeCompanyName, extractDomain } from './utils/companyName';

// ── Shared: resolveOrCreateCustomer ──────────────────────────────────────────

/**
 * Given a leadId, ensures a `customers` document exists that represents the
 * lead.  Resolution order:
 *
 *  1. Lead already has `companyId` → use it.
 *  2. Lead already has `convertedToCustomerId` → use it.
 *  3. Search customers for an exact or fuzzy company-name match.
 *  4. If no match → create a new `customers` doc from the lead data.
 *
 * In all cases the lead is updated with `companyId` + `convertedToCustomerId`
 * so future look-ups skip the search.
 *
 * Returns the customerId (Firestore document ID of the customers doc).
 */
async function resolveOrCreateCustomer(
  leadId: string,
  now: FirebaseFirestore.FieldValue
): Promise<string> {
  const leadSnap = await db.collection('leads').doc(leadId).get();
  if (!leadSnap.exists) throw new Error(`Lead ${leadId} not found`);

  const lead = leadSnap.data()!;

  // ── 1. Already linked on the lead itself ──────────────────────────────────
  const existingId = (lead.companyId ?? lead.convertedToCustomerId) as string | undefined;
  if (existingId) {
    const check = await db.collection('customers').doc(existingId).get();
    if (check.exists) {
      // Ensure both link fields are set
      await leadSnap.ref.update({
        companyId: existingId,
        convertedToCustomerId: existingId,
        updatedAt: now,
      });
      return existingId;
    }
  }

  // ── 2. Search customers for a matching company name or email domain ────────
  const leadCompany = (lead.company ?? lead.name ?? '') as string;
  const leadEmail = (lead.email ?? '') as string;
  const normalized = normalizeCompanyName(leadCompany);
  const domain = extractDomain(leadEmail);

  const customersSnap = await db.collection('customers').get();

  let matchedId: string | null = null;

  for (const doc of customersSnap.docs) {
    const d = doc.data();

    // Exact companyName match (normalized)
    const candidateName = (d.companyName ?? d.name ?? '') as string;
    if (
      candidateName &&
      normalizeCompanyName(candidateName) === normalized &&
      normalized.length > 0
    ) {
      matchedId = doc.id;
      break;
    }

    // Domain match (non-generic email domain)
    if (domain) {
      const candidateEmail = (d.billingEmail ?? d.email ?? '') as string;
      const candidateDomain = extractDomain(candidateEmail);
      if (candidateDomain && candidateDomain === domain) {
        matchedId = doc.id;
        break;
      }
    }
  }

  // ── 3. Create a new customers doc if no match ─────────────────────────────
  if (!matchedId) {
    const companyName = leadCompany || 'Unknown';
    const newRef = db.collection('customers').doc();
    await newRef.set({
      companyId: newRef.id,
      companyName,
      companyNameNormalized: normalized,
      domain: domain ?? null,
      // Flat Customer fields for CRM display/search
      name: companyName,
      email: leadEmail,
      phone: (lead.phone ?? '') as string,
      address: (lead.address ?? '') as string,
      city: (lead.city ?? '') as string,
      state: (lead.state ?? '') as string,
      zip: (lead.zip ?? '') as string,
      billingAddress: {
        street: (lead.address ?? '') as string,
        city: (lead.city ?? '') as string,
        state: (lead.state ?? '') as string,
        zip: (lead.zip ?? '') as string,
      },
      deliveryAddress: null,
      billingEmail: leadEmail,
      billingContactName: (lead.name ?? '') as string,
      generalManagerName: null,
      leadId,
      status: 'active',
      setupStep: 0,
      setupComplete: false,
      paymentMethod: null,
      smsOptIn: false,
      smsPhone: null,
      smsConsentAt: null,
      usageProfile: [],
      businessType: null,
      taxExempt: false,
      taxExemptNumber: null,
      pwaInstallPrompted: false,
      creditLimit: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
    });
    matchedId = newRef.id;
    console.log(`[resolveOrCreateCustomer] created customers/${matchedId} from lead/${leadId}`);
  } else {
    // Ensure the matched customer has leadId set
    const matchedSnap = await db.collection('customers').doc(matchedId).get();
    const matchedData = matchedSnap.data()!;
    const updates: Record<string, unknown> = { updatedAt: now };
    if (!matchedData.leadId) updates.leadId = leadId;
    if (
      matchedData.status === 'inactive' ||
      matchedData.status === 'pending_verification' ||
      matchedData.status === 'pending_quote'
    ) {
      updates.status = 'active';
    }
    await db.collection('customers').doc(matchedId).update(updates);
    console.log(`[resolveOrCreateCustomer] matched lead/${leadId} → customers/${matchedId}`);
  }

  // Back-fill the lead with the resolved companyId
  await leadSnap.ref.update({
    companyId: matchedId,
    convertedToCustomerId: matchedId,
    status: 'won',
    updatedAt: now,
  });

  return matchedId;
}

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
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const data = request.data as Record<string, unknown>;
  if (typeof data.invoiceId !== 'string' || !data.invoiceId) {
    throw new HttpsError('invalid-argument', 'invoiceId must be a non-empty string.');
  }

  // Authorization: owner, admin, or dispatch
  const invoiceSnap = await db.collection('invoices').doc(data.invoiceId).get();
  if (!invoiceSnap.exists) {
    throw new HttpsError('not-found', `Invoice ${data.invoiceId} not found.`);
  }

  const invoice = invoiceSnap.data()!;
  const callerRole = request.auth.token.role as string;
  const isOwner = request.auth.token.customerId === invoice.customerId;

  if (!isOwner && !['admin', 'dispatch'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'You are not authorised to access this invoice.');
  }

  try {
    const url = await generatePdf(data.invoiceId);
    return { url };
  } catch (err) {
    console.error(`generateInvoicePdf callable [${data.invoiceId}]:`, err);
    throw new HttpsError('internal', 'PDF generation failed.');
  }
});

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
export const generateQuotePdf = onCall({ secrets: [SENDGRID_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const callerRole = request.auth.token.role as string;
  if (!['admin', 'sales'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only admin/sales can generate quotes.');
  }

  const data = request.data as Record<string, unknown>;
  if (typeof data.quoteId !== 'string' || !data.quoteId) {
    throw new HttpsError('invalid-argument', 'quoteId must be a non-empty string.');
  }

  const quoteSnap = await db.collection('quotes').doc(data.quoteId).get();
  if (!quoteSnap.exists) {
    throw new HttpsError('not-found', `Quote ${data.quoteId} not found.`);
  }

  let url: string;
  try {
    // If the quote is in 'sent' status, generate and persist the publicToken BEFORE
    // building the PDF so the PDF generator can embed it as a QR code.
    const quoteStatus = (quoteSnap.data()!.status as string) ?? '';
    if (quoteStatus === 'sent' && !quoteSnap.data()!.publicToken) {
      const earlyToken = crypto.randomUUID();
      await db.collection('quotes').doc(data.quoteId).update({ publicToken: earlyToken });
    }
    url = await generateQuotePdfCore(data.quoteId);
  } catch (err) {
    console.error(`generateQuotePdf callable [${data.quoteId}]:`, err);
    throw new HttpsError('internal', 'PDF generation failed.');
  }

  // ── Email the PDF when the quote has been sent ────────────────────────
  const quote = quoteSnap.data()!;
  const isSent = (quote.status as string) === 'sent';
  const quoteNum = (quote.quoteNumber as string) || data.quoteId;
  const validUntil = quote.validUntil
    ? (() => {
        const d =
          typeof quote.validUntil === 'object' && 'toDate' in quote.validUntil
            ? (quote.validUntil as { toDate(): Date }).toDate()
            : new Date(quote.validUntil as string);
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      })()
    : '';

  if (isSent) {
    // Fetch company settings, sales rep info, and email template wording
    const company = await getCompanySettings();

    let repInfo: { name: string; email: string; phone: string } | null = null;
    const repUid = quote.createdBy as string | undefined;
    if (repUid) {
      const repSnap = await db.collection('users').doc(repUid).get();
      if (repSnap.exists) {
        const rd = repSnap.data()!;
        repInfo = {
          name: (rd.name as string) || '',
          email: (rd.email as string) || '',
          phone: (rd.phone as string) || '',
        };
      }
    }

    // Fetch admin-customizable email template wording
    const tplSnap = await db.collection('settings').doc('emailTemplates').get();
    const tpl = tplSnap.exists ? (tplSnap.data() as Record<string, string>) : {};
    const emailIntro =
      tpl.quoteIntro ||
      `Thank you for your interest in ${company.name || 'Ohio Gas Supply'}. Please review your quote below.`;
    const discussNote =
      tpl.quoteDiscussNote ||
      "We want to ensure you're completely happy with our service. Please reach out to us to discuss any adjustments.";

    // Generate a one-time public token so the recipient can accept without logging in.
    // Re-read the quote in case the token was already written before PDF generation.
    const freshSnap = await db
      .collection('quotes')
      .doc(data.quoteId as string)
      .get();
    const freshData = freshSnap.data()!;
    const existingTok = freshData.publicToken as string | undefined;
    const publicToken = existingTok || crypto.randomUUID();
    if (!existingTok) {
      await db
        .collection('quotes')
        .doc(data.quoteId as string)
        .update({ publicToken });
    }

    // Resolve recipient email from customer or lead
    let recipientEmail = '';
    let recipientName = 'Valued Customer';

    if (quote.customerId) {
      const cSnap = await db
        .collection('customers')
        .doc(quote.customerId as string)
        .get();
      if (cSnap.exists) {
        const c = cSnap.data()!;
        recipientEmail = (c.email as string) || '';
        recipientName = (c.name as string) || recipientName;
      }
    } else if (quote.leadId) {
      const lSnap = await db
        .collection('leads')
        .doc(quote.leadId as string)
        .get();
      if (lSnap.exists) {
        const l = lSnap.data()!;
        recipientEmail = (l.email as string) || '';
        recipientName = (l.name as string) || (l.company as string) || recipientName;
      }
    }

    if (recipientEmail) {
      try {
        requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY');
        const total = `$${((quote.total as number) ?? 0).toFixed(2)}`;
        const publicLink = `https://app.ohiogassupply.com/quote/${data.quoteId as string}?token=${publicToken}`;

        // Build line items rows for the estimate table
        const lineItems = (quote.lineItems ?? []) as Array<{
          description: string;
          quantity: number;
          unitPrice: number;
          amount: number;
        }>;
        const lineItemRows = lineItems
          .map(
            (item) =>
              `<tr>
              <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${item.description}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right">${item.quantity}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right">$${item.unitPrice.toFixed(2)}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right">$${item.amount.toFixed(2)}</td>
            </tr>`
          )
          .join('');

        // Fetch the PDF bytes and base64-encode for attachment
        let pdfAttachment: { content: string; filename: string; type: string } | null = null;
        try {
          const pdfRes = await fetch(url);
          const pdfBuffer = await pdfRes.arrayBuffer();
          pdfAttachment = {
            content: Buffer.from(pdfBuffer).toString('base64'),
            filename: `Quote-${quoteNum}.pdf`,
            type: 'application/pdf',
          };
        } catch (fetchErr) {
          console.warn('generateQuotePdf: failed to fetch PDF for attachment —', fetchErr);
        }

        // Sales rep contact block (shown below Accept button instead of a Decline button)
        const repBlockHtml = repInfo
          ? `<div style="margin:20px 0;padding:16px 20px;background:#fff8f3;border-left:3px solid #E87722;border-radius:4px">
                <p style="margin:0 0 6px;font-size:14px;font-weight:bold;color:#333">${repInfo.name ? `Questions? Contact ${repInfo.name}.` : 'Questions? Reach out to us.'}</p>
                <p style="margin:0 0 8px;font-size:13px;color:#555">${discussNote}</p>
                ${repInfo.email ? `<p style="margin:0 0 4px;font-size:13px;color:#555">Email: <a href="mailto:${repInfo.email}" style="color:#E87722">${repInfo.email}</a></p>` : ''}
                ${repInfo.phone ? `<p style="margin:0;font-size:13px;color:#555">Phone: ${repInfo.phone}</p>` : ''}
              </div>`
          : `<p style="margin:20px 0 8px;font-size:13px;color:#666">${discussNote}</p>`;

        // Company footer line — only use fields from settings (no hardcoded phone)
        const footerParts = [company.name, company.website, company.phone].filter(Boolean);
        const footerLine = footerParts.join(' &nbsp;·&nbsp; ');

        await sendEmail({
          to: recipientEmail,
          subject: `Quote #${quoteNum} from ${company.name || 'Ohio Gas Supply'}`,
          attachments: pdfAttachment ? [pdfAttachment] : undefined,
          html: `
<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#333">
  <div style="background:#E87722;padding:24px 32px 16px">
    <h1 style="margin:0;color:#fff;font-size:22px">${company.name || 'Ohio Gas Supply'}</h1>
    ${company.tagline ? `<p style="margin:6px 0 0;color:#ffe0c0;font-size:13px">${company.tagline}</p>` : ''}
  </div>
  <div style="padding:28px 32px 8px;border:1px solid #e8e8e8;border-top:none">
    <p style="margin:0 0 16px">Dear ${recipientName},</p>
    <p style="margin:0 0 20px">${emailIntro}</p>

    <!-- Quote summary -->
    <table style="width:100%;border-collapse:collapse;margin:0 0 4px">
      <tr style="background:#f5f5f5">
        <td style="padding:8px 12px;font-weight:bold">Quote #</td>
        <td style="padding:8px 12px">${quoteNum}</td>
      </tr>
      ${validUntil ? `<tr><td style="padding:8px 12px;font-weight:bold">Valid Until</td><td style="padding:8px 12px">${validUntil}</td></tr>` : ''}
    </table>

    <!-- Line items -->
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
      <thead>
        <tr style="background:#f0f0f0">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#555">Description</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#555">Qty</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#555">Unit Price</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#555">Amount</th>
        </tr>
      </thead>
      <tbody>${lineItemRows}</tbody>
      <tfoot>
        <tr style="background:#f9f9f9">
          <td colspan="3" style="padding:10px 12px;font-weight:bold;text-align:right">Total</td>
          <td style="padding:10px 12px;font-weight:bold;color:#E87722;text-align:right">${total}</td>
        </tr>
      </tfoot>
    </table>

    <!-- Accept button only — no Decline button -->
    <div style="margin:0 0 4px">
      <a href="${publicLink}" clicktracking="off"
         style="display:inline-block;background:#E87722;color:#fff;padding:13px 30px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px">
        ✓ Accept This Quote
      </a>
    </div>

    ${repBlockHtml}

    <p style="margin:16px 0 8px;font-size:13px;color:#666">
      The full quote PDF is attached to this email for your records.
    </p>
  </div>
  <div style="padding:14px 32px;background:#f9f9f9;border:1px solid #e8e8e8;border-top:none;text-align:center;font-size:11px;color:#aaa">
    ${footerLine}
  </div>
</div>`,
        });
        console.log(`generateQuotePdf: quote email sent to ${recipientEmail}`);
      } catch (emailErr) {
        // Log but don't fail the callable — the PDF URL is the primary output
        console.warn('generateQuotePdf: email send failed —', emailErr);
      }
    } else {
      console.warn(
        `generateQuotePdf: no recipient email found for quote ${data.quoteId as string}`
      );
    }
  }

  return { url };
});

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
export const optimizeRoute = onCall({ secrets: [GOOGLE_MAPS_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const callerRole = request.auth.token.role as string;
  if (!['admin', 'dispatch'].includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only admin/dispatch can optimise routes.');
  }

  const data = request.data as Record<string, unknown>;
  if (typeof data.runId !== 'string' || !data.runId) {
    throw new HttpsError('invalid-argument', 'runId must be a non-empty string.');
  }

  const stopsSnap = await db.collection(`runs/${data.runId}/stops`).orderBy('order').get();

  if (stopsSnap.size < 2) {
    throw new HttpsError('failed-precondition', 'A run must have at least 2 stops to optimise.');
  }

  if (stopsSnap.size > 25) {
    // Google Maps Routes API intermediates limit
    throw new HttpsError('failed-precondition', 'Routes API supports at most 25 waypoints.');
  }

  const stops = stopsSnap.docs.map((d) => d.data() as Record<string, unknown>);

  // Build waypoint list: first stop = origin, last = destination, rest = intermediates
  const toWaypoint = (address: unknown) => ({
    address: { addressQuery: { query: address as string } },
  });

  const origin = toWaypoint(stops[0].address);
  const destination = toWaypoint(stops[stops.length - 1].address);
  const intermediates = stops.slice(1, -1).map((s) => toWaypoint(s.address));

  const mapsKey = requireSecret(GOOGLE_MAPS_KEY.value(), 'GOOGLE_MAPS_SERVER_KEY');

  const mapsRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsKey,
      'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex',
    },
    body: JSON.stringify({
      origin,
      destination,
      intermediates,
      travelMode: 'DRIVE',
      optimizeWaypointOrder: true,
      routingPreference: 'TRAFFIC_AWARE',
    }),
  });

  if (!mapsRes.ok) {
    console.error('Google Maps Routes API error:', await mapsRes.text());
    throw new HttpsError('internal', 'Google Maps route optimisation failed.');
  }

  const mapsData = (await mapsRes.json()) as {
    routes?: { optimizedIntermediateWaypointIndex?: number[] }[];
  };

  const optimizedIntermediates = mapsData.routes?.[0]?.optimizedIntermediateWaypointIndex ?? [];

  // Build full optimised index list: origin (0) + reordered intermediates + destination
  const originIdx = 0;
  const destIdx = stops.length - 1;
  const intermediateOriginalIndices = stops.slice(1, -1).map((_, i) => i + 1); // original indices for middle stops

  const optimizedOrder: number[] = [
    originIdx,
    ...optimizedIntermediates.map((i) => intermediateOriginalIndices[i]),
    destIdx,
  ];

  // Write the new `order` values back to Firestore
  const batch = db.batch();
  optimizedOrder.forEach((originalIdx, newPosition) => {
    batch.update(stopsSnap.docs[originalIdx].ref, { order: newPosition });
  });
  await batch.commit();

  return { optimizedOrder };
});

// ── backfillGeocodeCustomers ───────────────────────────────────────────────────

/**
 * One-time admin callable: geocodes all customers missing lat/lng.
 * Safe to call multiple times — skips already-geocoded customers.
 *
 * Access: admin only
 * Output: { processed: number, skipped: number, failed: number }
 */
export const backfillGeocodeCustomers = onCall({ secrets: [GOOGLE_MAPS_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');

  const snap = await db.collection('customers').get();
  let processed = 0,
    skipped = 0,
    failed = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data['lat'] && data['lng'] && data['geocodeStatus'] === 'ok') {
      skipped++;
      continue;
    }
    try {
      await performGeocode(doc.id, data);
      processed++;
    } catch {
      failed++;
    }
  }

  console.log(
    `backfillGeocodeCustomers: processed=${processed} skipped=${skipped} failed=${failed}`
  );
  return { processed, skipped, failed };
});

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
export const respondToQuote = onCall({ secrets: [SENDGRID_API_KEY] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const callerRole = request.auth.token.role as string;
  const portalRoles = ['customer', 'owner', 'manager', 'billing', 'delivery', 'viewer'];
  if (!portalRoles.includes(callerRole)) {
    throw new HttpsError('permission-denied', 'Only portal customers can respond to quotes.');
  }

  const data = request.data as Record<string, unknown>;
  if (typeof data.quoteId !== 'string' || !data.quoteId) {
    throw new HttpsError('invalid-argument', 'quoteId must be a non-empty string.');
  }
  if (data.response !== 'accepted' && data.response !== 'declined') {
    throw new HttpsError('invalid-argument', 'response must be "accepted" or "declined".');
  }

  const quoteSnap = await db.collection('quotes').doc(data.quoteId).get();
  if (!quoteSnap.exists) {
    throw new HttpsError('not-found', 'Quote not found.');
  }

  const quote = quoteSnap.data()!;
  const callerCompanyId = request.auth.token.companyId as string | undefined;

  if (!callerCompanyId) {
    throw new HttpsError('permission-denied', 'No company context found on your account.');
  }

  // Allow acceptance if:
  //  a) the quote is directly assigned to the caller's company, OR
  //  b) the quote was originally sent to a lead that is linked to the caller's company
  //     (identified by customers/{callerCompanyId}.leadId === quote.leadId)
  const quoteCustomerId = quote.customerId as string | undefined;
  const quoteLeadId = quote.leadId as string | undefined;

  let effectiveCustomerId = quoteCustomerId ?? callerCompanyId;

  if (quoteCustomerId && quoteCustomerId !== callerCompanyId) {
    // Direct customerId mismatch — check if the caller's company is the same entity
    // under a different ID (e.g. OGS-created record vs. portal self-signup record)
    const callerCompSnap = await db.collection('customers').doc(callerCompanyId).get();
    const callerComp = callerCompSnap.data();
    const callerLeadId = callerComp?.leadId as string | undefined;

    const isLinked = quoteLeadId && callerLeadId && quoteLeadId === callerLeadId;
    if (!isLinked) {
      throw new HttpsError('permission-denied', 'You are not authorised to respond to this quote.');
    }
    // If both have the same leadId, treat as same entity
    effectiveCustomerId = callerCompanyId;
  } else if (!quoteCustomerId && quoteLeadId) {
    // Quote was sent to a lead — verify caller's company has that leadId,
    // OR auto-resolve via company-name matching and set it.
    const callerCompSnap = await db.collection('customers').doc(callerCompanyId).get();
    const callerComp = callerCompSnap.data();
    const callerLeadId = callerComp?.leadId as string | undefined;

    if (callerLeadId && callerLeadId === quoteLeadId) {
      // Already linked — use caller's company
      effectiveCustomerId = callerCompanyId;
    } else {
      // Try fuzzy company-name match: does the lead belong to the caller's company?
      const leadSnap = await db.collection('leads').doc(quoteLeadId).get();
      const leadData = leadSnap.data();
      const leadCompany = leadData ? ((leadData.company ?? leadData.name ?? '') as string) : '';
      const callerName = (callerComp?.companyName ?? callerComp?.name ?? '') as string;
      const leadNorm = normalizeCompanyName(leadCompany);
      const callerNorm = normalizeCompanyName(callerName);

      if (leadNorm.length > 0 && leadNorm === callerNorm) {
        // Names match — link the lead to the caller's company and proceed
        await db
          .collection('customers')
          .doc(callerCompanyId)
          .update({ leadId: quoteLeadId, updatedAt: FieldValue.serverTimestamp() });
        effectiveCustomerId = callerCompanyId;
      } else {
        throw new HttpsError(
          'permission-denied',
          'You are not authorised to respond to this quote.'
        );
      }
    }
  }

  if (quote.status !== 'sent') {
    throw new HttpsError(
      'failed-precondition',
      `This quote has already been ${quote.status as string}.`
    );
  }

  const now = FieldValue.serverTimestamp();

  if (data.response === 'accepted') {
    // Update the quote — link customerId if it was previously a lead-only quote
    await db.collection('quotes').doc(data.quoteId).update({
      status: 'accepted',
      acceptedAt: now,
      updatedAt: now,
      customerId: effectiveCustomerId,
    });

    // Activate the customer in the CRM (move from inactive/pending to active)
    try {
      await db.collection('customers').doc(effectiveCustomerId).update({
        status: 'active',
        updatedAt: now,
      });
    } catch (statusErr) {
      console.warn('[respondToQuote] failed to activate customer —', statusErr);
    }

    // Apply quoted prices to customer's productPricing subcollection
    const lineItems = (quote.lineItems ?? []) as Array<{
      productId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;
    const eligible = lineItems.filter(
      (i) =>
        i.productId && i.productId !== 'delivery' && i.productId !== 'rental' && i.unitPrice > 0
    );
    if (eligible.length > 0) {
      const batch = db.batch();
      for (const item of eligible) {
        const ref = db
          .collection('customers')
          .doc(effectiveCustomerId)
          .collection('productPricing')
          .doc(item.productId);
        batch.set(ref, {
          productId: item.productId,
          price: item.unitPrice,
          source: 'quote',
          quoteId: data.quoteId,
          setBy: request.auth.uid,
          setAt: now,
        });
      }
      await batch.commit();
    }

    // Create a 'sent' invoice from the accepted quote so it appears as an open invoice on the customer record.
    let quoteInvoiceId: string | null = null;
    try {
      const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 30);
      const rawLineItems = (quote.lineItems ?? []) as Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        amount: number;
      }>;
      const invoiceLineItems = rawLineItems.map(({ description, quantity, unitPrice, amount }) => ({
        description,
        quantity,
        unitPrice,
        amount,
      }));
      const invoiceDoc: Record<string, unknown> = {
        invoiceNumber,
        customerId: effectiveCustomerId,
        quoteId: data.quoteId as string,
        status: 'sent',
        lineItems: invoiceLineItems,
        subtotal: (quote.subtotal as number) ?? 0,
        tax: (quote.tax as number) ?? 0,
        total: (quote.total as number) ?? 0,
        issuedAt: now,
        dueAt,
        createdAt: now,
        updatedAt: now,
      };
      if (quote.quoteNumber) invoiceDoc.quoteNumber = quote.quoteNumber as string;
      if (quote.leadId) invoiceDoc.leadId = quote.leadId as string;
      const invoiceRef = await db.collection('invoices').add(invoiceDoc);
      quoteInvoiceId = invoiceRef.id;
      console.log(
        `[respondToQuote] invoice ${quoteInvoiceId} created for quote ${data.quoteId as string}`
      );
    } catch (invoiceErr) {
      console.warn('[respondToQuote] failed to create invoice from accepted quote —', invoiceErr);
    }

    // Flag the quote so staff know to set up a standing order, and link the new invoice.
    const quoteUpdate: Record<string, unknown> = { needsOrderSetup: true, updatedAt: now };
    if (quoteInvoiceId) quoteUpdate.invoiceId = quoteInvoiceId;
    await db
      .collection('quotes')
      .doc(data.quoteId as string)
      .update(quoteUpdate);
    console.log(
      `[respondToQuote] quote ${data.quoteId as string} accepted — invoice ${quoteInvoiceId ?? 'n/a'} created, needs order setup`
    );

    // Generate a portal setup link so staff can share a QR code with the customer.
    if (effectiveCustomerId) {
      try {
        const custSnap = await db.collection('customers').doc(effectiveCustomerId).get();
        if (custSnap.exists && !custSnap.data()!.setupComplete && !custSnap.data()!.setupToken) {
          const setupToken = crypto.randomUUID();
          const setupTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await custSnap.ref.update({ setupToken, setupTokenExpiry, updatedAt: now });
          console.log(
            `[respondToQuote] setup token generated for customers/${effectiveCustomerId}`
          );
        }
      } catch (setupErr) {
        console.warn('[respondToQuote] failed to generate setup token —', setupErr);
      }
    }

    // Notify the sales rep of the acceptance
    try {
      const createdBy = quote.createdBy as string | undefined;
      if (createdBy) {
        const repAuthUser = await adminAuth.getUser(createdBy).catch(() => null);
        const repEmail = repAuthUser?.email;
        const quoteNum = (quote.quoteNumber as string) || (data.quoteId as string);
        const total = `$${((quote.total as number) ?? 0).toFixed(2)}`;

        let entityName = 'the customer';
        if (effectiveCustomerId) {
          const cSnap = await db.collection('customers').doc(effectiveCustomerId).get();
          if (cSnap.exists) entityName = (cSnap.data()!.name as string) || entityName;
        } else if (quote.leadId) {
          const lSnap = await db
            .collection('leads')
            .doc(quote.leadId as string)
            .get();
          if (lSnap.exists) {
            const l = lSnap.data()!;
            entityName = (l.company as string) || (l.name as string) || entityName;
          }
        }

        // In-app notification
        await db.collection('notifications').add({
          userId: createdBy,
          type: 'quote_accepted',
          title: `Quote #${quoteNum} accepted`,
          body: `${entityName} accepted Quote #${quoteNum} (${total}). Set up their standing order.`,
          link: `/crm/quotes/${data.quoteId as string}`,
          entityId: data.quoteId,
          priority: 'high',
          read: false,
          createdAt: now,
        });

        // Email notification
        if (repEmail) {
          requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY');
          const company = await getCompanySettings();
          const quoteLink = `https://app.ohiogassupply.com/crm/quotes/${data.quoteId as string}`;
          await sendEmail({
            to: repEmail,
            subject: `✓ Quote #${quoteNum} was ACCEPTED by ${entityName}`,
            html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
  <div style="background:#16a34a;padding:24px 32px 16px">
    <h1 style="margin:0;color:#fff;font-size:20px">${company.name || 'Ohio Gas Supply'}</h1>
    <p style="margin:6px 0 0;color:#bbf7d0;font-size:13px">Quote Accepted</p>
  </div>
  <div style="padding:28px 32px 24px;border:1px solid #e8e8e8;border-top:none">
    <p style="margin:0 0 16px;font-size:15px">
      <strong>${entityName}</strong> has <strong style="color:#16a34a">accepted</strong> Quote #${quoteNum} (${total}).
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">
      Next step: set up their standing delivery order in the portal.
    </p>
    <a href="${quoteLink}" clicktracking="off"
       style="display:inline-block;background:#E87722;color:#fff;padding:11px 26px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">
      Open Quote in CRM
    </a>
  </div>
  <div style="padding:12px 32px;background:#f9f9f9;border:1px solid #e8e8e8;border-top:none;text-align:center;font-size:11px;color:#aaa">
    ${company.name || 'Ohio Gas Supply'}${company.website ? ` &nbsp;·&nbsp; ${company.website}` : ''}
  </div>
</div>`,
          });
          console.log(
            `[respondToQuote] acceptance notification sent to ${repEmail} for quote ${data.quoteId as string}`
          );
        }
      }
    } catch (notifyErr) {
      console.warn('[respondToQuote] failed to send acceptance notification —', notifyErr);
    }
  } else {
    await db.collection('quotes').doc(data.quoteId).update({
      status: 'declined',
      updatedAt: now,
    });

    // Notify the sales rep who created the quote
    try {
      const createdBy = quote.createdBy as string | undefined;
      if (createdBy) {
        const repAuthUser = await adminAuth.getUser(createdBy).catch(() => null);
        const repEmail = repAuthUser?.email;
        if (repEmail) {
          requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY');
          const quoteNum = (quote.quoteNumber as string) || (data.quoteId as string);
          const total = `$${((quote.total as number) ?? 0).toFixed(2)}`;

          // Resolve the customer / lead name for context
          let entityName = 'the customer';
          if (quote.customerId) {
            const cSnap = await db
              .collection('customers')
              .doc(quote.customerId as string)
              .get();
            if (cSnap.exists) entityName = (cSnap.data()!.name as string) || entityName;
          } else if (quote.leadId) {
            const lSnap = await db
              .collection('leads')
              .doc(quote.leadId as string)
              .get();
            if (lSnap.exists) {
              const l = lSnap.data()!;
              entityName = (l.company as string) || (l.name as string) || entityName;
            }
          }

          const quoteLink = `https://app.ohiogassupply.com/crm/quotes/${data.quoteId as string}`;

          await sendEmail({
            to: repEmail,
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
          });
          console.log(
            `[respondToQuote] decline notification sent to ${repEmail} for quote ${data.quoteId as string}`
          );
        }
      }
    } catch (notifyErr) {
      // Non-fatal — the decline is already saved
      console.warn('[respondToQuote] failed to send decline notification —', notifyErr);
    }
  }

  console.log(
    `[respondToQuote] quote=${data.quoteId} response=${data.response as string} by=${request.auth.uid}`
  );
  return { success: true };
});

// ── backfillMissingLeads ───────────────────────────────────────────────────────

export const backfillMissingLeads = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');

  const customersSnap = await db.collection('customers').get();
  let created = 0;
  let skipped = 0;

  for (const doc of customersSnap.docs) {
    const leadRef = db.collection('leads').doc(doc.id);
    const leadSnap = await leadRef.get();
    if (leadSnap.exists) {
      skipped++;
      continue;
    }

    const data = doc.data() as Record<string, unknown>;
    const companyName =
      (data['companyName'] as string | null) ?? (data['name'] as string | null) ?? 'Unknown';
    const contactName = (data['billingContactName'] as string | null) ?? companyName;
    const email = (data['billingEmail'] as string | null) ?? '';
    const phone = (data['phone'] as string | null) ?? '';
    const now = FieldValue.serverTimestamp();

    await leadRef.set({
      name: contactName,
      email,
      phone,
      company: companyName,
      status: 'pending_setup',
      source: 'Website',
      isWebSignup: true,
      companyId: doc.id,
      assignedTo: null,
      estimatedValue: null,
      notes: '',
      createdAt: now,
      updatedAt: now,
    });
    created++;
  }

  console.log(`backfillMissingLeads: created=${created} skipped=${skipped}`);
  return { created, skipped };
});

// ── matchLeadsToCustomers ─────────────────────────────────────────────────────

/**
 * Admin-only: scans all leads and attempts to match each unlinked lead to an
 * existing `customers` doc via fuzzy company-name / email-domain matching.
 * Leads that have no existing customer are left alone (they become customers
 * only when their quote is accepted).
 *
 * Also scans customers that have no leadId and tries to find a lead match.
 *
 * Input:  {} (no parameters)
 * Output: { linked: number, skipped: number }
 */
export const matchLeadsToCustomers = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');

  const [leadsSnap, customersSnap] = await Promise.all([
    db.collection('leads').get(),
    db.collection('customers').get(),
  ]);

  const now = FieldValue.serverTimestamp();

  // Build lookup maps: normalized name → customerId, and domain → customerId
  const nameToCustomer = new Map<string, string>();
  const domainToCustomer = new Map<string, string>();

  for (const doc of customersSnap.docs) {
    const d = doc.data();
    const name = normalizeCompanyName((d.companyName ?? d.name ?? '') as string);
    if (name) nameToCustomer.set(name, doc.id);

    const email = (d.billingEmail ?? d.email ?? '') as string;
    const domain = extractDomain(email);
    if (domain) domainToCustomer.set(domain, doc.id);
  }

  let linked = 0;
  let skipped = 0;

  for (const leadDoc of leadsSnap.docs) {
    const lead = leadDoc.data();

    // Skip leads already fully linked
    if (lead.companyId && lead.convertedToCustomerId) {
      skipped++;
      continue;
    }

    const leadCompany = (lead.company ?? lead.name ?? '') as string;
    const leadEmail = (lead.email ?? '') as string;
    const normalized = normalizeCompanyName(leadCompany);
    const domain = extractDomain(leadEmail);

    let matchedCustomerId: string | null = null;

    // Name match
    if (normalized && nameToCustomer.has(normalized)) {
      matchedCustomerId = nameToCustomer.get(normalized)!;
    }
    // Domain match (fallback)
    if (!matchedCustomerId && domain && domainToCustomer.has(domain)) {
      matchedCustomerId = domainToCustomer.get(domain)!;
    }

    if (!matchedCustomerId) {
      skipped++;
      continue;
    }

    // Link lead ↔ customer
    const batch = db.batch();
    batch.update(leadDoc.ref, {
      companyId: matchedCustomerId,
      convertedToCustomerId: matchedCustomerId,
      updatedAt: now,
    });
    const custRef = db.collection('customers').doc(matchedCustomerId);
    batch.update(custRef, {
      leadId: leadDoc.id,
      updatedAt: now,
    });
    await batch.commit();

    linked++;
    console.log(
      `[matchLeadsToCustomers] linked lead/${leadDoc.id} (${leadCompany}) → customers/${matchedCustomerId}`
    );
  }

  // Second pass: customers with no leadId — search leads for a name match
  for (const custDoc of customersSnap.docs) {
    const cust = custDoc.data();
    if (cust.leadId) continue; // already linked

    const custName = normalizeCompanyName((cust.companyName ?? cust.name ?? '') as string);
    const custEmail = (cust.billingEmail ?? cust.email ?? '') as string;
    const custDomain = extractDomain(custEmail);

    for (const leadDoc of leadsSnap.docs) {
      const lead = leadDoc.data();
      const leadName = normalizeCompanyName((lead.company ?? lead.name ?? '') as string);
      const leadEmail2 = (lead.email ?? '') as string;
      const leadDomain = extractDomain(leadEmail2);

      const nameHit = custName.length > 0 && custName === leadName;
      const domainHit = custDomain && leadDomain && custDomain === leadDomain;

      if (nameHit || domainHit) {
        const batch = db.batch();
        batch.update(custDoc.ref, { leadId: leadDoc.id, updatedAt: now });
        batch.update(leadDoc.ref, {
          companyId: custDoc.id,
          convertedToCustomerId: custDoc.id,
          updatedAt: now,
        });
        await batch.commit();
        linked++;
        console.log(
          `[matchLeadsToCustomers] reverse-linked customers/${custDoc.id} → lead/${leadDoc.id}`
        );
        break;
      }
    }
  }

  console.log(`matchLeadsToCustomers: linked=${linked} skipped=${skipped}`);
  return { linked, skipped };
});

// ── getPublicQuote ─────────────────────────────────────────────────────────────

/**
 * Returns a sanitized quote for public email-link viewing.
 * No authentication required — access is gated by the one-time publicToken
 * that is generated when a quote is sent.
 *
 * Input:  { quoteId: string, token: string }
 * Output: { quote, company, rep, discussNote }
 */
export const getPublicQuote = onCall(async (request) => {
  const data = request.data as Record<string, unknown>;
  const quoteId = data.quoteId as string | undefined;
  const token = data.token as string | undefined;

  if (!quoteId || !token) {
    throw new HttpsError('invalid-argument', 'quoteId and token are required.');
  }

  const quoteSnap = await db.collection('quotes').doc(quoteId).get();
  if (!quoteSnap.exists) {
    throw new HttpsError('not-found', 'Quote not found.');
  }

  const quote = quoteSnap.data()!;
  if (!quote.publicToken || quote.publicToken !== token) {
    throw new HttpsError('permission-denied', 'Invalid or expired link.');
  }

  const company = await getCompanySettings();

  // Sales rep info
  let rep: { name: string; email: string; phone: string } | null = null;
  const repUid = (quote.createdBy ?? quote.assignedTo) as string | undefined;
  if (repUid) {
    const repSnap = await db.collection('users').doc(repUid).get();
    if (repSnap.exists) {
      const rd = repSnap.data()!;
      rep = {
        name: (rd.name as string) || '',
        email: (rd.email as string) || '',
        phone: (rd.phone as string) || '',
      };
    }
  }

  const tplSnap = await db.collection('settings').doc('emailTemplates').get();
  const tpl = tplSnap.exists ? (tplSnap.data() as Record<string, string>) : {};
  const discussNote =
    tpl.quoteDiscussNote ||
    "We want to ensure you're completely happy with our service. Please reach out to discuss any adjustments.";

  // If already accepted, return the setup URL so the page can show the QR code
  let setupUrl: string | null = null;
  if (quote.status === 'accepted' && quote.customerId) {
    try {
      const custSnap = await db
        .collection('customers')
        .doc(quote.customerId as string)
        .get();
      if (custSnap.exists) {
        const cd = custSnap.data()!;
        if (cd.setupToken && !cd.setupComplete) {
          setupUrl = `https://app.ohiogassupply.com/join/${cd.setupToken as string}`;
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  return {
    quote: {
      id: quoteId,
      quoteNumber: (quote.quoteNumber as string) ?? '',
      status: (quote.status as string) ?? 'sent',
      validUntil: quote.validUntil ?? null,
      lineItems: (quote.lineItems ?? []) as Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        amount: number;
      }>,
      subtotal: (quote.subtotal as number) ?? 0,
      total: (quote.total as number) ?? 0,
      notes: (quote.notes as string) || '',
    },
    company: {
      name: company.name || '',
      tagline: company.tagline || '',
      phone: company.phone || '',
      email: company.email || '',
      website: company.website || '',
      logoUrl: company.logoUrl || '',
    },
    rep,
    discussNote,
    setupUrl,
  };
});

// ── respondToQuotePublic ───────────────────────────────────────────────────────

/**
 * Allows a lead/prospect to accept a quote directly from an email link
 * without needing a portal account. Access is gated by the publicToken.
 *
 * Input:  { quoteId: string, token: string, response: 'accepted' }
 * Output: { success: true }
 */
export const respondToQuotePublic = onCall({ secrets: [SENDGRID_API_KEY] }, async (request) => {
  const data = request.data as Record<string, unknown>;
  const quoteId = data.quoteId as string | undefined;
  const token = data.token as string | undefined;
  const resp = data.response as string | undefined;

  if (!quoteId || !token) {
    throw new HttpsError('invalid-argument', 'quoteId and token are required.');
  }
  if (resp !== 'accepted') {
    throw new HttpsError('invalid-argument', 'response must be "accepted".');
  }

  const quoteSnap = await db.collection('quotes').doc(quoteId).get();
  if (!quoteSnap.exists) {
    throw new HttpsError('not-found', 'Quote not found.');
  }

  const quote = quoteSnap.data()!;
  if (!quote.publicToken || quote.publicToken !== token) {
    throw new HttpsError('permission-denied', 'Invalid or expired link.');
  }
  if (quote.status !== 'sent') {
    throw new HttpsError(
      'failed-precondition',
      `This quote has already been ${quote.status as string}.`
    );
  }

  const now = FieldValue.serverTimestamp();
  await db.collection('quotes').doc(quoteId).update({
    status: 'accepted',
    acceptedAt: now,
    updatedAt: now,
    acceptedVia: 'public-link',
  });

  // Resolve or create the customer record for this quote.
  // resolveOrCreateCustomer does fuzzy name+domain matching and will create
  // a customers doc from lead data if no match exists.  It also marks the
  // lead as 'won' and sets companyId / convertedToCustomerId on the lead.
  let effectiveCustomerId: string | null = (quote.customerId as string | undefined) || null;

  if (quote.leadId) {
    try {
      const resolvedId = await resolveOrCreateCustomer(quote.leadId as string, now);
      effectiveCustomerId = resolvedId;
      // Back-fill the quote's customerId so future portal look-ups work
      if (!quote.customerId || quote.customerId !== resolvedId) {
        await db.collection('quotes').doc(quoteId).update({ customerId: resolvedId });
      }
    } catch (resolveErr) {
      console.warn('[respondToQuotePublic] failed to resolve customer from lead —', resolveErr);
    }
  }

  // Activate the customer in the CRM now that they've accepted a quote
  if (effectiveCustomerId) {
    try {
      await db.collection('customers').doc(effectiveCustomerId).update({
        status: 'active',
        updatedAt: now,
      });
    } catch (statusErr) {
      console.warn('[respondToQuotePublic] failed to activate customer —', statusErr);
    }
  }

  // Apply quoted prices to customer's productPricing subcollection
  // (same logic as respondToQuote — needed so portal shows correct pricing)
  if (effectiveCustomerId) {
    try {
      const lineItems = (quote.lineItems ?? []) as Array<{
        productId: string;
        description: string;
        quantity: number;
        unitPrice: number;
        amount: number;
      }>;
      const eligible = lineItems.filter(
        (i) =>
          i.productId && i.productId !== 'delivery' && i.productId !== 'rental' && i.unitPrice > 0
      );
      if (eligible.length > 0) {
        const pricingBatch = db.batch();
        for (const item of eligible) {
          const ref = db
            .collection('customers')
            .doc(effectiveCustomerId)
            .collection('productPricing')
            .doc(item.productId);
          pricingBatch.set(ref, {
            productId: item.productId,
            price: item.unitPrice,
            source: 'quote',
            quoteId,
            setAt: now,
          });
        }
        await pricingBatch.commit();
      }
    } catch (pricingErr) {
      console.warn('[respondToQuotePublic] failed to write productPricing —', pricingErr);
    }
  }

  // Create a 'sent' invoice from the accepted quote so it appears as an open invoice on the customer record.
  let quoteInvoiceId: string | null = null;
  if (effectiveCustomerId) {
    try {
      const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 30);
      const rawLineItems = (quote.lineItems ?? []) as Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        amount: number;
      }>;
      const invoiceLineItems = rawLineItems.map(({ description, quantity, unitPrice, amount }) => ({
        description,
        quantity,
        unitPrice,
        amount,
      }));
      const invoiceDoc: Record<string, unknown> = {
        invoiceNumber,
        customerId: effectiveCustomerId,
        quoteId,
        status: 'sent',
        lineItems: invoiceLineItems,
        subtotal: (quote.subtotal as number) ?? 0,
        tax: (quote.tax as number) ?? 0,
        total: (quote.total as number) ?? 0,
        issuedAt: now,
        dueAt,
        createdAt: now,
        updatedAt: now,
      };
      if (quote.quoteNumber) invoiceDoc.quoteNumber = quote.quoteNumber as string;
      if (quote.leadId) invoiceDoc.leadId = quote.leadId as string;
      const invoiceRef = await db.collection('invoices').add(invoiceDoc);
      quoteInvoiceId = invoiceRef.id;
      console.log(`[respondToQuotePublic] invoice ${quoteInvoiceId} created for quote ${quoteId}`);
    } catch (invoiceErr) {
      console.warn(
        '[respondToQuotePublic] failed to create invoice from accepted quote —',
        invoiceErr
      );
    }
  }

  // Flag the quote so staff know to set up a standing order, and link the new invoice.
  const quoteUpdate: Record<string, unknown> = { needsOrderSetup: true, updatedAt: now };
  if (quoteInvoiceId) quoteUpdate.invoiceId = quoteInvoiceId;
  await db.collection('quotes').doc(quoteId).update(quoteUpdate);
  console.log(
    `[respondToQuotePublic] quote ${quoteId} accepted via public link — invoice ${quoteInvoiceId ?? 'n/a'} created, needs order setup`
  );

  // Generate a portal setup link and return it so the public quote page can
  // immediately show the QR code + button to the customer.
  let setupUrl: string | null = null;
  if (effectiveCustomerId) {
    try {
      const custSnap = await db.collection('customers').doc(effectiveCustomerId).get();
      if (custSnap.exists) {
        const cd = custSnap.data()!;
        let finalToken: string;
        if (cd.setupToken && !cd.setupComplete) {
          finalToken = cd.setupToken as string;
        } else if (!cd.setupComplete) {
          finalToken = crypto.randomUUID();
          const setupTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await custSnap.ref.update({ setupToken: finalToken, setupTokenExpiry, updatedAt: now });
        } else {
          finalToken = '';
        }
        if (finalToken) {
          setupUrl = `https://app.ohiogassupply.com/join/${finalToken}`;
        }
      }
      if (setupUrl)
        console.log(`[respondToQuotePublic] setup link ready for customers/${effectiveCustomerId}`);
    } catch (setupErr) {
      console.warn('[respondToQuotePublic] failed to generate setup token —', setupErr);
    }
  }

  // Notify the sales rep (email + in-app)
  try {
    const repUid = quote.createdBy as string | undefined;
    if (repUid) {
      const repAuthUser = await adminAuth.getUser(repUid).catch(() => null);
      const repEmail = repAuthUser?.email;
      const quoteNum = (quote.quoteNumber as string) || quoteId;
      const total = `$${((quote.total as number) ?? 0).toFixed(2)}`;

      let entityName = 'the customer';
      if (effectiveCustomerId) {
        const cSnap = await db.collection('customers').doc(effectiveCustomerId).get();
        if (cSnap.exists)
          entityName =
            (cSnap.data()!.name as string) || (cSnap.data()!.companyName as string) || entityName;
      } else if (quote.leadId) {
        const lSnap = await db
          .collection('leads')
          .doc(quote.leadId as string)
          .get();
        if (lSnap.exists) {
          const l = lSnap.data()!;
          entityName = (l.company as string) || (l.name as string) || entityName;
        }
      }

      // In-app notification
      await db.collection('notifications').add({
        userId: repUid,
        type: 'quote_accepted',
        title: `Quote #${quoteNum} accepted`,
        body: `${entityName} accepted Quote #${quoteNum} (${total}) via email link. Set up their standing order.`,
        link: `/crm/quotes/${quoteId}`,
        entityId: quoteId,
        priority: 'high',
        read: false,
        createdAt: now,
      });

      // Email notification
      if (repEmail) {
        requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY');
        const company = await getCompanySettings();
        const quoteLink = `https://app.ohiogassupply.com/crm/quotes/${quoteId}`;
        await sendEmail({
          to: repEmail,
          subject: `✓ Quote #${quoteNum} was ACCEPTED by ${entityName}`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
  <div style="background:#16a34a;padding:24px 32px 16px">
    <h1 style="margin:0;color:#fff;font-size:20px">${company.name || 'Ohio Gas Supply'}</h1>
    <p style="margin:6px 0 0;color:#bbf7d0;font-size:13px">Quote Accepted</p>
  </div>
  <div style="padding:28px 32px 24px;border:1px solid #e8e8e8;border-top:none">
    <p style="margin:0 0 16px;font-size:15px">
      <strong>${entityName}</strong> has <strong style="color:#16a34a">accepted</strong> Quote #${quoteNum} (${total}).
    </p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">
      This acceptance was submitted via the email link (no portal login required). Next step: set up their standing delivery order.
    </p>
    <a href="${quoteLink}" clicktracking="off"
       style="display:inline-block;background:#E87722;color:#fff;padding:11px 26px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">
      Open Quote in CRM
    </a>
  </div>
  <div style="padding:12px 32px;background:#f9f9f9;border:1px solid #e8e8e8;border-top:none;text-align:center;font-size:11px;color:#aaa">
    ${company.name || 'Ohio Gas Supply'}${company.website ? ` &nbsp;·&nbsp; ${company.website}` : ''}
  </div>
</div>`,
        });
        console.log(
          `[respondToQuotePublic] acceptance notification sent to ${repEmail} for quote ${quoteId}`
        );
      }
    }
  } catch (notifyErr) {
    console.warn('[respondToQuotePublic] failed to send notification —', notifyErr);
  }

  // Send confirmation email to the customer with setup link + QR code
  if (setupUrl) {
    try {
      let recipientEmail = '';
      if (effectiveCustomerId) {
        const cSnap = await db.collection('customers').doc(effectiveCustomerId).get();
        if (cSnap.exists) recipientEmail = (cSnap.data()!.email as string) || '';
      } else if (quote.leadId) {
        const lSnap = await db
          .collection('leads')
          .doc(quote.leadId as string)
          .get();
        if (lSnap.exists) recipientEmail = (lSnap.data()!.email as string) || '';
      }
      if (recipientEmail) {
        requireSecret(SENDGRID_API_KEY.value(), 'SENDGRID_API_KEY');
        const company = await getCompanySettings();
        const quoteNum = (quote.quoteNumber as string) || quoteId;
        const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setupUrl)}&color=1e293b&bgcolor=ffffff`;
        await sendEmail({
          to: recipientEmail,
          subject: `You're confirmed — set up your ${company.name || 'OGS'} portal account`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
  <div style="background:#E87722;padding:24px 32px 16px">
    <h1 style="margin:0;color:#fff;font-size:20px">${company.name || 'Ohio Gas Supply'}</h1>
    <p style="margin:6px 0 0;color:#fde8d0;font-size:13px">Quote #${quoteNum} Accepted</p>
  </div>
  <div style="padding:28px 32px 24px;border:1px solid #e8e8e8;border-top:none">
    <p style="margin:0 0 8px;font-size:16px;font-weight:bold">Thank you!</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">
      Your quote has been accepted. To manage your orders, view invoices, and track deliveries,
      create your free portal account using the button or QR code below.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${setupUrl}" clicktracking="off"
         style="display:inline-block;background:#E87722;color:#fff;padding:13px 32px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px">
        Set Up My Portal Account
      </a>
    </div>
    <div style="text-align:center;margin:24px 0 8px">
      <p style="margin:0 0 12px;font-size:12px;color:#888">Or scan this QR code on your phone</p>
      <img src="${qrImgUrl}" alt="Account setup QR code" width="180" height="180"
           style="display:block;margin:0 auto;border:1px solid #e2e8f0;border-radius:6px;padding:6px" />
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#aaa;text-align:center">This link is valid for 30 days.</p>
  </div>
  <div style="padding:12px 32px;background:#f9f9f9;border:1px solid #e8e8e8;border-top:none;text-align:center;font-size:11px;color:#aaa">
    ${company.name || 'Ohio Gas Supply'}${company.website ? ` &nbsp;·&nbsp; ${company.website}` : ''}
  </div>
</div>`,
        });
        console.log(`[respondToQuotePublic] customer setup email sent to ${recipientEmail}`);
      }
    } catch (custEmailErr) {
      console.warn('[respondToQuotePublic] failed to send customer setup email —', custEmailErr);
    }
  }

  return { success: true, setupUrl: setupUrl ?? null };
});
