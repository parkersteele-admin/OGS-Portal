/**
 * src/utils/companyName.ts
 *
 * Shared utilities for company name normalization and email domain extraction.
 * Keep in sync with functions/src/utils/companyName.ts.
 */

const GENERIC_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'mail.com',
  'live.com',
  'msn.com',
]

const STRIP_SUFFIXES = [
  'llc',
  'inc',
  'corp',
  'co',
  'ltd',
  'restaurant',
  'bar',
  'brewing',
  'brewery',
  'grill',
  'company',
  'group',
  'services',
]

/**
 * Normalizes a company name for fuzzy deduplication matching.
 * Lowercases, strips punctuation, removes common business suffixes.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(' ')
    .filter((w) => w.length > 0 && !STRIP_SUFFIXES.includes(w))
    .join(' ')
    .trim()
}

/**
 * Extracts the domain from an email address.
 * Returns null for generic consumer email providers.
 */
export function extractDomain(email: string): string | null {
  const parts = email.split('@')
  if (parts.length !== 2) return null
  const domain = parts[1].toLowerCase()
  return GENERIC_DOMAINS.includes(domain) ? null : domain
}
