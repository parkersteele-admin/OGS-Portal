// @vitest-environment node
//
// Integration tests for firestore.rules.
//
// REQUIRES the Firestore emulator to be running on localhost:8080:
//   npm run emulators
// Then in a second terminal:
//   npm test -- firestore.rules.test.ts
//
// Because rules use get() to read user documents for role resolution,
// each test seeds the relevant user docs with security rules disabled.

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

// ── Test identifiers ──────────────────────────────────────────────────────────
const ADMIN_UID        = 'u-admin'
const DISPATCH_UID     = 'u-dispatch'
const DRIVER_UID       = 'u-driver'
const DRIVER2_UID      = 'u-driver2'
const SALES_UID        = 'u-sales'
const CUSTOMER_UID     = 'u-customer'
const CUSTOMER_ID      = 'cust-001'
const ALT_CUSTOMER_UID = 'u-customer2'
const ALT_CUSTOMER_ID  = 'cust-002'

// ── Environment setup ─────────────────────────────────────────────────────────
let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'ogs-portal',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  })
}, 30_000)

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()

  // Seed all documents that rules or tests depend on, bypassing rules.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()

    // Users — roles are read by getRole() in rules via get()
    const usersToSeed = [
      { uid: ADMIN_UID,        role: 'admin' },
      { uid: DISPATCH_UID,     role: 'dispatch' },
      { uid: DRIVER_UID,       role: 'driver' },
      { uid: DRIVER2_UID,      role: 'driver' },
      { uid: SALES_UID,        role: 'sales' },
      { uid: CUSTOMER_UID,     role: 'customer', customerId: CUSTOMER_ID },
      { uid: ALT_CUSTOMER_UID, role: 'customer', customerId: ALT_CUSTOMER_ID },
    ]
    for (const u of usersToSeed) {
      await setDoc(doc(db, 'users', u.uid), { ...u, active: true })
    }

    // Customers
    await setDoc(doc(db, 'customers', CUSTOMER_ID),     { name: 'Test Corp' })
    await setDoc(doc(db, 'customers', ALT_CUSTOMER_ID), { name: 'Other Corp' })

    // Tanks
    await setDoc(doc(db, 'tanks', 'tank-001'), { customerId: CUSTOMER_ID, serialNumber: 'SN-001' })

    // Orders
    await setDoc(doc(db, 'orders', 'ord-001'), {
      customerId: CUSTOMER_ID,
      status: 'pending',
      unitPrice: 2.80,
      subtotal: 1120,
      total: 1120,
    })

    // Runs
    await setDoc(doc(db, 'runs', 'run-001'), { driverId: DRIVER_UID,  status: 'scheduled' })
    await setDoc(doc(db, 'runs', 'run-002'), { driverId: DRIVER2_UID, status: 'scheduled' })
    await setDoc(doc(db, 'runs', 'run-001', 'stops', 'stop-001'), { runId: 'run-001', status: 'pending' })
    await setDoc(doc(db, 'runs', 'run-002', 'stops', 'stop-002'), { runId: 'run-002', status: 'pending' })

    // Invoices
    await setDoc(doc(db, 'invoices', 'inv-001'), { customerId: CUSTOMER_ID,     total: 500 })
    await setDoc(doc(db, 'invoices', 'inv-002'), { customerId: ALT_CUSTOMER_ID, total: 200 })

    // Payments
    await setDoc(doc(db, 'payments', 'pay-001'), { customerId: CUSTOMER_ID,     amount: 500 })
    await setDoc(doc(db, 'payments', 'pay-002'), { customerId: ALT_CUSTOMER_ID, amount: 200 })

    // Notifications
    await setDoc(doc(db, 'notifications', 'notif-001'), { userId: CUSTOMER_UID, body: 'Hello', read: false })
    await setDoc(doc(db, 'notifications', 'notif-002'), { userId: ADMIN_UID,    body: 'Admin note', read: false })

    // Products
    await setDoc(doc(db, 'products', 'prod-001'), { name: 'Propane', active: true })

    // Leads / Quotes
    await setDoc(doc(db, 'leads',  'lead-001'), { name: 'Prospect', status: 'new' })
    await setDoc(doc(db, 'quotes', 'quote-001'), { customerId: CUSTOMER_ID, total: 1000 })
  })
}, 20_000)

