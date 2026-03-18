/**
 * src/modules/orders/new/SavedOrdersPanel.tsx
 *
 * Right panel: two tabs — Saved Orders | Reorder Points
 *
 * Saved Orders:
 *   - List of saved templates, sorted by lastUsedAt
 *   - Load (Replace/Merge) and Delete actions
 *
 * Reorder Points:
 *   - List with inline edit for thresholdQty / defaultOrderQty
 *   - "Order Now" adds to line items
 *   - Active toggle
 *   - "Add Reorder Point" form
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  getSavedOrders,
  deleteSavedOrder,
  getReorderPoints,
  saveReorderPoint,
  updateReorderPoint,
} from './orderService'
import { useNewOrderStore } from './useNewOrderStore'
import type { Product } from '../../../types/models'
import type { SavedOrder, ReorderPoint } from './types'
import './SavedOrdersPanel.css'

type PanelTab = 'saved' | 'reorder'

interface SavedOrdersPanelProps {
  customerId: string
  products:   Product[]
  canDelete:  boolean  // admin/sales can delete any template
}

function formatDate(ts: import('firebase/firestore').Timestamp | null | undefined): string {
  if (!ts) return 'Never'
  return ts.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Replace/Merge confirm ─────────────────────────────────────────────────────

interface LoadConfirmProps {
  templateName: string
  onReplace:    () => void
  onMerge:      () => void
  onCancel:     () => void
}

const LoadConfirm: React.FC<LoadConfirmProps> = ({ templateName, onReplace, onMerge, onCancel }) => (
  <div className="sop-confirm">
    <p className="sop-confirm__msg">
      Replace current items with "<strong>{templateName}</strong>", or merge?
    </p>
    <div className="sop-confirm__btns">
      <button className="sop-btn sop-btn--primary" type="button" onClick={onReplace}>Replace</button>
      <button className="sop-btn sop-btn--secondary" type="button" onClick={onMerge}>Merge</button>
      <button className="sop-btn sop-btn--ghost" type="button" onClick={onCancel}>Cancel</button>
    </div>
  </div>
)

// ── Saved Orders tab ──────────────────────────────────────────────────────────

interface SavedOrdersTabProps {
  customerId: string
  canDelete:  boolean
}

const SavedOrdersTab: React.FC<SavedOrdersTabProps> = ({ customerId, canDelete }) => {
  const [templates, setTemplates]   = useState<SavedOrder[]>([])
  const [loading, setLoading]       = useState(true)
  const [loadTarget, setLoadTarget] = useState<SavedOrder | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { lineItems, loadFromTemplate, mergeFromTemplate } = useNewOrderStore()
  const hasItems = lineItems.length > 0

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getSavedOrders(customerId)
      setTemplates(data)
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => { refresh() }, [refresh])

  function handleLoad(template: SavedOrder) {
    if (hasItems) {
      setLoadTarget(template)
    } else {
      loadFromTemplate(template)
    }
  }

  function handleReplace() {
    if (!loadTarget) return
    loadFromTemplate(loadTarget)
    setLoadTarget(null)
  }

  function handleMerge() {
    if (!loadTarget) return
    mergeFromTemplate(loadTarget)
    setLoadTarget(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this saved order template?')) return
    setDeletingId(id)
    try {
      await deleteSavedOrder(customerId, id)
      await refresh()
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="sop-loading">
        {[1, 2, 3].map((i) => <div key={i} className="sop-skeleton" />)}
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <p className="sop-empty">
        No saved orders yet. After building an order, click "Save as Template" to reuse it next time.
      </p>
    )
  }

  return (
    <>
      {loadTarget && (
        <LoadConfirm
          templateName={loadTarget.templateName}
          onReplace={handleReplace}
          onMerge={handleMerge}
          onCancel={() => setLoadTarget(null)}
        />
      )}
      <ul className="sop-list">
        {templates.map((t) => (
          <li key={t.id} className="sop-item">
            <div className="sop-item__info">
              <span className="sop-item__name">{t.templateName}</span>
              <span className="sop-item__meta">
                {t.lineItems.length} item{t.lineItems.length !== 1 ? 's' : ''} · Last used {formatDate(t.lastUsedAt)}
              </span>
            </div>
            <div className="sop-item__actions">
              <button
                className="sop-btn sop-btn--primary sop-btn--sm"
                type="button"
                onClick={() => handleLoad(t)}
              >
                Load
              </button>
              {canDelete && (
                <button
                  className="sop-btn sop-btn--danger sop-btn--sm"
                  type="button"
                  disabled={deletingId === t.id}
                  onClick={() => handleDelete(t.id)}
                >
                  {deletingId === t.id ? '…' : 'Delete'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

// ── Reorder Points tab ────────────────────────────────────────────────────────

interface ReorderPointsTabProps {
  customerId: string
  products:   Product[]
}

const ReorderPointsTab: React.FC<ReorderPointsTabProps> = ({ customerId, products }) => {
  const [points, setPoints]       = useState<ReorderPoint[]>([])
  const [loading, setLoading]     = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editThreshold, setEditThreshold]   = useState(1)
  const [editDefaultQty, setEditDefaultQty] = useState(1)
  const [showAdd, setShowAdd]               = useState(false)
  const [addProductId, setAddProductId]     = useState('')
  const [addThreshold, setAddThreshold]     = useState(1)
  const [addDefaultQty, setAddDefaultQty]   = useState(1)
  const [saving, setSaving]                 = useState(false)

  const { addLineItem, updateLineItemQty } = useNewOrderStore()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getReorderPoints(customerId)
      setPoints(data)
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => { refresh() }, [refresh])

  function handleOrderNow(point: ReorderPoint) {
    const product = products.find((p) => p.id === point.productId)
    if (!product) return
    addLineItem(product)
    // The store always adds qty=1 on addLineItem; update to defaultOrderQty
    const { lineItems } = useNewOrderStore.getState()
    const idx = lineItems.length - 1
    updateLineItemQty(idx, point.defaultOrderQty)
  }

  function startEdit(point: ReorderPoint) {
    setEditingId(point.productId)
    setEditThreshold(point.thresholdQty)
    setEditDefaultQty(point.defaultOrderQty)
  }

  async function saveEdit(point: ReorderPoint) {
    setSaving(true)
    try {
      await updateReorderPoint(customerId, point.productId, {
        thresholdQty:    editThreshold,
        defaultOrderQty: editDefaultQty,
      })
      await refresh()
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(point: ReorderPoint) {
    await updateReorderPoint(customerId, point.productId, { active: !point.active })
    await refresh()
  }

  async function handleAddReorderPoint() {
    const product = products.find((p) => p.id === addProductId)
    if (!product || !addProductId) return
    setSaving(true)
    try {
      await saveReorderPoint(customerId, {
        productId:       product.id,
        sku:             product.sku,
        name:            product.name,
        sizeLabel:       product.sizeLabel ?? '',
        thresholdQty:    addThreshold,
        defaultOrderQty: addDefaultQty,
        active:          true,
      })
      await refresh()
      setShowAdd(false)
      setAddProductId('')
      setAddThreshold(1)
      setAddDefaultQty(1)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="sop-loading">
        {[1, 2, 3].map((i) => <div key={i} className="sop-skeleton" />)}
      </div>
    )
  }

  return (
    <>
      {points.length === 0 && !showAdd ? (
        <p className="sop-empty">
          No reorder points configured. Set up reorder points to get low-stock reminders and one-click reorder.
        </p>
      ) : (
        <ul className="sop-list">
          {points.map((point) => {
            const isEditing = editingId === point.productId
            return (
              <li key={point.productId} className={`sop-item sop-item--rp${!point.active ? ' sop-item--inactive' : ''}`}>
                <div className="sop-item__info">
                  <span className="sop-item__name">{point.name}</span>
                  <span className="sop-item__meta">{point.sizeLabel}</span>
                  {isEditing ? (
                    <div className="sop-rp-edit">
                      <label className="sop-rp-edit__label">
                        Threshold
                        <input
                          className="sop-rp-edit__input"
                          type="number"
                          min={0}
                          value={editThreshold}
                          onChange={(e) => setEditThreshold(Number(e.target.value))}
                        />
                      </label>
                      <label className="sop-rp-edit__label">
                        Default qty
                        <input
                          className="sop-rp-edit__input"
                          type="number"
                          min={1}
                          value={editDefaultQty}
                          onChange={(e) => setEditDefaultQty(Number(e.target.value))}
                        />
                      </label>
                      <button
                        className="sop-btn sop-btn--primary sop-btn--sm"
                        type="button"
                        disabled={saving}
                        onClick={() => saveEdit(point)}
                      >
                        {saving ? '…' : 'Save'}
                      </button>
                      <button
                        className="sop-btn sop-btn--ghost sop-btn--sm"
                        type="button"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span className="sop-rp-meta">
                      Reorder at {point.thresholdQty} · Default qty {point.defaultOrderQty}
                    </span>
                  )}
                </div>
                <div className="sop-item__actions">
                  <button
                    className="sop-btn sop-btn--primary sop-btn--sm"
                    type="button"
                    disabled={!point.active}
                    onClick={() => handleOrderNow(point)}
                  >
                    Order Now
                  </button>
                  {!isEditing && (
                    <button
                      className="sop-btn sop-btn--ghost sop-btn--sm"
                      type="button"
                      onClick={() => startEdit(point)}
                    >
                      Edit
                    </button>
                  )}
                  <label className="sop-toggle" title={point.active ? 'Active' : 'Inactive'}>
                    <input
                      type="checkbox"
                      className="sop-toggle__input"
                      checked={point.active}
                      onChange={() => toggleActive(point)}
                    />
                    <span className="sop-toggle__track" />
                  </label>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Add Reorder Point form */}
      {showAdd ? (
        <div className="sop-add-form">
          <label className="sop-add-form__label">Product</label>
          <select
            className="sop-add-form__select"
            value={addProductId}
            onChange={(e) => setAddProductId(e.target.value)}
          >
            <option value="">Select a product…</option>
            {products.filter((p) => p.isVisible).map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.sizeLabel}</option>
            ))}
          </select>
          <div className="sop-add-form__row">
            <label className="sop-add-form__label">
              Threshold qty
              <input
                className="sop-add-form__input"
                type="number"
                min={0}
                value={addThreshold}
                onChange={(e) => setAddThreshold(Number(e.target.value))}
              />
            </label>
            <label className="sop-add-form__label">
              Default order qty
              <input
                className="sop-add-form__input"
                type="number"
                min={1}
                value={addDefaultQty}
                onChange={(e) => setAddDefaultQty(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="sop-add-form__btns">
            <button
              className="sop-btn sop-btn--primary sop-btn--sm"
              type="button"
              disabled={!addProductId || saving}
              onClick={handleAddReorderPoint}
            >
              {saving ? 'Saving…' : 'Add Reorder Point'}
            </button>
            <button
              className="sop-btn sop-btn--ghost sop-btn--sm"
              type="button"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="sop-add-rp-btn"
          type="button"
          onClick={() => setShowAdd(true)}
        >
          + Add Reorder Point
        </button>
      )}
    </>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export const SavedOrdersPanel: React.FC<SavedOrdersPanelProps> = ({
  customerId,
  products,
  canDelete,
}) => {
  const [tab, setTab] = useState<PanelTab>('saved')

  return (
    <aside className="sop">
      <div className="sop__tabs">
        <button
          className={`sop__tab${tab === 'saved' ? ' sop__tab--active' : ''}`}
          type="button"
          onClick={() => setTab('saved')}
        >
          Saved Orders
        </button>
        <button
          className={`sop__tab${tab === 'reorder' ? ' sop__tab--active' : ''}`}
          type="button"
          onClick={() => setTab('reorder')}
        >
          Reorder Points
        </button>
      </div>

      <div className="sop__content">
        {tab === 'saved' ? (
          <SavedOrdersTab customerId={customerId} canDelete={canDelete} />
        ) : (
          <ReorderPointsTab customerId={customerId} products={products} />
        )}
      </div>
    </aside>
  )
}
