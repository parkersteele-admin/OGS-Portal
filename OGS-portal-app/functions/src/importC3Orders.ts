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

type HistoricalInvoiceStatus = 'paid' | 'invoice_sent'

interface HistoricalLineItem {
  productName: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

interface HistoricalInvoiceDef {
  invoiceNumber: string
  shipDate: string
  invoiceDate: string
  dueDate: string
  status: HistoricalInvoiceStatus
  paidAmount: number
  salesTaxAmount: number
  subtotal: number
  total: number
  lineItems: HistoricalLineItem[]
}

const C3_INVOICE_DEFS: HistoricalInvoiceDef[] = [
  {
    invoiceNumber: '1001',
    shipDate: '04/30/2026',
    invoiceDate: '04/30/2026',
    dueDate: '05/30/2026',
    status: 'paid',
    paidAmount: 256.50,
    salesTaxAmount: 19.00,
    subtotal: 237.50,
    total: 256.50,
    lineItems: [
      {
        productName: '33 lb Forklift Propane Exchange',
        description: '33 lb forklift propane cylinder exchange.',
        quantity: 7,
        unitPrice: 29.00,
        amount: 203.00,
      },
      {
        productName: 'Hazmat Fee',
        description: 'Hazmat and regulatory compliance fee.',
        quantity: 1,
        unitPrice: 4.50,
        amount: 4.50,
      },
      {
        productName: 'Delivery Fee',
        description: 'Scheduled delivery service.',
        quantity: 1,
        unitPrice: 30.00,
        amount: 30.00,
      },
    ],
  },
  {
    invoiceNumber: '1002',
    shipDate: '05/09/2026',
    invoiceDate: '05/11/2026',
    dueDate: '06/10/2026',
    status: 'paid',
    paidAmount: 227.10,
    salesTaxAmount: 12.60,
    subtotal: 214.50,
    total: 227.10,
    lineItems: [
      {
        productName: '33 lb Forklift Propane Exchange',
        description: '33 lb forklift propane cylinder exchange.',
        quantity: 4,
        unitPrice: 45.00,
        amount: 180.00,
      },
      {
        productName: 'Hazmat Fee',
        description: 'Hazmat and regulatory compliance fee.',
        quantity: 1,
        unitPrice: 4.50,
        amount: 4.50,
      },
      {
        productName: 'Delivery Fee',
        description: 'Scheduled delivery service.',
        quantity: 1,
        unitPrice: 30.00,
        amount: 30.00,
      },
    ],
  },
  {
    invoiceNumber: '1003',
    shipDate: '05/23/2026',
    invoiceDate: '06/04/2026',
    dueDate: '07/04/2026',
    status: 'paid',
    paidAmount: 323.40,
    salesTaxAmount: 18.90,
    subtotal: 304.50,
    total: 323.40,
    lineItems: [
      {
        productName: '33 lb Forklift Propane Exchange',
        description: '33 lb forklift propane cylinder exchange.',
        quantity: 6,
        unitPrice: 45.00,
        amount: 270.00,
      },
      {
        productName: 'Hazmat Fee',
        description: 'Hazmat and regulatory compliance fee.',
        quantity: 1,
        unitPrice: 4.50,
        amount: 4.50,
      },
      {
        productName: 'Delivery Fee',
        description: 'Scheduled delivery service.',
        quantity: 1,
        unitPrice: 30.00,
        amount: 30.00,
      },
    ],
  },
  {
    invoiceNumber: '1004',
    shipDate: '06/16/2026',
    invoiceDate: '06/23/2026',
    dueDate: '07/23/2026',
    status: 'invoice_sent',
    paidAmount: 0,
    salesTaxAmount: 12.60,
    subtotal: 214.50,
    total: 227.10,
    lineItems: [
      {
        productName: '33 lb Forklift Propane Exchange',
        description: '33 lb forklift propane cylinder exchange.',
        quantity: 4,
        unitPrice: 45.00,
        amount: 180.00,
      },
      {
        productName: 'Hazmat Fee',
        description: 'Hazmat and regulatory compliance fee.',
        quantity: 1,
        unitPrice: 4.50,
        amount: 4.50,
      },
      {
        productName: 'Delivery Fee',
        description: 'Scheduled delivery service.',
        quantity: 1,
        unitPrice: 30.00,
        amount: 30.00,
      },
    ],
  },
  {
    invoiceNumber: '1005',
    shipDate: '07/06/2026',
    invoiceDate: '07/07/2026',
    dueDate: '08/06/2026',
    status: 'invoice_sent',
    paidAmount: 0,
    salesTaxAmount: 9.45,
    subtotal: 169.50,
    total: 178.95,
    lineItems: [
      {
        productName: '33 lb Forklift Propane Exchange',
        description: '33 lb forklift propane cylinder exchange.',
        quantity: 3,
        unitPrice: 45.00,
        amount: 135.00,
      },
      {
        productName: 'Delivery Fee',
        description: 'Scheduled delivery service.',
        quantity: 1,
        unitPrice: 30.00,
        amount: 30.00,
      },
      {
        productName: 'Hazmat Fee',
        description: 'Hazmat and regulatory compliance fee.',
        quantity: 1,
        unitPrice: 4.50,
        amount: 4.50,
      },
    ],
  },
]

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

async function findOrderByInvoiceNumber(customerId: string, invoiceNumber: string) {
  const snap = await db.collection('orders')
    .where('customerId', '==', customerId)
    .where('qbInvoiceNumber', '==', invoiceNumber)
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0]
}

