/**
 * OpsDashboard.tsx
 * BEM prefix: od-
 *
 * Sections:
 *  1. Stat cards (4-column) — pending orders, active runs, low tanks, outstanding invoices
 *  2. Active runs — real-time per-run cards with progress bar
 *  3. Pending orders pool — sortable table with bulk-select + "Build run"
 *  4. Alerts panel — low tanks / failed payments / expiring certs
 */

import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  onSnapshot,
  query,
  where,
  orderBy,
  collection,
  getDocs,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import {
  runsCol,
  invoicesCol,
  tanksCol,
  usersCol,
  customersCol,
} from '../../lib/firestore'
import { useActiveRun } from '../../hooks/useActiveRun'
import { usePendingOrders } from '../../hooks/usePendingOrders'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { Run } from '../../types/run'
import type { Order } from '../../types/order'
import type { Invoice } from '../../types/billing'
import type { Tank } from '../../types/tank'
import type { AppUser } from '../../types/user'
import type { Customer } from '../../types/customer'
import './OpsDashboard.css'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n)
}

function fmtTime(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '—'
  return ts.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDate(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts || typeof ts.toDate !== 'function') return '—'
  const d = ts.toDate()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isRush(order: Order): boolean {
  return order.deliveryTier === 'same-day' || order.deliveryTier === 'next-day'
}

function tierVariant(tier: Order['deliveryTier']): 'danger' | 'warning' | 'neutral' {
  if (tier === 'same-day') return 'danger'
  if (tier === 'next-day') return 'warning'
  return 'neutral'
}

function runStatusVariant(status: Run['status']): 'success' | 'warning' | 'neutral' | 'info' {
  if (status === 'in-progress') return 'success'
  if (status === 'completed')   return 'neutral'
  if (status === 'cancelled')   return 'danger' as never
  return 'info'
}

function runStatusLabel(status: Run['status']): string {
  if (status === 'in-progress') return 'Active'
  if (status === 'completed')   return 'Complete'
  if (status === 'cancelled')   return 'Cancelled'
  return 'Scheduled'
}

function daysUntil(ts: { toDate?: () => Date } | null | undefined): number {
  if (!ts || typeof ts.toDate !== 'function') return Infinity
  const ms = ts.toDate().getTime() - Date.now()
  return Math.ceil(ms / 86_400_000)
}

// ── Sub-hook: active runs list ─────────────────────────────────────────────

function useActiveRuns() {
  const [runIds, setRunIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onSnapshot(
      query(runsCol, where('status', 'in', ['scheduled', 'in-progress']), orderBy('scheduledDate', 'asc')),
      (snap) => {
        setRunIds(snap.docs.map((d) => d.id))
        setLoading(false)
      },
    )
    return unsub
  }, [])

  return { runIds, loading }
}

// ── Sub-hook: outstanding invoices total ──────────────────────────────────

function useOutstandingInvoices() {
  const [total, setTotal] = useState(0)
  const [count, setCount] = useState(0)

  useEffect(() => {
    const unsub = onSnapshot(
      query(invoicesCol, where('status', 'in', ['sent', 'overdue'])),
      (snap) => {
        const docs = snap.docs.map((d) => d.data() as Invoice)
        setCount(docs.length)
        setTotal(docs.reduce((s, inv) => s + (inv.total ?? 0), 0))
      },
    )
    return unsub
  }, [])

  return { total, count }
}

// ── Sub-hook: low tanks ────────────────────────────────────────────────────

function useLowTanks() {
  const [tanks, setTanks] = useState<(Tank & { customerName?: string })[]>([])
  const [customerMap, setCustomerMap] = useState<Record<string, string>>({})

  useEffect(() => {
    // Load all customer names once
    getDocs(customersCol).then((snap) => {
      const map: Record<string, string> = {}
      snap.docs.forEach((d) => {
        const c = d.data() as Customer
        map[d.id] = c.name
      })
      setCustomerMap(map)
    })
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(
      query(tanksCol, where('status', '==', 'deployed')),
      (snap) => {
        const low = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as Tank))
          .filter((t) => (t.currentLevelPct ?? 100) <= 30)
        setTanks(low)
      },
    )
    return unsub
  }, [])

  const tanksWithNames = tanks.map((t) => ({
    ...t,
    customerName: customerMap[t.customerId] ?? t.customerId,
  }))

  return { tanks: tanksWithNames }
}

// ── Sub-hook: failed payments ─────────────────────────────────────────────