// ── DB context helpers ────────────────────────────────────────────────────────
const db = {
  admin:       () => testEnv.authenticatedContext(ADMIN_UID).firestore(),
  dispatch:    () => testEnv.authenticatedContext(DISPATCH_UID).firestore(),
  driver:      () => testEnv.authenticatedContext(DRIVER_UID).firestore(),
  driver2:     () => testEnv.authenticatedContext(DRIVER2_UID).firestore(),
  sales:       () => testEnv.authenticatedContext(SALES_UID).firestore(),
  customer:    () => testEnv.authenticatedContext(CUSTOMER_UID).firestore(),
  altCustomer: () => testEnv.authenticatedContext(ALT_CUSTOMER_UID).firestore(),
  unauth:      () => testEnv.unauthenticatedContext().firestore(),
}

// =============================================================================
// users
// =============================================================================
describe('users', () => {
  it('admin can read any user doc', async () => {
    await assertSucceeds(getDoc(doc(db.admin(), 'users', CUSTOMER_UID)))
  })

  it('user can read their own doc', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'users', CUSTOMER_UID)))
  })

  it('user cannot read another user doc', async () => {
    await assertFails(getDoc(doc(db.customer(), 'users', DISPATCH_UID)))
  })

  it('unauthenticated cannot read any user', async () => {
    await assertFails(getDoc(doc(db.unauth(), 'users', CUSTOMER_UID)))
  })

  it('admin can create a user doc', async () => {
    await assertSucceeds(
      setDoc(doc(db.admin(), 'users', 'new-user'), { role: 'driver', active: true }),
    )
  })

  it('dispatch cannot create user docs', async () => {
    await assertFails(
      setDoc(doc(db.dispatch(), 'users', 'new-user'), { role: 'driver', active: true }),
    )
  })

  it('user can update their own safe profile fields', async () => {
    await assertSucceeds(
      updateDoc(doc(db.customer(), 'users', CUSTOMER_UID), { name: 'New Name' }),
    )
  })

  it('user cannot update their own role', async () => {
    await assertFails(
      updateDoc(doc(db.customer(), 'users', CUSTOMER_UID), { role: 'admin' }),
    )
  })

  it('admin can delete a user doc', async () => {
    await assertSucceeds(deleteDoc(doc(db.admin(), 'users', DRIVER_UID)))
  })

  it('dispatch cannot delete user docs', async () => {
    await assertFails(deleteDoc(doc(db.dispatch(), 'users', DRIVER_UID)))
  })
})

// =============================================================================
// customers
// =============================================================================
describe('customers', () => {
  it('dispatch can read customers', async () => {
    await assertSucceeds(getDoc(doc(db.dispatch(), 'customers', CUSTOMER_ID)))
  })

  it('sales can read customers', async () => {
    await assertSucceeds(getDoc(doc(db.sales(), 'customers', CUSTOMER_ID)))
  })

  it('customer can read their own record', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'customers', CUSTOMER_ID)))
  })

  it('customer cannot read another customer record', async () => {
    await assertFails(getDoc(doc(db.customer(), 'customers', ALT_CUSTOMER_ID)))
  })

  it('driver cannot read customer records', async () => {
    await assertFails(getDoc(doc(db.driver(), 'customers', CUSTOMER_ID)))
  })

  it('unauthenticated cannot read customers', async () => {
    await assertFails(getDoc(doc(db.unauth(), 'customers', CUSTOMER_ID)))
  })

  it('dispatch can create a customer', async () => {
    await assertSucceeds(
      setDoc(doc(db.dispatch(), 'customers', 'cust-new'), { name: 'New Co' }),
    )
  })

  it('customer cannot create customers', async () => {
    await assertFails(
      setDoc(doc(db.customer(), 'customers', 'cust-new'), { name: 'Hack Co' }),
    )
  })

  it('sales can update a customer', async () => {
    await assertSucceeds(
      updateDoc(doc(db.sales(), 'customers', CUSTOMER_ID), { notes: 'VIP' }),
    )
  })

  it('driver cannot update customers', async () => {
    await assertFails(
      updateDoc(doc(db.driver(), 'customers', CUSTOMER_ID), { notes: 'Oops' }),
    )
  })

  it('admin can delete a customer', async () => {
    await assertSucceeds(deleteDoc(doc(db.admin(), 'customers', CUSTOMER_ID)))
  })

  it('dispatch cannot delete customers', async () => {
    await assertFails(deleteDoc(doc(db.dispatch(), 'customers', CUSTOMER_ID)))
  })
})

