/**
 * src/modules/orders/new/OrderLineItems.tsx
 *
 * The line-item table: Product | Size | Qty | Unit Price | Rental | Total | Remove
 *
 * - Selecting a product auto-fills size, price, rental
 * - Tab on last Qty field adds a new row
 * - Enter on last Qty field also adds a new row
 * - Dispatch/admin can override unit prices
 * - Footer: "+ Add product" + subtotal
 */

import React, { useRef, useCallback } from 'react'
import { ProductSelector } from './ProductSelector'
import { useNewOrderStore } from './useNewOrderStore'
import type { Product } from '../../../types/models'
import type { LineItem } from './types'
import './OrderLineItems.css'

interface OrderLineItemsProps {
  products:     Product[]
  canEditPrice: boolean
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export const OrderLineItems: React.FC<OrderLineItemsProps> = ({
  products,
  canEditPrice,
}) => {
  const {
    lineItems,
    addEmptyRow,
    updateLineItemQty,
    updateLineItemRental,
    updateLineItemPrice,
    updateLineItemProduct,
    removeLineItem,
  } = useNewOrderStore()

  const qtyRefs = useRef<(HTMLInputElement | null)[]>([])

  const addedIds = new Set(lineItems.map((li) => li.productId).filter(Boolean))

  const subtotal = lineItems.reduce((sum, li) => sum + li.lineTotal, 0)

  const handleProductChange = useCallback(
    (index: number, product: Product) => {
      if (lineItems[index].productId === '') {
        updateLineItemProduct(index, product)
      } else {
        updateLineItemProduct(index, product)
      }
      // Move focus to the qty input for this row
      setTimeout(() => qtyRefs.current[index]?.focus(), 50)
    },
    [lineItems, updateLineItemProduct],
  )

  const handleQtyKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (index === lineItems.length - 1) {
          e.preventDefault()
          addEmptyRow()
          // Focus the product selector of the new row — happens after render
          setTimeout(() => {
            const newIndex = lineItems.length
            const container = document.querySelectorAll('.oli-row')[newIndex]
            const input = container?.querySelector<HTMLInputElement>('.ps__input')
            input?.focus()
          }, 50)
        }
      }
    },
    [lineItems.length, addEmptyRow],
  )

  const handleAddProduct = useCallback(() => {
    addEmptyRow()
    setTimeout(() => {
      const rows = document.querySelectorAll('.oli-row')
      const last = rows[rows.length - 1]
      const input = last?.querySelector<HTMLInputElement>('.ps__input')
      input?.focus()
    }, 50)
  }, [addEmptyRow])

  return (
    <div className="oli">
      <table className="oli-table">
        <thead className="oli-thead">
          <tr>
            <th className="oli-th oli-th--product">Product</th>
            <th className="oli-th oli-th--size">Size</th>
            <th className="oli-th oli-th--qty">Qty</th>
            <th className="oli-th oli-th--price">Unit Price</th>
            <th className="oli-th oli-th--rental">Rental</th>
            <th className="oli-th oli-th--total">Line Total</th>
            <th className="oli-th oli-th--remove" aria-label="Remove"></th>
          </tr>
        </thead>

        <tbody>
          {lineItems.length === 0 ? (
            <tr>
              <td colSpan={7} className="oli-empty">
                No products added yet. Click "+ Add product" below to start.
              </td>
            </tr>
          ) : (
            lineItems.map((item, index) => (
              <LineItemRow
                key={index}
                item={item}
                index={index}
                products={products}
                addedIds={addedIds}
                canEditPrice={canEditPrice}
                qtyRef={(el) => { qtyRefs.current[index] = el }}
                onProductChange={(product) => handleProductChange(index, product)}
                onQtyChange={(qty) => updateLineItemQty(index, qty)}
                onQtyKeyDown={(e) => handleQtyKeyDown(e, index)}
                onRentalChange={(checked) => updateLineItemRental(index, checked)}
                onPriceChange={(price) => updateLineItemPrice(index, price)}
                onRemove={() => removeLineItem(index)}
              />
            ))
          )}
        </tbody>

        <tfoot>
          <tr>
            <td className="oli-add-cell" colSpan={2}>
              <button className="oli-add-btn" type="button" onClick={handleAddProduct}>
                ＋ Add product
              </button>
            </td>
            <td colSpan={3} />
            <td className="oli-subtotal-cell">
              <span className="oli-subtotal-label">Subtotal</span>
              <span className="oli-subtotal-value">{formatCurrency(subtotal)}</span>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Individual row ────────────────────────────────────────────────────────────

interface RowProps {
  item:            LineItem
  index:           number
  products:        Product[]
  addedIds:        Set<string>
  canEditPrice:    boolean
  qtyRef:          (el: HTMLInputElement | null) => void
  onProductChange: (product: Product) => void
  onQtyChange:     (qty: number) => void
  onQtyKeyDown:    (e: React.KeyboardEvent<HTMLInputElement>) => void
  onRentalChange:  (checked: boolean) => void
  onPriceChange:   (price: number) => void
  onRemove:        () => void
}

const LineItemRow: React.FC<RowProps> = ({
  item, index, products, addedIds, canEditPrice,
  qtyRef, onProductChange, onQtyChange, onQtyKeyDown,
  onRentalChange, onPriceChange, onRemove,
}) => {
  const hasRental = item.rentalPrice !== null && item.rentalPrice > 0

  return (
    <tr className="oli-row">
      {/* Product selector */}
      <td className="oli-td oli-td--product">
        <ProductSelector
          products={products}
          value={item.productId}
          addedIds={addedIds}
          onChange={onProductChange}
          placeholder="Search products…"
        />
      </td>

      {/* Size (read-only) */}
      <td className="oli-td oli-td--size">
        <span className="oli-size-label">{item.sizeLabel || '—'}</span>
      </td>

      {/* Qty */}
      <td className="oli-td oli-td--qty">
        <input
          ref={qtyRef}
          className="oli-qty-input"
          type="number"
          min={1}
          value={item.qty}
          onChange={(e) => onQtyChange(Number(e.target.value))}
          onKeyDown={onQtyKeyDown}
          aria-label={`Quantity for row ${index + 1}`}
        />
      </td>

      {/* Unit Price */}
      <td className="oli-td oli-td--price">
        {canEditPrice ? (
          <input
            className="oli-price-input oli-price-input--editable"
            type="number"
            step="0.01"
            min={0}
            value={item.unitPrice}
            onChange={(e) => onPriceChange(parseFloat(e.target.value) || 0)}
            aria-label={`Unit price for row ${index + 1}`}
          />
        ) : (
          <span className="oli-price-ro">{formatCurrency(item.unitPrice)}</span>
        )}
      </td>

      {/* Rental */}
      <td className="oli-td oli-td--rental">
        {hasRental ? (
          <label className="oli-rental-label">
            <input
              type="checkbox"
              className="oli-rental-check"
              checked={item.includeRental}
              onChange={(e) => onRentalChange(e.target.checked)}
              aria-label={`Include rental for row ${index + 1}`}
            />
            <span className="oli-rental-price">
              +{formatCurrency(item.rentalPrice!)}
            </span>
          </label>
        ) : (
          <span className="oli-rental-na">—</span>
        )}
      </td>

      {/* Line Total */}
      <td className="oli-td oli-td--total">
        <span className="oli-line-total">{formatCurrency(item.lineTotal)}</span>
      </td>

      {/* Remove */}
      <td className="oli-td oli-td--remove">
        <button
          className="oli-remove-btn"
          type="button"
          onClick={onRemove}
          aria-label={`Remove row ${index + 1}`}
        >
          ×
        </button>
      </td>
    </tr>
  )
}
