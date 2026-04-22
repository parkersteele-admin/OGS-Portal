import PDFDocument from 'pdfkit'
import { storage } from '../admin'
import { getCompanySettings, fetchLogoBuffer } from './companySettings'
import { registerGeneratedFile } from '../files/registerGeneratedFile'
import {
  CONTENT_W,
  FOOTER_Y,
  MARGIN_L,
  RIGHT_EDGE,
  drawBrandedFooter,
  drawBrandedHeader,
  newBrandedPage,
} from './layout'

export interface BillOfLadingItem {
  description: string
  quantity: number
  unit: string
}

export interface GenerateBillOfLadingInput {
  orderId: string
  customerId: string
  customerName: string
  customerAddress: string[]
  driverName: string
  date: Date
  items: BillOfLadingItem[]
}

export interface GeneratedBillOfLading {
  buffer: Buffer
  fileName: string
  storagePath: string
  url: string
}

export async function generateBillOfLadingPdf(
  input: GenerateBillOfLadingInput,
): Promise<GeneratedBillOfLading> {
  const company = await getCompanySettings()
  const logoBuf = await fetchLogoBuffer(company.logoUrl)
  const buffer = await buildBillOfLadingPdf(input, company, logoBuf)

  const safeDate = input.date.toISOString().slice(0, 10)
  const fileName = `Bill-of-Lading-${safeDate}.pdf`
  const storagePath = `ogs-portal/orders/${input.orderId}/bill-of-lading/${safeDate}.pdf`
  const fileRef = storage.bucket().file(storagePath)
  const downloadToken = crypto.randomUUID()

  await fileRef.save(buffer, {
    contentType: 'application/pdf',
    metadata: {
      cacheControl: 'private, max-age=0',
      metadata: {
        orderId: input.orderId,
        customerId: input.customerId,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  })

  const bucket = storage.bucket().name
  const encodedPath = encodeURIComponent(storagePath)
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`

  await registerGeneratedFile({
    targets: [
      { entityType: 'order', entityId: input.orderId },
      { entityType: 'customer', entityId: input.customerId },
    ],
    fileType: 'receipt',
    url,
    storagePath,
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: buffer.length,
    metadata: {
      linkedEntityType: 'order',
      linkedEntityId: input.orderId,
      customerId: input.customerId,
      documentKind: 'delivery-receipt',
    },
  })

  return { buffer, fileName, storagePath, url }
}

async function buildBillOfLadingPdf(
  input: GenerateBillOfLadingInput,
  company: Awaited<ReturnType<typeof getCompanySettings>>,
  logoBuf: Buffer | null,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'LETTER' })
    const chunks: Buffer[] = []

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const fmtDate = input.date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })

    const referenceText = `Order ${input.orderId.slice(-8).toUpperCase()}`
    const dividerY = drawBrandedHeader(doc, company, logoBuf, 'BILL OF LADING', referenceText)

    doc
      .fontSize(7)
      .font('Helvetica-Bold')
      .fillColor('#999999')
      .text('DELIVER TO', MARGIN_L, dividerY + 10)
      .text('DELIVERY DETAILS', 360, dividerY + 10)

    let leftY = dividerY + 24
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#111111').text(input.customerName, MARGIN_L, leftY)
    leftY += 16
    for (const line of input.customerAddress.filter(Boolean)) {
      doc.fontSize(9).font('Helvetica').fillColor('#333333').text(line, MARGIN_L, leftY)
      leftY += 13
    }

    const detailRows: Array<[string, string]> = [
      ['Delivery Date', fmtDate],
      ['Driver', input.driverName || 'Assigned Driver'],
      ['Signed Delivery', 'Yes'],
    ]

    let rightY = dividerY + 24
    for (const [label, value] of detailRows) {
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#888888').text(label, 360, rightY, { width: 90 })
      doc.fontSize(9).font('Helvetica').fillColor('#111111').text(value, 456, rightY, { width: RIGHT_EDGE - 456 })
      rightY += 16
    }

    const tableTop = 236
    const cDesc = MARGIN_L
    const cQty = 392
    const cUnit = 470
    const headerHeight = 20

    const drawTableHeader = (top: number) => {
      doc.rect(cDesc, top, CONTENT_W, headerHeight).fill('#F4F4F4')
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#444444')
        .text('ITEM', cDesc + 4, top + 6, { width: cQty - cDesc - 8 })
        .text('QTY', cQty, top + 6, { width: cUnit - cQty - 6, align: 'right' })
        .text('UNIT', cUnit, top + 6, { width: RIGHT_EDGE - cUnit, align: 'right' })
    }

    drawTableHeader(tableTop)

    let rowY = tableTop + headerHeight + 8
    for (const [index, item] of input.items.entries()) {
      const descWidth = cQty - cDesc - 12
      const descriptionHeight = doc.heightOfString(item.description, { width: descWidth })
      const rowHeight = Math.max(18, descriptionHeight + 4)

      if (rowY + rowHeight > FOOTER_Y - 120) {
        const nextDividerY = newBrandedPage(doc, company, logoBuf, 'BILL OF LADING', referenceText)
        doc
          .fontSize(7)
          .font('Helvetica-Bold')
          .fillColor('#999999')
          .text('DELIVERED ITEMS', MARGIN_L, nextDividerY + 10)
        drawTableHeader(nextDividerY + 24)
        rowY = nextDividerY + 24 + headerHeight + 8
      }

      if (index % 2 === 1) {
        doc.rect(cDesc, rowY - 3, CONTENT_W, rowHeight).fill('#FAFAFA')
      }

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#222222')
        .text(item.description, cDesc + 4, rowY, { width: descWidth })
        .text(String(item.quantity), cQty, rowY, { width: cUnit - cQty - 6, align: 'right' })
        .text(item.unit, cUnit, rowY, { width: RIGHT_EDGE - cUnit, align: 'right' })

      rowY += rowHeight
    }

    rowY += 10
    doc
      .moveTo(cDesc, rowY)
      .lineTo(RIGHT_EDGE, rowY)
      .strokeColor('#CCCCCC')
      .lineWidth(0.75)
      .stroke()

    rowY += 24
    if (rowY + 120 > FOOTER_Y - 8) {
      const nextDividerY = newBrandedPage(doc, company, logoBuf, 'BILL OF LADING', referenceText)
      rowY = nextDividerY + 18
    }
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#111111')
      .text('Delivery Notes', MARGIN_L, rowY)

    rowY += 16
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555555')
      .text(
        'Customer signature was captured in the OGS Portal at time of delivery. Supporting signature image is stored with the order record.',
        MARGIN_L,
        rowY,
        { width: CONTENT_W, lineGap: 3 },
      )

    rowY += 70
    doc
      .moveTo(MARGIN_L, rowY)
      .lineTo(MARGIN_L + 220, rowY)
      .strokeColor('#BBBBBB')
      .lineWidth(0.75)
      .stroke()
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#777777')
      .text('Authorized OGS Driver', MARGIN_L, rowY + 6)

    if (company.termsAndConditions) {
      doc
        .fontSize(7.5)
        .font('Helvetica')
        .fillColor('#888888')
        .text(company.termsAndConditions, MARGIN_L, FOOTER_Y - 86, {
          width: CONTENT_W,
          height: 60,
          ellipsis: true,
        })
    }

    drawBrandedFooter(doc, company, 'Signed delivery record retained by Ohio Gas Supply.')

    doc.end()
  })
}