function useFailedPayments() {
  const [payments, setPayments] = useState<Array<{ id: string; customerId: string; amount: number; customerName?: string }>>([])
  const [customerMap, setCustomerMap] = useState<Record<string, string>>({})

  useEffect(() => {
    getDocs(customersCol).then((snap) => {
      const map: Record<string, string> = {}
      snap.docs.forEach((d) => { map[d.id] = (d.data() as Customer).name })
      setCustomerMap(map)
    })
  }, [])

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'payments'), where('status', '==', 'failed')),
      (snap) => {
        setPayments(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as { customerId: string; amount: number }) })),
        )
      },
    )
    return unsub
  }, [])

  return payments.map((p) => ({ ...p, customerName: customerMap[p.customerId] ?? p.customerId }))
}

// ── Sub-hook: expiring certs (tanks due for inspection) ──────────────────

function useExpiringCerts() {
  const [tanks, setTanks] = useState<Tank[]>([])

  useEffect(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() + 60)
    const unsub = onSnapshot(
      query(tanksCol, where('status', 'in', ['deployed', 'available'])),
      (snap) => {
        const due = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as Tank))
          .filter((t) => {
            if (!t.nextInspectionDate) return false
            const days = daysUntil(t.nextInspectionDate as never)
            return days >= 0 && days <= 60
          })
        setTanks(due)
      },
    )
    return unsub
  }, [])

  return tanks
}

// ── Sub-hook: driver name lookup ──────────────────────────────────────────

function useDriverNames() {
  const [map, setMap] = useState<Record<string, string>>({})

  useEffect(() => {
    getDocs(query(usersCol, where('role', '==', 'driver'))).then((snap) => {
      const m: Record<string, string> = {}
      snap.docs.forEach((d) => { m[d.id] = (d.data() as AppUser).name })
      setMap(m)
    })
  }, [])

  return map
}

// ── Sub-hook: customer name lookup ────────────────────────────────────────

function useCustomerNames() {
  const [map, setMap] = useState<Record<string, string>>({})

  useEffect(() => {
    getDocs(customersCol).then((snap) => {
      const m: Record<string, string> = {}
      snap.docs.forEach((d) => { m[d.id] = (d.data() as Customer).name })
      setMap(m)
    })
  }, [])

  return map
}

// ── ActiveRunCard ──────────────────────────────────────────────────────────

interface ActiveRunCardProps {
  runId: string
  driverNames: Record<string, string>
}

const ActiveRunCard: React.FC<ActiveRunCardProps> = ({ runId, driverNames }) => {
  const { run, stops } = useActiveRun(runId)
  const navigate = useNavigate()

  if (!run) return null

  const completed = stops.filter((s) => s.status === 'completed' || s.status === 'skipped').length
  const total = stops.length
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  const lastCompleted = stops
    .filter((s) => s.status === 'completed' && s.completedAt)
    .sort((a, b) => {
      const at = (a.completedAt as { toDate?: () => Date } | undefined)
      const bt = (b.completedAt as { toDate?: () => Date } | undefined)
      if (!at?.toDate || !bt?.toDate) return 0
      return bt.toDate().getTime() - at.toDate().getTime()
    })[0]

  const driverName = driverNames[run.driverId] ?? 'Unknown driver'

  return (
    <div className="od-run-card">
      <div className="od-run-card__header">
        <div className="od-run-card__info">
          <span className="od-run-card__number">{run.runNumber}</span>
          <span className="od-run-card__meta">{driverName}{run.truckId ? ` · ${run.truckId}` : ''}</span>
        </div>
        <Badge variant={runStatusVariant(run.status)}>{runStatusLabel(run.status)}</Badge>
      </div>

      <div className="od-run-card__progress-wrap">
        <div className="od-run-card__progress-bar">
          <div className="od-run-card__progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="od-run-card__progress-label">{completed} / {total} stops</span>
      </div>

      {lastCompleted && (
        <p className="od-run-card__last-stop">
          Last stop: {fmtTime(lastCompleted.completedAt as never)}
        </p>
      )}

      <div className="od-run-card__actions">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/ops/dispatch', { state: { runId } })}
        >
          View on map
        </Button>
      </div>
    </div>
  )
}

// ── PendingOrdersTable ─────────────────────────────────────────────────────

interface PendingOrdersTableProps {
  orders: Order[]
  loading: boolean
  customerNames: Record<string, string>
}

