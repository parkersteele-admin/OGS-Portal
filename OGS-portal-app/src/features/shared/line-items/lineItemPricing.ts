import type { ProductDropdownItem } from '../../../services/productService'
import type {
  EditableLineItem,
  LineItemRollupInput,
  LineItemRollupTotals,
  RecalcSource,
} from './types'

const DEFAULT_MIN_MARGIN = 0.2

export const EMPTY_LINE_ITEM = (): EditableLineItem => ({
  _id: crypto.randomUUID(),
  productId: '',
  productName: '',
  skuLabel: '',
  description: '',
  quantity: 1,
  basePrice: 0,
  cost: 0,
  minMarginPercent: DEFAULT_MIN_MARGIN,
  minPrice: 0,
  marginPercent: 0,
  profit: 0,
  unitPrice: 0,
  amount: 0,
})

export function normalizeMarginInput(value: number): number {
  if (!Number.isFinite(value)) return 0
  const normalized = value > 1 ? value / 100 : value
  return Math.min(Math.max(normalized, 0), 0.95)
}

export function calculateMinPrice(cost: number, minMarginPercent: number): number {
  const safeCost = Number.isFinite(cost) ? Math.max(cost, 0) : 0
  const safeMargin = Math.min(Math.max(minMarginPercent, 0), 0.95)
  return parseFloat((safeCost / (1 - safeMargin)).toFixed(2))
}

export function calculateMarginPercent(price: number, cost: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0
  return (price - cost) / price
}

export function recalculateLineItem(
  row: EditableLineItem,
  source: RecalcSource = 'other',
  enforceMarginFloor = false,
): EditableLineItem {
  const quantity = Number.isFinite(row.quantity) ? Math.max(row.quantity, 0) : 0
  const cost = Number.isFinite(row.cost) ? Math.max(row.cost, 0) : 0
  const minMarginPercent = normalizeMarginInput(row.minMarginPercent)
  const minPrice = calculateMinPrice(cost, minMarginPercent)

  let marginPercent = normalizeMarginInput(row.marginPercent)
  let unitPrice = Number.isFinite(row.unitPrice) ? parseFloat(Math.max(row.unitPrice, 0).toFixed(2)) : 0

  if (source === 'margin') {
    if (enforceMarginFloor) {
      marginPercent = Math.max(marginPercent, minMarginPercent)
    }
    const calculatedUnitPrice = parseFloat((cost / (1 - marginPercent)).toFixed(2))
    unitPrice = Number.isFinite(calculatedUnitPrice) ? calculatedUnitPrice : unitPrice
  } else {
    if (enforceMarginFloor) {
      unitPrice = Math.max(unitPrice, minPrice)
    }
    marginPercent = normalizeMarginInput(calculateMarginPercent(unitPrice, cost))
  }

  if (enforceMarginFloor && unitPrice < minPrice) {
    unitPrice = minPrice
    marginPercent = minMarginPercent
  }

  const amount = parseFloat((quantity * unitPrice).toFixed(2))
  const profit = parseFloat(((unitPrice - cost) * quantity).toFixed(2))

  return {
    ...row,
    quantity,
    cost,
    minMarginPercent,
    minPrice,
    marginPercent,
    unitPrice,
    amount,
    profit,
  }
}

export function lineItemFromProduct(
  current: EditableLineItem,
  product: ProductDropdownItem,
  enforceMarginFloor = false,
): EditableLineItem {
  const baseMargin = calculateMarginPercent(product.basePrice, product.cost)
  const marginPercent = Math.max(baseMargin, product.minMarginPercent)

  return recalculateLineItem(
    {
      ...current,
      productId: product.id,
      productName: product.name,
      skuLabel: product.sku,
      description: `${product.name}${product.unit ? ` (${product.unit})` : ''}`,
      basePrice: product.basePrice,
      cost: product.cost,
      minMarginPercent: product.minMarginPercent,
      minPrice: product.minPrice,
      marginPercent,
      unitPrice: product.basePrice,
    },
    'unitPrice',
    enforceMarginFloor,
  )
}

export function calculateLineItemRollups(input: LineItemRollupInput): LineItemRollupTotals {
  const revenueProducts = parseFloat((input.revenueProducts || 0).toFixed(2))
  const totalCost = parseFloat((input.totalCost || 0).toFixed(2))
  const lineProfit = parseFloat((input.lineProfit || 0).toFixed(2))
  const extraRevenue = parseFloat(((input.extraRevenue ?? 0) || 0).toFixed(2))
  const preTaxTotal = parseFloat((revenueProducts + extraRevenue).toFixed(2))
  const salesTaxRate = input.applySalesTax ? Math.max(input.salesTaxRate ?? 0, 0) : 0
  const salesTaxAmount = parseFloat((preTaxTotal * salesTaxRate).toFixed(2))
  const totalRevenue = parseFloat((preTaxTotal + salesTaxAmount).toFixed(2))
  const totalProfit = parseFloat((lineProfit + extraRevenue).toFixed(2))
  const overallMarginPercent = preTaxTotal > 0 ? totalProfit / preTaxTotal : 0

  return {
    revenueProducts,
    totalCost,
    lineProfit,
    preTaxTotal,
    salesTaxAmount,
    totalRevenue,
    totalProfit,
    overallMarginPercent,
  }
}
