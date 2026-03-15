/**
 * src/utils/addressUtils.ts
 *
 * Shared helpers for customer address formatting, validation, and navigation.
 */

import type { Customer } from '../types/customer'

// ── Ohio ZIP code ranges ───────────────────────────────────────────────────────
// Ohio ZIPs run from 43001 to 45999.
const OH_ZIP_MIN = 43001
const OH_ZIP_MAX = 45999

/**
 * Returns a single-line address string suitable for geocoding or display.
 *
 * @example
 *   formatAddress(customer) → "123 Main St, Columbus, OH 43215"
 */
export function formatAddress(customer: Pick<Customer, 'address' | 'city' | 'state' | 'zip'>): string {
  const parts = [
    customer.address,
    customer.city,
    `${customer.state || 'OH'} ${customer.zip}`.trim(),
  ].filter(Boolean)
  return parts.join(', ')
}

/**
 * Returns true when the customer's ZIP code falls within the Ohio range
 * (43001–45999) or when their state field is explicitly "OH" or "Ohio".
 */
export function isOhioAddress(customer: Pick<Customer, 'state' | 'zip'>): boolean {
  const stateOk =
    customer.state?.toUpperCase() === 'OH' ||
    customer.state?.toLowerCase() === 'ohio'

  const numericZip = parseInt(customer.zip ?? '', 10)
  const zipOk =
    !isNaN(numericZip) &&
    numericZip >= OH_ZIP_MIN &&
    numericZip <= OH_ZIP_MAX

  return stateOk || zipOk
}

/**
 * Builds a Google Maps deep-link URL for navigation.
 * On mobile this opens the Maps app; on desktop it opens maps.google.com.
 *
 * Used by the driver "Navigate" button on the stop detail screen.
 *
 * @param lat  Latitude (decimal degrees)
 * @param lng  Longitude (decimal degrees)
 * @param label  Optional destination label shown in Maps (e.g. customer name)
 */
export function getGoogleMapsUrl(lat: number, lng: number, label?: string): string {
  const destination = label
    ? `${encodeURIComponent(label)}/@${lat},${lng}`
    : `${lat},${lng}`
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`
}

/**
 * Returns a human-readable geocode status label and CSS colour token for
 * use in customer record UI badges.
 */
export function geocodeStatusLabel(
  status: Customer['geocodeStatus'],
): { label: string; color: string } {
  switch (status) {
    case 'ok':      return { label: 'Geocoded',  color: 'var(--color-success)' }
    case 'pending': return { label: 'Geocoding…', color: 'var(--color-warning)' }
    case 'failed':  return { label: 'Geocode failed', color: 'var(--color-danger)' }
    default:        return { label: 'Not geocoded', color: 'var(--color-text-3)' }
  }
}

// ── Address field validation ───────────────────────────────────────────────────

export interface AddressValidationError {
  field: 'address' | 'city' | 'zip'
  message: string
}

/** Basic validation for customer address fields before create/update. */
export function validateAddress(fields: {
  address?: string
  city?: string
  zip?: string
}): AddressValidationError[] {
  const errors: AddressValidationError[] = []

  if (!fields.address?.trim()) {
    errors.push({ field: 'address', message: 'Street address is required.' })
  }
  if (!fields.city?.trim()) {
    errors.push({ field: 'city', message: 'City is required.' })
  }
  if (!fields.zip?.trim()) {
    errors.push({ field: 'zip', message: 'ZIP code is required.' })
  } else if (!/^\d{5}(-\d{4})?$/.test(fields.zip.trim())) {
    errors.push({ field: 'zip', message: 'ZIP code must be 5 digits (or ZIP+4).' })
  }

  return errors
}
