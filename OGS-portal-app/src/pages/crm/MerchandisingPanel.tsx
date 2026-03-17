/**
 * src/pages/crm/MerchandisingPanel.tsx
 *
 * Sales / Admin — Drag-and-drop (keyboard-accessible) ordering of
 * customer-visible products, with visibility / featured toggles and
 * "Publish Changes" batch commit.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  subscribeToProducts,
  updateProduct,
  batchUpdateSortOrder,
} from '../../services/productService'
import { Button } from '../../components/ui/Button'
import type { Product } from '../../types/product'
import './MerchandisingPanel.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

// ── Draggable row ─────────────────────────────────────────────────────────────

interface MerchRowProps {
  product: Product
  index: number
  total: number
  isDragging: boolean
  isOver: boolean
  onDragStart: (index: number) => void
  onDragOver: (index: number) => void
  onDrop: () => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
  onToggleVisible: (id: string) => void
  onToggleFeatured: (id: string) => void
  dirty: boolean
}

const MerchRow: React.FC<MerchRowProps> = ({
  product, index, total, isDragging, isOver,
  onDragStart, onDragOver, onDrop,
  onMoveUp, onMoveDown,
  onToggleVisible, onToggleFeatured,
  dirty,
}) => {
  return (
    <div
      className={`mp-row${isDragging ? ' mp-row--dragging' : ''}${isOver ? ' mp-row--over' : ''}${dirty ? ' mp-row--dirty' : ''}`}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index) }}
      onDrop={onDrop}
      role="listitem"
      aria-label={`${product.name}, position ${index + 1} of ${total}`}
    >
      {/* Drag handle */}
      <div className="mp-row__drag" aria-hidden="true" title="Drag to reorder">⠿</div>

      {/* Keyboard reorder */}
      <div className="mp-row__kb-order">
        <button
          className="mp-row__kb-btn"
          onClick={() => onMoveUp(index)}
          disabled={index === 0}
          aria-label={`Move ${product.name} up`}
          title="Move up"
        >▲</button>
        <span className="mp-row__pos">{index + 1}</span>
        <button
          className="mp-row__kb-btn"
          onClick={() => onMoveDown(index)}
          disabled={index === total - 1}
          aria-label={`Move ${product.name} down`}
          title="Move down"
        >▼</button>
      </div>

      {/* Product info */}
      <div className="mp-row__info">
        <div className="mp-row__name">
          {product.name}
          {product.isFeatured && (
            <span className="mp-row__featured-badge" aria-label="Featured">Popular</span>
          )}
          {dirty && <span className="mp-row__unsaved" title="Unsaved change">●</span>}
        </div>
        <div className="mp-row__meta">
          <span className="mp-row__sku">{product.sku}</span>
          {product.sizeLabel && <span>{product.sizeLabel}</span>}
          <span>{fmt(product.basePrice)} / {product.unit}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="mp-row__controls">
        <label className="mp-row__toggle-label">
          <ToggleSwitch
            checked={product.isVisible}
            onChange={() => onToggleVisible(product.id)}
            label={`${product.isVisible ? 'Hide' : 'Show'} ${product.name}`}
          />
          <span className="mp-row__toggle-text">{product.isVisible ? 'Visible' : 'Hidden'}</span>
        </label>
        <label className="mp-row__toggle-label">
          <ToggleSwitch
            checked={product.isFeatured}
            onChange={() => onToggleFeatured(product.id)}
            label={`${product.isFeatured ? 'Unfeature' : 'Feature'} ${product.name}`}
            disabled={!product.isVisible}
          />
          <span className="mp-row__toggle-text">Featured</span>
        </label>
      </div>
    </div>
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

const ToggleSwitch: React.FC<{
  checked: boolean; onChange: () => void; label: string; disabled?: boolean
}> = ({ checked, onChange, label, disabled }) => (
  <button
    role="switch"
    aria-checked={checked}
    aria-label={label}
    type="button"
    className={`mp-toggle${checked ? ' mp-toggle--on' : ''}${disabled ? ' mp-toggle--disabled' : ''}`}
    onClick={disabled ? undefined : onChange}
    disabled={disabled}
  >
    <span className="mp-toggle__thumb" />
  </button>
)

