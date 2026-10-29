import { describe, expect, it } from 'vitest'
import { EMPTY_LINE_ITEM, recalculateLineItem, calculateLineItemRollups, toQuoteItem, fromQuoteItem } from './lineItemPricing'

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

  it('multiplies daily-charged lines by days and folds them into a billable quote line', () => {
    const cage = recalculateLineItem({
      ...EMPTY_LINE_ITEM(),
      productId: 'cage',
      description: 'Propane Cage Rental (cylinder)',
      quantity: 2,
      rentalDays: 14,
      unitPrice: 5,
      cost: 1.5,
    })
    expect(cage.amount).toBe(140)
    expect(cage.profit).toBe(98)

    const saved = toQuoteItem(cage)
    expect(saved).toEqual({
      productId: 'cage',
      description: 'Propane Cage Rental (cylinder) — 2 × 14 days',
      quantity: 28,
      unitPrice: 5,
      amount: 140,
      rentalUnits: 2,
      rentalDays: 14,
    })
    expect(saved.quantity * saved.unitPrice).toBe(saved.amount)

    expect(fromQuoteItem(saved)).toEqual({
      description: 'Propane Cage Rental (cylinder)',
      quantity: 2,
      rentalDays: 14,
    })
  })

  it('leaves regular lines unfolded with no rental fields', () => {
    const row = recalculateLineItem({ ...EMPTY_LINE_ITEM(), productId: 'co2', description: 'CO2', quantity: 3, unitPrice: 20 })
    expect(toQuoteItem(row)).toEqual({ productId: 'co2', description: 'CO2', quantity: 3, unitPrice: 20, amount: 60 })
  })
})
