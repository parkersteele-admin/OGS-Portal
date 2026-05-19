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
  Timestamp,
  serverTimestamp,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { invoicesCol } from '../lib/firestore'
import type { Invoice, InvoiceStatus, InvoiceLineItem } from '../types/billing'
import { serviceCall, fromSnap, paginate, type Page, type PageOptions, sanitizeForFirestore } from './base'

export interface InvoiceFilters {
  customerId?: string
  status?: InvoiceStatus
  dueBefore?: Date
}

export interface CreateInvoiceInput {
  customerId: string
  orderId?: string
  quoteId?: string
  quoteNumber?: string
  leadId?: string
  lineItems: InvoiceLineItem[]
  issuedAt?: Date
  dueAt: Date
  serviceDate?: Date
  notes?: string
  terms?: string
  paymentTermsDays?: number
  applySalesTax?: boolean
  salesTaxRate?: number
  salesTaxAmount?: number
  taxRate?: number
  customerContactName?: string
  customerContactEmail?: string
  salesRepId?: string
  salesRepName?: string
  salesRepEmail?: string
  salesRepPhone?: string
}

export interface EditDraftInvoiceInput {
  customerId: string
  lineItems: InvoiceLineItem[]
  issuedAt?: Date
  dueAt: Date
  serviceDate?: Date
  notes?: string
  terms?: string
  paymentTermsDays?: number
  applySalesTax?: boolean
  salesTaxRate?: number
  salesTaxAmount?: number
  taxRate?: number
  customerContactName?: string
  customerContactEmail?: string
  salesRepId?: string
  salesRepName?: string
  salesRepEmail?: string
  salesRepPhone?: string
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export function calculateInvoiceTotals(
  lineItems: InvoiceLineItem[],
  taxRate = 0,
  applySalesTax = true,
): { subtotal: number; tax: number; total: number } {
  const subtotal = parseFloat(
    lineItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
  )
  const tax = applySalesTax ? parseFloat((subtotal * taxRate).toFixed(2)) : 0
  const total = parseFloat((subtotal + tax).toFixed(2))
  return { subtotal, tax, total }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getInvoice(id: string): Promise<Invoice> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'invoices', id))
    return fromSnap<Invoice>(snap, 'invoices')
  })
}

export async function getInvoices(
  filters: InvoiceFilters = {},
  options: PageOptions = {},
): Promise<Page<Invoice>> {
  return serviceCall(async () => {
    const constraints: QueryConstraint[] = [orderBy('issuedAt', 'desc')]
    if (filters.customerId) constraints.push(where('customerId', '==', filters.customerId))
    if (filters.status)     constraints.push(where('status',     '==', filters.status))
    if (filters.dueBefore)  constraints.push(where('dueAt',      '<=', filters.dueBefore))
    return paginate<Invoice>(invoicesCol, constraints, options)
  })
}

export function subscribeToInvoice(
  id: string,
  callback: (invoice: Invoice | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'invoices', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Invoice) : null)
  })
}

