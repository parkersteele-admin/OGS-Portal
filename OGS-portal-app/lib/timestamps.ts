/**
 * lib/timestamps.ts
 *
 * Firestore timestamp standardization.
 * Eliminates timestamp bugs caused by mixing Timestamp, Date, and string formats.
 *
 * PROBLEM:
 * ────────
 * Current types allow mixed formats:
 *   export interface Order {
 *     requestedAt: Timestamp | string | Date  // ❌ THREE DIFFERENT TYPES!
 *     deliveredAt?: Timestamp | Date
 *   }
 *
 * This causes bugs:
 *   1. Comparisons fail (comparing Timestamp with string)
 *   2. Serialization issues (Date doesn't serialize correctly to JSON)
 *   3. Type casting required in components (not type-safe)
 *   4. Different formats depending on where data comes from
 *
 * SOLUTION:
 * ─────────
 * Enforce ONLY Firestore Timestamp type everywhere.
 * Always use createTimestamp() for writes (server-side timestamp).
 * Never use new Date() or Date.now() on the client.
 */

import { serverTimestamp, Timestamp } from 'firebase/firestore'

/**
 * Firestore server-generated timestamp.
 * This is the ONLY timestamp type allowed in the codebase.
 */
export type FirestoreTimestamp = Timestamp

/**
 * Create a server-side timestamp for writes.
 * Always use this function instead of new Date() or Date.now().
 *
 * @returns Firestore FieldValue for serverTimestamp()
 *
 * @example
 *   await updateDoc(docRef, {
 *     updatedAt: createTimestamp(),
 *   })
 *
 * WHY SERVER-SIDE?
 * ────────────────
 * Client clocks can be wrong. Using serverTimestamp() ensures:
 *   - All timestamps are in UTC
 *   - Ordering is consistent
 *   - No clock skew issues
 */
export const createTimestamp = () => serverTimestamp()

/**
 * Convert Firestore Timestamp to JavaScript Date.
 *
 * @param ts - Firestore Timestamp
 * @returns JavaScript Date object
 *
 * @example
 *   const date = toDate(order.requestedAt)
 *   console.log(date.toLocaleDateString())
 */
export function toDate(ts: FirestoreTimestamp | undefined): Date | null {
  if (!ts) return null
  if (ts instanceof Timestamp) return ts.toDate()
  return null
}

/**
 * Format Firestore timestamp for display.
 *
 * @param ts - Firestore Timestamp
 * @param locale - Locale string (default: 'en-US')
 * @returns Formatted date string
 *
 * @example
 *   formatTimestamp(order.requestedAt)
 *   // → "Jan 15, 2025"
 *
 *   formatTimestamp(order.requestedAt, 'fr-FR')
 *   // → "15 janv. 2025"
 */
export function formatTimestamp(
  ts: FirestoreTimestamp | undefined,
  locale: string = 'en-US',
): string {
  if (!ts) return '—'
  const date = toDate(ts)
  if (!date) return '—'
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format as ISO date string (YYYY-MM-DD).
 *
 * @example
 *   formatTimestampISO(order.requestedAt)
 *   // → "2025-01-15"
 */
export function formatTimestampISO(ts: FirestoreTimestamp | undefined): string {
  if (!ts) return ''
  const date = toDate(ts)
  if (!date) return ''
  return date.toISOString().split('T')[0]
}

/**
 * Format with time (Jan 15, 2025 at 2:30 PM).
 *
 * @example
 *   formatTimestampWithTime(order.requestedAt)
 *   // → "Jan 15, 2025 at 2:30 PM"
 */
export function formatTimestampWithTime(
  ts: FirestoreTimestamp | undefined,
  locale: string = 'en-US',
): string {
  if (!ts) return '—'
  const date = toDate(ts)
  if (!date) return '—'

  const dateStr = date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  const timeStr = date.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  return `${dateStr} at ${timeStr}`
}

/**
 * Check if a timestamp is in the past.
 *
 * @example
 *   if (isPastTimestamp(invoice.dueDate)) {
 *     // Invoice is overdue
 *   }
 */
export function isPastTimestamp(ts: FirestoreTimestamp | undefined): boolean {
  if (!ts) return false
  const date = toDate(ts)
  if (!date) return false
  return date.getTime() < Date.now()
}

/**
 * Check if a timestamp is in the future.
 *
 * @example
 *   if (isFutureTimestamp(tank.inspectionDueAt)) {
 *     // Tank inspection not yet due
 *   }
 */
export function isFutureTimestamp(ts: FirestoreTimestamp | undefined): boolean {
  if (!ts) return false
  return !isPastTimestamp(ts)
}

/**
 * Check if timestamps are on the same day.
 *
 * @example
 *   if (isSameDay(run.createdAt, run.completedAt)) {
 *     // Run completed same day
 *   }
 */
export function isSameDay(
  ts1: FirestoreTimestamp | undefined,
  ts2: FirestoreTimestamp | undefined,
): boolean {
  if (!ts1 || !ts2) return false
  const date1 = toDate(ts1)
  const date2 = toDate(ts2)
  if (!date1 || !date2) return false

  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

/**
 * MIGRATION GUIDE
 *
 * 1. Update ALL types to use FirestoreTimestamp only:
 *
 *    BEFORE:
 *    export interface Order {
 *      requestedAt: Timestamp | string | Date
 *      deliveredAt?: Timestamp | Date
 *    }
 *
 *    AFTER:
 *    export interface Order {
 *      requestedAt: FirestoreTimestamp
 *      deliveredAt?: FirestoreTimestamp
 *    }
 *
 * 2. Update ALL write services to use createTimestamp():
 *
 *    BEFORE:
 *    await updateDoc(ref, { deliveredAt: new Date() })
 *
 *    AFTER:
 *    await updateDoc(ref, { deliveredAt: createTimestamp() })
 *
 * 3. Update components to use formatting functions:
 *
 *    BEFORE:
 *    <span>{order.requestedAt.toDate().toLocaleDateString()}</span>
 *
 *    AFTER:
 *    <span>{formatTimestamp(order.requestedAt)}</span>
 *
 * 4. Use comparison functions for business logic:
 *
 *    BEFORE:
 *    if (invoice.dueDate.toDate() < new Date()) { /* overdue */ }
 *
 *    AFTER:
 *    if (isPastTimestamp(invoice.dueDate)) { /* overdue */ }
 *
 * AFFECTED FILES:
 * ────────────────
 * • src/types/order.ts
 * • src/types/billing.ts
 * • src/types/tank.ts
 * • src/types/run.ts
 * • src/services/orderService.ts
 * • src/services/invoiceService.ts
 * • src/services/tankService.ts
 * • src/services/runService.ts
 * • All components using timestamps (50+ files)
 */
