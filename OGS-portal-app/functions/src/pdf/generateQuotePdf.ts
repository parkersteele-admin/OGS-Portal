/**
 * functions/src/pdf/generateQuotePdf.ts
 *
 * Builds an OGS-branded PDF quote, uploads it to Firebase Storage, persists
 * the signed download URL to Firestore, and returns that URL.
 *
 * Storage path:  ogs-portal/quotes/{quoteId}.pdf
 * Signed URL:    valid 7 days
 */

import PDFDocument from 'pdfkit'
import * as https from 'https'
import * as http from 'http'
import { db, storage, FieldValue } from '../admin'
import { getCompanySettings, fetchLogoBuffer } from './companySettings'
import type { CompanySettings } from './companySettings'
import { registerGeneratedFile } from '../files/registerGeneratedFile'
import {
  CONTENT_W,
  FOOTER_Y,
  MARGIN_L,
  OGS_ORANGE,
  RIGHT_EDGE,
  drawBrandedFooter,
  drawBrandedHeader,
  newBrandedPage,
} from './layout'

// ── Public entry-point ────────────────────────────────────────────────────────

/**
 * Generates the PDF for a Firestore quote document and uploads it to Storage.
 *
 * @param quoteId  Firestore document ID in the `quotes` collection.
 * @returns        A 7-day signed download URL.
 */
export async function generateQuotePdf(quoteId: string): Promise<string> {
  const quoteSnap = await db.collection('quotes').doc(quoteId).get()
  if (!quoteSnap.exists) {
    throw new Error(`generateQuotePdf: quote ${quoteId} not found`)
  }
  const quote = quoteSnap.data()!

  // Fetch customer or lead for bill-to block
  let recipient: Record<string, unknown> = {}
  if (quote.customerId) {
    const snap = await db.collection('customers').doc(quote.customerId as string).get()
    if (snap.exists) recipient = snap.data()!
  } else if (quote.leadId) {
    const snap = await db.collection('leads').doc(quote.leadId as string).get()
    if (snap.exists) recipient = snap.data()!
  }

  const company   = await getCompanySettings()
  const logoBuf   = await fetchLogoBuffer(company.logoUrl)

  // Build QR code image for the "accept / setup" link in the PDF.
  // Use the setupToken URL if present (quote accepted), otherwise the public quote link.
  let qrBuf: Buffer | null = null
  const setupToken  = quote.setupToken  as string | undefined
  const publicToken = quote.publicToken as string | undefined
  let qrUrl: string | null = null
  if (setupToken) {
    qrUrl = `https://app.ohiogassupply.com/join/${setupToken}`
  } else if (publicToken) {
    qrUrl = `https://app.ohiogassupply.com/quote/${quoteId}?token=${publicToken}`
  }
  if (qrUrl) {
    qrBuf = await fetchImageBuffer(`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}&color=1e293b&bgcolor=ffffff`)
  }

  // Fetch assigned sales rep (createdBy field holds the rep's UID)
  let salesRep: { name: string; email: string; phone: string } | null = null
  const repUid = (quote.createdBy ?? quote.assignedTo) as string | undefined
  if (repUid) {
    const repSnap = await db.collection('users').doc(repUid).get()
    if (repSnap.exists) {
      const d = repSnap.data()!
      salesRep = {
        name:  (d.name  as string) || '',
        email: (d.email as string) || '',
        phone: (d.phone as string) || '',
      }
    }
  }

  const pdfBuffer = await buildQuotePdf(quoteId, quote, recipient, company, logoBuf, salesRep, qrBuf, qrUrl)

  const storagePath = `ogs-portal/quotes/${quoteId}.pdf`
  const fileRef     = storage.bucket().file(storagePath)

  // Store the PDF with a stable Firebase Storage download token.
  // Using a download token avoids the signBlob IAM permission required by getSignedUrl().
  const downloadToken = crypto.randomUUID()
  await fileRef.save(pdfBuffer, {
    contentType: 'application/pdf',
    metadata:    { cacheControl: 'private, max-age=0', metadata: { quoteId, firebaseStorageDownloadTokens: downloadToken } },
  })

  const bucket      = storage.bucket().name
  const encodedPath = encodeURIComponent(storagePath)
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`

  await quoteSnap.ref.update({
    pdfUrl:    downloadUrl,
    updatedAt: FieldValue.serverTimestamp(),
  })

  const customerId = quote.customerId as string | undefined
  await registerGeneratedFile({
    targets: [
      { entityType: 'quote', entityId: quoteId },
      ...(customerId ? [{ entityType: 'customer' as const, entityId: customerId }] : []),
    ],
    fileType: 'quote',
    url: downloadUrl,
    storagePath,
    fileName: `Quote-${(quote.quoteNumber as string | undefined) || quoteId}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: pdfBuffer.length,
    metadata: {
      linkedEntityType: 'quote',
      linkedEntityId: quoteId,
      customerId: customerId ?? null,
    },
  })

  return downloadUrl
}

