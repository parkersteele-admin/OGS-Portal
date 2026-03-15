export type ProductType = 'propane' | 'service' | 'equipment' | 'fee' | 'rental'

export interface Product {
  id: string
  name: string
  type: ProductType
  /** Billing unit label, e.g. "gallon", "each", "hour", "year" */
  unit: string
  pricePerUnit: number
  active: boolean
  description?: string
}
