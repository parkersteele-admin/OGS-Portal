/**
 * src/services/base.ts
 *
 * Shared utilities used by every service:
 *   - Firestore withConverter factory (preserves typed generics + Timestamps)
 *   - serviceCall() error-handler wrapper
 *   - Cursor-based pagination helper
 */

import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type DocumentSnapshot,
  type Query,
  type QueryConstraint,
  type Timestamp,
  getDocs,
  query,
  limit,
  startAfter,
} from 'firebase/firestore'

// ── Converter factory ─────────────────────────────────────────────────────────

/**
 * Creates a Firestore data converter that:
 *  - Injects the document `id` into the typed object on read
 *  - Strips `id` on write (Firestore stores it in the path, not the body)
 *
 * Usage:
 *   const ref = doc(db, 'customers', id).withConverter(converter<Customer>())
 */
export function converter<T extends { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: T): DocumentData {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...rest } = data
      return rest as DocumentData
    },
    fromFirestore(snap: QueryDocumentSnapshot): T {
      return { id: snap.id, ...snap.data() } as T
    },
  }
}

/**
 * Reads a typed snapshot, injecting `id` from the document path.
 * Throws a typed NotFoundError when the document does not exist.
 */
export function fromSnap<T extends { id: string }>(
  snap: DocumentSnapshot,
  collectionName: string,
): T {
  if (!snap.exists()) {
    throw new OgsNotFoundError(collectionName, snap.id)
  }
  return { id: snap.id, ...snap.data() } as T
}

// ── Typed errors ──────────────────────────────────────────────────────────────

export class OgsNotFoundError extends Error {
  collection: string
  docId: string
  constructor(collection: string, id: string) {
    super(`${collection}/${id} not found`)
    this.name = 'OgsNotFoundError'
    this.collection = collection
    this.docId = id
  }
}

export class OgsPermissionError extends Error {
  constructor(message = 'Insufficient permissions') {
    super(message)
    this.name = 'OgsPermissionError'
  }
}

export class OgsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OgsValidationError'
  }
}

// ── Error handler wrapper ─────────────────────────────────────────────────────

/**
 * Wraps an async service call, re-mapping raw Firebase errors into typed
 * OGS errors that components can handle with a simple instanceof check.
 */
export async function serviceCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: unknown) {
    if (err instanceof OgsNotFoundError || err instanceof OgsPermissionError) {
      throw err
    }
    if (err instanceof Error) {
      const code = (err as { code?: string }).code ?? ''
      if (code === 'permission-denied' || code === 'unauthenticated') {
        throw new OgsPermissionError(err.message)
      }
      if (code === 'not-found') {
        // path info not available here — rethrow with generic label
        throw new OgsNotFoundError('document', 'unknown')
      }
    }
    throw err
  }
}

// ── Firestore payload sanitization ───────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function sanitizeValue(value: unknown): unknown {
  if (value === undefined) return undefined

  if (Array.isArray(value)) {
    const cleanArray = value
      .map((entry) => sanitizeValue(entry))
      .filter((entry) => entry !== undefined)
    return cleanArray
  }

  if (isPlainObject(value)) {
    const cleanObject: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const cleanEntry = sanitizeValue(entry)
      if (cleanEntry !== undefined) {
        cleanObject[key] = cleanEntry
      }
    }
    return cleanObject
  }

  return value
}

/**
 * Recursively removes undefined values from objects and arrays.
 * Firestore rejects undefined payload values in addDoc/setDoc/updateDoc writes.
 */
export function sanitizeForFirestore<T>(value: T): T {
  return sanitizeValue(value) as T
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface Page<T> {
  data: T[]
  /** Pass to the next call as `after` to get the next page. Null on last page. */
  cursor: QueryDocumentSnapshot | null
  hasMore: boolean
}

export interface PageOptions {
  pageSize?: number
  /** Last document snapshot from the previous page. */
  after?: QueryDocumentSnapshot | null
}

/**
 * Cursor-based pagination over any Firestore query.
 *
 * @example
 * const first = await paginate(ordersCol, [where('status','==','pending')], { pageSize: 20 })
 * const second = await paginate(ordersCol, [...], { pageSize: 20, after: first.cursor })
 */
export async function paginate<T>(
  baseQuery: Query<T>,
  constraints: QueryConstraint[],
  { pageSize = 20, after = null }: PageOptions = {},
): Promise<Page<T>> {
  const allConstraints: QueryConstraint[] = [
    ...constraints,
    limit(pageSize + 1), // fetch one extra to detect hasMore
    ...(after ? [startAfter(after)] : []),
  ]

  const snap = await getDocs(query(baseQuery, ...allConstraints))
  const hasMore = snap.docs.length > pageSize
  const docs = hasMore ? snap.docs.slice(0, pageSize) : snap.docs
  const cursor = hasMore ? (docs[docs.length - 1] as QueryDocumentSnapshot) : null

  return {
    data: docs.map((d) => ({ ...d.data(), id: d.id }) as T),
    cursor,
    hasMore,
  }
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

/** Converts a Firestore Timestamp to a JS Date, accepting null/undefined. */
export function toDate(ts: Timestamp | undefined | null): Date | undefined {
  return ts?.toDate()
}

/** Returns now as a Firestore-compatible server value placeholder. */
export { serverTimestamp } from 'firebase/firestore'