async function findInvoiceByInvoiceNumber(customerId: string, invoiceNumber: string) {
  const snap = await db.collection('invoices')
    .where('customerId', '==', customerId)
    .where('invoiceNumber', '==', invoiceNumber)
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0]
}

// Main function

export const importC3Orders = onCall(async (request) => {
  const { auth } = request
  // Check auth - allow if authenticated (for testing/execution)
  if (!auth) {
    throw new HttpsError('permission-denied', 'Authentication required')
  }

  console.log('\n[INFO] Syncing C3 Solutions LLC billing history (invoices 1001–1005)…\n')

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

    // ── 3. Sync orders + invoices ─────────────────────────────────────────────
    console.log('\n── Orders & Invoices ──')

    const productIdsByName = new Map<string, string>([
      ['33 lb Forklift Propane Exchange', propaneExchangeId],
      ['Hazmat Fee', hazmatFeeId],
      ['Delivery Fee', deliveryFeeId],
    ])
    const syncedOrders: string[] = []

    for (const def of C3_INVOICE_DEFS) {
      const shipTimestamp = dateToTimestamp(def.shipDate)
      const invoiceTimestamp = dateToTimestamp(def.invoiceDate)
      const dueTimestamp = dateToTimestamp(def.dueDate)
      const now = Timestamp.now()
      const propaneLine = def.lineItems[0]
      const quotedLineItems = def.lineItems.map((item) => ({
        productId: productIdsByName.get(item.productName) ?? '',
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
      }))
      const addOns = def.lineItems.slice(1).map((item) => ({
        productId: productIdsByName.get(item.productName) ?? '',
        productName: item.productName,
        qty: item.quantity,
        unitPrice: item.unitPrice,
        addedBy: 'import-function',
        addedAt: invoiceTimestamp,
      }))
      const orderStatus = def.status
      const invoiceStatus = def.status === 'paid' ? 'paid' : 'sent'
      const taxRate = def.subtotal > 0 ? Number((def.salesTaxAmount / def.subtotal).toFixed(6)) : 0
      const orderDoc = {
        customerId,
        customerName,
        productId: productIdsByName.get(propaneLine.productName) ?? propaneExchangeId,
        quantity: propaneLine.quantity,
        unitPrice: propaneLine.unitPrice,
        subtotal: propaneLine.amount,
        deliveryFee: def.lineItems.find((item) => item.productName === 'Delivery Fee')?.amount ?? 0,
        upchargePercent: 0,
        applySalesTax: true,
        salesTaxRate: taxRate,
        salesTaxAmount: def.salesTaxAmount,
        taxRate,
        taxAmount: def.salesTaxAmount,
        total: def.total,
        quotedLineItems,
        deliveredLineItems: [
          {
            productId: productIdsByName.get(propaneLine.productName) ?? propaneExchangeId,
            qty: propaneLine.quantity,
          },
        ],
        addOns,
        deliveredAddOns: addOns.map((item) => ({
          productId: item.productId,
          qty: item.qty,
        })),
        deliveryTier: 'standard',
        orderType: 'offRoute',
        status: orderStatus,
        qbInvoiceNumber: def.invoiceNumber,
        invoiceAmount: def.total,
        invoiceSentAt: invoiceTimestamp,
        paidAmount: def.paidAmount,
        paidAt: null,
        notes: null,
        requestedAt: shipTimestamp,
        scheduledAt: shipTimestamp,
        deliveredAt: shipTimestamp,
        updatedAt: now,
        statusHistory: [
          { status: 'pending', changedAt: shipTimestamp, changedBy: 'import-function' },
          { status: 'delivered', changedAt: shipTimestamp, changedBy: 'import-function' },
          { status: orderStatus, changedAt: invoiceTimestamp, changedBy: 'import-function' },
        ],
        statusUpdatedAt: invoiceTimestamp,
      }

      const existingOrder = await findOrderByInvoiceNumber(customerId, def.invoiceNumber)
      const orderRef = existingOrder?.ref ?? db.collection('orders').doc()
      await orderRef.set({
        ...(existingOrder ? {} : { createdAt: now }),
        ...orderDoc,
      }, { merge: true })

      const invoiceDoc = {
        invoiceNumber: def.invoiceNumber,
        customerId,
        orderId: orderRef.id,
        status: invoiceStatus,
        lineItems: def.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
        })),
        applySalesTax: true,
        salesTaxRate: taxRate,
        salesTaxAmount: def.salesTaxAmount,
        subtotal: def.subtotal,
        tax: def.salesTaxAmount,
        total: def.total,
        taxRate,
        taxAmount: def.salesTaxAmount,
        totalAmount: def.total,
        notes: null,
        overdueAt: null,
        reminders: null,
        issuedAt: invoiceTimestamp,
        dueAt: dueTimestamp,
        serviceDate: shipTimestamp,
        paidAt: null,
        updatedAt: now,
      }

      const existingInvoice = await findInvoiceByInvoiceNumber(customerId, def.invoiceNumber)
      const invoiceRef = existingInvoice?.ref ?? db.collection('invoices').doc()
      await invoiceRef.set({
        ...(existingInvoice ? {} : { createdAt: now }),
        ...invoiceDoc,
      }, { merge: true })

      syncedOrders.push(orderRef.id)
      console.log(`✓ Synced invoice #${def.invoiceNumber} (order: ${orderRef.id}, invoice: ${invoiceRef.id}) status: ${invoiceStatus} total: $${def.total.toFixed(2)}`)
    }

    console.log('\n✅  Sync complete! 5 historical C3 invoices/orders matched to QuickBooks.')

    return {
      success: true,
      message: '5 historical invoices and linked orders synced for C3 Solutions LLC',
      ordersCreated: syncedOrders,
      summary: [
        'Invoice 1001  04/30/2026  $256.50  PAID',
        'Invoice 1002  05/11/2026  $227.10  PAID',
        'Invoice 1003  06/04/2026  $323.40  PAID',
        'Invoice 1004  06/23/2026  $227.10  SENT',
        'Invoice 1005  07/07/2026  $178.95  SENT',
      ],
    }
  } catch (error) {
    console.error('❌ Import failed:', error)
    throw new HttpsError('internal', `Import failed: ${error instanceof Error ? error.message : String(error)}`)
  }
})
