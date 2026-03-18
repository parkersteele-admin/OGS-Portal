/**
 * functions/src/triggers/geocodeCustomer.ts
 *
 * Firestore trigger: onCreate + onUpdate of customers/{customerId}
 *
 * Calls the Google Maps Geocoding API (server-side key) whenever the
 * customer's address fields change.  Writes lat, lng, formattedAddress,
 * placeId, geocodedAt, and geocodeStatus back to the customer document.
 *
 * Design:
 *  - onCreate:  always geocode
 *  - onUpdate:  only geocode when one of address/city/state/zip changed
 *  - Sets geocodeStatus:'pending' right away so the UI can show a spinner
 *  - On success: geocodeStatus:'ok'
 *  - On failure: geocodeStatus:'failed', logs the error — never throws
 *    (a thrown trigger causes infinite retries)
 *  - Server-side key kept in Firebase Secret Manager (GOOGLE_MAPS_SERVER_KEY)
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { db, FieldValue } from '../admin'
import { GOOGLE_MAPS_KEY, requireSecret } from '../config'

const ADDRESS_FIELDS = ['address', 'city', 'state', 'zip'] as const
type AddressField = typeof ADDRESS_FIELDS[number]

interface GeocodingResult {
  lat:              number
  lng:              number
  formattedAddress: string
  placeId:          string
}

async function callGeocodeApi(
  addressString: string,
  apiKey: string,
): Promise<GeocodingResult> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json` +
    `?address=${encodeURIComponent(addressString)}&key=${apiKey}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Geocoding API HTTP error ${res.status}`)
  }

  const json = (await res.json()) as {
    status: string
    results: Array<{
      formatted_address: string
      place_id: string
      geometry: { location: { lat: number; lng: number } }
    }>
  }

  if (json.status !== 'OK' || json.results.length === 0) {
    throw new Error(`Geocoding API status: ${json.status}`)
  }

  const result = json.results[0]
  return {
    lat:              result.geometry.location.lat,
    lng:              result.geometry.location.lng,
    formattedAddress: result.formatted_address,
    placeId:          result.place_id,
  }
}

function buildAddressString(data: Record<string, unknown>): string {
  // Always append ', OH' as the default state for Ohio Gas Supply deliveries.
  const street = (data['address'] as string | undefined) ?? ''
  const city   = (data['city']    as string | undefined) ?? ''
  const state  = (data['state']   as string | undefined) || 'OH'
  const zip    = (data['zip']     as string | undefined) ?? ''
  return [street, city, `${state} ${zip}`.trim()].filter(Boolean).join(', ')
}

export async function performGeocode(
  customerId: string,
  customerData: Record<string, unknown>,
): Promise<void> {
  const customerRef = db.collection('customers').doc(customerId)

  // Mark as pending immediately
  await customerRef.update({
    geocodeStatus: 'pending',
    updatedAt:     FieldValue.serverTimestamp(),
  })

  let mapsKey: string
  try {
    mapsKey = requireSecret(GOOGLE_MAPS_KEY.value(), 'GOOGLE_MAPS_SERVER_KEY')
  } catch (err) {
    console.error(`geocodeCustomer [${customerId}]: secret unavailable —`, err)
    await customerRef.update({ geocodeStatus: 'failed', updatedAt: FieldValue.serverTimestamp() })
    return
  }

  const addressString = buildAddressString(customerData)
  if (!addressString.trim()) {
    console.warn(`geocodeCustomer [${customerId}]: empty address — skipping`)
    await customerRef.update({ geocodeStatus: 'failed', updatedAt: FieldValue.serverTimestamp() })
    return
  }

  try {
    const result = await callGeocodeApi(addressString, mapsKey)
    await customerRef.update({
      lat:              result.lat,
      lng:              result.lng,
      formattedAddress: result.formattedAddress,
      placeId:          result.placeId,
      geocodeStatus:    'ok',
      geocodedAt:       new Date().toISOString(),
      updatedAt:        FieldValue.serverTimestamp(),
    })
    console.log(
      `geocodeCustomer [${customerId}]: geocoded "${addressString}" → ` +
      `${result.lat.toFixed(6)}, ${result.lng.toFixed(6)}`,
    )
  } catch (err) {
    console.error(`geocodeCustomer [${customerId}]: geocoding failed —`, err)
    await customerRef.update({
      geocodeStatus: 'failed',
      updatedAt:     FieldValue.serverTimestamp(),
    })
  }
}

// ── onCreate ──────────────────────────────────────────────────────────────────

export const geocodeCustomerOnCreate = onDocumentCreated(
  {
    document: 'customers/{customerId}',
    secrets:  [GOOGLE_MAPS_KEY],
  },
  async (event) => {
    const snap = event.data
    if (!snap) return

    const data = snap.data() as Record<string, unknown>
    await performGeocode(event.params.customerId, data)
  },
)

// ── onUpdate ──────────────────────────────────────────────────────────────────

export const geocodeCustomerOnUpdate = onDocumentUpdated(
  {
    document: 'customers/{customerId}',
    secrets:  [GOOGLE_MAPS_KEY],
  },
  async (event) => {
    const snap = event.data
    if (!snap) return

    const before = snap.before.data() as Record<string, unknown>
    const after  = snap.after.data()  as Record<string, unknown>

    // Only geocode when an address field actually changed
    const addressChanged = ADDRESS_FIELDS.some(
      (f: AddressField) => before[f] !== after[f],
    )
    if (!addressChanged) return

    // Prevent infinite loop: if the update was written by this trigger itself
    // (geocodeStatus changed but no address field changed), bail out.
    // Already guarded above — addressChanged ensures we don't loop.
    await performGeocode(event.params.customerId, after)
  },
)
