import {
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteField,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { getLimitConstraint } from './queryOptimizer'
import { db } from '../lib/firebase'
import { customersCol } from '../lib/firestore'
import type {
  Customer,
  CustomerStatus,
  CompanyContact,
  CompanyLocation,
  CompanyType,
} from '../types/customer'
import { formatAddress } from '../utils/addressUtils'
import { serviceCall, fromSnap, paginate, type Page, type PageOptions, sanitizeForFirestore } from './base'

export interface CustomerFilters {
  status?: CustomerStatus
  state?: string
  search?: string
}

export interface CreateCustomerInput {
  name: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zip: string
  creditLimit?: number
  notes?: string
  leadId?: string
  companyName?: string
  companyType?: CompanyType
  mainPhone?: string
  industry?: string
  taxStatus?: 'taxable' | 'tax_exempt' | 'unknown'
  paymentTerms?: string
  agreementStatus?: 'none' | 'draft' | 'signed' | 'expired'
  contacts?: CompanyContact[]
  locations?: CompanyLocation[]
  defaultLocationId?: string
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getCustomer(id: string): Promise<Customer> {
  return serviceCall(async () => {
    const snap = await getDoc(doc(db, 'customers', id))
    return fromSnap<Customer>(snap, 'customers')
  })
}

export async function getCustomers(
  filters: CustomerFilters = {},
  options: PageOptions = {},
): Promise<Page<Customer>> {
  return serviceCall(async () => {
    const constraints: QueryConstraint[] = [orderBy('name')]
    if (filters.status) constraints.push(where('status', '==', filters.status))
    if (filters.state) constraints.push(where('state', '==', filters.state))
    return paginate<Customer>(customersCol, constraints, options)
  })
}

export function subscribeToCustomer(
  id: string,
  callback: (customer: Customer | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'customers', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null)
  })
}

export function subscribeToCustomers(
  filters: CustomerFilters = {},
  callback: (customers: Customer[]) => void,
): Unsubscribe {
  const constraints: QueryConstraint[] = [orderBy('name')]
  if (filters.status) constraints.push(where('status', '==', filters.status))
  return onSnapshot(query(customersCol, ...constraints), (snap) => {
    callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Customer))
  })
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createCustomer(data: CreateCustomerInput): Promise<string> {
  return serviceCall(async () => {
    // Geocode address in the background — coordinates are optional on Customer.
    const coords = await geocodeAddress(data).catch(() => null)

    const cleanData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
    const normalizedName = data.companyName?.trim() || data.name.trim()
    const ref = await addDoc(customersCol, sanitizeForFirestore({
      ...cleanData,
      name: normalizedName,
      companyName: normalizedName,
      companyType: data.companyType ?? 'customer',
      mainPhone: data.mainPhone ?? data.phone,
      contacts: data.contacts ?? [],
      locations: data.locations ?? [],
      status: 'active' as CustomerStatus,
      creditLimit: data.creditLimit ?? 5000,
      // geocodeCustomer Cloud Function handles geocoding server-side.
      // Mark pending here so the UI can show a spinner immediately.
      geocodeStatus: 'pending',
      ...(coords ?? {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as Omit<Customer, 'id'>))
    return ref.id
  })
}

export async function updateCustomer(
  id: string,
  data: Partial<Omit<Customer, 'id' | 'createdAt'>>,
): Promise<void> {
  return serviceCall(async () => {
    // Re-geocode if address fields changed
    const addressFields = ['address', 'city', 'state', 'zip'] as const
    const needsGeocode = addressFields.some((f) => f in data)
    let coords: { lat?: number; lng?: number } | null = null
    if (needsGeocode) {
      const existing = await getCustomer(id)
      coords = await geocodeAddress({ ...existing, ...data }).catch(() => null)
    }
    await updateDoc(doc(db, 'customers', id), sanitizeForFirestore({
      ...data,
      ...(coords ?? {}),
      updatedAt: serverTimestamp(),
    }))
  })
}

/** Soft-archive a customer. The record is retained but hidden from normal lists. */
export async function archiveCustomer(id: string): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'customers', id), sanitizeForFirestore({
      status: 'archived' as CustomerStatus,
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })),
  )
}

/**
 * Soft-delete a customer. The document is retained with status='deleted' and
 * will be permanently purged by the purgeDeletedCustomers scheduled function
 * after 30 days.
 */
export async function deleteCustomer(id: string): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'customers', id), sanitizeForFirestore({
      status: 'deleted' as CustomerStatus,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })),
  )
}

/** Restore an archived or soft-deleted customer back to active. */
export async function restoreCustomer(id: string): Promise<void> {
  return serviceCall(() =>
    updateDoc(doc(db, 'customers', id), sanitizeForFirestore({
      status: 'active' as CustomerStatus,
      archivedAt: deleteField(),
      deletedAt: deleteField(),
      updatedAt: serverTimestamp(),
    })),
  )
}

// ── Geocode helper ────────────────────────────────────────────────────────────
// Client-side geocoding is a best-effort fallback used only when the server-
// side geocodeCustomer trigger has not yet run (e.g. during development with
// emulators disabled).
// The definitive geocoding path is the Cloud Function (server-side key).

interface GeocodableAddress {
  address?: string
  city?: string
  state?: string
  zip?: string
}

async function geocodeAddress(addr: GeocodableAddress): Promise<{ lat: number; lng: number }> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  if (!apiKey) throw new Error('VITE_GOOGLE_MAPS_API_KEY not set')

  const addressString = formatAddress({
    address: addr.address ?? '',
    city:    addr.city    ?? '',
    state:   addr.state   ?? 'OH',
    zip:     addr.zip     ?? '',
  })

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressString)}&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Geocode request failed: ${res.status}`)
  const json = (await res.json()) as {
    status: string
    results: Array<{ geometry: { location: { lat: number; lng: number } } }>
  }
  if (json.status !== 'OK' || json.results.length === 0) {
    throw new Error(`Geocode returned status: ${json.status}`)
  }
  return json.results[0].geometry.location
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Search customers by name prefix (client-side filter — replace with Algolia/Typesense for scale). */
export async function searchCustomers(term: string): Promise<Customer[]> {
  return serviceCall(async () => {
    const snap = await getDocs(
      query(
        customersCol,
        orderBy('name'),
        where('status', '==', 'active'),
        getLimitConstraint('customers'),
      ),
    )
    const lower = term.toLowerCase()
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }) as Customer)
      .filter(
        (c) =>
          c.name.toLowerCase().includes(lower) ||
          c.email.toLowerCase().includes(lower),
      )
  })
}