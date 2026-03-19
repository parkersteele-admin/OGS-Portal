/**
 * src/pages/driver/DaySchedule.tsx
 * BEM prefix: ds-
 *
 * Tablet-optimised driver day schedule.
 * Designed for use in a truck cab — large touch targets, high-contrast,
 * 16px+ fonts throughout.
 *
 * Sections:
 *   1. Header — greeting, date, run name + stop count
 *   2. Progress bar — X of Y stops complete
 *   3. Stop list — one card per stop, current stop highlighted
 *   4. All-complete banner + "Submit end of day" button
 *
 * Data flow:
 *   • One-time getRuns() to find today's run for this driver
 *   • useActiveRun(runId) for live run + stop updates
 *   • Batch-fetches customers / orders / products when stops first load
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getDocs,
  query,
  where,
  documentId,
  type Timestamp,
} from 'firebase/firestore'
import { ordersCol, customersCol, productsCol } from '../../lib/firestore'
import { useAuth } from '../../hooks/useAuth'
import { useActiveRun } from '../../hooks/useActiveRun'
import { getRuns } from '../../services/runService'
import { openGoogleMapsNavigation } from '../../utils/navigation'
import { Badge } from '../../components/ui/Badge'
import type { Run, RunStop, LoadStatus } from '../../types/run'
import type { Customer } from '../../types/customer'
import type { Order } from '../../types/order'
import type { Product } from '../../types/product'
import './DaySchedule.css'

// ── Helpers ────────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function fmtDate(d = new Date()): string {
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtTime(ts?: Timestamp | null): string {
  if (!ts) return ''
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Open Google Maps falling back to address search when no lat / lng.
function launchNav(customer: Customer | undefined): void {
  if (!customer) return
  if (customer.lat && customer.lng) {
    openGoogleMapsNavigation(customer.lat, customer.lng, customer.name)
    return
  }
  const addr = encodeURIComponent(
    `${customer.address}, ${customer.city}, ${customer.state} ${customer.zip}`,
  )
  window.open(
    `https://www.google.com/maps/search/?api=1&query=${addr}`,
    '_blank',
    'noopener,noreferrer',
  )
}

// ── Stop card sub-component ────────────────────────────────────────────────────

interface StopCardProps {
  stop:     RunStop
  isCurrent: boolean
  runId:    string
  customer: Customer | undefined
  order:    Order    | undefined
  product:  Product  | undefined
}

function StopCard({ stop, isCurrent, runId, customer, order, product }: StopCardProps) {
  const navigate = useNavigate()
  const isDone    = stop.status === 'completed'
  const isSkipped = stop.status === 'skipped'
  const isPending = stop.status === 'pending'
  const [addOnsExpanded, setAddOnsExpanded] = useState(false)

  const addOns = order?.addOns ?? []
  const hasAddOns = addOns.length > 0

  let cardClass = 'ds-stop-card'
  if (isCurrent) cardClass += ' ds-stop-card--current'
  if (isDone)    cardClass += ' ds-stop-card--done'
  if (isSkipped) cardClass += ' ds-stop-card--skipped'

  const qtyLabel = order
    ? `${order.quantity} ${product?.unit ?? 'unit'}${order.quantity !== 1 ? 's' : ''}`
    : null

  return (
    <div className={cardClass}>
      {/* Stop number + status */}
      <div className="ds-stop-card__num-col">
        {isDone ? (
          <span className="ds-stop-num ds-stop-num--done">✓</span>
        ) : isSkipped ? (
          <span className="ds-stop-num ds-stop-num--skipped">✕</span>
        ) : (
          <span className={`ds-stop-num${isCurrent ? ' ds-stop-num--current' : ''}`}>
            {stop.order}
          </span>
        )}
      </div>

      {/* Main info */}
      <div className="ds-stop-card__body">
        <div className="ds-stop-card__name">
          {customer?.name ?? stop.customerId}
        </div>

        {customer && (
          <div className="ds-stop-card__address">
            {customer.address}, {customer.city} {customer.state} {customer.zip}
          </div>
        )}

        {/* Standing order product row */}
        {product && qtyLabel && (
          <div className="ds-stop-card__section-label">Standing order</div>
        )}
        {product && qtyLabel && (
          <div className="ds-stop-card__product">
            {product.name} · {qtyLabel}
          </div>
        )}

        {/* Add-ons section — amber strip, always visually separated */}
        {hasAddOns && (
          <div className="ds-stop-card__addons">
            <button
              type="button"
              className="ds-stop-card__addons-header"
              onClick={(e) => { e.stopPropagation(); setAddOnsExpanded((v) => !v) }}
            >
              <span className="ds-stop-card__addons-badge">Add-ons +{addOns.length}</span>
              <span className="ds-stop-card__addons-chevron">{addOnsExpanded ? '▾' : '▸'}</span>
            </button>
            {addOnsExpanded && (
              <div className="ds-stop-card__addons-list">
                {addOns.map((ao, i) => (
                  <div key={i} className="ds-stop-card__addons-item">
                    {ao.qty}× {ao.productName}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isDone && stop.completedAt && (
          <div className="ds-stop-card__done-time">
            Delivered at {fmtTime(stop.completedAt as unknown as Timestamp)}
          </div>
        )}

        {isSkipped && (
          <div className="ds-stop-card__skip-reason">
            {stop.notes ? `Skipped: ${stop.notes}` : 'Skipped'}
          </div>
        )}

        {/* Actions — only on current / pending (not done / skipped) */}
        {(isCurrent || isPending) && (
          <div className="ds-stop-card__actions">
            {isCurrent && (
              <button
                className="ds-btn ds-btn--nav"
                onClick={(e) => { e.stopPropagation(); launchNav(customer) }}
              >
                🗺 Navigate
              </button>
            )}
            <button
              className={`ds-btn ${isCurrent ? 'ds-btn--details' : 'ds-btn--details-sm'}`}
              onClick={() => navigate(`/driver/stop/${stop.id}`, { state: { runId } })}
            >
              {isCurrent ? 'View stop details →' : 'Details'}
            </button>
          </div>
        )}
      </div>

      {/* Current indicator pill on right */}
      {isCurrent && (
        <div className="ds-stop-card__pill">CURRENT</div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DaySchedule() {
  const { user }   = useAuth()
  const navigate   = useNavigate()

  // 1. Find today's run ─────────────────────────────────────────────────────────
  const [runId,     setRunId]     = useState<string | null>(null)
  const [findingRun, setFindingRun] = useState(true)
  const [findError,  setFindError]  = useState<string | null>(null)

  useEffect(() => {
    if (!user) return

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(todayStart)
    todayEnd.setDate(todayStart.getDate() + 1)

    getRuns(
      { driverId: user.id, dateAfter: todayStart, dateBefore: todayEnd },
      { pageSize: 10 },
    )
      .then(({ data }) => {
        setFindError(null)
        const active =
          data.find((r: Run) => r.status === 'in-progress') ??
          data.find((r: Run) => r.status === 'scheduled')   ??
          data.filter((r: Run) => r.status !== 'cancelled')[0] ??
          null
        setRunId(active?.id ?? null)
        setFindingRun(false)
      })
      .catch((err: Error) => {
        setFindError(err.message ?? 'Could not load today\'s run.')
        setFindingRun(false)
      })
  }, [user?.id])

  // 2. Live run + stops via useActiveRun ────────────────────────────────────────
  const { run, stops, loading: runLoading } = useActiveRun(runId)

  // 3. Batch-fetch supplemental data ────────────────────────────────────────────
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map())
  const [orders,    setOrders]    = useState<Map<string, Order>>(new Map())
  const [products,  setProducts]  = useState<Map<string, Product>>(new Map())
  const lastFetchKey = useRef('')

  useEffect(() => {
    if (!stops.length) return
    const key = stops.map((s) => s.id).join(',')
    if (key === lastFetchKey.current) return
    lastFetchKey.current = key

    const orderIds    = [...new Set(stops.map((s) => s.orderId).filter(Boolean))].slice(0, 30)
    const customerIds = [...new Set(stops.map((s) => s.customerId).filter(Boolean))].slice(0, 30)

    async function fetchExtras() {
      const [orderSnaps, customerSnaps] = await Promise.all([
        orderIds.length
          ? getDocs(query(ordersCol, where(documentId(), 'in', orderIds)))
          : Promise.resolve(null),
        customerIds.length
          ? getDocs(query(customersCol, where(documentId(), 'in', customerIds)))
          : Promise.resolve(null),
      ])

      const ordersMap = new Map<string, Order>()
      orderSnaps?.docs.forEach((d) =>
        ordersMap.set(d.id, { ...(d.data() as Omit<Order, 'id'>), id: d.id }),
      )
      setOrders(ordersMap)

      const customerMap = new Map<string, Customer>()
      customerSnaps?.docs.forEach((d) =>
        customerMap.set(d.id, { ...(d.data() as Omit<Customer, 'id'>), id: d.id }),
      )
      setCustomers(customerMap)

      const productIds = [
        ...new Set(Array.from(ordersMap.values()).map((o) => o.productId).filter(Boolean)),
      ].slice(0, 30)

      if (productIds.length) {
        const pSnaps = await getDocs(
          query(productsCol, where(documentId(), 'in', productIds)),
        )
        const productMap = new Map<string, Product>()
        pSnaps.docs.forEach((d) =>
          productMap.set(d.id, { ...(d.data() as Omit<Product, 'id'>), id: d.id }),
        )
        setProducts(productMap)
      }
    }

    fetchExtras().catch(console.error)
  }, [stops])

  // 4. Derived state ─────────────────────────────────────────────────────────────
  const completedCount = useMemo(
    () => stops.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
    [stops],
  )

  const allDone = stops.length > 0 && completedCount === stops.length

  const currentStop = useMemo<RunStop | null>(
    () =>
      stops.find((s) => s.status === 'arrived') ??
      stops.find((s) => s.status === 'pending') ??
      null,
    [stops],
  )

  const progressPct = stops.length
    ? Math.round((completedCount / stops.length) * 100)
    : 0

  // ── Render ─────────────────────────────────────────────────────────────────────

  const overallLoading = findingRun || runLoading

  if (overallLoading) {
    return (
      <div className="ds-page">
        <div className="ds-center">
          <span className="ds-spinner" />
          <p className="ds-center__text">Loading your schedule…</p>
        </div>
      </div>
    )
  }

  if (findError) {
    return (
      <div className="ds-page">
        <div className="ds-error-box">{findError}</div>
      </div>
    )
  }

  if (!runId || !run) {
    return (
      <div className="ds-page">
        <div className="ds-no-run">
          <div className="ds-no-run__icon">📋</div>
          <h2 className="ds-no-run__title">No run scheduled today</h2>
          <p className="ds-no-run__sub">
            {fmtDate()} — check back later or contact dispatch.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="ds-page">

      {/* ── 1. Header ── */}
      <div className="ds-header">
        <div className="ds-header__greeting">
          {greeting()}, {user?.name ?? 'Driver'}
        </div>
        <div className="ds-header__date">{fmtDate()}</div>
        <div className="ds-header__run-info">
          <span className="ds-run-name">{run.runNumber}</span>
          <span className="ds-run-stops">
            {stops.length} stop{stops.length !== 1 ? 's' : ''}
          </span>
          <RunStatusPill run={run} />
          <LoadStatusBadge loadStatus={run.loadStatus} />
        </div>
      </div>

      {/* ── 2. Progress bar ── */}
      <div className="ds-progress">
        <div className="ds-progress__labels">
          <span className="ds-progress__lbl">
            {completedCount} of {stops.length} stops complete
          </span>
          <span className="ds-progress__pct">{progressPct}%</span>
        </div>
        <div className="ds-progress__track">
          <div
            className="ds-progress__fill"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* ── All complete banner ── */}
      {allDone && (
        <div className="ds-all-done">
          <div className="ds-all-done__icon">🎉</div>
          <div className="ds-all-done__text">
            <div className="ds-all-done__title">All stops complete!</div>
            <div className="ds-all-done__sub">Great work today. Ready to submit your end-of-day report.</div>
          </div>
          <button
            className="ds-btn ds-btn--submit"
            onClick={() => navigate(`/driver/summary/${run.id}`)}
          >
            Submit end of day →
          </button>
        </div>
      )}

      {/* ── Load prompt (shown when truck has not yet been loaded) ── */}
      {/* Show for scheduled runs with no loadStatus (legacy/new) OR explicitly pending/loading */}
      {(run.status === 'scheduled' && !run.loadStatus)
        || run.loadStatus === 'pending'
        || run.loadStatus === 'loading' ? (
        <div className="ds-load-prompt">
          <div className="ds-load-prompt__icon" aria-hidden="true">🚚</div>
          <div className="ds-load-prompt__body">
            <div className="ds-load-prompt__title">Load your truck before starting your run.</div>
            <div className="ds-load-prompt__sub">
              {stops.length} cylinder{stops.length !== 1 ? 's' : ''} needed for today's run.
            </div>
          </div>
          <button
            className="ds-btn ds-btn--load"
            onClick={() => navigate(`/driver/load/${run.id}`)}
          >
            Load Truck →
          </button>
        </div>
      ) : (
        /* ── 3. Stop list ── */
        <div className="ds-stop-list">
          {stops.map((stop) => (
            <StopCard
              key={stop.id}
              stop={stop}
              isCurrent={currentStop?.id === stop.id}
              runId={run.id}
              customer={customers.get(stop.customerId)}
              order={orders.get(stop.orderId)}
              product={orders.get(stop.orderId)
                ? products.get(orders.get(stop.orderId)!.productId)
                : undefined}
            />
          ))}
        </div>
      )}

      {/* Sticky submit button at bottom when all stops done */}
      {allDone && (
        <div className="ds-sticky-submit">
          <button
            className="ds-btn ds-btn--submit ds-btn--submit-full"
            onClick={() => navigate(`/driver/summary/${run.id}`)}
          >
            Submit end of day →
          </button>
        </div>
      )}

    </div>
  )
}

// ── Run status pill helper ─────────────────────────────────────────────────────

function RunStatusPill({ run }: { run: Run }) {
  const map: Record<string, string> = {
    'scheduled':   'ds-run-pill--scheduled',
    'in-progress': 'ds-run-pill--active',
    'completed':   'ds-run-pill--done',
    'cancelled':   'ds-run-pill--cancelled',
  }
  const labels: Record<string, string> = {
    'scheduled':   'Scheduled',
    'in-progress': '● In Progress',
    'completed':   '✓ Complete',
    'cancelled':   'Cancelled',
  }
  return (
    <span className={`ds-run-pill ${map[run.status] ?? ''}`}>
      {labels[run.status] ?? run.status}
    </span>
  )
}

// ── Load status badge helper ───────────────────────────────────────────────────

function LoadStatusBadge({ loadStatus }: { loadStatus?: LoadStatus }) {
  if (!loadStatus || loadStatus === 'started') return null

  const variantMap: Record<Exclude<LoadStatus, 'started'>, 'neutral' | 'warning' | 'success'> = {
    pending: 'neutral',
    loading: 'warning',
    ready:   'success',
  }
  const labelMap: Record<Exclude<LoadStatus, 'started'>, string> = {
    pending: 'Not loaded',
    loading: 'Loading…',
    ready:   'Loaded',
  }

  return (
    <Badge variant={variantMap[loadStatus]}>
      {labelMap[loadStatus]}
    </Badge>
  )
}
