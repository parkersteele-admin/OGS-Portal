import {
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { quotesCol } from '../lib/firestore'
import type { Quote, QuoteStatus, QuoteItem } from '../types/crm'
import { serviceCall, fromSnap, paginate, type Page, type PageOptions, OgsValidationError } from './base'

export interface QuoteFilters {
  customerId?: string
  leadId?: string
  status?: QuoteStatus
}

export interface CreateQuoteInput {
  leadId?: string
  customerId?: string
  lineItems: QuoteItem[]
  validUntil: Date
  notes?: string
  createdBy: string
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export function calculateQuoteTotals(
  lineItems: QuoteItem[],
  taxRate = 0,
): { subtotal: number; tax: number; total: number } {
  const subtotal = parseFloat(
    lineItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
  )
  const tax = parseFloat((subtotal * taxRate).toFixed(2))
  return { subtotal, tax, total: parseFloat((subtotal + tax).toFixed(2)) }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getQuote(id: string): Promise<Quote> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'quotes', id))
    return fromSnap<Quote>(snap, 'quotes')
  })
}

export async function getQuotes(
  filters: QuoteFilters = {},
  options: PageOptions = {},
): Promise<Page<Quote>> {
  return serviceCall(async () => {
    const constraints: QueryConstraint[] = [orderBy('createdAt', 'desc')]
    if (filters.customerId) constraints.push(where('customerId', '==', filters.customerId))
    if (filters.leadId)     constraints.push(where('leadId', '==', filters.leadId))
    if (filters.status)     constraints.push(where('status', '==', filters.status))
    return paginate<Quote>(quotesCol, constraints, options)
  })
}

export function subscribeToQuote(id: string, callback: (quote: Quote | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'quotes', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Quote) : null)
  })
}

export function subscribeToCustomerQuotes(
  customerId: string,
  callback: (quotes: Quote[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(quotesCol, where('customerId', '==', customerId), orderBy('createdAt', 'desc')),
    (snap) => {
      callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Quote))
    },
  )
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createQuote(data: CreateQuoteInput, taxRate = 0): Promise<string> {
  return serviceCall(async () => {
    if (!data.leadId && !data.customerId) {
      throw new OgsValidationError('Quote must be linked to a lead or a customer')
    }
    const totals = calculateQuoteTotals(data.lineItems, taxRate)
    const quoteNumber = `QT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
    const ref = await addDoc(quotesCol, {
      quoteNumber,
      ...data,
      ...totals,
      lineItems: data.lineItems,
      status: 'draft' as QuoteStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as unknown as Omit<Quote, 'id'>)
    return ref.id
  })
}

export async function updateQuote(
  id: string,
  data: Partial<Omit<Quote, 'id' | 'createdAt'>>,
): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'quotes', id), { ...data, updatedAt: serverTimestamp() }),
  )
}

export async function sendQuote(id: string): Promise<void> {
  return updateQuote(id, { status: 'sent' })
}

export async function acceptQuote(id: string): Promise<void> {
  return updateQuote(id, { status: 'accepted', acceptedAt: serverTimestamp() as never })
}

export async function declineQuote(id: string): Promise<void> {
  return updateQuote(id, { status: 'declined' })
}

export async function deleteQuote(id: string): Promise<void> {
  return serviceCall(() => deleteDoc(doc(db, 'quotes', id)))
}

// ── PDF generation ────────────────────────────────────────────────────────────

/** Triggers the Cloud Function that renders a quote PDF and returns a signed URL. */
export async function generateQuotePdf(quoteId: string): Promise<string> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<{ quoteId: string }, { url: string }>(
      functions,
      'generateQuotePdf',
    )
    const result = await fn({ quoteId })
    return result.data.url
  })
}

// ── Convert to order ──────────────────────────────────────────────────────────

/**
 * Converts an accepted quote's line items into an Order and marks the quote
 * with the resulting order ID.
 */
export async function convertQuoteToOrder(
  quoteId: string,
  customerId: string,
  unitPrice: number,
): Promise<string> {
  return serviceCall(async () => {
    const quote = await getQuote(quoteId)
    if (quote.status !== 'accepted') {
      throw new OgsValidationError('Only accepted quotes can be converted to orders')
    }
    if (quote.customerId && quote.customerId !== customerId) {
      throw new OgsValidationError('Quote customer does not match provided customerId')
    }

    const firstItem = quote.lineItems[0]
    if (!firstItem) throw new OgsValidationError('Quote has no line items')

    const { createOrder } = await import('./orderService')
    const orderId = await createOrder(
      {
        customerId,
        productId: firstItem.productId,
        quantity: firstItem.quantity,
        deliveryTier: 'standard',
        notes: quote.notes,
      },
      unitPrice,
    )

    await updateDoc(doc(db, 'quotes', quoteId), {
      convertedOrderId: orderId,
      updatedAt: serverTimestamp(),
    })

    return orderId
  })
}
