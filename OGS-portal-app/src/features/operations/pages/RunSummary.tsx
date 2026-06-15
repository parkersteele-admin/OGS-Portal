/**
 * src/pages/dispatch/RunSummary.tsx
 * BEM prefix: rs-
 *
 * Run summary — shown when all stops complete or ops dispatchers close a run.
 * Also accessible from run history at /ops/runs/:runId/summary.
 *
 * Sections:
 *   1. Header — run number, date, driver, status badge
 *   2. KPI cards — stops, delivered quantity, start→end timeline
 *   3. Stop-by-stop table with skipped rows highlighted in red
 *   4. Skipped stop actions — reschedule each skipped stop
 *   5. Financial summary — total invoices, autopay vs manual
 *   6. Actions — CSV download, close run, back to dashboard
 */

import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Eye, Info, Truck } from 'lucide-react'
import {
  getDoc,
  getDocs,
  doc,
  query,
  where,
  documentId,
  type Timestamp,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { ordersCol, customersCol, invoicesCol, productsCol } from '../../../lib/firestore'
import { getRun, getRunStops, updateRun } from '../../../services/runService'
import { updateOrder } from '../../../services/orderService'
import { getActiveUsers } from '../../../services/userService'
import { useAuth } from '../../../hooks/useAuth'
import type { AppUser } from '../../../types/user'
import type { Run, RunStop } from '../../../types/run'
import type { Order } from '../../../types/order'
import type { Invoice } from '../../../types/billing'
import type { Customer } from '../../../types/customer'
import type { Product } from '../../../types/product'
import { Button } from '../../../components/ui/Button'
import { Modal } from '../../../components/ui/Modal'
import { DeliveryCompleteModal } from '../../../components/delivery/DeliveryCompleteModal'
import MobileOrderCard from '../../../components/orders/MobileOrderCard'
import './RunSummary.css'

// ── Formatting helpers ─────────────────────────────────────────────────────────

function fmtTimestamp(ts?: Timestamp | null): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(ts?: Timestamp | null): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    year:    'numeric',
  })
}

