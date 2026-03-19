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
import { productsCol, invoicesCol } from '../../lib/firestore'
import { useAuth } from '../../hooks/useAuth'
import { useCustomer } from '../../hooks/queries'
import { getOrders } from '../../services/orderService'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { Order, OrderStatus, DeliveryTier } from '../../types/order'
import type { Invoice } from '../../types/billing'
import type { Product } from '../../types/product'
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

type BadgeVariant = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const STATUS_VARIANT: Record<OrderStatus, BadgeVariant> = {
  pending: 'warning',
  scheduled: 'info',
  assigned: 'info',
  'in-transit': 'brand',
  delivered: 'success',
  invoiced: 'info',
  paid: 'success',
  cancelled: 'danger',
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  assigned: 'Assigned',
  'in-transit': 'In Transit',
  delivered: 'Delivered',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
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

const TIMELINE_STEPS: OrderStatus[] = [
  'pending', 'scheduled', 'in-transit', 'delivered', 'invoiced', 'paid',
]

function timelineState(current: OrderStatus, step: OrderStatus): 'done' | 'active' | 'upcoming' {
  if (current === 'cancelled') return 'upcoming'
  const ci = TIMELINE_STEPS.indexOf(current)
  const si = TIMELINE_STEPS.indexOf(step)
  if (si < ci) return 'done'
  if (si === ci) return 'active'
  return 'upcoming'
}

type StatusFilter = 'all' | 'pending' | 'scheduled' | 'delivered' | 'invoiced'

const FILTER_PILLS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'invoiced', label: 'Invoiced' },
]

const PAGE_SIZE = 20

interface DetailPanelProps {
  order: Order
  products: Record<string, string>
  onClose: () => void
  onReorder: (order: Order) => void
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
    enabled: ['invoiced', 'paid'].includes(order.status),
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

const DetailPanel: React.FC<DetailPanelProps> = ({ order, products, onClose, onReorder }) => {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const productName = products[order.productId] ?? 'Delivery'
  const requestedDate = toDate(order.requestedAt)
  const scheduledDate = toDate(order.scheduledAt)

  return (
    <>
      <div className="oh-detail-overlay" onClick={onClose} aria-hidden="true" />
      <div className="oh-detail" ref={panelRef} role="dialog" aria-modal="true" aria-label="Order details">
        <div className="oh-detail__header">
          <div>
            <span className="oh-detail__id">#{order.id.slice(0, 8).toUpperCase()}</span>
            <Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge>
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
                      <span className="oh-timeline__step-label">{STATUS_LABEL[step]}</span>
                    </div>
                    {i < TIMELINE_STEPS.length - 1 && (
                      <div className={`oh-timeline__line oh-timeline__line--${state === 'done' ? 'done' : 'upcoming'}`} />
                    )}
                  </React.Fragment>
                )
              })
            )}
          </div>

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
        </div>

        <div className="oh-detail__footer">
          <Button variant="secondary" size="sm" onClick={() => onReorder(order)}>
            Reorder
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
      <td className="oh-td"><Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge></td>
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
        <button className="oh-action-btn oh-action-btn--primary" onClick={onReorder}>Reorder</button>
      </td>
    </tr>
  )
}

const OrdersPage: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const customerId = user?.customerId ?? null

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [allOrders, setAllOrders] = useState<Order[]>([])
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

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
      status: statusFilter === 'all' ? undefined : statusFilter as OrderStatus,
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
    if (!search.trim()) return allOrders
    const q = search.trim().toLowerCase()
    return allOrders.filter(
      (order) =>
        order.id.toLowerCase().includes(q) ||
        (productMap[order.productId] ?? '').toLowerCase().includes(q),
    )
  }, [allOrders, search, productMap])

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
          onClose={() => setSelectedId(null)}
          onReorder={handleReorder}
        />
      )}
    </div>
  )
}

export default OrdersPage
