/**
 * functions/src/pdf/generateInvoicePdf.ts
 *
 * Builds an OGS-branded PDF invoice, uploads to Firebase Storage, persists the
 * signed download URL to Firestore, and returns that URL.
 *
 * Storage path:  ogs-portal/invoices/{customerId}/{invoiceId}.pdf
 * Signed URL:    valid 7 days
 *
 * Usage:
 *   import { generateInvoicePdf } from '../pdf/generateInvoicePdf'
 *   const url = await generateInvoicePdf(invoiceId)
 */

import PDFDocument from 'pdfkit'
import { db, storage, FieldValue } from '../admin'
import { getCompanySettings } from './companySettings'
import type { CompanySettings } from './companySettings'

// ── Brand constants ──────────────────────────────────────────────────────────

const OGS_ORANGE  = '#E87722'
const PAGE_W      = 612                  // letter width (pt)
const PAGE_H      = 792                  // letter height (pt)
const MARGIN_L    = 58                   // left content start (after accent bar)
const RIGHT_EDGE  = PAGE_W - 40         // right content end
const CONTENT_W   = RIGHT_EDGE - MARGIN_L

// ── Public entry-point ───────────────────────────────────────────────────────

/**
 * Generates the PDF for a Firestore invoice document and uploads it to Storage.
 *
 * @param invoiceId  Firestore document ID in the `invoices` collection.
 * @returns          A 7-day signed download URL.
 * @throws           If the invoice document does not exist (everything else is
 *                   caught internally so this function never throws silently).
 */
