/**
 * functions/src/onboardingPackets/types.ts
 *
 * Firestore shape for onboardingPackets/{packetId}.
 * Sensitive bank numbers are NOT stored here — they live encrypted in
 * onboardingPackets/{packetId}/secure/bank, which clients can never read.
 */

import type { RateLine } from './psaTemplate'

export type PacketStatus = 'sent' | 'viewed' | 'signed' | 'countersigned' | 'voided'

export interface PacketTerms {
  psaVersion: string
  achVersion: string
  effectiveDate: string            // YYYY-MM-DD
  rateSchedule: RateLine[]
  onboardingFee: { waived: boolean; amount: number }
  serviceMethod: string
  paymentTerms: string
  rep: { name: string; phone: string; email: string }
  /** Whether to ask the customer to choose purchase vs rent for the cage. */
  askCageChoice: boolean
}

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

export type CageChoice = 'purchase' | 'rent' | 'undecided' | 'not_applicable'

export interface SignatureCapture {
  name: string
  title: string
  /** 'drawn' = PNG data URL from signature pad, 'typed' = rendered from name */
  method: 'drawn' | 'typed'
  imageDataUrl?: string
  signedAt: FirebaseFirestore.Timestamp | Date
}

export interface PacketSubmission {
  info: PacketCustomerInfo
  cageChoice: CageChoice
  siteVisitNotes: string
  paymentMethod: 'ach' | 'card'
  bank?: {
    bankName: string
    holderName: string
    accountType: 'checking' | 'savings'
    accountLast4: string
    routingLast4: string
  }
  signer: SignatureCapture
  esignConsent: true
  ipAddress: string
  userAgent: string
  documentHash: string
}

export interface OnboardingPacket {
  customerId: string
  customerName: string
  status: PacketStatus
  recipientName: string
  recipientEmail: string
  personalMessage: string
  tokenHash: string
  tokenEnc: unknown
  expiresAt: FirebaseFirestore.Timestamp
  terms: PacketTerms
  prefill: PacketCustomerInfo
  sentBy: { uid: string; name: string; email: string }
  submission?: PacketSubmission
  countersign?: SignatureCapture & { uid: string }
  files?: {
    psa?: { url: string; storagePath: string; fileName: string }
    ach?: { url: string; storagePath: string; fileName: string }
  }
  bankStatus?: 'none' | 'pending_entry' | 'entered_in_quickbooks'
  bankEnteredAt?: FirebaseFirestore.Timestamp
  bankEnteredBy?: string
  bankRevealCount?: number
  remindersSent?: number
  lastReminderAt?: FirebaseFirestore.Timestamp
  createdAt: FirebaseFirestore.Timestamp
  updatedAt: FirebaseFirestore.Timestamp
  viewedAt?: FirebaseFirestore.Timestamp
  signedAt?: FirebaseFirestore.Timestamp
  countersignedAt?: FirebaseFirestore.Timestamp
  voidedAt?: FirebaseFirestore.Timestamp
}
