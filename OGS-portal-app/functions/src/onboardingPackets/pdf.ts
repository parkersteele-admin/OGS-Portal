/**
 * functions/src/onboardingPackets/pdf.ts
 *
 * Generates the signed onboarding PDFs:
 *   - Product Supply Agreement (customer signature, plus OGS countersignature once applied)
 *   - ACH / Credit Card Payment Authorization
 *
 * Each document ends with an electronic signature certificate (audit trail)
 * so the stored PDF stands on its own as the signed record.
 */

import PDFDocument from 'pdfkit'
import { storage } from '../admin'
import { getCompanySettings, fetchLogoBuffer, fetchOfficialDocumentLogoSvg, type CompanySettings } from '../pdf/companySettings'
import { CONTENT_W, MARGIN_L, RIGHT_EDGE, FOOTER_Y, drawBrandedFooter, drawBrandedHeader, newBrandedPage } from '../pdf/layout'
import { registerGeneratedFile } from '../files/registerGeneratedFile'
import {
  PSA_TITLE, PSA_INTRO, PSA_RATE_NOTE, PSA_RATE_FOOTNOTE, PSA_SECTIONS,
  ACH_TITLE, ACH_AUTHORIZATION_PARAGRAPHS, ACH_CARD_NOTE, ACH_FOOTNOTE, ESIGN_CONSENT_TEXT,
} from './psaTemplate'
import type { OnboardingPacket, SignatureCapture } from './types'

type PdfDoc = InstanceType<typeof PDFDocument>

const BOTTOM_LIMIT = FOOTER_Y - 18
const TEXT = '#1a1a1a'
const MUTED = '#666666'
const RULE = '#d9d9d9'

interface Ctx {
  doc: PdfDoc
  company: CompanySettings
  logo: Buffer | string | null
  title: string
  ref: string
  footer: string
  y: number
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v
  const maybe = v as { toDate?: () => Date }
  if (maybe && typeof maybe.toDate === 'function') return maybe.toDate()
  return new Date()
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET'
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium' })
}

function ensure(ctx: Ctx, height: number): void {
  if (ctx.y + height <= BOTTOM_LIMIT) return
  drawBrandedFooter(ctx.doc, ctx.company, ctx.footer)
  ctx.y = newBrandedPage(ctx.doc, ctx.company, ctx.logo, ctx.title, ctx.ref, 0.5) + 18
}

function heading(ctx: Ctx, text: string, size = 10.5): void {
  ensure(ctx, size + 30)
  ctx.doc.font('Helvetica-Bold').fontSize(size).fillColor(TEXT).text(text, MARGIN_L, ctx.y, { width: CONTENT_W })
  ctx.y = ctx.doc.y + 6
}

function groupLabel(ctx: Ctx, text: string): void {
  ensure(ctx, 50)
  ctx.y += 4
  ctx.doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#999999').text(text.toUpperCase(), MARGIN_L, ctx.y, { width: CONTENT_W, characterSpacing: 0.6 })
  ctx.y = ctx.doc.y + 2
  ctx.doc.moveTo(MARGIN_L, ctx.y).lineTo(RIGHT_EDGE, ctx.y).lineWidth(0.5).strokeColor(RULE).stroke()
  ctx.y += 8
}

function para(ctx: Ctx, text: string, opts: { size?: number; color?: string; bold?: boolean; indent?: number } = {}): void {
  const size = opts.size ?? 8.5
  const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica'
  const indent = opts.indent ?? 0
  ctx.doc.font(font).fontSize(size)
  const h = ctx.doc.heightOfString(text, { width: CONTENT_W - indent, lineGap: 1.5 })
  if (ctx.y + h > BOTTOM_LIMIT && h < BOTTOM_LIMIT - 140) ensure(ctx, h)
  ctx.doc.fillColor(opts.color ?? TEXT).text(text, MARGIN_L + indent, ctx.y, { width: CONTENT_W - indent, lineGap: 1.5 })
  ctx.y = ctx.doc.y + 6
}

function field(ctx: Ctx, label: string, value: string, x = MARGIN_L, width = CONTENT_W): number {
  ctx.doc.font('Helvetica-Bold').fontSize(7).fillColor('#999999').text(label.toUpperCase(), x, ctx.y, { width })
  ctx.doc.font('Helvetica').fontSize(9).fillColor(TEXT).text(value || '—', x, ctx.y + 10, { width })
  return ctx.doc.y
}

function fieldRow(ctx: Ctx, pairs: Array<[string, string]>): void {
  ensure(ctx, 34)
  const colW = (CONTENT_W - 16 * (pairs.length - 1)) / pairs.length
  let maxY = ctx.y
  pairs.forEach(([label, value], i) => {
    const bottom = field(ctx, label, value, MARGIN_L + i * (colW + 16), colW)
    maxY = Math.max(maxY, bottom)
  })
  ctx.y = maxY + 8
}

