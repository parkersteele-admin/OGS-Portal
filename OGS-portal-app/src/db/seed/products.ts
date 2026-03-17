/**
 * src/db/seed/products.ts
 *
 * Columbus market starter product catalog.
 * Call `seedProducts()` from the admin panel or a one-time script.
 * Uses upsert-by-SKU so it is safe to re-run (no duplicates).
 */

import {
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore'
import { productsCol } from '../../lib/firestore'
import type { CreateProductInput } from '../../services/productService'

export const SEED_PRODUCTS: CreateProductInput[] = [
  // ── CO₂ Cylinders ────────────────────────────────────────────────────────
  {
    sku: 'CO2-5LB',
    category: 'CO\u2082 Cylinders',
    name: 'Carbon Dioxide \u2013 5 lb.',
    description: 'Ideal for home brewers, small coffee shops, food trucks, and soda machines.',
    sizeLabel: '5 lb.',
    unit: 'cylinder',
    basePrice: 6.52,
    pricePerUnit: 6.52,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: false,
    sortOrder: 10,
    tags: ['coffee', 'food service', 'homebrew'],
    active: true,
  },
  {
    sku: 'CO2-20LB',
    category: 'CO\u2082 Cylinders',
    name: 'Carbon Dioxide \u2013 20 lb.',
    description: 'The sweet spot for bars, restaurants, and breweries. Fastest turnover \u2014 our top seller.',
    sizeLabel: '20 lb.',
    unit: 'cylinder',
    basePrice: 6.95,
    pricePerUnit: 6.95,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: true,
    sortOrder: 5,
    tags: ['bar', 'restaurant', 'brewery', 'beer tap'],
    active: true,
  },
  {
    sku: 'CO2-50LB',
    category: 'CO\u2082 Cylinders',
    name: 'Carbon Dioxide \u2013 50 lb.',
    description: 'For high-volume bars and breweries that want longer service intervals.',
    sizeLabel: '50 lb.',
    unit: 'cylinder',
    basePrice: 8.40,
    pricePerUnit: 8.40,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: false,
    sortOrder: 20,
    tags: ['bar', 'brewery', 'high volume'],
    active: true,
  },
  {
    sku: 'CO2-50LB-SIPHON',
    category: 'CO\u2082 Cylinders',
    name: 'Carbon Dioxide \u2013 50 lb. (Siphon Grade)',
    description: 'Liquid withdrawal cylinder for carbonation systems and food/bev applications.',
    sizeLabel: '50 lb. Siphon',
    unit: 'cylinder',
    basePrice: 8.40,
    pricePerUnit: 8.40,
    rentalPrice: 2.34,
    isVisible: false,
    isFeatured: false,
    sortOrder: 25,
    tags: ['specialty', 'siphon', 'carbonation'],
    active: true,
  },

  // ── Nitrogen ─────────────────────────────────────────────────────────────
  {
    sku: 'N2-80CF',
    category: 'Nitrogen',
    name: 'Nitrogen \u2013 80 cf',
    description: 'Popular for nitro cold brew coffee and bar nitrogen systems. Fast rotating inventory.',
    sizeLabel: '80 cf',
    unit: 'cylinder',
    basePrice: 3.50,
    pricePerUnit: 3.50,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: true,
    sortOrder: 30,
    tags: ['coffee', 'nitro', 'bar'],
    active: true,
  },
  {
    sku: 'N2-125CF',
    category: 'Nitrogen',
    name: 'Nitrogen \u2013 125 cf',
    description: 'Larger nitrogen for multi-tap bars, breweries, and food packaging operations.',
    sizeLabel: '125 cf',
    unit: 'cylinder',
    basePrice: 3.65,
    pricePerUnit: 3.65,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: false,
    sortOrder: 35,
    tags: ['bar', 'brewery', 'packaging'],
    active: true,
  },
  {
    sku: 'N2-250CF',
    category: 'Nitrogen',
    name: 'Nitrogen \u2013 250 cf (Large)',
    description: 'High-volume nitrogen for large coffee shops and commercial breweries.',
    sizeLabel: '250 cf',
    unit: 'cylinder',
    basePrice: 7.00,
    pricePerUnit: 7.00,
    rentalPrice: 2.34,
    isVisible: false,
    isFeatured: false,
    sortOrder: 40,
    tags: ['commercial', 'industrial', 'brewery'],
    active: true,
  },

  // ── Beer Gas ──────────────────────────────────────────────────────────────
  {
    sku: 'BEERGASBLEND-125CF',
    category: 'Beer Gas',
    name: 'Argon 75% / CO\u2082 25% \u2013 125 cf',
    description: 'Premium blend for multi-tap setups, ales, and lagers. Higher margin product.',
    sizeLabel: '125 cf',
    unit: 'cylinder',
    basePrice: 21.24,
    pricePerUnit: 21.24,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: true,
    sortOrder: 50,
    tags: ['beer gas', 'bar', 'nitro beer', 'blend'],
    active: true,
  },
  {
    sku: 'BEERGASBLEND-SMALL',
    category: 'Beer Gas',
    name: 'Argon 75% / CO\u2082 25% \u2013 125 cf (Small)',
    description: 'Ideal for nitro beers like Guinness and single-tap setups.',
    sizeLabel: '125 cf (Small)',
    unit: 'cylinder',
    basePrice: 11.78,
    pricePerUnit: 11.78,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: false,
    sortOrder: 55,
    tags: ['beer gas', 'bar', 'nitro beer'],
    active: true,
  },

  // ── Propane ───────────────────────────────────────────────────────────────
  {
    sku: 'PROPANE-20LB',
    category: 'Propane',
    name: 'Propane – 20 lb.',
    description: 'Standard 20 lb. propane cylinder. Great for food trucks, outdoor grills, and portable heaters.',
    sizeLabel: '20 lb.',
    unit: 'cylinder',
    basePrice: 15.00,
    pricePerUnit: 15.00,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: false,
    sortOrder: 60,
    tags: ['propane', 'food truck', 'grill', 'heater'],
    active: true,
  },
  {
    sku: 'PROPANE-33LB',
    category: 'Propane',
    name: 'Propane – 33 lb.',
    description: 'Mid-size propane for forklifts, commercial cooking, and high-use food service.',
    sizeLabel: '33 lb.',
    unit: 'cylinder',
    basePrice: 22.50,
    pricePerUnit: 22.50,
    rentalPrice: 2.34,
    isVisible: true,
    isFeatured: false,
    sortOrder: 62,
    tags: ['propane', 'forklift', 'food service'],
    active: true,
  },
  {
    sku: 'PROPANE-100LB',
    category: 'Propane',
    name: 'Propane – 100 lb.',
    description: 'Large propane cylinder for restaurants, commercial kitchens, and high-volume operations.',
    sizeLabel: '100 lb.',
    unit: 'cylinder',
    basePrice: 55.00,
    pricePerUnit: 55.00,
    rentalPrice: 4.50,
    isVisible: true,
    isFeatured: true,
    sortOrder: 65,
    tags: ['propane', 'restaurant', 'commercial kitchen', 'high volume'],
    active: true,
  },
  {
    sku: 'PROPANE-BULK-FILL',
    category: 'Propane',
    name: 'Propane – Bulk Fill (per gallon)',
    description: 'Bulk propane fill for customer-owned tanks. Priced per gallon. Minimum 15 gal.',
    sizeLabel: 'Per Gallon',
    unit: 'gallon',
    basePrice: 2.49,
    pricePerUnit: 2.49,
    rentalPrice: null,
    isVisible: false,
    isFeatured: false,
    sortOrder: 68,
    tags: ['propane', 'bulk', 'fill'],
    active: true,
  },

  // ── Rentals ───────────────────────────────────────────────────────────────
  {
    sku: 'RENTAL-CYLINDER-MONTHLY',
    category: 'Rentals',
    name: 'Cylinder Rental \u2013 Monthly',
    description: 'Monthly rental per small or large cylinder.',
    sizeLabel: 'Per Cylinder',
    unit: 'cylinder/month',
    basePrice: 2.34,
    pricePerUnit: 2.34,
    rentalPrice: null,
    isVisible: true,
    isFeatured: false,
    sortOrder: 70,
    tags: ['rental'],
    active: true,
  },
  {
    sku: 'RENTAL-VGL-MONTHLY',
    category: 'Rentals',
    name: 'Liquid VGL Container Rental \u2013 Monthly',
    description: 'Monthly rental for liquid VGL (cryogenic) containers.',
    sizeLabel: 'Per Container',
    unit: 'container/month',
    basePrice: 33.48,
    pricePerUnit: 33.48,
    rentalPrice: null,
    isVisible: false,
    isFeatured: false,
    sortOrder: 75,
    tags: ['rental', 'cryogenic'],
    active: true,
  },

  // ── Fees ──────────────────────────────────────────────────────────────────
  {
    sku: 'HAZMAT-FEE',
    category: 'Fees',
    name: 'Hazardous Material Charge',
    description: 'Applied per invoice when hazardous materials are included in the order.',
    sizeLabel: 'Per Invoice',
    unit: 'fee',
    basePrice: 3.50,
    pricePerUnit: 3.50,
    rentalPrice: null,
    isVisible: false,
    isFeatured: false,
    sortOrder: 90,
    tags: ['fee', 'hazmat'],
    active: true,
  },
]

/**
 * Seed the Columbus market products into Firestore.
 * Uses upsert-by-SKU: creates if not found, updates fields if found.
 * Safe to run multiple times with no duplicates.
 *
 * @returns Object with { created, updated } counts
 */
export async function seedProducts(): Promise<{ created: number; updated: number }> {
  let created = 0
  let updated = 0

  for (const product of SEED_PRODUCTS) {
    const existing = await getDocs(
      query(productsCol, where('sku', '==', product.sku)),
    )

    if (existing.empty) {
      await addDoc(productsCol, {
        ...product,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      } as unknown as import('../../types/product').Product)
      created++
    } else {
      // Update fields but preserve any manual price changes already in Firestore
      const docRef = doc(productsCol.firestore, 'products', existing.docs[0].id)
      await updateDoc(docRef, {
        name: product.name,
        description: product.description,
        sizeLabel: product.sizeLabel,
        unit: product.unit,
        category: product.category,
        tags: product.tags,
        sortOrder: product.sortOrder,
        // Don't overwrite basePrice/pricePerUnit (preserve manual edits)
        // Don't overwrite isVisible/isFeatured (preserve merchandising)
        updatedAt: serverTimestamp(),
      })
      updated++
    }
  }

  return { created, updated }
}
