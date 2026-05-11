import type { Timestamp } from 'firebase/firestore'

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void'

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded'

export interface InvoiceLineItem {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface Invoice {
  id: string
  invoiceNumber: string
  customerId: string
  customerContactName?: string
  customerContactEmail?: string
  orderId?: string
  quoteId?: string
  quoteNumber?: string
  leadId?: string
  status: InvoiceStatus
  lineItems: InvoiceLineItem[]
  notes?: string
  terms?: string
  paymentTermsDays?: number
  applySalesTax?: boolean
  salesTaxRate?: number
  salesTaxAmount?: number
  taxRate?: number
  subtotal: number
  tax: number
  total: number
  /** Date the invoice was issued / sent to the customer. */
  issuedAt: Timestamp
  /** Payment due date. */
  dueAt: Timestamp
  paidAt?: Timestamp
  stripeInvoiceId?: string
  /** Active Stripe PaymentIntent ID for the current payment attempt. */
  stripePaymentIntentId?: string
  /** Cached clientSecret — reused on retry if the PI is still open. */
  stripeClientSecret?: string
  /** Signed Storage URL to the generated PDF invoice. */
  pdfUrl?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Payment {
  id: string
  customerId: string
  invoiceId: string
  amount: number
  status: PaymentStatus
  method: 'card' | 'ach' | 'check' | 'cash'
  stripePaymentIntentId?: string
  processedAt?: Timestamp
  createdAt: Timestamp
}

export interface PaymentMethod {
  id: string
  customerId: string
  stripePaymentMethodId: string
  type: 'card' | 'us_bank_account'
  /** Card network, e.g. "visa", "mastercard". */
  brand?: string
  last4: string
  expMonth?: number
  expYear?: number
  isDefault: boolean
  createdAt: Timestamp
}
