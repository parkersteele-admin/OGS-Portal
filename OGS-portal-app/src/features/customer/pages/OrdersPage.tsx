/**
 * src/pages/customer/OrdersPage.tsx
 *
 * Customer portal — Order command center
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDocs, query, where } from 'firebase/firestore'
import { CheckCircle, FileText, Send, type LucideIcon } from 'lucide-react'
import { productsCol, invoicesCol } from '../../../lib/firestore'
import { useAuth } from '../../../hooks/useAuth'
import { useCustomer } from '../../../hooks/queries'
import { getOrders, getRouteSchedule, addOnToNextDelivery } from '../../../services/orderService'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import type { Order, OrderStatus, DeliveryTier, OrderType, RouteSchedule } from '../../../types/order'
import type { Invoice } from '../../../types/billing'
import type { Product } from '../../../types/product'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import './Orders.css'

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function toDate(ts: { toDate?: () => Date } | null | undefined): Date | null {
  return ts?.toDate?.() ?? null
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getOrderStatusLabel(order: Order): string {
  if (order.status === 'delivered' && order.deliveryStatus === 'signed') {
    return 'Delivered / Signed'
  }
  return STATUS_LABEL[order.status]
}

type BadgeVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const STATUS_VARIANT: Record<OrderStatus, BadgeVariant> = {
  pending: 'warning',
  scheduled: 'info',
  assigned: 'info',
  'in-transit': 'brand',
  in_transit: 'brand',
  delivered: 'success',
  invoice_sent_pending: 'warning',
  ready_to_invoice: 'warning',
  invoice_sent: 'info',
  paid: 'success',
  cancelled: 'danger',
  archived: 'neutral',
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  'in-transit': 'In Transit',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  invoice_sent_pending: 'Invoice Pending',
  ready_to_invoice: 'Ready to Invoice',
  invoice_sent: 'Invoice Sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
  archived: 'Archived',
}

const STATUS_ICON: Record<OrderStatus, LucideIcon> = {
  pending: FileText,
  scheduled: FileText,
  assigned: FileText,
  'in-transit': Send,
  in_transit: Send,
  delivered: CheckCircle,
  invoice_sent_pending: FileText,
  ready_to_invoice: FileText,
  invoice_sent: Send,
  paid: CheckCircle,
  cancelled: CheckCircle,
  archived: CheckCircle,
}

const STATUS_ICON_COLOR: Record<OrderStatus, string> = {
  pending: '#92400e',
  scheduled: '#1e40af',
  assigned: '#3730a3',
  'in-transit': '#9d174d',
  in_transit: '#9d174d',
  delivered: '#065f46',
  invoice_sent_pending: '#FF6A00',
  ready_to_invoice: '#FF6A00',
  invoice_sent: '#0066FF',
  paid: '#065f46',
  cancelled: '#6b7280',
  archived: '#6b7280',
}

function renderOrderStatus(order: Order) {
  const Icon = STATUS_ICON[order.status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon size={12} aria-hidden="true" style={{ color: STATUS_ICON_COLOR[order.status] }} />
      <span>{getOrderStatusLabel(order)}</span>
    </span>
  )
}

const TIER_LABEL: Record<DeliveryTier, string> = {
  standard: 'Standard',
  'next-day': 'Next Day',
  'same-day': 'Same Day',
}

const TIER_VARIANT: Record<DeliveryTier, BadgeVariant> = {
  standard: 'neutral',
  'next-day': 'warning',
  'same-day': 'danger',
}

const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  route:    'Standing',
  offRoute: 'Will-Call',
  addOn:    'Add-On',
}

const ORDER_TYPE_STYLE: Record<OrderType, React.CSSProperties> = {
  route:    { background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' },
  offRoute: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  addOn:    { background: 'var(--color-brand-light)', color: 'var(--color-brand)', border: '1px solid var(--color-brand-border)' },
}

const TIMELINE_STEPS: OrderStatus[] = [
  'pending', 'scheduled', 'in_transit', 'delivered', 'invoice_sent_pending', 'invoice_sent', 'paid',
]

function timelineState(current: OrderStatus, step: OrderStatus): 'done' | 'active' | 'upcoming' {
  if (current === 'cancelled') return 'upcoming'
  const ci = TIMELINE_STEPS.indexOf(current)
  const si = TIMELINE_STEPS.indexOf(step)
  if (si < ci) return 'done'
  if (si === ci) return 'active'
  return 'upcoming'
}

type StatusFilter = 'all' | 'pending' | 'scheduled' | 'delivered' | 'paid' | 'standing'

const FILTER_PILLS: { value: StatusFilter; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'standing',  label: 'Standing' },
  { value: 'pending',   label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'paid',  label: 'Paid' },
]

const PAGE_SIZE = 20

interface DetailPanelProps {
  order: Order
  products: Record<string, string>
  productList: Product[]
  customerId: string
  onClose: () => void
  onReorder: (order: Order) => void
  nextRouteOrderId: string | null
  routeSchedule: RouteSchedule | null
  upcomingRouteDate: Date | null
}

const LinkedInvoiceRow: React.FC<{ order: Order }> = ({ order }) => {
  const navigate = useNavigate()
  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['order-invoice', order.id],
    queryFn: async () => {
      const snap = await getDocs(query(invoicesCol, where('orderId', '==', order.id)))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Invoice))
    },
    staleTime: 2 * 60 * 1000,
    enabled: ['paid'].includes(order.status),
  })

  if (invoices.length === 0) return null

  const inv = invoices[0]
  const unpaid = inv.status === 'sent' || inv.status === 'overdue'

  return (
    <div className="oh-detail__invoice">
      <div className="oh-detail__invoice-row">
        <span className="oh-detail__invoice-num">{inv.invoiceNumber}</span>
        <span className="oh-detail__invoice-amount">{fmtCurrency(inv.total)}</span>
        <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'info'}>
          {inv.status}
        </Badge>
        {unpaid && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate(`/portal/invoices/${inv.id}/pay`)}
          >
            Pay now
          </Button>
        )}
      </div>
    </div>
  )
}

const DetailPanel: React.FC<DetailPanelProps> = ({
  order, products, productList, onClose, onReorder,
  nextRouteOrderId, routeSchedule, upcomingRouteDate,
}) => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const panelRef = useRef<HTMLDivElement>(null)

  // Add-on inline drawer state
  const [showAddOnDrawer, setShowAddOnDrawer] = useState(false)
  const [addOnItems, setAddOnItems] = useState<{ productId: string; qty: number }[]>([])
  const [addOnSaving, setAddOnSaving] = useState(false)
  const [addOnSuccess, setAddOnSuccess] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Visible products (never show Fees)
  const visibleProducts = useMemo(
    () => productList.filter((p) => p.category !== 'Fees' && p.active !== false),
    [productList],
  )

  function toggleAddOnProduct(productId: string) {
    setAddOnItems((prev) => {
      const exists = prev.find((i) => i.productId === productId)
      return exists ? prev.filter((i) => i.productId !== productId) : [...prev, { productId, qty: 1 }]
    })
  }

  function setAddOnQty(productId: string, qty: number) {
    setAddOnItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, qty) } : i)),
    )
  }

  async function handleConfirmAddOns() {
    if (!nextRouteOrderId || addOnItems.length === 0 || !user) return
    setAddOnSaving(true)
    try {
      await addOnToNextDelivery(
        nextRouteOrderId,
        addOnItems.map((i) => ({
          productId: i.productId,
          productName: visibleProducts.find((p) => p.id === i.productId)?.name ?? i.productId,
          qty: i.qty,
          addedBy: user.id,
        })),
        user.id,
      )
      setAddOnSuccess(true)
      setAddOnItems([])
      setTimeout(() => setAddOnSuccess(false), 4000)
      setShowAddOnDrawer(false)
    } catch {
      // error handled inline
    } finally {
      setAddOnSaving(false)
    }
  }

  const productName = products[order.productId] ?? 'Delivery'
  const requestedDate = toDate(order.requestedAt)
  const scheduledDate = toDate(order.scheduledAt)
  const cadenceLabels: Record<string, string> = {
    weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly', custom: 'Custom',
  }

  return (
    <>
      <div className="oh-detail-overlay" onClick={onClose} aria-hidden="true" />
      <div className="oh-detail" ref={panelRef} role="dialog" aria-modal="true" aria-label="Order details">
        <div className="oh-detail__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className="oh-detail__id">#{order.id.slice(0, 8).toUpperCase()}</span>
            <Badge variant={STATUS_VARIANT[order.status]}>{renderOrderStatus(order)}</Badge>
            {order.orderType && (
              <span className="oh-order-type-pill" style={ORDER_TYPE_STYLE[order.orderType]}>
                {ORDER_TYPE_LABEL[order.orderType]}
              </span>
            )}
          </div>
          <button className="oh-detail__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="oh-detail__body">
          <div className="oh-timeline">
            {order.status === 'cancelled' ? (
              <div className="oh-timeline__cancelled">
                <span className="oh-timeline__cancel-dot" />
                Order cancelled
              </div>
            ) : (
              TIMELINE_STEPS.map((step, i) => {
                const state = timelineState(order.status, step)
                return (
                  <React.Fragment key={step}>
                    <div className={`oh-timeline__step oh-timeline__step--${state}`}>
                      <div className="oh-timeline__dot">{state === 'done' ? '✓' : i + 1}</div>
                      <span className="oh-timeline__step-label">
                        {step === 'delivered' && order.deliveryStatus === 'signed'
                          ? 'Delivered / Signed'
                          : STATUS_LABEL[step]}
                      </span>
                    </div>
                    {i < TIMELINE_STEPS.length - 1 && (
                      <div className={`oh-timeline__line oh-timeline__line--${state === 'done' ? 'done' : 'upcoming'}`} />
                    )}
                  </React.Fragment>
                )
              })
            )}
          </div>

          {/* ── Standing Order section ── */}
          {order.orderType === 'route' && routeSchedule && (
            <div className="oh-detail__section oh-detail__section--standing">
              <p className="oh-detail__section-title">Your Standing Order</p>
              <div className="oh-detail__row">
                <span className="oh-detail__label">Cadence</span>
                <span className="oh-detail__value">{cadenceLabels[routeSchedule.cadence] ?? routeSchedule.cadence}</span>
              </div>
              <div className="oh-detail__row">
                <span className="oh-detail__label">Next delivery</span>
                <span className="oh-detail__value">{fmtDate(toDate(routeSchedule.nextDeliveryDate))}</span>
              </div>
              <div className="oh-standing-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate('/portal/order', { state: { orderType: 'route', modifyThisOnly: true, orderId: order.id } })}
                >
                  Modify this delivery
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/portal/order', { state: { orderType: 'route' } })}
                >
                  Change standing order
                </Button>
              </div>
            </div>
          )}

          <div className="oh-detail__section">
            <div className="oh-detail__row">
              <span className="oh-detail__label">Product</span>
              <span className="oh-detail__value">{productName}</span>
            </div>
            <div className="oh-detail__row">
              <span className="oh-detail__label">Quantity</span>
              <span className="oh-detail__value">{order.quantity}</span>
            </div>
            <div className="oh-detail__row">
              <span className="oh-detail__label">Delivery tier</span>
              <span className="oh-detail__value">
                <Badge variant={TIER_VARIANT[order.deliveryTier]}>
                  {TIER_LABEL[order.deliveryTier]}
                  {order.upchargePercent > 0 && ` +${Math.round(order.upchargePercent * 100)}%`}
                </Badge>
              </span>
            </div>
            <div className="oh-detail__row">
              <span className="oh-detail__label">Requested</span>
              <span className="oh-detail__value">{fmtDate(requestedDate)}</span>
            </div>
            {scheduledDate && (
              <div className="oh-detail__row">
                <span className="oh-detail__label">Scheduled</span>
                <span className="oh-detail__value">{fmtDate(scheduledDate)}</span>
              </div>
            )}
            {order.notes && (
              <div className="oh-detail__row">
                <span className="oh-detail__label">Notes</span>
                <span className="oh-detail__value oh-detail__value--notes">{order.notes}</span>
              </div>
            )}
          </div>

          {/* ── Add-On items on this order ── */}
          {order.addOns && order.addOns.length > 0 && (
            <div className="oh-detail__section oh-detail__section--addons">
              <p className="oh-detail__section-title">Add-Ons on this delivery</p>
              {order.addOns.map((ao, i) => (
                <div key={i} className="oh-detail__row">
                  <span className="oh-detail__label">{ao.productName}</span>
                  <span className="oh-detail__value">Qty {ao.qty}</span>
                </div>
              ))}
            </div>
          )}

          <div className="oh-detail__section oh-detail__section--price">
            <div className="oh-detail__row">
              <span className="oh-detail__label">Unit price</span>
              <span className="oh-detail__value">{fmtCurrency(order.unitPrice)}</span>
            </div>
            {order.upchargePercent > 0 && (
              <div className="oh-detail__row">
                <span className="oh-detail__label">Upcharge ({Math.round(order.upchargePercent * 100)}%)</span>
                <span className="oh-detail__value">+{fmtCurrency(order.subtotal - order.unitPrice * order.quantity)}</span>
              </div>
            )}
            <div className="oh-detail__row">
              <span className="oh-detail__label">Delivery fee</span>
              <span className="oh-detail__value">{fmtCurrency(order.deliveryFee)}</span>
            </div>
            <div className="oh-detail__row oh-detail__row--total">
              <span className="oh-detail__label">Total</span>
              <span className="oh-detail__value">{fmtCurrency(order.total)}</span>
            </div>
          </div>

          <LinkedInvoiceRow order={order} />

          {(order.invoicePdfUrl || order.billOfLadingUrl || order.signatureUrl) && (
            <div className="oh-detail__section">
              <p className="oh-detail__section-title">Delivery Documents</p>
              <div className="oh-detail__links">
                {order.invoicePdfUrl && (
                  <a
                    href={order.invoicePdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="oh-detail__doc-link"
                  >
                    Signed invoice
                  </a>
                )}
                {order.billOfLadingUrl && (
                  <a
                    href={order.billOfLadingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="oh-detail__doc-link"
                  >
                    Delivery receipt
                  </a>
                )}
                {order.signatureUrl && (
                  <a
                    href={order.signatureUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="oh-detail__doc-link"
                  >
                    Delivery signature
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ── Add to next delivery inline drawer ── */}
          {nextRouteOrderId && !addOnSuccess && (
            <div className="oh-addon-section">
              {!showAddOnDrawer ? (
                <button className="oh-addon-trigger" onClick={() => setShowAddOnDrawer(true)}>
                  + Add to next delivery ({fmtDate(upcomingRouteDate)})
                </button>
              ) : (
                <div className="oh-addon-drawer">
                  <p className="oh-addon-drawer__title">Add items to your {fmtDate(upcomingRouteDate)} delivery</p>
                  <div className="oh-addon-drawer__list">
                    {visibleProducts.slice(0, 20).map((p) => {
                      const item = addOnItems.find((i) => i.productId === p.id)
                      return (
                        <div key={p.id} className={`oh-addon-row ${item ? 'oh-addon-row--added' : ''}`}>
                          <div className="oh-addon-row__info">
                            <span className="oh-addon-row__name">{p.name}</span>
                            {p.sizeLabel && <span className="oh-addon-row__meta">{p.sizeLabel}</span>}
                          </div>
                          {item && (
                            <div className="oh-addon-row__qty">
                              <button type="button" onClick={() => setAddOnQty(p.id, item.qty - 1)} disabled={item.qty <= 1}>−</button>
                              <span>{item.qty}</span>
                              <button type="button" onClick={() => setAddOnQty(p.id, item.qty + 1)}>+</button>
                            </div>
                          )}
                          <button
                            type="button"
                            className={`oh-addon-row__btn ${item ? 'oh-addon-row__btn--added' : ''}`}
                            onClick={() => toggleAddOnProduct(p.id)}
                          >
                            {item ? '✓ Added' : 'Add'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <div className="oh-addon-drawer__footer">
                    <Button variant="ghost" size="sm" onClick={() => { setShowAddOnDrawer(false); setAddOnItems([]) }}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={addOnItems.length === 0 || addOnSaving}
                      loading={addOnSaving}
                      onClick={handleConfirmAddOns}
                    >
                      Confirm {addOnItems.length > 0 ? `(${addOnItems.length})` : ''}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {addOnSuccess && (
            <div className="oh-addon-success">
              Added to your {fmtDate(upcomingRouteDate)} delivery.
            </div>
          )}
        </div>

        <div className="oh-detail__footer">
          <Button variant="secondary" size="sm" onClick={() => onReorder(order)}>
            Add to order
          </Button>
        </div>
      </div>
    </>
  )
}

interface OrderRowProps {
  order: Order
  products: Record<string, string>
  locationLabel: string
  selected: boolean
  onClick: () => void
  onReorder: () => void
}

const OrderRow: React.FC<OrderRowProps> = ({
  order,
  products,
  locationLabel,
  selected,
  onClick,
  onReorder,
}) => {
  const productName = products[order.productId] ?? 'Delivery'
  const date = toDate(order.scheduledAt) ?? toDate(order.requestedAt)

  return (
    <tr
      className={`oh-tr ${selected ? 'oh-tr--selected' : ''}`}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      aria-label={`Open order ${order.id.slice(0, 8).toUpperCase()}`}
    >
      <td className="oh-td oh-td--mono">#{order.id.slice(0, 8).toUpperCase()}</td>
      <td className="oh-td">
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge variant={STATUS_VARIANT[order.status]}>{renderOrderStatus(order)}</Badge>
          {order.orderType && (
            <span className="oh-order-type-pill" style={ORDER_TYPE_STYLE[order.orderType]}>
              {ORDER_TYPE_LABEL[order.orderType]}
            </span>
          )}
        </div>
      </td>
      <td className="oh-td">
        <div className="oh-cell-product">
          <span className="oh-cell-product__name">{productName}</span>
          <span className="oh-cell-product__meta">
            Qty {order.quantity} · {TIER_LABEL[order.deliveryTier]}
          </span>
        </div>
      </td>
      <td className="oh-td">{fmtDate(date)}</td>
      <td className="oh-td">{locationLabel}</td>
      <td className="oh-td oh-td--actions" onClick={(e) => e.stopPropagation()}>
        <button className="oh-action-btn" onClick={onClick}>Details</button>
        <button className="oh-action-btn oh-action-btn--primary" onClick={onReorder}>Add to order</button>
      </td>
    </tr>
  )
}

const OrdersPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const customerId = user?.companyId ?? user?.customerId ?? null

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Route schedule for the customer
  const { data: routeSchedule = null } = useQuery<RouteSchedule | null>({
    queryKey: ['route-schedule', customerId],
    queryFn:  () => getRouteSchedule(customerId!),
    enabled:  !!customerId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products', 'active'],
    queryFn: async () => {
      const snap = await getDocs(query(productsCol, where('active', '==', true)))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Product))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: customer } = useCustomer(customerId ?? '')

  const locationLabel = useMemo(() => {
    const parts = [customer?.city, customer?.state].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : 'On file'
  }, [customer])

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  )

  const fetchFirst = useCallback(async () => {
    if (!customerId) return
    const filters = {
      customerId,
      // 'standing' filters client-side on orderType; do not pass to server query
      status: (statusFilter === 'all' || statusFilter === 'standing')
        ? undefined
        : statusFilter as OrderStatus,
      scheduledAfter: dateFrom ? new Date(dateFrom) : undefined,
      scheduledBefore: dateTo ? new Date(dateTo) : undefined,
    }
    const page = await getOrders(filters, { pageSize: PAGE_SIZE })
    setAllOrders(page.data)
    setCursor(page.cursor)
    setHasMore(page.hasMore)
    setSelectedId(null)
  }, [customerId, statusFilter, dateFrom, dateTo])

  useEffect(() => { fetchFirst() }, [fetchFirst])

  const handleLoadMore = useCallback(async () => {
    if (!customerId || !cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const filters = {
        customerId,
        status: statusFilter === 'all' ? undefined : statusFilter as OrderStatus,
        scheduledAfter: dateFrom ? new Date(dateFrom) : undefined,
        scheduledBefore: dateTo ? new Date(dateTo) : undefined,
      }
      const page = await getOrders(filters, { pageSize: PAGE_SIZE, after: cursor })
      setAllOrders((prev) => [...prev, ...page.data])
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }, [customerId, cursor, loadingMore, statusFilter, dateFrom, dateTo])

  const filteredOrders = useMemo(() => {
    let base = allOrders
    // Client-side orderType filter for 'standing'
    if (statusFilter === 'standing') {
      base = base.filter((o) => o.orderType === 'route')
    }
    if (!search.trim()) return base
    const q = search.trim().toLowerCase()
    return base.filter(
      (order) =>
        order.id.toLowerCase().includes(q) ||
        (productMap[order.productId] ?? '').toLowerCase().includes(q),
    )
  }, [allOrders, search, productMap, statusFilter])

  const handleReorder = useCallback((order: Order) => {
    navigate('/portal/order', {
      state: {
        reorder: {
          productId: order.productId,
          quantity: order.quantity,
          tier: order.deliveryTier,
          notes: order.notes ?? '',
        },
      },
    })
  }, [navigate])

  const selectedOrder = allOrders.find((order) => order.id === selectedId) ?? null

  // Find the next upcoming route order to target for add-ons
  const nextRouteOrder = useMemo(() => {
    return allOrders
      .filter((o) => o.orderType === 'route' && o.status !== 'cancelled' && o.status !== 'delivered' && o.status !== 'paid')
      .sort((a, b) => (toDate(a.scheduledAt ?? a.requestedAt)?.getTime() ?? 0) - (toDate(b.scheduledAt ?? b.requestedAt)?.getTime() ?? 0))[0] ?? null
  }, [allOrders])

  const upcomingRouteDate = nextRouteOrder
    ? (toDate(nextRouteOrder.scheduledAt) ?? toDate(nextRouteOrder.requestedAt))
    : null

  return (
    <div className={`oh-page ${selectedOrder ? 'oh-page--panel-open' : ''}`}>
      <header className="oh-header">
        <div>
          <h1 className="oh-header__title">My Orders</h1>
          <p className="oh-header__sub">Track fulfillment, review history, and launch repeat orders from one table.</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate('/portal/order')}>
          Place order
        </Button>
      </header>

      <section className="oh-controls" aria-label="Order filters">
        <div className="oh-controls__left">
          {FILTER_PILLS.map(({ value, label }) => (
            <button
              key={value}
              className={`oh-status-btn ${statusFilter === value ? 'oh-status-btn--active' : ''}`}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="oh-controls__right">
          <div className="oh-date-group">
            <input
              type="date"
              className="oh-input"
              aria-label="From date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <input
              type="date"
              className="oh-input"
              aria-label="To date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="oh-search-wrap">
            <svg className="oh-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              className="oh-search"
              placeholder="Search order # or product"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search orders"
            />
          </div>
        </div>
      </section>

      <section className="oh-table-shell" aria-label="Orders table">
        <div className="oh-table-scroll">
          <table className="oh-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Status</th>
                <th>Products</th>
                <th>Delivery date</th>
                <th>Location</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="oh-empty-cell">
                    <div className="oh-empty">
                      <svg className="oh-empty__icon" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <path d="M7 8h10M7 12h10M7 16h6" />
                      </svg>
                      <p className="oh-empty__title">Order queue is clear</p>
                      <p className="oh-empty__sub">
                        {allOrders.length > 0
                          ? 'No orders match the current filters. Adjust the controls or search terms to widen results.'
                          : 'No orders have been submitted yet. Place your first order to start tracking delivery activity here.'}
                      </p>
                      <Button variant="primary" size="md" onClick={() => navigate('/portal/order')}>
                        Place order
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    products={productMap}
                    locationLabel={locationLabel}
                    selected={selectedId === order.id}
                    onClick={() => setSelectedId((prev) => prev === order.id ? null : order.id)}
                    onReorder={() => handleReorder(order)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {hasMore && !search && (
          <div className="oh-load-more">
            <Button variant="ghost" size="sm" loading={loadingMore} onClick={handleLoadMore}>
              Load more orders
            </Button>
          </div>
        )}
      </section>

      {selectedOrder && (
        <DetailPanel
          order={selectedOrder}
          products={productMap}
          productList={products}
          customerId={customerId ?? ''}
          onClose={() => setSelectedId(null)}
          onReorder={handleReorder}
          nextRouteOrderId={nextRouteOrder?.id ?? null}
          routeSchedule={selectedOrder.orderType === 'route' ? routeSchedule : null}
          upcomingRouteDate={upcomingRouteDate}
        />
      )}
    </div>
  )
}

export default OrdersPage
