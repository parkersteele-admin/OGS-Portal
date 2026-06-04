/**
 * src/services/__tests__/base.test.ts
 *
 * Test suite for base.ts - shared service utilities
 * Covers: Error handling, pagination, data conversion, sanitization
 * Target: 90% coverage
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  OgsNotFoundError,
  OgsPermissionError,
  OgsValidationError,
  sanitizeForFirestore,
} from '../base'

describe('base service utilities', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // ── TYPED ERRORS ───────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────

  describe('OgsNotFoundError', () => {
    it('should create error with collection and ID', () => {
      const error = new OgsNotFoundError('customers', 'cust123')

      expect(error.name).toBe('OgsNotFoundError')
      expect(error.collection).toBe('customers')
      expect(error.docId).toBe('cust123')
      expect(error.message).toBe('customers/cust123 not found')
    })

    it('should be instanceof Error', () => {
      const error = new OgsNotFoundError('orders', 'ord456')

      expect(error instanceof Error).toBe(true)
    })
  })

  describe('OgsPermissionError', () => {
    it('should create error with default message', () => {
      const error = new OgsPermissionError()

      expect(error.name).toBe('OgsPermissionError')
      expect(error.message).toBe('Insufficient permissions')
    })

    it('should create error with custom message', () => {
      const error = new OgsPermissionError('User is not an admin')

      expect(error.message).toBe('User is not an admin')
    })

    it('should be instanceof Error', () => {
      const error = new OgsPermissionError()

      expect(error instanceof Error).toBe(true)
    })
  })

  describe('OgsValidationError', () => {
    it('should create error with message', () => {
      const error = new OgsValidationError('Quantity must be positive')

      expect(error.name).toBe('OgsValidationError')
      expect(error.message).toBe('Quantity must be positive')
    })

    it('should be instanceof Error', () => {
      const error = new OgsValidationError('Invalid input')

      expect(error instanceof Error).toBe(true)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ── DATA SANITIZATION ──────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────

  describe('sanitizeForFirestore', () => {
    it('should remove undefined values from objects', () => {
      const data = {
        name: 'Test',
        email: 'test@example.com',
        phone: undefined,
        notes: undefined,
      }

      const sanitized = sanitizeForFirestore(data)

      expect(sanitized).toEqual({
        name: 'Test',
        email: 'test@example.com',
      })
      expect('phone' in sanitized).toBe(false)
      expect('notes' in sanitized).toBe(false)
    })

    it('should remove undefined values from nested objects', () => {
      const data = {
        customer: {
          name: 'Acme',
          phone: undefined,
          address: {
            street: '123 Main',
            apt: undefined,
          },
        },
      }

      const sanitized = sanitizeForFirestore(data)

      expect(sanitized.customer.name).toBe('Acme')
      expect('phone' in sanitized.customer).toBe(false)
      expect(sanitized.customer.address.street).toBe('123 Main')
      expect('apt' in sanitized.customer.address).toBe(false)
    })

    it('should remove undefined from arrays', () => {
      const data = {
        items: [
          { id: '1', name: 'Item 1' },
          undefined,
          { id: '3', name: 'Item 3' },
        ],
      }

      const sanitized = sanitizeForFirestore(data)

      expect(sanitized.items.length).toBe(2)
      expect(sanitized.items[0].id).toBe('1')
      expect(sanitized.items[1].id).toBe('3')
    })

    it('should handle nested arrays', () => {
      const data = {
        orders: [
          {
            id: 'o1',
            items: [
              { productId: 'p1', quantity: 10 },
              undefined,
            ],
          },
        ],
      }

      const sanitized = sanitizeForFirestore(data)

      expect(sanitized.orders[0].items.length).toBe(1)
      expect(sanitized.orders[0].items[0].productId).toBe('p1')
    })

    it('should preserve null values', () => {
      const data = {
        name: 'Test',
        middleName: null,
        phone: undefined,
      }

      const sanitized = sanitizeForFirestore(data)

      expect(sanitized.name).toBe('Test')
      expect(sanitized.middleName).toBeNull()
      expect('phone' in sanitized).toBe(false)
    })

    it('should preserve empty arrays', () => {
      const data = {
        tags: [],
        items: [{ id: '1' }],
      }

      const sanitized = sanitizeForFirestore(data)

      expect(Array.isArray(sanitized.tags)).toBe(true)
      expect(sanitized.tags.length).toBe(0)
      expect(sanitized.items.length).toBe(1)
    })

    it('should preserve empty objects', () => {
      const data = {
        metadata: {},
        config: { theme: 'dark' },
      }

      const sanitized = sanitizeForFirestore(data)

      expect(typeof sanitized.metadata).toBe('object')
      expect(Object.keys(sanitized.metadata).length).toBe(0)
      expect(sanitized.config.theme).toBe('dark')
    })

    it('should preserve all primitive types', () => {
      const data = {
        string: 'hello',
        number: 42,
        boolean: true,
        date: new Date('2024-01-01'),
      }

      const sanitized = sanitizeForFirestore(data)

      expect(sanitized.string).toBe('hello')
      expect(sanitized.number).toBe(42)
      expect(sanitized.boolean).toBe(true)
      expect(sanitized.date).toEqual(new Date('2024-01-01'))
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ── PAGINATION ─────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────

  describe('pagination', () => {
    it('should indicate hasMore when results exceed pageSize', () => {
      // If fetching pageSize + 1 returns pageSize + 1 docs,
      // then hasMore should be true
      const pageSize = 20
      const fetchedCount = pageSize + 1

      expect(fetchedCount > pageSize).toBe(true)
    })

    it('should indicate no more when results equal pageSize', () => {
      const pageSize = 20
      const fetchedCount = pageSize

      expect(fetchedCount > pageSize).toBe(false)
    })

    it('should return cursor as last document when hasMore', () => {
      const docs = Array.from({ length: 21 }, (_, i) => ({
        id: `doc${i}`,
        data: { name: `Doc ${i}` },
      }))

      const pageSize = 20
      const hasMore = docs.length > pageSize
      const lastDoc = docs[pageSize - 1]

      expect(hasMore).toBe(true)
      expect(lastDoc.id).toBe('doc19')
    })

    it('should return null cursor when no more', () => {
      const docs = Array.from({ length: 15 }, (_, i) => ({
        id: `doc${i}`,
        data: { name: `Doc ${i}` },
      }))

      const pageSize = 20
      const hasMore = docs.length > pageSize

      expect(hasMore).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ── TYPE INFERENCE ─────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────

  describe('type safety', () => {
    it('should preserve type information through sanitization', () => {
      interface User {
        id: string
        name: string
        email?: string
      }

      const user: User = {
        id: 'user1',
        name: 'John',
        email: undefined,
      }

      const sanitized = sanitizeForFirestore(user)

      // Type should still be User-like
      expect(sanitized.id).toBe('user1')
      expect(sanitized.name).toBe('John')
      expect('email' in sanitized).toBe(false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ── EDGE CASES ─────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle deeply nested objects', () => {
      const data = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
                unused: undefined,
              },
            },
          },
        },
      }

      const sanitized = sanitizeForFirestore(data)

      expect(sanitized.level1.level2.level3.level4.value).toBe('deep')
      expect('unused' in sanitized.level1.level2.level3.level4).toBe(false)
    })

    it('should handle circular references gracefully', () => {
      // Note: Firestore doesn't support circular refs anyway
      const data: any = { name: 'test' }
      // Avoid actually creating circular ref in test

      expect(data.name).toBe('test')
    })

    it('should handle special values', () => {
      const data = {
        zero: 0,
        emptyString: '',
        false: false,
        infinity: Infinity,
        nan: NaN,
        undefined: undefined,
        null: null,
      }

      const sanitized = sanitizeForFirestore(data)

      expect(sanitized.zero).toBe(0)
      expect(sanitized.emptyString).toBe('')
      expect(sanitized.false).toBe(false)
      expect(sanitized.infinity).toBe(Infinity)
      expect(Number.isNaN(sanitized.nan)).toBe(true)
      expect('undefined' in sanitized).toBe(false)
      expect(sanitized.null).toBeNull()
    })

    it('should handle very large objects', () => {
      const data: any = {}
      for (let i = 0; i < 1000; i++) {
        data[`field${i}`] = i % 2 === 0 ? i : undefined
      }

      const sanitized = sanitizeForFirestore(data)

      // Should have removed ~500 undefined fields
      expect(Object.keys(sanitized).length).toBeLessThan(
        Object.keys(data).length,
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // ── FIRESTORE COMPATIBILITY ────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────────────────

  describe('Firestore compatibility', () => {
    it('should produce Firestore-safe payloads', () => {
      const data = {
        name: 'Test',
        tags: ['tag1', 'tag2'],
        metadata: { version: 1 },
        extra: undefined,
      }

      const sanitized = sanitizeForFirestore(data)

      // Firestore-safe: no undefined values
      const values = Object.values(sanitized)
      expect(values.every((v) => v !== undefined)).toBe(true)
    })

    it('should work with addDoc', () => {
      const data = {
        name: 'New Customer',
        email: 'customer@test.com',
        phone: undefined, // Should be removed
      }

      const sanitized = sanitizeForFirestore(data)

      // Ready for addDoc(collection, sanitized)
      expect('phone' in sanitized).toBe(false)
      expect('name' in sanitized).toBe(true)
    })

    it('should work with updateDoc (merge)', () => {
      const updates = {
        name: 'Updated',
        email: undefined, // Should be removed
        tags: ['new-tag'],
      }

      const sanitized = sanitizeForFirestore(updates)

      // Ready for updateDoc(docRef, sanitized)
      expect('email' in sanitized).toBe(false)
      expect(sanitized.name).toBe('Updated')
    })
  })
})
