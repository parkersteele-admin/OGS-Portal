/**
 * scripts/update-product-pricing.ts
 *
 * Updates product basePrice, pricePerUnit, and cost in Firestore
 * from the QuickBooks Products/Services export (2026-07-02).
 *
 * Matches on SKU field. Skips products not found in Firestore.
 * Also writes updated cost to the productPricing subcollection document.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   npx tsx scripts/update-product-pricing.ts
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  })
}

const db = getFirestore()

// ── QB pricing from CSV export (2026-07-02) ────────────────────────────────
// { sku, basePrice, cost }  — cost is 0 when QB left it blank
const QB_PRICING: Array<{ sku: string; basePrice: number; cost: number }> = [
  { sku: 'PROP-100',  basePrice: 69.00,   cost: 32.56 },
  { sku: 'CO2-20',    basePrice: 29.00,   cost:  9.01 },
  { sku: 'PROP-20',   basePrice: 29.00,   cost:  8.24 },
  { sku: 'PROP-A33',  basePrice: 45.00,   cost: 12.30 },
  { sku: 'CO2-5',     basePrice: 18.00,   cost:  7.31 },
  { sku: 'CO2-50',    basePrice: 45.00,   cost: 15.81 },
  { sku: 'CO2-BULK',  basePrice: 95.00,   cost:  0    },
  { sku: 'CYL-DEP',   basePrice: 150.00,  cost:  0    },
  { sku: 'RENTAL',    basePrice:  5.40,   cost:  4.50 },  // monthly; daily handled separately if SKU differs
  { sku: 'CYL-DMG',   basePrice: 125.00,  cost:  0    },
  { sku: 'DELIVERY',  basePrice: 30.00,   cost:  0    },
  { sku: 'EMERG',     basePrice: 75.00,   cost:  0    },
  { sku: 'USURHE',    basePrice: 25.50,   cost:  7.70 },
  { sku: 'HAZMAT',    basePrice:  4.50,   cost:  0    },
  { sku: 'HE-BK',     basePrice: 733.00,  cost: 183.45 },
  { sku: 'HE-BT',     basePrice: 947.00,  cost: 236.77 },
  { sku: 'HE-T',      basePrice: 970.50,  cost: 242.51 },
  { sku: 'CYL-LOSS',  basePrice: 250.00,  cost:  0    },
  { sku: 'EX 1-K',    basePrice:  87.76,  cost: 21.94 },
  { sku: 'EX 1-Q',    basePrice:  76.96,  cost: 19.24 },
  { sku: 'NI-T',      basePrice:  42.76,  cost: 10.69 },
]

async function run() {
  console.log(`\nUpdating ${QB_PRICING.length} products from QB pricing export…\n`)

  let updated = 0
  let skipped = 0
  let notFound = 0

  for (const { sku, basePrice, cost } of QB_PRICING) {
    const snap = await db
      .collection('products')
      .where('sku', '==', sku)
      .limit(1)
      .get()

    if (snap.empty) {
      console.warn(`  ⚠  SKU ${sku} — not found in Firestore, skipping`)
      notFound++
      continue
    }

    const productDoc = snap.docs[0]
    const existing = productDoc.data() as Record<string, unknown>

    const existingPrice = Number(existing.basePrice ?? 0)
    const existingCost  = Number(existing.cost ?? 0)

    if (existingPrice === basePrice && existingCost === cost) {
      console.log(`  –  SKU ${sku} — unchanged ($${basePrice} / cost $${cost})`)
      skipped++
      continue
    }

    // Update the product document
    const productUpdate: Record<string, unknown> = {
      basePrice,
      pricePerUnit: basePrice,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (cost > 0) productUpdate.cost = cost

    await productDoc.ref.update(productUpdate)

    // Also update productPricing document (same ID as product)
    if (cost > 0) {
      const pricingRef = db.collection('productPricing').doc(productDoc.id)
      const pricingSnap = await pricingRef.get()
      if (pricingSnap.exists) {
        const minMarginPercent: number =
          (pricingSnap.data() as Record<string, unknown>).minMarginPercent as number ?? 0.2
        const minPrice = parseFloat((cost / (1 - minMarginPercent)).toFixed(2))
        await pricingRef.update({
          cost,
          minPrice,
          updatedAt: FieldValue.serverTimestamp(),
        })
      } else {
        const minMarginPercent = 0.2
        const minPrice = parseFloat((cost / (1 - minMarginPercent)).toFixed(2))
        await pricingRef.set({
          productId: productDoc.id,
          cost,
          minMarginPercent,
          minPrice,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    }

    console.log(
      `  ✓  SKU ${sku} — price $${existingPrice} → $${basePrice}` +
      (cost > 0 ? `, cost $${existingCost} → $${cost}` : ' (no cost in QB)'),
    )
    updated++
  }

  console.log(`\nDone. Updated: ${updated} | Unchanged: ${skipped} | Not found: ${notFound}\n`)
}

run().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
