/**
 * scripts/seed-emulator.ts
 *
 * Populates the Firestore + Auth emulators with realistic test data.
 * Run with:  npm run emulators:seed
 *
 * Requires the Auth + Firestore emulators to be running first:
 *   npm run emulators
 */

import { initializeApp } from 'firebase/app'
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth'
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  Timestamp,
} from 'firebase/firestore'

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const app = initializeApp({ projectId: 'ogs-portal' })
const auth = getAuth(app)
const db = getFirestore(app)

connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true })
connectFirestoreEmulator(db, 'localhost', 8080)

const now = Timestamp.now()
const daysFromNow = (d: number) =>
  Timestamp.fromMillis(Date.now() + d * 86_400_000)

// ── Helpers ───────────────────────────────────────────────────────────────────
async function createUser(
  email: string,
  password: string,
  displayName: string,
  role: string,
  customerId?: string,
) {
  const { user } = await createUserWithEmailAndPassword(auth, email, password)
  await updateProfile(user, { displayName })
  await setDoc(doc(db, 'users', user.uid), {
    uid: user.uid,
    email,
    displayName,
    role,
    ...(customerId ? { customerId } : {}),
    createdAt: now,
    updatedAt: now,
  })
  console.log(`✓ user  ${email} (${role}) — uid: ${user.uid}`)
  return user.uid
}