function dataUrlToBuffer(dataUrl?: string): Buffer | null {
  if (!dataUrl) return null
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
  return m ? Buffer.from(m[1], 'base64') : null
}

function signatureBlock(ctx: Ctx, x: number, width: number, party: string, sig: SignatureCapture | undefined, top: number): number {
  const { doc } = ctx
  let y = top
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(party.toUpperCase(), x, y, { width })
  y += 14
  const img = dataUrlToBuffer(sig?.imageDataUrl)
  if (sig && img) {
    doc.image(img, x, y, { fit: [width, 46] })
  } else if (sig) {
    doc.font('Times-Italic').fontSize(22).fillColor('#0a1b33').text(sig.name, x, y + 12, { width })
  }
  y += 50
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.6).strokeColor('#999999').stroke()
  y += 4
  doc.font('Helvetica').fontSize(8).fillColor(TEXT)
  doc.text(`Name: ${sig?.name ?? ''}`, x, y, { width }); y += 12
  doc.text(`Title: ${sig?.title ?? ''}`, x, y, { width }); y += 12
  doc.text(`Date: ${sig ? fmtDate(toDate(sig.signedAt)) : ''}`, x, y, { width }); y += 12
  if (!sig) {
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED).text('Awaiting signature', x, y, { width }); y += 10
  }
  return y
}

function certificate(ctx: Ctx, packetId: string, packet: OnboardingPacket, includeCountersign: boolean): void {
  const s = packet.submission!
  drawBrandedFooter(ctx.doc, ctx.company, ctx.footer)
  ctx.y = newBrandedPage(ctx.doc, ctx.company, ctx.logo, ctx.title, ctx.ref, 0.5) + 18
  heading(ctx, 'Electronic Signature Certificate', 12)
  para(ctx, 'This certificate records how and when this document was signed electronically through the Ohio Gas Supply portal.', { color: MUTED })
  fieldRow(ctx, [['Packet ID', packetId], ['Document version', `${packet.terms.psaVersion} / ${packet.terms.achVersion}`]])
  fieldRow(ctx, [['Sent to', `${packet.recipientName} <${packet.recipientEmail}>`], ['Sent by', `${packet.sentBy.name} <${packet.sentBy.email}>`]])
  fieldRow(ctx, [['Sent', fmtDateTime(toDate(packet.createdAt))], ['First viewed', packet.viewedAt ? fmtDateTime(toDate(packet.viewedAt)) : '—']])
  groupLabel(ctx, 'Customer signature')
  fieldRow(ctx, [['Signer', `${s.signer.name}, ${s.signer.title}`], ['Signer email', s.info.contactEmail]])
  fieldRow(ctx, [['Signed', fmtDateTime(toDate(s.signer.signedAt))], ['Signature method', s.signer.method === 'drawn' ? 'Drawn on screen' : 'Typed name adopted as signature']])
  fieldRow(ctx, [['IP address', s.ipAddress || 'unknown'], ['Delivery', 'Unique link emailed to recipient']])
  fieldRow(ctx, [['Browser', s.userAgent || 'unknown']])
  fieldRow(ctx, [['Document fingerprint (SHA-256)', s.documentHash]])
  para(ctx, `Consent to electronic signature: "${ESIGN_CONSENT_TEXT}" — accepted by signer.`, { size: 7.5, color: MUTED })
  if (includeCountersign && packet.countersign) {
    groupLabel(ctx, 'Ohio Gas Supply countersignature')
    fieldRow(ctx, [['Signer', `${packet.countersign.name}, ${packet.countersign.title}`], ['Signed', fmtDateTime(toDate(packet.countersign.signedAt))]])
  }
}

async function render(build: (doc: PdfDoc) => void): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'LETTER', info: { Author: 'Ohio Gas Supply' } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try { build(doc); doc.end() } catch (err) { reject(err) }
  })
}

