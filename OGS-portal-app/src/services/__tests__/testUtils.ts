/**
 * src/services/__tests__/testUtils.ts
 *
 * Shared test utilities and Firestore mocks for service layer tests.
 * Provides factories for creating test data and mocking Firebase/Firestore.
 */

import { vi, expect } from 'vitest'
import type { DocumentSnapshot, QuerySnapshot } from 'firebase/firestore'

/**
 * Mock Firestore document snapshot.
 * Simulates a Firestore document for testing read operations.
 *
 * @example
 *   const snap = createMockDocSnapshot('cust123', { name: 'Acme Inc' })
 *   expect(snap.exists()).toBe(true)
 *   expect(snap.data()).toEqual({ name: 'Acme Inc' })
 */
export function createMockDocSnapshot<T extends Record<string, any>>(
  id: string,
  data: T,
  exists = true,
): DocumentSnapshot<T> {
  return {
    id,
    ref: {} as any,
    exists: () => exists,
    data: () => (exists ? data : undefined),
    get: (field: string) => (exists ? (data as any)[field] : undefined),
    metadata: {} as any,
    isEqual: () => false,
    toJSON: () => data,
  } as any as DocumentSnapshot<T>
}

/**
 * Mock Firestore query snapshot.
 * Simulates query results for testing list operations.
 *
 * @example
 *   const docs = [
 *     { id: 'c1', name: 'Acme' },
 *     { id: 'c2', name: 'Beta' },
 *   ]
 *   const snap = createMockQuerySnapshot(docs)
 *   expect(snap.docs).toHaveLength(2)
 */
export function createMockQuerySnapshot<T extends Record<string, any>>(
  docs: (T & { id: string })[],
): QuerySnapshot<T> {
  const docSnapshots = docs.map((doc) => {
    const { id, ...data } = doc
    return createMockDocSnapshot(id, data as T, true)
  })

  return {
    docs: docSnapshots as any,
    empty: docs.length === 0,
    size: docs.length,
    query: {} as any,
    forEach: (callback: any) => docSnapshots.forEach((d) => callback(d)),
    metadata: {} as any,
    isEqual: () => false,
    docChanges: () => [],
    toJSON: () => ({ docs }),
  } as any as QuerySnapshot<T>
}

/**
 * Mock Firebase Auth context for permission tests.
 *
 * @example
 *   const authUser = createMockAuthUser('user123', 'user@company.com', 'user')
 *   expect(authUser.role).toBe('user')
 */
export function createMockAuthUser(
  uid: string,
  email: string,
  role: 'admin' | 'user' | 'driver' | 'viewer' = 'user',
) {
  return {
    uid,
    email,
    role,
    companyId: 'company123',
    customerId: 'customer123',
  }
}

/**
 * Test data factories for common entity types.
 */