// =============================================================================
// tanks
// =============================================================================
describe('tanks (top-level)', () => {
  it('dispatch can read tanks', async () => {
    await assertSucceeds(getDoc(doc(db.dispatch(), 'tanks', 'tank-001')))
  })

  it('customer can read their own tank', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'tanks', 'tank-001')))
  })

  it('customer cannot read another customer tank', async () => {
    // tank-001.customerId == CUSTOMER_ID; altCustomer links to ALT_CUSTOMER_ID
    await assertFails(getDoc(doc(db.altCustomer(), 'tanks', 'tank-001')))
  })

  it('driver cannot read tanks', async () => {
    await assertFails(getDoc(doc(db.driver(), 'tanks', 'tank-001')))
  })

  it('dispatch can write tanks', async () => {
    await assertSucceeds(
      setDoc(doc(db.dispatch(), 'tanks', 'tank-new'), { customerId: CUSTOMER_ID }),
    )
  })

  it('customer cannot write tanks', async () => {
    await assertFails(
      setDoc(doc(db.customer(), 'tanks', 'tank-new'), { customerId: CUSTOMER_ID }),
    )
  })
})

// =============================================================================
// orders
// =============================================================================
describe('orders', () => {
  it('dispatch can read orders', async () => {
    await assertSucceeds(getDoc(doc(db.dispatch(), 'orders', 'ord-001')))
  })

  it('customer can read their own order', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'orders', 'ord-001')))
  })

  it('customer cannot read another customer order', async () => {
    await assertFails(getDoc(doc(db.altCustomer(), 'orders', 'ord-001')))
  })

  it('driver cannot read orders', async () => {
    await assertFails(getDoc(doc(db.driver(), 'orders', 'ord-001')))
  })

  it('dispatch can create an order', async () => {
    await assertSucceeds(
      setDoc(doc(db.dispatch(), 'orders', 'ord-new'), { customerId: CUSTOMER_ID, status: 'pending' }),
    )
  })

  it('customer can create an order', async () => {
    await assertSucceeds(
      setDoc(doc(db.customer(), 'orders', 'ord-mine'), { customerId: CUSTOMER_ID, status: 'pending' }),
    )
  })

  it('dispatch can update any order field', async () => {
    await assertSucceeds(
      updateDoc(doc(db.dispatch(), 'orders', 'ord-001'), { status: 'scheduled', unitPrice: 3.00 }),
    )
  })

  it('driver can update allowed delivery fields', async () => {
    await assertSucceeds(
      updateDoc(doc(db.driver(), 'orders', 'ord-001'), {
        status: 'delivered',
        gallonsDelivered: 400,
        deliveredAt: new Date(),
      }),
    )
  })

  it('driver cannot update financial fields', async () => {
    await assertFails(
      updateDoc(doc(db.driver(), 'orders', 'ord-001'), { unitPrice: 0.01 }),
    )
  })

  it('customer cannot update orders', async () => {
    await assertFails(
      updateDoc(doc(db.customer(), 'orders', 'ord-001'), { status: 'cancelled' }),
    )
  })

  it('admin can delete an order', async () => {
    await assertSucceeds(deleteDoc(doc(db.admin(), 'orders', 'ord-001')))
  })

  it('customer cannot delete orders', async () => {
    await assertFails(deleteDoc(doc(db.customer(), 'orders', 'ord-001')))
  })
})

// =============================================================================
// runs
// =============================================================================
describe('runs', () => {
  it('dispatch can read runs', async () => {
    await assertSucceeds(getDoc(doc(db.dispatch(), 'runs', 'run-001')))
  })

  it('driver can read runs', async () => {
    await assertSucceeds(getDoc(doc(db.driver(), 'runs', 'run-001')))
  })

  it('customer cannot read runs', async () => {
    await assertFails(getDoc(doc(db.customer(), 'runs', 'run-001')))
  })

  it('dispatch can create a run', async () => {
    await assertSucceeds(
      setDoc(doc(db.dispatch(), 'runs', 'run-new'), { driverId: DRIVER_UID, status: 'scheduled' }),
    )
  })

  it('driver cannot create runs', async () => {
    await assertFails(
      setDoc(doc(db.driver(), 'runs', 'run-new'), { driverId: DRIVER_UID, status: 'scheduled' }),
    )
  })

  it('dispatch can update runs', async () => {
    await assertSucceeds(
      updateDoc(doc(db.dispatch(), 'runs', 'run-001'), { status: 'in-progress' }),
    )
  })

  it('driver cannot update runs', async () => {
    await assertFails(
      updateDoc(doc(db.driver(), 'runs', 'run-001'), { status: 'completed' }),
    )
  })
})