function buildPsa(doc: PdfDoc, company: CompanySettings, logo: Buffer | string | null, packetId: string, packet: OnboardingPacket): void {
  const s = packet.submission!
  const ref = `Packet ${packetId.slice(0, 8).toUpperCase()}`
  const ctx: Ctx = { doc, company, logo, title: 'SUPPLY AGREEMENT', ref, footer: `${PSA_TITLE} · ${packet.terms.psaVersion}`, y: 0 }
  ctx.y = drawBrandedHeader(doc, company, logo, ctx.title, ref, 0.5) + 18

  heading(ctx, PSA_TITLE, 14)
  para(ctx, PSA_INTRO)

  groupLabel(ctx, 'Customer and service details')
  fieldRow(ctx, [['Customer legal name', s.info.legalName]])
  fieldRow(ctx, [['Billing address', s.info.billingAddress], ['Delivery address', s.info.deliveryAddress]])
  fieldRow(ctx, [['Authorized contact and title', `${s.info.contactName}, ${s.info.contactTitle}`], ['Contact email', s.info.contactEmail], ['Phone', s.info.contactPhone]])
  fieldRow(ctx, [['Accounts payable email', s.info.apEmail], ['AP phone', s.info.apPhone]])
  fieldRow(ctx, [['Effective date', packet.terms.effectiveDate ? fmtDate(new Date(packet.terms.effectiveDate + 'T12:00:00')) : 'Date of last signature'], ['Initial term', '12 months from the effective date']])

  groupLabel(ctx, 'Initial rate schedule')
  para(ctx, PSA_RATE_NOTE, { color: MUTED, size: 8 })
  ensure(ctx, 20 + packet.terms.rateSchedule.length * 16)
  const c1 = MARGIN_L, c2 = MARGIN_L + CONTENT_W * 0.5, c3 = MARGIN_L + CONTENT_W * 0.7
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
  doc.text('Product or service', c1, ctx.y); doc.text('Initial charge', c2, ctx.y); doc.text('Billing basis', c3, ctx.y)
  ctx.y += 13
  doc.font('Helvetica').fontSize(9).fillColor(TEXT)
  const rows = [...packet.terms.rateSchedule]
  rows.push({
    label: 'Onboarding fee',
    charge: packet.terms.onboardingFee.waived ? 'Waived' : `$${packet.terms.onboardingFee.amount.toFixed(2)}`,
    basis: 'One time',
  })
  for (const r of rows) {
    ensure(ctx, 16)
    doc.moveTo(MARGIN_L, ctx.y - 3).lineTo(RIGHT_EDGE, ctx.y - 3).lineWidth(0.4).strokeColor(RULE).stroke()
    doc.text(r.label, c1, ctx.y, { width: c2 - c1 - 8 })
    doc.text(r.charge, c2, ctx.y, { width: c3 - c2 - 8 })
    doc.text(r.basis, c3, ctx.y, { width: RIGHT_EDGE - c3 })
    ctx.y += 16
  }
  para(ctx, PSA_RATE_FOOTNOTE, { size: 7.5, color: MUTED })
  if (s.cageChoice !== 'not_applicable') {
    fieldRow(ctx, [['12 cylinder storage cage', { purchase: 'Customer elects to purchase', rent: 'Customer elects to rent', undecided: 'Customer undecided — to confirm with account rep', not_applicable: '' }[s.cageChoice]]])
  }
  fieldRow(ctx, [['Service method', packet.terms.serviceMethod], ['Payment terms', packet.terms.paymentTerms || 'Payment on delivery']])
  fieldRow(ctx, [['Account representative', [packet.terms.rep.name, packet.terms.rep.phone, packet.terms.rep.email].filter(Boolean).join(' · ')]])

  let lastGroup: string | null = null
  for (const sec of PSA_SECTIONS) {
    if (sec.group && sec.group !== lastGroup) { groupLabel(ctx, sec.group); lastGroup = sec.group }
    heading(ctx, `${sec.number}. ${sec.title}`, 9.5)
    sec.paragraphs.forEach((p) => para(ctx, p))
  }

  ensure(ctx, 150)
  ctx.y += 8
  const colW = (CONTENT_W - 30) / 2
  const top = ctx.y
  const yA = signatureBlock(ctx, MARGIN_L, colW, s.info.legalName || packet.customerName, s.signer, top)
  const yB = signatureBlock(ctx, MARGIN_L + colW + 30, colW, 'Ohio Gas Supply Co.', packet.countersign, top)
  ctx.y = Math.max(yA, yB) + 10

  certificate(ctx, packetId, packet, true)
  drawBrandedFooter(doc, company, ctx.footer)
}