export function subscribeToCustomerInvoices(
  customerId: string,
  callback: (invoices: Invoice[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(invoicesCol, where('customerId', '==', customerId), orderBy('issuedAt',  'desc')),
    (snap) => {
      callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Invoice))
    },
  )
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createInvoice(data: CreateInvoiceInput, taxRate = 0): Promise<string> {
  return serviceCall(async () => {
    const applySalesTax = data.applySalesTax ?? true
    const appliedTaxRate = applySalesTax
      ? (data.salesTaxRate ?? data.taxRate ?? taxRate)
      : 0
    const totals = calculateInvoiceTotals(data.lineItems, appliedTaxRate, applySalesTax)
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`
    const issuedAt = Timestamp.fromDate(data.issuedAt ?? new Date())
    const clean = Object.fromEntries(
      Object.entries({
        ...data,
        issuedAt,
        dueAt: Timestamp.fromDate(data.dueAt),
        serviceDate: data.serviceDate ? Timestamp.fromDate(data.serviceDate) : undefined,
      }).filter(([, v]) => v !== undefined),
    )
    const ref = await addDoc(invoicesCol, sanitizeForFirestore({
      invoiceNumber,
      ...clean,
      ...totals,
      applySalesTax,
      salesTaxRate: appliedTaxRate,
      salesTaxAmount: totals.tax,
      taxRate: appliedTaxRate,
      status: 'draft' as InvoiceStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as unknown as Omit<Invoice, 'id'>))
    return ref.id
  })
}

export async function updateInvoice(
  id: string,
  data: Partial<Omit<Invoice, 'id' | 'createdAt'>>,
): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'invoices', id), sanitizeForFirestore({ ...data, updatedAt: serverTimestamp() })),
  )
}

/**
 * Updates a draft invoice in-place while preserving immutable identity fields.
 */
export async function saveDraftInvoiceEdits(
  id: string,
  data: EditDraftInvoiceInput,
): Promise<void> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'invoices', id))
    const current = fromSnap<Invoice>(snap, 'invoices')
    if (current.status !== 'draft') {
      throw new Error('Only draft invoices can be edited.')
    }

    const applySalesTax = data.applySalesTax ?? true
    const appliedTaxRate = applySalesTax
      ? (data.salesTaxRate ?? data.taxRate ?? 0)
      : 0
    const totals = calculateInvoiceTotals(data.lineItems, appliedTaxRate, applySalesTax)
    const clean = Object.fromEntries(
      Object.entries({
        customerId: data.customerId,
        lineItems: data.lineItems,
        issuedAt: data.issuedAt
          ? Timestamp.fromDate(data.issuedAt)
          : (current.issuedAt ?? Timestamp.fromDate(new Date())),
        dueAt: Timestamp.fromDate(data.dueAt),
        serviceDate: data.serviceDate ? Timestamp.fromDate(data.serviceDate) : null,
        notes: data.notes,
        terms: data.terms,
        paymentTermsDays: data.paymentTermsDays,
        applySalesTax,
        salesTaxRate: appliedTaxRate,
        salesTaxAmount: totals.tax,
        taxRate: appliedTaxRate,
        customerContactName: data.customerContactName,
        customerContactEmail: data.customerContactEmail,
        salesRepId: data.salesRepId,
        salesRepName: data.salesRepName,
        salesRepEmail: data.salesRepEmail,
        salesRepPhone: data.salesRepPhone,
      }).filter(([, v]) => v !== undefined),
    )

    await updateDoc(doc(db, 'invoices', id), sanitizeForFirestore({
      ...clean,
      ...totals,
      updatedAt: serverTimestamp(),
    }))
  })
}

export async function markInvoiceSent(id: string): Promise<void> {
  return updateInvoice(id, { status: 'sent' })
}

export async function markInvoicePaid(id: string): Promise<void> {
  return updateInvoice(id, { status: 'paid', paidAt: serverTimestamp() as never })
}

export async function voidInvoice(id: string): Promise<void> {
  return updateInvoice(id, { status: 'void' })
}

export async function deleteInvoice(id: string): Promise<void> {
  return serviceCall(() => deleteDoc(doc(db, 'invoices', id)))
}

// ── PDF generation ────────────────────────────────────────────────────────────

/** Triggers the Cloud Function that renders a PDF and returns a signed download URL. */
export async function generateInvoicePdf(invoiceId: string): Promise<string> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<{ invoiceId: string }, { url: string }>(
      functions,
      'generateInvoicePdf',
    )
    const result = await fn({ invoiceId })
    return result.data.url
  })
}

/** Admin-only manual invoice generation for an order. */
export async function generateInvoiceForOrder(orderId: string): Promise<{ invoiceId: string; invoiceNumber: string | null; invoicePdfUrl: string; created: boolean }> {
  return serviceCall(async () => {
    const { httpsCallable } = await import('firebase/functions')
    const { functions } = await import('../lib/firebase')
    const fn = httpsCallable<
      { orderId: string },
      { invoiceId: string; invoiceNumber: string | null; invoicePdfUrl: string; created: boolean }
    >(functions, 'generateInvoiceForOrder')
    const result = await fn({ orderId })
    return result.data
  })
}