export const testDataFactories = {
  /**
   * Create a minimal valid Customer for testing.
   */
  customer: (overrides?: Partial<any>) => ({
    id: 'cust123',
    name: 'Test Customer',
    email: 'customer@test.com',
    phone: '+1-555-0100',
    address: '123 Test St',
    city: 'Test City',
    state: 'TS',
    zip: '12345',
    status: 'active' as const,
    creditLimit: 5000,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }),

  /**
   * Create a minimal valid Order for testing.
   */
  order: (overrides?: Partial<any>) => ({
    id: 'ord123',
    customerId: 'cust123',
    productId: 'prod123',
    quantity: 100,
    status: 'pending' as const,
    deliveryTier: 'standard' as const,
    scheduledDate: new Date('2024-02-01'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }),

  /**
   * Create a minimal valid Invoice for testing.
   */
  invoice: (overrides?: Partial<any>) => ({
    id: 'inv123',
    customerId: 'cust123',
    orderId: 'ord123',
    amount: 1000,
    status: 'draft' as const,
    dueDate: new Date('2024-02-15'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }),

  /**
   * Create a minimal valid AppUser for testing.
   */
  user: (overrides?: Partial<any>) => ({
    id: 'user123',
    email: 'user@test.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'user' as const,
    companyId: 'company123',
    active: true,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }),

  /**
   * Create a minimal valid Tank for testing.
   */
  tank: (overrides?: Partial<any>) => ({
    id: 'tank123',
    customerId: 'cust123',
    serialNumber: 'TANK-001',
    gasType: 'propane',
    capacity: 500,
    status: 'active' as const,
    ownerId: 'user123',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }),

  /**
   * Create a minimal valid Run for testing.
   */
  run: (overrides?: Partial<any>) => ({
    id: 'run123',
    driverId: 'user123',
    scheduledDate: new Date('2024-02-01'),
    status: 'pending' as const,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }),
}

/**
 * Mock Firestore errors for testing error handling.
 */
export const firebaseErrors = {
  permissionDenied: () => {
    const error = new Error('Permission denied')
    ;(error as any).code = 'permission-denied'
    return error
  },

  notFound: () => {
    const error = new Error('Document not found')
    ;(error as any).code = 'not-found'
    return error
  },

  unauthenticated: () => {
    const error = new Error('Unauthenticated')
    ;(error as any).code = 'unauthenticated'
    return error
  },

  invalidArgument: () => {
    const error = new Error('Invalid argument')
    ;(error as any).code = 'invalid-argument'
    return error
  },

  unavailable: () => {
    const error = new Error('Service unavailable')
    ;(error as any).code = 'unavailable'
    return error
  },
}

/**
 * Spy factories for common Firebase functions.
 *
 * @example
 *   const getDocSpy = vi.fn().mockResolvedValue(snapshot)
 *   vi.mock('firebase/firestore', () => ({
 *     getDoc: getDocSpy,
 *   }))
 */
export const firebaseSpies = {
  /**
   * Create a spy for getDoc that returns mock data.
   */
  getDoc: (data: any, id = 'doc123') => {
    return vi.fn().mockResolvedValue(createMockDocSnapshot(id, data))
  },

  /**
   * Create a spy for getDocs that returns mock query results.
   */
  getDocs: (docs: any[]) => {
    return vi.fn().mockResolvedValue(createMockQuerySnapshot(docs))
  },

  /**
   * Create a spy for addDoc that returns a new doc ID.
   */
  addDoc: (newId = 'new123') => {
    return vi.fn().mockResolvedValue({ id: newId })
  },

  /**
   * Create a spy for updateDoc that succeeds.
   */
  updateDoc: () => {
    return vi.fn().mockResolvedValue(undefined)
  },

  /**
   * Create a spy for deleteDoc that succeeds.
   */
  deleteDoc: () => {
    return vi.fn().mockResolvedValue(undefined)
  },
}

/**
 * Helper to assert error properties.
 *
 * @example
 *   await expect(async () => {
 *     await getCustomer('invalid-id')
 *   }).rejects.toThrow('not found')
 *   assertErrorCode(error, 'OgsNotFoundError')
 */
export function assertErrorCode(error: any, expectedCode: string): void {
  expect(error.name).toBe(expectedCode)
}

/**
 * Helper for testing async functions that throw.
 *
 * @example
 *   const error = await expectAsyncThrow(() => deleteInvoice('inv123'))
 *   expect(error.message).toContain('Permission denied')
 */
export async function expectAsyncThrow(fn: () => Promise<any>): Promise<Error> {
  try {
    await fn()
    throw new Error('Expected function to throw')
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected function to throw') {
      throw error
    }
    return error as Error
  }
}

/**
 * Setup and teardown helpers for common test patterns.
 */
export const testSetup = {
  /**
   * Clear all mock calls before each test.
   */
  beforeEach: () => {
    vi.clearAllMocks()
  },

  /**
   * Restore all mocks after each test.
   */
  afterEach: () => {
    vi.restoreAllMocks()
  },
}
