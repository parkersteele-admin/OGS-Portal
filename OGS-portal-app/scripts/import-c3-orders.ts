/**
 * scripts/import-c3-orders.ts
 *
 * Imports 4 historical C3 Solutions LLC orders into Firestore to match
 * invoices 1001–1004 that were fulfilled outside the app.
 *
 * This script uses the Firebase Admin CLI's default credentials.
 * First authenticate with: firebase login
 *
 * Then run:
 *   npx firebase deploy --only functions
 *   (This deploys a callable function)
 *
 * Or for direct Firestore writes, requires Admin SDK setup.
 */

import admin from 'firebase-admin'

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'ogs-portal' })
}

const db = admin.firestore()

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateToTimestamp(dateStr: string): Timestamp {
  const [month, day, year] = dateStr.split('/').map(Number)
  return Timestamp.fromDate(new Date(year, month - 1, day))
}

/** Look up a customer by exact name. Returns {id, data} or throws. */
async function findCustomerByName(name: string) {
  const snap = await db.collection('customers').where('name', '==', name).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, data: doc.data() }
}

/** Look up a product by exact name. Returns {id, data} or null. */
async function findProductByName(name: string) {
  const snap = await db.collection('products').where('name', '==', name).limit(1).get()
  if (snap.empty) return null
  const doc = snap.docs[0]
  return { id: doc.id, data: doc.data() }
}

