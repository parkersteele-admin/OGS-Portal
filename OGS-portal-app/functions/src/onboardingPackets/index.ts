/**
 * functions/src/onboardingPackets/index.ts
 *
 * Digital customer onboarding: Product Supply Agreement + ACH/Card Payment
 * Authorization + W-9, signed online via a unique emailed link.
 *
 * Staff callables (admin/sales unless noted):
 *   createOnboardingPacket        — create packet, email customer the signing link
 *   resendOnboardingPacket        — re-send the same link (extends expiry)
 *   voidOnboardingPacket          — cancel an unsigned packet
 *   countersignOnboardingPacket   — OGS signature (admin only); emails executed copy
 *   revealOnboardingBankDetails   — decrypt bank numbers for QuickBooks entry (admin only, logged)
 *   markOnboardingBankEntered     — permanently delete encrypted bank numbers (admin only)
 *
 * Public callables (token-gated, no login):
 *   getOnboardingPacketPublic     — load packet for the signing page
 *   submitOnboardingPacket        — sign and submit
 *   getOnboardingW9               — download the OGS W-9
 *
 * Scheduled:
 *   sendOnboardingReminders       — daily; reminds after 3 and 7 days
 */

import fs from 'fs'
import path from 'path'
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { Timestamp } from 'firebase-admin/firestore'
import { db, FieldValue } from '../admin'
import { RESEND_API_KEY } from '../config'
import { sendEmail, type MailAttachment } from '../email/sendEmail'
import { getCompanySettings } from '../pdf/companySettings'
import { ONBOARDING_ENCRYPTION_KEY, encryptString, decryptString, sha256Hex, newPacketToken, type EncryptedValue } from './crypto'
import {
  PSA_VERSION, ACH_VERSION, PSA_TITLE, PSA_INTRO, PSA_RATE_NOTE, PSA_RATE_FOOTNOTE, PSA_SECTIONS,
  ACH_TITLE, ACH_AUTHORIZATION_PARAGRAPHS, ACH_CARD_NOTE, ACH_FOOTNOTE, ESIGN_CONSENT_TEXT,
  DEFAULT_RATE_SCHEDULE, type RateLine,
} from './psaTemplate'
import { generatePacketPdfs } from './pdf'
import { APP_ORIGIN, packetUrl, packetInviteEmail, customerSignedEmail, internalSignedEmail, countersignedEmail } from './emails'
import type { OnboardingPacket, PacketCustomerInfo, PacketTerms, CageChoice, SignatureCapture } from './types'

const PACKETS = 'onboardingPackets'
const LINK_TTL_DAYS = 14
const SECRETS = [RESEND_API_KEY, ONBOARDING_ENCRYPTION_KEY]
const PUBLIC_OPTS = { secrets: SECRETS, memory: '512MiB' as const, timeoutSeconds: 120 }

// ── Helpers ───────────────────────────────────────────────────────────────────

type Req = CallableRequest<unknown>

function role(req: Req): string {
  return (req.auth?.token.role as string | undefined) ?? ''
}

function assertStaff(req: Req): void {
  if (!req.auth) throw new HttpsError('unauthenticated', 'You must be signed in.')
  if (!['admin', 'sales'].includes(role(req))) throw new HttpsError('permission-denied', 'Admin or sales only.')
}

function assertAdmin(req: Req): void {
  if (!req.auth) throw new HttpsError('unauthenticated', 'You must be signed in.')
  if (role(req) !== 'admin') throw new HttpsError('permission-denied', 'Admin only.')
}

function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function expiryFromNow(): Date {
  return new Date(Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000)
}

function cleanInfo(raw: unknown): PacketCustomerInfo {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    legalName:       str(r.legalName, 200),
    billingAddress:  str(r.billingAddress, 300),
    deliveryAddress: str(r.deliveryAddress, 300),
    contactName:     str(r.contactName, 120),
    contactTitle:    str(r.contactTitle, 120),
    contactEmail:    str(r.contactEmail, 200).toLowerCase(),
    contactPhone:    str(r.contactPhone, 40),
    apEmail:         str(r.apEmail, 200).toLowerCase(),
    apPhone:         str(r.apPhone, 40),
  }
}