// ── Preview overlay ───────────────────────────────────────────────────────────

const PreviewOverlay: React.FC<{
  products: Product[]
  onClose: () => void
}> = ({ products, onClose }) => {
  const visible = products.filter((p) => p.isVisible)

  return (
    <div className="mp-preview-backdrop" onClick={onClose}>
      <div className="mp-preview" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Customer catalog preview">
        <div className="mp-preview__header">
          <div>
            <h2 className="mp-preview__title">Customer Catalog Preview</h2>
            <p className="mp-preview__sub">Showing how customers see the catalog with current (unsaved) order.</p>
          </div>
          <button className="mp-preview__close" onClick={onClose} aria-label="Close preview">✕</button>
        </div>
        <div className="mp-preview__body">
          {visible.length === 0 ? (
            <div className="mp-preview__empty">No visible products.</div>
          ) : (
            visible.map((p) => (
              <div key={p.id} className="mp-preview__card">
                {p.isFeatured && <span className="mp-preview__badge">Popular</span>}
                <div className="mp-preview__card-name">{p.name}</div>
                {p.sizeLabel && <div className="mp-preview__card-size">{p.sizeLabel}</div>}
                {p.description && <div className="mp-preview__card-desc">{p.description}</div>}
                <div className="mp-preview__card-price">{fmt(p.basePrice)} / {p.unit}</div>
                <button className="mp-preview__add-btn" disabled>Add to Order</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const MerchandisingPanel: React.FC = () => {
  const [rows, setRows]               = useState<Product[]>([])
  const [loading, setLoading]         = useState(true)
  const [dirty, setDirty]             = useState<Set<string>>(new Set())
  const [publishing, setPublishing]   = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [publishMsg, setPublishMsg]   = useState('')

  const dragIndex = useRef<number>(-1)
  const overIndex = useRef<number>(-1)
  const [draggingIdx, setDraggingIdx] = useState(-1)
  const [overIdx, setOverIdx]         = useState(-1)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeToProducts(
      (ps) => { setRows(ps.filter((p) => p.isVisible || true)); setLoading(false) },
      () => setLoading(false),
    )
    return unsub
  }, [])

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((index: number) => {
    dragIndex.current = index
    setDraggingIdx(index)
  }, [])

  const handleDragOver = useCallback((index: number) => {
    overIndex.current = index
    setOverIdx(index)
  }, [])

  const handleDrop = useCallback(() => {
    const from = dragIndex.current
    const to   = overIndex.current
    if (from < 0 || to < 0 || from === to) {
      setDraggingIdx(-1); setOverIdx(-1); return
    }
    setRows((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      // Mark all items in range as dirty (their sort_order changed)
      const lo = Math.min(from, to)
      const hi = Math.max(from, to)
      setDirty((d) => {
        const nd = new Set(d)
        for (let i = lo; i <= hi; i++) nd.add(next[i].id)
        return nd
      })
      return next
    })
    dragIndex.current = -1
    overIndex.current = -1
    setDraggingIdx(-1)
    setOverIdx(-1)
  }, [])

  // ── Keyboard reorder ───────────────────────────────────────────────────────

  const moveRow = useCallback((index: number, direction: 'up' | 'down') => {
    setRows((prev) => {
      const next = [...prev]
      const swapIdx = direction === 'up' ? index - 1 : index + 1
      if (swapIdx < 0 || swapIdx >= next.length) return prev
      const temp = next[index]
      next[index] = next[swapIdx]
      next[swapIdx] = temp
      setDirty((d) => {
        const nd = new Set(d)
        nd.add(next[index].id)
        nd.add(next[swapIdx].id)
        return nd
      })
      return next
    })
  }, [])

  // ── Toggle visibility / featured ───────────────────────────────────────────

  async function handleToggleVisible(id: string) {
    const p = rows.find((r) => r.id === id)
    if (!p) return
    if (!p.isVisible) {
      if (!confirm(`Make "${p.name}" visible to customers?`)) return
    }
    const newVal = !p.isVisible
    await updateProduct(id, { isVisible: newVal, ...(newVal === false ? { isFeatured: false } : {}) })
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, isVisible: newVal, isFeatured: newVal ? r.isFeatured : false } : r))
  }

  async function handleToggleFeatured(id: string) {
    const p = rows.find((r) => r.id === id)
    if (!p) return
    const newVal = !p.isFeatured
    await updateProduct(id, { isFeatured: newVal })
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, isFeatured: newVal } : r))
  }

  // ── Publish changes ────────────────────────────────────────────────────────

  async function handlePublish() {
    if (dirty.size === 0) { setPublishMsg('No changes to publish.'); return }
    setPublishing(true)
    setPublishMsg('')
    try {
      const updates = rows.map((p, i) => ({ id: p.id, sortOrder: (i + 1) * 10 }))
      await batchUpdateSortOrder(updates)
      setDirty(new Set())
      setPublishMsg(`✓ Published — ${updates.length} products reordered.`)
    } catch {
      setPublishMsg('Error publishing changes. Please try again.')
    } finally {
      setPublishing(false)
    }
  }

  const visibleCount = rows.filter((r) => r.isVisible).length

  return (
    <div className="mp-page">
      {/* Header */}
      <div className="mp-header">
        <div className="mp-header__left">
          <h1 className="mp-title">Merchandising</h1>
          <p className="mp-subtitle">{visibleCount} visible to customers · drag rows or use ▲▼ to reorder</p>
        </div>
        <div className="mp-header__actions">
          <Button variant="secondary" onClick={() => setShowPreview(true)} size="sm">
            Preview as Customer
          </Button>
          <Button
            onClick={handlePublish}
            disabled={publishing || dirty.size === 0}
            size="sm"
          >
            {publishing ? 'Publishing…' : `Publish Changes${dirty.size > 0 ? ` (${dirty.size})` : ''}`}
          </Button>
        </div>
      </div>

      {publishMsg && (
        <div className={`mp-msg${publishMsg.startsWith('Error') ? ' mp-msg--error' : ''}`}>
          {publishMsg}
        </div>
      )}

      <div className="mp-legend">
        <span className="mp-legend__item"><span className="mp-legend__dot mp-legend__dot--visible" />Visible</span>
        <span className="mp-legend__item"><span className="mp-legend__dot mp-legend__dot--hidden" />Hidden</span>
        <span className="mp-legend__item"><span className="mp-legend__badge">Popular</span> Featured badge</span>
        {dirty.size > 0 && <span className="mp-legend__item mp-legend__dirty">● {dirty.size} unsaved position change{dirty.size !== 1 ? 's' : ''}</span>}
      </div>

      {/* List */}
      {loading ? (
        <div className="mp-loading">Loading products…</div>
      ) : rows.length === 0 ? (
        <div className="mp-empty">No products found. Add products in the Price List.</div>
      ) : (
        <div
          className="mp-list"
          role="list"
          aria-label="Product order"
          onDragLeave={() => setOverIdx(-1)}
          onDragEnd={() => { setDraggingIdx(-1); setOverIdx(-1) }}
        >
          {rows.map((p, i) => (
            <MerchRow
              key={p.id}
              product={p}
              index={i}
              total={rows.length}
              isDragging={draggingIdx === i}
              isOver={overIdx === i && draggingIdx !== i}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onMoveUp={(idx) => moveRow(idx, 'up')}
              onMoveDown={(idx) => moveRow(idx, 'down')}
              onToggleVisible={handleToggleVisible}
              onToggleFeatured={handleToggleFeatured}
              dirty={dirty.has(p.id)}
            />
          ))}
        </div>
      )}

      {showPreview && (
        <PreviewOverlay products={rows} onClose={() => setShowPreview(false)} />
      )}
    </div>
  )
}

export default MerchandisingPanel
