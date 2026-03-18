/**
 * src/modules/orders/new/NewOrderPage.tsx
 *
 * Main New Order page.
 * Route: /orders/new
 *
 * Two-column layout (desktop): left = order entry, right = saved orders panel.
 * Roles:
 *   customer  — sees own account, cannot edit prices
 *   dispatch  — customer selector, can edit prices
 *   admin/sales — same as dispatch + can delete templates
 */

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
} from 'react'
import { useNavigate as _useNavigate, Link } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { useAuth } from '../../../hooks/useAuth'
import { useNewOrderStore } from './useNewOrderStore'
import { OrderLineItems } from './OrderLineItems'
import { SavedOrdersPanel } from './SavedOrdersPanel'
import { RecurringSetup } from './RecurringSetup'
import {
  getVisibleProducts,
  submitNewOrder,
  notifyDispatch,
  saveOrderTemplate,
  checkTemplateNameExists,
  forceUpdateTemplate,
  getSavedOrders,
} from './orderService'
import type { Product } from '../../../types/models'
import type { RecurringSchedule } from './types'
import './NewOrderPage.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultTemplateName(products: Product[], topProductId: string): string {
  const month = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  const product = products.find((p) => p.id === topProductId)
  const gas = product?.category ?? 'Order'
  return `${month} — ${gas} Order`
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastProps { message: string; onDone: () => void }

const Toast: React.FC<ToastProps> = ({ message, onDone }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [onDone])

  return <div className="no-toast">{message}</div>
}

// ── Customer selector (dispatch/admin) ────────────────────────────────────────

interface CustomerSelectorProps {
  value:    string
  onChange: (id: string, name: string) => void
}

const CustomerSelector: React.FC<CustomerSelectorProps> = ({ value, onChange }) => {
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    import('../../../lib/firestore').then(async ({ customersCol }) => {
      const { getDocs, query, orderBy } = await import('firebase/firestore')
      const snap = await getDocs(query(customersCol, orderBy('name')))
      setCustomers(snap.docs.map((d) => ({ id: d.id, name: (d.data() as { name: string }).name })))
      setLoading(false)
    })
  }, [])

  return (
    <div className="no-customer-selector">
      <label className="no-field-label">Customer</label>
      <select
        className="no-select"
        value={value}
        disabled={loading}
        onChange={(e) => {
          const selected = customers.find((c) => c.id === e.target.value)
          if (selected) onChange(selected.id, selected.name)
        }}
      >
        <option value="">Select customer…</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  )
}

// ── Save-as-template popover ──────────────────────────────────────────────────

interface SaveTemplatePopoverProps {
  defaultName:  string
  customerId:   string
  lineItems:    import('./types').LineItem[]
  notes:        string
  onSaved:      (templateId: string, name: string) => void
  onClose:      () => void
}

