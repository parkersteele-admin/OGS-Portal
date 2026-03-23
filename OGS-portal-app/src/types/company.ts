/**
 * src/types/company.ts
 *
 * Types for the customer onboarding flow.
 * Documents live in Firestore at customers/{companyId}.
 *
 * NOTE: companyId is always a Firestore auto-generated ID — never a Firebase
 * Auth UID. All cross-references use companyId.
 */

import type { Timestamp } from 'firebase/firestore'

// ── Address ───────────────────────────────────────────────────────────────────

export interface OnboardingAddress {
  street: string
  city: string
  state: string
  zip: string
}

// ── Usage Profile ─────────────────────────────────────────────────────────────

export interface UsageEntry {
  category: string
  cylinderSize: string
  monthlyEst: string
  ownership: string
}

// ── Company Status / Setup ────────────────────────────────────────────────────

export type CompanyStatus =
  | 'pending_verification'
  | 'pending_quote'
  | 'active'
  | 'suspended'
  | 'merged'

export type CompanySetupStep = 0 | 1 | 2 | 3 | 4 | 5

export type PaymentMethodType = 'cod' | 'card' | 'ach' | 'net30' | null

export type BusinessType =
  | 'restaurant'
  | 'brewery'
  | 'medical_dental'
  | 'fabricator'
  | 'other'

// ── Sole Practitioner Attestation ─────────────────────────────────────────────

export interface SolePractitionerAttestation {
  signedBy: string
  signedAt: Timestamp
}

// ── Company (customers/{companyId}) ──────────────────────────────────────────

export interface Company {
  /** Firestore document ID — always auto-generated, never a UID. */
  companyId: string
  companyName: string
  /** Lowercase, punctuation stripped, common suffixes removed. */
  companyNameNormalized: string
  /** Domain extracted from owner email; null if generic provider. */
  domain: string | null
  billingAddress: OnboardingAddress
  /** Delivery address if different from billing; null means same-as-billing. */
  deliveryAddress: OnboardingAddress | null
  status: CompanyStatus
  setupStep: CompanySetupStep
  setupComplete: boolean
  paymentMethod: PaymentMethodType
  billingEmail: string
  smsOptIn: boolean
  smsPhone: string | null
  smsConsentAt: Timestamp | null
  usageProfile: UsageEntry[]
  businessType: BusinessType | null
  taxExempt: boolean
  taxExemptNumber: string | null
  /** For medical/dental accounts — requires admin verification. */
  tdddRequired?: boolean
  tdddUploaded?: boolean
  /** Sole practitioner dentist TDDD exemption. */
  solePractitionerAttestation?: SolePractitionerAttestation | null
  billingContactName: string
  generalManagerName: string | null
  phone: string
  createdAt: Timestamp
  createdBy: string
  pwaInstallPrompted: boolean
  /** Set when this company is merged into another. */
  mergedInto?: string
  /**
   * Controls whether this company's portal users can see product pricing and
   * place orders. Defaults to false for new web signups — set to true by
   * CRM/admin after the first quote is sent or manually unlocked.
   */
  pricingUnlocked?: boolean
}

// ── Location (customers/{companyId}/locations/{locationId}) ──────────────────

export type CylinderStorage = 'outdoors' | 'indoors' | 'dock'

export type PreferredDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export interface DeliveryLocation {
  id: string
  nickname: string
  address: OnboardingAddress
  accessNotes: string
  preferredDays: PreferredDay[]
  contactName: string
  contactPhone: string
  cylinderStorage: CylinderStorage
  currentProvider: string | null
}

// ── Credit Application (creditApplications/{companyId}) ──────────────────────

export interface CreditOfficer {
  name: string
  position: string
  address: string
}

export interface TradeReference {
  firm: string
  address: string
  contact: string
  phone: string
  email: string
}

export interface BankReference {
  bank: string
  accountNumber: string
  contact: string
  phone: string
}

export type LegalEntity = 'individual' | 'partnership' | 'corporation'

export interface CreditApplication {
  companyId: string
  legalEntity: LegalEntity
  yearsInBusiness: number
  federalTaxId: string
  officers: CreditOfficer[]
  tradeRefs: TradeReference[]
  bankRef: BankReference
  signedBy: string
  signedAt: Timestamp
  status: 'pending_review' | 'approved' | 'denied'
}

// ── Quote Request (quoteRequests/{quoteId}) ───────────────────────────────────

export interface QuoteRequest {
  id: string
  companyId: string
  usageProfile: UsageEntry[]
  locations: DeliveryLocation[]
  status: 'pending' | 'quoted' | 'accepted' | 'declined'
  createdAt: Timestamp
}

// ── Invite (invites/{inviteId}) ───────────────────────────────────────────────

export type CustomerRole = 'owner' | 'manager' | 'billing' | 'delivery' | 'viewer'

export interface TeamInvite {
  id: string
  companyId: string
  email: string
  role: CustomerRole
  status: 'pending' | 'accepted' | 'expired'
  expiresAt: Timestamp
  createdAt: Timestamp
}

// ── Join Request (joinRequests/{requestId}) ───────────────────────────────────

export interface JoinRequest {
  id: string
  companyId: string
  requesterUid: string
  requesterEmail: string
  requesterName: string
  status: 'pending' | 'approved' | 'denied'
  createdAt: Timestamp
}

// ── Onboarding User (users/{uid}) ─────────────────────────────────────────────

export interface OnboardingUser {
  uid: string
  companyId: string | null
  email: string
  firstName: string
  lastName: string
  phone: string | null
  role: CustomerRole
  isPrimary: boolean
  status: 'active' | 'pending' | 'inactive'
  smsOptIn: boolean
  smsPhone: string | null
  pwaInstallPrompted: boolean
  createdAt: Timestamp
  lastLoginAt: Timestamp | null
}