export async function generateInvoicePdf(invoiceId: string): Promise<string> {
  // ── Fetch invoice ──────────────────────────────────────────────────────────
  const invoiceSnap = await db.collection('invoices').doc(invoiceId).get()
  if (!invoiceSnap.exists) {
    throw new Error(`generateInvoicePdf: invoice ${invoiceId} not found`)
  }
  const invoice    = invoiceSnap.data()!
  const customerId = (invoice.customerId as string | null) ?? null

  // ── Fetch customer ─────────────────────────────────────────────────────────
  let customer: Record<string, unknown> = {}
  if (customerId) {
    const snap = await db.collection('customers').doc(customerId).get()
    if (snap.exists) customer = snap.data()!
  }

  // ── Build PDF bytes ────────────────────────────────────────────────────────
  const pdfBuffer = await buildInvoicePdf(invoiceId, invoice, customer, await getCompanySettings())

  // ── Upload to Firebase Storage ─────────────────────────────────────────────
  const storagePath = `ogs-portal/invoices/${customerId ?? '_unknown'}/${invoiceId}.pdf`
  const fileRef     = storage.bucket().file(storagePath)

  // Store the PDF with a stable Firebase Storage download token.
  // Using a download token avoids the signBlob IAM permission required by getSignedUrl().
  const downloadToken = crypto.randomUUID()
  await fileRef.save(pdfBuffer, {
    contentType: 'application/pdf',
    metadata: {
      cacheControl: 'private, max-age=0',
      metadata: { invoiceId, customerId: customerId ?? '', firebaseStorageDownloadTokens: downloadToken },
    },
  })

  const bucket      = storage.bucket().name
  const encodedPath = encodeURIComponent(storagePath)
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`

  // ── Persist to Firestore ───────────────────────────────────────────────────
  await invoiceSnap.ref.update({
    pdfUrl:    downloadUrl,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return downloadUrl
}

// ── PDF builder ───────────────────────────────────────────────────────────────

function buildInvoicePdf(
  invoiceId: string,
  invoice:   Record<string, unknown>,
  customer:  Record<string, unknown>,
  company:   CompanySettings,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 0, size: 'LETTER' })
    const chunks: Buffer[] = []

    doc.on('data',  (c: Buffer) => chunks.push(c))
    doc.on('end',   ()          => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // ── Utility helpers ────────────────────────────────────────────────────
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

    // ── Company header (left, y = 40) ──────────────────────────────────────
    doc
      .fontSize(17)
      .font('Helvetica-Bold')
      .fillColor('#111111')
      .text(company.name || 'OGS Gas Services', MARGIN_L, 40)

    let headerY = 63
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
    }

    // ── "INVOICE" title (right, y = 40) ───────────────────────────────────
    doc
      .fontSize(30)
      .font('Helvetica-Bold')
      .fillColor(OGS_ORANGE)
      .text('INVOICE', 0, 40, { align: 'right', width: RIGHT_EDGE })

    const invoiceNum = (invoice.invoiceNumber as string) || invoiceId.slice(-8).toUpperCase()

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555555')
      .text(`#${invoiceNum}`, 0, 78, { align: 'right', width: RIGHT_EDGE })

    // ── Orange accent divider ──────────────────────────────────────────────
    doc
      .moveTo(MARGIN_L, 108)
      .lineTo(RIGHT_EDGE, 108)
      .strokeColor(OGS_ORANGE)
      .lineWidth(1.5)
      .stroke()

    // ── Section labels ─────────────────────────────────────────────────────
    const META_X = 380    // right column x-start for invoice meta

    doc
      .fontSize(7)
      .font('Helvetica-Bold')
      .fillColor('#999999')
      .text('BILL TO', MARGIN_L, 118)
      .text('INVOICE DETAILS', META_X, 118)

    // ── Bill-to block ──────────────────────────────────────────────────────
    const custName  = (customer.name    as string) || '—'
    const custEmail = (customer.email   as string) || ''
    const custPhone = (customer.phone   as string) || ''
    const custAddr  = (customer.address as string) || ''
    const cityLine  = [
      customer.city  as string,
      customer.state as string,
      customer.zip   as string,
    ].filter(Boolean).join(', ')

    let leftY = 131

    doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#111111').text(custName, MARGIN_L, leftY)
    leftY += 15

    if (custAddr) {
      doc.fontSize(9).font('Helvetica').fillColor('#333333').text(custAddr, MARGIN_L, leftY)
      leftY += 13
    }
    if (cityLine) {
      doc.fontSize(9).font('Helvetica').fillColor('#333333').text(cityLine, MARGIN_L, leftY)
      leftY += 13
    }
    if (custEmail) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#555555').text(custEmail, MARGIN_L, leftY)
      leftY += 12
    }
    if (custPhone) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#555555').text(custPhone, MARGIN_L, leftY)
    }

    // ── Invoice meta block (right column) ─────────────────────────────────
    const metaRows: [string, string][] = [
      ['Invoice #',   invoiceNum],
      ['Date Issued', fmtDate(invoice.issuedAt)],
      ['Due Date',    fmtDate(invoice.dueAt)],
      ['Status',      ((invoice.status as string) || 'pending').toUpperCase()],
    ]

    let rightY = 131
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
    const AMT_W     = RIGHT_EDGE - C_AMT    // ~76
    const HDR_H     = 20

    // Header background
    doc.rect(C_DESC, TABLE_TOP, CONTENT_W, HDR_H).fill('#F4F4F4')

    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .fillColor('#444444')
      .text('DESCRIPTION', C_DESC + 4, TABLE_TOP + 6, { width: C_QTY - C_DESC - 8 })
      .text('QTY',         C_QTY,      TABLE_TOP + 6, { width: C_RATE - C_QTY - 4, align: 'right' })
      .text('UNIT PRICE',  C_RATE,     TABLE_TOP + 6, { width: C_AMT  - C_RATE - 4, align: 'right' })
      .text('AMOUNT',      C_AMT,      TABLE_TOP + 6, { width: AMT_W,               align: 'right' })

    // Header bottom rule
    doc
      .moveTo(C_DESC, TABLE_TOP + HDR_H)
      .lineTo(RIGHT_EDGE, TABLE_TOP + HDR_H)
      .strokeColor('#DDDDDD')
      .lineWidth(0.5)
      .stroke()

    const lineItems = (invoice.lineItems as Array<{
      description: string
      quantity:    number
      unitPrice:   number
      total:       number
    }>) ?? []

    let rowY = TABLE_TOP + HDR_H + 8

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i]

      // Zebra stripe
      if (i % 2 === 1) {
        doc.rect(C_DESC, rowY - 3, CONTENT_W, 17).fill('#FAFAFA')
      }

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#222222')
        .text(item.description,               C_DESC + 4, rowY, { width: C_QTY - C_DESC - 12 })
        .text(String(item.quantity),           C_QTY,      rowY, { width: C_RATE - C_QTY - 4,  align: 'right' })
        .text(fmtMoney(item.unitPrice),        C_RATE,     rowY, { width: C_AMT  - C_RATE - 4, align: 'right' })
        .text(fmtMoney(item.total),            C_AMT,      rowY, { width: AMT_W,               align: 'right' })

      rowY += 18
    }

    // Table bottom rule
    rowY += 4
    doc
      .moveTo(C_DESC, rowY)
      .lineTo(RIGHT_EDGE, rowY)
      .strokeColor('#CCCCCC')
      .lineWidth(0.75)
      .stroke()
    rowY += 12

    // ── Totals (right-aligned block) ───────────────────────────────────────
    const TOT_LBL_X = 370
    const TOT_LBL_W = 110
    const TOT_VAL_X = 490
    const TOT_VAL_W = RIGHT_EDGE - TOT_VAL_X   // ~82

    const subtotal    = (invoice.subtotal    as number) ?? 0
    const taxAmount   = (invoice.taxAmount   as number) ?? 0
    const taxRate     = (invoice.taxRate     as number) ?? 0
    const totalAmount = (invoice.totalAmount as number) ?? 0
    const taxLabel    = taxRate > 0 ? `Tax (${(taxRate * 100).toFixed(0)}%)` : 'Tax'

    doc.fontSize(9).font('Helvetica').fillColor('#444444')

    doc
      .text('Subtotal', TOT_LBL_X, rowY, { width: TOT_LBL_W, align: 'right' })
      .text(fmtMoney(subtotal), TOT_VAL_X, rowY, { width: TOT_VAL_W, align: 'right' })
    rowY += 14

    doc
      .text(taxLabel, TOT_LBL_X, rowY, { width: TOT_LBL_W, align: 'right' })
      .text(fmtMoney(taxAmount), TOT_VAL_X, rowY, { width: TOT_VAL_W, align: 'right' })
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
      .text('Total Due', TOT_LBL_X, rowY, { width: TOT_LBL_W, align: 'right' })
      .text(fmtMoney(totalAmount), TOT_VAL_X, rowY, { width: TOT_VAL_W, align: 'right' })

    rowY += 36

    // ── Payment information box ────────────────────────────────────────────
    const BOX_Y = rowY
    const BOX_H = 76

    // Light orange fill + orange border
    doc
      .rect(C_DESC, BOX_Y, CONTENT_W, BOX_H)
      .fillAndStroke('#FFF8F3', OGS_ORANGE)
      .lineWidth(0.75)

    doc
      .fontSize(8.5)
      .font('Helvetica-Bold')
      .fillColor(OGS_ORANGE)
      .text('PAYMENT INFORMATION', C_DESC + 12, BOX_Y + 10)

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#333333')
      .text(`Due Date:     ${fmtDate(invoice.dueAt)}`,                     C_DESC + 12, BOX_Y + 24)
      .text('Pay online at:  ohiogassupply.com/portal/invoices',            C_DESC + 12, BOX_Y + 38)
      .text('Questions?    1-800-OGS-FUEL  ·  billing@ohiogassupply.com',  C_DESC + 12, BOX_Y + 52)

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
      .text('Thank you for your business.', C_DESC, FOOTER_Y + 8, {
        align: 'center',
        width: CONTENT_W,
      })

    doc
      .fontSize(7.5)
      .font('Helvetica')
      .fillColor('#888888')
      .text(
        'Ohio Gas Supply Co.  ·  ohiogassupply.com  ·  1-800-OGS-FUEL',
        C_DESC,
        FOOTER_Y + 22,
        { align: 'center', width: CONTENT_W },
      )

    doc.end()
  })
}
