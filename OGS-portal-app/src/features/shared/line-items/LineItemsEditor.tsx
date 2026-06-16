import React, { useMemo, useState } from 'react'
import { ProductCombobox } from '../../../components/ui/ProductCombobox'
import type { ProductDropdownItem } from '../../../services/productService'
import { formatCurrency } from '../../../utils/format'
import {
  EMPTY_LINE_ITEM,
  lineItemFromProduct,
  normalizeMarginInput,
  recalculateLineItem,
} from './lineItemPricing'
import type { EditableLineItem } from './types'
import './LineItemsEditor.css'

interface LineItemsEditorProps {
  items: EditableLineItem[]
  products: ProductDropdownItem[]
  disabled?: boolean
  canViewInternalPricing?: boolean
  canEditInternalPricing?: boolean
  enforceMarginFloor?: boolean
  onChange: (items: EditableLineItem[]) => void
}

export const LineItemsEditor: React.FC<LineItemsEditorProps> = ({
  items,
  products,
  disabled = false,
  canViewInternalPricing = false,
  canEditInternalPricing = false,
  enforceMarginFloor = false,
  onChange,
}) => {
  const [detailsOpenById, setDetailsOpenById] = useState<Record<string, boolean>>({})

  const safeItems = useMemo(() => (items.length > 0 ? items : [EMPTY_LINE_ITEM()]), [items])

  const updateRow = (id: string, next: (row: EditableLineItem) => EditableLineItem) => {
    onChange(safeItems.map((row) => (row._id === id ? next(row) : row)))
  }

  const handleFieldChange = (id: string, field: keyof EditableLineItem, value: number | string) => {
    updateRow(id, (row) => {
      if (field === 'marginPercent') {
        const normalized = normalizeMarginInput(Number(value))
        return recalculateLineItem({ ...row, marginPercent: normalized }, 'margin', enforceMarginFloor)
      }
      if (field === 'unitPrice') {
        return recalculateLineItem({ ...row, unitPrice: Number(value) || 0 }, 'unitPrice', enforceMarginFloor)
      }
      if (field === 'minMarginPercent') {
        const normalized = normalizeMarginInput(Number(value))
        return recalculateLineItem({ ...row, minMarginPercent: normalized }, 'other', enforceMarginFloor)
      }
      if (field === 'cost') {
        return recalculateLineItem({ ...row, cost: Number(value) || 0 }, 'other', enforceMarginFloor)
      }
      return recalculateLineItem({ ...row, [field]: value }, 'other', enforceMarginFloor)
    })
  }

  const handleProductSelect = (id: string, product: ProductDropdownItem | null) => {
    updateRow(id, (row) => {
      if (!product) {
        return recalculateLineItem({
          ...row,
          productId: '',
          productName: '',
          skuLabel: '',
          description: '',
          basePrice: 0,
          cost: 0,
          minMarginPercent: 0.2,
          minPrice: 0,
          marginPercent: 0,
          unitPrice: 0,
        }, 'other', enforceMarginFloor)
      }
      return lineItemFromProduct(row, product, enforceMarginFloor)
    })
  }

  const handleAddRow = () => onChange([...safeItems, EMPTY_LINE_ITEM()])

  const handleRemoveRow = (id: string) => {
    const next = safeItems.filter((row) => row._id !== id)
    onChange(next.length > 0 ? next : [EMPTY_LINE_ITEM()])
  }

  return (
    <div>
      <div className="lie-items">
        {safeItems.map((row, index) => {
          const hasMarginViolation = Boolean(row.productId) && row.marginPercent + 0.0001 < row.minMarginPercent
          const detailsOpen = detailsOpenById[row._id] ?? false

          return (
            <article key={row._id} className={`lie-item${hasMarginViolation ? ' lie-item--warn' : ''}`}>
              <div className="lie-item__head">
                <span className="lie-item__num">Line {index + 1}</span>
                <button
                  type="button"
                  className="lie-item__remove"
                  onClick={() => handleRemoveRow(row._id)}
                  aria-label="Remove line item"
                  disabled={disabled}
                >
                  x
                </button>
              </div>

              <div className="lie-item__product">
                <ProductCombobox
                  value={row.productId}
                  onSelect={(product) => handleProductSelect(row._id, product)}
                  label=""
                  placeholder="Select product..."
                  products={products}
                  disabled={disabled}
                />
                <input
                  className="ui-input"
                  placeholder="Description (auto-filled or custom)"
                  value={row.description}
                  onChange={(event) => handleFieldChange(row._id, 'description', event.target.value)}
                  disabled={disabled}
                />
              </div>

              <div className="lie-item__controls">
                <label>
                  <span className="lie-item__label">Qty</span>
                  <input
                    className="ui-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.quantity || ''}
                    onChange={(event) => handleFieldChange(row._id, 'quantity', Number(event.target.value) || 0)}
                    disabled={disabled}
                  />
                </label>

                <label>
                  <span className="lie-item__label">Margin %</span>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    max={95}
                    step={0.1}
                    value={parseFloat((row.marginPercent * 100).toFixed(2)) || ''}
                    onChange={(event) => handleFieldChange(row._id, 'marginPercent', Number(event.target.value) || 0)}
                    disabled={disabled || !row.productId}
                  />
                </label>

                <label>
                  <span className="lie-item__label">Final price</span>
                  <input
                    className="ui-input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.unitPrice || ''}
                    onChange={(event) => handleFieldChange(row._id, 'unitPrice', Number(event.target.value) || 0)}
                    disabled={disabled || !row.productId}
                  />
                </label>

                <div className="lie-item__amount" role="status" aria-live="polite">
                  <span className="lie-item__label">Amount</span>
                  <strong>{formatCurrency(row.amount)}</strong>
                </div>
              </div>

              {(canViewInternalPricing || canEditInternalPricing) && (
                <>
                  <button
                    type="button"
                    className="lie-item__details-toggle"
                    onClick={() => setDetailsOpenById((prev) => ({ ...prev, [row._id]: !detailsOpen }))}
                  >
                    {detailsOpen ? 'Hide pricing details' : 'Show pricing details'}
                  </button>

                  {detailsOpen && (
                    <div className="lie-item__details">
                      {canEditInternalPricing ? (
                        <label className="lie-item__metric">
                          <span>Cost</span>
                          <input
                            className="ui-input"
                            type="number"
                            min={0}
                            step="0.01"
                            value={row.cost || ''}
                            onChange={(event) => handleFieldChange(row._id, 'cost', Number(event.target.value) || 0)}
                            disabled={disabled}
                          />
                        </label>
                      ) : (
                        <div className="lie-item__metric"><span>Cost</span><strong>{formatCurrency(row.cost)}</strong></div>
                      )}

                      <div className="lie-item__metric"><span>Base</span><strong>{formatCurrency(row.basePrice)}</strong></div>
                      <div className={`lie-item__metric${row.profit < 0 ? ' lie-item__metric--danger' : ''}`}>
                        <span>Profit</span>
                        <strong>{formatCurrency(row.profit)}</strong>
                      </div>
                      <div className={`lie-item__metric${hasMarginViolation ? ' lie-item__metric--danger' : ''}`}>
                        <span>Margin</span>
                        <strong>{(row.marginPercent * 100).toFixed(1)}%</strong>
                      </div>

                      {canEditInternalPricing ? (
                        <label className="lie-item__metric">
                          <span>Min floor margin %</span>
                          <input
                            className="ui-input"
                            type="number"
                            min={0}
                            max={95}
                            step={0.1}
                            value={parseFloat((row.minMarginPercent * 100).toFixed(2)) || ''}
                            onChange={(event) => handleFieldChange(row._id, 'minMarginPercent', Number(event.target.value) || 0)}
                            disabled={disabled}
                          />
                        </label>
                      ) : (
                        <div className="lie-item__metric">
                          <span>Min floor</span>
                          <strong>{(row.minMarginPercent * 100).toFixed(1)}% ({formatCurrency(row.minPrice)})</strong>
                        </div>
                      )}

                      {hasMarginViolation && (
                        <p className="lie-item__warning">This line is below minimum margin floor.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </article>
          )
        })}
      </div>

      {!disabled && (
        <button type="button" className="lie-add-row" onClick={handleAddRow}>
          + Add line item
        </button>
      )}
    </div>
  )
}
