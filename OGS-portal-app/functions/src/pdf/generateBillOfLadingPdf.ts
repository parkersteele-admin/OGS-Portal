import PDFDocument from 'pdfkit'
import { storage } from '../admin'
import { getCompanySettings, fetchLogoBuffer } from './companySettings'

const OGS_ORANGE = '#E87722'
const PAGE_W = 612
const PAGE_H = 792
const MARGIN_L = 58
const RIGHT_EDGE = PAGE_W - 40
const CONTENT_W = RIGHT_EDGE - MARGIN_L

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

    doc.rect(0, 0, 8, PAGE_H).fill(OGS_ORANGE)

    if (logoBuf) {
      try {
        doc.image(logoBuf, MARGIN_L, 34, { fit: [120, 50] })
      } catch {
        // Ignore malformed logo assets and continue with text-only header.
      }
    }

    const nameY = logoBuf ? 92 : 40
    doc
      .fontSize(logoBuf ? 13 : 17)
      .font('Helvetica-Bold')
      .fillColor('#111111')
      .text(company.name || 'OGS Gas Services', MARGIN_L, nameY)

    let headerY = nameY + (logoBuf ? 16 : 23)
    const companyLine = [company.phone, company.email, company.website].filter(Boolean).join('  ·  ')
    if (companyLine) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#666666').text(companyLine, MARGIN_L, headerY)
      headerY += 12
    }

    doc
      .fontSize(28)
      .font('Helvetica-Bold')
      .fillColor(OGS_ORANGE)
      .text('BILL OF LADING', 0, 40, { align: 'right', width: RIGHT_EDGE })

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#555555')
      .text(`Order ${input.orderId.slice(-8).toUpperCase()}`, 0, 76, {
        align: 'right',
        width: RIGHT_EDGE,
      })

    const dividerY = Math.max(headerY + 12, 108)
    doc
      .moveTo(MARGIN_L, dividerY)
      .lineTo(RIGHT_EDGE, dividerY)
      .strokeColor(OGS_ORANGE)
      .lineWidth(1.5)
      .stroke()

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

    doc.rect(cDesc, tableTop, CONTENT_W, headerHeight).fill('#F4F4F4')
    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .fillColor('#444444')
      .text('ITEM', cDesc + 4, tableTop + 6, { width: cQty - cDesc - 8 })
      .text('QTY', cQty, tableTop + 6, { width: cUnit - cQty - 6, align: 'right' })
      .text('UNIT', cUnit, tableTop + 6, { width: RIGHT_EDGE - cUnit, align: 'right' })

    let rowY = tableTop + headerHeight + 8
    for (const [index, item] of input.items.entries()) {
      if (index % 2 === 1) {
        doc.rect(cDesc, rowY - 3, CONTENT_W, 17).fill('#FAFAFA')
      }

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#222222')
        .text(item.description, cDesc + 4, rowY, { width: cQty - cDesc - 12 })
        .text(String(item.quantity), cQty, rowY, { width: cUnit - cQty - 6, align: 'right' })
        .text(item.unit, cUnit, rowY, { width: RIGHT_EDGE - cUnit, align: 'right' })

      rowY += 18
    }

    rowY += 10
    doc
      .moveTo(cDesc, rowY)
      .lineTo(RIGHT_EDGE, rowY)
      .strokeColor('#CCCCCC')
      .lineWidth(0.75)
      .stroke()

    rowY += 24
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
        .text(company.termsAndConditions, MARGIN_L, PAGE_H - 96, {
          width: CONTENT_W,
          height: 60,
          ellipsis: true,
        })
    }

    doc.end()
  })
}
