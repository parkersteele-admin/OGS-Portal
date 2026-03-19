/**
 * src/pages/driver/StopPage.tsx
 * BEM prefix: sp-
 *
 * Driver stop detail page.
 * Routes:
 *   /driver/stop/:id        — stop detail with CTA to capture
 *   /driver/summary/:runId  — end-of-day run summary for driver
 *
 * Loads the stop + related customer / order / product, shows full delivery
 * details and a "Start delivery" or "View capture" button.
 */

import React, { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { getDoc, doc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { getRun, getRunStops } from '../../services/runService'
import type { RunStop, Run } from '../../types/run'
import type { Order } from '../../types/order'
import type { Customer } from '../../types/customer'
import type { Product } from '../../types/product'
import './StopPage.css'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(ts: { toDate(): Date } | undefined | null): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(ts: { toDate(): Date } | undefined | null): string {
  if (!ts) return '—'
  return ts.toDate().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

const STATUS_LABELS: Record<string, string> = {
  pending:   'Pending',
  arrived:   'Arrived',
  completed: 'Delivered',
  skipped:   'Skipped',
}

// ── Stop Detail View ──────────────────────────────────────────────────────────

function StopDetail() {
  const { id: stopId } = useParams<{ id: string }>()
  const location        = useLocation()
  const navigate        = useNavigate()

  const runId: string | undefined = (location.state as { runId?: string })?.runId

  const [stop,     setStop]     = useState<RunStop | null>(null)
  const [order,    setOrder]    = useState<Order | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [product,  setProduct]  = useState<Product | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    if (!stopId || !runId) {
      setError('Stop information is missing. Please navigate from the schedule.')
      setLoading(false)
      return
    }

    async function load() {
      try {
        const stopSnap = await getDoc(doc(db, 'runs', runId!, 'stops', stopId!))
        if (!stopSnap.exists()) { setError('Stop not found.'); return }
        const stopData = { id: stopSnap.id, ...stopSnap.data() } as RunStop
        setStop(stopData)

        const [orderSnap, customerSnap] = await Promise.all([
          stopData.orderId    ? getDoc(doc(db, 'orders',    stopData.orderId))    : null,
          stopData.customerId ? getDoc(doc(db, 'customers', stopData.customerId)) : null,
        ])

        const orderData = orderSnap?.exists()
          ? { id: orderSnap.id, ...orderSnap.data() } as Order : null
        setOrder(orderData)

        if (customerSnap?.exists()) {
          setCustomer({ id: customerSnap.id, ...customerSnap.data() } as Customer)
        }

        if (orderData?.productId) {
          const pSnap = await getDoc(doc(db, 'products', orderData.productId))
          if (pSnap.exists()) setProduct({ id: pSnap.id, ...pSnap.data() } as Product)
        }
      } catch (e: unknown) {
        setError((e as Error).message ?? 'Failed to load stop.')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [stopId, runId])

  if (loading) {
    return (
      <div className="sp-page">
        <div className="sp-center">
          <span className="sp-spinner" />
          <p className="sp-center__text">Loading stop…</p>
        </div>
      </div>
    )
  }

  if (error || !stop) {
    return (
      <div className="sp-page">
        <button className="sp-back" onClick={() => navigate('/driver/schedule')}>← Back to schedule</button>
        <div className="sp-error">{error ?? 'Stop not found.'}</div>
      </div>
    )
  }

  const isDone    = stop.status === 'completed'
  const isSkipped = stop.status === 'skipped'
  const isActive  = stop.status === 'pending' || stop.status === 'arrived'
  const qty       = order?.quantity ?? 0
  const unit      = product?.unit ?? 'unit'

  return (
    <div className="sp-page">
      <button className="sp-back" onClick={() => navigate('/driver/schedule')}>
        ← Back to schedule
      </button>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sp-header">
        <div className="sp-stop-num">Stop {stop.order}</div>
        <span className={`sp-status sp-status--${stop.status}`}>
          {STATUS_LABELS[stop.status] ?? stop.status}
        </span>
      </div>

      {/* ── Customer card ──────────────────────────────────────────────────── */}
      <div className="sp-card">
        <h2 className="sp-card__title">Customer</h2>
        <p className="sp-card__name">{customer?.name ?? '—'}</p>
        {customer && (
          <p className="sp-card__address">
            {customer.address}<br />
            {customer.city}, {customer.state} {customer.zip}
          </p>
        )}
        {customer?.phone && (
          <a href={`tel:${customer.phone}`} className="sp-card__phone">{customer.phone}</a>
        )}
      </div>

      {/* ── Delivery details ───────────────────────────────────────────────── */}
      <div className="sp-card">
        <h2 className="sp-card__title">Delivery</h2>
        <div className="sp-detail-grid">
          <span className="sp-detail-label">Product</span>
          <span className="sp-detail-value">{product?.name ?? '—'}</span>
          <span className="sp-detail-label">Ordered</span>
          <span className="sp-detail-value">{qty} {unit}{qty !== 1 ? 's' : ''}</span>
          {isDone && stop.gallonsDelivered != null && (
            <>
              <span className="sp-detail-label">Delivered</span>
              <span className="sp-detail-value">{stop.gallonsDelivered} {unit}{stop.gallonsDelivered !== 1 ? 's' : ''}</span>
            </>
          )}
          {stop.arrivedAt && (
            <>
              <span className="sp-detail-label">Arrived</span>
              <span className="sp-detail-value">{fmtTime(stop.arrivedAt as unknown as { toDate(): Date })}</span>
            </>
          )}
          {stop.completedAt && (
            <>
              <span className="sp-detail-label">Completed</span>
              <span className="sp-detail-value">{fmtTime(stop.completedAt as unknown as { toDate(): Date })}</span>
            </>
          )}
        </div>
        {stop.notes && (
          <p className="sp-card__notes">
            <span className="sp-detail-label">{isSkipped ? 'Skip reason' : 'Notes'}:</span> {stop.notes}
          </p>
        )}
      </div>

      {/* ── Add-Ons ───────────────────────────────────────────────────────── */}
      {order?.addOns && order.addOns.length > 0 && (
        <div className="sp-card sp-card--addons">
          <h2 className="sp-card__title sp-card__title--addons">ADD-ONS — bring these in addition to standing order</h2>
          <div className="sp-detail-grid">
            {order.addOns.map((ao, i) => (
              <React.Fragment key={i}>
                <span className="sp-detail-label">{ao.productName}</span>
                <span className="sp-detail-value">Qty {ao.qty}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* ── Site notes ─────────────────────────────────────────────────────── */}
      {customer?.notes && (
        <div className="sp-card">
          <h2 className="sp-card__title">Site Notes</h2>
          <p className="sp-card__notes">{customer.notes}</p>
        </div>
      )}

      {/* ── Photo evidence ─────────────────────────────────────────────────── */}
      {isDone && stop.photoUrls && stop.photoUrls.length > 0 && (
        <div className="sp-card">
          <h2 className="sp-card__title">Photo Evidence</h2>
          <div className="sp-photos">
            {stop.photoUrls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt={`Delivery photo ${i + 1}`} className="sp-photo" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Signature ──────────────────────────────────────────────────────── */}
      {isDone && stop.signatureUrl && (
        <div className="sp-card">
          <h2 className="sp-card__title">Signature</h2>
          <img src={stop.signatureUrl} alt="Customer signature" className="sp-signature" />
        </div>
      )}

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      {isActive && (
        <div className="sp-cta">
          <button
            className="sp-cta-btn"
            onClick={() => navigate(`/driver/capture/${stop.id}`, { state: { runId } })}
          >
            {stop.status === 'arrived' ? 'Continue delivery →' : 'Start delivery →'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Driver Run Summary (end-of-day) ───────────────────────────────────────────

function DriverRunSummary() {
  const { runId } = useParams<{ runId: string }>()
  const navigate  = useNavigate()

  const [run,       setRun]       = useState<Run | null>(null)
  const [stops,     setStops]     = useState<RunStop[]>([])
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map())
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!runId) { setError('Run ID missing.'); setLoading(false); return }

    async function load() {
      try {
        const [runData, stopsData] = await Promise.all([
          getRun(runId!),
          getRunStops(runId!),
        ])
        setRun(runData)
        setStops(stopsData)

        const customerIds = [...new Set(stopsData.map((s) => s.customerId).filter(Boolean))].slice(0, 30)
        const customerMap = new Map<string, Customer>()
        await Promise.all(
          customerIds.map(async (cid) => {
            const snap = await getDoc(doc(db, 'customers', cid))
            if (snap.exists()) customerMap.set(cid, { id: snap.id, ...snap.data() } as Customer)
          }),
        )
        setCustomers(customerMap)
      } catch (e: unknown) {
        setError((e as Error).message ?? 'Failed to load run summary.')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [runId])

  if (loading) {
    return (
      <div className="sp-page">
        <div className="sp-center">
          <span className="sp-spinner" />
          <p className="sp-center__text">Loading summary…</p>
        </div>
      </div>
    )
  }

  if (error || !run) {
    return (
      <div className="sp-page">
        <div className="sp-error">{error ?? 'Run not found.'}</div>
      </div>
    )
  }

  const completed = stops.filter((s) => s.status === 'completed').length
  const skipped   = stops.filter((s) => s.status === 'skipped').length
  const totalGals = stops.reduce((acc, s) => acc + (s.gallonsDelivered ?? 0), 0)

  return (
    <div className="sp-page">
      <div className="sp-header">
        <div>
          <div className="sp-stop-num">End of Day Summary</div>
          <p className="sp-summary-run">{run.runNumber} · {fmtDate(run.scheduledDate as unknown as { toDate(): Date })}</p>
        </div>
        <span className={`sp-status sp-status--${run.status}`}>
          {run.status === 'completed' ? 'Completed' : run.status}
        </span>
      </div>

      <div className="sp-kpis">
        <div className="sp-kpi">
          <span className="sp-kpi__value">{completed}</span>
          <span className="sp-kpi__label">Delivered</span>
        </div>
        <div className="sp-kpi">
          <span className="sp-kpi__value">{stops.length}</span>
          <span className="sp-kpi__label">Total Stops</span>
        </div>
        {skipped > 0 && (
          <div className="sp-kpi sp-kpi--warn">
            <span className="sp-kpi__value">{skipped}</span>
            <span className="sp-kpi__label">Skipped</span>
          </div>
        )}
        {totalGals > 0 && (
          <div className="sp-kpi">
            <span className="sp-kpi__value">{totalGals}</span>
            <span className="sp-kpi__label">Gallons</span>
          </div>
        )}
      </div>

      <div className="sp-card">
        <h2 className="sp-card__title">Stops</h2>
        <div className="sp-stop-list">
          {stops.map((stop) => (
            <div key={stop.id} className={`sp-stop-row sp-stop-row--${stop.status}`}>
              <span className="sp-stop-row__num">{stop.order}</span>
              <div className="sp-stop-row__info">
                <span className="sp-stop-row__cust">
                  {customers.get(stop.customerId)?.name ?? stop.customerId.slice(0, 8) + '…'}
                </span>
                {stop.gallonsDelivered != null && (
                  <span className="sp-stop-row__qty">{stop.gallonsDelivered} gal</span>
                )}
                {stop.status === 'skipped' && stop.notes && (
                  <span className="sp-stop-row__note">Skipped: {stop.notes}</span>
                )}
              </div>
              <span className={`sp-status sp-status--${stop.status}`}>
                {STATUS_LABELS[stop.status] ?? stop.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="sp-cta">
        <button className="sp-cta-btn" onClick={() => navigate('/driver/schedule')}>
          Back to schedule
        </button>
      </div>
    </div>
  )
}

// ── Router-aware export ────────────────────────────────────────────────────────
// /driver/stop/:id       → StopDetail
// /driver/summary/:runId → DriverRunSummary

export default function StopPage() {
  const location = useLocation()
  const isSummary = location.pathname.startsWith('/driver/summary')
  return isSummary ? <DriverRunSummary /> : <StopDetail />
}
