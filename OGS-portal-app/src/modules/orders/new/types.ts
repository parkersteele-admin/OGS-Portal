/**
 * src/modules/orders/new/types.ts
 *
 * Local types for the New Order module.
 * These extend/coexist with the existing Order type in src/types/order.ts —
 * the new order feature uses a richer schema supporting multi-product line items,
 * saved templates, and recurring schedules.
 */

import type { Timestamp } from 'firebase/firestore'

// ── Line Item ─────────────────────────────────────────────────────────────────

export interface LineItem {
  productId:     string
  sku:           string
  name:          string
  sizeLabel:     string
  category:      string
  qty:           number
  unitPrice:     number
  rentalPrice:   number | null
  includeRental: boolean
  /** qty × unitPrice + (includeRental && rentalPrice ? rentalPrice : 0) */
  lineTotal:     number
}

// ── New Order ─────────────────────────────────────────────────────────────────

export type NewOrderStatus = 'draft' | 'submitted' | 'confirmed' | 'fulfilled' | 'cancelled'

export interface RecurringSchedule {
  frequency:           'weekly' | 'biweekly' | 'monthly' | 'custom'
  customIntervalDays:  number | null
  nextDeliveryDate:    Timestamp
  endDate:             Timestamp | null
  active:              boolean
}

export interface NewOrder {
  id:                      string
  customerId:              string
  customerName:            string
  status:                  NewOrderStatus
  lineItems:               LineItem[]
  notes:                   string
  requestedDeliveryDate:   Timestamp | null
  isRecurring:             boolean
  recurringSchedule:       RecurringSchedule | null
  savedAsTemplate:         boolean
  templateName:            string | null
  createdBy:               string
  createdAt:               Timestamp
  updatedAt:               Timestamp
  submittedAt:             Timestamp | null
}

// ── Saved Order Template ──────────────────────────────────────────────────────

export interface SavedOrder {
  id:           string
  templateName: string
  lineItems:    LineItem[]
  notes:        string
  createdAt:    Timestamp
  lastUsedAt:   Timestamp | null
  useCount:     number
}

// ── Reorder Point ─────────────────────────────────────────────────────────────

export interface ReorderPoint {
  id:              string   // productId is the doc ID
  productId:       string
  sku:             string
  name:            string
  sizeLabel:       string
  thresholdQty:    number
  defaultOrderQty: number
  active:          boolean
}
