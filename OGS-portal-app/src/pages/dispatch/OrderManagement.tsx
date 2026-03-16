/**
 * src/pages/dispatch/OrderManagement.tsx
 * BEM prefix: om-
 *
 * Internal ops order management page at /ops/orders.
 *
 * Sections:
 *   1. Filter/search bar (search, status, tier, date range, rush toggle)
 *   2. Orders table with bulk-select + bulk "Add to run" action
 *   3. Order detail slide-in panel
 *   4. Create order modal (customer typeahead, product selector, pricing preview)
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  onSnapshot,
  query,
  orderBy,
  getDocs,
  getDoc,
  doc,
  where,
  collectionGroup,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { ordersCol, productsCol, invoicesCol } from '../../lib/firestore'
import {
  createOrder,
  updateOrder,
  transitionOrderStatus,
  calculateOrderPricing,
  canTransition,
} from '../../services/orderService'
import { subscribeToCustomers } from '../../services/customerService'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import type { Order, OrderStatus, DeliveryTier } from '../../types/order'
import type { Customer } from '../../types/customer'
import type { Product } from '../../types/product'
import type { Invoice } from '../../types/billing'
import './OrderManagement.css'

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending:    'Pending',
  scheduled:  'Scheduled',
  assigned:   'Assigned',
  'in-transit': 'In Transit',
  delivered:  'Delivered',
  invoiced:   'Invoiced',
  paid:       'Paid',
  cancelled:  'Cancelled',
}

const TIER_LABELS: Record<DeliveryTier, string> = {
  standard:  'Standard',
  'next-day': 'Next Day',
  'same-day': 'Same Day',
}

const RUSH_TIERS: DeliveryTier[] = ['next-day', 'same-day']

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(n)
}

function fmtDate(
  ts: { toDate?: () => Date } | null | undefined,
): string {
  if (!ts?.toDate) return '—'
  return ts.toDate().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function isRush(order: Order): boolean {
  return RUSH_TIERS.includes(order.deliveryTier)
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`om-badge om-badge--${status}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

// ── Tier badge ─────────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: DeliveryTier }) {
  return (
    <span className={`om-tier om-tier--${tier.replace('-', '')}`}>
      {TIER_LABELS[tier]}
    </span>
  )
}

// ── Order Detail Panel ─────────────────────────────────────────────────────────

interface OrderDetailPanelProps {
  order: Order
  customer?: Customer
  product?: Product
  onClose: () => void
  onCancelOrder: (id: string) => void
  onReschedule: (order: Order) => void
}

function OrderDetailPanel({
  order,
  customer,
  product,
  onClose,
  onCancelOrder,
  onReschedule,
}: OrderDetailPanelProps) {
  const navigate = useNavigate()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [runStopInfo, setRunStopInfo] = useState<{
    runNumber: string
    stopOrder: number
  } | null>(null)

  useEffect(() => {
    // Load linked invoice
    if (!order.id) return
    getDocs(
      query(invoicesCol, where('orderId', '==', order.id)),
    ).then((snap) => {
      if (!snap.empty)
        setInvoice({ ...snap.docs[0].data(), id: snap.docs[0].id } as Invoice)
    })
  }, [order.id])

  useEffect(() => {
    // Find the run stop this order is assigned to
    const findRunStop = async () => {
      const stopsQuery = query(
        collectionGroup(db, 'stops'),
        where('orderId', '==', order.id),
      )
      const stopsSnap = await getDocs(stopsQuery)
      if (!stopsSnap.empty) {
        const stopDoc = stopsSnap.docs[0]
        const runId = stopDoc.ref.parent.parent?.id
        if (runId) {
          const runSnap = await getDoc(doc(db, 'runs', runId))
          if (runSnap.exists()) {
            const runData = runSnap.data() as { runNumber?: string }
            setRunStopInfo({
              runNumber: runData.runNumber ?? runId,
              stopOrder: (stopDoc.data() as { order?: number }).order ?? 0,
            })
          }
        }
      }
    }
    findRunStop().catch(() => {})
  }, [order.id])

  // Build status timeline from available timestamps
  const timeline: Array<{ label: string; time: string }> = []
  if (order.requestedAt) {
    timeline.push({ label: 'Order placed', time: fmtDate(order.requestedAt) })
  }
  if (order.scheduledAt) {
    timeline.push({ label: 'Scheduled', time: fmtDate(order.scheduledAt) })
  }
  if (
    order.status === 'assigned' ||
    order.status === 'in-transit' ||
    order.status === 'delivered'
  ) {
    timeline.push({ label: STATUS_LABELS[order.status], time: 'Today' })
  }

  const canCancel = canTransition(order.status, 'cancelled')
  const canEdit =
    order.status === 'pending' || order.status === 'scheduled'

  return (
    <div className="om-panel-overlay" onClick={onClose}>
      <div
        className="om-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Order ${order.id.slice(0, 8).toUpperCase()} details`}
      >
        {/* Header */}
        <div className="om-panel__header">
          <div>
            <div className="om-panel__order-num">
              {order.id.slice(0, 8).toUpperCase()}
            </div>
            {isRush(order) && (
              <span className="om-rush-flag">Rush</span>
            )}
          </div>
          <button
            className="om-panel__close"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        <div className="om-panel__body">
          {/* Customer + product */}
          <section className="om-panel__section">
            <div className="om-panel__row">
              <span className="om-panel__label">Customer</span>
              <span className="om-panel__val">{customer?.name ?? '—'}</span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Address</span>
              <span className="om-panel__val">
                {customer
                  ? `${customer.address}, ${customer.city}, ${customer.state} ${customer.zip}`
                  : '—'}
              </span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Product</span>
              <span className="om-panel__val">
                {product?.name ?? '—'} — {order.quantity} {product?.unit ?? 'gal'}
              </span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Tier</span>
              <span className="om-panel__val">
                <TierBadge tier={order.deliveryTier} />
              </span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Status</span>
              <span className="om-panel__val">
                <StatusBadge status={order.status} />
              </span>
            </div>
          </section>

          {/* Pricing */}
          <section className="om-panel__section om-panel__section--pricing">
            <div className="om-panel__row">
              <span className="om-panel__label">Unit price</span>
              <span className="om-panel__val">{fmtCurrency(order.unitPrice)}</span>
            </div>
            {order.upchargePercent > 0 && (
              <div className="om-panel__row">
                <span className="om-panel__label">Upcharge</span>
                <span className="om-panel__val">
                  {(order.upchargePercent * 100).toFixed(0)}%
                </span>
              </div>
            )}
            <div className="om-panel__row">
              <span className="om-panel__label">Subtotal</span>
              <span className="om-panel__val">{fmtCurrency(order.subtotal)}</span>
            </div>
            <div className="om-panel__row">
              <span className="om-panel__label">Delivery fee</span>
              <span className="om-panel__val">{fmtCurrency(order.deliveryFee)}</span>
            </div>
            <div className="om-panel__row om-panel__row--total">
              <span className="om-panel__label">Total</span>
              <span className="om-panel__val om-panel__val--total">
                {fmtCurrency(order.total)}
              </span>
            </div>
          </section>

          {/* Run assignment */}
          {runStopInfo && (
            <section className="om-panel__section">
              <div className="om-panel__row">
                <span className="om-panel__label">Run</span>
                <span className="om-panel__val">
                  <button
                    className="om-panel__link"
                    onClick={() =>
                      navigate(`/ops/dispatch`, {
                        state: { runId: runStopInfo.runNumber },
                      })
                    }
                  >
                    {runStopInfo.runNumber}
                  </button>{' '}
                  — Stop #{runStopInfo.stopOrder}
                </span>
              </div>
            </section>
          )}

          {/* Delivery evidence */}
          {order.status === 'delivered' && (
            <section className="om-panel__section">
              <div className="om-panel__section-title">Delivery Evidence</div>
              <p className="om-panel__hint">
                Photos and signature are stored on the stop record. View them in
                the driver stop detail.
              </p>
            </section>
          )}

          {/* Linked invoice */}
          {invoice && (
            <section className="om-panel__section">
              <div className="om-panel__section-title">Invoice</div>
              <div className="om-panel__row">
                <span className="om-panel__label">Invoice #</span>
                <span className="om-panel__val">{invoice.invoiceNumber}</span>
              </div>
              <div className="om-panel__row">
                <span className="om-panel__label">Status</span>
                <span className="om-panel__val">{invoice.status}</span>
              </div>
              <div className="om-panel__row">
                <span className="om-panel__label">Total</span>
                <span className="om-panel__val">{fmtCurrency(invoice.total)}</span>
              </div>
            </section>
          )}

          {/* Timeline */}
          <section className="om-panel__section">
            <div className="om-panel__section-title">Timeline</div>
            {timeline.map((t, i) => (
              <div key={i} className="om-timeline-row">
                <div className="om-timeline-dot" />
                <div className="om-timeline-content">
                  <div className="om-timeline-label">{t.label}</div>
                  <div className="om-timeline-time">{t.time}</div>
                </div>
              </div>
            ))}
          </section>

          {/* Notes */}
          {order.notes && (
            <section className="om-panel__section">
              <div className="om-panel__section-title">Notes</div>
              <p className="om-panel__note">{order.notes}</p>
            </section>
          )}
        </div>

        {/* Actions */}
        <div className="om-panel__footer">
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onReschedule(order)}
            >
              Reschedule
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => onCancelOrder(order.id)}
            >
              Cancel Order
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Create Order Modal ─────────────────────────────────────────────────────────

