import PDFDocument from 'pdfkit'
import type { CompanySettings } from './companySettings'

export const OGS_ORANGE = '#E87722'
export const PAGE_W = 612
export const PAGE_H = 792
export const MARGIN_L = 58
export const RIGHT_EDGE = PAGE_W - 40
export const CONTENT_W = RIGHT_EDGE - MARGIN_L
export const FOOTER_Y = 748

type PdfDoc = InstanceType<typeof PDFDocument>

export function drawBrandedHeader(
  doc: PdfDoc,
  company: CompanySettings,
  logoBuf: Buffer | null,
  title: string,
  referenceText: string,
): number {
  doc.rect(0, 0, 8, PAGE_H).fill(OGS_ORANGE)

  if (logoBuf) {
    try {
      doc.image(logoBuf, MARGIN_L, 34, { fit: [120, 50] })
    } catch {
      // Ignore malformed assets and continue with the text header.
    }
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

  doc
    .fontSize(30)
    .font('Helvetica-Bold')
    .fillColor(OGS_ORANGE)
    .text(title, 0, 40, { align: 'right', width: RIGHT_EDGE })

  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#555555')
    .text(referenceText, 0, 78, { align: 'right', width: RIGHT_EDGE })

  const dividerY = Math.max(headerY + 12, 108)
  doc
    .moveTo(MARGIN_L, dividerY)
    .lineTo(RIGHT_EDGE, dividerY)
    .strokeColor(OGS_ORANGE)
    .lineWidth(1.5)
    .stroke()

  return dividerY
}

export function drawBrandedFooter(
  doc: PdfDoc,
  company: CompanySettings,
  primaryText: string,
  secondaryText?: string,
): void {
  doc
    .moveTo(MARGIN_L, FOOTER_Y)
    .lineTo(RIGHT_EDGE, FOOTER_Y)
    .strokeColor('#DDDDDD')
    .lineWidth(0.5)
    .stroke()

  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .fillColor('#111111')
    .text(primaryText, MARGIN_L, FOOTER_Y + 8, {
      align: 'center',
      width: CONTENT_W,
    })

  const footerLine =
    secondaryText ??
    [company.name, company.website, company.phone].filter(Boolean).join('  ·  ')

  doc
    .fontSize(7.5)
    .font('Helvetica')
    .fillColor('#888888')
    .text(footerLine || ' ', MARGIN_L, FOOTER_Y + 22, {
      align: 'center',
      width: CONTENT_W,
    })
}

export function newBrandedPage(
  doc: PdfDoc,
  company: CompanySettings,
  logoBuf: Buffer | null,
  title: string,
  referenceText: string,
): number {
  doc.addPage({ margin: 0, size: 'LETTER' })
  return drawBrandedHeader(doc, company, logoBuf, title, referenceText)
}
