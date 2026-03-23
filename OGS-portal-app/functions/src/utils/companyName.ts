/**
 * functions/src/utils/companyName.ts
 *
 * Company name normalization utilities for duplicate detection.
 * Mirror of src/utils/companyName.ts — kept in sync manually.
 */

/** Free/personal email providers — excluded from domain matching. */
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'aol.com', 'protonmail.com', 'me.com', 'msn.com', 'live.com',
  'ymail.com', 'mail.com', 'zoho.com', 'fastmail.com',
])

/** Common business-type words stripped before comparison. */
const STRIP_SUFFIXES = new Set([
  'llc', 'inc', 'corp', 'co', 'company', 'ltd', 'limited', 'lp', 'llp',
  'pllc', 'plc', 'group', 'holdings', 'enterprises', 'services', 'solutions',
  'industries', 'international', 'associates', 'partners', 'brewing', 'brewery',
  'restaurant', 'cafe', 'bar', 'grill', 'kitchen', 'bakery', 'shop',
  'store', 'market', 'studio', 'labs', 'lab', 'works', 'media', 'agency',
])

/**
 * Normalizes a company name for duplicate-detection comparison.
 * Strips punctuation, common suffixes, and collapses whitespace.
 *
 * @example
 *   normalizeCompanyName("Acme, Inc.") // "acme"
 *   normalizeCompanyName("The Brew Lab LLC") // "brew"
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')          // strip punctuation
    .replace(/\bthe\b/g, '')               // strip leading "The"
    .split(/\s+/)
    .filter(w => w.length > 0 && !STRIP_SUFFIXES.has(w))
    .join(' ')
    .trim()
}

/**
 * Extracts the domain from an email address.
 * Returns null for generic/free providers.
 *
 * @example
 *   extractDomain("jane@acmecorp.com") // "acmecorp.com"
 *   extractDomain("jane@gmail.com")    // null
 */
export function extractDomain(email: string): string | null {
  const parts = email.toLowerCase().trim().split('@')
  if (parts.length !== 2) return null
  const domain = parts[1]
  return GENERIC_DOMAINS.has(domain) ? null : domain
}