// =============================================================================
// run stops
// =============================================================================
describe('runs/{runId}/stops', () => {
  it('dispatch can read stops', async () => {
    await assertSucceeds(getDoc(doc(db.dispatch(), 'runs', 'run-001', 'stops', 'stop-001')))
  })

  it('driver can read stops', async () => {
    await assertSucceeds(getDoc(doc(db.driver(), 'runs', 'run-001', 'stops', 'stop-001')))
  })

  it('customer cannot read stops', async () => {
    await assertFails(getDoc(doc(db.customer(), 'runs', 'run-001', 'stops', 'stop-001')))
  })

  it('driver can update a stop on their assigned run', async () => {
    // run-001.driverId == DRIVER_UID ✓
    await assertSucceeds(
      updateDoc(doc(db.driver(), 'runs', 'run-001', 'stops', 'stop-001'), { status: 'arrived' }),
    )
  })

  it('driver cannot update a stop on a run assigned to another driver', async () => {
    // run-002.driverId == DRIVER2_UID; DRIVER_UID ≠ DRIVER2_UID
    await assertFails(
      updateDoc(doc(db.driver(), 'runs', 'run-002', 'stops', 'stop-002'), { status: 'arrived' }),
    )
  })

  it('dispatch can create stops', async () => {
    await assertSucceeds(
      setDoc(doc(db.dispatch(), 'runs', 'run-001', 'stops', 'stop-new'), { runId: 'run-001', status: 'pending' }),
    )
  })

  it('driver cannot create stops', async () => {
    await assertFails(
      setDoc(doc(db.driver(), 'runs', 'run-001', 'stops', 'stop-new'), { runId: 'run-001', status: 'pending' }),
    )
  })
})

// =============================================================================
// invoices
// =============================================================================
describe('invoices', () => {
  it('dispatch can read invoices', async () => {
    await assertSucceeds(getDoc(doc(db.dispatch(), 'invoices', 'inv-001')))
  })

  it('sales can read invoices', async () => {
    await assertSucceeds(getDoc(doc(db.sales(), 'invoices', 'inv-001')))
  })

  it('customer can read their own invoice', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'invoices', 'inv-001')))
  })

  it('customer cannot read another customer invoice', async () => {
    await assertFails(getDoc(doc(db.customer(), 'invoices', 'inv-002')))
  })

  it('driver cannot read invoices', async () => {
    await assertFails(getDoc(doc(db.driver(), 'invoices', 'inv-001')))
  })

  it('dispatch can create invoices', async () => {
    await assertSucceeds(
      setDoc(doc(db.dispatch(), 'invoices', 'inv-new'), { customerId: CUSTOMER_ID, total: 0 }),
    )
  })

  it('customer cannot create invoices', async () => {
    await assertFails(
      setDoc(doc(db.customer(), 'invoices', 'inv-new'), { customerId: CUSTOMER_ID, total: 0 }),
    )
  })

  it('sales cannot write invoices', async () => {
    // isSales() is admin|sales — but invoice write requires isAdmin()||isDispatch()
    await assertFails(
      updateDoc(doc(db.sales(), 'invoices', 'inv-001'), { status: 'void' }),
    )
  })
})