interface CreateOrderModalProps {
  onClose: () => void
  onCreated: () => void
}

function CreateOrderModal({ onClose, onCreated }: CreateOrderModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState(100)
  const [tier, setTier] = useState<DeliveryTier>('standard')
  const [notes, setNotes] = useState('')
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const customerInputRef = useRef<HTMLInputElement>(null)

  // Load products on mount
  useEffect(() => {
    getDocs(query(productsCol, where('active', '==', true), orderBy('name')))
      .then((snap) =>
        setProducts(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Product)),
      )
  }, [])

  // Load customers (subscribe for typeahead)
  useEffect(() => {
    const unsub = subscribeToCustomers(
      { status: 'active' },
      (data) => setCustomers(data),
    )
    return unsub
  }, [])

  // Typeahead filter
  const filteredCustomers = useMemo(() => {
    const lc = customerSearch.toLowerCase()
    if (!lc) return customers.slice(0, 8)
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(lc) ||
          c.city.toLowerCase().includes(lc),
      )
      .slice(0, 8)
  }, [customers, customerSearch])

  // Pricing preview
  const pricing = useMemo(() => {
    if (!selectedProduct) return null
    return calculateOrderPricing(
      quantity,
      selectedProduct.pricePerUnit,
      tier,
    )
  }, [selectedProduct, quantity, tier])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCustomer) return setError('Please select a customer.')
    if (!selectedProduct) return setError('Please select a product.')
    if (quantity <= 0) return setError('Quantity must be greater than 0.')

    setSubmitting(true)
    setError('')
    try {
      await createOrder(
        {
          customerId: selectedCustomer.id,
          productId: selectedProduct.id,
          quantity,
          deliveryTier: tier,
          notes: notes || undefined,
        },
        selectedProduct.pricePerUnit,
      )
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order.')
      setSubmitting(false)
    }
  }

  return (
    <div className="om-overlay" onClick={onClose}>
      <div
        className="om-modal om-modal--lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Create order"
      >
        <div className="om-modal__header">
          <h2 className="om-modal__title">Create Order</h2>
          <button
            className="om-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form className="om-modal__body" onSubmit={handleSubmit} noValidate>
          {error && <div className="om-form-error">{error}</div>}

          {/* Customer typeahead */}
          <div className="om-field">
            <label className="om-field__label">Customer *</label>
            <div className="om-typeahead">
              <input
                ref={customerInputRef}
                className="om-typeahead__input"
                placeholder="Search by name or city…"
                value={selectedCustomer ? selectedCustomer.name : customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value)
                  setSelectedCustomer(null)
                  setShowCustomerDropdown(true)
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() =>
                  setTimeout(() => setShowCustomerDropdown(false), 150)
                }
                autoComplete="off"
              />
              {selectedCustomer && (
                <button
                  type="button"
                  className="om-typeahead__clear"
                  onClick={() => {
                    setSelectedCustomer(null)
                    setCustomerSearch('')
                    customerInputRef.current?.focus()
                  }}
                >
                  ✕
                </button>
              )}
              {showCustomerDropdown && !selectedCustomer && (
                <div className="om-typeahead__dropdown">
                  {filteredCustomers.length === 0 && (
                    <div className="om-typeahead__empty">No customers found</div>
                  )}
                  {filteredCustomers.map((c) => (
                    <div
                      key={c.id}
                      className="om-typeahead__item"
                      onMouseDown={() => {
                        setSelectedCustomer(c)
                        setCustomerSearch('')
                        setShowCustomerDropdown(false)
                      }}
                    >
                      <div className="om-typeahead__item-name">{c.name}</div>
                      <div className="om-typeahead__item-meta">
                        {c.city}, {c.state}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedCustomer && (
              <div className="om-field__hint">
                {selectedCustomer.address}, {selectedCustomer.city},{' '}
                {selectedCustomer.state} {selectedCustomer.zip}
              </div>
            )}
          </div>

          {/* Product */}
          <div className="om-field">
            <label className="om-field__label" htmlFor="create-product">
              Product *
            </label>
            <select
              id="create-product"
              className="om-select"
              value={selectedProduct?.id ?? ''}
              onChange={(e) => {
                const p = products.find((p) => p.id === e.target.value) ?? null
                setSelectedProduct(p)
              }}
              required
            >
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {fmtCurrency(p.pricePerUnit)}/{p.unit}
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div className="om-field">
            <Input
              label={`Quantity${selectedProduct ? ` (${selectedProduct.unit})` : ''} *`}
              id="create-qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              required
            />
          </div>

          {/* Delivery tier */}
          <div className="om-field">
            <label className="om-field__label" htmlFor="create-tier">
              Delivery Tier *
            </label>
            <select
              id="create-tier"
              className="om-select"
              value={tier}
              onChange={(e) => setTier(e.target.value as DeliveryTier)}
            >
              <option value="standard">Standard</option>
              <option value="next-day">Next Day (+10%)</option>
              <option value="same-day">Same Day (+25%)</option>
            </select>
          </div>

          {/* Scheduled date */}
          <div className="om-field">
            <Input
              label="Scheduled Date"
              id="create-date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>

          {/* Notes */}
          <div className="om-field">
            <label className="om-field__label" htmlFor="create-notes">
              Notes
            </label>
            <textarea
              id="create-notes"
              className="om-textarea"
              rows={3}
              placeholder="Special delivery instructions…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Pricing preview */}
          {pricing && (
            <div className="om-pricing-preview">
              <div className="om-pricing-preview__title">Price Preview</div>
              <div className="om-pricing-preview__row">
                <span>Subtotal</span>
                <span>{fmtCurrency(pricing.subtotal)}</span>
              </div>
              {pricing.upchargePercent > 0 && (
                <div className="om-pricing-preview__row om-pricing-preview__row--upcharge">
                  <span>
                    {TIER_LABELS[tier]} upcharge ({(pricing.upchargePercent * 100).toFixed(0)}%)
                  </span>
                  <span>
                    {fmtCurrency(
                      pricing.subtotal * pricing.upchargePercent /
                        (1 + pricing.upchargePercent),
                    )}
                  </span>
                </div>
              )}
              <div className="om-pricing-preview__row">
                <span>Delivery fee</span>
                <span>{fmtCurrency(pricing.deliveryFee)}</span>
              </div>
              <div className="om-pricing-preview__row om-pricing-preview__row--total">
                <span>Total</span>
                <span>{fmtCurrency(pricing.total)}</span>
              </div>
            </div>
          )}

          <div className="om-modal__footer">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Order'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Reschedule Modal ───────────────────────────────────────────────────────────

interface RescheduleModalProps {
  order: Order
  onClose: () => void
  onSaved: () => void
}

function RescheduleModal({ order, onClose, onSaved }: RescheduleModalProps) {
  const [date, setDate] = useState(
    order.scheduledAt?.toDate?.()?.toISOString().slice(0, 10) ??
      new Date().toISOString().slice(0, 10),
  )
  const [notes, setNotes] = useState(order.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setBusy(true)
    setError('')
    try {
      await updateOrder(order.id, {
        scheduledAt: date
          ? (new Date(date) as unknown as Order['scheduledAt'])
          : undefined,
        notes: notes || undefined,
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update order.')
      setBusy(false)
    }
  }

  return (
    <div className="om-overlay" onClick={onClose}>
      <div
        className="om-modal om-modal--sm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Reschedule order"
      >
        <div className="om-modal__header">
          <h2 className="om-modal__title">Reschedule Order</h2>
          <button className="om-modal__close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="om-modal__body">
          {error && <div className="om-form-error">{error}</div>}
          <div className="om-field">
            <Input
              label="New scheduled date"
              id="reschedule-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <div className="om-field">
            <label className="om-field__label" htmlFor="reschedule-notes">
              Notes
            </label>
            <textarea
              id="reschedule-notes"
              className="om-textarea"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="om-modal__footer">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OrderManagement() {
  const navigate = useNavigate()

  // ── Data ──────────────────────────────────────────────────────────────────────
  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [customerMap, setCustomerMap] = useState<Record<string, Customer>>({})
  const [productMap, setProductMap] = useState<Record<string, Product>>({})
  const [ordersLoading, setOrdersLoading] = useState(true)

  // ── Filters ───────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [tierFilter, setTierFilter] = useState<DeliveryTier | 'all'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [rushOnly, setRushOnly] = useState(false)

  // ── Table state ───────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── Panels / modals ───────────────────────────────────────────────────────────
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [rescheduleOrder, setRescheduleOrder] = useState<Order | null>(null)

  // ── Subscribe to all orders ───────────────────────────────────────────────────
  useEffect(() => {
    setOrdersLoading(true)
    const unsub = onSnapshot(
      query(ordersCol, orderBy('requestedAt', 'desc')),
      (snap) => {
        setAllOrders(
          snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Order),
        )
        setOrdersLoading(false)
      },
    )
    return unsub
  }, [])

  // ── Batch-load customer + product docs as new IDs appear ──────────────────────
  const loadedCustomerIds = useRef<Set<string>>(new Set())
  const loadedProductIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const customerIds = [
      ...new Set(allOrders.map((o) => o.customerId)),
    ].filter((id) => !loadedCustomerIds.current.has(id))

    const productIds = [
      ...new Set(allOrders.map((o) => o.productId)),
    ].filter((id) => !loadedProductIds.current.has(id))

    customerIds.forEach((id) => loadedCustomerIds.current.add(id))
    productIds.forEach((id) => loadedProductIds.current.add(id))

    if (customerIds.length) {
      Promise.all(
        customerIds.map((id) =>
          getDoc(doc(db, 'customers', id)).then((s) =>
            s.exists()
              ? ({ id: s.id, ...s.data() } as Customer)
              : null,
          ),
        ),
      ).then((docs) => {
        const map: Record<string, Customer> = {}
        docs.forEach((c) => {
          if (c) map[c.id] = c
        })
        setCustomerMap((prev) => ({ ...prev, ...map }))
      })
    }

    if (productIds.length) {
      Promise.all(
        productIds.map((id) =>
          getDoc(doc(db, 'products', id)).then((s) =>
            s.exists()
              ? ({ id: s.id, ...s.data() } as Product)
              : null,
          ),
        ),
      ).then((docs) => {
        const map: Record<string, Product> = {}
        docs.forEach((p) => {
          if (p) map[p.id] = p
        })
        setProductMap((prev) => ({ ...prev, ...map }))
      })
    }
  }, [allOrders])

  // ── Filtered + sorted orders ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = allOrders

    // Rush-first sort: put rush tiers at the top
    result = [...result].sort((a, b) => {
      const aRush = isRush(a) ? 0 : 1
      const bRush = isRush(b) ? 0 : 1
      if (aRush !== bRush) return aRush - bRush
      // Secondary: requestedAt desc
      return (b.requestedAt?.toDate?.()?.getTime() ?? 0) -
        (a.requestedAt?.toDate?.()?.getTime() ?? 0)
    })

    if (rushOnly) result = result.filter(isRush)

    if (statusFilter !== 'all')
      result = result.filter((o) => o.status === statusFilter)

    if (tierFilter !== 'all')
      result = result.filter((o) => o.deliveryTier === tierFilter)

    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter(
        (o) => (o.scheduledAt?.toDate?.()?.getTime() ?? 0) >= from.getTime(),
      )
    }

    if (dateTo) {
      const to = new Date(dateTo)
      to.setDate(to.getDate() + 1)
      result = result.filter(
        (o) => (o.scheduledAt?.toDate?.()?.getTime() ?? 0) < to.getTime(),
      )
    }

    if (search.trim()) {
      const lc = search.toLowerCase()
      result = result.filter(
        (o) =>
          o.id.toLowerCase().includes(lc) ||
          customerMap[o.customerId]?.name.toLowerCase().includes(lc),
      )
    }

    return result
  }, [allOrders, search, statusFilter, tierFilter, dateFrom, dateTo, rushOnly, customerMap])

  // ── Bulk select ───────────────────────────────────────────────────────────────
  const pendingFiltered = filtered.filter((o) => o.status === 'pending')
  const allPendingSelected =
    pendingFiltered.length > 0 &&
    pendingFiltered.every((o) => selected.has(o.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPendingSelected) {
        pendingFiltered.forEach((o) => next.delete(o.id))
      } else {
        pendingFiltered.forEach((o) => next.add(o.id))
      }
      return next
    })
  }

  function toggleRow(id: string, status: OrderStatus) {
    if (status !== 'pending') return
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Cancel order ──────────────────────────────────────────────────────────────
  async function handleCancel(id: string) {
    if (!confirm('Cancel this order? This cannot be undone.')) return
    try {
      await transitionOrderStatus(id, 'cancelled')
      if (detailOrder?.id === id) setDetailOrder(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel order.')
    }
  }

  // ── Build run from selection ───────────────────────────────────────────────────
  function handleBuildRun() {
    navigate('/ops/runs/new', {
      state: { selectedOrderIds: [...selected] },
    })
  }

  const selectedCount = selected.size

  return (
    <div className="om-page">
      {/* ── Page header ── */}
      <div className="om-page-header">
        <div className="om-page-header__left">
          <h1 className="om-page-header__title">Orders</h1>
          {!ordersLoading && (
            <span className="om-page-header__count">
              {filtered.length} of {allOrders.length}
            </span>
          )}
        </div>
        <div className="om-page-header__actions">
          {selectedCount > 0 && (
            <Button variant="secondary" size="sm" onClick={handleBuildRun}>
              Add {selectedCount} to Run →
            </Button>
          )}
          <Button size="sm" onClick={() => setShowCreate(true)}>
            + Create Order
          </Button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="om-filters">
        {/* Search */}
        <div className="om-filters__search">
          <svg
            className="om-filters__search-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
            <path
              d="M21 21l-4.35-4.35"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            className="om-filters__search-input"
            placeholder="Search customer or order #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="om-filters__search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Status */}
        <select
          className="om-filters__select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}
          aria-label="Filter by status"
        >
          <option value="all">All Statuses</option>
          {(Object.keys(STATUS_LABELS) as OrderStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {/* Tier */}
        <select
          className="om-filters__select"
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as DeliveryTier | 'all')}
          aria-label="Filter by delivery tier"
        >
          <option value="all">All Tiers</option>
          {(Object.keys(TIER_LABELS) as DeliveryTier[]).map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
        </select>

        {/* Date range */}
        <div className="om-filters__dates">
          <input
            type="date"
            className="om-filters__date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="From date"
          />
          <span className="om-filters__date-sep">–</span>
          <input
            type="date"
            className="om-filters__date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="To date"
          />
        </div>

        {/* Rush toggle */}
        <label className="om-filters__toggle">
          <input
            type="checkbox"
            className="om-filters__toggle-input"
            checked={rushOnly}
            onChange={(e) => setRushOnly(e.target.checked)}
          />
          <span className="om-filters__toggle-track" />
          <span className="om-filters__toggle-label">Rush only</span>
        </label>
      </div>

      {/* ── Table ── */}
      <div className="om-table-wrap">
        {ordersLoading ? (
          <div className="om-empty">Loading orders…</div>
        ) : filtered.length === 0 ? (
          <div className="om-empty">No orders match the current filters.</div>
        ) : (
          <table className="om-table">
            <thead>
              <tr>
                <th className="om-table__th om-table__th--check">
                  <input
                    type="checkbox"
                    checked={allPendingSelected}
                    onChange={toggleAll}
                    title="Select all pending"
                    aria-label="Select all pending orders"
                    disabled={pendingFiltered.length === 0}
                  />
                </th>
                <th className="om-table__th">Order #</th>
                <th className="om-table__th">Customer</th>
                <th className="om-table__th">Product / Qty</th>
                <th className="om-table__th">Tier</th>
                <th className="om-table__th">Scheduled</th>
                <th className="om-table__th">Status</th>
                <th className="om-table__th om-table__th--right">Total</th>
                <th className="om-table__th om-table__th--actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const rush = isRush(order)
                const isCancelled = order.status === 'cancelled'
                const canSel = order.status === 'pending'
                const cust = customerMap[order.customerId]
                const prod = productMap[order.productId]
                const isSelected = selected.has(order.id)

                return (
                  <tr
                    key={order.id}
                    className={[
                      'om-table__row',
                      rush ? 'om-table__row--rush' : '',
                      isCancelled ? 'om-table__row--cancelled' : '',
                      isSelected ? 'om-table__row--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setDetailOrder(order)}
                  >
                    <td
                      className="om-table__td om-table__td--check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(order.id, order.status)}
                        disabled={!canSel}
                        aria-label={`Select order ${order.id.slice(0, 8)}`}
                      />
                    </td>

                    <td className="om-table__td">
                      <span className="om-order-num">
                        {order.id.slice(0, 8).toUpperCase()}
                      </span>
                      {rush && !isCancelled && (
                        <span className="om-rush-pip" title="Rush order" />
                      )}
                    </td>

                    <td className="om-table__td">
                      <div className="om-customer-name">
                        {cust?.name ?? order.customerId.slice(0, 10) + '…'}
                      </div>
                      {cust && (
                        <div className="om-customer-city">
                          {cust.city}, {cust.state}
                        </div>
                      )}
                    </td>

                    <td className="om-table__td">
                      <div>{prod?.name ?? '—'}</div>
                      <div className="om-qty">
                        {order.quantity} {prod?.unit ?? 'gal'}
                      </div>
                    </td>

                    <td className="om-table__td">
                      <TierBadge tier={order.deliveryTier} />
                    </td>

                    <td className="om-table__td">
                      {fmtDate(order.scheduledAt)}
                    </td>

                    <td className="om-table__td">
                      <StatusBadge status={order.status} />
                    </td>

                    <td className="om-table__td om-table__td--right om-total">
                      {fmtCurrency(order.total)}
                    </td>

                    <td
                      className="om-table__td om-table__td--actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* View */}
                      <button
                        className="om-action-btn"
                        title="View detail"
                        onClick={() => setDetailOrder(order)}
                        aria-label="View order detail"
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <path
                            d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </button>

                      {/* Edit / reschedule */}
                      {(order.status === 'pending' ||
                        order.status === 'scheduled') && (
                        <button
                          className="om-action-btn"
                          title="Reschedule"
                          onClick={(e) => {
                            e.stopPropagation()
                            setRescheduleOrder(order)
                          }}
                          aria-label="Reschedule order"
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}

                      {/* Cancel */}
                      {order.status === 'pending' && (
                        <button
                          className="om-action-btn om-action-btn--danger"
                          title="Cancel order"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCancel(order.id)
                          }}
                          aria-label="Cancel order"
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <path
                              d="M15 9l-6 6M9 9l6 6"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Order detail panel ── */}
      {detailOrder && (
        <OrderDetailPanel
          order={detailOrder}
          customer={customerMap[detailOrder.customerId]}
          product={productMap[detailOrder.productId]}
          onClose={() => setDetailOrder(null)}
          onCancelOrder={(id) => {
            handleCancel(id)
            setDetailOrder(null)
          }}
          onReschedule={(order) => {
            setDetailOrder(null)
            setRescheduleOrder(order)
          }}
        />
      )}

      {/* ── Create order modal ── */}
      {showCreate && (
        <CreateOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {}}
        />
      )}

      {/* ── Reschedule modal ── */}
      {rescheduleOrder && (
        <RescheduleModal
          order={rescheduleOrder}
          onClose={() => setRescheduleOrder(null)}
          onSaved={() => {}}
        />
      )}
    </div>
  )
}
