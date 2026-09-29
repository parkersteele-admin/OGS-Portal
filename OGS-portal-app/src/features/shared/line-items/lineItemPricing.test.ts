import { describe, expect, it } from 'vitest'
import { EMPTY_LINE_ITEM, recalculateLineItem, calculateLineItemRollups } from './lineItemPricing'

describe('quote line pricing', () => {
  it('keeps a zero-cost fee price when margin is edited and reports its full margin', () => {
    const fee = recalculateLineItem({ ...EMPTY_LINE_ITEM(), quantity: 2, unitPrice: 15, cost: 0, marginPercent: 0.3 }, 'margin')
    expect(fee.amount).toBe(30)
    expect(fee.profit).toBe(30)
    expect(fee.marginPercent).toBe(1)
  })

  it('reports a loss instead of hiding a negative margin', () => {
    const row = recalculateLineItem({ ...EMPTY_LINE_ITEM(), unitPrice: 10, cost: 12 })
    expect(row.marginPercent).toBe(-0.2)
    expect(row.profit).toBe(-2)
  })

  it('includes products, fees, delivery and rental in the taxed total without treating tax as profit', () => {
    const product = recalculateLineItem({ ...EMPTY_LINE_ITEM(), quantity: 3, unitPrice: 20, cost: 12 })
    const fee = recalculateLineItem({ ...EMPTY_LINE_ITEM(), quantity: 1, unitPrice: 10 })
    const totals = calculateLineItemRollups({
      revenueProducts: product.amount + fee.amount,
      totalCost: product.cost * product.quantity,
      lineProfit: product.profit + fee.profit,
      extraRevenue: 15 + 5 * 2,
      applySalesTax: true,
      salesTaxRate: 0.075,
    })
    expect(totals.preTaxTotal).toBe(95)
    expect(totals.salesTaxAmount).toBe(7.13)
    expect(totals.totalRevenue).toBe(102.13)
    expect(totals.totalProfit).toBe(59)
  })
})
