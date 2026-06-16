export interface EditableLineItem {
  _id: string
  productId: string
  productName: string
  skuLabel: string
  description: string
  quantity: number
  basePrice: number
  cost: number
  minMarginPercent: number
  minPrice: number
  marginPercent: number
  profit: number
  unitPrice: number
  amount: number
}

export type RecalcSource = 'margin' | 'unitPrice' | 'other'

export interface LineItemRollupInput {
  revenueProducts: number
  totalCost: number
  lineProfit: number
  extraRevenue?: number
  applySalesTax?: boolean
  salesTaxRate?: number
}

export interface LineItemRollupTotals {
  revenueProducts: number
  totalCost: number
  lineProfit: number
  preTaxTotal: number
  salesTaxAmount: number
  totalRevenue: number
  totalProfit: number
  overallMarginPercent: number
}