function cleanRates(raw: unknown): RateLine[] {
  if (!Array.isArray(raw)) return DEFAULT_RATE_SCHEDULE
  const rows = raw
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>
      return { label: str(o.label, 120), charge: str(o.charge, 40), basis: str(o.basis, 80) }
    })
    .filter((r) => r.label)
    .slice(0, 25)
  return rows.length ? rows : DEFAULT_RATE_SCHEDULE
}

async function findByToken(token: string): Promise<{ id: string; ref: FirebaseFirestore.DocumentReference; packet: OnboardingPacket }> {
  if (!token || token.length < 20) throw new HttpsError('not-found', 'This link is invalid.')
  const snap = await db.collection(PACKETS).where('tokenHash', '==', sha256Hex(token)).limit(1).get()
  if (snap.empty) throw new HttpsError('not-found', 'This link is invalid or has been replaced. Please contact Ohio Gas Supply for a new one.')
  const doc = snap.docs[0]
  return { id: doc.id, ref: doc.ref, packet: doc.data() as OnboardingPacket }
}

function assertOpen(packet: OnboardingPacket): void {
  if (packet.status === 'voided') throw new HttpsError('failed-precondition', 'This onboarding link has been cancelled. Please contact Ohio Gas Supply.')
  if (packet.expiresAt.toDate() < new Date()) throw new HttpsError('deadline-exceeded', 'This onboarding link has expired. Please contact Ohio Gas Supply for a new one.')
}