const PendingOrdersTable: React.FC<PendingOrdersTableProps> = ({ orders, loading, customerNames }) => {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const sorted = [...orders].sort((a, b) => {
    const ar = isRush(a) ? 0 : 1
    const br = isRush(b) ? 0 : 1
    return ar - br
  })

  const allSelected = sorted.length > 0 && selected.size === sorted.length
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(sorted.map((o) => o.id)))
  }
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const buildRun = () => {
    const ids = Array.from(selected)
    navigate('/ops/runs/new', { state: { selectedOrderIds: ids } })
  }

  if (loading) {
    return <div className="od-table-loading">Loading orders…</div>
  }

  if (sorted.length === 0) {
    return (
      <div className="od-empty">
        <span className="od-empty__icon">✓</span>
        <p>No pending orders</p>
      </div>
    )
  }

  return (
    <div className="od-orders-table-wrap">
      {selected.size > 0 && (
        <div className="od-orders-toolbar">
          <span className="od-orders-toolbar__count">{selected.size} selected</span>
          <Button size="sm" onClick={buildRun}>Build run →</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      <div className="od-table-scroll">
        <table className="od-table">
          <thead>
            <tr>
              <th className="od-table__check">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th>Customer</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Tier</th>
              <th>Requested</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((order) => (
              <tr
                key={order.id}
                className={`od-table__row${isRush(order) ? ' od-table__row--rush' : ''}${selected.has(order.id) ? ' od-table__row--selected' : ''}`}
              >
                <td className="od-table__check">
                  <input
                    type="checkbox"
                    checked={selected.has(order.id)}
                    onChange={() => toggle(order.id)}
                    aria-label={`Select order ${order.id}`}
                  />
                </td>
                <td className="od-table__customer">{customerNames[order.customerId] ?? order.customerId}</td>
                <td className="od-table__product">{order.productId}</td>
                <td className="od-table__qty">{order.quantity}</td>
                <td>
                  <Badge variant={tierVariant(order.deliveryTier)}>
                    {order.deliveryTier}
                  </Badge>
                </td>
                <td className="od-table__date">{fmtDate(order.requestedAt as never)}</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate('/ops/runs/new', { state: { selectedOrderIds: [order.id] } })}
                  >
                    Build run
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── OpsDashboard (main) ────────────────────────────────────────────────────

const OpsDashboard: React.FC = () => {
  const navigate = useNavigate()

  // Stat data
  const { orders: pendingOrders, loading: pendingLoading } = usePendingOrders()
  const { runIds, loading: runsLoading } = useActiveRuns()
  const { total: outstandingTotal } = useOutstandingInvoices()

  // Sub-sections
  const { tanks: lowTanks } = useLowTanks()
  const failedPayments = useFailedPayments()
  const expiringCerts = useExpiringCerts()
  const driverNames = useDriverNames()
  const customerNames = useCustomerNames()

  const rushCount = pendingOrders.filter(isRush).length

  // Driver names for active run cards (pass a stable ref)
  const activeDriverNames = driverNames

  return (
    <div className="od-page">

      {/* ── Top bar quick actions ── */}
      <div className="od-topbar">
        <h1 className="od-topbar__title">Operations Dashboard</h1>
        <div className="od-topbar__actions">
          <Button size="sm" onClick={() => navigate('/ops/orders', { state: { openNew: true } })}>
            + New order
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/ops/runs/new')}>
            + New run
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/crm/customers', { state: { openNew: true } })}>
            + New customer
          </Button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="od-stats">

        {/* Pending orders */}
        <div className="od-stat-card od-stat-card--orders">
          <div className="od-stat-card__icon">📋</div>
          <div className="od-stat-card__body">
            <span className="od-stat-card__value">
              {pendingLoading ? '—' : pendingOrders.length}
            </span>
            <span className="od-stat-card__label">Pending orders</span>
            {rushCount > 0 && (
              <span className="od-stat-card__sub od-stat-card__sub--rush">
                {rushCount} rush
              </span>
            )}
          </div>
        </div>

        {/* Active runs */}
        <div className="od-stat-card od-stat-card--runs">
          <div className="od-stat-card__icon">🚛</div>
          <div className="od-stat-card__body">
            <span className="od-stat-card__value">
              {runsLoading ? '—' : runIds.length}
            </span>
            <span className="od-stat-card__label">Active runs today</span>
            {!runsLoading && runIds.length > 0 && (
              <ActiveRunDriverNames runIds={runIds} driverNames={driverNames} />
            )}
          </div>
        </div>

        {/* Low tanks */}
        <div className="od-stat-card od-stat-card--tanks">
          <div className="od-stat-card__icon">⚠️</div>
          <div className="od-stat-card__body">
            <span className="od-stat-card__value">{lowTanks.length}</span>
            <span className="od-stat-card__label">Tanks low level</span>
            {lowTanks.length > 0 && (
              <button
                className="od-stat-card__link"
                onClick={() => navigate('/ops/tanks')}
              >
                needs attention
              </button>
            )}
          </div>
        </div>

        {/* Outstanding invoices */}
        <div className="od-stat-card od-stat-card--invoices">
          <div className="od-stat-card__icon">💰</div>
          <div className="od-stat-card__body">
            <span className="od-stat-card__value">{fmtCurrency(outstandingTotal)}</span>
            <span className="od-stat-card__label">Outstanding invoices</span>
          </div>
        </div>

      </div>

      {/* ── Main content: runs + orders (left) + alerts (right) ── */}
      <div className="od-content">
        <div className="od-main">

          {/* Active runs */}
          <section className="od-section">
            <div className="od-section__header">
              <h2 className="od-section__title">Active runs</h2>
              <Button size="sm" variant="ghost" onClick={() => navigate('/ops/runs')}>
                View all
              </Button>
            </div>
            {runsLoading ? (
              <div className="od-table-loading">Loading runs…</div>
            ) : runIds.length === 0 ? (
              <div className="od-empty">
                <span className="od-empty__icon">🚛</span>
                <p>No active runs</p>
              </div>
            ) : (
              <div className="od-runs-grid">
                {runIds.map((id) => (
                  <ActiveRunCard key={id} runId={id} driverNames={activeDriverNames} />
                ))}
              </div>
            )}
          </section>

          {/* Pending orders pool */}
          <section className="od-section">
            <div className="od-section__header">
              <h2 className="od-section__title">Pending orders pool</h2>
              <Button size="sm" variant="ghost" onClick={() => navigate('/ops/orders')}>
                View all
              </Button>
            </div>
            <PendingOrdersTable
              orders={pendingOrders}
              loading={pendingLoading}
              customerNames={customerNames}
            />
          </section>

        </div>

        {/* ── Alerts sidebar ── */}
        <aside className="od-alerts">
          <h2 className="od-alerts__title">Alerts</h2>

          {/* Low tanks */}
          {lowTanks.length > 0 && (
            <div className="od-alert-group">
              <h3 className="od-alert-group__label">Low tanks ({lowTanks.length})</h3>
              <ul className="od-alert-list">
                {lowTanks.map((t) => (
                  <li key={t.id} className="od-alert-item od-alert-item--warning">
                    <div className="od-alert-item__main">
                      <span className="od-alert-item__title">{t.serialNumber}</span>
                      <span className="od-alert-item__sub">{t.customerName}</span>
                    </div>
                    <span className="od-alert-item__badge od-alert-item__badge--warning">
                      {t.currentLevelPct ?? '?'}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Failed payments */}
          {failedPayments.length > 0 && (
            <div className="od-alert-group">
              <h3 className="od-alert-group__label">Failed payments ({failedPayments.length})</h3>
              <ul className="od-alert-list">
                {failedPayments.map((p) => (
                  <li key={p.id} className="od-alert-item od-alert-item--danger">
                    <div className="od-alert-item__main">
                      <span className="od-alert-item__title">{p.customerName}</span>
                      <span className="od-alert-item__sub">{fmtCurrency(p.amount)}</span>
                    </div>
                    <button
                      className="od-alert-item__action"
                      onClick={() => navigate('/ops/billing')}
                    >
                      Review
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Expiring certs */}
          {expiringCerts.length > 0 && (
            <div className="od-alert-group">
              <h3 className="od-alert-group__label">Expiring certifications ({expiringCerts.length})</h3>
              <ul className="od-alert-list">
                {expiringCerts.map((t) => {
                  const days = daysUntil(t.nextInspectionDate as never)
                  return (
                    <li key={t.id} className={`od-alert-item ${days <= 14 ? 'od-alert-item--danger' : 'od-alert-item--warning'}`}>
                      <div className="od-alert-item__main">
                        <span className="od-alert-item__title">{t.serialNumber}</span>
                        <span className="od-alert-item__sub">Inspection due</span>
                      </div>
                      <span className={`od-alert-item__badge ${days <= 14 ? 'od-alert-item__badge--danger' : 'od-alert-item__badge--warning'}`}>
                        {days}d
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {lowTanks.length === 0 && failedPayments.length === 0 && expiringCerts.length === 0 && (
            <div className="od-alerts__empty">
              <span>✓</span>
              <p>No alerts</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

// ── Tiny helper: show driver names inside stat card ─────────────────────

const ActiveRunDriverNames: React.FC<{ runIds: string[]; driverNames: Record<string, string> }> = ({ runIds, driverNames }) => {
  // We only have runIds here — we need driver ids from the runs docs
  // Use a small subscription to get driver ids for these runs
  const [drivers, setDrivers] = useState<string[]>([])

  useEffect(() => {
    if (runIds.length === 0) { setDrivers([]); return }
    const unsub = onSnapshot(
      query(runsCol, where('status', 'in', ['scheduled', 'in-progress'])),
      (snap) => {
        const names = snap.docs
          .map((d) => driverNames[(d.data() as Run).driverId])
          .filter(Boolean) as string[]
        // Deduplicate
        setDrivers([...new Set(names)])
      },
    )
    return unsub
  }, [runIds, driverNames])

  if (drivers.length === 0) return null
  const preview = drivers.slice(0, 3).join(', ')
  const extra = drivers.length > 3 ? ` +${drivers.length - 3}` : ''
  return <span className="od-stat-card__sub">{preview}{extra}</span>
}

export default OpsDashboard
