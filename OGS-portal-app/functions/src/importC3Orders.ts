/**
 * functions/src/importC3Orders.ts
 *
 * One-time admin callable function to import C3 Solutions LLC historical orders
 * matching invoices 1001–1004 that were fulfilled outside the app.
 *
 * Deploy with: firebase deploy --only functions
 * Call from admin console or with curl
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const db = getFirestore()

// Helpers

function dateToTimestamp(dateStr: string): Timestamp {
  const [month, day, year] = dateStr.split('/').map(Number)
  return Timestamp.fromDate(new Date(year, month - 1, day))
}

async function findCustomerByName(name: string) {
  const snap = await db.collection('customers').where('name', '==', name).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, data: doc.data() }
}

async function findProductByName(name: string) {
  const snap = await db.collection('products').where('name', '==', name).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, data: doc.data() }
}

async function ensureProduct(product: {
  name: string
  sku: string
  category: string
  description: string
  basePrice: number
  pricePerUnit: number
  unit: string
  active: boolean
}): Promise<string> {
  const existing = await findProductByName(product.name)
  if (existing) {
    console.log(`✓ Product found: "${product.name}" (id: ${existing.id})`)
    return existing.id
  }
  const ref = db.collection('products').doc()
  await ref.set({
    ...product,
    isVisible: false,
    sortOrder: 99,
    isFeatured: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  })
  console.log(`✚ Product created: "${product.name}" (id: ${ref.id})`)
  return ref.id
}

// Main function

export const importC3Orders = onCall(async (request) => {
  const { auth } = request
  // Check auth - allow if authenticated (for testing/execution)
  if (!auth) {
    throw new HttpsError('permission-denied', 'Authentication required')
  }

  console.log('\n[INFO] Importing C3 Solutions LLC orders (invoices 1001–1004)…\n')

  try {
    // ── 1. Resolve/create customer ──────────────────────────────────────────────
    console.log('── Customer ──')
    let customerId: string
    let customerName = 'C3 Solutions LLC'

    const customer = await findCustomerByName(customerName)
    if (customer) {
      customerId = customer.id
      customerName = customer.data.name ?? customerName
      console.log(`✓ Customer found: "${customerName}" (id: ${customerId})`)
    } else {
      const ref = db.collection('customers').doc()
      customerId = ref.id
      const now = Timestamp.now()
      await ref.set({
        name: 'C3 Solutions LLC',
        contactName: '',
        email: '',
        phone: '',
        serviceAddress: {
          line1: '6728 Liggett Rd Ste 100',
          city: 'Dublin',
          state: 'OH',
          zip: '43016',
        },
        billingAddress: {
          line1: '6728 Liggett Rd Ste 100',
          city: 'Dublin',
          state: 'OH',
          zip: '43016',
        },
        status: 'active',
        balance: 0,
        autopayEnabled: false,
        taxExempt: false,
        creditLimit: 5000,
        createdAt: now,
        updatedAt: now,
      })
      console.log(`✚ Customer created: "C3 Solutions LLC" (id: ${customerId})`)
    }

    // ── 2. Resolve/create products ──────────────────────────────────────────────
    console.log('\n── Products ──')

    const propaneExchangeId = await ensureProduct({
      name: '33 lb Forklift Propane Exchange',
      sku: 'PROP-33LB-EXCH',
      category: 'Propane',
      description: '33 lb forklift propane cylinder exchange.',
      basePrice: 45.00,
      pricePerUnit: 45.00,
      unit: 'cylinder',
      active: true,
    })

    const hazmatFeeId = await ensureProduct({
      name: 'Hazmat Fee',
      sku: 'FEE-HAZMAT',
      category: 'Fees',
      description: 'Hazmat and regulatory compliance fee.',
      basePrice: 4.50,
      pricePerUnit: 4.50,
      unit: 'each',
      active: true,
    })

    const deliveryFeeId = await ensureProduct({
      name: 'Delivery Fee',
      sku: 'FEE-DELIVERY',
      category: 'Fees',
      description: 'Scheduled delivery service.',
      basePrice: 30.00,
      pricePerUnit: 30.00,
      unit: 'each',
      active: true,
    })

    // ── 3. Create orders ────────────────────────────────────────────────────────
    console.log('\n── Orders ──')

    const TAX_RATE = 0.07

    const orderDefs = [
      {
        invoiceNumber: '1001',
        shipDate: '04/30/2026',
        invoiceDate: '04/30/2026',
        dueDate: '05/30/2026',
        propaneQty: 7,
        propaneUnitPrice: 29.00,
        hazmatFee: 4.50,
        deliveryFee: 30.00,
        salesTaxAmount: 14.21,
        subtotal: 237.50,
        total: 251.71,
        status: 'paid' as const,
        paidAmount: 251.71,
        paidAt: '04/30/2026',
      },
      {
        invoiceNumber: '1002',
        shipDate: '05/09/2026',
        invoiceDate: '05/11/2026',
        dueDate: '06/10/2026',
        propaneQty: 4,
        propaneUnitPrice: 45.00,
        hazmatFee: 4.50,
        deliveryFee: 30.00,
        salesTaxAmount: 12.60,
        subtotal: 214.50,
        total: 227.10,
        status: 'invoice_sent' as const,
        paidAmount: 4.79,
        notes: 'Partial payment of $4.79 received. Balance due $222.31. OVERDUE as of 06/10/2026.',
      },
      {
        invoiceNumber: '1003',
        shipDate: '05/23/2026',
        invoiceDate: '06/04/2026',
        dueDate: '07/04/2026',
        propaneQty: 6,
        propaneUnitPrice: 45.00,
        hazmatFee: 4.50,
        deliveryFee: 30.00,
        salesTaxAmount: 18.90,
        subtotal: 304.50,
        total: 323.40,
        status: 'invoice_sent' as const,
        paidAmount: 0,
      },
      {
        invoiceNumber: '1004',
        shipDate: '06/16/2026',
        invoiceDate: '06/23/2026',
        dueDate: '07/23/2026',
        propaneQty: 4,
        propaneUnitPrice: 45.00,
        hazmatFee: 4.50,
        deliveryFee: 30.00,
        salesTaxAmount: 12.60,
        subtotal: 214.50,
        total: 227.10,
        status: 'invoice_sent' as const,
        paidAmount: 0,
      },
    ]

    const createdOrders: string[] = []

    for (const def of orderDefs) {
      const propaneAmount = def.propaneQty * def.propaneUnitPrice
      const shipTimestamp = dateToTimestamp(def.shipDate)
      const invoiceTimestamp = dateToTimestamp(def.invoiceDate)
      const now = Timestamp.now()

      const orderDoc = {
        customerId,
        customerName,
        productId: propaneExchangeId,
        quantity: def.propaneQty,
        unitPrice: def.propaneUnitPrice,
        subtotal: propaneAmount,
        deliveryFee: def.deliveryFee,
        upchargePercent: 0,
        applySalesTax: true,
        salesTaxRate: TAX_RATE,
        salesTaxAmount: def.salesTaxAmount,
        total: def.total,
        quotedLineItems: [
          {
            productId: propaneExchangeId,
            description: '33 lb forklift propane cylinder exchange.',
            quantity: def.propaneQty,
            unitPrice: def.propaneUnitPrice,
            amount: propaneAmount,
          },
          {
            productId: hazmatFeeId,
            description: 'Hazmat and regulatory compliance fee.',
            quantity: 1,
            unitPrice: def.hazmatFee,
            amount: def.hazmatFee,
          },
          {
            productId: deliveryFeeId,
            description: 'Scheduled delivery service.',
            quantity: 1,
            unitPrice: def.deliveryFee,
            amount: def.deliveryFee,
          },
        ],
        addOns: [
          {
            productId: hazmatFeeId,
            productName: 'Hazmat Fee',
            qty: 1,
            unitPrice: def.hazmatFee,
            addedBy: 'import-function',
            addedAt: invoiceTimestamp,
          },
        ],
        deliveryTier: 'standard',
        orderType: 'offRoute',
        status: def.status,
        qbInvoiceNumber: def.invoiceNumber,
        invoiceAmount: def.total,
        invoiceSentAt: invoiceTimestamp,
        paidAmount: def.paidAmount ?? 0,
        ...(def.status === 'paid' && def.paidAt ? { paidAt: dateToTimestamp(def.paidAt) } : {}),
        requestedAt: shipTimestamp,
        scheduledAt: shipTimestamp,
        deliveredAt: shipTimestamp,
        createdAt: now,
        updatedAt: now,
        ...(def.notes ? { notes: def.notes } : {}),
        statusHistory: [
          { status: 'pending', changedAt: shipTimestamp, changedBy: 'import-function' },
          { status: 'delivered', changedAt: shipTimestamp, changedBy: 'import-function' },
          { status: def.status, changedAt: invoiceTimestamp, changedBy: 'import-function' },
        ],
        statusUpdatedAt: invoiceTimestamp,
      }

      const ref = db.collection('orders').doc()
      await ref.set(orderDoc)
      createdOrders.push(ref.id)
      console.log(`✓ Order created: Invoice #${def.invoiceNumber} (id: ${ref.id}) status: ${def.status} total: $${def.total.toFixed(2)}`)
    }

    console.log('\n✅  Import complete! 4 orders created for C3 Solutions LLC.')

    return {
      success: true,
      message: '4 orders created successfully for C3 Solutions LLC',
      ordersCreated: createdOrders,
      summary: [
        'Invoice 1001  04/30/2026  $251.71  PAID',
        'Invoice 1002  05/09/2026  $227.10  INVOICE SENT (overdue, $4.79 paid)',
        'Invoice 1003  05/23/2026  $323.40  INVOICE SENT',
        'Invoice 1004  06/16/2026  $227.10  INVOICE SENT',
      ],
    }
  } catch (error) {
    console.error('❌ Import failed:', error)
    throw new HttpsError('internal', `Import failed: ${error instanceof Error ? error.message : String(error)}`)
  }
})
