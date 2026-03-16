/**
 * src/pages/customer/OrdersPage.tsx
 *
 * Customer portal — Order History
 *
 * • Filter bar: status pills, date range, search
 * • Paginated order list (20 per page, "Load more")
 * • Slide-in detail panel: full details, status timeline, linked invoice
 * • Reorder: navigates to /portal/order with pre-filled wizard state
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
import { getOrders } from '../../services/orderService'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { Order, OrderStatus, DeliveryTier } from '../../types/order'
import type { Invoice } from '../../types/billing'
import type { Product } from '../../types/product'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import './Orders.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  pending:      'warning',
  scheduled:    'info',
  assigned:     'info',
  'in-transit': 'brand',
  delivered:    'success',
  invoiced:     'info',
  paid:         'success',
  cancelled:    'danger',
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending:      'Pending',
  scheduled:    'Scheduled',
  assigned:     'Assigned',
  'in-transit': 'In Transit',
  delivered:    'Delivered',
  invoiced:     'Invoiced',
  paid:         'Paid',
  cancelled:    'Cancelled',
}

const TIER_LABEL: Record<DeliveryTier, string> = {
  standard:  'Standard',
  'next-day': 'Next Day',
  'same-day': 'Same Day',
}

const TIER_VARIANT: Record<DeliveryTier, BadgeVariant> = {
  standard:  'neutral',
  'next-day': 'warning',
  'same-day': 'danger',
}

// Status timeline steps (linear progression; cancelled is a branch)
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

// ── Filter types ──────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'pending' | 'scheduled' | 'delivered' | 'invoiced'

const FILTER_PILLS: { value: StatusFilter; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'pending',   label: 'Pending' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'invoiced',  label: 'Invoiced' },
]

const PAGE_SIZE = 20

// ── Detail panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  order:      Order
  products:   Record<string, string>
  onClose:    () => void
  onReorder:  (order: Order) => void
}

const LinkedInvoiceRow: React.FC<{ order: Order }> = ({ order }) => {
  const navigate = useNavigate()
  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['order-invoice', order.id],
    queryFn: async () => {
      const snap = await getDocs(
        query(invoicesCol, where('orderId', '==', order.id)),
      )
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

  // Trap focus / close on Escape
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
      <div
        className="oh-detail"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Order details"
      >
        {/* Header */}
        <div className="oh-detail__header">
          <div>
            <span className="oh-detail__id">#{order.id.slice(0, 8).toUpperCase()}</span>
            <Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge>
          </div>
          <button className="oh-detail__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="oh-detail__body">
          {/* Status timeline */}
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
                      <div className="oh-timeline__dot">
                        {state === 'done' ? '✓' : i + 1}
                      </div>
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

          {/* Order detail rows */}
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

          {/* Price breakdown */}
          <div className="oh-detail__section oh-detail__section--price">
            <div className="oh-detail__row">
              <span className="oh-detail__label">Unit price</span>
              <span className="oh-detail__value">{fmtCurrency(order.unitPrice)}</span>
            </div>
            {order.upchargePercent > 0 && (
              <div className="oh-detail__row">
                <span className="oh-detail__label">
                  Upcharge ({Math.round(order.upchargePercent * 100)}%)
                </span>
                <span className="oh-detail__value">
                  +{fmtCurrency(order.subtotal - order.unitPrice * order.quantity)}
                </span>
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

          {/* Linked invoice */}
          <LinkedInvoiceRow order={order} />
        </div>

        {/* Footer actions */}
        <div className="oh-detail__footer">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onReorder(order)}
          >
            ↺ Reorder
          </Button>
        </div>
      </div>
    </>
  )
}

// ── Order row (desktop) / card (mobile) ───────────────────────────────────────

interface OrderRowProps {
  order:     Order
  products:  Record<string, string>
  selected:  boolean
  onClick:   () => void
  onReorder: () => void
}