function buildAch(doc: PdfDoc, company: CompanySettings, logo: Buffer | string | null, packetId: string, packet: OnboardingPacket): void {
  const s = packet.submission!
  const ref = `Packet ${packetId.slice(0, 8).toUpperCase()}`
  const ctx: Ctx = { doc, company, logo, title: 'ACH AUTHORIZATION', ref, footer: `${ACH_TITLE} · ${packet.terms.achVersion}`, y: 0 }
  ctx.y = drawBrandedHeader(doc, company, logo, ctx.title, ref, 0.5) + 18

  heading(ctx, ACH_TITLE, 14)
  groupLabel(ctx, 'Customer information')
  fieldRow(ctx, [['Company name', s.info.legalName]])
  fieldRow(ctx, [['Billing address', s.info.billingAddress]])
  fieldRow(ctx, [['Contact name', s.info.contactName], ['Phone', s.info.contactPhone]])
  fieldRow(ctx, [['Email for invoices and payment notices', s.info.apEmail || s.info.contactEmail]])

  groupLabel(ctx, 'Payment method')
  if (s.paymentMethod === 'ach' && s.bank) {
    fieldRow(ctx, [['Method', 'ACH bank debit (business account)'], ['Account type', s.bank.accountType === 'savings' ? 'Savings' : 'Checking']])
    fieldRow(ctx, [['Bank name', s.bank.bankName], ['Account holder name', s.bank.holderName]])
    fieldRow(ctx, [['Routing number', `•••••${s.bank.routingLast4}`], ['Bank account number', `••••${s.bank.accountLast4}`]])
    para(ctx, 'Full account and routing numbers were provided by the customer through the secure onboarding form and are held encrypted by Ohio Gas Supply. They are masked on this copy.', { size: 7.5, color: MUTED })
  } else {
    fieldRow(ctx, [['Method', 'Credit card (processed through a secure payment link)']])
    para(ctx, ACH_CARD_NOTE, { size: 8, color: MUTED })
  }

  groupLabel(ctx, 'Authorization for customer-initiated and merchant-initiated charges')
  ACH_AUTHORIZATION_PARAGRAPHS.forEach((p) => para(ctx, p, { indent: p.startsWith('•') ? 10 : 0 }))

  ensure(ctx, 112)
  ctx.y = signatureBlock(ctx, MARGIN_L, (CONTENT_W - 30) / 2, 'Authorized signature', s.signer, ctx.y) + 8
  para(ctx, `Note: ${ACH_FOOTNOTE}`, { size: 7.5, color: MUTED })

  certificate(ctx, packetId, packet, false)
  drawBrandedFooter(doc, company, ctx.footer)
}

async function save(
  buf: Buffer, packetId: string, packet: OnboardingPacket, kind: 'psa' | 'ach', fileName: string, label: string,
): Promise<{ url: string; storagePath: string; fileName: string }> {
  const storagePath = `ogs-portal/customers/${packet.customerId}/onboarding/${packetId}/${kind}.pdf`
  const fileRef = storage.bucket().file(storagePath)
  const downloadToken = crypto.randomUUID()
  await fileRef.save(buf, {
    contentType: 'application/pdf',
    metadata: {
      cacheControl: 'private, max-age=0',
      metadata: { customerId: packet.customerId, packetId, firebaseStorageDownloadTokens: downloadToken },
    },
  })
  const bucket = storage.bucket().name
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`
  await registerGeneratedFile({
    targets: [{ entityType: 'customer', entityId: packet.customerId }],
    fileType: 'contract',
    url,
    storagePath,
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: buf.length,
    metadata: { customerId: packet.customerId, packetId, documentKind: `onboarding-${kind}`, documentLabel: label },
  })
  return { url, storagePath, fileName }
}

/** Pure render (no storage) — used by generatePacketPdfs and tests. */
export async function renderPacketPdfBuffers(
  packetId: string, packet: OnboardingPacket, company: CompanySettings, logo: Buffer | string | null,
): Promise<{ psa: Buffer; ach: Buffer }> {
  const psa = await render((doc) => buildPsa(doc, company, logo, packetId, packet))
  const ach = await render((doc) => buildAch(doc, company, logo, packetId, packet))
  return { psa, ach }
}

export interface GeneratedPacketPdfs {
  psa: { url: string; storagePath: string; fileName: string; buffer: Buffer }
  ach?: { url: string; storagePath: string; fileName: string; buffer: Buffer }
}

/**
 * Generate and store PDFs for a signed packet. Pass `psaOnly` when
 * regenerating the agreement after countersignature.
 */
export async function generatePacketPdfs(packetId: string, packet: OnboardingPacket, psaOnly = false): Promise<GeneratedPacketPdfs> {
  if (!packet.submission) throw new Error('Packet has no submission.')
  const company = await getCompanySettings()
  const logo = (await fetchOfficialDocumentLogoSvg()) ?? (await fetchLogoBuffer(company.logoUrl))
  const safeName = (packet.submission.info.legalName || packet.customerName).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60)

  const psaBuf = await render((doc) => buildPsa(doc, company, logo, packetId, packet))
  const psaSaved = await save(
    psaBuf, packetId, packet, 'psa',
    `${safeName}-Product-Supply-Agreement${packet.countersign ? '' : '-Customer-Signed'}.pdf`,
    'Product Supply Agreement',
  )
  const result: GeneratedPacketPdfs = { psa: { ...psaSaved, buffer: psaBuf } }
  if (!psaOnly) {
    const achBuf = await render((doc) => buildAch(doc, company, logo, packetId, packet))
    const achSaved = await save(achBuf, packetId, packet, 'ach', `${safeName}-Payment-Authorization.pdf`, 'ACH / Credit Card Payment Authorization')
    result.ach = { ...achSaved, buffer: achBuf }
  }
  return result
}