async function loadPacket(packetId: string): Promise<{ ref: FirebaseFirestore.DocumentReference; packet: OnboardingPacket }> {
  if (!packetId) throw new HttpsError('invalid-argument', 'packetId is required.')
  const ref = db.collection(PACKETS).doc(packetId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Packet not found.')
  return { ref, packet: snap.data() as OnboardingPacket }
}

let w9Cache: Buffer | null = null
function w9Buffer(): Buffer | null {
  if (w9Cache) return w9Cache
  try {
    w9Cache = fs.readFileSync(path.resolve(__dirname, '../../assets/OGS_W9.pdf'))
  } catch {
    w9Cache = null
  }
  return w9Cache
}

function w9Attachment(): MailAttachment[] {
  const buf = w9Buffer()
  return buf ? [{ content: buf.toString('base64'), filename: 'Ohio-Gas-Supply-W9.pdf', type: 'application/pdf' }] : []
}

async function sendInvite(packet: OnboardingPacket, token: string, isReminder = false): Promise<void> {
  await sendEmail({
    to: packet.recipientEmail,
    replyTo: packet.sentBy.email || undefined,
    subject: isReminder
      ? `Reminder: complete your Ohio Gas Supply account setup`
      : `Ohio Gas Supply — account setup documents for ${packet.customerName}`,
    html: packetInviteEmail({
      personalMessage: packet.personalMessage,
      url: packetUrl(token),
      expiresAt: packet.expiresAt.toDate(),
      repName: packet.terms.rep.name,
      isReminder,
    }),
    attachments: w9Attachment(),
  })
}

/** Exact text shown to the signer — hashed into the signature record. */
function documentPayload(packet: OnboardingPacket) {
  return {
    psa: { version: packet.terms.psaVersion, title: PSA_TITLE, intro: PSA_INTRO, rateNote: PSA_RATE_NOTE, rateFootnote: PSA_RATE_FOOTNOTE, sections: PSA_SECTIONS },
    ach: { version: packet.terms.achVersion, title: ACH_TITLE, paragraphs: ACH_AUTHORIZATION_PARAGRAPHS, cardNote: ACH_CARD_NOTE, footnote: ACH_FOOTNOTE },
    esignConsent: ESIGN_CONSENT_TEXT,
  }
}

function validSignatureImage(v: string): boolean {
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 400_000
}

/** Ensure the customer has a portal setup link (reuses the /join flow). */
async function ensureJoinLink(customerId: string): Promise<string | null> {
  const ref = db.collection('customers').doc(customerId)
  const snap = await ref.get()
  const data = snap.data()
  if (!data || data.setupComplete) return null
  const existing = data.setupToken as string | undefined
  const expiry = data.setupTokenExpiry?.toDate?.() as Date | undefined
  if (existing && expiry && expiry > new Date()) return `${APP_ORIGIN}/join/${existing}`
  const setupToken = crypto.randomUUID()
  await ref.update({
    setupToken,
    setupTokenExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return `${APP_ORIGIN}/join/${setupToken}`
}

// ── createOnboardingPacket ────────────────────────────────────────────────────

export const createOnboardingPacket = onCall({ secrets: SECRETS }, async (req) => {
  assertStaff(req)
  const d = (req.data ?? {}) as Record<string, unknown>
  const customerId = str(d.customerId, 128)
  const recipientEmail = str(d.recipientEmail, 200).toLowerCase()
  const recipientName = str(d.recipientName, 120)
  const personalMessage = str(d.personalMessage, 5000)
  if (!customerId) throw new HttpsError('invalid-argument', 'customerId is required.')
  if (!isEmail(recipientEmail)) throw new HttpsError('invalid-argument', 'A valid recipient email is required.')
  if (!personalMessage) throw new HttpsError('invalid-argument', 'Email message is required.')

  const custSnap = await db.collection('customers').doc(customerId).get()
  if (!custSnap.exists) throw new HttpsError('not-found', 'Customer not found.')
  const customer = custSnap.data()!
  const customerName = (customer.companyName || customer.name || 'Customer') as string

  const open = await db.collection(PACKETS)
    .where('customerId', '==', customerId)
    .where('status', 'in', ['sent', 'viewed'])
    .limit(1)
    .get()
  if (!open.empty) {
    throw new HttpsError('already-exists', 'This customer already has an open onboarding packet. Resend or void it first.')
  }

  const t = (d.terms ?? {}) as Record<string, unknown>
  const fee = (t.onboardingFee ?? {}) as Record<string, unknown>
  const rep = (t.rep ?? {}) as Record<string, unknown>
  const userSnap = await db.collection('users').doc(req.auth!.uid).get()
  const user = userSnap.data() ?? {}
  const terms: PacketTerms = {
    psaVersion: PSA_VERSION,
    achVersion: ACH_VERSION,
    effectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(str(t.effectiveDate, 10)) ? str(t.effectiveDate, 10) : '',
    rateSchedule: cleanRates(t.rateSchedule),
    onboardingFee: {
      waived: fee.waived !== false,
      amount: Math.max(0, Number(fee.amount) || 0),
    },
    serviceMethod: str(t.serviceMethod, 300) || 'Cylinder exchange',
    paymentTerms: str(t.paymentTerms, 300) || 'Payment on delivery',
    rep: {
      name: str(rep.name, 120) || (user.name as string) || '',
      phone: str(rep.phone, 40) || (user.phone as string) || '',
      email: str(rep.email, 200) || (user.email as string) || '',
    },
    askCageChoice: t.askCageChoice !== false,
  }

  const token = newPacketToken()
  const expiresAt = Timestamp.fromDate(expiryFromNow())
  const ref = db.collection(PACKETS).doc()
  const packet: Omit<OnboardingPacket, 'createdAt' | 'updatedAt'> & Record<string, unknown> = {
    customerId,
    customerName,
    status: 'sent',
    recipientName,
    recipientEmail,
    personalMessage,
    tokenHash: sha256Hex(token),
    tokenEnc: encryptString(token),
    expiresAt,
    terms,
    prefill: cleanInfo(d.prefill),
    sentBy: { uid: req.auth!.uid, name: (user.name as string) || '', email: (user.email as string) || (req.auth!.token.email as string) || '' },
    bankStatus: 'none',
    remindersSent: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  await ref.set(packet)
  await sendInvite({ ...(packet as unknown as OnboardingPacket) }, token)
  await db.collection('customers').doc(customerId).set(
    { onboardingStatus: 'sent', onboardingPacketId: ref.id, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  return { packetId: ref.id, url: packetUrl(token), expiresAt: expiresAt.toDate().toISOString() }
})

// ── resendOnboardingPacket ────────────────────────────────────────────────────

export const resendOnboardingPacket = onCall({ secrets: SECRETS }, async (req) => {
  assertStaff(req)
  const { ref, packet } = await loadPacket(str((req.data as Record<string, unknown>)?.packetId, 128))
  if (!['sent', 'viewed'].includes(packet.status)) throw new HttpsError('failed-precondition', 'Only unsigned packets can be resent.')
  const token = decryptString(packet.tokenEnc as EncryptedValue)
  const expiresAt = Timestamp.fromDate(expiryFromNow())
  await ref.update({ expiresAt, updatedAt: FieldValue.serverTimestamp() })
  await sendInvite({ ...packet, expiresAt }, token)
  return { url: packetUrl(token), expiresAt: expiresAt.toDate().toISOString() }
})

/** Staff can copy the link to text it to the customer. */
export const getOnboardingPacketLink = onCall({ secrets: SECRETS }, async (req) => {
  assertStaff(req)
  const { packet } = await loadPacket(str((req.data as Record<string, unknown>)?.packetId, 128))
  if (!['sent', 'viewed'].includes(packet.status)) throw new HttpsError('failed-precondition', 'This packet is no longer open.')
  return { url: packetUrl(decryptString(packet.tokenEnc as EncryptedValue)) }
})

// ── voidOnboardingPacket ──────────────────────────────────────────────────────

export const voidOnboardingPacket = onCall(async (req) => {
  assertStaff(req)
  const { ref, packet } = await loadPacket(str((req.data as Record<string, unknown>)?.packetId, 128))
  if (!['sent', 'viewed'].includes(packet.status)) throw new HttpsError('failed-precondition', 'Signed packets cannot be voided.')
  await ref.update({ status: 'voided', voidedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  await db.collection('customers').doc(packet.customerId).set({ onboardingStatus: 'voided', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { success: true }
})

// ── getOnboardingPacketPublic ─────────────────────────────────────────────────

export const getOnboardingPacketPublic = onCall(PUBLIC_OPTS, async (req) => {
  const token = str((req.data as Record<string, unknown>)?.token, 200)
  const { ref, packet } = await findByToken(token)
  const company = await getCompanySettings()
  const companyInfo = { name: company.name, phone: company.phone, email: company.email, website: company.website, logoUrl: company.logoUrl }

  if (packet.status === 'signed' || packet.status === 'countersigned') {
    return {
      status: packet.status,
      customerName: packet.customerName,
      company: companyInfo,
      signedAt: packet.signedAt?.toDate().toISOString() ?? null,
    }
  }
  assertOpen(packet)

  if (packet.status === 'sent') {
    await ref.update({ status: 'viewed', viewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    await db.collection('customers').doc(packet.customerId).set({ onboardingStatus: 'viewed' }, { merge: true })
  }

  return {
    status: 'open',
    customerName: packet.customerName,
    recipientName: packet.recipientName,
    company: companyInfo,
    terms: packet.terms,
    prefill: packet.prefill,
    documents: documentPayload(packet),
    expiresAt: packet.expiresAt.toDate().toISOString(),
    hasW9: Boolean(w9Buffer()),
  }
})

// ── getOnboardingW9 ───────────────────────────────────────────────────────────

export const getOnboardingW9 = onCall(async (req) => {
  const token = str((req.data as Record<string, unknown>)?.token, 200)
  await findByToken(token)
  const buf = w9Buffer()
  if (!buf) throw new HttpsError('not-found', 'W-9 is not available.')
  return { fileName: 'Ohio-Gas-Supply-W9.pdf', base64: buf.toString('base64') }
})

// ── submitOnboardingPacket ────────────────────────────────────────────────────

export const submitOnboardingPacket = onCall(PUBLIC_OPTS, async (req) => {
  const d = (req.data ?? {}) as Record<string, unknown>
  const token = str(d.token, 200)
  const { id: packetId, ref, packet } = await findByToken(token)
  if (packet.status === 'signed' || packet.status === 'countersigned') {
    throw new HttpsError('already-exists', 'These documents have already been signed.')
  }
  assertOpen(packet)

  const info = cleanInfo(d.info)
  const required: Array<[keyof PacketCustomerInfo, string]> = [
    ['legalName', 'Customer legal name'], ['billingAddress', 'Billing address'], ['deliveryAddress', 'Delivery address'],
    ['contactName', 'Authorized contact'], ['contactTitle', 'Contact title'], ['contactEmail', 'Contact email'], ['contactPhone', 'Contact phone'],
  ]
  for (const [k, label] of required) if (!info[k]) throw new HttpsError('invalid-argument', `${label} is required.`)
  if (!isEmail(info.contactEmail)) throw new HttpsError('invalid-argument', 'Contact email is not valid.')
  if (info.apEmail && !isEmail(info.apEmail)) throw new HttpsError('invalid-argument', 'Accounts payable email is not valid.')

  const cageRaw = str(d.cageChoice, 20) as CageChoice
  const cageChoice: CageChoice = packet.terms.askCageChoice
    ? (['purchase', 'rent', 'undecided'].includes(cageRaw) ? cageRaw : 'undecided')
    : 'not_applicable'

  const paymentMethod = str(d.paymentMethod, 10) === 'card' ? 'card' : 'ach'
  let bankPublic: NonNullable<OnboardingPacket['submission']>['bank'] | undefined
  let bankSecret: { routingNumber: string; accountNumber: string } | null = null
  if (paymentMethod === 'ach') {
    const b = (d.bank ?? {}) as Record<string, unknown>
    const routingNumber = str(b.routingNumber, 20).replace(/\D/g, '')
    const accountNumber = str(b.accountNumber, 30).replace(/\D/g, '')
    const bankName = str(b.bankName, 120)
    const holderName = str(b.holderName, 120)
    const accountType = str(b.accountType, 10) === 'savings' ? 'savings' : 'checking'
    if (!bankName || !holderName) throw new HttpsError('invalid-argument', 'Bank name and account holder name are required.')
    if (!/^\d{9}$/.test(routingNumber) || !abaChecksumOk(routingNumber)) throw new HttpsError('invalid-argument', 'Routing number is not valid. It should be 9 digits.')
    if (!/^\d{4,17}$/.test(accountNumber)) throw new HttpsError('invalid-argument', 'Bank account number is not valid.')
    bankPublic = { bankName, holderName, accountType, accountLast4: accountNumber.slice(-4), routingLast4: routingNumber.slice(-4) }
    bankSecret = { routingNumber, accountNumber }
  }

  const sig = (d.signature ?? {}) as Record<string, unknown>
  const signerName = str(sig.name, 120)
  const signerTitle = str(sig.title, 120)
  const method = str(sig.method, 10) === 'drawn' ? 'drawn' : 'typed'
  const imageDataUrl = str(sig.imageDataUrl, 400_000)
  if (!signerName || !signerTitle) throw new HttpsError('invalid-argument', 'Signer name and title are required.')
  if (method === 'drawn' && !validSignatureImage(imageDataUrl)) throw new HttpsError('invalid-argument', 'Please draw your signature.')
  if (d.esignConsent !== true) throw new HttpsError('invalid-argument', 'You must agree to sign electronically.')
  if (d.agreeTerms !== true) throw new HttpsError('invalid-argument', 'You must accept the agreement and payment authorization.')

  const signedAt = new Date()
  const signer: SignatureCapture = {
    name: signerName,
    title: signerTitle,
    method,
    ...(method === 'drawn' ? { imageDataUrl } : {}),
    signedAt,
  }

  const ipAddress = (
    (req.rawRequest.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    || req.rawRequest.ip
    || ''
  ).slice(0, 64)
  const userAgent = str(req.rawRequest.headers['user-agent'] as string | undefined, 400)

  const documentHash = sha256Hex(JSON.stringify({
    documents: documentPayload(packet),
    terms: packet.terms,
    info,
    cageChoice,
    paymentMethod,
    bank: bankPublic ?? null,
    signer: { name: signerName, title: signerTitle, method, signedAt: signedAt.toISOString() },
  }))

  const submission = {
    info,
    cageChoice,
    siteVisitNotes: str(d.siteVisitNotes, 1000),
    paymentMethod,
    ...(bankPublic ? { bank: bankPublic } : {}),
    signer,
    esignConsent: true as const,
    ipAddress,
    userAgent,
    documentHash,
  }

  // Claim the packet atomically so double-clicks can't submit twice.
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref)
    const st = fresh.data()?.status
    if (st !== 'sent' && st !== 'viewed') throw new HttpsError('already-exists', 'These documents have already been signed.')
    tx.update(ref, {
      status: 'signed',
      submission,
      signedAt: Timestamp.fromDate(signedAt),
      bankStatus: bankSecret ? 'pending_entry' : 'none',
      updatedAt: FieldValue.serverTimestamp(),
    })
    if (bankSecret) {
      tx.set(ref.collection('secure').doc('bank'), {
        enc: encryptString(JSON.stringify(bankSecret)),
        createdAt: FieldValue.serverTimestamp(),
      })
    }
  })

  const signedPacket = { ...packet, status: 'signed', submission, signedAt: Timestamp.fromDate(signedAt) } as OnboardingPacket
  const pdfs = await generatePacketPdfs(packetId, signedPacket)
  await ref.update({
    files: {
      psa: { url: pdfs.psa.url, storagePath: pdfs.psa.storagePath, fileName: pdfs.psa.fileName },
      ...(pdfs.ach ? { ach: { url: pdfs.ach.url, storagePath: pdfs.ach.storagePath, fileName: pdfs.ach.fileName } } : {}),
    },
  })

  // Update the customer record with confirmed details.
  await db.collection('customers').doc(packet.customerId).set({
    onboardingStatus: 'signed',
    agreementStatus: 'draft',
    paymentMethodStatus: paymentMethod === 'ach' ? 'setup_requested' : 'invoice_requested',
    preferredPaymentMethod: paymentMethod,
    billingEmail: info.apEmail || info.contactEmail,
    apContactPhone: info.apPhone || null,
    legalName: info.legalName,
    cageChoice,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const attachments: MailAttachment[] = [
    { content: pdfs.psa.buffer.toString('base64'), filename: pdfs.psa.fileName, type: 'application/pdf' },
    ...(pdfs.ach ? [{ content: pdfs.ach.buffer.toString('base64'), filename: pdfs.ach.fileName, type: 'application/pdf' }] : []),
  ]

  const joinUrl = await ensureJoinLink(packet.customerId).catch(() => null)
  await sendEmail({
    to: info.contactEmail,
    replyTo: packet.sentBy.email || undefined,
    subject: 'Ohio Gas Supply — signed documents received',
    html: customerSignedEmail({ signerName, joinUrl }),
    attachments,
  })

  const company = await getCompanySettings()
  const internalTo = Array.from(new Set([packet.sentBy.email, company.email].filter((e): e is string => Boolean(e) && isEmail(e))))
  const cageLabel = { purchase: 'Purchase', rent: 'Rent', undecided: 'Undecided', not_applicable: 'N/A' }[cageChoice]
  for (const to of internalTo) {
    await sendEmail({
      to,
      subject: `Onboarding signed: ${packet.customerName}`,
      html: internalSignedEmail({
        customerName: packet.customerName,
        signerName,
        signerTitle,
        paymentMethod,
        cageChoice: cageLabel,
        siteVisitNotes: submission.siteVisitNotes,
        recordUrl: `${APP_ORIGIN}/crm/customers/${packet.customerId}?tab=onboarding`,
      }),
      attachments,
    })
  }

  return { success: true, joinUrl }
})

/** ABA routing number checksum (3-7-1 weighting). */
function abaChecksumOk(r: string): boolean {
  const n = r.split('').map(Number)
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])
  return sum % 10 === 0
}

// ── countersignOnboardingPacket ───────────────────────────────────────────────

export const countersignOnboardingPacket = onCall({ secrets: SECRETS, memory: '512MiB', timeoutSeconds: 120 }, async (req) => {
  assertAdmin(req)
  const d = (req.data ?? {}) as Record<string, unknown>
  const { ref, packet } = await loadPacket(str(d.packetId, 128))
  if (packet.status !== 'signed') throw new HttpsError('failed-precondition', 'Packet must be signed by the customer first.')
  const name = str(d.name, 120)
  const title = str(d.title, 120)
  const method = str(d.method, 10) === 'drawn' ? 'drawn' : 'typed'
  const imageDataUrl = str(d.imageDataUrl, 400_000)
  if (!name || !title) throw new HttpsError('invalid-argument', 'Name and title are required.')
  if (method === 'drawn' && !validSignatureImage(imageDataUrl)) throw new HttpsError('invalid-argument', 'Please draw a signature.')

  const signedAt = new Date()
  const countersign = { name, title, method, ...(method === 'drawn' ? { imageDataUrl } : {}), signedAt, uid: req.auth!.uid }
  const updated = { ...packet, countersign, status: 'countersigned' } as OnboardingPacket
  const pdfs = await generatePacketPdfs(ref.id, updated, true)

  await ref.update({
    status: 'countersigned',
    countersign: { ...countersign, signedAt: Timestamp.fromDate(signedAt) },
    countersignedAt: Timestamp.fromDate(signedAt),
    'files.psa': { url: pdfs.psa.url, storagePath: pdfs.psa.storagePath, fileName: pdfs.psa.fileName },
    updatedAt: FieldValue.serverTimestamp(),
  })
  await db.collection('customers').doc(packet.customerId).set({
    onboardingStatus: 'complete',
    agreementStatus: 'signed',
    agreementSignedAt: Timestamp.fromDate(signedAt),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const to = packet.submission?.info.contactEmail
  if (to) {
    await sendEmail({
      to,
      replyTo: packet.sentBy.email || undefined,
      subject: 'Ohio Gas Supply — your executed Product Supply Agreement',
      html: countersignedEmail({ signerName: packet.submission!.signer.name }),
      attachments: [{ content: pdfs.psa.buffer.toString('base64'), filename: pdfs.psa.fileName, type: 'application/pdf' }],
    })
  }
  return { success: true, url: pdfs.psa.url }
})

// ── Bank details: reveal + mark entered ───────────────────────────────────────

export const revealOnboardingBankDetails = onCall({ secrets: [ONBOARDING_ENCRYPTION_KEY] }, async (req) => {
  assertAdmin(req)
  const { ref, packet } = await loadPacket(str((req.data as Record<string, unknown>)?.packetId, 128))
  const secure = await ref.collection('secure').doc('bank').get()
  if (!secure.exists) throw new HttpsError('not-found', 'Bank details are not on file (already entered in QuickBooks and removed, or card selected).')
  const { routingNumber, accountNumber } = JSON.parse(decryptString(secure.data()!.enc as EncryptedValue)) as { routingNumber: string; accountNumber: string }
  await ref.collection('accessLog').add({
    action: 'reveal_bank',
    uid: req.auth!.uid,
    email: (req.auth!.token.email as string) || '',
    at: FieldValue.serverTimestamp(),
  })
  await ref.update({ bankRevealCount: FieldValue.increment(1) })
  return {
    bankName: packet.submission?.bank?.bankName ?? '',
    holderName: packet.submission?.bank?.holderName ?? '',
    accountType: packet.submission?.bank?.accountType ?? 'checking',
    routingNumber,
    accountNumber,
  }
})

export const markOnboardingBankEntered = onCall(async (req) => {
  assertAdmin(req)
  const { ref, packet } = await loadPacket(str((req.data as Record<string, unknown>)?.packetId, 128))
  if (packet.bankStatus !== 'pending_entry') throw new HttpsError('failed-precondition', 'No bank details are pending entry.')
  await ref.collection('secure').doc('bank').delete()
  await ref.collection('accessLog').add({ action: 'bank_entered_and_purged', uid: req.auth!.uid, at: FieldValue.serverTimestamp() })
  await ref.update({
    bankStatus: 'entered_in_quickbooks',
    bankEnteredAt: FieldValue.serverTimestamp(),
    bankEnteredBy: req.auth!.uid,
    updatedAt: FieldValue.serverTimestamp(),
  })
  await db.collection('customers').doc(packet.customerId).set({ paymentMethodStatus: 'saved', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { success: true }
})

// ── sendOnboardingReminders (daily) ───────────────────────────────────────────

export const sendOnboardingReminders = onSchedule(
  { schedule: 'every day 10:00', timeZone: 'America/New_York', secrets: SECRETS },
  async () => {
    const snap = await db.collection(PACKETS).where('status', 'in', ['sent', 'viewed']).get()
    const now = Date.now()
    const DAY = 24 * 60 * 60 * 1000
    for (const doc of snap.docs) {
      const p = doc.data() as OnboardingPacket
      if (!p.createdAt || p.expiresAt.toDate().getTime() < now) continue
      const sent = p.remindersSent ?? 0
      const age = now - p.createdAt.toDate().getTime()
      const due = (sent === 0 && age >= 3 * DAY) || (sent === 1 && age >= 7 * DAY)
      if (!due) continue
      try {
        await sendInvite(p, decryptString(p.tokenEnc as EncryptedValue), true)
        await doc.ref.update({ remindersSent: sent + 1, lastReminderAt: FieldValue.serverTimestamp() })
      } catch (err) {
        console.error('[sendOnboardingReminders] failed for', doc.id, err)
      }
    }
  },
)
