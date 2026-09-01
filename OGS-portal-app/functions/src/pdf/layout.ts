import PDFDocument from 'pdfkit'
import type { CompanySettings } from './companySettings'

const SVGtoPDF = require('svg-to-pdfkit') as (
  doc: PdfDoc,
  svg: string,
  x: number,
  y: number,
  options?: { width?: number; height?: number; preserveAspectRatio?: string },
) => void

export const OGS_BRAND_BLUE = '#0066FF'
export const OGS_BRAND_BLUE_LIGHT = '#E6F0FF'
export const OGS_BRAND_DARK = '#0A1B33'
export const PAGE_W = 612
export const PAGE_H = 792
export const MARGIN_L = 58
export const RIGHT_EDGE = PAGE_W - 40
export const CONTENT_W = RIGHT_EDGE - MARGIN_L
export const FOOTER_Y = 748

type PdfDoc = InstanceType<typeof PDFDocument>

const LOGO_X = MARGIN_L
const LOGO_Y = 28
const LOGO_WIDTH = 170
const LOGO_HEIGHT = 44

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

function getTitleFontSize(title: string): number {
  if (title === 'TERMS & CONDITIONS') return 24
  if (title === 'BILL OF LADING' || title === 'TERMS ACCEPTED') return 26
  return 30
}

export function drawBrandedHeader(
  doc: PdfDoc,
  company: CompanySettings,
  logoAsset: Buffer | string | null,
  title: string,
  referenceText: string,
): number {
  doc.rect(0, 0, 8, PAGE_H).fill(OGS_BRAND_BLUE)

  const hasLogo = Boolean(logoAsset)

  if (logoAsset) {
    try {
      if (typeof logoAsset === 'string') {
        SVGtoPDF(doc, logoAsset, LOGO_X, LOGO_Y, {
          width: LOGO_WIDTH,
          height: LOGO_HEIGHT,
          preserveAspectRatio: 'xMinYMin meet',
        })
      } else {
        doc.image(logoAsset, LOGO_X, LOGO_Y, { fit: [LOGO_WIDTH, LOGO_HEIGHT] })
      }
    } catch {
      // Ignore malformed assets and continue with the text header.
    }
  }

  let headerY = 40
  if (!hasLogo) {
    const nameY = 40
    doc
      .fontSize(17)
      .font('Helvetica-Bold')
      .fillColor(OGS_BRAND_DARK)
      .text(company.name || 'Ohio Gas Supply', MARGIN_L, nameY)
    headerY = nameY + 23
  } else {
    // Start company detail lines just below the resized logo.
    headerY = LOGO_Y + LOGO_HEIGHT + 2
  }
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
    doc.fontSize(8.5).font('Helvetica').fillColor('#666666').text(displayUrl(company.website), MARGIN_L, headerY)
    headerY += 11
  }

  const titleSize = getTitleFontSize(title)
  const titleY = 40
  doc
    .fontSize(titleSize)
    .font('Helvetica-Bold')
    .fillColor(OGS_BRAND_BLUE)
    .text(title, 0, titleY, { align: 'right', width: RIGHT_EDGE })

  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#555555')
    .text(referenceText, 0, titleY + titleSize + 8, { align: 'right', width: RIGHT_EDGE })

  const dividerY = Math.max(headerY + 12, 108)
  doc
    .moveTo(MARGIN_L, dividerY)
    .lineTo(RIGHT_EDGE, dividerY)
    .strokeColor(OGS_BRAND_BLUE)
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
    [company.name, company.website ? displayUrl(company.website) : '', company.phone].filter(Boolean).join('  ·  ')

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
  logoAsset: Buffer | string | null,
  title: string,
  referenceText: string,
): number {
  doc.addPage({ margin: 0, size: 'LETTER' })
  return drawBrandedHeader(doc, company, logoAsset, title, referenceText)
}
