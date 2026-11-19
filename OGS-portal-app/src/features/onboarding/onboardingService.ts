/**
 * src/features/onboarding/onboardingService.ts
 *
 * Client wrappers for the digital onboarding packet Cloud Functions.
 * Packets are written only by Functions; staff read them via Firestore.
 */

import { httpsCallable } from 'firebase/functions'
import { collection, doc, getDoc, onSnapshot, query, setDoc, where, type Timestamp } from 'firebase/firestore'
import { db, functions } from '../../lib/firebase'

export interface RateLine { label: string; charge: string; basis: string }

export interface PacketCustomerInfo {
  legalName: string
  billingAddress: string
  deliveryAddress: string
  contactName: string
  contactTitle: string
  contactEmail: string
  contactPhone: string
  apEmail: string
  apPhone: string
}

export interface PacketTerms {
  psaVersion?: string
  achVersion?: string
  effectiveDate: string
  rateSchedule: RateLine[]
  onboardingFee: { waived: boolean; amount: number }
  serviceMethod: string
  paymentTerms: string
  rep: { name: string; phone: string; email: string }
  askCageChoice: boolean
}

export type PacketStatus = 'sent' | 'viewed' | 'signed' | 'countersigned' | 'voided'
export type CageChoice = 'purchase' | 'rent' | 'undecided' | 'not_applicable'

export interface OnboardingPacketDoc {
  id: string
  customerId: string
  customerName: string
  status: PacketStatus
  recipientName: string
  recipientEmail: string
  expiresAt: Timestamp
  terms: PacketTerms
  sentBy: { uid: string; name: string; email: string }
  submission?: {
    info: PacketCustomerInfo
    cageChoice: CageChoice
    siteVisitNotes: string
    paymentMethod: 'ach' | 'card'
    bank?: { bankName: string; holderName: string; accountType: string; accountLast4: string; routingLast4: string }
    signer: { name: string; title: string; method: string; signedAt: Timestamp }
    ipAddress: string
  }
  countersign?: { name: string; title: string; signedAt: Timestamp }
  files?: {
    psa?: { url: string; fileName: string }
    ach?: { url: string; fileName: string }
  }
  bankStatus?: 'none' | 'pending_entry' | 'entered_in_quickbooks'
  bankRevealCount?: number
  remindersSent?: number
  createdAt?: Timestamp
  viewedAt?: Timestamp
  signedAt?: Timestamp
  countersignedAt?: Timestamp
  voidedAt?: Timestamp
}

/** Live list of packets for one customer, newest first. */
export function subscribeToCustomerPackets(
  customerId: string,
  onData: (packets: OnboardingPacketDoc[]) => void,
  onError: (err: Error) => void,
): () => void {
  const q = query(collection(db, 'onboardingPackets'), where('customerId', '==', customerId))
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OnboardingPacketDoc, 'id'>) }))
      rows.sort((a, b) => (b.createdAt?.toMillis?.() ?? Date.now()) - (a.createdAt?.toMillis?.() ?? Date.now()))
      onData(rows)
    },
    onError,
  )
}

function call<I, O>(name: string) {
  return async (input: I): Promise<O> => (await httpsCallable<I, O>(functions, name)(input)).data
}

// Staff
export const createOnboardingPacket = call<{
  customerId: string
  recipientName: string
  recipientEmail: string
  personalMessage: string
  terms: PacketTerms
  prefill: PacketCustomerInfo
}, { packetId: string; url: string; expiresAt: string }>('createOnboardingPacket')

export const resendOnboardingPacket = call<{ packetId: string }, { url: string; expiresAt: string }>('resendOnboardingPacket')
export const getOnboardingPacketLink = call<{ packetId: string }, { url: string }>('getOnboardingPacketLink')
export const voidOnboardingPacket = call<{ packetId: string }, { success: boolean }>('voidOnboardingPacket')
export const countersignOnboardingPacket = call<{
  packetId: string; name: string; title: string; method: 'drawn' | 'typed'; imageDataUrl?: string
}, { success: boolean; url: string }>('countersignOnboardingPacket')
export const revealOnboardingBankDetails = call<{ packetId: string }, {
  bankName: string; holderName: string; accountType: string; routingNumber: string; accountNumber: string
}>('revealOnboardingBankDetails')
export const markOnboardingBankEntered = call<{ packetId: string }, { success: boolean }>('markOnboardingBankEntered')

// Public (token-gated)
export interface PsaSection { number: number; title: string; group: string | null; paragraphs: string[] }

export type PublicPacketResponse =
  | {
      status: 'signed' | 'countersigned'
      customerName: string
      company: PublicCompany
      signedAt: string | null
    }
  | {
      status: 'open'
      customerName: string
      recipientName: string
      company: PublicCompany
      terms: PacketTerms
      prefill: PacketCustomerInfo
      documents: {
        psa: { version: string; title: string; intro: string; rateNote: string; rateFootnote: string; sections: PsaSection[] }
        ach: { version: string; title: string; paragraphs: string[]; cardNote: string; footnote: string }
        esignConsent: string
      }
      expiresAt: string
      hasW9: boolean
    }

export interface PublicCompany { name: string; phone: string; email: string; website: string; logoUrl: string }