const SaveTemplatePopover: React.FC<SaveTemplatePopoverProps> = ({
  defaultName, customerId, lineItems, notes, onSaved, onClose,
}) => {
  const [name, setName]               = useState(defaultName)
  const [saving, setSaving]           = useState(false)
  const [conflict, setConflict]       = useState<{ existingId: string } | null>(null)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const existingId = await checkTemplateNameExists(customerId, name.trim())
      if (existingId) {
        setConflict({ existingId })
        setSaving(false)
        return
      }
      const id = await saveOrderTemplate(customerId, name.trim(), lineItems, notes)
      onSaved(id, name.trim())
    } catch {
      setSaving(false)
    }
  }

  async function handleUpdate() {
    if (!conflict) return
    setSaving(true)
    try {
      await forceUpdateTemplate(customerId, conflict.existingId, name.trim(), lineItems, notes)
      onSaved(conflict.existingId, name.trim())
    } catch {
      setSaving(false)
    }
  }

  async function handleSaveAsNew() {
    setConflict(null)
    setSaving(true)
    try {
      const id = await saveOrderTemplate(customerId, name.trim() + ' (copy)', lineItems, notes)
      onSaved(id, name.trim() + ' (copy)')
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="no-popover">
      {conflict ? (
        <>
          <p className="no-popover__conflict">
            A template named "<strong>{name}</strong>" already exists.
          </p>
          <div className="no-popover__row">
            <button className="no-popover__btn no-popover__btn--primary" onClick={handleUpdate} disabled={saving}>
              {saving ? 'Updating…' : 'Update existing'}
            </button>
            <button className="no-popover__btn no-popover__btn--secondary" onClick={handleSaveAsNew} disabled={saving}>
              Save as new
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="no-popover__label">Template name</label>
          <input
            className="no-popover__input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            autoFocus
          />
          <div className="no-popover__row">
            <button className="no-popover__btn no-popover__btn--primary" onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="no-popover__btn no-popover__btn--ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Success state ─────────────────────────────────────────────────────────────

interface SuccessStateProps {
  orderId:  string
  onNew:    () => void
}

const SuccessState: React.FC<SuccessStateProps> = ({ orderId, onNew }) => (
  <div className="no-success">
    <div className="no-success__card">
      <div className="no-success__check">✓</div>
      <h2 className="no-success__title">Order submitted</h2>
      <p className="no-success__body">
        Your OGS team has been notified.
      </p>
      <p className="no-success__id">Order #{orderId.slice(-8).toUpperCase()}</p>
      <div className="no-success__actions">
        <button className="no-success__btn no-success__btn--primary" onClick={onNew}>
          Start New Order
        </button>
        <Link className="no-success__btn no-success__btn--ghost" to={`/portal/orders`}>
          View Orders
        </Link>
      </div>
    </div>
  </div>
)

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewOrderPage() {
  const { user, isCustomer, isDispatch, isAdmin, isSales } = useAuth()

  // Determine customer context
  const isStaff = isDispatch || isAdmin || isSales
  const [selectedCustomerId,   setSelectedCustomerId]   = useState<string>(user?.customerId ?? '')
  const [selectedCustomerName, setSelectedCustomerName] = useState<string>(user?.name ?? '')

  const store = useNewOrderStore()
  const {
    lineItems, notes, requestedDeliveryDate,
    isRecurring, recurringSchedule,
    currentTemplateId, isDirty,
    setNotes, setDeliveryDate, setRecurringSchedule,
    setCurrentTemplateId, resetOrder,
  } = store

  const [products, setProducts]               = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [submitting, setSubmitting]           = useState(false)
  const [submitError, setSubmitError]         = useState<string | null>(null)
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null)

  const [showRecurring, setShowRecurring]   = useState(false)
  const [showSavePopover, setShowSavePopover] = useState(false)
  const [toast, setToast]                   = useState<string | null>(null)

  const savePopoverRef = useRef<HTMLDivElement>(null)

  const canEditPrice = isStaff
  const canDelete    = isAdmin || isSales
  const customerId   = isCustomer ? (user?.customerId ?? '') : selectedCustomerId
  const customerName = isCustomer ? (user?.name ?? '') : selectedCustomerName

  // Load products once
  useEffect(() => {
    getVisibleProducts()
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setProductsLoading(false))
  }, [])

  // isDirty navigation guard
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty && lineItems.length > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty, lineItems.length])

  // Close save popover on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (savePopoverRef.current && !savePopoverRef.current.contains(e.target as Node)) {
        setShowSavePopover(false)
      }
    }
    if (showSavePopover) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSavePopover])

  const subtotal = useMemo(
    () => lineItems.reduce((sum, li) => sum + li.lineTotal, 0),
    [lineItems],
  )

  const defaultTplName = useMemo(() => {
    const topId = lineItems[0]?.productId ?? ''
    return defaultTemplateName(products, topId)
  }, [lineItems, products])

  // ── Validate ────────────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!customerId) return 'Please select a customer.'
    if (lineItems.length === 0) return 'Add at least one product.'
    if (lineItems.some((li) => !li.productId)) return 'All lines must have a product selected.'
    if (lineItems.some((li) => li.qty <= 0)) return 'All quantities must be greater than 0.'
    return null
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    const err = validate()
    if (err) { setSubmitError(err); return }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const orderId = await submitNewOrder({
        customerId,
        customerName,
        status:                 'submitted',
        lineItems,
        notes,
        requestedDeliveryDate:  requestedDeliveryDate
          ? Timestamp.fromDate(requestedDeliveryDate)
          : null,
        isRecurring,
        recurringSchedule:      recurringSchedule ?? null,
        savedAsTemplate:        currentTemplateId !== null,
        templateName:           null,
        createdBy:              user?.id ?? '',
        submittedAt:            null,
      })

      // Update template usage if loaded from one
      if (currentTemplateId && customerId) {
        const templates = await getSavedOrders(customerId)
        const tpl = templates.find((t) => t.id === currentTemplateId)
        if (tpl) {
          const { updateTemplateUsage } = await import('./orderService')
          await updateTemplateUsage(customerId, currentTemplateId, tpl.useCount)
        }
      }

      // Notify dispatch
      await notifyDispatch({
        orderId,
        customerId,
        customerName,
        total:     subtotal,
        createdBy: user?.id ?? '',
      })

      setSubmittedOrderId(orderId)
      resetOrder()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to submit order.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Template saved ──────────────────────────────────────────────────────────

  function handleTemplateSaved(id: string, name: string) {
    setCurrentTemplateId(id)
    setShowSavePopover(false)
    setToast(`Order saved as template "${name}"`)
  }

  // ── Recurring saved ─────────────────────────────────────────────────────────

  function handleRecurringSaved(schedule: RecurringSchedule) {
    setRecurringSchedule(schedule)
    setShowRecurring(false)
    setToast('Recurring schedule saved')
  }

  // ── Success screen ──────────────────────────────────────────────────────────

  if (submittedOrderId) {
    return (
      <SuccessState
        orderId={submittedOrderId}
        onNew={() => {
          setSubmittedOrderId(null)
          resetOrder()
        }}
      />
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="no-page">
      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      {/* Recurring modal */}
      <RecurringSetup
        open={showRecurring}
        current={recurringSchedule}
        onSave={handleRecurringSaved}
        onCancel={() => setShowRecurring(false)}
      />

      {/* ── Page header ──────────────────────────────────────────── */}
      <div className="no-header">
        <div className="no-header__left">
          <h1 className="no-header__title">New Order</h1>
          {isCustomer && customerName && (
            <p className="no-header__customer">{customerName}</p>
          )}
        </div>
        <p className="no-header__date">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
      </div>

      {/* ── Two-column layout ─────────────────────────────────── */}
      <div className="no-layout">

        {/* ── Left column ──────────────────────────────────────── */}
        <div className="no-main">

          {/* Customer selector (staff only) */}
          {isStaff && (
            <div className="no-section">
              <CustomerSelector
                value={selectedCustomerId}
                onChange={(id, name) => {
                  setSelectedCustomerId(id)
                  setSelectedCustomerName(name)
                }}
              />
            </div>
          )}

          {/* Delivery date + notes */}
          <div className="no-meta-row">
            <div className="no-field">
              <label className="no-field-label">Requested Delivery Date</label>
              <input
                className="no-input"
                type="date"
                value={requestedDeliveryDate ? requestedDeliveryDate.toISOString().slice(0, 10) : ''}
                min={todayISODate()}
                onChange={(e) =>
                  setDeliveryDate(e.target.value ? new Date(e.target.value + 'T00:00:00') : null)
                }
              />
            </div>
          </div>

          <div className="no-field no-field--notes">
            <label className="no-field-label">Notes</label>
            <textarea
              className="no-textarea"
              rows={3}
              placeholder="Delivery instructions, dock info, contact on-site…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Line items */}
          <div className="no-section no-section--table">
            <h2 className="no-section-title">Products</h2>
            {productsLoading ? (
              <div className="no-products-loading">Loading products…</div>
            ) : (
              <OrderLineItems products={products} canEditPrice={canEditPrice} />
            )}
          </div>

          {/* Error */}
          {submitError && (
            <div className="no-error" role="alert">
              {submitError}
              <button className="no-error__close" onClick={() => setSubmitError(null)}>×</button>
            </div>
          )}

          {/* Action bar */}
          <div className="no-action-bar">
            <div className="no-action-bar__left">
              {/* Save as Template */}
              <div className="no-popover-anchor" ref={savePopoverRef}>
                <button
                  className="no-action-btn no-action-btn--secondary"
                  type="button"
                  disabled={lineItems.length === 0}
                  onClick={() => setShowSavePopover((v) => !v)}
                >
                  Save as Template
                </button>
                {showSavePopover && lineItems.length > 0 && (
                  <SaveTemplatePopover
                    defaultName={defaultTplName}
                    customerId={customerId}
                    lineItems={lineItems}
                    notes={notes}
                    onSaved={handleTemplateSaved}
                    onClose={() => setShowSavePopover(false)}
                  />
                )}
              </div>

              {/* Set Up Recurring */}
              <button
                className={`no-action-btn no-action-btn--secondary${isRecurring ? ' no-action-btn--active' : ''}`}
                type="button"
                onClick={() => setShowRecurring(true)}
              >
                {isRecurring ? '↻ Recurring: On' : 'Set Up Recurring'}
              </button>
            </div>

            <div className="no-action-bar__right">
              {subtotal > 0 && (
                <span className="no-action-bar__subtotal">{formatCurrency(subtotal)}</span>
              )}
              <button
                className="no-action-btn no-action-btn--primary"
                type="button"
                disabled={submitting || lineItems.length === 0 || (!customerId && isStaff)}
                onClick={handleSubmit}
              >
                {submitting ? 'Submitting…' : 'Submit Order'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right panel ──────────────────────────────────────── */}
        {customerId && (
          <div className="no-sidebar">
            <SavedOrdersPanel
              customerId={customerId}
              products={products}
              canDelete={canDelete}
            />
          </div>
        )}
      </div>
    </div>
  )
}
