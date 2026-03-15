/**
 * functions/src/__tests__/stripe.test.ts
 *
 * Unit tests for the stripeWebhook HTTPS handler.
 *
 * Strategy:
 *  - `firebase-functions/v2/https` is mocked so that `onRequest(opts, handler)`
 *    returns the raw handler directly.  This lets us call stripeWebhook(req, res)
 *    without spinning up a Functions runtime.
 *  - `stripe` constructor is mocked; `constructEvent` is a vi.fn() we control
 *    per-test to simulate valid events or signature failures.
 *  - `../admin` (db + FieldValue) is mocked with per-collection doc stubs.
 *  - `../config` is mocked to supply static test secrets.
 *  - `../mail` is mocked to assert on email sends without SMTP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Stripe from 'stripe'

// ── Hoisted mock references ────────────────────────────────────────────────────
// vi.hoisted() runs before module imports so these refs can be used inside
// vi.mock() factory functions safely.

const mockConstructEvent = vi.hoisted(() => vi.fn())
const mockSendEmail = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

// Firestore doc-level operations per collection
const mockStripeEventGet    = vi.hoisted(() => vi.fn())
const mockStripeEventSet    = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockStripeEventUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const mockInvoiceGet    = vi.hoisted(() => vi.fn())
const mockInvoiceUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const mockPaymentSet = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const mockCustomerGet    = vi.hoisted(() => vi.fn())
const mockCustomerUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const mockNotificationsAdd = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'notif_1' }))

// Firestore batch
const mockBatchUpdate = vi.hoisted(() => vi.fn())
const mockBatchSet    = vi.hoisted(() => vi.fn())
const mockBatchCommit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

// ── Module mocks ───────────────────────────────────────────────────────────────

// Mock onRequest so the exported stripeWebhook IS the raw async handler
vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}))

vi.mock('stripe', () => ({
  default: class {
    webhooks = { constructEvent: mockConstructEvent }
  },
}))

vi.mock('../admin', () => ({
  db: {
    collection: (col: string) => {
      switch (col) {
        case 'stripeEvents':
          return {
            doc: () => ({
              get:    mockStripeEventGet,
              set:    mockStripeEventSet,
              update: mockStripeEventUpdate,
            }),
          }
        case 'invoices':
          return {
            doc: () => ({
              get:    mockInvoiceGet,
              update: mockInvoiceUpdate,
            }),
          }
        case 'payments':
          return {
            doc: () => ({ set: mockPaymentSet }),
          }
        case 'customers':
          return {
            doc: () => ({
              get:    mockCustomerGet,
              update: mockCustomerUpdate,
            }),
          }
        case 'notifications':
          return { add: mockNotificationsAdd }
        default:
          return {
            doc: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), update: vi.fn() })),
            add: vi.fn().mockResolvedValue({ id: 'x' }),
          }
      }
    },
    batch: () => ({
      update: mockBatchUpdate,
      set:    mockBatchSet,
      commit: mockBatchCommit,
    }),
  },
  FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
  },
}))

vi.mock('../config', () => ({
  STRIPE_SECRET_KEY:     { value: () => 'sk_test_mock' },
  STRIPE_WEBHOOK_SECRET: { value: () => 'whsec_test_mock' },
  requireSecret: (val: string) => val,
}))

vi.mock('../mail', () => ({
  sendEmail: mockSendEmail,
}))

// ── Import subject under test ──────────────────────────────────────────────────
// Because firebase-functions/v2/https is mocked, the module-level call
//   export const stripeWebhook = onRequest(opts, handler)
// resolves to `handler` directly — a plain async (req, res) function.
import { stripeWebhook } from '../webhooks/stripeWebhook'

type RawHandler = (req: MockReq, res: MockRes) => Promise<void>
const handler = stripeWebhook as unknown as RawHandler

// ── Mock request / response helpers ───────────────────────────────────────────

interface MockReq {
  method: string
  headers: Record<string, string | undefined>
  rawBody?: Buffer
}

interface MockRes {
  status: ReturnType<typeof vi.fn>
  json:   ReturnType<typeof vi.fn>
  send:   ReturnType<typeof vi.fn>
}

function makeMockRes(): MockRes {
  const res = {
    status: vi.fn(),
    json:   vi.fn(),
    send:   vi.fn(),
  } as MockRes
  res.status.mockReturnValue(res) // enable chaining: res.status(400).json({})
  return res
}

function makePostReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    method:  'POST',
    headers: { 'stripe-signature': 't=1,v1=mock_sig' },
    rawBody: Buffer.from('{}'),
    ...overrides,
  }
}

// ── Stripe event factory ───────────────────────────────────────────────────────

function makePaymentIntentEvent(
  type: 'payment_intent.succeeded' | 'payment_intent.payment_failed',
  piOverrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.Event {
  const pi: Partial<Stripe.PaymentIntent> = {
    id:                  'pi_test_001',
    object:              'payment_intent',
    amount:              10000, // $100.00 in cents
    currency:            'usd',
    status:              type === 'payment_intent.succeeded' ? 'succeeded' : 'requires_payment_method',
    metadata: {
      invoiceId:     'inv_test_001',
      customerId:    'cust_test_001',
      invoiceNumber: 'INV-001',
    },
    payment_method_types: ['card'],
    last_payment_error: type === 'payment_intent.payment_failed'
      ? ({ message: 'Your card has insufficient funds.' } as Stripe.PaymentIntent.LastPaymentError)
      : null,
    ...piOverrides,
  }

  return {
    id:               'evt_test_001',
    object:           'event',
    type,
    data:             { object: pi },
    api_version:      '2025-01-27.acacia',
    created:          Math.floor(Date.now() / 1000),
    livemode:         false,
    pending_webhooks: 0,
    request:          null,
  } as unknown as Stripe.Event
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('stripeWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: event not yet processed
    mockStripeEventGet.mockResolvedValue({ exists: false })
    mockStripeEventSet.mockResolvedValue(undefined)
    mockStripeEventUpdate.mockResolvedValue(undefined)
    mockBatchCommit.mockResolvedValue(undefined)
    mockPaymentSet.mockResolvedValue(undefined)
    mockInvoiceUpdate.mockResolvedValue(undefined)
    mockCustomerGet.mockResolvedValue({ exists: false })
    mockCustomerUpdate.mockResolvedValue(undefined)
    mockNotificationsAdd.mockResolvedValue({ id: 'notif_1' })
    mockSendEmail.mockResolvedValue(undefined)
  })

  // ── HTTP method guard ────────────────────────────────────────────────────────

  describe('HTTP guards', () => {
    it('returns 405 for non-POST requests', async () => {
      const res = makeMockRes()
      await handler({ method: 'GET', headers: {} }, res)
      expect(res.status).toHaveBeenCalledWith(405)
      expect(res.send).toHaveBeenCalledWith('Method Not Allowed')
    })

    it('returns 400 when stripe-signature header is absent', async () => {
      const res = makeMockRes()
      await handler(makePostReq({ headers: {} }), res)
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 when rawBody is absent', async () => {
      const res = makeMockRes()
      await handler(
        makePostReq({ headers: { 'stripe-signature': 't=1,v1=abc' }, rawBody: undefined }),
        res,
      )
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 when Stripe signature verification fails', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload.')
      })
      const res = makeMockRes()
      await handler(makePostReq(), res)
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('signature') }),
      )
    })
  })

  // ── Idempotency ──────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns 200 with duplicate:true when the event was already processed', async () => {
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.succeeded'),
      )
      mockStripeEventGet.mockResolvedValue({ exists: true })

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true, duplicate: true }),
      )
      // Business logic must not run
      expect(mockInvoiceGet).not.toHaveBeenCalled()
    })
  })

  // ── payment_intent.succeeded ─────────────────────────────────────────────────

  describe('payment_intent.succeeded', () => {
    function setupInvoice(status = 'sent') {
      mockInvoiceGet.mockResolvedValue({
        exists: true,
        data: () => ({
          customerId:    'cust_test_001',
          status,
          invoiceNumber: 'INV-001',
          orderId:       'ord_test_001',
        }),
      })
    }

    it('marks the invoice as paid and commits a payment record', async () => {
      setupInvoice()
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.succeeded'),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      // Batch update → invoice status = 'paid'
      expect(mockBatchUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'paid' }),
      )
      // Batch set → payment record with amount in dollars
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          invoiceId: 'inv_test_001',
          amount:    100,   // 10 000 cents → $100
          status:    'succeeded',
          currency:  'USD',
        }),
      )
      expect(mockBatchCommit).toHaveBeenCalledOnce()
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true }),
      )
    })

    it('does not double-write a payment record when the invoice is already paid', async () => {
      setupInvoice('paid')
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.succeeded'),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(mockBatchCommit).not.toHaveBeenCalled()
      // Handler still acknowledges the event
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true }),
      )
    })

    it('acknowledges gracefully when invoiceId is absent from PI metadata', async () => {
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.succeeded', {
          metadata: {} as Record<string, string>,
        }),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(mockInvoiceGet).not.toHaveBeenCalled()
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true }),
      )
    })

    it('sends a receipt email when the customer has an email address on file', async () => {
      setupInvoice()
      mockCustomerGet.mockResolvedValue({
        exists: true,
        data: () => ({
          name:           'Alice Nguyen',
          email:          'alice@example.com',
          autopayEnabled: false,
        }),
      })
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.succeeded'),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@example.com' }),
      )
    })

    it('does not throw when email send fails (best-effort)', async () => {
      setupInvoice()
      mockCustomerGet.mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Bob', email: 'bob@example.com' }),
      })
      mockSendEmail.mockRejectedValue(new Error('SMTP timeout'))
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.succeeded'),
      )

      const res = makeMockRes()
      // Should not throw; email errors are best-effort
      await expect(handler(makePostReq(), res)).resolves.not.toThrow()
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true }),
      )
    })
  })

  // ── payment_intent.payment_failed ────────────────────────────────────────────

  describe('payment_intent.payment_failed', () => {
    it('updates invoice status to payment_failed with a failure reason', async () => {
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.payment_failed'),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(mockInvoiceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status:            'payment_failed',
          lastFailureReason: 'Your card has insufficient funds.',
        }),
      )
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true }),
      )
    })

    it('creates a high-priority dispatch notification on payment failure', async () => {
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.payment_failed'),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(mockNotificationsAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          role:     'dispatch',
          type:     'payment_failed',
          priority: 'high',
        }),
      )
    })

    it('sets autopayFollowUpFlag on customers who have autopay enabled', async () => {
      mockCustomerGet.mockResolvedValue({
        exists: true,
        data: () => ({ autopayEnabled: true }),
      })
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.payment_failed'),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(mockCustomerUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ autopayFollowUpFlag: true }),
      )
    })

    it('does not set autopayFollowUpFlag when autopay is not enabled', async () => {
      mockCustomerGet.mockResolvedValue({
        exists: true,
        data: () => ({ autopayEnabled: false }),
      })
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.payment_failed'),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(mockCustomerUpdate).not.toHaveBeenCalled()
    })

    it('acknowledges gracefully when invoiceId is absent from PI metadata', async () => {
      mockConstructEvent.mockReturnValue(
        makePaymentIntentEvent('payment_intent.payment_failed', {
          metadata: {} as Record<string, string>,
        }),
      )

      const res = makeMockRes()
      await handler(makePostReq(), res)

      expect(mockInvoiceUpdate).not.toHaveBeenCalled()
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ received: true }),
      )
    })
  })
})
