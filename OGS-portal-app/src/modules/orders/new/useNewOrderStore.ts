/**
 * src/modules/orders/new/useNewOrderStore.ts
 *
 * Zustand store for the New Order page.
 */

import { create } from 'zustand'
import type { Product } from '../../../types/models'
import type { LineItem, RecurringSchedule, SavedOrder } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeLineTotal(item: Pick<LineItem, 'qty' | 'unitPrice' | 'rentalPrice' | 'includeRental'>): number {
  return (
    item.qty * item.unitPrice +
    (item.includeRental && item.rentalPrice ? item.rentalPrice : 0)
  )
}

function productToLineItem(product: Product): LineItem {
  return {
    productId:     product.id,
    sku:           product.sku,
    name:          product.name,
    sizeLabel:     product.sizeLabel ?? '',
    category:      product.category,
    qty:           1,
    unitPrice:     product.basePrice,
    rentalPrice:   product.rentalPrice ?? null,
    includeRental: false,
    lineTotal:     product.basePrice,
  }
}

function templateToLineItems(template: SavedOrder): LineItem[] {
  return template.lineItems.map((item) => ({ ...item }))
}

// ── Store ─────────────────────────────────────────────────────────────────────

export interface NewOrderState {
  lineItems:              LineItem[]
  notes:                  string
  requestedDeliveryDate:  Date | null
  isRecurring:            boolean
  recurringSchedule:      RecurringSchedule | null
  currentTemplateId:      string | null
  isDirty:                boolean

  // Actions
  addLineItem:           (product: Product) => void
  addEmptyRow:           () => void
  updateLineItemQty:     (index: number, qty: number) => void
  updateLineItemRental:  (index: number, include: boolean) => void
  updateLineItemPrice:   (index: number, price: number) => void
  updateLineItemProduct: (index: number, product: Product) => void
  removeLineItem:        (index: number) => void
  setNotes:              (notes: string) => void
  setDeliveryDate:       (date: Date | null) => void
  setRecurringSchedule:  (schedule: RecurringSchedule | null) => void
  loadFromTemplate:      (template: SavedOrder) => void
  mergeFromTemplate:     (template: SavedOrder) => void
  setCurrentTemplateId:  (id: string | null) => void
  resetOrder:            () => void
}

const initialState = {
  lineItems:             [],
  notes:                 '',
  requestedDeliveryDate: null,
  isRecurring:           false,
  recurringSchedule:     null,
  currentTemplateId:     null,
  isDirty:               false,
}

export const useNewOrderStore = create<NewOrderState>((set) => ({
  ...initialState,

  addLineItem: (product) =>
    set((state) => ({
      lineItems: [...state.lineItems, productToLineItem(product)],
      isDirty:   true,
    })),

  addEmptyRow: () =>
    set((state) => ({
      lineItems: [
        ...state.lineItems,
        {
          productId:     '',
          sku:           '',
          name:          '',
          sizeLabel:     '',
          category:      '',
          qty:           1,
          unitPrice:     0,
          rentalPrice:   null,
          includeRental: false,
          lineTotal:     0,
        },
      ],
      isDirty: true,
    })),

  updateLineItemQty: (index, qty) =>
    set((state) => {
      const items = [...state.lineItems]
      const item  = { ...items[index], qty: Math.max(1, qty) }
      item.lineTotal = computeLineTotal(item)
      items[index] = item
      return { lineItems: items, isDirty: true }
    }),

  updateLineItemRental: (index, include) =>
    set((state) => {
      const items = [...state.lineItems]
      const item  = { ...items[index], includeRental: include }
      item.lineTotal = computeLineTotal(item)
      items[index] = item
      return { lineItems: items, isDirty: true }
    }),

  updateLineItemPrice: (index, price) =>
    set((state) => {
      const items = [...state.lineItems]
      const item  = { ...items[index], unitPrice: price }
      item.lineTotal = computeLineTotal(item)
      items[index] = item
      return { lineItems: items, isDirty: true }
    }),

  updateLineItemProduct: (index, product) =>
    set((state) => {
      const items   = [...state.lineItems]
      const newItem = productToLineItem(product)
      items[index]  = newItem
      return { lineItems: items, isDirty: true }
    }),

  removeLineItem: (index) =>
    set((state) => ({
      lineItems: state.lineItems.filter((_, i) => i !== index),
      isDirty:   true,
    })),

  setNotes: (notes) => set({ notes, isDirty: true }),

  setDeliveryDate: (date) => set({ requestedDeliveryDate: date, isDirty: true }),

  setRecurringSchedule: (schedule) =>
    set({ recurringSchedule: schedule, isRecurring: schedule !== null, isDirty: true }),

  loadFromTemplate: (template) =>
    set({
      lineItems:         templateToLineItems(template),
      notes:             template.notes,
      currentTemplateId: template.id,
      isDirty:           false,
    }),

  mergeFromTemplate: (template) =>
    set((state) => ({
      lineItems: [...state.lineItems, ...templateToLineItems(template)],
      isDirty:   true,
    })),

  setCurrentTemplateId: (id) => set({ currentTemplateId: id }),

  resetOrder: () => set({ ...initialState }),
}))
