/**
 * src/pages/dispatch/DispatchMap.tsx
 * BEM prefix: dm-
 *
 * Live dispatch command centre — split view:
 *   Left  (320px): stop list + real-time event feed
 *   Right (flex):  Google Map with route + markers
 *
 * Data source: useActiveRun(runId) — all updates via Firestore onSnapshot.
 * runId resolution:  URL param  →  location.state.runId  →  run selector UI
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Truck } from 'lucide-react'
import {
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  getDoc,
} from 'firebase/firestore'
import { db } from '../../../lib/firebase'
import { runsCol, notificationsCol } from '../../../lib/firestore'
import { useActiveRun } from '../../../hooks/useActiveRun'
import { usePendingOrders } from '../../../hooks/usePendingOrders'
import { addRunStop, updateRun } from '../../../services/runService'
import { updateOrder } from '../../../services/orderService'
import { DispatchMap as MapComponent } from '../../../components/maps/DispatchMap'
import { DeliveryCompleteModal } from '../../../components/delivery/DeliveryCompleteModal'
import { Button } from '../../../components/ui/Button'
import type { Run, RunStop, RunStatus } from '../../../types/run'
import type { Customer } from '../../../types/customer'
import type { AppUser } from '../../../types/user'
import type { Notification } from '../../../types/index'
import type { Order } from '../../../types/order'
import './DispatchMap.css'

// ── Types ──────────────────────────────────────────────────────────────────────

type LatLng = { lat: number; lng: number }

// ── Client-side geocoding fallback ────────────────────────────────────────────
// When a customer document is missing lat/lng (e.g. the Cloud Function hasn't
// geocoded it yet), we attempt a best-effort geocode via the REST API so the
// stop still appears on the map.  Results are applied to local state only —
// Firestore is not modified.

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

async function geocodeFallback(c: Customer): Promise<LatLng | null> {
  if (!GMAPS_KEY) return null
  const addr = [c.address, c.city, c.state, c.zip].filter(Boolean).join(', ')
  if (!addr.trim()) return null
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(addr)}&key=${GMAPS_KEY}`
    const res  = await fetch(url)
    const json = await res.json() as {
      status: string
      results: Array<{ geometry: { location: { lat: number; lng: number } } }>
    }
    if (json.status === 'OK' && json.results[0]) {
      return json.results[0].geometry.location
    }
  } catch {
    // silently fail — the stop will simply not show on the map
  }
  return null
}

interface FeedEvent {
  id: string
  time: Date
  message: string
  kind: 'start' | 'arrive' | 'complete' | 'skip'
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function buildEvents(
  run: Run | null,
  stops: RunStop[],
  customers: Record<string, Customer>,
): FeedEvent[] {
  const events: FeedEvent[] = []

  if (run?.startedAt) {
    events.push({
      id: 'run-start',
      time: run.startedAt.toDate(),
      message: 'Run started',
      kind: 'start',
    })
  }

  for (const stop of stops) {
    const name = customers[stop.customerId]?.name ?? `Stop ${stop.order}`

    if (stop.arrivedAt) {
      events.push({
        id: `arrive-${stop.id}`,
        time: stop.arrivedAt.toDate(),
        message: `Arrived at Stop ${stop.order} — ${name}`,
        kind: 'arrive',
      })
    }

    if (stop.completedAt && stop.status === 'completed') {
      const gal =
        stop.gallonsDelivered != null ? ` (${stop.gallonsDelivered} gal)` : ''
      events.push({
        id: `complete-${stop.id}`,
        time: stop.completedAt.toDate(),
        message: `Stop ${stop.order} marked complete — ${name}${gal}`,
        kind: 'complete',
      })
    }

    if (stop.status === 'skipped') {
      events.push({
        id: `skip-${stop.id}`,
        time: (stop.completedAt ?? stop.arrivedAt)?.toDate() ?? new Date(0),
        message: `Stop ${stop.order} skipped — ${name}${stop.notes ? `: ${stop.notes}` : ''}`,
        kind: 'skip',
      })
    }
  }

  return events.sort((a, b) => b.time.getTime() - a.time.getTime())
}

// ── Stop icon ──────────────────────────────────────────────────────────────────

function StopIcon({ stop }: { stop: RunStop }) {
  if (stop.status === 'completed') {
    return (
      <span className="dm-stop-icon dm-stop-icon--completed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13l4 4L19 7"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }
  if (stop.status === 'skipped') {
    return (
      <span className="dm-stop-icon dm-stop-icon--failed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 18L18 6M6 6l12 12"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </span>
    )
  }
  if (stop.status === 'arrived') {
    return (
      <span className="dm-stop-icon dm-stop-icon--current">{stop.order}</span>
    )
  }
  return (
    <span className="dm-stop-icon dm-stop-icon--pending">{stop.order}</span>
  )
}

// ── Stop row ───────────────────────────────────────────────────────────────────

interface StopRowProps {
  stop: RunStop
  customer?: Customer
  order?: Order
  isCurrent: boolean
  onClick: () => void
  onCompleteDelivery?: () => void
}

function StopRow({ stop, customer, order, isCurrent, onClick, onCompleteDelivery }: StopRowProps) {
  const cls = [
    'dm-stop-item',
    stop.status === 'completed' ? 'dm-stop-item--completed' : '',
    stop.status === 'skipped' ? 'dm-stop-item--failed' : '',
    isCurrent ? 'dm-stop-item--current' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const name = customer?.name ?? '—'
  const addr = customer
    ? `${customer.address}, ${customer.city}`
    : stop.customerId.slice(0, 8)

  return (
    <div
      className={cls}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <StopIcon stop={stop} />
      <div className="dm-stop-item__body">
        <div className="dm-stop-item__name">{name}</div>
        <div className="dm-stop-item__meta">{addr}</div>

        {stop.status === 'completed' && stop.completedAt && (
          <div className="dm-stop-item__time">
            ✓ {fmtTime(stop.completedAt.toDate())}
            {stop.gallonsDelivered != null &&
              ` · ${stop.gallonsDelivered} gal`}
          </div>
        )}

        {stop.status === 'skipped' && (
          <div className="dm-stop-item__time dm-stop-item__time--failed">
            ✗ {stop.notes ?? 'Skipped'}
          </div>
        )}

        {isCurrent && stop.status === 'arrived' && (
          <div className="dm-stop-item__status">At stop</div>
        )}
        {isCurrent && stop.status === 'pending' && (
          <div className="dm-stop-item__status">En route</div>
        )}

        {(stop.status === 'pending' || stop.status === 'arrived') && (
          <div className="dm-stop-item__actions">
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onCompleteDelivery?.()
              }}
              disabled={!order || !onCompleteDelivery}
            >
              {order ? 'Complete Delivery' : 'Loading order…'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Event feed row ────────────────────────────────────────────────────────────

function FeedRow({ event }: { event: FeedEvent }) {
  return (
    <div className={`dm-feed-entry dm-feed-entry--${event.kind}`}>
      <span className="dm-feed-entry__time">{fmtTime(event.time)}</span>
      <span className="dm-feed-entry__msg">{event.message}</span>
    </div>
  )
}

// ── Add stop modal ────────────────────────────────────────────────────────────

interface AddStopModalProps {
  runId: string
  currentStopCount: number
  runStatus: RunStatus
  onClose: () => void
}

function AddStopModal({ runId, currentStopCount, runStatus, onClose }: AddStopModalProps) {
  const { orders } = usePendingOrders()
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string[]>([])
  const [error, setError] = useState('')
  const loadedRef = useRef<Set<string>>(new Set())

  // Batch-load customer names for all pending orders
  useEffect(() => {
    const ids = [...new Set(orders.map((o) => o.customerId))]
    const missing = ids.filter((id) => !loadedRef.current.has(id))
    if (!missing.length) return
    missing.forEach((id) => loadedRef.current.add(id))
    Promise.all(
      missing.map((id) =>
        getDoc(doc(db, 'customers', id)).then((snap) =>
          snap.exists()
            ? ([id, (snap.data() as Customer).name] as [string, string])
            : null,
        ),
      ),
    ).then((results) => {
      const map: Record<string, string> = {}
      results.forEach((r) => {
        if (r) map[r[0]] = r[1]
      })
      setCustomerNames((prev) => ({ ...prev, ...map }))
    })
  }, [orders])

  const lc = search.toLowerCase()
  const filtered = orders.filter(
    (o) =>
      !added.includes(o.id) &&
      (customerNames[o.customerId] ?? o.customerId)
        .toLowerCase()
        .includes(lc),
  )

  async function handleAdd(order: Order) {
    setBusy(true)
    setError('')
    try {
      await addRunStop({
        runId,
        order: currentStopCount + added.length + 1,
        orderId: order.id,
        customerId: order.customerId,
        tankId: order.tankId,
      })
      await updateOrder(order.id, {
        status: runStatus === 'in-progress' ? 'in_transit' : 'scheduled',
        runId,
      })
      setAdded((prev) => [...prev, order.id])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add stop')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dm-overlay" onClick={onClose}>
      <div className="dm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dm-modal__header">
          <h2 className="dm-modal__title">Add Stop</h2>
          <button
            className="dm-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <input
          className="dm-modal__search"
          placeholder="Search by customer name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        {error && <div className="dm-modal__error">{error}</div>}

        <div className="dm-modal__list">
          {filtered.length === 0 && (
            <div className="dm-modal__empty">No pending orders found</div>
          )}
          {filtered.map((order) => (
            <div key={order.id} className="dm-modal-row">
              <div className="dm-modal-row__body">
                <div className="dm-modal-row__name">
                  {customerNames[order.customerId] ?? '…'}
                </div>
                <div className="dm-modal-row__meta">
                  {order.quantity} gal · {order.deliveryTier}
                </div>
              </div>
              <Button size="sm" disabled={busy} onClick={() => handleAdd(order)}>
                Add
              </Button>
            </div>
          ))}
        </div>

        <div className="dm-modal__footer">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── End run confirm dialog ────────────────────────────────────────────────────

interface EndRunDialogProps {
  run: Run
  remainingStops: number
  onConfirmDelivered: () => void
  onConfirmCancelled: () => void
  onCancel: () => void
  busy: boolean
}

function EndRunDialog({
  run,
  remainingStops,
  onConfirmDelivered,
  onConfirmCancelled,
  onCancel,
  busy,
}: EndRunDialogProps) {
  return (
    <div className="dm-overlay" onClick={onCancel}>
      <div className="dm-confirm" onClick={(e) => e.stopPropagation()}>
        <h2 className="dm-confirm__title">Close Run?</h2>
        <p className="dm-confirm__body">
          {remainingStops > 0 ? (
            <>
              <strong>{run.runNumber}</strong> still has {remainingStops}{' '}
              stop{remainingStops === 1 ? '' : 's'} in progress.
              <br />
              Choose whether to mark it delivered or cancel it.
            </>
          ) : (
            <>
              Mark <strong>{run.runNumber}</strong> as delivered?
            </>
          )}
        </p>
        <div className="dm-confirm__actions">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {remainingStops > 0 && (
            <Button variant="danger" onClick={onConfirmCancelled} disabled={busy}>
              {busy ? 'Saving…' : 'Cancel Run'}
            </Button>
          )}
          <Button onClick={onConfirmDelivered} disabled={busy}>
            {busy ? 'Saving…' : 'Mark Delivered'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Run selector (no run chosen) ──────────────────────────────────────────────

function RunSelector({ onSelect }: { onSelect: (id: string) => void }) {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      query(
        runsCol,
        where('status', 'in', ['scheduled', 'in-progress']),
        orderBy('scheduledDate'),
      ),
      (snap) => {
        setRuns(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Run))
        setLoading(false)
      },
    )
    return unsub
  }, [])

  if (loading) {
    return (
      <div className="dm-run-select">
        <p style={{ color: 'var(--color-text-3)' }}>Loading runs…</p>
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="dm-run-select">
        <h2 className="dm-run-select__title">No Active Runs</h2>
        <p className="dm-run-select__sub">
          Build a run from the dashboard to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="dm-run-select">
      <h2 className="dm-run-select__title">Select a Run</h2>
      <div className="dm-run-select__list">
        {runs.map((r) => (
          <div
            key={r.id}
            className="dm-run-select__item"
            onClick={() => onSelect(r.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(r.id)}
          >
            <div className="dm-run-select__num">{r.runNumber}</div>
            <div className="dm-run-select__meta">
              {r.scheduledDate?.toDate?.()?.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              }) ?? '—'}{' '}
              · {r.status}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DispatchMapPage() {
  const params = useParams<{ runId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const opsBase = location.pathname.startsWith('/admin') ? '/admin/ops' : '/ops'

  // runId priority: URL param → location state → null (show selector)
  const [runId, setRunId] = useState<string | null>(
    params.runId ??
      (location.state as { runId?: string } | null)?.runId ??
      null,
  )

  // Keep runId in sync when the URL param changes (e.g. after RunSelector navigation)
  useEffect(() => {
    if (params.runId && params.runId !== runId) {
      setRunId(params.runId)
    }
  }, [params.runId])

  const { run, stops, loading } = useActiveRun(runId)
  const [driver, setDriver] = useState<AppUser | null>(null)
  const [customers, setCustomers] = useState<Record<string, Customer>>({})
  const [rushNotifs, setRushNotifs] = useState<Notification[]>([])
  const [cameraTarget, setCameraTarget] = useState<LatLng | null>(null)
  const [showAddStop, setShowAddStop] = useState(false)
  const [showEndRun, setShowEndRun] = useState(false)
  const [endingRun, setEndingRun] = useState(false)
  const [orders, setOrders] = useState<Record<string, Order>>({})
  const [deliveryTarget, setDeliveryTarget] = useState<{ stop: RunStop; order: Order } | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const loadedCustomerIds = useRef<Set<string>>(new Set())
  const loadedOrderIds = useRef<Set<string>>(new Set())

  // Load driver doc when run.driverId changes
  useEffect(() => {
    const driverId = run?.driverId
    if (!driverId) return
    getDoc(doc(db, 'users', driverId)).then((snap) => {
      if (snap.exists()) setDriver({ id: snap.id, ...snap.data() } as AppUser)
    })
  }, [run?.driverId])

  // Accumulate customer docs as new stop customerIds appear, then geocode any
  // that are missing lat/lng so they always show on the map.
  useEffect(() => {
    const ids = [...new Set(stops.map((s) => s.customerId))]
    const missing = ids.filter((id) => !loadedCustomerIds.current.has(id))
    if (!missing.length) return
    missing.forEach((id) => loadedCustomerIds.current.add(id))
    Promise.all(
      missing.map((id) =>
        getDoc(doc(db, 'customers', id)).then((snap) =>
          snap.exists()
            ? ({ id: snap.id, ...snap.data() } as Customer)
            : null,
        ),
      ),
    ).then(async (docs) => {
      const map: Record<string, Customer> = {}
      docs.forEach((c) => { if (c) map[c.id] = c })
      setCustomers((prev) => ({ ...prev, ...map }))

      // Geocode any customers that came back without coordinates
      const needsGeocode = docs.filter((c): c is Customer => !!c && !c.lat && !c.lng)
      if (!needsGeocode.length) return

      const results = await Promise.allSettled(
        needsGeocode.map(async (c) => ({ id: c.id, coords: await geocodeFallback(c) }))
      )
      const geocoded: Record<string, LatLng> = {}
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value.coords) {
          geocoded[r.value.id] = r.value.coords
        }
      })
      if (!Object.keys(geocoded).length) return
      setCustomers((prev) => {
        const updated = { ...prev }
        Object.entries(geocoded).forEach(([id, coords]) => {
          if (updated[id]) updated[id] = { ...updated[id], ...coords }
        })
        return updated
      })
    })
  }, [stops])

  // Subscribe to unread rush order notifications
  useEffect(() => {
    const unsub = onSnapshot(
      query(
        notificationsCol,
        where('type', '==', 'rush_order'),
        where('read', '==', false),
        orderBy('createdAt', 'desc'),
      ),
      (snap) => {
        setRushNotifs(
          snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Notification),
        )
      },
    )
    return unsub
  }, [])

  // Load order docs needed for delivery completion actions.
  useEffect(() => {
    const ids = [...new Set(stops.map((s) => s.orderId).filter(Boolean))]
    const missing = ids.filter((id) => !loadedOrderIds.current.has(id))
    if (!missing.length) return
    missing.forEach((id) => loadedOrderIds.current.add(id))

    Promise.all(
      missing.map((id) =>
        getDoc(doc(db, 'orders', id)).then((snap) =>
          snap.exists()
            ? ({ id: snap.id, ...(snap.data() as Omit<Order, 'id'>) } as Order)
            : null,
        ),
      ),
    ).then((docs) => {
      const map: Record<string, Order> = {}
      docs.forEach((o) => {
        if (o) map[o.id] = o
      })
      if (Object.keys(map).length) {
        setOrders((prev) => ({ ...prev, ...map }))
      }
    })
  }, [stops])

  // Determine the "current" stop: arrived first, otherwise first pending
  const currentStop =
    stops.find((s) => s.status === 'arrived') ??
    stops.find((s) => s.status === 'pending')

  // Build event feed from stop timestamps (newest first)
  const events = useMemo(
    () => buildEvents(run, stops, customers),
    [run, stops, customers],
  )

  const remainingStops = stops.filter(
    (s) => s.status === 'pending' || s.status === 'arrived',
  ).length

  // Auto-scroll feed to top when new events arrive
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0
  }, [events.length])

  async function handleEndRun(nextStatus: RunStatus) {
    if (!runId) return
    setEndingRun(true)
    try {
      const unresolvedStops = stops.filter((s) => s.status === 'pending' || s.status === 'arrived')
      const unresolvedOrderIds = [...new Set(unresolvedStops.map((s) => s.orderId).filter(Boolean))]

      if (unresolvedOrderIds.length) {
        await Promise.all(
          unresolvedOrderIds.map(async (orderId) => {
            const cached = orders[orderId]
            const order = cached ?? await getDoc(doc(db, 'orders', orderId)).then((snap) =>
              (snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Order, 'id'>) } as Order) : null),
            )
            if (!order) return
            if (order.status === 'delivered' || order.status === 'paid') return
            await updateOrder(orderId, { status: 'pending' })
          }),
        )
      }

      await updateRun(runId, { status: nextStatus })
      navigate(`${opsBase}/dashboard`)
    } catch {
      setEndingRun(false)
    }
  }

  function handleStopClick(stop: RunStop) {
    const cust = customers[stop.customerId]
    if (cust?.lat && cust?.lng) {
      setCameraTarget({ lat: cust.lat, lng: cust.lng })
    }
  }

  // Called by RoutePolyline when Directions API resolves addresses to lat/lng.
  // Merges resolved coords into customers state so stop markers can render.
  const handlePositionsResolved = useCallback(
    (positions: Record<string, { lat: number; lng: number }>) => {
      setCustomers((prev) => {
        const updated = { ...prev }
        Object.entries(positions).forEach(([id, coords]) => {
          if (updated[id]) updated[id] = { ...updated[id], ...coords }
        })
        return updated
      })
    },
    [],
  )

  const completedCount = stops.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length

  // No run selected → show run picker
  if (!runId) {
    return (
      <div className="dm-page">
        <div className="dm-topbar">
          <span className="dm-topbar__title">Dispatch</span>
        </div>
        <div className="dm-body">
          <RunSelector onSelect={(id) => navigate(`${opsBase}/dispatch/${id}`, { replace: true })} />
        </div>
      </div>
    )
  }

  // ── Run selected → full dispatch view ─────────────────────────────────────────
  return (
    <div className="dm-page">
      {/* ── Top bar ── */}
      <div className="dm-topbar">
        <div className="dm-topbar__left">
          <button
            className="dm-topbar__back"
            onClick={() => navigate(`${opsBase}/dashboard`)}
            aria-label="Back to ops dashboard"
          >
            ← Ops
          </button>
          <span className="dm-topbar__title">
            {run?.runNumber ?? 'Loading…'}
          </span>
        </div>

        <div className="dm-topbar__actions">
          {rushNotifs.length > 0 && (
            <button
              className="dm-rush-badge"
              onClick={() => navigate(`${opsBase}/orders`)}
              title="New rush orders pending"
            >
              <span className="dm-rush-badge__dot" />
              {rushNotifs.length} Rush{' '}
              {rushNotifs.length === 1 ? 'Order' : 'Orders'}
            </button>
          )}

          {run && run.status !== 'completed' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAddStop(true)}
              >
                + Add Stop
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowEndRun(true)}
              >
                Mark Delivered
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      {loading ? (
        <div className="dm-loading">Loading run…</div>
      ) : !run ? (
        <div className="dm-loading">Run not found.</div>
      ) : (
        <div className="dm-body">
          {/* Left panel */}
          <div className="dm-left">
            {/* Run header */}
            <div className="dm-run-header">
              <div className="dm-run-header__driver">
                <Truck size={14} aria-hidden="true" /> {driver?.name ?? run.driverId} ·{' '}
                {run.truckId ?? 'Truck TBD'}
              </div>
              <div className="dm-run-header__progress">
                {completedCount} of {stops.length} stops
              </div>
              <div className="dm-run-header__bar">
                <div
                  className="dm-run-header__bar-fill"
                  style={{
                    width: stops.length
                      ? `${(completedCount / stops.length) * 100}%`
                      : '0%',
                  }}
                />
              </div>
            </div>

            {/* Stop list */}
            <div className="dm-stop-list">
              {stops.map((stop) => (
                <StopRow
                  key={stop.id}
                  stop={stop}
                  customer={customers[stop.customerId]}
                  order={orders[stop.orderId]}
                  isCurrent={stop.id === currentStop?.id}
                  onClick={() => handleStopClick(stop)}
                  onCompleteDelivery={
                    orders[stop.orderId]
                      ? () => setDeliveryTarget({ stop, order: orders[stop.orderId] })
                      : undefined
                  }
                />
              ))}
              {stops.length === 0 && (
                <div className="dm-stop-list__empty">No stops on this run</div>
              )}
            </div>

            {/* Event feed */}
            <div className="dm-feed-header">
              <span>Event Feed</span>
            </div>
            <div className="dm-feed" ref={feedRef}>
              {events.length === 0 && (
                <div className="dm-feed-empty">No events yet</div>
              )}
              {events.map((ev) => (
                <FeedRow key={ev.id} event={ev} />
              ))}
            </div>
          </div>

          {/* Right panel — map */}
          <div className="dm-right">
            <MapComponent
              stops={stops}
              customers={customers}
              driverName={driver?.name ?? 'Driver'}
              cameraTarget={cameraTarget}
              height="100%"
              onPositionsResolved={handlePositionsResolved}
            />
          </div>
        </div>
      )}

      {/* Add stop modal */}
      {showAddStop && runId && (
        <AddStopModal
          runId={runId}
          currentStopCount={stops.length}
          runStatus={run?.status ?? 'scheduled'}
          onClose={() => setShowAddStop(false)}
        />
      )}

      {/* End run dialog */}
      {showEndRun && run && (
        <EndRunDialog
          run={run}
          remainingStops={remainingStops}
          onConfirmDelivered={() => handleEndRun('completed')}
          onConfirmCancelled={() => handleEndRun('cancelled')}
          onCancel={() => setShowEndRun(false)}
          busy={endingRun}
        />
      )}

      {/* Complete delivery modal (BOM/signature workflow) */}
      {deliveryTarget && runId && (
        <DeliveryCompleteModal
          order={deliveryTarget.order}
          runId={runId}
          stopId={deliveryTarget.stop.id}
          onClose={() => setDeliveryTarget(null)}
          onSuccess={() => {
            setDeliveryTarget(null)
          }}
        />
      )}
    </div>
  )
}
