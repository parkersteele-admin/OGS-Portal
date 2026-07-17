/**
 * scripts/update-product-pricing.ts
 *
 * Updates product basePrice, pricePerUnit, and cost in Firestore
 * from a QuickBooks Products/Services CSV export.
 *
 * Matches on SKU field. Skips products not found in Firestore.
 * Also writes updated cost to the productPricing subcollection document.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
 *   GOOGLE_CLOUD_PROJECT=ogs-portal \
 *   npx tsx scripts/update-product-pricing.ts --csv /absolute/path/to/file.csv
 *
 * Dry run (no writes):
 *   npx tsx scripts/update-product-pricing.ts --csv /absolute/path/to/file.csv --dry-run
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import XLSX from 'xlsx'

const { readFile, utils } = XLSX

interface PricingRow {
  sku: string
  basePrice: number
  cost: number
  productName: string
}

interface CatalogProduct {
  id: string
  sku: string
  name: string
  data: Record<string, unknown>
}

interface CliOptions {
  csvPath: string
  dryRun: boolean
  parseOnly: boolean
}

const FALLBACK_CSV_PATH = '/Users/johnathancharles/Downloads/ProductsServicesList_Ohio_Gas_Supply_Co_7_2_2026.csv'

const SKU_ALIASES: Record<string, string[]> = {
  'PROP-100': ['PROPANE-100LB'],
  'CO2-20': ['CO2-20LB'],
  'PROP-20': ['PROPANE-20LB'],
  'CO2-5': ['CO2-5LB'],
  'CO2-50': ['CO2-50LB'],
  'RENTAL': ['RENTAL-CYLINDER-MONTHLY'],
  'DELIVERY': ['FEE-DELIVERY'],
  'HAZMAT': ['FEE-HAZMAT'],
}

const NAME_ALIASES: Record<string, string[]> = {
  '20 lb co2 exchange': ['carbon dioxide 20 lb'],
  '20 lb propane exchange': ['propane 20 lb'],
  '100 lb propane fill': ['propane 100 lb'],
  '5 lb co2 exchange': ['carbon dioxide 5 lb'],
  '50 lb co2 exchange': ['carbon dioxide 50 lb'],
  '33 lb forklift propane exchange': ['33 lb forklift propane exchange'],
  'cylinder rental monthly': ['cylinder rental monthly'],
  'delivery fee': ['delivery fee'],
  'hazmat fee': ['hazmat fee'],
}

function parseCliArgs(argv: string[]): CliOptions {
  const args = [...argv]
  let csvPath = process.env.QB_PRICING_CSV ?? FALLBACK_CSV_PATH
  let dryRun = false
  let parseOnly = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--csv' && args[i + 1]) {
      csvPath = args[i + 1]
      i++
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
    }
    if (arg === '--parse-only') {
      parseOnly = true
    }
  }

  return { csvPath, dryRun, parseOnly }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const normalized = value.replace(/[$,\s]/g, '').trim()
    if (!normalized) return 0
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/co\u2082/g, 'co2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function pushUnique(list: CatalogProduct[], item: CatalogProduct) {
  if (!list.some((v) => v.id === item.id)) {
    list.push(item)
  }
}

function resolveCatalogProduct(
  row: PricingRow,
  bySku: Map<string, CatalogProduct[]>,
  byName: Map<string, CatalogProduct[]>,
): CatalogProduct | null {
  const candidates: CatalogProduct[] = []

  const directSku = bySku.get(row.sku) ?? []
  directSku.forEach((c) => pushUnique(candidates, c))

  if (candidates.length === 0) {
    const aliases = SKU_ALIASES[row.sku] ?? []
    for (const alias of aliases) {
      const skuMatches = bySku.get(alias.toUpperCase()) ?? []
      skuMatches.forEach((c) => pushUnique(candidates, c))
    }
  }

  if (candidates.length === 0) {
    const normName = normalizeToken(row.productName)
    const nameMatches = byName.get(normName) ?? []
    nameMatches.forEach((c) => pushUnique(candidates, c))

    const aliasNames = NAME_ALIASES[normName] ?? []
    for (const alias of aliasNames) {
      const aliasMatches = byName.get(normalizeToken(alias)) ?? []
      aliasMatches.forEach((c) => pushUnique(candidates, c))
    }
  }

  if (candidates.length === 1) return candidates[0]

  if (candidates.length > 1) {
    const matchedSkus = candidates.map((c) => c.sku).join(', ')
    console.warn(`  ⚠  SKU ${row.sku} — matched multiple products (${matchedSkus}), skipping`)
  }

  return null
}

function parsePricingCsv(csvPath: string): PricingRow[] {
  const workbook = readFile(csvPath, { raw: true })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error(`CSV at ${csvPath} has no sheets`)
  }

  const rows = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], {
    defval: '',
  })

  const bySku = new Map<string, PricingRow>()

  for (const row of rows) {
    const sku = String(row.SKU ?? '').trim().toUpperCase()
    if (!sku) continue

    const productName = String(row['Product/Service Name'] ?? row['Variant Name'] ?? sku).trim() || sku
    const basePriceRaw = toNumber(row.Price)
    if (!Number.isFinite(basePriceRaw) || basePriceRaw <= 0) continue
    const basePrice = Number(basePriceRaw.toFixed(2))

    const costRaw = toNumber(row.Cost)
    const cost = Number(Math.max(costRaw, 0).toFixed(2))

    const next: PricingRow = { sku, basePrice, cost, productName }
    const existing = bySku.get(sku)

    if (!existing) {
      bySku.set(sku, next)
      continue
    }

    if (next.basePrice > existing.basePrice) {
      console.warn(
        `  ⚠  Duplicate SKU ${sku} in CSV (${existing.productName} @ $${existing.basePrice} vs ${next.productName} @ $${next.basePrice}) — using higher price`,
      )
      bySku.set(sku, next)
    } else {
      console.warn(
        `  ⚠  Duplicate SKU ${sku} in CSV (${existing.productName} @ $${existing.basePrice} vs ${next.productName} @ $${next.basePrice}) — keeping existing`,
      )
    }
  }

  return [...bySku.values()]
}

if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  })
}

const db = getFirestore()
async function run() {
  const { csvPath, dryRun, parseOnly } = parseCliArgs(process.argv.slice(2))
  const pricingRows = parsePricingCsv(csvPath)

  console.log(`\nLoaded ${pricingRows.length} SKU price rows from CSV: ${csvPath}`)
  if (parseOnly) {
    console.log('Parse-only mode complete. No Firestore reads or writes were made.')
    return
  }
  if (dryRun) {
    console.log('Running in dry-run mode: no Firestore writes will be made.')
  }
  console.log('')

  let updated = 0
  let skipped = 0
  let notFound = 0

  const allProductsSnap = await db.collection('products').get()
  const allProducts: CatalogProduct[] = allProductsSnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>
    return {
      id: doc.id,
      sku: String(data.sku ?? '').trim().toUpperCase(),
      name: String(data.name ?? '').trim(),
      data,
    }
  })

  const bySku = new Map<string, CatalogProduct[]>()
  const byName = new Map<string, CatalogProduct[]>()

  for (const product of allProducts) {
    if (product.sku) {
      const skuList = bySku.get(product.sku) ?? []
      skuList.push(product)
      bySku.set(product.sku, skuList)
    }

    if (product.name) {
      const key = normalizeToken(product.name)
      const nameList = byName.get(key) ?? []
      nameList.push(product)
      byName.set(key, nameList)
    }
  }

  for (const row of pricingRows) {
    const { sku, basePrice, cost } = row
    const matchedProduct = resolveCatalogProduct(row, bySku, byName)

    if (!matchedProduct) {
      console.warn(`  ⚠  SKU ${sku} — not found in Firestore, skipping`)
      notFound++
      continue
    }

    const productRef = db.collection('products').doc(matchedProduct.id)
    const existing = matchedProduct.data

    const existingPrice = Number(existing.basePrice ?? 0)
    const existingCost  = Number(existing.cost ?? 0)
    const hasCost = cost > 0

    if (existingPrice === basePrice && (!hasCost || existingCost === cost)) {
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
    if (hasCost) productUpdate.cost = cost

    if (!dryRun) {
      await productRef.update(productUpdate)
    }

    // Also update productPricing document (same ID as product)
    if (hasCost) {
      const pricingRef = db.collection('productPricing').doc(matchedProduct.id)
      const pricingSnap = await pricingRef.get()
      if (pricingSnap.exists) {
        const minMarginPercent: number =
          (pricingSnap.data() as Record<string, unknown>).minMarginPercent as number ?? 0.2
        const minPrice = parseFloat((cost / (1 - minMarginPercent)).toFixed(2))
        if (!dryRun) {
          await pricingRef.update({
            cost,
            minPrice,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      } else {
        const minMarginPercent = 0.2
        const minPrice = parseFloat((cost / (1 - minMarginPercent)).toFixed(2))
        if (!dryRun) {
          await pricingRef.set({
            productId: matchedProduct.id,
            cost,
            minMarginPercent,
            minPrice,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }
    }

    console.log(
      `  ✓  SKU ${sku} (${matchedProduct.sku}) — price $${existingPrice} → $${basePrice}` +
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
