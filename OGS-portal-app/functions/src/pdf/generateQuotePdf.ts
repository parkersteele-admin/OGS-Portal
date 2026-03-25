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
import { db, storage, FieldValue } from '../admin'
import { getCompanySettings, fetchLogoBuffer } from './companySettings'
import type { CompanySettings } from './companySettings'

// ── Brand constants (shared with invoice PDF) ─────────────────────────────────

const OGS_ORANGE  = '#E87722'
const PAGE_W      = 612
const PAGE_H      = 792
const MARGIN_L    = 58
const RIGHT_EDGE  = PAGE_W - 40
const CONTENT_W   = RIGHT_EDGE - MARGIN_L

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
  const pdfBuffer = await buildQuotePdf(quoteId, quote, recipient, company, logoBuf)

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

  return downloadUrl
}

// ── PDF builder ───────────────────────────────────────────────────────────────

function buildQuotePdf(
  quoteId:   string,
  quote:     Record<string, unknown>,
  recipient: Record<string, unknown>,
  company:   CompanySettings,
  logoBuf:   Buffer | null,
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

    // ── Left accent bar ────────────────────────────────────────────────────
    doc.rect(0, 0, 8, PAGE_H).fill(OGS_ORANGE)

    // ── Company header ──────────────────────────────────────────────────
    // Logo (top-left, max 120 × 50 pt) — placed before text so text renders on top if needed
    if (logoBuf) {
      try {
        doc.image(logoBuf, MARGIN_L, 34, { fit: [120, 50] })
      } catch { /* ignore malformed image */ }
    }

    const nameY = logoBuf ? 92 : 40
    doc
      .fontSize(logoBuf ? 13 : 17)
      .font('Helvetica-Bold')
      .fillColor('#111111')
      .text(company.name || 'OGS Gas Services', MARGIN_L, nameY)

    let headerY = nameY + (logoBuf ? 16 : 23)
    if (company.tagline) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#666666').text(company.tagline, MARGIN_L, headerY)
      headerY += 11
    }
    const contactLine = [company.phone, company.email].filter(Boolean).join('  ·  ')
    if (contactLine) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#666666').text(contactLine, MARGIN_L, headerY)
      headerY += 11
    }
    if (company.website) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#666666').text(company.website, MARGIN_L, headerY)
      headerY += 11
    }

    // ── "QUOTE" title ──────────────────────────────────────────────────────
    doc
      .fontSize(30)
      .font('Helvetica-Bold')
      .fillColor(OGS_ORANGE)
      .text('QUOTE', 0, 40, { align: 'right', width: RIGHT_EDGE })

    const quoteNum = (quote.quoteNumber as string) || quoteId.slice(-8).toUpperCase()

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555555')
      .text(`#${quoteNum}`, 0, 78, { align: 'right', width: RIGHT_EDGE })

    // Divider sits below whichever side is tallest (company info left, title+num right)
    const DIVIDER_Y = Math.max(headerY + 12, 108)

    // ── Orange divider ─────────────────────────────────────────────────────
    doc
      .moveTo(MARGIN_L, DIVIDER_Y)
      .lineTo(RIGHT_EDGE, DIVIDER_Y)
      .strokeColor(OGS_ORANGE)
      .lineWidth(1.5)
      .stroke()

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
    const TABLE_TOP = 226
    const C_DESC    = MARGIN_L
    const C_QTY     = 358
    const C_RATE    = 425
    const C_AMT     = 496
    const AMT_W     = RIGHT_EDGE - C_AMT
    const HDR_H     = 20

    doc.rect(C_DESC, TABLE_TOP, CONTENT_W, HDR_H).fill('#F4F4F4')

    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .fillColor('#444444')
      .text('DESCRIPTION', C_DESC + 4, TABLE_TOP + 6, { width: C_QTY - C_DESC - 8 })
      .text('QTY',         C_QTY,      TABLE_TOP + 6, { width: C_RATE - C_QTY - 4,  align: 'right' })
      .text('UNIT PRICE',  C_RATE,     TABLE_TOP + 6, { width: C_AMT  - C_RATE - 4, align: 'right' })
      .text('AMOUNT',      C_AMT,      TABLE_TOP + 6, { width: AMT_W,               align: 'right' })

    doc
      .moveTo(C_DESC, TABLE_TOP + HDR_H)
      .lineTo(RIGHT_EDGE, TABLE_TOP + HDR_H)
      .strokeColor('#DDDDDD')
      .lineWidth(0.5)
      .stroke()

    const lineItems = (quote.lineItems as Array<{
      description: string
      quantity:    number
      unitPrice:   number
      amount:      number
    }>) ?? []

    let rowY = TABLE_TOP + HDR_H + 8

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i]

      if (i % 2 === 1) {
        doc.rect(C_DESC, rowY - 3, CONTENT_W, 17).fill('#FAFAFA')
      }

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#222222')
        .text(item.description,         C_DESC + 4, rowY, { width: C_QTY - C_DESC - 12 })
        .text(String(item.quantity),     C_QTY,      rowY, { width: C_RATE - C_QTY - 4,  align: 'right' })
        .text(fmtMoney(item.unitPrice),  C_RATE,     rowY, { width: C_AMT  - C_RATE - 4, align: 'right' })
        .text(fmtMoney(item.amount),     C_AMT,      rowY, { width: AMT_W,               align: 'right' })

      rowY += 18
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

    // ── Info box ───────────────────────────────────────────────────────────
    const BOX_H = 66
    doc
      .rect(C_DESC, rowY, CONTENT_W, BOX_H)
      .fillAndStroke('#FFF8F3', OGS_ORANGE)
      .lineWidth(0.75)

    doc
      .fontSize(8.5)
      .font('Helvetica-Bold')
      .fillColor(OGS_ORANGE)
      .text('TO ACCEPT THIS QUOTE', C_DESC + 12, rowY + 10)

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#333333')
      .text(`Valid until:    ${fmtDate(quote.validUntil)}`, C_DESC + 12, rowY + 24)
      .text(`Reply to this email or call  ${company.phone || company.email || ''}`, C_DESC + 12, rowY + 38)
      .text(`Questions?  ${company.email || company.phone || ''}`, C_DESC + 12, rowY + 52)

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

    // ── Terms & Conditions ─────────────────────────────────────────────────
    if (company.termsAndConditions) {
      rowY += 8
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#999999')
        .text('TERMS & CONDITIONS', C_DESC, rowY)
      rowY += 12
      doc.fontSize(7.5).font('Helvetica').fillColor('#555555')
        .text(company.termsAndConditions, C_DESC, rowY, { width: CONTENT_W })
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    const FOOTER_Y = 748

    doc
      .moveTo(C_DESC, FOOTER_Y)
      .lineTo(RIGHT_EDGE, FOOTER_Y)
      .strokeColor('#DDDDDD')
      .lineWidth(0.5)
      .stroke()

    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#111111')
      .text(`Thank you for considering ${company.name || 'us'}.`, C_DESC, FOOTER_Y + 8, {
        align: 'center',
        width: CONTENT_W,
      })

    const footerLine = [
      company.name,
      company.website,
      company.phone,
    ].filter(Boolean).join('  ·  ')
    doc
      .fontSize(7.5)
      .font('Helvetica')
      .fillColor('#888888')
      .text(footerLine || ' ', C_DESC, FOOTER_Y + 22, { align: 'center', width: CONTENT_W })

    doc.end()
  })
}