export const getOnboardingPacketPublic = call<{ token: string }, PublicPacketResponse>('getOnboardingPacketPublic')
export const getOnboardingW9 = call<{ token: string }, { fileName: string; base64: string }>('getOnboardingW9')
export const submitOnboardingPacket = call<{
  token: string
  info: PacketCustomerInfo
  cageChoice: CageChoice
  siteVisitNotes: string
  paymentMethod: 'ach' | 'card'
  bank?: { bankName: string; holderName: string; accountType: 'checking' | 'savings'; routingNumber: string; accountNumber: string }
  signature: { name: string; title: string; method: 'drawn' | 'typed'; imageDataUrl?: string }
  esignConsent: boolean
  agreeTerms: boolean
}, { success: boolean; joinUrl: string | null }>('submitOnboardingPacket')

export function callableErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { message?: string; code?: string }
  if (e?.message && !/^internal$/i.test(e.message)) return e.message
  return fallback
}

export const DEFAULT_RATE_SCHEDULE: RateLine[] = [
  { label: 'Propane 33 lb cylinder',    charge: '$45.00',    basis: 'Per cylinder supplied' },
  { label: 'Hazmat fee',                charge: '$4.50',     basis: 'Per delivery' },
  { label: 'Scheduled delivery charge', charge: '$30.00',    basis: 'Per delivery' },
  { label: 'Emergency delivery charge', charge: '$100.00',   basis: 'As requested' },
  { label: '12 cylinder cage rental',   charge: '$30.00',    basis: 'Per month' },
  { label: '12 cylinder cage purchase', charge: '$2,031.00', basis: 'One-time purchase' },
]

export const DEFAULT_MESSAGE_TEMPLATE = [
  'Hi {firstName},',
  "Excellent! We're looking forward to working with you. Let me know a convenient time — we'd prefer to check out where you'd like the cage set and see the site prior to any deliveries.",
  "Use the button below to review and sign your Product Supply Agreement and set up your payment authorization. Product deliveries are billed upon delivery; monthly rentals are billed on the 1st of each month in arrears. You'll also be able to let us know whether you'd prefer to purchase or rent the 12-cylinder storage cage.",
  'Let me know if you have any questions or need anything else.',
  '{repName}',
].join('\n\n')

/** Fill {firstName} / {repName} placeholders in a message template. */
export function renderMessageTemplate(template: string, firstName: string, repName: string): string {
  return template
    .replace(/\{firstName\}/g, firstName || 'there')
    .replace(/\{repName\}/g, repName || 'Ohio Gas Supply')
}

export function defaultPersonalMessage(firstName: string, repName: string): string {
  return renderMessageTemplate(DEFAULT_MESSAGE_TEMPLATE, firstName, repName)
}

// ── Editable defaults (settings/onboardingDefaults) ──────────────────────────

export interface OnboardingDefaults {
  messageTemplate: string
  rateSchedule: RateLine[]
  feeWaived: boolean
  feeAmount: number
  serviceMethod: string
  paymentTerms: string
  askCageChoice: boolean
}

export const BUILT_IN_ONBOARDING_DEFAULTS: OnboardingDefaults = {
  messageTemplate: DEFAULT_MESSAGE_TEMPLATE,
  rateSchedule: DEFAULT_RATE_SCHEDULE,
  feeWaived: true,
  feeAmount: 0,
  serviceMethod: 'Cylinder exchange',
  paymentTerms: 'Payment on delivery',
  askCageChoice: true,
}

const onboardingDefaultsRef = () => doc(db, 'settings', 'onboardingDefaults')

/** Saved defaults merged over the built-in ones. Falls back to built-ins on any error. */
export async function getOnboardingDefaults(): Promise<OnboardingDefaults> {
  try {
    const snap = await getDoc(onboardingDefaultsRef())
    if (!snap.exists()) return { ...BUILT_IN_ONBOARDING_DEFAULTS }
    const d = snap.data() as Partial<OnboardingDefaults>
    return {
      ...BUILT_IN_ONBOARDING_DEFAULTS,
      ...d,
      messageTemplate: d.messageTemplate?.trim() ? d.messageTemplate : DEFAULT_MESSAGE_TEMPLATE,
      rateSchedule: Array.isArray(d.rateSchedule) && d.rateSchedule.length ? d.rateSchedule : DEFAULT_RATE_SCHEDULE,
    }
  } catch {
    return { ...BUILT_IN_ONBOARDING_DEFAULTS }
  }
}

/** Admin only (enforced by Firestore rules on /settings). */
export async function saveOnboardingDefaults(d: OnboardingDefaults): Promise<void> {
  await setDoc(onboardingDefaultsRef(), {
    ...d,
    rateSchedule: d.rateSchedule
      .map((r) => ({ label: r.label.trim(), charge: r.charge.trim(), basis: r.basis.trim() }))
      .filter((r) => r.label),
  })
}

export interface SignatureValue {
  method: 'drawn' | 'typed'
  imageDataUrl?: string
}

export function signatureReady(name: string, v: SignatureValue): boolean {
  return v.method === 'typed' ? name.trim().length > 1 : Boolean(v.imageDataUrl)
}
