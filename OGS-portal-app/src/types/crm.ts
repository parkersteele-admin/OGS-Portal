import type { Timestamp } from 'firebase/firestore'

// ── Leads ─────────────────────────────────────────────────────────────────────
export type LeadStatus = 'pending_setup' | 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost'

export interface Lead {
  id: string
  name: string
  email: string
  phone?: string
  company?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  status: LeadStatus
  source?: string
  /** True when this lead was created automatically from a website signup. */
  isWebSignup?: boolean
  /** UID of the sales rep assigned to this lead. */
  assignedTo?: string
  estimatedValue?: number
  notes?: string
  convertedToCustomerId?: string
  /** companyId of the linked customer doc, set for web signups. */
  companyId?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ── Quotes ────────────────────────────────────────────────────────────────────
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'

export interface QuoteItem {
  productId: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

/**
 * Internal-only profitability metrics used by CRM/Admin quote builder.
 * These fields are never persisted in customer-facing quote payloads.
 */
export interface QuoteLineProfitability {
  cost: number
  basePrice: number
  minMarginPercent: number
  minPrice: number
  marginPercent: number
  profit: number
}

export interface Quote {
  id: string
  quoteNumber: string
  /** Either a lead or a converted customer. */
  leadId?: string
  customerId?: string
  status: QuoteStatus
  lineItems: QuoteItem[]
  subtotal: number
  tax: number
  total: number
  validUntil: Timestamp
  acceptedAt?: Timestamp
  /** Set after a draft invoice is auto-created on acceptance. */
  invoiceId?: string
  /** Set to true on acceptance — prompts staff to create a standing order. */
  needsOrderSetup?: boolean
  /** UID of the sales rep who created the quote. */
  createdBy: string
  notes?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

// ── Contact Log ───────────────────────────────────────────────────────────────
export type ContactMethod = 'call' | 'email' | 'text' | 'in-person' | 'other'

export interface ContactLog {
  id: string
  /** Links to either a Lead or a Customer. */
  entityType: 'lead' | 'customer'
  entityId: string
  method: ContactMethod
  summary: string
  /** UID of the staff member who made contact. */
  loggedBy: string
  contactedAt: Timestamp
  createdAt: Timestamp
}
