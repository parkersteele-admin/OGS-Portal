/**
 * src/utils/exportUtils.ts
 *
 * Browser-side CSV export utilities for the OGS Portal billing module.
 *
 * Both functions trigger an immediate browser download using
 * Blob + URL.createObjectURL — no server round-trip required.
 */

import type { Invoice, Payment } from '../types/billing'
import type { Customer } from '../types/customer'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap a value in double-quotes and escape internal quotes. */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""'
  const str = String(value)
  // If the value contains commas, quotes, or newlines it must be quoted
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return `"${str}"`
}

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
}

function tsToDateStr(ts: { toDate(): Date } | Date | null | undefined): string {
  if (!ts) return ''
  const d = 'toDate' in (ts as object) ? (ts as { toDate(): Date }).toDate() : (ts as Date)
  return d.toISOString().slice(0, 10)
}

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href     = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Release after a short delay to let the browser initiate the download
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Derive Net-XX payment terms from issued/due dates. Falls back to 'Net 30'. */
function termsLabel(invoice: Invoice): string {
  if (!invoice.issuedAt || !invoice.dueAt) return 'Net 30'
  const issuedMs = invoice.issuedAt.toDate().getTime()
  const dueMs    = invoice.dueAt.toDate().getTime()
  const days = Math.round((dueMs - issuedMs) / 86_400_000)
  if (days <= 0)  return 'Due on Receipt'
  if (days <= 10) return 'Net 10'
  if (days <= 15) return 'Net 15'
  if (days <= 30) return 'Net 30'
  if (days <= 45) return 'Net 45'
  if (days <= 60) return 'Net 60'
  return `Net ${days}`
}

// ── Invoice export ────────────────────────────────────────────────────────────

/**
 * Generates a QuickBooks IIF-compatible CSV and triggers a browser download.
 *
 * One row is emitted per line-item so each row maps cleanly to a QuickBooks
 * "item line" in the IIF import format.
 *
 * Columns:
 *   Customer | Invoice# | Date | Due Date | Item | Description |
 *   Quantity | Rate | Amount | Memo | Terms | Status
 *
 * @param invoices  Invoice records to export.
 * @param customers Customer records used for name lookup (id → name).
 */
export function exportInvoicesToCsv(invoices: Invoice[], customers: Customer[]): void {
  const customerMap = new Map(customers.map((c) => [c.id, c.name]))

  const header = csvRow([
    'Customer',
    'Invoice#',
    'Date',
    'Due Date',
    'Item',
    'Description',
    'Quantity',
    'Rate',
    'Amount',
    'Memo',
    'Terms',
    'Status',
  ])

  const rows: string[] = [header]

  for (const invoice of invoices) {
    const customerName = customerMap.get(invoice.customerId) ?? invoice.customerId
    const dateStr      = tsToDateStr(invoice.issuedAt)
    const dueDateStr   = tsToDateStr(invoice.dueAt)
    const terms        = termsLabel(invoice)

    if (invoice.lineItems.length === 0) {
      // Emit a single row even for invoices with no line items
      rows.push(csvRow([
        customerName,
        invoice.invoiceNumber,
        dateStr,
        dueDateStr,
        '',
        '',
        '',
        '',
        invoice.total,
        '',
        terms,
        invoice.status,
      ]))
      continue
    }

    for (const item of invoice.lineItems) {
      rows.push(csvRow([
        customerName,
        invoice.invoiceNumber,
        dateStr,
        dueDateStr,
        item.description,           // "Item" — maps to QuickBook's item/product field
        item.description,           // "Description" — verbose memo
        item.quantity,
        item.unitPrice,
        item.amount,
        '',                         // Memo — reserved for admin notes
        terms,
        invoice.status,
      ]))
    }

    // Totals row (tax + total — kept separate for QuickBooks import fidelity)
    if (invoice.tax > 0) {
      rows.push(csvRow([
        customerName,
        invoice.invoiceNumber,
        dateStr,
        dueDateStr,
        'Sales Tax',
        `Sales Tax (${((invoice.tax / invoice.subtotal) * 100).toFixed(0)}%)`,
        1,
        invoice.tax,
        invoice.tax,
        '',
        terms,
        invoice.status,
      ]))
    }
  }

  triggerDownload(rows.join('\r\n'), `ogs-portal-invoices-${todayString()}.csv`)
}

// ── Payment export ────────────────────────────────────────────────────────────

/**
 * Generates a payments CSV and triggers a browser download.
 *
 * Columns:
 *   Date | Customer | Invoice# | Amount | Method | Reference (Stripe ID)
 *
 * @param payments  Payment records to export.
 * @param customers Optional customer records for name lookup.
 * @param invoices  Optional invoice records for invoice number lookup.
 */
export function exportPaymentsToCsv(
  payments:  Payment[],
  customers?: Customer[],
  invoices?:  Invoice[],
): void {
  const customerMap = new Map((customers ?? []).map((c) => [c.id, c.name]))
  const invoiceMap  = new Map((invoices  ?? []).map((i) => [i.id, i.invoiceNumber]))

  const header = csvRow([
    'Date',
    'Customer',
    'Invoice#',
    'Amount',
    'Method',
    'Status',
    'Reference (Stripe ID)',
  ])

  const rows: string[] = [header]

  for (const payment of payments) {
    const dateStr      = tsToDateStr(payment.processedAt ?? payment.createdAt)
    const customerName = customerMap.get(payment.customerId) ?? payment.customerId
    const invoiceNum   = invoiceMap.get(payment.invoiceId)   ?? payment.invoiceId

    rows.push(csvRow([
      dateStr,
      customerName,
      invoiceNum,
      payment.amount,
      payment.method,
      payment.status,
      payment.stripePaymentIntentId ?? '',
    ]))
  }

  triggerDownload(rows.join('\r\n'), `ogs-portal-payments-${todayString()}.csv`)
}
