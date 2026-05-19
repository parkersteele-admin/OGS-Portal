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
import { getCompanySettings, fetchLogoBuffer, fetchOfficialDocumentLogoSvg } from './companySettings'
import type { CompanySettings } from './companySettings'
import { registerGeneratedFile } from '../files/registerGeneratedFile'
import {
  CONTENT_W,
  FOOTER_Y,
  MARGIN_L,
  OGS_BRAND_BLUE,
  OGS_BRAND_BLUE_LIGHT,
  RIGHT_EDGE,
  drawBrandedFooter,
  drawBrandedHeader,
  newBrandedPage,
} from './layout'

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
  const company   = await getCompanySettings()
  const logoAsset = await fetchOfficialDocumentLogoSvg() ?? await fetchLogoBuffer(company.logoUrl)
  const pdfBuffer = await buildInvoicePdf(invoiceId, invoice, customer, company, logoAsset)

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

  await registerGeneratedFile({
    targets: [
      { entityType: 'invoice', entityId: invoiceId },
      ...(customerId ? [{ entityType: 'customer' as const, entityId: customerId }] : []),
    ],
    fileType: 'invoice',
    url: downloadUrl,
    storagePath,
    fileName: `Invoice-${(invoice.invoiceNumber as string | undefined) || invoiceId}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: pdfBuffer.length,
    metadata: {
      linkedEntityType: 'invoice',
      linkedEntityId: invoiceId,
      orderId: (invoice.orderId as string | undefined) ?? null,
      customerId: customerId ?? null,
    },
  })

  return downloadUrl
}

// ── PDF builder ───────────────────────────────────────────────────────────────

function buildInvoicePdf(
  invoiceId: string,
  invoice:   Record<string, unknown>,
  customer:  Record<string, unknown>,
  company:   CompanySettings,
  logoAsset: Buffer | string | null,
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

    function toNumber(...values: unknown[]): number {
      for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value
      }
      return 0
    }

    const invoiceNum = (invoice.invoiceNumber as string) || invoiceId.slice(-8).toUpperCase()
    const referenceText = `#${invoiceNum}`
    const DIVIDER_Y = drawBrandedHeader(doc, company, logoAsset, 'INVOICE', referenceText)

    // ── Section labels ─────────────────────────────────────────────────────
    const META_X = 380    // right column x-start for invoice meta

    doc
      .fontSize(7)
      .font('Helvetica-Bold')
      .fillColor('#999999')
      .text('BILL TO', MARGIN_L, DIVIDER_Y + 10)
      .text('INVOICE DETAILS', META_X, DIVIDER_Y + 10)

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

    let leftY = DIVIDER_Y + 23

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
    if (invoice.serviceDate) {
      metaRows.splice(3, 0, ['Service Date', fmtDate(invoice.serviceDate)])
    }

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
    let TABLE_TOP = Math.max(226, Math.max(leftY, rightY) + 18)
    const C_DESC    = MARGIN_L
    const C_QTY     = 358
    const C_RATE    = 425
    const C_AMT     = 496
    const AMT_W     = RIGHT_EDGE - C_AMT    // ~76
    const HDR_H     = 20

    const drawTableHeader = (tableTop: number) => {
      doc.rect(C_DESC, tableTop, CONTENT_W, HDR_H).fill('#F4F4F4')

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#444444')
        .text('DESCRIPTION', C_DESC + 4, tableTop + 6, { width: C_QTY - C_DESC - 8 })
        .text('QTY',         C_QTY,      tableTop + 6, { width: C_RATE - C_QTY - 4, align: 'right' })
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

    const lineItems = ((invoice.lineItems as Array<{
      description: string
      quantity: number
      unitPrice: number
      amount?: number
      total?: number
    }>) ?? []).map((item) => ({
      description: item.description,
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      amount: toNumber(item.amount, item.total, toNumber(item.quantity) * toNumber(item.unitPrice)),
    }))

    let rowY = TABLE_TOP + HDR_H + 8

    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i]
      const descWidth = C_QTY - C_DESC - 12
      const descriptionHeight = doc.heightOfString(item.description, { width: descWidth })
      const rowHeight = Math.max(18, descriptionHeight + 4)

      if (rowY + rowHeight > FOOTER_Y - 90) {
        const nextDividerY = newBrandedPage(doc, company, logoAsset, 'INVOICE', referenceText)
        doc
          .fontSize(7)
          .font('Helvetica-Bold')
          .fillColor('#999999')
          .text('LINE ITEMS', MARGIN_L, nextDividerY + 10)
        TABLE_TOP = nextDividerY + 24
        drawTableHeader(TABLE_TOP)
        rowY = TABLE_TOP + HDR_H + 8
      }

      // Zebra stripe
      if (i % 2 === 1) {
        doc.rect(C_DESC, rowY - 3, CONTENT_W, rowHeight).fill('#FAFAFA')
      }

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#222222')
        .text(item.description,               C_DESC + 4, rowY, { width: descWidth })
        .text(String(item.quantity),           C_QTY,      rowY, { width: C_RATE - C_QTY - 4,  align: 'right' })
        .text(fmtMoney(item.unitPrice),        C_RATE,     rowY, { width: C_AMT  - C_RATE - 4, align: 'right' })
        .text(fmtMoney(item.amount),           C_AMT,      rowY, { width: AMT_W,               align: 'right' })

      rowY += rowHeight
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

    const computedSubtotal = lineItems.reduce((sum, item) => sum + item.amount, 0)
    const subtotal = toNumber(invoice.subtotal, computedSubtotal)
    const taxRate = toNumber(invoice.salesTaxRate, invoice.taxRate)
    const taxAmount = toNumber(invoice.salesTaxAmount, invoice.tax, invoice.taxAmount)
    const applySalesTax = typeof invoice.applySalesTax === 'boolean'
      ? invoice.applySalesTax
      : (taxRate > 0 || taxAmount > 0)
    const totalAmount = toNumber(invoice.total, invoice.totalAmount, subtotal + taxAmount)
    const taxLabel = applySalesTax
      ? (taxRate > 0 ? `Sales Tax (${(taxRate * 100).toFixed(0)}%)` : 'Sales Tax')
      : 'Sales Tax Omitted'

    doc.fontSize(9).font('Helvetica').fillColor('#444444')

    doc
      .text('Subtotal', TOT_LBL_X, rowY, { width: TOT_LBL_W, align: 'right' })
      .text(fmtMoney(subtotal), TOT_VAL_X, rowY, { width: TOT_VAL_W, align: 'right' })
    rowY += 14

    doc
      .text(taxLabel, TOT_LBL_X, rowY, { width: TOT_LBL_W, align: 'right' })
      .text(fmtMoney(applySalesTax ? taxAmount : 0), TOT_VAL_X, rowY, { width: TOT_VAL_W, align: 'right' })
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
      .fillAndStroke(OGS_BRAND_BLUE_LIGHT, OGS_BRAND_BLUE)
      .lineWidth(0.75)

    doc
      .fontSize(8.5)
      .font('Helvetica-Bold')
      .fillColor(OGS_BRAND_BLUE)
      .text('PAYMENT INFORMATION', C_DESC + 12, BOX_Y + 10)

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#333333')
      .text(`Due Date:     ${fmtDate(invoice.dueAt)}`,                              C_DESC + 12, BOX_Y + 24)
      .text(`Questions?    ${[company.phone, company.email].filter(Boolean).join('  ·  ') || ''}`, C_DESC + 12, BOX_Y + 38)

    // ── Notes below payment box ─────────────────────────────────────────────
    rowY = BOX_Y + BOX_H + 12

    const invoiceNotes = (invoice.notes as string | undefined)?.trim()
    if (invoiceNotes) {
      const notesHeight = doc.heightOfString(invoiceNotes, { width: CONTENT_W })
      if (rowY + 24 + notesHeight > FOOTER_Y - 8) {
        const nextDividerY = newBrandedPage(doc, company, logoAsset, 'INVOICE', referenceText)
        rowY = nextDividerY + 18
      }
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#999999')
        .text('INVOICE NOTES', C_DESC, rowY)
      rowY += 12
      doc.fontSize(8).font('Helvetica').fillColor('#444444')
        .text(invoiceNotes, C_DESC, rowY, { width: CONTENT_W })
      rowY += notesHeight + 8
    }

    // ── Terms & Conditions ─────────────────────────────────────────────────
    if (company.termsAndConditions) {
      const termsHeight = doc.heightOfString(company.termsAndConditions, { width: CONTENT_W })
      if (rowY + 24 + termsHeight > FOOTER_Y - 8) {
        const nextDividerY = newBrandedPage(doc, company, logoAsset, 'INVOICE', referenceText)
        rowY = nextDividerY + 18
      }
      rowY += 8
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#999999')
        .text('TERMS & CONDITIONS', C_DESC, rowY)
      rowY += 12
      doc.fontSize(7.5).font('Helvetica').fillColor('#555555')
        .text(company.termsAndConditions, C_DESC, rowY, { width: CONTENT_W })
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    drawBrandedFooter(doc, company, 'Thank you for your business.')

    doc.end()
  })
}
