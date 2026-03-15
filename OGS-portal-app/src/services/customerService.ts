import {
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { customersCol } from '../lib/firestore'
import type { Customer, CustomerStatus } from '../types/customer'
import { serviceCall, fromSnap, paginate, type Page, type PageOptions } from './base'

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

    const ref = await addDoc(customersCol, {
      ...data,
      status: 'active' as CustomerStatus,
      creditLimit: data.creditLimit ?? 5000,
      ...(coords ?? {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as Omit<Customer, 'id'>)
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
    await updateDoc(doc(db, 'customers', id), {
      ...data,
      ...(coords ?? {}),
      updatedAt: serverTimestamp(),
    })
  })
}

export async function deleteCustomer(id: string): Promise<void> {
  return serviceCall(() => deleteDoc(doc(db, 'customers', id)))
}

// ── Geocode helper (stub — swap for Google Maps Geocoding API call) ────────────

interface GeocodableAddress {
  address?: string
  city?: string
  state?: string
  zip?: string
}

async function geocodeAddress(addr: GeocodableAddress): Promise<{ lat: number; lng: number }> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  if (!apiKey) throw new Error('VITE_GOOGLE_MAPS_API_KEY not set')

  const addressString = [addr.address, addr.city, addr.state, addr.zip]
    .filter(Boolean)
    .join(', ')

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
    const snap = await getDocs(query(customersCol, orderBy('name'), where('status', '==', 'active')))
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