// ── Fetch image buffer (QR codes, etc.) ──────────────────────────────────────

function fetchImageBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) { resolve(null); return }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end',  () => resolve(Buffer.concat(chunks)))
      res.on('error', () => resolve(null))
    }).on('error', () => resolve(null))
  })
}

// ── PDF builder ───────────────────────────────────────────────────────────────

function buildQuotePdf(
  quoteId:   string,
  quote:     Record<string, unknown>,
  recipient: Record<string, unknown>,
  company:   CompanySettings,
  logoBuf:   Buffer | null,
  salesRep:  { name: string; email: string; phone: string } | null,
  qrBuf:     Buffer | null = null,
  qrUrl:     string | null = null,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'LETTER' })
    const chunks: Buffer[] = []

    doc.on('data',  (c: Buffer) => chunks.push(c))
    doc.on('end',   ()          => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // ── Helpers ────────────────────────────────────────────────────────────

    function toDate(val: unknown): Date | null {
      if (!val) return null
      if (val instanceof Date) return val
      if (typeof val === 'object' && 'toDate' in (val as object)) {
        return (val as { toDate(): Date }).toDate()
      }
      return null
    }

    function fmtDate(val: unknown): string {
      const d = toDate(val)
      return d
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—'
    }

    function fmtMoney(val: unknown): string {
      return `$${((val as number) ?? 0).toFixed(2)}`
    }

    const quoteNum = (quote.quoteNumber as string) || quoteId.slice(-8).toUpperCase()
    const referenceText = `#${quoteNum}`
    const DIVIDER_Y = drawBrandedHeader(doc, company, logoBuf, 'QUOTE', referenceText)

    // ── Section labels ─────────────────────────────────────────────────────
    const META_X = 380

    doc
      .fontSize(7)
      .font('Helvetica-Bold')
      .fillColor('#999999')
      .text('BILL TO', MARGIN_L, DIVIDER_Y + 10)
      .text('QUOTE DETAILS', META_X, DIVIDER_Y + 10)

    // ── Bill-to block ──────────────────────────────────────────────────────
    const recName  = (recipient.name    as string) || (recipient.company as string) || '—'
    const recEmail = (recipient.email   as string) || ''
    const recPhone = (recipient.phone   as string) || ''
    const recAddr  = (recipient.address as string) || ''
    const cityLine = [
      recipient.city  as string,
      recipient.state as string,
      recipient.zip   as string,
    ].filter(Boolean).join(', ')

    let leftY = DIVIDER_Y + 23

    doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#111111').text(recName, MARGIN_L, leftY)
    leftY += 15

    if (recAddr) {
      doc.fontSize(9).font('Helvetica').fillColor('#333333').text(recAddr, MARGIN_L, leftY)
      leftY += 13
    }
    if (cityLine) {
      doc.fontSize(9).font('Helvetica').fillColor('#333333').text(cityLine, MARGIN_L, leftY)
      leftY += 13
    }
    if (recEmail) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#555555').text(recEmail, MARGIN_L, leftY)
      leftY += 12
    }
    if (recPhone) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#555555').text(recPhone, MARGIN_L, leftY)
    }

    // ── Quote meta block ───────────────────────────────────────────────────
    const metaRows: [string, string][] = [
      ['Quote #',     quoteNum],
      ['Date Issued', fmtDate(quote.createdAt)],
      ['Valid Until', fmtDate(quote.validUntil)],
      ['Status',      ((quote.status as string) || 'draft').toUpperCase()],
    ]

    let rightY = DIVIDER_Y + 23
    const META_LBL_W = 80
    const META_VAL_X = META_X + META_LBL_W + 4

    for (const [label, value] of metaRows) {
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#888888')
        .text(label, META_X, rightY, { width: META_LBL_W })

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#111111')
        .text(value, META_VAL_X, rightY, { width: RIGHT_EDGE - META_VAL_X })

      rightY += 16
    }

    // ── Line items table ───────────────────────────────────────────────────
    // TABLE_TOP must sit below both the bill-to block (leftY) and the meta
    // block (rightY), plus a small gap. Use a minimum of 226 to keep a
    // reasonable top margin when the header content is short.
    const TABLE_TOP = Math.max(226, Math.max(leftY, rightY) + 18)
    const C_DESC    = MARGIN_L
    const C_QTY     = 358
    const C_RATE    = 425
    const C_AMT     = 496
    const AMT_W     = RIGHT_EDGE - C_AMT
    const HDR_H     = 20

    const drawTableHeader = (tableTop: number) => {
      doc.rect(C_DESC, tableTop, CONTENT_W, HDR_H).fill('#F4F4F4')

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#444444')
        .text('DESCRIPTION', C_DESC + 4, tableTop + 6, { width: C_QTY - C_DESC - 8 })
        .text('QTY',         C_QTY,      tableTop + 6, { width: C_RATE - C_QTY - 4,  align: 'right' })
        .text('UNIT PRICE',  C_RATE,     tableTop + 6, { width: C_AMT  - C_RATE - 4, align: 'right' })
        .text('AMOUNT',      C_AMT,      tableTop + 6, { width: AMT_W,               align: 'right' })

      doc
        .moveTo(C_DESC, tableTop + HDR_H)
        .lineTo(RIGHT_EDGE, tableTop + HDR_H)
        .strokeColor('#DDDDDD')
        .lineWidth(0.5)
        .stroke()
    }

    drawTableHeader(TABLE_TOP)

    const lineItems = (quote.lineItems as Array<{
      description: string
      quantity:    number
      unitPrice:   number
      amount:      number
    }>) ?? []

    let rowY = TABLE_TOP + HDR_H + 8

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i]
      const descWidth = C_QTY - C_DESC - 12
      const descriptionHeight = doc.heightOfString(item.description, { width: descWidth })
      const rowHeight = Math.max(18, descriptionHeight + 4)

      if (rowY + rowHeight > FOOTER_Y - 170) {
        const nextDividerY = newBrandedPage(doc, company, logoBuf, 'QUOTE', referenceText)
        doc
          .fontSize(7)
          .font('Helvetica-Bold')
          .fillColor('#999999')
          .text('LINE ITEMS', MARGIN_L, nextDividerY + 10)
        drawTableHeader(nextDividerY + 24)
        rowY = nextDividerY + 24 + HDR_H + 8
      }

      if (i % 2 === 1) {
        doc.rect(C_DESC, rowY - 3, CONTENT_W, rowHeight).fill('#FAFAFA')
      }

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#222222')
        .text(item.description,         C_DESC + 4, rowY, { width: descWidth })
        .text(String(item.quantity),     C_QTY,      rowY, { width: C_RATE - C_QTY - 4,  align: 'right' })
        .text(fmtMoney(item.unitPrice),  C_RATE,     rowY, { width: C_AMT  - C_RATE - 4, align: 'right' })
        .text(fmtMoney(item.amount),     C_AMT,      rowY, { width: AMT_W,               align: 'right' })

      rowY += rowHeight
    }

    rowY += 4
    doc
      .moveTo(C_DESC, rowY)
      .lineTo(RIGHT_EDGE, rowY)
      .strokeColor('#CCCCCC')
      .lineWidth(0.75)
      .stroke()
    rowY += 12

    // ── Totals ─────────────────────────────────────────────────────────────
    const TOT_LBL_X = 370
    const TOT_LBL_W = 110
    const TOT_VAL_X = 490
    const TOT_VAL_W = RIGHT_EDGE - TOT_VAL_X

    const subtotal = (quote.subtotal as number) ?? 0
    const total    = (quote.total    as number) ?? 0

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#444444')
      .text('Subtotal', TOT_LBL_X, rowY, { width: TOT_LBL_W, align: 'right' })
      .text(fmtMoney(subtotal), TOT_VAL_X, rowY, { width: TOT_VAL_W, align: 'right' })

    rowY += 10
    doc
      .moveTo(TOT_LBL_X, rowY)
      .lineTo(RIGHT_EDGE, rowY)
      .strokeColor('#AAAAAA')
      .lineWidth(0.5)
      .stroke()
    rowY += 9

    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('#111111')
      .text('Quote Total', TOT_LBL_X, rowY, { width: TOT_LBL_W, align: 'right' })
      .text(fmtMoney(total), TOT_VAL_X, rowY, { width: TOT_VAL_W, align: 'right' })

    rowY += 36

    // ── Notes box (if present) ─────────────────────────────────────────────
    const notesText = (quote.notes as string | undefined) || ''
    if (notesText) {
      const notesHeight = doc.heightOfString(notesText, { width: CONTENT_W })
      if (rowY + 30 + notesHeight > FOOTER_Y - 140) {
        const nextDividerY = newBrandedPage(doc, company, logoBuf, 'QUOTE', referenceText)
        rowY = nextDividerY + 18
      }
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#999999')
        .text('NOTES & TERMS', C_DESC, rowY)

      rowY += 14

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#333333')
        .text(notesText, C_DESC, rowY, { width: CONTENT_W })

      rowY += doc.heightOfString(notesText, { width: CONTENT_W }) + 16
    }

    // ── Info box — "To Accept This Quote" + Sales Rep (+ QR code) ───────────
    const hasRep    = !!(salesRep?.name)
    const repContact = hasRep
      ? [salesRep!.phone, salesRep!.email].filter(Boolean).join('  ·  ')
      : ''
    const hasQr = !!(qrBuf && qrUrl)
    // Width of the QR block when present (80pt image + 12pt right margin)
    const QR_BLOCK_W = hasQr ? 96 : 0
    // Height: base rows + optional rep block, same as before
    const BOX_H = hasRep ? 148 : 66

    if (rowY + BOX_H + 24 > FOOTER_Y - 10) {
      const nextDividerY = newBrandedPage(doc, company, logoBuf, 'QUOTE', referenceText)
      rowY = nextDividerY + 18
    }

    doc
      .rect(C_DESC, rowY, CONTENT_W, BOX_H)
      .fillAndStroke('#FFF8F3', OGS_ORANGE)
      .lineWidth(0.75)

    // ── QR code block on the right of the info box ─────────────────────────
    const TEXT_CONTENT_W = CONTENT_W - QR_BLOCK_W - 24
    if (hasQr && qrBuf) {
      const QR_SIZE  = 72
      const QR_X     = RIGHT_EDGE - QR_BLOCK_W + 4
      const QR_Y     = rowY + (BOX_H - QR_SIZE - 18) / 2
      try {
        doc.image(qrBuf, QR_X, QR_Y, { width: QR_SIZE, height: QR_SIZE })
      } catch { /* non-fatal */ }
      // Small "Scan to accept" label below QR
      doc
        .fontSize(6.5)
        .font('Helvetica')
        .fillColor('#888888')
        .text('Scan to accept', QR_X, QR_Y + QR_SIZE + 3, { width: QR_SIZE, align: 'center' })
    }

    // Row 1: section title
    doc
      .fontSize(8.5)
      .font('Helvetica-Bold')
      .fillColor(OGS_ORANGE)
      .text('TO ACCEPT THIS QUOTE', C_DESC + 12, rowY + 10)

    // Row 2–3: acceptance instructions
    const contactDetail = company.phone || company.email || ''
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#333333')
      .text(`This quote is valid until:  ${fmtDate(quote.validUntil)}`, C_DESC + 12, rowY + 26)
      .text(
        contactDetail
          ? `To accept this quote, please contact your account representative. You can also reach us at ${contactDetail}.`
          : 'To accept this quote, please contact your account representative directly.',
        C_DESC + 12, rowY + 40,
        { width: TEXT_CONTENT_W },
      )

    if (hasRep) {
      // Thin divider separating acceptance text from rep section
      doc
        .moveTo(C_DESC + 12, rowY + 58)
        .lineTo(RIGHT_EDGE - 12, rowY + 58)
        .strokeColor(OGS_ORANGE)
        .lineWidth(0.4)
        .stroke()

      // "YOUR ACCOUNT REPRESENTATIVE" label
      doc
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .fillColor('#999999')
        .text('YOUR ACCOUNT REPRESENTATIVE', C_DESC + 12, rowY + 66)

      // Rep name
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#111111')
        .text(salesRep!.name, C_DESC + 12, rowY + 79)

      // Rep contact (phone · email)
      if (repContact) {
        doc
          .fontSize(8.5)
          .font('Helvetica')
          .fillColor('#555555')
          .text(repContact, C_DESC + 12, rowY + 93)
      }

      // Personal closing line
      doc
        .fontSize(9)
        .font('Helvetica-Oblique')
        .fillColor(OGS_ORANGE)
        .text(
          'We look forward to doing business with you!',
          C_DESC + 12, rowY + 112,
          { width: CONTENT_W - 24 },
        )
    }

    // ── Portal links below info box ────────────────────────────────────────
    rowY += BOX_H + 12
    if (company.portalLoginUrl || company.portalSignupUrl) {
      if (company.portalLoginUrl) {
        doc.fontSize(8).font('Helvetica').fillColor('#555555')
          .text(`Log in to your account:  ${company.portalLoginUrl}`, C_DESC, rowY)
        rowY += 13
      }
      if (company.portalSignupUrl) {
        doc.fontSize(8).font('Helvetica').fillColor('#555555')
          .text(`Create an account:  ${company.portalSignupUrl}`, C_DESC, rowY)
        rowY += 13
      }
    }

    // ── Footer (Page 1) ────────────────────────────────────────────────────
    drawBrandedFooter(doc, company, `Thank you for considering ${company.name || 'us'}.`)

    // ── Page 2: Terms & Conditions ──────────────────────────────────────────
    if (company.termsAndConditions) {
      const pageTwoDividerY = newBrandedPage(doc, company, logoBuf, 'TERMS & CONDITIONS', referenceText)

      // T&C body text
      doc
        .fontSize(8.5)
        .font('Helvetica')
        .fillColor('#333333')
        .text(company.termsAndConditions, MARGIN_L, pageTwoDividerY + 16, {
          width: CONTENT_W,
          lineGap: 2,
        })

      // Page 2 footer
      drawBrandedFooter(doc, company, 'Terms & conditions for this quote.')
    }

    doc.end()
  })
}