const OrderRow: React.FC<OrderRowProps> = ({ order, products, selected, onClick, onReorder }) => {
  const productName = products[order.productId] ?? 'Delivery'
  const date = toDate(order.scheduledAt) ?? toDate(order.requestedAt)

  return (
    <div
      className={`oh-row ${selected ? 'oh-row--selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-pressed={selected}
    >
      <span className="oh-row__id">#{order.id.slice(0, 8).toUpperCase()}</span>
      <span className="oh-row__product">{productName} × {order.quantity}</span>
      <span className="oh-row__tier">
        <Badge variant={TIER_VARIANT[order.deliveryTier]}>
          {TIER_LABEL[order.deliveryTier]}
          {order.upchargePercent > 0 && ` +${Math.round(order.upchargePercent * 100)}%`}
        </Badge>
      </span>
      <span className="oh-row__date">{fmtDate(date)}</span>
      <span className="oh-row__status">
        <Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge>
      </span>
      <span className="oh-row__amount">{fmtCurrency(order.total)}</span>
      <span className="oh-row__actions">
        <button
          className="oh-row__reorder"
          title="Reorder"
          aria-label="Reorder"
          onClick={(e) => { e.stopPropagation(); onReorder() }}
        >
          ↺
        </button>
      </span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const OrdersPage: React.FC = () => {
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const customerId = user?.customerId ?? null

  // ── Filter state ─────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [search, setSearch]             = useState('')
  const [selectedId, setSelectedId]     = useState<string | null>(null)

  // ── Pagination state ─────────────────────────────────────────────────────
  const [allOrders, setAllOrders]   = useState<Order[]>([])
  const [cursor, setCursor]         = useState<QueryDocumentSnapshot | null>(null)
  const [hasMore, setHasMore]       = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // ── Products map ─────────────────────────────────────────────────────────
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products', 'active'],
    queryFn: async () => {
      const snap = await getDocs(query(productsCol, where('active', '==', true)))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Product))
    },
    staleTime: 10 * 60 * 1000,
  })

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  )

  // ── Initial + filter-change fetch ────────────────────────────────────────
  const fetchFirst = useCallback(async () => {
    if (!customerId) return
    const filters = {
      customerId,
      status: statusFilter === 'all' ? undefined : statusFilter as OrderStatus,
      scheduledAfter:  dateFrom ? new Date(dateFrom) : undefined,
      scheduledBefore: dateTo   ? new Date(dateTo)   : undefined,
    }
    const page = await getOrders(filters, { pageSize: PAGE_SIZE })
    setAllOrders(page.data)
    setCursor(page.cursor)
    setHasMore(page.hasMore)
    setSelectedId(null)
  }, [customerId, statusFilter, dateFrom, dateTo])

  useEffect(() => { fetchFirst() }, [fetchFirst])

  // ── Load more ────────────────────────────────────────────────────────────
  const handleLoadMore = useCallback(async () => {
    if (!customerId || !cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const filters = {
        customerId,
        status: statusFilter === 'all' ? undefined : statusFilter as OrderStatus,
        scheduledAfter:  dateFrom ? new Date(dateFrom) : undefined,
        scheduledBefore: dateTo   ? new Date(dateTo)   : undefined,
      }
      const page = await getOrders(filters, { pageSize: PAGE_SIZE, after: cursor })
      setAllOrders((prev) => [...prev, ...page.data])
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }, [customerId, cursor, loadingMore, statusFilter, dateFrom, dateTo])

  // ── Client-side search filter ────────────────────────────────────────────
  const filteredOrders = useMemo(() => {
    if (!search.trim()) return allOrders
    const q = search.trim().toLowerCase()
    return allOrders.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        (productMap[o.productId] ?? '').toLowerCase().includes(q),
    )
  }, [allOrders, search, productMap])

  // ── Reorder ──────────────────────────────────────────────────────────────
  const handleReorder = useCallback((order: Order) => {
    navigate('/portal/order', {
      state: {
        reorder: {
          productId: order.productId,
          quantity:  order.quantity,
          tier:      order.deliveryTier,
          notes:     order.notes ?? '',
        },
      },
    })
  }, [navigate])

  const selectedOrder = allOrders.find((o) => o.id === selectedId) ?? null

  return (
    <div className={`oh-page ${selectedOrder ? 'oh-page--panel-open' : ''}`}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <header className="oh-header">
        <h1 className="oh-header__title">My Orders</h1>
        <Button variant="primary" size="sm" onClick={() => navigate('/portal/order')}>
          + Place order
        </Button>
      </header>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="oh-filters">
        {/* Status pills */}
        <div className="oh-pills">
          {FILTER_PILLS.map(({ value, label }) => (
            <button
              key={value}
              className={`oh-pill ${statusFilter === value ? 'oh-pill--active' : ''}`}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="oh-date-range">
          <input
            type="date"
            className="oh-date-input"
            aria-label="From date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <span className="oh-date-sep">–</span>
          <input
            type="date"
            className="oh-date-input"
            aria-label="To date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        {/* Search */}
        <div className="oh-search-wrap">
          <svg className="oh-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="oh-search"
            placeholder="Search orders…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search orders"
          />
        </div>
      </div>

      {/* ── Order list ──────────────────────────────────────────────────── */}
      <div className="oh-list-wrap">
        {filteredOrders.length === 0 ? (
          <div className="oh-empty">
            <span className="oh-empty__icon" aria-hidden="true">📋</span>
            <p className="oh-empty__title">No orders yet</p>
            <p className="oh-empty__sub">
              {allOrders.length > 0
                ? 'No orders match your filters.'
                : 'Place your first order to get started.'}
            </p>
            <Button variant="primary" size="md" onClick={() => navigate('/portal/order')}>
              + Place order
            </Button>
          </div>
        ) : (
          <>
            {/* Desktop column headers */}
            <div className="oh-list-header" aria-hidden="true">
              <span>Order #</span>
              <span>Product</span>
              <span>Tier</span>
              <span>Date</span>
              <span>Status</span>
              <span>Total</span>
              <span />
            </div>

            <div className="oh-list" role="list">
              {filteredOrders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  products={productMap}
                  selected={selectedId === order.id}
                  onClick={() => setSelectedId(selectedId === order.id ? null : order.id)}
                  onReorder={() => handleReorder(order)}
                />
              ))}
            </div>

            {hasMore && !search && (
              <div className="oh-load-more">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={loadingMore}
                  onClick={handleLoadMore}
                >
                  Load more orders
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Detail panel ────────────────────────────────────────────────── */}
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