function fmtDuration(start?: Timestamp | null, end?: Timestamp | null): string {
  if (!start || !end) return '—'
  const ms = end.toDate().getTime() - start.toDate().getTime()
  if (ms <= 0) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

/** Split array into chunks of at most `size` (for Firestore `in` limits). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ── Invoice batch fetch (handles >30 orderIds via chunking) ───────────────────

async function fetchInvoicesForOrders(orderIds: string[]): Promise<Invoice[]> {
  if (!orderIds.length) return []
  const results = await Promise.all(
    chunk(orderIds, 30).map((ch) =>
      getDocs(query(invoicesCol, where('orderId', 'in', ch))).then((snap) =>
        snap.docs.map((d) => ({ ...(d.data() as Omit<Invoice, 'id'>), id: d.id })),
      ),
    ),
  )
  return results.flat()
}

// ── CSV export ─────────────────────────────────────────────────────────────────

function downloadCsv(
  run:       Run,
  stops:     RunStop[],
  orders:    Map<string, Order>,
  customers: Map<string, Customer>,
  products:  Map<string, Product>,
): void {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

  const header = [
    'Stop#', 'Customer', 'Address', 'Product', 'Unit',
    'Qty Delivered', 'Status', 'Arrived', 'Completed', 'Notes',
  ].map(esc).join(',')

  const rows = stops.map((stop) => {
    const order    = orders.get(stop.orderId)
    const customer = customers.get(stop.customerId)
    const product  = order ? products.get(order.productId) : undefined
    return [
      stop.order,
      customer?.name ?? stop.customerId,
      customer ? `${customer.address}, ${customer.city} ${customer.state} ${customer.zip}` : '',
      product?.name ?? order?.productId ?? '—',
      product?.unit ?? '',
      stop.gallonsDelivered != null ? stop.gallonsDelivered : '—',
      stop.status,
      fmtTimestamp(stop.arrivedAt as Timestamp | null),
      fmtTimestamp(stop.completedAt as Timestamp | null),
      stop.notes ?? '',
    ].map(esc).join(',')
  })

  const csv  = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${run.runNumber}-summary.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── RunSummary component ───────────────────────────────────────────────────────

export default function RunSummary() {
  const { runId }  = useParams<{ runId: string }>()
  const navigate   = useNavigate()
  const location   = useLocation()
  const opsBase    = location.pathname.startsWith('/admin') ? '/admin/ops' : '/ops'
  const { isAdmin, isDispatch } = useAuth()

  const [run,        setRun]        = useState<Run | null>(null)
  const [stops,      setStops]      = useState<RunStop[]>([])
  const [orders,     setOrders]     = useState<Map<string, Order>>(new Map())
  const [customers,  setCustomers]  = useState<Map<string, Customer>>(new Map())
  const [products,   setProducts]   = useState<Map<string, Product>>(new Map())
  const [invoices,   setInvoices]   = useState<Invoice[]>([])
  const [driverName, setDriverName] = useState<string>('—')
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [closingRun, setClosingRun] = useState(false)
  const [rescheduling, setRescheduling] = useState<Record<string, boolean>>({})
  const [rescheduled,  setRescheduled]  = useState<Set<string>>(new Set())
  const [drivers,         setDrivers]         = useState<AppUser[]>([])
  const [reassignDriverId, setReassignDriverId] = useState<string>('')
  const [reassigning,      setReassigning]      = useState(false)
  const [reassignError,    setReassignError]    = useState<string | null>(null)
  const [refreshNonce,     setRefreshNonce]     = useState(0)
  const [deliveryTarget,   setDeliveryTarget]   = useState<{ stop: RunStop; order: Order } | null>(null)
  const [stopDetailTarget, setStopDetailTarget] = useState<RunStop | null>(null)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  )

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    setIsMobile(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // ── Load drivers for reassignment ──────────────────────────────────────────

  useEffect(() => {
    if (!isDispatch) return
    getActiveUsers()
      .then((ds) => setDrivers(ds))
      .catch(() => { /* non-critical */ })
  }, [isDispatch])

  // ── Data loading ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!runId) return
    setLoading(true)
    setError(null)

    async function load() {
      const [runData, stopsData] = await Promise.all([
        getRun(runId!),
        getRunStops(runId!),
      ])
      setRun(runData)
      setStops(stopsData)

      const orderIds    = [...new Set(stopsData.map((s) => s.orderId).filter(Boolean))]
      const customerIds = [...new Set(stopsData.map((s) => s.customerId).filter(Boolean))]

      // Parallel batch fetches
      type SnapLike = { docs: Array<{ id: string; data(): unknown }> }
      const emptySnap: SnapLike = { docs: [] }
      const [orderSnaps, customerSnaps, driverSnap, invs] = await Promise.all([
        orderIds.length
          ? getDocs(query(ordersCol, where(documentId(), 'in', orderIds))) as Promise<SnapLike>
          : Promise.resolve(emptySnap),
        customerIds.length
          ? getDocs(query(customersCol, where(documentId(), 'in', customerIds))) as Promise<SnapLike>
          : Promise.resolve(emptySnap),
        getDoc(doc(db, 'users', runData.driverId)),
        fetchInvoicesForOrders(orderIds),
      ])

      // Driver
      if (driverSnap.exists()) {
        const d = driverSnap.data() as Record<string, unknown>
        setDriverName(String(d.displayName ?? d.name ?? d.email ?? '—'))
      }

      // Orders map
      const ordersMap = new Map<string, Order>()
      orderSnaps.docs.forEach((d) =>
        ordersMap.set(d.id, { ...(d.data() as Omit<Order, 'id'>), id: d.id } as Order),
      )
      setOrders(ordersMap)

      // Customers map
      const customerMap = new Map<string, Customer>()
      customerSnaps.docs.forEach((d) =>
        customerMap.set(d.id, { ...(d.data() as Omit<Customer, 'id'>), id: d.id } as Customer),
      )
      setCustomers(customerMap)

      // Products — from unique productIds on orders
      const productIds = [
        ...new Set(Array.from(ordersMap.values()).map((o) => o.productId).filter(Boolean)),
      ]
      if (productIds.length) {
        const pSnaps = await getDocs(
          query(productsCol, where(documentId(), 'in', productIds)),
        )
        const productMap = new Map<string, Product>()
        pSnaps.docs.forEach((d) => productMap.set(d.id, { ...(d.data() as Omit<Product, 'id'>), id: d.id } as Product))
        setProducts(productMap)
      }

      setInvoices(invs)
      setLoading(false)
    }

    load().catch((err: Error) => {
      setError(err.message ?? 'Failed to load run summary.')
      setLoading(false)
    })
  }, [runId, refreshNonce])

  // ── KPIs ─────────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const completed      = stops.filter((s) => s.status === 'completed').length
    const skipped        = stops.filter((s) => s.status === 'skipped').length
    const total          = stops.length
    const totalDelivered = stops.reduce((sum, s) => sum + (s.gallonsDelivered ?? 0), 0)
    return { completed, skipped, total, totalDelivered }
  }, [stops])

  // ── Financial summary ─────────────────────────────────────────────────────────

  const financial = useMemo(() => {
    const total   = invoices.reduce((s, inv) => s + (inv.total ?? 0), 0)
    const autopay = invoices.filter((inv) => inv.status === 'paid')
    const manual  = invoices.filter((inv) => inv.status === 'sent')
    return {
      count: invoices.length,
      total,
      autopay: {
        count: autopay.length,
        total: autopay.reduce((s, i) => s + i.total, 0),
      },
      manual: {
        count: manual.length,
        total: manual.reduce((s, i) => s + i.total, 0),
      },
    }
  }, [invoices])

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function handleCloseRun() {
    if (!run || run.status === 'completed' || run.status === 'cancelled') return
    setClosingRun(true)
    try {
      // If any stops are still pending/arrived the run is being ended early → cancelled.
      const hasPending = stops.some((s) => s.status === 'pending' || s.status === 'arrived')
      const newStatus = hasPending ? 'cancelled' : 'completed'
      await updateRun(run.id, { status: newStatus })
      setRun((prev) => (prev ? { ...prev, status: newStatus } : prev))
    } finally {
      setClosingRun(false)
    }
  }

  async function handleReassign() {
    if (!run || !reassignDriverId) return
    setReassigning(true)
    setReassignError(null)
    try {
      await updateRun(run.id, { driverId: reassignDriverId })
      const driver = drivers.find((d) => d.id === reassignDriverId)
      setRun((prev) => (prev ? { ...prev, driverId: reassignDriverId } : prev))
      setDriverName(driver?.name ?? reassignDriverId)
      setReassignDriverId('')
    } catch (err: unknown) {
      setReassignError(err instanceof Error ? err.message : 'Reassignment failed.')
    } finally {
      setReassigning(false)
    }
  }

  async function handleReschedule(stop: RunStop) {
    if (rescheduled.has(stop.id)) return
    setRescheduling((prev) => ({ ...prev, [stop.id]: true }))
    try {
      await updateOrder(stop.orderId, { status: 'pending' })
      setRescheduled((prev) => new Set([...prev, stop.id]))
    } finally {
      setRescheduling((prev) => ({ ...prev, [stop.id]: false }))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rs-page">
        <div className="rs-loading">
          <span className="rs-loading__spinner" />
          Loading run summary…
        </div>
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="rs-page">
        <div className="rs-error">{error ?? 'Run not found.'}</div>
        <button className="rs-back-link" onClick={() => navigate(`${opsBase}/dashboard`)}>
          ← Back to Ops Dashboard
        </button>
      </div>
    )
  }

  const skippedStops = stops.filter((s) => s.status === 'skipped')

  return (
    <div className="rs-page">

      {/* ── 1. Summary header ── */}
      <div className="rs-header">
        <div className="rs-header__left">
          <h1 className="rs-header__run">{run.runNumber}</h1>
          <div className="rs-header__meta">
            <span>{fmtDate(run.scheduledDate as unknown as Timestamp)}</span>
            <span className="rs-sep">·</span>
            <span>{driverName}</span>
            {run.truckId && (
              <>
                <span className="rs-sep">·</span>
                <span>Truck {run.truckId}</span>
              </>
            )}
          </div>
        </div>
        <div className="rs-header__right">
          <span
            className={`rs-status-badge rs-status-badge--${
              run.status === 'completed' ? 'complete'
              : run.status === 'cancelled' ? 'cancelled'
              : run.status
            }`}
          >
            {run.status === 'completed' ? '✓ Complete'
              : run.status === 'cancelled' ? '✕ Cancelled'
              : run.status.replace('-', ' ')}
          </span>
        </div>
      </div>

      {/* ── 2. KPI cards ── */}
      <div className="rs-kpis">
        {/* Stops completed */}
        <div className="rs-kpi">
          <div className="rs-kpi__num">
            {kpis.completed}
            <span className="rs-kpi__of">/{kpis.total}</span>
          </div>
          <div className="rs-kpi__lbl">Stops Completed</div>
        </div>

        {/* Skipped — only shown when > 0 */}
        {kpis.skipped > 0 && (
          <div className="rs-kpi rs-kpi--warn">
            <div className="rs-kpi__num">{kpis.skipped}</div>
            <div className="rs-kpi__lbl">Stops Skipped</div>
          </div>
        )}

        {/* Total delivered */}
        <div className="rs-kpi">
          <div className="rs-kpi__num">
            {kpis.totalDelivered % 1 === 0
              ? kpis.totalDelivered
              : kpis.totalDelivered.toFixed(1)}
            <span className="rs-kpi__unit">&nbsp;gal</span>
          </div>
          <div className="rs-kpi__lbl">Total Delivered</div>
        </div>

        {/* Timeline */}
        <div className="rs-kpi rs-kpi--timeline">
          <div className="rs-kpi__timeline-row">
            <div className="rs-kpi__time-block">
              <div className="rs-kpi__time-val">
                {fmtTimestamp(run.startedAt as unknown as Timestamp)}
              </div>
              <div className="rs-kpi__time-lbl">Start</div>
            </div>
            <span className="rs-kpi__arrow">→</span>
            <div className="rs-kpi__time-block">
              <div className="rs-kpi__time-val">
                {fmtTimestamp(run.completedAt as unknown as Timestamp)}
              </div>
              <div className="rs-kpi__time-lbl">End</div>
            </div>
            <span className="rs-kpi__arrow">=</span>
            <div className="rs-kpi__time-block">
              <div className="rs-kpi__time-val rs-kpi__time-val--dur">
                {fmtDuration(
                  run.startedAt   as unknown as Timestamp,
                  run.completedAt as unknown as Timestamp,
                )}
              </div>
              <div className="rs-kpi__time-lbl">Total Time</div>
            </div>
          </div>
          <div className="rs-kpi__lbl">Run Timeline</div>
        </div>
      </div>

      {/* ── 3. Stop-by-stop table ── */}
      <div className="rs-card">
        <div className="rs-card__header">
          <h2 className="rs-card__title">Stop Summary</h2>
          <span className="rs-card__badge">{stops.length} stop{stops.length !== 1 ? 's' : ''}</span>
        </div>
        {isMobile ? (
          <div className="rs-mobile-cards">
            {stops.map((stop) => {
              const order = orders.get(stop.orderId)
              if (!order) return null

              const customer = customers.get(stop.customerId)
              const product = products.get(order.productId)
              const canCompleteDelivery =
                (isAdmin || isDispatch)
                && (order.status === 'in-transit' || order.status === 'assigned')

              return (
                <MobileOrderCard
                  key={stop.id}
                  order={{
                    ...order,
                    quantity: stop.gallonsDelivered ?? order.quantity,
                    customerName: customer?.name ?? stop.customerId,
                    productName: product?.name ?? order.productId,
                    productUnit: product?.unit ?? 'gal',
                  } as Order}
                  primaryAction={canCompleteDelivery ? {
                    label: 'Complete Delivery',
                    icon: Truck,
                    onClick: () => setDeliveryTarget({ stop, order }),
                  } : {
                    label: 'View Details',
                    icon: Eye,
                    onClick: () => setStopDetailTarget(stop),
                  }}
                  secondaryActions={[
                    {
                      label: 'View Order',
                      icon: Eye,
                      onClick: () => navigate(`${opsBase}/orders?orderId=${order.id}`),
                    },
                    {
                      label: 'View Stop Details',
                      icon: Info,
                      onClick: () => setStopDetailTarget(stop),
                    },
                  ]}
                  expanded={!['delivered', 'ready_to_invoice', 'invoice_sent', 'paid'].includes(order.status)}
                />
              )
            })}
          </div>
        ) : (
          <div className="rs-table-wrap">
            <table className="rs-table">
              <thead>
                <tr>
                  <th className="rs-th rs-th--num">#</th>
                  <th className="rs-th">Customer</th>
                  <th className="rs-th">Product</th>
                  <th className="rs-th rs-th--num">Qty Delivered</th>
                  <th className="rs-th">Status</th>
                  <th className="rs-th rs-th--time">Arrived</th>
                  <th className="rs-th rs-th--time">Completed</th>
                  <th className="rs-th rs-th--notes">Notes</th>
                  <th className="rs-th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((stop) => {
                  const order    = orders.get(stop.orderId)
                  const customer = customers.get(stop.customerId)
                  const product  = order ? products.get(order.productId) : undefined
                  const isSkipped = stop.status === 'skipped'
                  const canCompleteDelivery =
                    !!order
                    && (isAdmin || isDispatch)
                    && (order.status === 'in-transit' || order.status === 'assigned')

                  return (
                    <tr
                      key={stop.id}
                      className={`rs-tr rs-tr--${stop.status}`}
                    >
                      <td className="rs-td rs-td--num">{stop.order}</td>

                      <td className="rs-td">
                        <div className="rs-customer">
                          {customer?.name ?? stop.customerId}
                        </div>
                        {customer && (
                          <div className="rs-customer__sub">
                            {customer.city}, {customer.state}
                          </div>
                        )}
                      </td>

                      <td className="rs-td">
                        <span>{product?.name ?? order?.productId ?? '—'}</span>
                        {product && (
                          <span className="rs-unit"> /{product.unit}</span>
                        )}
                      </td>

                      <td className="rs-td rs-td--num">
                        {stop.gallonsDelivered != null ? (
                          <>
                            {stop.gallonsDelivered}
                            <span className="rs-unit"> {product?.unit ?? 'gal'}</span>
                          </>
                        ) : (
                          <span className={isSkipped ? 'rs-skip-dash' : ''}>—</span>
                        )}
                      </td>

                      <td className="rs-td">
                        <span className={`rs-stop-badge rs-stop-badge--${stop.status}`}>
                          {stop.status === 'completed' && '✓ '}
                          {stop.status === 'skipped'   && '✕ '}
                          {stop.status.charAt(0).toUpperCase() + stop.status.slice(1)}
                        </span>
                      </td>

                      <td className="rs-td rs-td--time">
                        {fmtTimestamp(stop.arrivedAt as unknown as Timestamp)}
                      </td>

                      <td className="rs-td rs-td--time">
                        {fmtTimestamp(stop.completedAt as unknown as Timestamp)}
                      </td>

                      <td className="rs-td rs-td--notes">
                        {stop.notes ?? '—'}
                      </td>

                      <td className="rs-td">
                        {canCompleteDelivery ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              if (!order) return
                              setDeliveryTarget({ stop, order })
                            }}
                          >
                            <Truck size={14} /> Complete Delivery
                          </Button>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 4. Skipped stop actions ── */}
      {skippedStops.length > 0 && (
        <div className="rs-card rs-card--warn">
          <div className="rs-card__header">
            <h2 className="rs-card__title rs-card__title--warn">
              <span className="rs-warn-dot" />
              Skipped Stops — Action Required
            </h2>
            <span className="rs-card__badge rs-card__badge--warn">
              {skippedStops.length}
            </span>
          </div>
          <div className="rs-skipped-list">
            {skippedStops.map((stop) => {
              const customer = customers.get(stop.customerId)
              const order    = orders.get(stop.orderId)
              const product  = order ? products.get(order.productId) : undefined
              const done     = rescheduled.has(stop.id)

              return (
                <div key={stop.id} className="rs-skipped-row">
                  <div className="rs-skipped-row__num">{stop.order}</div>
                  <div className="rs-skipped-row__info">
                    <div className="rs-skipped-row__name">
                      {customer?.name ?? stop.customerId}
                    </div>
                    {product && (
                      <div className="rs-skipped-row__product">
                        {product.name} · {order?.quantity} {product.unit}
                      </div>
                    )}
                    {stop.notes && (
                      <div className="rs-skipped-row__reason">
                        Skip reason: {stop.notes}
                      </div>
                    )}
                  </div>
                  <div className="rs-skipped-row__action">
                    {done ? (
                      <span className="rs-rescheduled-badge">✓ Rescheduled to Pending</span>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={rescheduling[stop.id]}
                        onClick={() => handleReschedule(stop)}
                      >
                        Reschedule
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 5. Financial summary ── */}
      <div className="rs-card">
        <div className="rs-card__header">
          <h2 className="rs-card__title">Financial Summary</h2>
        </div>
        <div className="rs-financial">
          <div className="rs-fin-row rs-fin-row--total">
            <div className="rs-fin-row__label">Total Invoices Generated</div>
            <div className="rs-fin-row__right">
              <span className="rs-fin-row__count">
                {financial.count} invoice{financial.count !== 1 ? 's' : ''}
              </span>
              <span className="rs-fin-row__amount rs-fin-row__amount--bold">
                {fmtCurrency(financial.total)}
              </span>
            </div>
          </div>
          <div className="rs-fin-row">
            <div className="rs-fin-row__label">
              <span className="rs-fin-dot rs-fin-dot--autopay" />
              Autopay Charged
            </div>
            <div className="rs-fin-row__right">
              <span className="rs-fin-row__count">
                {financial.autopay.count} invoice{financial.autopay.count !== 1 ? 's' : ''}
              </span>
              <span className="rs-fin-row__amount rs-fin-row__amount--success">
                {fmtCurrency(financial.autopay.total)}
              </span>
            </div>
          </div>
          <div className="rs-fin-row">
            <div className="rs-fin-row__label">
              <span className="rs-fin-dot rs-fin-dot--manual" />
              Manual Invoices Sent
            </div>
            <div className="rs-fin-row__right">
              <span className="rs-fin-row__count">
                {financial.manual.count} invoice{financial.manual.count !== 1 ? 's' : ''}
              </span>
              <span className="rs-fin-row__amount">
                {fmtCurrency(financial.manual.total)}
              </span>
            </div>
          </div>
        </div>
        {invoices.length === 0 && (
          <p className="rs-fin-empty">No invoices found for this run.</p>
        )}
      </div>

      {/* ── 6. Reassign driver (dispatch/admin only, not on completed runs) ── */}
      {isDispatch && run.status !== 'completed' && (
        <div className="rs-reassign">
          <h3 className="rs-reassign__title">Reassign Driver</h3>
          <div className="rs-reassign__row">
            <select
              className="rs-reassign__select"
              value={reassignDriverId}
              onChange={(e) => setReassignDriverId(e.target.value)}
            >
              <option value="">Select new driver…</option>
              {drivers
                .filter((d) => d.id !== run.driverId)
                .map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
            </select>
            <Button
              variant="secondary"
              loading={reassigning}
              disabled={!reassignDriverId}
              onClick={handleReassign}
            >
              Reassign
            </Button>
          </div>
          {reassignError && (
            <p className="rs-reassign__error">{reassignError}</p>
          )}
        </div>
      )}

      {/* ── 7. Actions ── */}
      <div className="rs-actions">
        <div className="rs-actions__left">
          <button className="rs-back-link" onClick={() => navigate(`${opsBase}/dashboard`)}>
            ← Back to Ops Dashboard
          </button>
        </div>
        <div className="rs-actions__right">
          <Button
            variant="secondary"
            onClick={() => downloadCsv(run, stops, orders, customers, products)}
          >
            ⬇ Download Run Report
          </Button>
          {run.status !== 'completed' && run.status !== 'cancelled' && (
            <Button
              variant={stops.some((s) => s.status === 'pending' || s.status === 'arrived') ? 'danger' : 'primary'}
              loading={closingRun}
              onClick={handleCloseRun}
            >
              {stops.some((s) => s.status === 'pending' || s.status === 'arrived')
                ? 'End Run Early'
                : 'Close Run'}
            </Button>
          )}
        </div>
      </div>

      {deliveryTarget && (
        <DeliveryCompleteModal
          order={deliveryTarget.order}
          runId={run.id}
          stopId={deliveryTarget.stop.id}
          onClose={() => setDeliveryTarget(null)}
          onSuccess={() => {
            setDeliveryTarget(null)
            setRefreshNonce((value) => value + 1)
          }}
        />
      )}

      {stopDetailTarget && (
        <Modal
          open
          onClose={() => setStopDetailTarget(null)}
          title={`Stop #${stopDetailTarget.order} Details`}
          size="md"
        >
          <div className="rs-stop-detail">
            <div className="rs-stop-detail__row">
              <span>Status</span>
              <strong>{stopDetailTarget.status}</strong>
            </div>
            <div className="rs-stop-detail__row">
              <span>Arrived</span>
              <strong>{fmtTimestamp(stopDetailTarget.arrivedAt as unknown as Timestamp)}</strong>
            </div>
            <div className="rs-stop-detail__row">
              <span>Completed</span>
              <strong>{fmtTimestamp(stopDetailTarget.completedAt as unknown as Timestamp)}</strong>
            </div>
            <div className="rs-stop-detail__row">
              <span>Delivered</span>
              <strong>{stopDetailTarget.gallonsDelivered ?? '—'}</strong>
            </div>
            <div className="rs-stop-detail__row rs-stop-detail__row--notes">
              <span>Notes</span>
              <strong>{stopDetailTarget.notes ?? '—'}</strong>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}