// =============================================================================
// payments
// =============================================================================
describe('payments', () => {
  it('dispatch can read payments', async () => {
    await assertSucceeds(getDoc(doc(db.dispatch(), 'payments', 'pay-001')))
  })

  it('customer can read their own payment', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'payments', 'pay-001')))
  })

  it('customer cannot read another customer payment', async () => {
    await assertFails(getDoc(doc(db.customer(), 'payments', 'pay-002')))
  })

  it('no client-side writes to payments (dispatch denied)', async () => {
    await assertFails(
      setDoc(doc(db.dispatch(), 'payments', 'pay-new'), { amount: 100 }),
    )
  })

  it('no client-side writes to payments (customer denied)', async () => {
    await assertFails(
      setDoc(doc(db.customer(), 'payments', 'pay-new'), { amount: 100 }),
    )
  })

  it('no client-side writes to payments (admin denied)', async () => {
    // Even admins must go through Functions for payment writes
    await assertFails(
      setDoc(doc(db.admin(), 'payments', 'pay-new'), { amount: 100 }),
    )
  })
})

// =============================================================================
// notifications
// =============================================================================
describe('notifications', () => {
  it('user can read their own notification', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'notifications', 'notif-001')))
  })

  it('user cannot read another user notification', async () => {
    await assertFails(getDoc(doc(db.customer(), 'notifications', 'notif-002')))
  })

  it('user can mark their own notification as read', async () => {
    await assertSucceeds(
      updateDoc(doc(db.customer(), 'notifications', 'notif-001'), { read: true }),
    )
  })

  it('user cannot update fields other than read', async () => {
    await assertFails(
      updateDoc(doc(db.customer(), 'notifications', 'notif-001'), { body: 'Hacked!' }),
    )
  })

  it('no one can create notifications from the client', async () => {
    await assertFails(
      setDoc(doc(db.admin(), 'notifications', 'notif-new'), { userId: CUSTOMER_UID, body: 'Hi' }),
    )
  })
})

// =============================================================================
// products
// =============================================================================
describe('products', () => {
  it('any authenticated user can read products', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'products', 'prod-001')))
    await assertSucceeds(getDoc(doc(db.driver(),   'products', 'prod-001')))
  })

  it('unauthenticated cannot read products', async () => {
    await assertFails(getDoc(doc(db.unauth(), 'products', 'prod-001')))
  })

  it('admin can write products', async () => {
    await assertSucceeds(
      setDoc(doc(db.admin(), 'products', 'prod-new'), { name: 'CO2', active: true }),
    )
  })

  it('dispatch cannot write products', async () => {
    await assertFails(
      setDoc(doc(db.dispatch(), 'products', 'prod-new'), { name: 'CO2', active: true }),
    )
  })
})

// =============================================================================
// leads & quotes (CRM)
// =============================================================================
describe('leads', () => {
  it('sales can read leads', async () => {
    await assertSucceeds(getDoc(doc(db.sales(), 'leads', 'lead-001')))
  })

  it('admin can read leads (isSales includes admin)', async () => {
    await assertSucceeds(getDoc(doc(db.admin(), 'leads', 'lead-001')))
  })

  it('dispatch cannot read leads', async () => {
    await assertFails(getDoc(doc(db.dispatch(), 'leads', 'lead-001')))
  })

  it('sales can write leads', async () => {
    await assertSucceeds(
      setDoc(doc(db.sales(), 'leads', 'lead-new'), { name: 'New Lead', status: 'new' }),
    )
  })

  it('customer cannot read leads', async () => {
    await assertFails(getDoc(doc(db.customer(), 'leads', 'lead-001')))
  })
})

describe('quotes', () => {
  it('sales can read quotes', async () => {
    await assertSucceeds(getDoc(doc(db.sales(), 'quotes', 'quote-001')))
  })

  it('customer can read their own quote', async () => {
    await assertSucceeds(getDoc(doc(db.customer(), 'quotes', 'quote-001')))
  })

  it('customer cannot read another customer quote', async () => {
    // quote-001.customerId == CUSTOMER_ID; altCustomer should be denied
    await assertFails(getDoc(doc(db.altCustomer(), 'quotes', 'quote-001')))
  })

  it('dispatch cannot write quotes', async () => {
    await assertFails(
      setDoc(doc(db.dispatch(), 'quotes', 'quote-new'), { customerId: CUSTOMER_ID }),
    )
  })
})

// =============================================================================
// deny-all fallback
// =============================================================================
describe('deny-all fallback', () => {
  it('admin cannot read an unknown collection', async () => {
    await assertFails(getDoc(doc(db.admin(), 'unknownCollection', 'someDoc')))
  })

  it('unauthenticated cannot read an unknown collection', async () => {
    await assertFails(getDoc(doc(db.unauth(), 'unknownCollection', 'someDoc')))
  })
})
