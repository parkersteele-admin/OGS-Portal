/**
 * src/utils/reportUtils.ts
 *
 * Pure computation utilities for billing summaries.
 * No side-effects — all functions accept typed data and return plain objects.
 */

import type { Invoice, Payment } from '../types/billing'

// ── Aging report ──────────────────────────────────────────────────────────────

export interface AgingBucket {
  /** Human-readable label for this aging tier. */
  label:   string
  /** Number of invoices in this bucket. */
  count:   number
  /** Sum of outstanding amounts in this bucket. */
  total:   number
}

/**
 * Classifies unpaid invoices into aging buckets based on days past due.
 *
 * Only invoices with status 'pending', 'sent', or 'overdue' are included.
 * Paid and voided invoices are excluded.
 *
 * Buckets:
 *   Current   — not yet past due
 *   1-30 Days — 1–30 days overdue
 *   31-60 Days — 31–60 days overdue
 *   61-90 Days — 61–90 days overdue
 *   90+ Days  — more than 90 days overdue
 */
export function generateAgingReport(invoices: Invoice[]): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: 'Current',    count: 0, total: 0 },
    { label: '1-30 Days',  count: 0, total: 0 },
    { label: '31-60 Days', count: 0, total: 0 },
    { label: '61-90 Days', count: 0, total: 0 },
    { label: '90+ Days',   count: 0, total: 0 },
  ]

  const todayMs = Date.now()
  const DAY_MS  = 86_400_000

  for (const invoice of invoices) {
    if (invoice.status === 'paid' || invoice.status === 'void') continue

    const dueDate = invoice.dueAt?.toDate?.()
    if (!dueDate) continue

    const daysOverdue = Math.floor((todayMs - dueDate.getTime()) / DAY_MS)
    const amount      = invoice.total ?? 0

    let idx: number
    if (daysOverdue <= 0)       idx = 0  // Current
    else if (daysOverdue <= 30) idx = 1  // 1-30
    else if (daysOverdue <= 60) idx = 2  // 31-60
    else if (daysOverdue <= 90) idx = 3  // 61-90
    else                        idx = 4  // 90+

    buckets[idx].count++
    buckets[idx].total += amount
  }

  // Round totals to 2 decimal places
  for (const b of buckets) {
    b.total = parseFloat(b.total.toFixed(2))
  }

  return buckets
}

// ── Revenue metrics ───────────────────────────────────────────────────────────

export interface RevenueMetrics {
  /** Sum of all invoice totals (all statuses). */
  totalRevenue:    number
  /** Sum of paid invoice totals. */
  collected:       number
  /** Sum of pending/sent/overdue invoice totals (unpaid). */
  outstanding:     number
  /** Average invoice total (across all statuses). */
  averageInvoice:  number
  /** Count of invoices included. */
  invoiceCount:    number
  /** Count of payments included. */
  paymentCount:    number
  /** Percentage of totalRevenue that has been collected (0–100). */
  collectionRate:  number
}

/**
 * Computes high-level revenue metrics from invoices and payments.
 *
 * Invoices drive `totalRevenue`, `collected`, and `outstanding`.
 * Payments provide an independent count (`paymentCount`).
 */
export function calculateRevenueMetrics(
  invoices: Invoice[],
  payments: Payment[],
): RevenueMetrics {
  let totalRevenue  = 0
  let collected     = 0
  let outstanding   = 0

  for (const inv of invoices) {
    const amount = inv.total ?? 0
    totalRevenue += amount

    if (inv.status === 'paid') {
      collected += amount
    } else if (inv.status !== 'void') {
      outstanding += amount
    }
  }

  const invoiceCount   = invoices.length
  const paymentCount   = payments.length
  const averageInvoice = invoiceCount > 0
    ? parseFloat((totalRevenue / invoiceCount).toFixed(2))
    : 0

  const collectionRate = totalRevenue > 0
    ? parseFloat(((collected / totalRevenue) * 100).toFixed(1))
    : 0

  return {
    totalRevenue:   parseFloat(totalRevenue.toFixed(2)),
    collected:      parseFloat(collected.toFixed(2)),
    outstanding:    parseFloat(outstanding.toFixed(2)),
    averageInvoice,
    invoiceCount,
    paymentCount,
    collectionRate,
  }
}