async function seed() {
  console.log('\n🌱  Seeding OGS Portal emulators…\n')

  // ── Test Users ──────────────────────────────────────────────────────────────
  console.log('── Users ──')
  const adminUid = await createUser('admin@ogs.test', 'password123', 'Alex Admin', 'admin')
  const salesUid = await createUser('sales@ogs.test', 'password123', 'Sam Sales', 'sales')
  const dispatchUid = await createUser('dispatch@ogs.test', 'password123', 'Dana Dispatch', 'dispatch')
  const driverUid = await createUser('driver@ogs.test', 'password123', 'Devon Driver', 'driver')
  const customerAUid = await createUser('alice@example.com', 'password123', 'Alice Carter', 'customer', 'cust-001')
  const customerBUid = await createUser('bob@example.com', 'password123', 'Bob Martinez', 'customer', 'cust-002')
  const customerCUid = await createUser('carol@example.com', 'password123', 'Carol Williams', 'customer', 'cust-003')

  // suppress unused var warnings
  void salesUid; void dispatchUid; void customerBUid; void customerCUid

  // ── Customers ───────────────────────────────────────────────────────────────
  console.log('\n── Customers ──')
  const customers = [
    {
      id: 'cust-001',
      accountNumber: 'OGS-1001',
      name: 'Carter Farm Supply',
      contactName: 'Alice Carter',
      email: 'alice@example.com',
      phone: '(419) 555-0101',
      serviceAddress: { line1: '4821 County Rd 12', city: 'Defiance', state: 'OH', zip: '43512' },
      balance: 345.50,
      autopayEnabled: true,
      taxExempt: false,
      creditLimit: 5000,
    },
    {
      id: 'cust-002',
      accountNumber: 'OGS-1002',
      name: 'Martinez Grain Co',
      contactName: 'Bob Martinez',
      email: 'bob@example.com',
      phone: '(419) 555-0202',
      serviceAddress: { line1: '1200 State Route 18', city: 'Bryan', state: 'OH', zip: '43506' },
      balance: 0,
      autopayEnabled: false,
      taxExempt: true,
      creditLimit: 10000,
    },
    {
      id: 'cust-003',
      accountNumber: 'OGS-1003',
      name: "Williams Greenhouse",
      contactName: 'Carol Williams',
      email: 'carol@example.com',
      phone: '(567) 555-0303',
      serviceAddress: { line1: '88 Greenhouse Ln', city: 'Findlay', state: 'OH', zip: '45840' },
      balance: 1280.00,
      autopayEnabled: true,
      taxExempt: false,
      creditLimit: 8000,
    },
  ]
  for (const c of customers) {
    await setDoc(doc(db, 'customers', c.id), { ...c, createdAt: now, updatedAt: now })
    console.log(`✓ customer  ${c.accountNumber} — ${c.name}`)
  }

  // ── Tanks ────────────────────────────────────────────────────────────────────
  console.log('\n── Tanks ──')
  const tanks = [
    { id: 'tank-001', customerId: 'cust-001', serialNumber: 'SN-2210-A', size: 500, ownership: 'company', estimatedLevel: 18, location: 'North barn' },
    { id: 'tank-002', customerId: 'cust-002', serialNumber: 'SN-3301-B', size: 1000, ownership: 'customer', estimatedLevel: 55, location: 'Main facility' },
    { id: 'tank-003', customerId: 'cust-003', serialNumber: 'SN-1187-C', size: 250, ownership: 'company', estimatedLevel: 72, location: 'Greenhouse 2' },
  ]
  for (const t of tanks) {
    await setDoc(doc(db, 'tanks', t.id), { ...t, createdAt: now, updatedAt: now })
    // also write into customer subcollection
    await setDoc(doc(db, `customers/${t.customerId}/tanks`, t.id), { ...t, createdAt: now, updatedAt: now })
    console.log(`✓ tank  ${t.serialNumber}  (${t.estimatedLevel}% full)`)
  }

  // ── Products ─────────────────────────────────────────────────────────────────
  console.log('\n── Products ──')
  const products = [
    { id: 'prod-001', name: 'Propane', sku: 'PROP-GAL', type: 'propane', unitPrice: 2.799, unit: 'gallon', taxable: true, active: true },
    { id: 'prod-002', name: 'Tank Rental (annual)', sku: 'TANK-RENT-YR', type: 'fee', unitPrice: 120.00, unit: 'year', taxable: false, active: true },
    { id: 'prod-003', name: 'Delivery Fee', sku: 'DEL-FEE', type: 'fee', unitPrice: 35.00, unit: 'each', taxable: false, active: true },
  ]
  for (const p of products) {
    await setDoc(doc(db, 'products', p.id), p)
    console.log(`✓ product  ${p.sku} — $${p.unitPrice}/${p.unit}`)
  }

  // ── Orders ────────────────────────────────────────────────────────────────────
  console.log('\n── Orders ──')
  const orders = [
    {
      id: 'ord-001',
      orderNumber: 'ORD-2026-0041',
      customerId: 'cust-001',
      tankId: 'tank-001',
      status: 'submitted',
      gallons: 400,
      pricePerGallon: 2.799,
      totalAmount: 1119.60,
      requestedDate: daysFromNow(2),
      createdBy: customerAUid,
    },
    {
      id: 'ord-002',
      orderNumber: 'ORD-2026-0042',
      customerId: 'cust-003',
      tankId: 'tank-003',
      status: 'confirmed',
      gallons: 200,
      pricePerGallon: 2.799,
      totalAmount: 559.80,
      requestedDate: daysFromNow(3),
      scheduledDate: daysFromNow(3),
      createdBy: adminUid,
    },
  ]
  for (const o of orders) {
    await setDoc(doc(db, 'orders', o.id), { ...o, createdAt: now, updatedAt: now })
    console.log(`✓ order  ${o.orderNumber} — ${o.status}`)
  }

  // ── Run + Stops ───────────────────────────────────────────────────────────────
  console.log('\n── Run ──')
  await setDoc(doc(db, 'runs', 'run-001'), {
    id: 'run-001',
    runNumber: 'RUN-2026-018',
    driverId: driverUid,
    date: daysFromNow(1),
    status: 'scheduled',
    stopIds: ['stop-001', 'stop-002', 'stop-003'],
    totalGallons: 900,
    createdAt: now,
    updatedAt: now,
  })
  console.log('✓ run  RUN-2026-018')

  const stops = [
    { id: 'stop-001', runId: 'run-001', order: 1, orderId: 'ord-001', customerId: 'cust-001', tankId: 'tank-001', status: 'pending' },
    { id: 'stop-002', runId: 'run-001', order: 2, orderId: 'ord-002', customerId: 'cust-003', tankId: 'tank-003', status: 'pending' },
    { id: 'stop-003', runId: 'run-001', order: 3, orderId: null,      customerId: 'cust-002', tankId: 'tank-002', status: 'pending' },
  ]
  for (const s of stops) {
    await setDoc(doc(db, 'runs', 'run-001', 'stops', s.id), s)
    console.log(`✓ stop  #${s.order}  customer ${s.customerId}`)
  }

  // ── Invoices ──────────────────────────────────────────────────────────────────
  console.log('\n── Invoices ──')
  const invoices = [
    {
      id: 'inv-001',
      invoiceNumber: 'INV-2026-0091',
      customerId: 'cust-002',
      orderId: null,
      status: 'paid',
      subtotal: 2240.00,
      tax: 0,
      total: 2240.00,
      issuedAt: daysFromNow(-20),
      dueAt: daysFromNow(-15),
      paidAt: daysFromNow(-10),
      lineItems: [
        { description: 'Propane — 800 gal', quantity: 800, unitPrice: 2.799, amount: 2239.20 },
        { description: 'Delivery Fee', quantity: 1, unitPrice: 35.00, amount: 35.00 },
      ],
    },
    {
      id: 'inv-002',
      invoiceNumber: 'INV-2026-0098',
      customerId: 'cust-003',
      orderId: 'ord-002',
      status: 'sent',
      subtotal: 594.80,
      tax: 42.63,
      total: 637.43,
      issuedAt: now,
      dueAt: daysFromNow(15),
      lineItems: [
        { description: 'Propane — 200 gal', quantity: 200, unitPrice: 2.799, amount: 559.80 },
        { description: 'Delivery Fee', quantity: 1, unitPrice: 35.00, amount: 35.00 },
      ],
    },
  ]
  for (const inv of invoices) {
    await setDoc(doc(db, 'invoices', inv.id), { ...inv, createdAt: now, updatedAt: now })
    console.log(`✓ invoice  ${inv.invoiceNumber} — ${inv.status}  $${inv.total}`)
  }

  console.log('\n✅  Seed complete!\n')
  console.log('Test accounts:')
  console.log('  admin@ogs.test       / password123')
  console.log('  sales@ogs.test       / password123')
  console.log('  dispatch@ogs.test    / password123')
  console.log('  driver@ogs.test      / password123')
  console.log('  alice@example.com    / password123  (customer — cust-001)')
  console.log('  bob@example.com      / password123  (customer — cust-002)')
  console.log('  carol@example.com    / password123  (customer — cust-003)\n')

  process.exit(0)
}

seed().catch((err) => {
  console.error('\n❌  Seed failed:', err)
  process.exit(1)
})