/** Ensure a product exists; creates it if not found. Returns product id. */
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
    console.log(`  ✓ product found  "${product.name}"  (id: ${existing.id})`)
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
  console.log(`  ✚ product created  "${product.name}"  (id: ${ref.id})`)
  return ref.id
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n[INFO] Importing C3 Solutions LLC orders (invoices 1001–1004)…\n')

  // ── 1. Resolve customer ──────────────────────────────────────────────────────
  console.log('── Customer ──')
  let customerId: string
  let customerName = 'C3 Solutions LLC'

  const customer = await findCustomerByName(customerName)
  if (customer) {
    customerId = customer.id
    customerName = customer.data.name ?? customerName
    console.log(`✓ customer found  "${customerName}"  (id: ${customerId})`)
  } else {
    // Customer doesn't exist — create it
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
    console.log(`✚ customer created  "C3 Solutions LLC"  (id: ${customerId})`)
    console.log('  ⚠  Please fill in contact name, email, and phone via the admin UI.')
  }

  // ── 2. Resolve products ──────────────────────────────────────────────────────
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

  // ── 3. Order definitions ─────────────────────────────────────────────────────

  const TAX_RATE = 0.07 // 7% applied to propane line only

  interface OrderDef {
    invoiceNumber: string  // QB invoice number to store
    shipDate: string       // MM/DD/YYYY
    invoiceDate: string
    dueDate: string
    propaneQty: number
    propaneUnitPrice: number
    hazmatFee: number
    deliveryFee: number
    salesTaxAmount: number
    subtotal: number       // propane + hazmat (all product lines, excl. delivery fee)
    total: number
    status: 'paid' | 'invoice_sent'
    paidAmount?: number    // total paid so far (if any)
    paidAt?: string        // MM/DD/YYYY of payment (for fully paid)
    notes?: string
  }

  const orderDefs: OrderDef[] = [
    {
      invoiceNumber: '1001',
      shipDate:      '04/30/2026',
      invoiceDate:   '04/30/2026',
      dueDate:       '05/30/2026',
      propaneQty:    7,
      propaneUnitPrice: 29.00,
      hazmatFee:     4.50,
      deliveryFee:   30.00,
      salesTaxAmount: 14.21,  // 7% of 7*29=$203
      subtotal:      237.50,  // 203 + 4.50 + 30
      total:         251.71,
      status:        'paid',
      paidAmount:    251.71,
      paidAt:        '04/30/2026', // listed as same day; adjust if known otherwise
    },
    {
      invoiceNumber: '1002',
      shipDate:      '05/09/2026',
      invoiceDate:   '05/11/2026',
      dueDate:       '06/10/2026',
      propaneQty:    4,
      propaneUnitPrice: 45.00,
      hazmatFee:     4.50,
      deliveryFee:   30.00,
      salesTaxAmount: 12.60,  // 7% of 4*45=$180
      subtotal:      214.50,  // 180 + 4.50 + 30
      total:         227.10,
      status:        'invoice_sent',
      paidAmount:    4.79,   // partial payment received
      notes:         'Partial payment of $4.79 received. Balance due $222.31. OVERDUE as of 06/10/2026.',
    },
    {
      invoiceNumber: '1003',
      shipDate:      '05/23/2026',
      invoiceDate:   '06/04/2026',
      dueDate:       '07/04/2026',
      propaneQty:    6,
      propaneUnitPrice: 45.00,
      hazmatFee:     4.50,
      deliveryFee:   30.00,
      salesTaxAmount: 18.90,  // 7% of 6*45=$270
      subtotal:      304.50,  // 270 + 4.50 + 30
      total:         323.40,
      status:        'invoice_sent',
      paidAmount:    0,
    },
    {
      invoiceNumber: '1004',
      shipDate:      '06/16/2026',
      invoiceDate:   '06/23/2026',
      dueDate:       '07/23/2026',
      propaneQty:    4,
      propaneUnitPrice: 45.00,
      hazmatFee:     4.50,
      deliveryFee:   30.00,
      salesTaxAmount: 12.60,  // 7% of 4*45=$180
      subtotal:      214.50,  // 180 + 4.50 + 30
      total:         227.10,
      status:        'invoice_sent',
      paidAmount:    0,
    },
  ]

  // ── 4. Create orders ─────────────────────────────────────────────────────────
  console.log('\n── Orders ──')

  for (const def of orderDefs) {
    const propaneAmount = def.propaneQty * def.propaneUnitPrice
    const shipTimestamp    = dateToTimestamp(def.shipDate)
    const invoiceTimestamp = dateToTimestamp(def.invoiceDate)
    const dueTimestamp     = dateToTimestamp(def.dueDate)
    const now              = Timestamp.now()

    const orderDoc: Record<string, unknown> = {
      customerId,
      customerName,

      // Primary product (propane exchange)
      productId:         propaneExchangeId,
      quantity:          def.propaneQty,
      unitPrice:         def.propaneUnitPrice,
      subtotal:          propaneAmount,          // qty * unitPrice (propane only)
      deliveryFee:       def.deliveryFee,
      upchargePercent:   0,

      // Tax
      applySalesTax:     true,
      salesTaxRate:      TAX_RATE,
      salesTaxAmount:    def.salesTaxAmount,

      // Total (propane + hazmat + delivery + tax)
      total:             def.total,

      // All line items (for invoice PDF generation)
      quotedLineItems: [
        {
          productId:   propaneExchangeId,
          description: '33 lb forklift propane cylinder exchange.',
          quantity:    def.propaneQty,
          unitPrice:   def.propaneUnitPrice,
          amount:      propaneAmount,
        },
        {
          productId:   hazmatFeeId,
          description: 'Hazmat and regulatory compliance fee.',
          quantity:    1,
          unitPrice:   def.hazmatFee,
          amount:      def.hazmatFee,
        },
        {
          productId:   deliveryFeeId,
          description: 'Scheduled delivery service.',
          quantity:    1,
          unitPrice:   def.deliveryFee,
          amount:      def.deliveryFee,
        },
      ],

      // Add-ons (non-primary items)
      addOns: [
        {
          productId:   hazmatFeeId,
          productName: 'Hazmat Fee',
          qty:         1,
          unitPrice:   def.hazmatFee,
          addedBy:     'import-script',
          addedAt:     invoiceTimestamp,
        },
      ],

      deliveryTier:  'standard' as const,
      orderType:     'offRoute' as const,
      status:        def.status,

      // Billing tracking
      qbInvoiceNumber: def.invoiceNumber,
      invoiceAmount:   def.total,
      invoiceSentAt:   invoiceTimestamp,

      // Payment info
      paidAmount: def.paidAmount ?? 0,
      ...(def.status === 'paid' && def.paidAt
        ? { paidAt: dateToTimestamp(def.paidAt) }
        : {}),

      // Dates
      requestedAt:  shipTimestamp,
      scheduledAt:  shipTimestamp,
      deliveredAt:  shipTimestamp,
      createdAt:    now,
      updatedAt:    now,

      ...(def.notes ? { notes: def.notes } : {}),

      // Status history
      statusHistory: [
        { status: 'pending',   changedAt: shipTimestamp, changedBy: 'import-script' },
        { status: 'delivered', changedAt: shipTimestamp, changedBy: 'import-script' },
        { status: def.status,  changedAt: invoiceTimestamp, changedBy: 'import-script' },
      ],
      statusUpdatedAt: invoiceTimestamp,
    }

    const ref = db.collection('orders').doc()
    await ref.set(orderDoc)
    console.log(`✓ order created  Invoice #${def.invoiceNumber}  (id: ${ref.id})  status: ${def.status}  total: $${def.total.toFixed(2)}`)
  }

  console.log('\n✅  Import complete! 4 orders created for C3 Solutions LLC.')
  console.log('\nSummary:')
  console.log('  Invoice 1001  04/30/2026  $251.71  PAID')
  console.log('  Invoice 1002  05/09/2026  $227.10  INVOICE SENT (overdue, $4.79 paid)')
  console.log('  Invoice 1003  05/23/2026  $323.40  INVOICE SENT')
  console.log('  Invoice 1004  06/16/2026  $227.10  INVOICE SENT')
  console.log('\nReview the orders in the admin panel and adjust customer contact info if needed.\n')

  process.exit(0)
}

run().catch((err) => {
  console.error('\n❌  Import failed:', err)
  process.exit(1)
})
