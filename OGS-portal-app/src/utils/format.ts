/**
 * src/utils/format.ts
 *
 * Shared formatting helpers used across the OGS Portal.
 */

/** Format a dollar amount. Accepts dollars (not cents). */
export function formatCurrency(
  amount: number,
  currency = 'USD',
  locale = 'en-US',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** Format a date value to a short human-readable string (e.g. "Mar 15, 2026"). */
export function formatDate(
  value: Date | { toDate(): Date } | number | string,
  locale = 'en-US',
): string {
  const date =
    typeof value === 'object' && 'toDate' in value
      ? value.toDate()
      : new Date(value as never)
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

/** Format a Firestore Timestamp or Date as a relative string ("2 days ago"). */
export function formatRelative(
  value: Date | { toDate(): Date } | number,
): string {
  const date =
    typeof value === 'object' && 'toDate' in value
      ? value.toDate()
      : new Date(value as never)
  const diffMs  = Date.now() - date.getTime()
  const diffSec = Math.round(diffMs / 1000)
  const diffMin = Math.round(diffSec / 60)
  const diffHr  = Math.round(diffMin / 60)
  const diffDay = Math.round(diffHr / 24)

  if (diffSec < 60)  return 'just now'
  if (diffMin < 60)  return `${diffMin}m ago`
  if (diffHr < 24)   return `${diffHr}h ago`
  if (diffDay < 7)   return `${diffDay}d ago`
  return formatDate(date)
}

/** Capitalise the first letter of a string. */
export function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
